import { randomUUID } from "node:crypto";
import http from "node:http";
import type { Duplex } from "node:stream";
import cors from "cors";
import express from "express";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { createAuthenticator } from "./auth";
import type { Config } from "./config";
import prisma from "./db";
import { withDeadline } from "./deadline";
import { errName } from "./errors";
import { ownerOf, route } from "./httpUtil";
import { createInterviewerRouter, type InterviewerRouterDeps } from "./interviewerRoutes";
import { EPHEMERAL_PERSIST } from "./ephemeralPersist";
import { generateDraft } from "./interviewer/designer";
import { DESIGNER_ID } from "./interviewer/presets";
import { ID_SHAPE, parseInterviewerInput, type InterviewerDefinition, type InterviewerInput } from "./interviewer/schema";
import * as interviewerStore from "./interviewerStore";
import * as persistence from "./persistence";
import type { Providers } from "./providers/types";
import { generateReport } from "./reportGenerator";
import { SessionController, type EndedStatus } from "./sessionController";
import * as registry from "./sessionRegistry";
import type { AnyReport, ConversationTurn, ReportV2 } from "./types";
import { send } from "./wsUtils";

export interface AppDeps {
  config: Config;
  providers: Providers;
  persist?: typeof persistence;
  interviewers?: typeof interviewerStore;
}

export interface App {
  server: http.Server;
  /** Ends live sessions as abandoned, closes every socket and stops the server. */
  close(): Promise<void>;
}

/** Fixed text sent with session_failed: never model output or transcript text. */
const FAILED_REASON = "report generation failed";

/** Largest accepted text_input content, in UTF-8 bytes; larger gets stt_error too_long. */
const MAX_TEXT_INPUT_BYTES = 8192;

const STATUS_TEXT: Record<number, string> = { 401: "Unauthorized", 403: "Forbidden" };

/** Client message types we name in logs; anything else is logged as "unknown". */
const KNOWN_TYPES = new Set(["session_start", "session_end", "interrupt", "text_input", "turn_timing"]);

type ClientMessage = { type: string; [key: string]: unknown };

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

/** Cheap shape check only; whether the id exists for this owner is decided by the lookup. */
function isInterviewerIdShape(id: unknown): id is string {
  return typeof id === "string" && ID_SHAPE.test(id);
}

/** Close reason for every bad interviewerId: malformed, unknown or another owner's. */
const UNKNOWN_INTERVIEWER = "unknown interviewerId";

/** Close reason for every bad draft (and for a draft sent with an interviewerId). Never echoes it. */
const INVALID_DRAFT = "invalid draft";

/**
 * What a session_start asks to run. "stored" and "designer" are looked up by id (the designer
 * is a hidden preset); "trial" runs an inline, already validated draft. Only "stored" is persisted.
 */
type StartTarget =
  | { kind: "stored"; interviewerId: string }
  | { kind: "designer" }
  | { kind: "trial"; draft: InterviewerInput };

const has = (msg: ClientMessage, key: string) => Object.prototype.hasOwnProperty.call(msg, key);

/**
 * Exactly one of interviewerId and draft. A message carrying `draft` is a trial and every problem
 * with it (wrong type, failed validation, an interviewerId as well) is INVALID_DRAFT; otherwise the
 * interviewerId shape check applies. No database access, so it runs before the session counter.
 */
function startTargetOf(msg: ClientMessage): StartTarget | { reject: string } {
  if (has(msg, "draft")) {
    const { draft } = msg;
    if (has(msg, "interviewerId") || typeof draft !== "object" || draft === null || Array.isArray(draft)) {
      return { reject: INVALID_DRAFT };
    }
    const parsed = parseInterviewerInput(draft);
    return parsed.ok ? { kind: "trial", draft: parsed.value } : { reject: INVALID_DRAFT };
  }
  if (!isInterviewerIdShape(msg.interviewerId)) return { reject: UNKNOWN_INTERVIEWER };
  return msg.interviewerId === DESIGNER_ID
    ? { kind: "designer" }
    : { kind: "stored", interviewerId: msg.interviewerId };
}

/** A trial's in-memory interviewer: never stored, owned by the caller. */
function trialInterviewer(draft: InterviewerInput, ownerId: string): InterviewerDefinition {
  const now = new Date().toISOString();
  return { ...draft, id: "draft", source: "custom", ownerId, version: 1, createdAt: now, updatedAt: now };
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


/** One body for unknown, foreign and malformed sessions, so none can be told apart. */
const NOT_FOUND = { error: "Session not found" } as const;
const GENERATION_FAILED = "Report generation failed";

/** The report JSON served by GET and by regenerate: the report plus interviewerName. */
function reportBody(report: AnyReport, interviewerName: string | null) {
  return { ...report, interviewerName };
}

/** 409 for every reason a regenerate is refused; the reason is logged, never sent. */
function refuseRegenerate(res: express.Response, sessionId: string, why: string): void {
  console.warn(`[http] regenerate ${sessionId} 409: ${why}`);
  res.status(409).json({ error: "report cannot be regenerated" });
}

/**
 * The one-box draft maker behind POST /api/interviewers/draft. One draft per owner at a time
 * (an in-memory set, taken before the first await and released in finally); the call is bounded
 * by limits.reportTimeoutMs. A DraftError, a provider error or a timeout is 502; the cause is
 * logged by class name only, never the description or the draft.
 */
export function createDraftMaker(
  config: Config,
  llm: Providers["llm"],
): InterviewerRouterDeps["makeDraft"] {
  const drafting = new Set<string>();
  return async (ownerId, text) => {
    if (drafting.has(ownerId)) return { ok: false, status: 429 };
    drafting.add(ownerId);
    try {
      const outcome = await withDeadline(config.limits.reportTimeoutMs, (signal) =>
        generateDraft({ kind: "description", text }, llm, signal),
      );
      if (!outcome.ok) {
        console.error(`[http] draft interviewer 502: ${outcome.why}`);
        return { ok: false, status: 502 };
      }
      return { ok: true, draft: outcome.value };
    } finally {
      drafting.delete(ownerId);
    }
  };
}

export function createApp(deps: AppDeps): App {
  const { config, providers } = deps;
  const persist = deps.persist ?? persistence;
  const interviewers = deps.interviewers ?? interviewerStore;
  const authenticate = createAuthenticator(config);

  // ── HTTP ───────────────────────────────────────────────────────────────────

  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: config.allowedOrigins }));
  // Every route is behind the authenticator. CORS preflight (OPTIONS) is answered by cors()
  // above before this runs, which is correct: browsers send no credentials on preflight.
  // Never log req.url: it can carry ?token=.
  app.use((req, res, next) => {
    const result = authenticate(req);
    if (!result.ok) {
      res.status(result.status).json({ error: result.reason });
      return;
    }
    res.locals.ownerId = result.ownerId;
    next();
  });

  app.use(
    "/api/interviewers",
    createInterviewerRouter({ store: interviewers, ownerOf, makeDraft: createDraftMaker(config, providers.llm) }),
  );

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

  /**
   * What regenerate needs, for a session owned by ownerId: its stored turns (with metrics)
   * when there is at least one user turn, and a valid snapshot. Null when either is missing.
   */
  async function regenerateInputs(
    sessionId: string,
    ownerId: string,
  ): Promise<{ turns: ConversationTurn[]; interviewer: InterviewerDefinition } | null> {
    const [turns, interviewer] = await Promise.all([
      persist.readTurnsFromDb(sessionId, ownerId),
      persist.readSnapshot(sessionId, ownerId),
    ]);
    if (!turns || !turns.some((t) => t.role === "user") || !interviewer) return null;
    return { turns, interviewer };
  }

  const reportHandler = route("report", async (req, res) => {
    const { sessionId } = req.params;
    const ownerId = ownerOf(res);
    const found = await persist.readReportFromDb(sessionId, ownerId);
    if (!found) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    if (found.sessionStatus === "active") {
      res.status(202).json({ status: "generating" });
      return;
    }
    if (found.sessionStatus === "complete") {
      if (found.report) res.json(reportBody(found.report, found.interviewerName));
      else res.status(500).json({ status: "unreadable", error: "The report could not be read" });
      return;
    }
    if (found.sessionStatus === "abandoned") {
      res.status(500).json({ status: "abandoned", error: GENERATION_FAILED });
      return;
    }
    const canRegenerate = (await regenerateInputs(sessionId, ownerId)) !== null;
    res.status(500).json({ status: "failed", error: GENERATION_FAILED, canRegenerate });
  });
  // Legacy path used by the report page, and the REST path used by the dashboard.
  app.get("/report/:sessionId", reportHandler);
  app.get("/api/session/:sessionId/report", reportHandler);

  /** Owner-scoped keys (owner, session) of regenerations in flight in this process. */
  const regenerating = new Set<string>();

  app.post(
    "/api/session/:sessionId/report/regenerate",
    route("regenerate", async (req, res) => {
      const { sessionId } = req.params;
      const ownerId = ownerOf(res);
      if (!ID_SHAPE.test(sessionId)) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      // Taken before the first await, so of two concurrent requests only one can hold it. The
      // key includes the owner: another owner's request never touches this session's lock, and
      // a held lock is reported only after the ownership check, so it reveals nothing.
      const key = `${ownerId}\u0000${sessionId}`;
      const held = regenerating.has(key);
      if (!held) regenerating.add(key);
      try {
        const found = await persist.readReportFromDb(sessionId, ownerId);
        if (!found) {
          res.status(404).json(NOT_FOUND);
          return;
        }
        if (held || found.sessionStatus !== "failed") {
          refuseRegenerate(res, sessionId, held ? "in flight" : "not failed");
          return;
        }
        const inputs = await regenerateInputs(sessionId, ownerId);
        if (!inputs) {
          refuseRegenerate(res, sessionId, "no user turns or snapshot");
          return;
        }

        const outcome = await generateWithDeadline(inputs.turns, inputs.interviewer);
        if (!outcome.ok) {
          console.error(`[http] regenerate ${sessionId} 502: ${outcome.why}`);
          res.status(502).json({ status: "failed", error: GENERATION_FAILED });
          return;
        }
        if (!(await persist.completeFailedSession(sessionId, ownerId, outcome.report))) {
          refuseRegenerate(res, sessionId, "no longer failed");
          return;
        }
        console.log(`[http] regenerate ${sessionId} 200`);
        res.json(reportBody(outcome.report, found.interviewerName));
      } finally {
        if (!held) regenerating.delete(key);
      }
    }),
  );

  /**
   * Runs the report call bounded by limits.reportTimeoutMs, as SessionController.finish()
   * does: an unref'd timer races the work and aborts it. The deadline does not rely on the
   * provider honouring the abort; a late result is dropped here and never written.
   */
  async function generateWithDeadline(
    turns: ConversationTurn[],
    interviewer: InterviewerDefinition,
  ): Promise<{ ok: true; report: ReportV2 } | { ok: false; why: string }> {
    const outcome = await withDeadline(config.limits.reportTimeoutMs, (signal) =>
      generateReport(turns, interviewer, providers.llm, signal, {
        showFillerCounts: config.reportFillerCounts,
      }),
    );
    return outcome.ok ? { ok: true, report: outcome.value } : outcome;
  }

  app.delete(
    "/api/session/:sessionId",
    route("delete-session", async (req, res) => {
      const { sessionId } = req.params;
      const ownerId = ownerOf(res);
      // Only the owner's own live session is reported as active; a foreign one is a plain 404.
      if (registry.get(sessionId)?.ownerId === ownerId) {
        res.status(409).json({ error: "session is active" });
        return;
      }
      const deleted = await persist.deleteSessionFromDb(sessionId, ownerId);
      if (!deleted) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      console.log(`[http] deleted session ${sessionId} (204)`);
      res.status(204).end();
    }),
  );

  app.get(
    "/api/sessions",
    route("sessions", async (_req, res) => {
      const rows = await persist.listSessionsFromDb(ownerOf(res));
      const sessions = rows.map((s) => {
        const endedAt = s.endedAt ?? s.startedAt;
        return {
          id: s.id,
          interviewerId: s.interviewerId,
          interviewerName: s.interviewerName,
          startedAt: s.startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMinutes: Math.round((endedAt.getTime() - s.startedAt.getTime()) / 60000),
          turnCount: s.turnCount,
          hasReport: s.hasReport,
        };
      });
      const totalSessions = sessions.length;
      const personasUsed = new Set(sessions.map((s) => s.interviewerId)).size;
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

    const begin = (target: StartTarget, demo: boolean): Promise<SessionController | null> => {
      // Counted synchronously, before any await, so concurrent starts cannot pass the cap.
      pendingByOwner.set(ownerId, (pendingByOwner.get(ownerId) ?? 0) + 1);
      const release = () => {
        const n = (pendingByOwner.get(ownerId) ?? 1) - 1;
        if (n > 0) pendingByOwner.set(ownerId, n);
        else pendingByOwner.delete(ownerId);
      };
      // Designer and trial sessions are ephemeral: no Session, turn, phase or report row is ever
      // written for them, so they never reach /api/sessions or the report routes.
      const ephemeral = target.kind !== "stored";

      return (async () => {
        // A preset for anyone, a custom interviewer only for its owner. The definition returned
        // is already validated and becomes the session's snapshot. A trial's draft was validated
        // by startTargetOf and is never stored.
        let interviewer: InterviewerDefinition | null;
        try {
          interviewer =
            target.kind === "trial"
              ? trialInterviewer(target.draft, ownerId)
              : await interviewers.getInterviewer(
                  target.kind === "designer" ? DESIGNER_ID : target.interviewerId,
                  ownerId,
                );
        } catch (err) {
          release();
          console.error(`[ws] interviewer lookup failed: ${errName(err)}`);
          reject(1011, "internal error", "interviewer lookup failed");
          return null;
        }
        if (!interviewer) {
          release();
          // Not found and not visible are answered identically; the client's id is not logged.
          reject(1008, UNKNOWN_INTERVIEWER, UNKNOWN_INTERVIEWER);
          return null;
        }
        if (ws.readyState !== WebSocket.OPEN || shuttingDown) {
          release();
          stage = "ended";
          console.log("[ws] socket closed before start: nothing created");
          return null;
        }

        const id = randomUUID();
        sessionId = id;
        // Only a stored session has a row, so only it awaits here and can need an abandon write.
        if (!ephemeral) {
          try {
            await persist.persistSessionCreate(id, ownerId, interviewer);
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
        }
        const c: SessionController = new SessionController({
          kind: target.kind === "stored" ? "interview" : target.kind,
          sessionId: id,
          ownerId,
          interviewer,
          demo,
          providers,
          config,
          sendJson: (msg) => {
            if (msg.type !== "tts_chunk") send(ws, msg);
          },
          sendAudio: (chunk) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(chunk));
          },
          persist: ephemeral
            ? EPHEMERAL_PERSIST
            : {
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
        // The id is a preset slug or a server UUID; interviewer and draft text never reach the logs.
        const demoTag = demo ? " (demo)" : "";
        console.log(
          target.kind === "designer"
            ? `${tag()} started designer${demoTag}`
            : target.kind === "trial"
              ? `${tag()} started draft interviewer (${interviewer.phases.length} phases)${demoTag} (trial)`
              : `${tag()} started interviewer ${interviewer.id} (${interviewer.phases.length} phases)${demoTag}`,
        );
        void c.start();
        return c;
      })();
    };

    const onMessage = async (data: RawData, isBinary: boolean): Promise<void> => {
      if (stage === "ended") return;
      const buf = toBuffer(data);

      // Binary frames (audio) are bounded by ws maxPayload; JSON text frames get a tighter
      // cap. A live session is abandoned by onGone once the close completes.
      if (!isBinary && buf.length > config.limits.maxTextFrameBytes) {
        console.warn(`${tag()} closing 1009: text frame of ${buf.length} bytes`);
        if (stage === "awaiting") stage = "ended";
        closeWs(1009, "message too large");
        return;
      }

      if (stage === "awaiting") {
        const msg = isBinary ? null : parseMessage(buf);
        if (!msg || msg.type !== "session_start") {
          const what = isBinary ? "binary frame" : msg ? `message ${safeType(msg.type)}` : "malformed frame";
          reject(1008, "session_start required", `${what} before session_start`);
          return;
        }
        // Shape and draft validation only (no database): checked before the session counter is
        // touched. The fixed reason is logged, never the id or the draft.
        const target = startTargetOf(msg);
        if ("reject" in target) {
          reject(1008, target.reject, target.reject);
          return;
        }
        const max = config.limits.maxConcurrentSessionsPerOwner;
        if (registry.countForOwner(ownerId) + (pendingByOwner.get(ownerId) ?? 0) >= max) {
          reject(1013, "too many sessions", "concurrent session limit reached");
          return;
        }
        stage = "starting";
        const p = begin(target, msg.demo === true);
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
          if (typeof msg.content !== "string") return;
          if (Buffer.byteLength(msg.content) > MAX_TEXT_INPUT_BYTES) {
            console.warn(`${tag()} text_input over ${MAX_TEXT_INPUT_BYTES} bytes ignored`);
            send(ws, { type: "stt_error", reason: "too_long" });
            return;
          }
          if (!msg.content.trim()) return;
          console.log(`${tag()} text_input ${Buffer.byteLength(msg.content)} bytes`);
          c.handleText(msg.content);
          return;
        case "turn_timing":
          // Validated by the controller (invalid values are ignored). Not logged: the gap is
          // a delivery measure of the participant and never reaches the logs.
          c.noteResponseGap(msg.responseGapMs);
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
