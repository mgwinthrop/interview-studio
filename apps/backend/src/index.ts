import "dotenv/config";
import { exec } from "child_process";
import { createServer } from "http";
import { promisify } from "util";
import cors from "cors";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { createSession, getSession, updateSession, deleteSession } from "./sessionStore";
import { getRuntimeState, setRuntimeState, deleteRuntimeState } from "./runtimeStore";
import { ScribeSession } from "./scribeSession";
import { ConversationTurn, Phase } from "./types";
import { runTurn } from "./orchestrator";
import { send } from "./wsUtils";
import { generateReport } from "./reportGenerator";
import { getTopicConfig } from "./topic";
import prisma from "./db";
import {
  persistSessionCreate,
  persistTurn,
  persistSessionEnd,
  readReportFromDb,
  readTurnsFromDb,
} from "./persistence";

const execAsync = promisify(exec);

const REQUIRED_ENV = ["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "DATABASE_URL"] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

async function runMigrations(): Promise<void> {
  try {
    await execAsync("npx prisma migrate deploy", { cwd: __dirname + "/.." });
    await prisma.$queryRaw`PRAGMA journal_mode=WAL`;
    console.log("Database migrations applied");
  } catch (err) {
    console.error("Migration failed (continuing):", err);
  }
}

const app = express();

const allowedOrigin = process.env.ALLOWED_ORIGIN || "http://localhost:3000";
app.use(cors({
  origin: [allowedOrigin, "http://localhost:3000"],
}));

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
// ANTHROPIC_API_KEY and ELEVENLABS_VOICE_ID are read from process.env in orchestrator.ts

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/session/:sessionId/transcript", async (req, res) => {
  const { sessionId } = req.params;

  // Try in-memory first, fall through to SQLite on post-restart requests
  const session = getSession(sessionId);
  const turns = session?.turns.length ? session.turns : await readTurnsFromDb(sessionId);

  if (!turns || turns.length === 0) {
    res.status(404).json({ error: "Session not found or has no turns" });
    return;
  }

  const text = turns
    .map((t) => `${t.role === "user" ? "Participant" : "Interviewer"}: ${t.content}`)
    .join("\n\n");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="transcript-${sessionId}.txt"`
  );
  res.send(text);
});

async function handleReportRequest(req: express.Request<{ sessionId: string }>, res: express.Response) {
  const { sessionId } = req.params;
  // Try in-memory first (live session), fall through to SQLite on post-restart requests
  const session = getSession(sessionId);
  if (session) {
    if (!session.report) {
      if (session.status === "abandoned") {
        res.status(500).json({ status: "abandoned", error: "Report generation failed" });
        return;
      }
      res.status(202).json({ status: "generating" });
      return;
    }
    res.json(session.report);
    return;
  }

  // Not in memory — query SQLite
  let dbResult: Awaited<ReturnType<typeof readReportFromDb>>;
  try {
    dbResult = await readReportFromDb(sessionId);
  } catch (err) {
    console.error(`[${sessionId}] readReportFromDb error:`, err);
    res.status(500).json({ status: "abandoned", error: "Report generation failed" });
    return;
  }
  if (!dbResult) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (!dbResult.report) {
    if (dbResult.sessionStatus === "abandoned") {
      res.status(500).json({ status: "abandoned", error: "Report generation failed" });
      return;
    }
    res.status(202).json({ status: "generating" });
    return;
  }
  res.json(dbResult.report);
}

// Legacy path (keep for existing frontend report page)
app.get("/report/:sessionId", handleReportRequest);
// REST path for dashboard
app.get("/api/session/:sessionId/report", handleReportRequest);

app.get("/api/sessions", async (_req, res) => {
  const sessions = await prisma.session.findMany({
    where: { status: "complete" },
    orderBy: { startedAt: "desc" },
    include: { report: { select: { id: true } }, _count: { select: { turns: true } } },
  });

  const sessionList = sessions.map((s) => ({
    id: s.id,
    topicId: s.topicId,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt!.toISOString(),
    durationMinutes: Math.round((s.endedAt!.getTime() - s.startedAt.getTime()) / 60000),
    turnCount: s._count.turns,
    hasReport: !!s.report,
  }));

  const totalSessions = sessionList.length;
  const personasUsed = new Set(sessionList.map((s) => s.topicId)).size;
  const avgDurationMinutes =
    totalSessions > 0
      ? Math.round(sessionList.reduce((sum, s) => sum + s.durationMinutes, 0) / totalSessions)
      : 0;

  res.json({
    sessions: sessionList,
    stats: { totalSessions, personasUsed, avgDurationMinutes },
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket) => {
  console.log("Client connected");

  let currentSessionId: string | null = null;
  let scribeSession: ScribeSession | null = null;

  ws.on("message", async (data: Buffer | string, isBinary: boolean) => {
    // Binary frames are raw PCM16 audio chunks (complete utterance from VAD onSpeechEnd)
    if (isBinary) {
      if (!currentSessionId || !scribeSession) return;
      // Record vadT0 at the moment audio arrives — used for latency_metric on first tts_chunk
      setRuntimeState(currentSessionId, { vadT0: Date.now() });
      scribeSession.transcribe(data as Buffer).catch((err) =>
        console.error("transcribe error:", err)
      );
      return;
    }

    // String frames are JSON control messages
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse((data as Buffer).toString());
    } catch {
      console.warn("Received non-JSON text message, ignoring");
      return;
    }

    const { type } = msg;

    if (type === "session_start") {
      const sessionId = msg.sessionId as string;
      const topicId = msg.topicId as string | undefined;
      const phase = (msg.phase as Phase) ?? "intro";

      try {
        if (!topicId) throw new Error("missing topicId");
        getTopicConfig(topicId);
      } catch {
        ws.close(1008, "unknown topicId");
        return;
      }

      currentSessionId = sessionId;
      createSession(sessionId, topicId, phase);
      setRuntimeState(sessionId, { demo: !!(msg.demo as boolean | undefined) });
      persistSessionCreate(sessionId, topicId, phase).catch((err) =>
        console.error(`[${sessionId}] persistSessionCreate error:`, err)
      );

      scribeSession?.stop();
      scribeSession = new ScribeSession(
        ELEVENLABS_API_KEY,
        (text) => {
          const p = handleTranscript(ws, sessionId, text);
          setRuntimeState(sessionId, { activeTurnPromise: p });
        },
        (opts) => send(ws, { type: "stt_error", reason: opts.reason })
      );
      scribeSession.start();

      // Synthetic greeting trigger — call runTurn directly so no user turn is stored in
      // session.turns. runTurn detects empty turns and primes the LLM with "Hello".
      setRuntimeState(sessionId, { turnInFlight: true });
      const p = runTurn(sessionId, "", ws).finally(() => {
        setRuntimeState(sessionId, { turnInFlight: false });
      });
      setRuntimeState(sessionId, { activeTurnPromise: p });

      console.log(`session_start: ${sessionId}, phase: ${phase}`);
    } else if (type === "session_end") {
      if (!currentSessionId) return;
      const session = getSession(currentSessionId);
      if (!session) return;
      scribeSession?.stop();

      // Await the full in-flight turn (LLM + TTS + session update) so the last assistant turn
      // is stored in session.turns before generateReport reads it.
      // activeTTSChain only covers the TTS portion — activeTurnPromise covers runTurn end-to-end.
      const rt = getRuntimeState(currentSessionId);
      await (rt?.activeTurnPromise ?? Promise.resolve());

      updateSession(currentSessionId, { status: "complete", endedAt: new Date() });
      console.log(`session_end: ${currentSessionId}`);

      const reportId = currentSessionId;
      currentSessionId = null;
      scribeSession = null;

      send(ws, { type: "session_complete", reportId });
      generateReport(reportId).then((report) => {
        if (!report) {
          updateSession(reportId, { status: "abandoned" });
          return;
        }
        updateSession(reportId, { report });
        persistSessionEnd(reportId, report).catch((err) =>
          console.error(`[${reportId}] persistSessionEnd error:`, err)
        );
      });
    } else if (type === "interrupt") {
      if (currentSessionId) {
        const rt = getRuntimeState(currentSessionId);
        const aborts = rt?.activeTTSAborts ?? [];
        setRuntimeState(currentSessionId, { activeTTSAborts: [] });
        aborts.forEach((fn) => fn());
        rt?.activeLLMAbort?.abort();
        rt?.activeChunker?.reset();
        scribeSession?.reset();
        await (rt?.activeTTSChain ?? Promise.resolve());
      }
    } else if (type === "text_input") {
      // Treat identically to a VAD-triggered transcript (spec §5.3, §7 text input fallback)
      if (!currentSessionId) return;
      const content = msg.content as string | undefined;
      if (!content?.trim()) return;
      setRuntimeState(currentSessionId, { vadT0: Date.now() });
      const p = handleTranscript(ws, currentSessionId, content.trim());
      setRuntimeState(currentSessionId, { activeTurnPromise: p });
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    if (currentSessionId) {
      const rt = getRuntimeState(currentSessionId);
      rt?.activeLLMAbort?.abort();
      updateSession(currentSessionId, { status: "abandoned", endedAt: new Date() });
      persistSessionEnd(currentSessionId).catch((err) =>
        console.error(`[${currentSessionId}] persistSessionEnd (abandoned) error:`, err)
      );
      deleteSession(currentSessionId);
      deleteRuntimeState(currentSessionId);
    }
    scribeSession?.stop();
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
});

async function handleTranscript(ws: WebSocket, sessionId: string, text: string) {
  const session = getSession(sessionId);
  if (!session) return;
  const rt = getRuntimeState(sessionId);
  if (rt?.turnInFlight) return;
  setRuntimeState(sessionId, { turnInFlight: true });

  const turn: ConversationTurn = {
    id: uuidv4(),
    sessionId,
    role: "user",
    content: text,
    phase: session.phase,
    timestamp: new Date(),
  };

  updateSession(sessionId, (s) => ({ turns: [...s.turns, turn] }));
  persistTurn(turn).catch((err) =>
    console.error(`[${sessionId}] persistTurn (user) error:`, err)
  );
  send(ws, { type: "transcript", text, role: "user" });
  console.log(`[${sessionId}] user: ${text}`);

  try {
    await runTurn(sessionId, text, ws);
  } catch (err) {
    console.error("runTurn error:", err);
  } finally {
    setRuntimeState(sessionId, { turnInFlight: false });
  }
}

async function bootstrap(): Promise<void> {
  await runMigrations();
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});

export { server };
