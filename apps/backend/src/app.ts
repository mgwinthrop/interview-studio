import { randomUUID } from "node:crypto";
import http from "node:http";
import type { Duplex } from "node:stream";
import cors from "cors";
import express from "express";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { createAuthenticator } from "./auth";
import type { Config } from "./config";
import prisma from "./db";
import * as persistence from "./persistence";
import type { Providers } from "./providers/types";
import { SessionController, type EndedStatus } from "./sessionController";
import * as registry from "./sessionRegistry";
import { getTopicConfig } from "./topic";
import { send } from "./wsUtils";

export interface AppDeps {
  config: Config;
  providers: Providers;
  persist?: typeof persistence;
}

export interface App {
  server: http.Server;
  /** Ends live sessions as abandoned, closes every socket and stops the server. */
  close(): Promise<void>;
}

/** Fixed text sent with session_failed: never model output or transcript text. */
const FAILED_REASON = "report generation failed";

const STATUS_TEXT: Record<number, string> = { 401: "Unauthorized", 403: "Forbidden" };

/** Client message types we name in logs; anything else is logged as "unknown". */
const KNOWN_TYPES = new Set(["session_start", "session_end", "interrupt", "text_input"]);

type ClientMessage = { type: string; [key: string]: unknown };

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function safeType(type: unknown): string {
  return typeof type === "string" && KNOWN_TYPES.has(type) ? type : "unknown";
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function parseMessage(buf: Buffer): ClientMessage | null {
  try {
    const value: unknown = JSON.parse(buf.toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    if (typeof (value as { type?: unknown }).type !== "string") return null;
    return value as ClientMessage;
  } catch {
    return null;
  }
}

function isKnownTopic(topicId: unknown): topicId is string {
  if (typeof topicId !== "string") return false;
  try {
    getTopicConfig(topicId);
    return true;
  } catch {
    return false;
  }
}

/** Writes a plain HTTP error on a socket that has not been upgraded, then destroys it. */
function rejectUpgrade(socket: Duplex, status: number): void {
  const body = STATUS_TEXT[status] ?? "Error";
  socket.once("finish", () => socket.destroy());
  socket.end(
    `HTTP/1.1 ${status} ${body}\r\nConnection: close\r\nContent-Type: text/plain\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

type Handler = (req: express.Request<{ sessionId: string }>, res: express.Response) => Promise<void>;

/** Express 4 does not catch rejected handlers: log the error class and answer 500. */
function route(name: string, fn: Handler): Handler {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`[http] ${name} error: ${errName(err)}`);
      if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    }
  };
}

function ownerOf(res: express.Response): string {
  return res.locals.ownerId as string;
}

export function createApp(deps: AppDeps): App {
  const { config, providers } = deps;
  const persist = deps.persist ?? persistence;
  const authenticate = createAuthenticator(config);

  // ── HTTP ───────────────────────────────────────────────────────────────────

  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: config.allowedOrigins }));
  // Every route is behind the authenticator. Never log req.url: it can carry ?token=.
  app.use((req, res, next) => {
    const result = authenticate(req);
    if (!result.ok) {
      res.status(result.status).json({ error: result.reason });
      return;
    }
    res.locals.ownerId = result.ownerId;
    next();
  });

  app.get(
    "/health",
    route("health", async (_req, res) => {
      let database = false;
      try {
        await prisma.$queryRaw`SELECT 1`;
        database = true;
      } catch (err) {
        console.error(`[http] health database check failed: ${errName(err)}`);
      }
      res.status(database ? 200 : 503).json({
        status: database ? "ok" : "degraded",
        database,
        providers: { profile: config.profile },
      });
    }),
  );

  app.get(
    "/api/session/:sessionId/transcript",
    route("transcript", async (req, res) => {
      const { sessionId } = req.params;
      const turns = await persist.readTurnsFromDb(sessionId, ownerOf(res));
      if (!turns) {
        res.status(404).json({ error: "Session not found or has no turns" });
        return;
      }
      const text = turns
        .map((t) => `${t.role === "user" ? "Participant" : "Interviewer"}: ${t.content}`)
        .join("\n\n");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="transcript-${sessionId}.txt"`);
      res.send(text);
    }),
  );

  const reportHandler = route("report", async (req, res) => {
    const found = await persist.readReportFromDb(req.params.sessionId, ownerOf(res));
    if (!found) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (found.sessionStatus === "active") {
      res.status(202).json({ status: "generating" });
      return;
    }
    if (found.sessionStatus === "complete" && found.report) {
      res.json(found.report);
      return;
    }
    const status = found.sessionStatus === "abandoned" ? "abandoned" : "failed";
    res.status(500).json({ status, error: "Report generation failed" });
  });
  // Legacy path used by the report page, and the REST path used by the dashboard.
  app.get("/report/:sessionId", reportHandler);
  app.get("/api/session/:sessionId/report", reportHandler);

  app.get(
    "/api/sessions",
    route("sessions", async (_req, res) => {
      const rows = await persist.listSessionsFromDb(ownerOf(res));
      const sessions = rows.map((s) => {
        const endedAt = s.endedAt ?? s.startedAt;
        return {
          id: s.id,
          topicId: s.topicId,
          startedAt: s.startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMinutes: Math.round((endedAt.getTime() - s.startedAt.getTime()) / 60000),
          turnCount: s.turnCount,
          hasReport: s.hasReport,
        };
      });
      const totalSessions = sessions.length;
      const personasUsed = new Set(sessions.map((s) => s.topicId)).size;
      const avgDurationMinutes =
        totalSessions > 0
          ? Math.round(sessions.reduce((sum, s) => sum + s.durationMinutes, 0) / totalSessions)
          : 0;
      res.json({ sessions, stats: { totalSessions, personasUsed, avgDurationMinutes } });
    }),
  );

  const server = http.createServer(app);

  // ── WebSocket ──────────────────────────────────────────────────────────────

  const wss = new WebSocketServer({ noServer: true, maxPayload: config.limits.maxPayloadBytes });
  /** Controllers created by this app that have not reported onEnded yet. */
  const live = new Set<SessionController>();
  /** Session creations in flight, counted against the owner's cap until they attach. */
  const pendingByOwner = new Map<string, number>();
  const starting = new Set<Promise<unknown>>();
  let shuttingDown = false;

  server.on("upgrade", (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => {});
    const result = authenticate(req);
    if (!result.ok || shuttingDown) {
      const status = result.ok ? 403 : result.status;
      console.warn(`[ws] upgrade refused ${status}${result.ok ? "" : `: ${result.reason}`}`);
      rejectUpgrade(socket, status);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, result.ownerId));
  });

  function handleConnection(ws: WebSocket, ownerId: string): void {
    let stage: "awaiting" | "starting" | "live" | "ended" = "awaiting";
    let sessionId: string | null = null;
    let controller: SessionController | null = null;
    let ready: Promise<SessionController | null> | null = null;
    let endRequested = false;
    const tag = () => (sessionId ? `[session ${sessionId}]` : "[ws]");
    const ended = () => stage === "ended";

    const closeWs = (code: number, reason: string) => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(code, reason);
      }
    };

    const reject = (code: number, reason: string, why: string) => {
      stage = "ended";
      console.warn(`[ws] closing ${code}: ${why}`);
      closeWs(code, reason);
    };

    const onEnded = (c: SessionController, status: EndedStatus) => {
      stage = "ended";
      live.delete(c);
      registry.detach(c.sessionId);
      console.log(`[session ${c.sessionId}] ended ${status}`);
      if (status === "complete") {
        send(ws, { type: "session_complete", reportId: c.sessionId });
        closeWs(1000, "session complete");
      } else if (status === "failed") {
        send(ws, { type: "session_failed", reason: FAILED_REASON });
        closeWs(1000, "session failed");
      } else {
        closeWs(1001, shuttingDown ? "server shutdown" : "idle timeout");
      }
    };

    const begin = (topicId: string, demo: boolean): Promise<SessionController | null> => {
      const id = randomUUID();
      sessionId = id;
      pendingByOwner.set(ownerId, (pendingByOwner.get(ownerId) ?? 0) + 1);
      const release = () => {
        const n = (pendingByOwner.get(ownerId) ?? 1) - 1;
        if (n > 0) pendingByOwner.set(ownerId, n);
        else pendingByOwner.delete(ownerId);
      };

      return (async () => {
        try {
          await persist.persistSessionCreate(id, ownerId, topicId, "intro");
        } catch (err) {
          release();
          console.error(`${tag()} persistSessionCreate failed: ${errName(err)}`);
          reject(1011, "internal error", "session could not be created");
          return null;
        }
        if (ws.readyState !== WebSocket.OPEN || shuttingDown) {
          release();
          stage = "ended";
          await persist.persistSessionStatus(id, "abandoned").catch((err: unknown) => {
            console.error(`${tag()} persistSessionStatus error: ${errName(err)}`);
          });
          console.log(`${tag()} socket closed before start: abandoned`);
          return null;
        }
        const c: SessionController = new SessionController({
          sessionId: id,
          ownerId,
          topicId,
          demo,
          providers,
          config,
          sendJson: (msg) => {
            if (msg.type !== "tts_chunk") send(ws, msg);
          },
          sendAudio: (chunk) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(chunk));
          },
          persist: {
            persistTurn: persist.persistTurn,
            persistPhaseTransition: persist.persistPhaseTransition,
            persistSessionStatus: persist.persistSessionStatus,
            persistReport: persist.persistReport,
          },
          onEnded: (status) => onEnded(c, status),
        });
        try {
          registry.attach(c);
        } catch (err) {
          release();
          console.error(`${tag()} attach failed: ${errName(err)}`);
          reject(1011, "internal error", "session could not be attached");
          return null;
        }
        release();
        live.add(c);
        controller = c;
        stage = "live";
        send(ws, { type: "session_started", sessionId: id });
        console.log(`${tag()} started topic ${topicId}${demo ? " (demo)" : ""}`);
        void c.start();
        return c;
      })();
    };

    const onMessage = async (data: RawData, isBinary: boolean): Promise<void> => {
      if (stage === "ended") return;
      const buf = toBuffer(data);

      if (stage === "awaiting") {
        const msg = isBinary ? null : parseMessage(buf);
        if (!msg || msg.type !== "session_start") {
          const what = isBinary ? "binary frame" : msg ? `message ${safeType(msg.type)}` : "malformed frame";
          reject(1008, "session_start required", `${what} before session_start`);
          return;
        }
        if (!isKnownTopic(msg.topicId)) {
          reject(1008, "unknown topicId", "unknown topicId");
          return;
        }
        const max = config.limits.maxConcurrentSessionsPerOwner;
        if (registry.countForOwner(ownerId) + (pendingByOwner.get(ownerId) ?? 0) >= max) {
          reject(1013, "too many sessions", "concurrent session limit reached");
          return;
        }
        stage = "starting";
        const p = begin(msg.topicId, msg.demo === true);
        ready = p;
        starting.add(p);
        void p.finally(() => starting.delete(p));
        return;
      }

      const c = controller ?? (await ready);
      // Re-read after the await: the session may have ended meanwhile.
      if (!c || ended()) return;

      if (isBinary) {
        console.log(`${tag()} audio ${buf.length} bytes`);
        c.handleAudio(buf);
        return;
      }

      const msg = parseMessage(buf);
      if (!msg) {
        console.warn(`${tag()} ignored malformed frame (${buf.length} bytes)`);
        return;
      }
      switch (msg.type) {
        case "session_start":
          console.warn(`${tag()} ignored second session_start`);
          return;
        case "text_input":
          if (typeof msg.content !== "string" || !msg.content.trim()) return;
          console.log(`${tag()} text_input ${Buffer.byteLength(msg.content)} bytes`);
          c.handleText(msg.content);
          return;
        case "interrupt":
          console.log(`${tag()} interrupt`);
          await c.interrupt();
          return;
        case "session_end":
          console.log(`${tag()} session_end`);
          endRequested = true;
          void c.end();
          return;
        default:
          console.warn(`${tag()} ignored message type ${safeType(msg.type)}`);
      }
    };

    /** Socket gone: abandon a live session unless the client already asked to end it. */
    const onGone = () => {
      const c = controller;
      if (!c || stage === "ended") return;
      // After session_end the report is still generated; onEnded detaches the session.
      if (endRequested) return;
      c.abandon();
      registry.detach(c.sessionId);
    };

    ws.on("message", (data, isBinary) => {
      onMessage(data, isBinary).catch((err: unknown) => {
        console.error(`${tag()} message handler error: ${errName(err)}`);
      });
    });
    ws.on("error", (err) => {
      const code = (err as { code?: unknown }).code;
      console.warn(`${tag()} socket error: ${errName(err)}${typeof code === "string" ? ` ${code}` : ""}`);
      onGone();
    });
    ws.on("close", (code) => {
      console.log(`${tag()} closed ${code}`);
      onGone();
    });
  }

  return {
    server,
    async close() {
      shuttingDown = true;
      await Promise.all([...starting]);
      const controllers = [...live];
      for (const c of controllers) c.abandon();
      await Promise.all(controllers.map((c) => c.settled()));
      for (const c of controllers) registry.detach(c.sessionId);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err && (err as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(err);
          else resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}
