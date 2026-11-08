import { randomUUID } from "node:crypto";
import type http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { createAuthenticator } from "./auth";
import type { Config } from "./config";
import { EPHEMERAL_PERSIST } from "./ephemeralPersist";
import { errName } from "./errors";
import { DESIGNER_ID } from "./interviewer/presets";
import type { InterviewerDefinition } from "./interviewer/schema";
import type * as interviewerStore from "./interviewerStore";
import type * as persistence from "./persistence";
import type { Providers } from "./providers/types";
import { SessionController, type EndedStatus } from "./sessionController";
import * as registry from "./sessionRegistry";
import { staticSettings, type SettingsSource } from "./settingsService";
import {
  FAILED_REASON,
  MAX_TEXT_INPUT_BYTES,
  UNKNOWN_INTERVIEWER,
  parseMessage,
  rejectUpgrade,
  safeType,
  startTargetOf,
  toBuffer,
  trialInterviewer,
  type StartTarget,
} from "./wsMessages";
import { send } from "./wsUtils";

export interface WsServerDeps {
  server: http.Server;
  config: Config;
  providers: Providers;
  persist: typeof persistence;
  interviewers: typeof interviewerStore;
  authenticate: ReturnType<typeof createAuthenticator>;
  /** Given to every session (interview, designer and trial). Defaults to staticSettings(). */
  settings?: SettingsSource;
}

export interface WsServer {
  /**
   * Refuses new sessions, waits for starts in flight, abandons live sessions and waits for
   * them to settle, then terminates every socket and closes the WebSocket server. The HTTP
   * server is left to the caller.
   */
  close(): Promise<void>;
}

/** The single WebSocket endpoint, attached to the server's upgrade event. */
export function attachWebSocket(deps: WsServerDeps): WsServer {
  const { server, config, providers, persist, interviewers, authenticate } = deps;
  const settings = deps.settings ?? staticSettings();

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
          settings,
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
    async close() {
      shuttingDown = true;
      await Promise.all([...starting]);
      const controllers = [...live];
      for (const c of controllers) c.abandon();
      await Promise.all(controllers.map((c) => c.settled()));
      for (const c of controllers) registry.detach(c.sessionId);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
