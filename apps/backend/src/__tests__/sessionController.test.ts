import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionController, type ControllerDeps } from "../sessionController";
import { createMockProviders, type MockScript } from "../providers/mock";
import type { Providers } from "../providers/types";
import { loadConfig, type Config } from "../config";
import { PRESETS } from "../interviewer/presets";
import type { InterviewerDefinition, PhaseDefinition } from "../interviewer/schema";
import type {
  ConversationTurn,
  Report,
  ServerToClientMessage,
  SessionStatus,
} from "../types";

const LONG_REPLY = "Thanks for sharing that with me. Could you tell me a little more about it?";
const LONG_TEXT =
  "I lead a delivery team and we have been using AI assistants for code review and tests.";

type Event = { kind: "json"; msg: ServerToClientMessage } | { kind: "audio"; bytes: number };

function makeConfig(limits: Partial<Config["limits"]> = {}): Config {
  const base = loadConfig({ PROFILE: "mock" });
  return { ...base, limits: { ...base.limits, ...limits } };
}

function makePersist() {
  return {
    persistTurn: vi.fn(async (_t: ConversationTurn) => {}),
    persistPhaseTransition: vi.fn(async (_id: string, _phase: string) => {}),
    persistSessionStatus: vi.fn(async (_id: string, _status: SessionStatus) => true),
    persistReport: vi.fn(async (_id: string, _report: Report) => {}),
  };
}

function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

/**
 * Mock TTS that, once armed, blocks after the first chunk of the sentence `blockOn` until
 * released (or aborted, unless ignoreAbort). `reached` resolves when it is blocked, so a
 * test can act at a guaranteed point mid-turn instead of racing real timers.
 */
function gateTts(providers: Providers, blockOn: string, opts: { ignoreAbort?: boolean } = {}) {
  let armed = false;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let reached!: () => void;
  const reachedP = new Promise<void>((r) => (reached = r));
  let lastSignal: AbortSignal | undefined;
  providers.tts = {
    async *synthesize(sentence, signal) {
      if (signal.aborted) throw abortError();
      yield new Uint8Array([0xff, 0xfb, 0, 0]);
      if (armed && sentence === blockOn) {
        lastSignal = signal;
        reached();
        await new Promise<void>((res, rej) => {
          if (!opts.ignoreAbort) signal.addEventListener("abort", () => rej(abortError()), { once: true });
          void gate.then(res);
        });
      }
      if (signal.aborted) throw abortError();
      yield new Uint8Array([0xff, 0xfb, 1, 0]);
    },
  };
  return {
    arm: () => (armed = true),
    release: () => release(),
    reached: reachedP,
    signal: () => lastSignal,
  };
}

const SENTENCE_1 = "Thanks for sharing that with me.";
const SENTENCE_2 = "Could you tell me a little more about it?";

function setup(
  opts: {
    script?: MockScript;
    demo?: boolean;
    limits?: Partial<Config["limits"]>;
    providers?: ControllerDeps["providers"];
    onEnded?: ControllerDeps["onEnded"];
    interviewer?: InterviewerDefinition;
  } = {},
) {
  const events: Event[] = [];
  const persist = makePersist();
  const onEnded = vi.fn(opts.onEnded ?? (() => {}));
  const ctl = new SessionController({
    sessionId: "s-1",
    ownerId: "owner-1",
    interviewer: opts.interviewer ?? PRESETS[0],
    demo: opts.demo ?? false,
    providers: opts.providers ?? createMockProviders({ llmReplies: [LONG_REPLY], ...opts.script }),
    config: makeConfig(opts.limits),
    sendJson: (msg) => events.push({ kind: "json", msg }),
    sendAudio: (chunk) => events.push({ kind: "audio", bytes: chunk.length }),
    persist,
    onEnded,
  });
  const types = () => events.map((e) => (e.kind === "audio" ? "audio" : e.msg.type));
  const json = () =>
    events.flatMap((e) => (e.kind === "json" ? [e.msg] : [])) as ServerToClientMessage[];
  const storedTurns = () => persist.persistTurn.mock.calls.map((c) => c[0]);
  return { ctl, events, persist, types, json, storedTurns, onEnded };
}

/** Assistant transcripts (partial or final) among the given events. */
function assistantFinals(events: Event[]): string[] {
  return events.flatMap((e) =>
    e.kind === "json" && e.msg.type === "transcript" && e.msg.role === "assistant" && !e.msg.partial
      ? [e.msg.text]
      : [],
  );
}

const REPORT = {
  summary: "A good conversation.",
  strengths: [{ area: "Clarity", evidence: "Explained the team setup" }],
  improvements: [{ area: "Depth", suggestion: "Give a concrete metric" }],
  highlights: ["We use AI for review"],
  overall_assessment: "Thoughtful and concrete.",
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SessionController greeting", () => {
  it("starts idle, greets with tts_start, audio, tts_end in order, then listens", async () => {
    const { ctl, types, storedTurns } = setup();
    expect(ctl.state).toBe("idle");
    const p = ctl.start();
    expect(ctl.state).toBe("thinking");
    await p;
    expect(ctl.state).toBe("listening");

    const t = types();
    const start = t.indexOf("tts_start");
    const firstAudio = t.indexOf("audio");
    const end = t.lastIndexOf("tts_end");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(firstAudio).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(t.lastIndexOf("audio"));
    expect(t.filter((x) => x === "tts_start")).toHaveLength(1);
    expect(t.filter((x) => x === "tts_end")).toHaveLength(1);
    // The greeting has no user utterance, so no latency metric.
    expect(t).not.toContain("latency_metric");
    // "Hello" priming is not stored: only the assistant greeting is.
    expect(storedTurns().map((x) => x.role)).toEqual(["assistant"]);
  });

  it("sends cumulative partial transcripts per sentence, then a final transcript", async () => {
    const { ctl, json } = setup();
    await ctl.start();
    const assistant = json().filter(
      (m): m is Extract<ServerToClientMessage, { type: "transcript" }> =>
        m.type === "transcript" && m.role === "assistant",
    );
    const partials = assistant.filter((m) => m.partial === true);
    const finals = assistant.filter((m) => !m.partial);
    expect(partials.length).toBe(2);
    expect(partials[0].text).toBe("Thanks for sharing that with me.");
    expect(partials[1].text).toBe(LONG_REPLY);
    expect(finals).toHaveLength(1);
    expect(finals[0].text).toBe(LONG_REPLY);
  });
});

describe("SessionController turns", () => {
  it("answers two quick handleText calls in order with two assistant turns", async () => {
    const { ctl, json, storedTurns } = setup();
    await ctl.start();
    ctl.handleText("first answer");
    ctl.handleText("second answer");
    await ctl.settled();

    const userTranscripts = json()
      .filter((m) => m.type === "transcript" && m.role === "user")
      .map((m) => (m as { text: string }).text);
    expect(userTranscripts).toEqual(["first answer", "second answer"]);
    expect(storedTurns().map((t) => `${t.role}:${t.role === "user" ? t.content : ""}`)).toEqual([
      "assistant:",
      "user:first answer",
      "assistant:",
      "user:second answer",
      "assistant:",
    ]);
    expect(ctl.state).toBe("listening");
  });

  it("answers queued utterances in arrival order, including audio", async () => {
    const { ctl, json } = setup({ script: { sttTexts: ["spoken words"], ttsDelayMs: 5 } });
    await ctl.start();
    ctl.handleText("one");
    ctl.handleAudio(Buffer.alloc(320));
    ctl.handleText("three");
    expect(ctl.state).not.toBe("listening");
    await ctl.settled();
    const users = json()
      .filter((m) => m.type === "transcript" && m.role === "user")
      .map((m) => (m as { text: string }).text);
    expect(users).toEqual(["one", "spoken words", "three"]);
  });

  it("runs STT for a queued audio frame only when it is dequeued", async () => {
    const providers = createMockProviders({ llmReplies: [LONG_REPLY], ttsDelayMs: 5 });
    const transcribe = vi.spyOn(providers.stt, "transcribe");
    const { ctl } = setup({ providers });
    await ctl.start();
    ctl.handleText("busy now");
    ctl.handleAudio(Buffer.alloc(320));
    await Promise.resolve();
    expect(transcribe).not.toHaveBeenCalled();
    await ctl.settled();
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("drops the sixth queued utterance with stt_error busy", async () => {
    const { ctl, json } = setup({ script: { ttsDelayMs: 5 } });
    await ctl.start();
    ctl.handleText("running");
    for (let i = 0; i < 6; i++) ctl.handleText(`queued ${i}`);
    expect(json().filter((m) => m.type === "stt_error")).toEqual([
      { type: "stt_error", reason: "busy" },
    ]);
    await ctl.settled();
    const users = json().filter((m) => m.type === "transcript" && m.role === "user");
    expect(users).toHaveLength(6);
  });

  it("sends latency_metric once per user turn, after tts_start", async () => {
    const { ctl, types } = setup();
    await ctl.start();
    ctl.handleText("hello");
    await ctl.settled();
    const t = types();
    expect(t.filter((x) => x === "latency_metric")).toHaveLength(1);
    expect(t.lastIndexOf("latency_metric")).toBeGreaterThan(t.lastIndexOf("tts_start"));
  });

  it("transcribes audio and runs a turn from the STT text", async () => {
    const { ctl, json, storedTurns } = setup({ script: { sttTexts: ["voice answer"] } });
    await ctl.start();
    ctl.handleAudio(Buffer.alloc(320));
    await ctl.settled();
    expect(json()).toContainEqual({ type: "transcript", text: "voice answer", role: "user" });
    expect(storedTurns().filter((t) => t.role === "user").map((t) => t.content)).toEqual([
      "voice answer",
    ]);
  });

  it("sends stt_error low_confidence for empty STT text and stays listening", async () => {
    const { ctl, json, storedTurns } = setup({ script: { sttTexts: ["   "] } });
    await ctl.start();
    ctl.handleAudio(Buffer.alloc(320));
    await ctl.settled();
    expect(json()).toContainEqual({ type: "stt_error", reason: "low_confidence" });
    expect(storedTurns().filter((t) => t.role === "user")).toHaveLength(0);
    expect(ctl.state).toBe("listening");
  });

  it("sends stt_error on an STT failure and stays usable", async () => {
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    vi.spyOn(providers.stt, "transcribe").mockRejectedValueOnce(new TypeError("network down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctl, json } = setup({ providers });
    await ctl.start();
    ctl.handleAudio(Buffer.alloc(320));
    await ctl.settled();
    expect(json().some((m) => m.type === "stt_error")).toBe(true);
    expect(ctl.state).toBe("listening");
    expect(err.mock.calls.flat().join(" ")).toContain("TypeError");
    ctl.handleText("typed instead");
    await ctl.settled();
    expect(json()).toContainEqual({ type: "transcript", text: "typed instead", role: "user" });
  });

  it("failLlmOnCall 2: the second turn stores no assistant turn and the third works", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctl, storedTurns } = setup({ script: { failLlmOnCall: 2 } });
    await ctl.start(); // LLM call 1
    ctl.handleText("this one fails"); // LLM call 2
    await ctl.settled();
    expect(ctl.state).toBe("listening");
    ctl.handleText("this one works"); // LLM call 3
    await ctl.settled();
    expect(storedTurns().map((t) => t.role)).toEqual(["assistant", "user", "user", "assistant"]);
    expect(ctl.state).toBe("listening");
    // Logs the error class, never the conversation text.
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain("Error");
    expect(logged).not.toContain("this one fails");
  });

  it("never logs conversation text by default", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctl } = setup();
    await ctl.start();
    ctl.handleText("secret participant words");
    await ctl.settled();
    const all = [...log.mock.calls, ...err.mock.calls].flat().join(" ");
    expect(all).not.toContain("secret participant words");
    expect(all).not.toContain("Thanks for sharing");
  });
});

describe("SessionController interrupt", () => {
  it("interrupt during streaming sends no tts_end and ends in listening", async () => {
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    const gate = gateTts(providers, SENTENCE_1);
    const { ctl, types, storedTurns } = setup({ providers });
    await ctl.start();
    gate.arm();
    const before = types().length;
    ctl.handleText("tell me more");
    await gate.reached;
    expect(ctl.state).toBe("speaking");
    await ctl.interrupt();
    expect(ctl.state).toBe("listening");
    await ctl.settled();
    const after = types().slice(before);
    expect(after).toContain("tts_start");
    expect(after).not.toContain("tts_end");
    // The aborted turn stores no assistant turn.
    expect(storedTurns().map((t) => t.role)).toEqual(["assistant", "user"]);
  });

  it("interrupt while thinking, before any sentence completes, does not throw", async () => {
    const { ctl, types, storedTurns } = setup();
    await ctl.start();
    const before = types().length;
    ctl.handleText("go");
    expect(ctl.state).toBe("thinking");
    await expect(ctl.interrupt()).resolves.toBeUndefined();
    expect(ctl.state).toBe("listening");
    await ctl.settled();
    expect(types().slice(before)).not.toContain("tts_end");
    expect(storedTurns().map((t) => t.role)).toEqual(["assistant", "user"]);
  });

  it("interrupt clears queued utterances and the next utterance works", async () => {
    const { ctl, json } = setup({ script: { ttsDelayMs: 10 } });
    await ctl.start();
    ctl.handleText("running");
    ctl.handleText("queued a");
    ctl.handleAudio(Buffer.alloc(320));
    await ctl.interrupt();
    await ctl.settled();
    ctl.handleText("after interrupt");
    await ctl.settled();
    const users = json()
      .filter((m) => m.type === "transcript" && m.role === "user")
      .map((m) => (m as { text: string }).text);
    expect(users).toEqual(["running", "after interrupt"]);
  });

  it("interrupt is safe when idle, listening, and during the greeting", async () => {
    const { ctl } = setup({ script: { ttsDelayMs: 10 } });
    await expect(ctl.interrupt()).resolves.toBeUndefined();
    expect(ctl.state).toBe("idle");
    const p = ctl.start();
    await ctl.interrupt();
    await p;
    expect(ctl.state).toBe("listening");
    await expect(ctl.interrupt()).resolves.toBeUndefined();
    expect(ctl.state).toBe("listening");
  });

  it("interrupt aborts in-flight STT silently", async () => {
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    let seen: AbortSignal | undefined;
    vi.spyOn(providers.stt, "transcribe").mockImplementation(
      (_pcm, signal) =>
        new Promise((_res, rej) => {
          seen = signal;
          signal.addEventListener("abort", () => {
            const e = new Error("Aborted");
            e.name = "AbortError";
            rej(e);
          });
        }),
    );
    const { ctl, json } = setup({ providers });
    await ctl.start();
    ctl.handleAudio(Buffer.alloc(320));
    await vi.waitFor(() => expect(seen).toBeDefined());
    await ctl.interrupt();
    expect(seen!.aborted).toBe(true);
    expect(json().some((m) => m.type === "stt_error")).toBe(false);
    expect(ctl.state).toBe("listening");
  });
});

function withPhases(phases: PhaseDefinition[]): InterviewerDefinition {
  return { ...PRESETS[0], id: "custom-1", source: "custom", ownerId: "owner-1", phases };
}

const phaseChanges = (json: () => ServerToClientMessage[]) =>
  json()
    .filter((m) => m.type === "phase_change")
    .map((m) => (m as { phase: string }).phase);

describe("SessionController phases", () => {
  it("starts in the first phase by name and moves intro -> share after the second user turn", async () => {
    const { ctl, json, persist } = setup();
    expect(ctl.phase).toBe("intro");
    await ctl.start();
    ctl.handleText("one");
    await ctl.settled();
    expect(phaseChanges(json)).toEqual([]);
    ctl.handleText("two");
    await ctl.settled();
    expect(json().filter((m) => m.type === "phase_change")).toEqual([
      { type: "phase_change", phase: "share" },
    ]);
    expect(persist.persistPhaseTransition.mock.calls).toEqual([["s-1", "share"]]);
    expect(ctl.phase).toBe("share");
  });

  it("follows the preset pacing 2/3/5 per phase, then stays in the last phase", async () => {
    const { ctl, json } = setup({ limits: { maxTurnsPerSession: 100 } });
    await ctl.start();
    const after: string[] = [];
    for (let i = 1; i <= 14; i++) {
      ctl.handleText(`answer ${i}`);
      await ctl.settled();
      after.push(ctl.phase);
    }
    expect(after).toEqual([
      "intro", "share",
      "share", "share", "deep_dive",
      "deep_dive", "deep_dive", "deep_dive", "deep_dive", "wrap_up",
      "wrap_up", "wrap_up", "wrap_up", "wrap_up",
    ]);
    expect(phaseChanges(json)).toEqual(["share", "deep_dive", "wrap_up"]);
  });

  it("stores each turn with the name of the phase it belongs to", async () => {
    const { ctl, storedTurns } = setup();
    await ctl.start();
    ctl.handleText("one");
    ctl.handleText("two");
    ctl.handleText("three");
    await ctl.settled();
    expect(storedTurns().map((t) => `${t.role}@${t.phase}`)).toEqual([
      "assistant@intro",
      "user@intro",
      "assistant@intro",
      "user@intro",
      // The phase advances after the reply to the turn that reached the threshold.
      "assistant@intro",
      "user@share",
      "assistant@share",
    ]);
  });

  it("counts user turns per phase: the count resets after an advance", async () => {
    const interviewer = withPhases([
      { name: "first", instruction: "F", minTurns: 1, maxTurns: 2 },
      { name: "second", instruction: "S", minTurns: 1, maxTurns: 2 },
      { name: "third", instruction: "T" },
    ]);
    const { ctl, json } = setup({ interviewer });
    expect(ctl.phase).toBe("first");
    await ctl.start();
    const after: string[] = [];
    for (let i = 1; i <= 5; i++) {
      ctl.handleText(`answer ${i}`);
      await ctl.settled();
      after.push(ctl.phase);
    }
    // Cumulative counting would have left "second" after answer 3.
    expect(after).toEqual(["first", "second", "second", "third", "third"]);
    expect(phaseChanges(json)).toEqual(["second", "third"]);
  });

  it("an interrupted user turn counts once towards the phase", async () => {
    const interviewer = withPhases([
      { name: "first", instruction: "F", minTurns: 1, maxTurns: 2 },
      { name: "last", instruction: "L" },
    ]);
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    const gate = gateTts(providers, SENTENCE_1);
    const { ctl, json, storedTurns } = setup({ providers, interviewer });
    await ctl.start();
    gate.arm();
    ctl.handleText("interrupted one");
    await gate.reached;
    await ctl.interrupt();
    await ctl.settled();
    expect(storedTurns().map((t) => t.role)).toEqual(["assistant", "user"]);
    expect(phaseChanges(json)).toEqual([]);
    gate.release();
    ctl.handleText("second one");
    await ctl.settled();
    expect(phaseChanges(json)).toEqual(["last"]);
  });

  it("serialises phase writes: a later write never starts before an earlier one finishes", async () => {
    const interviewer = withPhases([
      { name: "first", instruction: "F", minTurns: 1, maxTurns: 1 },
      { name: "second", instruction: "S", minTurns: 1, maxTurns: 1 },
      { name: "last", instruction: "L" },
    ]);
    const { ctl, json, persist } = setup({ interviewer, script: { llmReplies: [LONG_REPLY, LONG_REPLY, LONG_REPLY] } });
    const finished: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => (releaseFirst = r));
    persist.persistPhaseTransition.mockImplementation(async (_id: string, phase: string) => {
      if (phase === "second") await firstGate;
      finished.push(phase);
    });
    await ctl.start();
    ctl.handleText("one");
    ctl.handleText("two");
    await vi.waitFor(() => expect(phaseChanges(json)).toEqual(["second", "last"]));
    // The first write is still pending, so the second must not have started.
    expect(persist.persistPhaseTransition.mock.calls.map((c) => c[1])).toEqual(["second"]);
    releaseFirst();
    await ctl.settled();
    expect(persist.persistPhaseTransition.mock.calls.map((c) => c[1])).toEqual(["second", "last"]);
    expect(finished).toEqual(["second", "last"]);
  });

  it("a failed phase write is logged by class and does not stop later writes", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const interviewer = withPhases([
      { name: "first", instruction: "F", minTurns: 1, maxTurns: 1 },
      { name: "second", instruction: "S", minTurns: 1, maxTurns: 1 },
      { name: "last", instruction: "L" },
    ]);
    const { ctl, persist } = setup({ interviewer, script: { llmReplies: [LONG_REPLY, LONG_REPLY, LONG_REPLY] } });
    persist.persistPhaseTransition.mockImplementationOnce(async () => {
      throw new TypeError("secret detail");
    });
    await ctl.start();
    ctl.handleText("one");
    await ctl.settled();
    ctl.handleText("two");
    await ctl.settled();
    expect(persist.persistPhaseTransition.mock.calls.map((c) => c[1])).toEqual(["second", "last"]);
    const logged = errors.mock.calls.flat().join(" ");
    expect(logged).toMatch(/persistPhaseTransition error \(state \w+\): TypeError/);
    expect(logged).not.toContain("secret detail");
  });

  it("a user turn whose reply fails still counts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const interviewer = withPhases([
      { name: "first", instruction: "F", minTurns: 1, maxTurns: 1 },
      { name: "last", instruction: "L" },
    ]);
    const { ctl, json } = setup({ interviewer, script: { failLlmOnCall: 2 } });
    await ctl.start();
    ctl.handleText("fails");
    await ctl.settled();
    expect(phaseChanges(json)).toEqual(["last"]);
  });

  it("demo mode advances every phase at its minTurns", async () => {
    const { ctl, json, persist } = setup({ demo: true });
    await ctl.start();
    const after: string[] = [];
    for (let i = 1; i <= 5; i++) {
      ctl.handleText(`answer ${i}`);
      await ctl.settled();
      after.push(ctl.phase);
    }
    expect(after).toEqual(["share", "deep_dive", "wrap_up", "wrap_up", "wrap_up"]);
    expect(phaseChanges(json)).toEqual(["share", "deep_dive", "wrap_up"]);
    expect(persist.persistPhaseTransition.mock.calls.map((c) => c[1])).toEqual([
      "share",
      "deep_dive",
      "wrap_up",
    ]);
  });

  it("demo mode with custom minTurns waits for that many turns in each phase", async () => {
    const interviewer = withPhases([
      { name: "first", instruction: "F", minTurns: 2, maxTurns: 4 },
      { name: "last", instruction: "L" },
    ]);
    const { ctl, json } = setup({ interviewer, demo: true });
    await ctl.start();
    ctl.handleText("one");
    await ctl.settled();
    expect(phaseChanges(json)).toEqual([]);
    ctl.handleText("two");
    await ctl.settled();
    expect(phaseChanges(json)).toEqual(["last"]);
  });

  it("a single-phase interviewer never changes phase", async () => {
    const interviewer = withPhases([{ name: "only", instruction: "O" }]);
    const { ctl, json, persist, storedTurns } = setup({ interviewer, demo: true });
    await ctl.start();
    for (let i = 1; i <= 4; i++) ctl.handleText(`answer ${i}`);
    await ctl.settled();
    expect(phaseChanges(json)).toEqual([]);
    expect(persist.persistPhaseTransition).not.toHaveBeenCalled();
    expect(new Set(storedTurns().map((t) => t.phase))).toEqual(new Set(["only"]));
    expect(ctl.phase).toBe("only");
  });

  it("sends the current phase's prompt to the LLM, with opening only on the greeting", async () => {
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    const stream = vi.spyOn(providers.llm, "stream");
    const { ctl } = setup({ providers });
    const def = PRESETS[0];
    await ctl.start();
    ctl.handleText("one");
    ctl.handleText("two");
    ctl.handleText("three");
    await ctl.settled();
    const systems = stream.mock.calls.map((c) => c[0].system);
    expect(systems).toHaveLength(4);
    expect(systems[0]).toContain(def.opening);
    expect(systems[0]).toContain(def.phases[0].instruction);
    expect(systems.slice(1).some((s) => s.includes(def.opening))).toBe(false);
    expect(systems[2]).toContain(def.phases[0].instruction);
    expect(systems[3]).toContain(def.phases[1].instruction);
    for (const c of stream.mock.calls) expect(c[0].maxTokens).toBe(300);
  });

  it("logs ids and phase indices only, never interviewer-written text", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const interviewer: InterviewerDefinition = {
      ...withPhases([
        { name: "SENTINEL-PHASE-ALPHA", instruction: "SENTINEL-INSTR-ALPHA", minTurns: 1, maxTurns: 1 },
        { name: "SENTINEL-PHASE-OMEGA", instruction: "SENTINEL-INSTR-OMEGA" },
      ]),
      name: "SENTINEL-NAME",
      purpose: "SENTINEL-PURPOSE",
      persona: "SENTINEL-PERSONA",
      style: "SENTINEL-STYLE",
      opening: "SENTINEL-OPENING",
      closing: "SENTINEL-CLOSING",
    };
    const providers = createMockProviders({ llmReplies: [LONG_REPLY], structured: REPORT });
    const gate = gateTts(providers, SENTENCE_1);
    const { ctl, json } = setup({ providers, interviewer });
    await ctl.start();
    ctl.handleText("one");
    await ctl.settled();
    gate.arm();
    ctl.handleText("two");
    await gate.reached;
    await ctl.interrupt();
    gate.release();
    await ctl.settled();
    // An STT failure exercises the controller's error log line too.
    vi.spyOn(providers.stt, "transcribe").mockRejectedValueOnce(new TypeError("down"));
    ctl.handleAudio(Buffer.alloc(320));
    await ctl.settled();
    await expect(ctl.end()).resolves.toBe("complete");
    expect(err).toHaveBeenCalled();
    expect(phaseChanges(json)).toEqual(["SENTINEL-PHASE-OMEGA"]);
    const all = [...log.mock.calls, ...warn.mock.calls, ...err.mock.calls].flat().join(" ");
    expect(all).toContain("phase 0 -> 1");
    expect(all).not.toContain("SENTINEL");
  });
});

describe("SessionController end and abandon", () => {
  it("end() with zero user turns resolves failed and persists failed", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctl, persist } = setup({ script: { structured: REPORT } });
    await ctl.start();
    await expect(ctl.end()).resolves.toBe("failed");
    expect(persist.persistSessionStatus).toHaveBeenCalledWith("s-1", "failed");
    expect(persist.persistReport).not.toHaveBeenCalled();
    expect(err.mock.calls.flat().join(" ")).toContain("ReportError");
  });

  it("end() after a completed turn persists the report, then complete", async () => {
    const { ctl, persist, storedTurns } = setup({
      script: { structured: REPORT, ttsDelayMs: 5 },
    });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await ctl.settled();
    const result = await ctl.end();
    expect(result).toBe("complete");
    // The last assistant turn was stored before the report.
    expect(storedTurns().map((t) => t.role)).toEqual(["assistant", "user", "assistant"]);
    expect(persist.persistReport).toHaveBeenCalledTimes(1);
    const report = persist.persistReport.mock.calls[0][1];
    expect(report.sessionId).toBe("s-1");
    expect(report.overallAssessment).toBe("Thoughtful and concrete.");
    expect(persist.persistSessionStatus.mock.calls).toEqual([["s-1", "complete"]]);
    const reportOrder = persist.persistReport.mock.invocationCallOrder[0];
    const statusOrder = persist.persistSessionStatus.mock.invocationCallOrder[0];
    expect(reportOrder).toBeLessThan(statusOrder);
    expect(ctl.state).toBe("idle");
  });

  it("end() builds the report prompt from the interviewer snapshot", async () => {
    const providers = createMockProviders({ llmReplies: [LONG_REPLY], structured: REPORT });
    const structured = vi.spyOn(providers.llm, "structured");
    const interviewer = { ...PRESETS[1], name: "Snapshot Name", purpose: "Snapshot purpose." };
    const { ctl } = setup({ providers, interviewer });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await expect(ctl.end()).resolves.toBe("complete");
    const system = structured.mock.calls[0][0].system;
    expect(system).toContain("Snapshot Name");
    expect(system).toContain("Snapshot purpose.");
  });

  it("end() during a speaking reply cancels it like interrupt and reports the committed turns", async () => {
    const providers = createMockProviders({ llmReplies: [LONG_REPLY], structured: REPORT });
    const gate = gateTts(providers, SENTENCE_1);
    const structured = vi.spyOn(providers.llm, "structured");
    const { ctl, events, persist, storedTurns, onEnded } = setup({ providers });
    await ctl.start();
    gate.arm();
    ctl.handleText(LONG_TEXT);
    await gate.reached;
    expect(ctl.state).toBe("speaking");
    const mark = events.length;

    const ending = ctl.end();
    // Cancelled at once, before end() waits for anything.
    expect(gate.signal()?.aborted).toBe(true);
    await expect(ending).resolves.toBe("complete");

    const after = events.slice(mark);
    expect(after.filter((e) => e.kind === "audio")).toHaveLength(0);
    expect(after.map((e) => (e.kind === "audio" ? "audio" : e.msg.type))).not.toContain("tts_end");
    expect(assistantFinals(after)).toEqual([]);
    // The unheard reply is not stored; the report is built from the committed turns.
    expect(storedTurns().map((t) => t.role)).toEqual(["assistant", "user"]);
    expect(ctl.turns.map((t) => t.role)).toEqual(["assistant", "user"]);
    expect(structured).toHaveBeenCalledTimes(1);
    expect(persist.persistReport).toHaveBeenCalledTimes(1);
    expect(persist.persistSessionStatus.mock.calls).toEqual([["s-1", "complete"]]);
    expect(onEnded.mock.calls).toEqual([["complete"]]);
  });

  it("end() while the reply is still thinking aborts the LLM stream and stores no reply", async () => {
    const providers = createMockProviders({ llmReplies: [LONG_REPLY], structured: REPORT });
    let llmSignal: AbortSignal | undefined;
    const realStream = providers.llm.stream.bind(providers.llm);
    let calls = 0;
    providers.llm.stream = (req, signal) => {
      calls += 1;
      if (calls === 1) return realStream(req, signal); // the greeting
      llmSignal = signal;
      return (async function* () {
        await new Promise<void>((_res, rej) =>
          signal.addEventListener("abort", () => rej(abortError()), { once: true }),
        );
        yield "never";
      })();
    };
    const { ctl, types, storedTurns, onEnded } = setup({ providers });
    await ctl.start();
    const before = types().length;
    ctl.handleText(LONG_TEXT);
    const ending = ctl.end();
    expect(llmSignal?.aborted).toBe(true);
    await expect(ending).resolves.toBe("complete");
    const after = types().slice(before);
    expect(after).not.toContain("tts_start");
    expect(after).not.toContain("audio");
    expect(storedTurns().map((t) => t.role)).toEqual(["assistant", "user"]);
    expect(onEnded.mock.calls).toEqual([["complete"]]);
  });

  it("end() resolves failed when report generation fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctl, persist } = setup({ script: { structured: { nope: 1 } } });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await expect(ctl.end()).resolves.toBe("failed");
    expect(persist.persistSessionStatus.mock.calls).toEqual([["s-1", "failed"]]);
    expect(err).toHaveBeenCalled();
  });

  it("a second end() or abandon() after completion is a no-op", async () => {
    const { ctl, persist } = setup({ script: { structured: REPORT } });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await ctl.settled();
    const first = ctl.end();
    const again = ctl.end();
    expect(await first).toBe("complete");
    expect(await again).toBe("complete");
    ctl.abandon();
    await ctl.settled();
    expect(persist.persistSessionStatus.mock.calls).toEqual([["s-1", "complete"]]);
    expect(persist.persistReport).toHaveBeenCalledTimes(1);
  });

  it("ignores input after end()", async () => {
    const { ctl, json } = setup({ script: { structured: REPORT } });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await ctl.end();
    const n = json().length;
    ctl.handleText("too late");
    ctl.handleAudio(Buffer.alloc(320));
    await ctl.settled();
    expect(json().length).toBe(n);
  });

  it("abandon() aborts the in-flight turn and persists abandoned", async () => {
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    const gate = gateTts(providers, SENTENCE_1);
    const { ctl, persist, types, storedTurns, onEnded } = setup({ providers });
    await ctl.start();
    gate.arm();
    const before = types().length;
    ctl.handleText("going away");
    await gate.reached;
    ctl.abandon();
    ctl.abandon();
    await ctl.settled();
    expect(persist.persistSessionStatus.mock.calls).toEqual([["s-1", "abandoned"]]);
    expect(types().slice(before)).not.toContain("tts_end");
    expect(storedTurns().map((t) => t.role)).toEqual(["assistant", "user"]);
    expect(ctl.state).toBe("idle");
    await expect(ctl.end()).resolves.toBe("failed");
    expect(persist.persistSessionStatus.mock.calls).toEqual([["s-1", "abandoned"]]);
    expect(onEnded.mock.calls).toEqual([["abandoned"]]);
  });

  it("abandon() during end() aborts report generation", async () => {
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    vi.spyOn(providers.llm, "structured").mockImplementation(
      (_req, signal) =>
        new Promise((_res, rej) => {
          signal.addEventListener("abort", () => {
            const e = new Error("Aborted");
            e.name = "AbortError";
            rej(e);
          });
        }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctl, persist } = setup({ providers });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await ctl.settled();
    const ending = ctl.end();
    await vi.waitFor(() => expect(providers.llm.structured).toHaveBeenCalled());
    ctl.abandon();
    await expect(ending).resolves.toBe("failed");
    expect(persist.persistSessionStatus.mock.calls[0]).toEqual(["s-1", "abandoned"]);
    expect(persist.persistReport).not.toHaveBeenCalled();
  });
});

describe("SessionController limits", () => {
  it("calls end() automatically when user turns reach maxTurnsPerSession", async () => {
    const { ctl, persist, json } = setup({
      script: { structured: REPORT },
      limits: { maxTurnsPerSession: 2 },
    });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await ctl.settled();
    expect(persist.persistSessionStatus).not.toHaveBeenCalled();
    ctl.handleText("second and last");
    ctl.handleText("over the limit");
    await ctl.settled();
    expect(persist.persistSessionStatus.mock.calls).toEqual([["s-1", "complete"]]);
    const users = json().filter((m) => m.type === "transcript" && m.role === "user");
    expect(users).toHaveLength(2);
    await expect(ctl.end()).resolves.toBe("complete");
  });

  it("idle timeout calls abandon() under fake timers, and activity resets it", async () => {
    vi.useFakeTimers();
    const { ctl, persist } = setup({ limits: { idleTimeoutMs: 1000 } });
    const abandon = vi.spyOn(ctl, "abandon");
    await ctl.start();
    await vi.advanceTimersByTimeAsync(900);
    ctl.handleText("still here");
    await ctl.settled();
    await vi.advanceTimersByTimeAsync(900);
    expect(abandon).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(persist.persistSessionStatus).toHaveBeenCalledWith("s-1", "abandoned");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timers running after end() or abandon()", async () => {
    vi.useFakeTimers();
    const a = setup({ script: { structured: REPORT } });
    await a.ctl.start();
    a.ctl.handleText(LONG_TEXT);
    await a.ctl.end();
    expect(vi.getTimerCount()).toBe(0);

    const b = setup();
    await b.ctl.start();
    expect(vi.getTimerCount()).toBe(1);
    b.ctl.abandon();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("SessionController final transcript commits", () => {
  it("completed turn: final after the last partial, before tts_end, and equal to the stored turn", async () => {
    const { ctl, events, storedTurns } = setup();
    await ctl.start();
    const before = events.length;
    ctl.handleText("hello");
    await ctl.settled();
    const turn = events.slice(before);
    const idx = (pred: (e: Event) => boolean) => turn.findIndex(pred);
    const lastIdx = (pred: (e: Event) => boolean) => turn.map(pred).lastIndexOf(true);
    const isAssistant = (e: Event, partial: boolean) =>
      e.kind === "json" &&
      e.msg.type === "transcript" &&
      e.msg.role === "assistant" &&
      !!e.msg.partial === partial;
    const lastPartial = lastIdx((e) => isAssistant(e, true));
    const final = idx((e) => isAssistant(e, false));
    const ttsEnd = idx((e) => e.kind === "json" && e.msg.type === "tts_end");
    const lastAudio = lastIdx((e) => e.kind === "audio");
    expect(final).toBeGreaterThan(lastPartial);
    expect(final).toBeGreaterThan(lastAudio);
    expect(final).toBeLessThan(ttsEnd);
    expect(assistantFinals(turn)).toEqual([LONG_REPLY]);
    expect(storedTurns().at(-1)).toMatchObject({ role: "assistant", content: LONG_REPLY });
  });

  it("interrupt during the last sentence's TTS: no final transcript, nothing stored", async () => {
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    const gate = gateTts(providers, SENTENCE_2);
    const { ctl, events, storedTurns } = setup({ providers });
    await ctl.start();
    gate.arm();
    const before = events.length;
    ctl.handleText("tell me more");
    await gate.reached;
    await ctl.interrupt();
    await ctl.settled();
    const turn = events.slice(before);
    // Both partials were sent (the LLM had finished), but nothing became final.
    expect(
      turn.filter((e) => e.kind === "json" && e.msg.type === "transcript" && e.msg.partial),
    ).toHaveLength(2);
    expect(assistantFinals(turn)).toEqual([]);
    expect(turn.some((e) => e.kind === "json" && e.msg.type === "tts_end")).toBe(false);
    expect(storedTurns().map((t) => t.role)).toEqual(["assistant", "user"]);
  });

  it("LLM failing mid-stream after one sentence: final and stored turn are that sentence", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    const gate = gateTts(providers, SENTENCE_1);
    const { ctl, events, storedTurns } = setup({ providers });
    await ctl.start();
    gate.arm();
    vi.spyOn(providers.llm, "stream").mockImplementationOnce(async function* () {
      yield `${SENTENCE_1} Could`;
      await gate.reached; // audio for the first sentence has started
      throw new Error("stream dropped");
    });
    const before = events.length;
    ctl.handleText("hello");
    await ctl.settled();
    const turn = events.slice(before);
    expect(assistantFinals(turn)).toEqual([SENTENCE_1]);
    expect(storedTurns().at(-1)).toMatchObject({ role: "assistant", content: SENTENCE_1 });
    expect(turn.filter((e) => e.kind === "json" && e.msg.type === "tts_end")).toHaveLength(1);
    expect(ctl.state).toBe("listening");
  });

  it("provider failure then interrupt before the TTS chain drains: no tts_end, nothing final", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    const gate = gateTts(providers, SENTENCE_1, { ignoreAbort: true });
    const { ctl, events, storedTurns } = setup({ providers });
    await ctl.start();
    gate.arm();
    let failLlm!: () => void;
    const llmGate = new Promise<void>((r) => (failLlm = r));
    vi.spyOn(providers.llm, "stream").mockImplementationOnce(async function* () {
      yield `${SENTENCE_1} Could`;
      await llmGate;
      throw new Error("stream dropped");
    });
    const before = events.length;
    ctl.handleText("hello");
    await gate.reached; // tts_start sent, first chunk out, TTS held
    failLlm();
    await vi.waitFor(() => expect(gate.signal()?.aborted).toBe(true), { interval: 1 });
    const interrupting = ctl.interrupt();
    gate.release();
    await interrupting;
    await ctl.settled();
    const turn = events.slice(before);
    expect(turn.some((e) => e.kind === "json" && e.msg.type === "tts_start")).toBe(true);
    expect(turn.some((e) => e.kind === "json" && e.msg.type === "tts_end")).toBe(false);
    expect(assistantFinals(turn)).toEqual([]);
    expect(storedTurns().map((t) => t.role)).toEqual(["assistant", "user"]);
  });

  it("an AbortError from STT that we did not cause is a provider failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    vi.spyOn(providers.stt, "transcribe").mockRejectedValueOnce(abortError());
    const { ctl, json } = setup({ providers });
    await ctl.start();
    ctl.handleAudio(Buffer.alloc(320));
    await ctl.settled();
    expect(json()).toContainEqual({ type: "stt_error", reason: "stt_failed" });
    expect(ctl.state).toBe("listening");
  });
});

describe("SessionController onEnded", () => {
  it("turn-limit auto-end fires onEnded('complete') once", async () => {
    const { ctl, onEnded } = setup({
      script: { structured: REPORT },
      limits: { maxTurnsPerSession: 1 },
    });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    ctl.handleText("queued and dropped");
    await ctl.settled();
    expect(onEnded.mock.calls).toEqual([["complete"]]);
  });

  it("idle timeout fires onEnded('abandoned') once", async () => {
    vi.useFakeTimers();
    const { ctl, onEnded } = setup({ limits: { idleTimeoutMs: 1000 } });
    await ctl.start();
    await vi.advanceTimersByTimeAsync(1000);
    await ctl.settled();
    expect(onEnded.mock.calls).toEqual([["abandoned"]]);
    await vi.advanceTimersByTimeAsync(5000);
    ctl.abandon();
    await ctl.settled();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("explicit end() then abandon() fires once with complete", async () => {
    const { ctl, onEnded } = setup({ script: { structured: REPORT } });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await ctl.end();
    ctl.abandon();
    await ctl.end();
    await ctl.settled();
    expect(onEnded.mock.calls).toEqual([["complete"]]);
  });

  it("a failing report fires onEnded('failed')", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctl, onEnded } = setup({ script: { structured: { nope: 1 } } });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await ctl.end();
    expect(onEnded.mock.calls).toEqual([["failed"]]);
  });

  it("a refused complete write reports failed, not complete", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctl, persist, onEnded } = setup({ script: { structured: REPORT } });
    persist.persistSessionStatus.mockResolvedValueOnce(false);
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await expect(ctl.end()).resolves.toBe("failed");
    expect(onEnded.mock.calls).toEqual([["failed"]]);
  });

  it("abandon() during end() fires onEnded('abandoned') once", async () => {
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    vi.spyOn(providers.llm, "structured").mockImplementation(
      (_req, signal) =>
        new Promise((_res, rej) => signal.addEventListener("abort", () => rej(abortError()))),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctl, onEnded } = setup({ providers });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await ctl.settled();
    const ending = ctl.end();
    await vi.waitFor(() => expect(providers.llm.structured).toHaveBeenCalled(), { interval: 1 });
    ctl.abandon();
    await ending;
    await ctl.settled();
    expect(onEnded.mock.calls).toEqual([["abandoned"]]);
  });

  it("a throwing onEnded does not break end()", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctl, onEnded } = setup({
      script: { structured: REPORT },
      onEnded: () => {
        throw new RangeError("transport gone");
      },
    });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await expect(ctl.end()).resolves.toBe("complete");
    expect(onEnded).toHaveBeenCalledTimes(1);
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain("onEnded error");
    expect(logged).toContain("RangeError");
    expect(logged).not.toContain("transport gone");
  });
});

describe("SessionController report deadline", () => {
  it("ends failed after reportTimeoutMs when the report never resolves", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    let reportSignal: AbortSignal | undefined;
    // Ignores the abort on purpose: the deadline must not rely on the provider.
    providers.llm.structured = (_req, signal) => {
      reportSignal = signal;
      return new Promise<never>(() => {});
    };
    const { ctl, persist, onEnded } = setup({ providers, limits: { reportTimeoutMs: 5000 } });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await ctl.settled();

    const ending = ctl.end();
    await vi.advanceTimersByTimeAsync(4999);
    expect(onEnded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(ending).resolves.toBe("failed");
    expect(onEnded.mock.calls).toEqual([["failed"]]);
    expect(persist.persistSessionStatus.mock.calls).toEqual([["s-1", "failed"]]);
    expect(reportSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    ctl.abandon();
    await ctl.settled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight turn that never finishes and ends failed at the deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const providers = createMockProviders({ llmReplies: [LONG_REPLY], structured: REPORT });
    const gate = gateTts(providers, SENTENCE_1, { ignoreAbort: true });
    const { ctl, onEnded, persist } = setup({ providers, limits: { reportTimeoutMs: 5000 } });
    await ctl.start();
    gate.arm();
    ctl.handleText(LONG_TEXT);
    await gate.reached;

    const ending = ctl.end();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(ending).resolves.toBe("failed");
    expect(gate.signal()?.aborted).toBe(true);
    expect(onEnded.mock.calls).toEqual([["failed"]]);
    expect(persist.persistSessionStatus.mock.calls).toEqual([["s-1", "failed"]]);
    expect(vi.getTimerCount()).toBe(0);
    gate.release();
  });

  it("reports complete when the deadline's failed write is refused because complete landed", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctl, persist, onEnded } = setup({
      script: { structured: REPORT },
      limits: { reportTimeoutMs: 5000 },
    });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await ctl.settled();
    // The complete write wins in the database but its promise settles after the deadline;
    // the deadline's failed write is then refused.
    persist.persistSessionStatus.mockImplementation(async (_id, status) => {
      if (status !== "complete") return false;
      await new Promise((r) => setTimeout(r, 6000));
      return true;
    });

    const ending = ctl.end();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onEnded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(ending).resolves.toBe("complete");
    expect(onEnded.mock.calls).toEqual([["complete"]]);
    expect(persist.persistSessionStatus.mock.calls.map((c) => c[1])).toEqual(["complete", "failed"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a report that lands just before the deadline completes and clears the timer", async () => {
    vi.useFakeTimers();
    const providers = createMockProviders({ llmReplies: [LONG_REPLY] });
    providers.llm.structured = (req) =>
      new Promise((resolve) => setTimeout(() => resolve(req.schema.parse(REPORT)), 4999));
    const { ctl, persist, onEnded } = setup({ providers, limits: { reportTimeoutMs: 5000 } });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
    await ctl.settled();

    const ending = ctl.end();
    await vi.advanceTimersByTimeAsync(4999);
    await expect(ending).resolves.toBe("complete");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onEnded.mock.calls).toEqual([["complete"]]);
    expect(persist.persistSessionStatus.mock.calls).toEqual([["s-1", "complete"]]);
  });
});
