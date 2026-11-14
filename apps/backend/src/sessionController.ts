import { randomUUID } from "crypto";
import type { Config } from "./config";
import type * as Persistence from "./persistence";
import { computeTurnMetrics, isValidResponseGap, type TurnMetrics } from "./delivery/metrics";
import { errName } from "./errors";
import type { Providers, Word } from "./providers/types";
import type { InterviewerDefinition, InterviewerInput } from "./interviewer/schema";
import { generateDraft } from "./interviewer/designer";
import { advancePhase, buildTurnRequest, endsWithQuestion, type TurnSession } from "./orchestrator";
import { generateReport } from "./reportGenerator";
import { SentenceChunker } from "./sentenceChunker";
import { BUILT_IN, type SettingsValues } from "./settings";
import { staticSettings, type SettingsSource } from "./settingsService";
import type { ConversationTurn, ServerToClientMessage } from "./types";
import type { UsageFeature, UsageMeta } from "./usage";

export type ControllerState = "idle" | "listening" | "thinking" | "speaking";
export type EndedStatus = "complete" | "failed" | "abandoned";
/**
 * What end() produces: "interview" a stored report; "trial" nothing (it just ends complete);
 * "designer" an interviewer draft sent to the client as a `draft` message.
 */
export type SessionKind = "interview" | "designer" | "trial";

export interface ControllerDeps {
  /** Defaults to "interview". */
  kind?: SessionKind;
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
  /**
   * Where the session's models and limits come from. Defaults to staticSettings() (BUILT_IN).
   * The conversation uses one snapshot taken before its first model call; the report or draft
   * at the end reads settings again when it runs.
   */
  settings?: SettingsSource;
}

/** The session's settings snapshot: frozen, fixed for the life of the session. */
type Snapshot = Readonly<SettingsValues>;

/**
 * A user utterance waiting for its turn. receivedAt is the latency_metric origin. An audio
 * item carries the response gap noted just before it arrived (null when none was noted).
 */
type Utterance =
  | { kind: "text"; text: string; receivedAt: number }
  | { kind: "audio"; pcm: Buffer; receivedAt: number; responseGapMs: number | null };
type Item = Utterance | { kind: "greeting" };

/** The in-flight item. interrupted is set by interrupt()/abandon() before they abort. */
interface TurnCtx {
  abort: AbortController;
  interrupted: boolean;
}

const QUEUE_CAP = 5;

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
  /** Gap from noteResponseGap() waiting for the next audio utterance; never given to text. */
  private pendingGapMs: number | null = null;
  /** Designer only: the validated draft, set just before the complete write; sent by finish(). */
  private draft: InterviewerInput | null = null;

  private started = false;
  /** No new input is accepted: end() has begun or abandon() was called. */
  private closed = false;
  private abandoned = false;
  private finished = false;
  private endedReported = false;

  private readonly settings: SettingsSource;
  /** The one settings read for the conversation, made on first need; never rejects. */
  private snapshotP: Promise<Snapshot> | null = null;
  /** snapshotP's value once it has resolved, so later items read it without awaiting. */
  private snapshotValue: Snapshot | null = null;

  constructor(private readonly deps: ControllerDeps) {
    this.sessionId = deps.sessionId;
    this.ownerId = deps.ownerId;
    this.settings = deps.settings ?? staticSettings();
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
    void this.snapshot();
    return this.run({ kind: "greeting" });
  }

  handleAudio(pcm: Buffer): void {
    // The pending gap belongs to this utterance, so it is taken now, at arrival, and not
    // when the item is dequeued; it is consumed even if the item is then dropped.
    const responseGapMs = this.pendingGapMs;
    this.pendingGapMs = null;
    this.enqueue({ kind: "audio", pcm, receivedAt: Date.now(), responseGapMs });
  }

  /**
   * Notes the client-measured gap between the end of the interviewer's playback and the
   * start of the user's speech, for the next audio utterance. Anything but a finite number
   * in 0..600000 ms is ignored silently; a later valid note replaces an earlier one. The
   * value is never logged.
   */
  noteResponseGap(ms: unknown): void {
    if (this.closed) return;
    if (!isValidResponseGap(ms)) return;
    this.pendingGapMs = ms;
  }

  handleText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    // A text turn means any waiting note belongs to no audio.
    this.pendingGapMs = null;
    this.enqueue({ kind: "text", text: trimmed, receivedAt: Date.now() });
  }

  /** Cancels the current item and anything queued. Safe in any state. */
  async interrupt(): Promise<void> {
    if (this.closed) return;
    this.touch();
    this.queue.length = 0;
    this.pendingGapMs = null;
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
    this.pendingGapMs = null;
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
    this.pendingGapMs = null;
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
      // Once the snapshot has resolved it is used synchronously, so the item starts exactly as
      // it would without settings. Before that the item waits for it; ctx is already the
      // current turn, so an interrupt during the wait ends it at once and nothing runs.
      const snapshot = this.snapshotValue ?? (await this.untilSnapshot(ctx.abort.signal));
      if (snapshot === null) return;
      let userText: string | null = null;
      let metrics: TurnMetrics | null = null;
      if (item.kind === "audio") {
        const heard = await this.transcribe(item.pcm, ctx.abort.signal, snapshot);
        if (heard === null) return;
        userText = heard.text;
        metrics = computeTurnMetrics({ text: heard.text, words: heard.words, responseGapMs: item.responseGapMs });
      } else if (item.kind === "text") {
        userText = item.text;
      }
      if (ctx.abort.signal.aborted) return;

      if (userText !== null) {
        this.addTurn("user", userText, metrics);
        this.deps.sendJson({ type: "transcript", text: userText, role: "user" });
      }
      await this.respond(ctx, item.kind === "greeting" ? undefined : item.receivedAt, snapshot);

      if (userText !== null && !this.abandoned) this.maybeAdvancePhase();
    } finally {
      if (this.turn === ctx) this.turn = null;
    }
  }

  /** Returns the trimmed transcript and its words, or null when the utterance yields no turn. */
  private async transcribe(
    pcm: Buffer,
    signal: AbortSignal,
    snapshot: Snapshot,
  ): Promise<{ text: string; words: Word[] } | null> {
    try {
      const { text, words } = await this.deps.providers.stt.transcribe(pcm, signal, { modelId: snapshot.sttModel });
      if (signal.aborted) return null;
      if (!text.trim()) {
        this.deps.sendJson({ type: "stt_error", reason: "low_confidence" });
        return null;
      }
      return { text: text.trim(), words };
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
  private async respond(ctx: TurnCtx, receivedAt: number | undefined, snapshot: Snapshot): Promise<void> {
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

    let questions = 0;
    chunker.on("sentence", (sentence: string) => {
      if (signal.aborted) return;
      // One question per turn (the voice rule). The model sometimes asks a second one anyway:
      // it is not spoken, shown or stored, so the history the model sees matches what was said.
      if (endsWithQuestion(sentence)) {
        if (questions >= 1) {
          this.log("extra question dropped");
          return;
        }
        questions += 1;
      }
      spoken = spoken ? `${spoken} ${sentence}` : sentence;
      this.deps.sendJson({ type: "transcript", text: spoken, role: "assistant", partial: true });
      ttsChain = ttsChain
        .then(() => this.speak(sentence, signal, onChunk, snapshot))
        .catch((err) => {
          if (!signal.aborted) fail(err);
        });
    });

    try {
      const stream = this.deps.providers.llm.stream(
        {
          system,
          messages,
          model: snapshot.replyModel,
          maxTokens: snapshot.replyMaxTokens,
          usage: this.usageMeta("conversation"),
        },
        signal,
      );
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
    snapshot: Snapshot,
  ): Promise<void> {
    if (signal.aborted) return;
    const opts = { modelId: snapshot.ttsModel, outputFormat: snapshot.spokenFormat };
    for await (const chunk of this.deps.providers.tts.synthesize(sentence, signal, opts)) {
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
    const work = this.produceOutcome(reportAbort);
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
    // The draft goes out here and nowhere else: only when the outcome is decided complete and
    // no abandon() happened, synchronously before onEnded. A draft finished after the deadline
    // or an abandon is never sent, since this point has passed or the guard is false.
    // Designer and trial sessions must be wired with EPHEMERAL_PERSIST: its status writes are
    // never refused, so no refused-write path can report "complete" without sending the draft.
    const draft = this.draft;
    this.draft = null;
    if (result === "complete" && !this.abandoned && draft) {
      this.deps.sendJson({ type: "draft", draft });
    }
    // An abandon() during end() reports the outcome itself once its own write lands.
    if (!this.abandoned) this.notifyEnded(result);
    return result;
  }

  /**
   * Waits for the (cancelled) in-flight turn, then produces what this kind of session ends
   * with (a stored report, nothing, or a draft) and writes the status.
   */
  private async produceOutcome(reportAbort: AbortController): Promise<"complete" | "failed"> {
    const { persist } = this.deps;
    const kind = this.deps.kind ?? "interview";
    let result: "complete" | "failed";
    try {
      while (this.active) await this.active;
      await Promise.all(this.writes);
      reportAbort.signal.throwIfAborted();
      if (kind === "interview") {
        const current = await this.currentSettings();
        const report = await generateReport(
          this._turns,
          this.deps.interviewer,
          this.deps.providers.llm,
          reportAbort.signal,
          {
            showFillerCounts: this.deps.config.reportFillerCounts,
            usage: this.usageMeta("report"),
            model: current.reportModel,
          },
        );
        reportAbort.signal.throwIfAborted();
        await persist.persistReport(this.sessionId, report);
      } else if (kind === "designer") {
        const current = await this.currentSettings();
        const draft = await generateDraft(
          { kind: "conversation", turns: this._turns },
          this.deps.providers.llm,
          reportAbort.signal,
          this.usageMeta("designer-draft"),
          current.draftModel,
        );
        reportAbort.signal.throwIfAborted();
        // Held for finish(), which sends it only if the session really ends complete.
        this.draft = draft;
      }
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

  // ── Settings ───────────────────────────────────────────────────────────────

  /**
   * The conversation's settings: one read, made on first need (start() or the first item,
   * whichever comes first), frozen and never refreshed. A failed read falls back to BUILT_IN;
   * only the error class is logged, never a value.
   */
  private snapshot(): Promise<Snapshot> {
    if (!this.snapshotP) {
      // new Promise turns a synchronous throw from get() into a rejection too.
      this.snapshotP = new Promise<SettingsValues>((resolve) => resolve(this.settings.get(this.ownerId))).then(
        (values) => (this.snapshotValue = Object.freeze({ ...values })),
        (err) => {
          this.log("settings read failed: using built-in values", err);
          return (this.snapshotValue = Object.freeze({ ...BUILT_IN }));
        },
      );
    }
    return this.snapshotP;
  }

  /** The snapshot, or null as soon as `signal` aborts (an interrupt never waits on settings). */
  private untilSnapshot(signal: AbortSignal): Promise<Snapshot | null> {
    if (signal.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const onAbort = () => resolve(null);
      signal.addEventListener("abort", onAbort, { once: true });
      void this.snapshot().then((s) => {
        signal.removeEventListener("abort", onAbort);
        resolve(signal.aborted ? null : s);
      });
    });
  }

  /** Settings as they are now, for the report or draft at the end; the snapshot if the read fails. */
  private async currentSettings(): Promise<Snapshot> {
    try {
      return await this.settings.get(this.ownerId);
    } catch (err) {
      this.log("settings read failed: using the session's snapshot", err);
      return this.snapshot();
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

  /** metrics: delivery measures of a voiced user turn (numbers only); omitted otherwise. */
  private addTurn(role: ConversationTurn["role"], content: string, metrics: TurnMetrics | null = null): void {
    const turn: ConversationTurn = {
      id: randomUUID(),
      sessionId: this.sessionId,
      role,
      content,
      phase: this.phase,
      timestamp: new Date(),
      ...(metrics ? { metrics } : {}),
    };
    this._turns.push(turn);
    if (role === "user") this.phaseUserTurns += 1;
    if (this.deps.config.debugLogText) console.log(`[session ${this.sessionId}] ${role}: ${content}`);
    this.track(this.deps.persist.persistTurn(turn), "persistTurn");
  }

  /** Tail of the phase-transition write chain (never rejects). */
  private phaseWrite: Promise<void> = Promise.resolve();

  private maybeAdvancePhase(): void {
    const next = advancePhase(this.deps.interviewer, this.phaseIndex, this.phaseUserTurns, this.deps.demo);
    if (next === null) return;
    const prev = this.phaseIndex;
    this.phaseIndex = next;
    this.phaseUserTurns = 0;
    const name = this.phase;
    // Serialised: writes run in order so Session.phase ends on the latest phase. A failure is
    // logged and does not stop later writes.
    this.phaseWrite = this.phaseWrite.then(() =>
      this.deps.persist.persistPhaseTransition(this.sessionId, name).then(
        () => undefined,
        (err) => this.log("persistPhaseTransition error", err),
      ),
    );
    this.trackDone(this.phaseWrite);
    this.deps.sendJson({ type: "phase_change", phase: name });
    // Indices only: phase names are interviewer-written text and never reach the logs.
    console.log(`[session ${this.sessionId}] phase ${prev} -> ${next}`);
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

  /**
   * Usage meta for this session's LLM calls. Designer and trial sessions are ephemeral (no
   * stored session), so their calls carry the owner and no session id.
   */
  private usageMeta(feature: UsageFeature): UsageMeta {
    const kind = this.deps.kind ?? "interview";
    return kind === "interview"
      ? { feature, ownerId: this.ownerId, sessionId: this.sessionId }
      : { feature, ownerId: this.ownerId };
  }

  /** IDs, event names and error classes only; never conversation text. */
  private log(event: string, err?: unknown): void {
    const suffix = err === undefined ? "" : `: ${errName(err)}`;
    console.error(`[session ${this.sessionId}] ${event} (state ${this._state})${suffix}`);
  }
}
