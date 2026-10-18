import { randomUUID } from "crypto";
import type { Config } from "./config";
import type * as Persistence from "./persistence";
import type { Providers } from "./providers/types";
import type { InterviewerDefinition } from "./interviewer/schema";
import { advancePhase, buildTurnRequest, type TurnSession } from "./orchestrator";
import { generateReport } from "./reportGenerator";
import { SentenceChunker } from "./sentenceChunker";
import type { ConversationTurn, ServerToClientMessage } from "./types";

export type ControllerState = "idle" | "listening" | "thinking" | "speaking";
export type EndedStatus = "complete" | "failed" | "abandoned";

export interface ControllerDeps {
  sessionId: string;
  ownerId: string;
  /** The session's snapshot: fixed for the life of the session. */
  interviewer: InterviewerDefinition;
  demo: boolean;
  providers: Providers;
  config: Config;
  sendJson(msg: ServerToClientMessage): void;
  sendAudio(chunk: Uint8Array): void;
  persist: Pick<
    typeof Persistence,
    "persistTurn" | "persistPhaseTransition" | "persistSessionStatus" | "persistReport"
  >;
  /**
   * Fires exactly once when the session reaches a terminal state by any path (end(), the
   * turn-limit auto-end, idle timeout, abandon()), after the status write was attempted,
   * with the status actually reached. Errors it throws are logged, never rethrown.
   */
  onEnded?(status: EndedStatus): void;
}

/** A user utterance waiting for its turn. receivedAt is the latency_metric origin. */
type Utterance =
  | { kind: "text"; text: string; receivedAt: number }
  | { kind: "audio"; pcm: Buffer; receivedAt: number };
type Item = Utterance | { kind: "greeting" };

/** The in-flight item. interrupted is set by interrupt()/abandon() before they abort. */
interface TurnCtx {
  abort: AbortController;
  interrupted: boolean;
}

const QUEUE_CAP = 5;
/** Locked decision: conversational replies use max_tokens 300. */
const MAX_TOKENS = 300;

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/**
 * One controller per live session. It owns the turn history and runs one item (greeting
 * or user utterance) at a time; utterances that arrive meanwhile wait in a FIFO queue.
 * Each item gets one AbortController covering STT, LLM and TTS, so interrupt and abandon
 * cancel everything in flight with a single abort.
 */
export class SessionController {
  readonly sessionId: string;
  readonly ownerId: string;

  private _state: ControllerState = "idle";
  /** Index into interviewer.phases; phases advance on per-phase user-turn counts. */
  private phaseIndex = 0;
  /** User turns stored since the current phase began. */
  private phaseUserTurns = 0;
  private readonly _turns: ConversationTurn[] = [];
  private readonly queue: Utterance[] = [];
  private readonly writes = new Set<Promise<void>>();

  private active: Promise<void> | null = null;
  private turn: TurnCtx | null = null;
  private chunker: SentenceChunker | null = null;
  private reportAbort: AbortController | null = null;
  private ending: Promise<"complete" | "failed"> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  private started = false;
  /** No new input is accepted: end() has begun or abandon() was called. */
  private closed = false;
  private abandoned = false;
  private finished = false;
  private endedReported = false;

  constructor(private readonly deps: ControllerDeps) {
    this.sessionId = deps.sessionId;
    this.ownerId = deps.ownerId;
  }

  get state(): ControllerState {
    return this._state;
  }

  /** The current phase's name. */
  get phase(): string {
    return this.deps.interviewer.phases[this.phaseIndex].name;
  }

  get turns(): readonly ConversationTurn[] {
    return this._turns;
  }

  /** Runs the greeting turn. Resolves when the greeting has finished (or was interrupted). */
  start(): Promise<void> {
    if (this.started || this.closed) return Promise.resolve();
    this.started = true;
    this.touch();
    return this.run({ kind: "greeting" });
  }

  handleAudio(pcm: Buffer): void {
    this.enqueue({ kind: "audio", pcm, receivedAt: Date.now() });
  }

  handleText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.enqueue({ kind: "text", text: trimmed, receivedAt: Date.now() });
  }

  /** Cancels the current item and anything queued. Safe in any state. */
  async interrupt(): Promise<void> {
    if (this.closed) return;
    this.touch();
    this.queue.length = 0;
    this.cancelTurn();
    const current = this.active;
    if (current) await current;
    if (this.started && !this.active) this.setState("listening");
  }

  /**
   * Ends the session: cancels the in-flight reply exactly as interrupt() does (an aborted
   * reply is neither finalised nor stored, so nothing more is synthesised or sent for it),
   * waits for that turn to settle, then generates and stores the report from the turns
   * already committed. Idempotent. Utterances still queued are dropped deliberately: the
   * session is over, and the outcome reaches the transport through onEnded.
   */
  end(): Promise<"complete" | "failed"> {
    if (this.ending) return this.ending;
    if (this.closed) return Promise.resolve("failed");
    this.closed = true;
    this.clearIdle();
    this.queue.length = 0;
    this.cancelTurn();
    this.ending = this.finish();
    return this.ending;
  }

  /** Aborts everything and marks the session abandoned. Idempotent; no-op once ended. */
  abandon(): void {
    if (this.abandoned || this.finished) return;
    this.abandoned = true;
    this.closed = true;
    this.clearIdle();
    this.queue.length = 0;
    this.cancelTurn();
    this.reportAbort?.abort();
    this._state = "idle";
    const ending = this.ending;
    const written = this.deps.persist.persistSessionStatus(this.sessionId, "abandoned").then(
      (ok) => ok,
      (err) => {
        this.log("persistSessionStatus error", err);
        return false;
      },
    );
    // If end() got its status in first, the session ended the way end() reports. This
    // chain awaits end(), so it is not tracked (finish() awaits tracked writes); it is
    // registered before the tracked one so notification precedes settled().
    void written.then(async (ok) => {
      if (ok || !ending) this.notifyEnded("abandoned");
      else this.notifyEnded(await ending);
    });
    this.trackDone(written.then(() => undefined));
  }

  /** Resolves once no turn is running or queued, any end() has finished and writes have landed. */
  async settled(): Promise<void> {
    while (this.active) await this.active;
    if (this.ending) await this.ending;
    await Promise.all(this.writes);
  }

  // ── Scheduling ─────────────────────────────────────────────────────────────

  private enqueue(u: Utterance): void {
    if (this.closed) return;
    this.touch();
    if (this.queue.length >= QUEUE_CAP) {
      this.log("utterance dropped: queue full");
      this.deps.sendJson({ type: "stt_error", reason: "busy" });
      return;
    }
    this.queue.push(u);
    if (this.started && !this.active) this.run(this.queue.shift()!);
  }

  private run(item: Item): Promise<void> {
    const p: Promise<void> = this.runItem(item)
      .catch((err) => this.log("turn error", err))
      .finally(() => {
        if (this.active === p) this.active = null;
        this.afterItem();
      });
    this.active = p;
    return p;
  }

  private afterItem(): void {
    if (this.closed) return;
    if (this.userTurnCount() >= this.deps.config.limits.maxTurnsPerSession) {
      this.log("turn limit reached");
      void this.end();
      return;
    }
    this.setState("listening");
    const next = this.queue.shift();
    if (next) this.run(next);
  }

  private cancelTurn(): void {
    if (this.turn) {
      this.turn.interrupted = true;
      this.turn.abort.abort();
    }
    this.chunker?.reset();
  }

  // ── One item: optional STT, user turn, reply ───────────────────────────────

  private async runItem(item: Item): Promise<void> {
    const ctx: TurnCtx = { abort: new AbortController(), interrupted: false };
    this.turn = ctx;
    this.setState("thinking");
    try {
      let userText: string | null = null;
      if (item.kind === "audio") {
        userText = await this.transcribe(item.pcm, ctx.abort.signal);
        if (userText === null) return;
      } else if (item.kind === "text") {
        userText = item.text;
      }
      if (ctx.abort.signal.aborted) return;

      if (userText !== null) {
        this.addTurn("user", userText);
        this.deps.sendJson({ type: "transcript", text: userText, role: "user" });
      }
      await this.respond(ctx, item.kind === "greeting" ? undefined : item.receivedAt);

      if (userText !== null && !this.abandoned) this.maybeAdvancePhase();
    } finally {
      if (this.turn === ctx) this.turn = null;
    }
  }

  /** Returns the transcript, or null when the utterance yields no turn. */
  private async transcribe(pcm: Buffer, signal: AbortSignal): Promise<string | null> {
    try {
      const { text } = await this.deps.providers.stt.transcribe(pcm, signal);
      if (signal.aborted) return null;
      if (!text.trim()) {
        this.deps.sendJson({ type: "stt_error", reason: "low_confidence" });
        return null;
      }
      return text.trim();
    } catch (err) {
      // Only our own abort is silent; an AbortError we did not cause is a provider failure.
      if (signal.aborted) return null;
      this.log("stt error", err);
      this.deps.sendJson({ type: "stt_error", reason: "stt_failed" });
      return null;
    }
  }

  /**
   * Streams the LLM reply into the chunker and speaks it sentence by sentence on one
   * promise chain. Whatever the client is told is final is stored, and vice versa:
   * - completed: final transcript, tts_end, then the turn is stored;
   * - provider failure: the sentences already sent as partials become the final and the
   *   stored turn (nothing if none were sent);
   * - interrupted/abandoned: no final, no tts_end, nothing stored.
   */
  private async respond(ctx: TurnCtx, receivedAt: number | undefined): Promise<void> {
    const { abort } = ctx;
    const { signal } = abort;
    const { system, messages } = buildTurnRequest(this.view());
    const chunker = new SentenceChunker();
    this.chunker = chunker;

    const failure: { err?: unknown } = {};
    const fail = (err: unknown) => {
      if (!("err" in failure)) failure.err = err;
      abort.abort();
    };
    let spoken = "";
    let ttsChain: Promise<void> = Promise.resolve();
    let ttsStarted = false;
    let latencySent = receivedAt === undefined;

    const onChunk = (chunk: Uint8Array) => {
      if (!ttsStarted) {
        ttsStarted = true;
        this.deps.sendJson({ type: "tts_start" });
        this.setState("speaking");
      }
      this.deps.sendAudio(chunk);
      if (!latencySent) {
        latencySent = true;
        this.deps.sendJson({ type: "latency_metric", ms: Date.now() - receivedAt! });
      }
    };

    chunker.on("sentence", (sentence: string) => {
      if (signal.aborted) return;
      spoken = spoken ? `${spoken} ${sentence}` : sentence;
      this.deps.sendJson({ type: "transcript", text: spoken, role: "assistant", partial: true });
      ttsChain = ttsChain
        .then(() => this.speak(sentence, signal, onChunk))
        .catch((err) => {
          if (!signal.aborted) fail(err);
        });
    });

    try {
      const stream = this.deps.providers.llm.stream({ system, messages, maxTokens: MAX_TOKENS }, signal);
      for await (const piece of stream) {
        if (signal.aborted) break;
        chunker.push(piece);
      }
      if (!signal.aborted) chunker.flush();
    } catch (err) {
      if (!signal.aborted) fail(err);
    }

    await ttsChain;
    chunker.reset();
    if (this.chunker === chunker) this.chunker = null;

    if (ctx.interrupted) return;
    if ("err" in failure) this.log("turn failed", failure.err);
    else if (signal.aborted) return;

    if (spoken) this.deps.sendJson({ type: "transcript", text: spoken, role: "assistant" });
    if (ttsStarted) this.deps.sendJson({ type: "tts_end" });
    if (spoken) this.addTurn("assistant", spoken);
  }

  private async speak(
    sentence: string,
    signal: AbortSignal,
    onChunk: (chunk: Uint8Array) => void,
  ): Promise<void> {
    if (signal.aborted) return;
    for await (const chunk of this.deps.providers.tts.synthesize(sentence, signal)) {
      if (signal.aborted) return;
      onChunk(chunk);
    }
  }

  // ── End ────────────────────────────────────────────────────────────────────

  /**
   * Bounds end(): if the in-flight turn plus the report have not finished within
   * limits.reportTimeoutMs, everything is aborted and the session ends as failed. The
   * deadline does not rely on providers honouring the abort: the outcome is decided by
   * whichever status write lands first, and a late report can no longer change it (its
   * write is refused and onEnded fires once). If the deadline's own failed write is
   * refused because the report's complete write won, the outcome is complete.
   */
  private async finish(): Promise<"complete" | "failed"> {
    const reportAbort = new AbortController();
    this.reportAbort = reportAbort;
    if (this.abandoned) reportAbort.abort();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.deps.config.limits.reportTimeoutMs);
      if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
    });
    const work = this.produceReport(reportAbort);
    const outcome = await Promise.race([work, deadline]);
    if (timer) clearTimeout(timer);

    let result: "complete" | "failed";
    if (outcome === "timeout") {
      this.log("report deadline reached");
      this.cancelTurn();
      reportAbort.abort();
      // The abandoned work may still settle later; its rejection is already handled.
      void work.catch(() => undefined);
      let refused = false;
      try {
        refused = !(await this.deps.persist.persistSessionStatus(this.sessionId, "failed"));
      } catch (writeErr) {
        this.log("persistSessionStatus error", writeErr);
      }
      // Refused: another status landed first. If it was not abandon()'s, it was the work's
      // own write, so the work is about to settle: report what it actually stored.
      result = refused && !this.abandoned ? await work : "failed";
    } else {
      result = outcome;
    }

    this.reportAbort = null;
    this._state = "idle";
    this.finished = true;
    // An abandon() during end() reports the outcome itself once its own write lands.
    if (!this.abandoned) this.notifyEnded(result);
    return result;
  }

  /** Waits for the (cancelled) in-flight turn, then generates and stores the report and the status. */
  private async produceReport(reportAbort: AbortController): Promise<"complete" | "failed"> {
    const { persist } = this.deps;
    let result: "complete" | "failed";
    try {
      while (this.active) await this.active;
      await Promise.all(this.writes);
      reportAbort.signal.throwIfAborted();
      const report = await generateReport(
        this._turns,
        this.deps.interviewer,
        this.deps.providers.llm,
        reportAbort.signal,
      );
      reportAbort.signal.throwIfAborted();
      await persist.persistReport(this.sessionId, report);
      const ok = await persist.persistSessionStatus(this.sessionId, "complete");
      if (!ok) this.log("complete not recorded: session already ended");
      result = ok ? "complete" : "failed";
    } catch (err) {
      this.log("end failed", err);
      try {
        await persist.persistSessionStatus(this.sessionId, "failed");
      } catch (writeErr) {
        this.log("persistSessionStatus error", writeErr);
      }
      result = "failed";
    }
    return result;
  }

  private notifyEnded(status: EndedStatus): void {
    if (this.endedReported) return;
    this.endedReported = true;
    try {
      this.deps.onEnded?.(status);
    } catch (err) {
      this.log("onEnded error", err);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private view(): TurnSession {
    return {
      interviewer: this.deps.interviewer,
      phaseIndex: this.phaseIndex,
      phaseUserTurns: this.phaseUserTurns,
      turns: this._turns,
    };
  }

  private userTurnCount(): number {
    return this._turns.filter((t) => t.role === "user").length;
  }

  private addTurn(role: ConversationTurn["role"], content: string): void {
    const turn: ConversationTurn = {
      id: randomUUID(),
      sessionId: this.sessionId,
      role,
      content,
      phase: this.phase,
      timestamp: new Date(),
    };
    this._turns.push(turn);
    if (role === "user") this.phaseUserTurns += 1;
    if (this.deps.config.debugLogText) console.log(`[session ${this.sessionId}] ${role}: ${content}`);
    this.track(this.deps.persist.persistTurn(turn), "persistTurn");
  }

  private maybeAdvancePhase(): void {
    const next = advancePhase(this.deps.interviewer, this.phaseIndex, this.phaseUserTurns, this.deps.demo);
    if (next === null) return;
    const prev = this.phase;
    this.phaseIndex = next;
    this.phaseUserTurns = 0;
    const name = this.phase;
    this.track(this.deps.persist.persistPhaseTransition(this.sessionId, name), "persistPhaseTransition");
    this.deps.sendJson({ type: "phase_change", phase: name });
    console.log(`[session ${this.sessionId}] phase ${prev} -> ${name}`);
  }

  private setState(next: ControllerState): void {
    if (this.abandoned || this.finished) return;
    this._state = next;
  }

  /** Records client activity: restarts the idle timer. */
  private touch(): void {
    if (this.closed) return;
    this.clearIdle();
    const timer = setTimeout(() => {
      this.idleTimer = null;
      this.log("idle timeout");
      this.abandon();
    }, this.deps.config.limits.idleTimeoutMs);
    if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
    this.idleTimer = timer;
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /** Fire-and-forget write that is logged on failure and awaited by settled() and end(). */
  private track(p: Promise<unknown>, what: string): void {
    this.trackDone(
      p.then(
        () => undefined,
        (err) => this.log(`${what} error`, err),
      ),
    );
  }

  /** Registers a promise that never rejects so settled() and end() can await it. */
  private trackDone(w: Promise<void>): void {
    this.writes.add(w);
    void w.then(() => this.writes.delete(w));
  }

  /** IDs, event names and error classes only; never conversation text. */
  private log(event: string, err?: unknown): void {
    const suffix = err === undefined ? "" : `: ${errName(err)}`;
    console.error(`[session ${this.sessionId}] ${event} (state ${this._state})${suffix}`);
  }
}
