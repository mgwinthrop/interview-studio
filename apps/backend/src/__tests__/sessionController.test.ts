import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionController, type ControllerDeps } from "../sessionController";
import { createMockProviders, type MockScript } from "../providers/mock";
import { loadConfig, type Config } from "../config";
import type {
  ConversationTurn,
  Phase,
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
    persistPhaseTransition: vi.fn(async (_id: string, _phase: Phase) => {}),
    persistSessionStatus: vi.fn(async (_id: string, _status: SessionStatus) => true),
    persistReport: vi.fn(async (_id: string, _report: Report) => {}),
  };
}

function setup(
  opts: {
    script?: MockScript;
    demo?: boolean;
    limits?: Partial<Config["limits"]>;
    providers?: ControllerDeps["providers"];
  } = {},
) {
  const events: Event[] = [];
  const persist = makePersist();
  const ctl = new SessionController({
    sessionId: "s-1",
    ownerId: "owner-1",
    topicId: "ai-se-delivery",
    demo: opts.demo ?? false,
    providers: opts.providers ?? createMockProviders({ llmReplies: [LONG_REPLY], ...opts.script }),
    config: makeConfig(opts.limits),
    sendJson: (msg) => events.push({ kind: "json", msg }),
    sendAudio: (chunk) => events.push({ kind: "audio", bytes: chunk.length }),
    persist,
  });
  const types = () => events.map((e) => (e.kind === "audio" ? "audio" : e.msg.type));
  const json = () =>
    events.flatMap((e) => (e.kind === "json" ? [e.msg] : [])) as ServerToClientMessage[];
  const storedTurns = () => persist.persistTurn.mock.calls.map((c) => c[0]);
  return { ctl, events, persist, types, json, storedTurns };
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
    const { ctl, types, storedTurns } = setup({ script: { ttsDelayMs: 20 } });
    await ctl.start();
    const before = types().length;
    ctl.handleText("tell me more");
    await vi.waitFor(() => expect(types().slice(before)).toContain("audio"));
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

describe("SessionController phases", () => {
  it("moves intro -> share_work after the second user turn", async () => {
    const { ctl, json, persist } = setup();
    await ctl.start();
    ctl.handleText("one");
    await ctl.settled();
    expect(json().some((m) => m.type === "phase_change")).toBe(false);
    ctl.handleText("two");
    await ctl.settled();
    expect(json().filter((m) => m.type === "phase_change")).toEqual([
      { type: "phase_change", phase: "share_work" },
    ]);
    expect(persist.persistPhaseTransition).toHaveBeenCalledWith("s-1", "share_work");
  });

  it("respects demo thresholds: intro after 1, share_work until 5, deep_dive until 10", async () => {
    const { ctl, json } = setup({ demo: true });
    await ctl.start();
    const phasesAfter: (string | undefined)[] = [];
    for (let i = 1; i <= 10; i++) {
      ctl.handleText(`answer ${i}`);
      await ctl.settled();
      const changes = json().filter((m) => m.type === "phase_change");
      phasesAfter.push((changes.at(-1) as { phase: string } | undefined)?.phase);
    }
    expect(phasesAfter[0]).toBe("share_work");
    expect(phasesAfter[3]).toBe("share_work");
    expect(phasesAfter[4]).toBe("deep_dive");
    expect(phasesAfter[8]).toBe("deep_dive");
    expect(phasesAfter[9]).toBe("wrap_up");
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

  it("end() waits for the in-flight turn, persists the report, then complete", async () => {
    const { ctl, persist, storedTurns } = setup({
      script: { structured: REPORT, ttsDelayMs: 5 },
    });
    await ctl.start();
    ctl.handleText(LONG_TEXT);
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
    const { ctl, persist, types, storedTurns } = setup({ script: { ttsDelayMs: 20 } });
    await ctl.start();
    const before = types().length;
    ctl.handleText("going away");
    await vi.waitFor(() => expect(types().slice(before)).toContain("audio"));
    ctl.abandon();
    ctl.abandon();
    await ctl.settled();
    expect(persist.persistSessionStatus.mock.calls).toEqual([["s-1", "abandoned"]]);
    expect(types().slice(before)).not.toContain("tts_end");
    expect(storedTurns().map((t) => t.role)).toEqual(["assistant", "user"]);
    expect(ctl.state).toBe("idle");
    await expect(ctl.end()).resolves.toBe("failed");
    expect(persist.persistSessionStatus.mock.calls).toEqual([["s-1", "abandoned"]]);
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
