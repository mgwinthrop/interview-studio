import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createCallsDraftMaker, createDraftMaker } from "../app";
import { loadConfig, type Config } from "../config";
import { PRESETS } from "../interviewer/presets";
import { createCloudProviders } from "../providers/cloud";
import { createMockProviders, type MockScript } from "../providers/mock";
import type { LlmProvider, Providers } from "../providers/types";
import { SessionController, type ControllerDeps } from "../sessionController";
import { BUILT_IN, type SettingsValues } from "../settings";
import { staticSettings, type SettingsSource } from "../settingsService";
import { EPHEMERAL_PERSIST } from "../ephemeralPersist";
import type { ConversationTurn, ReportV2, ServerToClientMessage, SessionStatus } from "../types";
import type { UsageRecord } from "../usage";

// Settings reach every model call: a session takes one snapshot for its conversation, while
// the report or draft at its end, and the HTTP draft makers, read settings when they run.

const REPLY = "Thanks for sharing that with me. Could you tell me a little more about it?";
const USER_TEXT = "I lead a delivery team and we have been using AI assistants for code review and tests.";
const REPORT = {
  content: {
    summary: "A good conversation.",
    strengths: [{ area: "Clarity", quote: "We use AI for review", note: "Explained the team setup" }],
    developAreas: [{ area: "Depth", suggestion: "Give a concrete metric" }],
  },
  deliveryReading: "An even pace throughout.",
  nextSteps: ["Thoughtful and concrete: lead with one example."],
};
const DRAFT = {
  name: "Pitch coach",
  purpose: "Practise a short pitch.",
  persona: "You are a calm, curious pitch coach.",
  style: "You ask one short question at a time.",
  opening: "Greet the person and ask about their pitch.",
  closing: "Thank them and wish them luck.",
  phases: [
    { name: "Warm up", instruction: "Ask what they pitch.", minTurns: 1, maxTurns: 2 },
    { name: "Practise", instruction: "Ask them to pitch.", minTurns: 1, maxTurns: 3 },
    { name: "Wrap up", instruction: "Ask what they will change." },
  ],
  focus: ["How clearly they open"],
  contentFeedback: true,
  deliveryFeedback: true,
};

const CUSTOM: Partial<SettingsValues> = {
  replyModel: "m-reply",
  replyMaxTokens: 123,
  sttModel: "s-1",
  ttsModel: "t-1",
  spokenFormat: "mp3_22050_32",
};

function makeConfig(): Config {
  return loadConfig({ PROFILE: "mock" });
}

function makePersist() {
  return {
    persistTurn: vi.fn(async (_t: ConversationTurn) => {}),
    persistPhaseTransition: vi.fn(async (_id: string, _phase: string) => {}),
    persistSessionStatus: vi.fn(async (_id: string, _status: SessionStatus) => true),
    persistReport: vi.fn(async (_id: string, _report: ReportV2) => {}),
  };
}

/** Wraps providers so every call's per-call options are recorded, then delegates. */
function recording(base: Providers) {
  const rec = {
    stream: [] as { model?: string; maxTokens: number }[],
    structured: [] as { model?: string; maxTokens: number }[],
    transcribe: [] as unknown[],
    synthesize: [] as unknown[],
  };
  const providers: Providers = {
    stt: {
      transcribe(pcm, signal, opts) {
        rec.transcribe.push(opts);
        return base.stt.transcribe(pcm, signal, opts);
      },
    },
    tts: {
      synthesize(sentence, signal, opts) {
        rec.synthesize.push(opts);
        return base.tts.synthesize(sentence, signal, opts);
      },
    },
    llm: {
      stream(req, signal) {
        rec.stream.push({ model: req.model, maxTokens: req.maxTokens });
        return base.llm.stream(req, signal);
      },
      structured(req, signal) {
        rec.structured.push({ model: req.model, maxTokens: req.maxTokens });
        return base.llm.structured(req, signal);
      },
    },
  };
  return { providers, rec };
}

/** A settings source whose values can be changed between calls; `fail` makes the next get reject. */
function mutableSettings(initial: Partial<SettingsValues> = {}) {
  const state = { values: { ...BUILT_IN, ...initial } as SettingsValues, failNext: 0 };
  const get = vi.fn(async (_ownerId: string) => {
    if (state.failNext > 0) {
      state.failNext -= 1;
      throw new TypeError("okapi-settings-secret-value");
    }
    return { ...state.values };
  });
  return { source: { get } satisfies SettingsSource, state, get };
}

/** A settings source whose first get waits for release(). */
function gatedSettings(values: Partial<SettingsValues>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const get = vi.fn(async (_ownerId: string) => {
    await gate;
    return { ...BUILT_IN, ...values };
  });
  return { source: { get } satisfies SettingsSource, release: () => release(), get };
}

function setup(
  opts: {
    settings?: SettingsSource;
    kind?: ControllerDeps["kind"];
    script?: MockScript;
    providers?: Providers;
  } = {},
) {
  const { providers, rec } = recording(
    opts.providers ??
      createMockProviders({ llmReplies: [REPLY], sttTexts: [USER_TEXT], structured: REPORT, ...opts.script }),
  );
  const events: ServerToClientMessage[] = [];
  const persist = opts.kind && opts.kind !== "interview" ? EPHEMERAL_PERSIST : makePersist();
  const ctl = new SessionController({
    ...(opts.kind ? { kind: opts.kind } : {}),
    sessionId: "s-1",
    ownerId: "owner-1",
    interviewer: PRESETS[0],
    demo: false,
    providers,
    config: makeConfig(),
    sendJson: (msg) => events.push(msg),
    sendAudio: () => {},
    persist,
    ...(opts.settings ? { settings: opts.settings } : {}),
  });
  return { ctl, rec, events };
}

async function textTurn(ctl: SessionController): Promise<void> {
  ctl.handleText(USER_TEXT);
  await ctl.settled();
}

let errorSpy: ReturnType<typeof vi.spyOn>;
afterEach(() => {
  errorSpy?.mockRestore();
  vi.restoreAllMocks();
});
function captureErrors() {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  return () => errorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
}

describe("a session's snapshot", () => {
  it("sends the snapshot's reply model, max tokens, speech models and spoken format", async () => {
    const { ctl, rec } = setup({ settings: staticSettings(CUSTOM) });
    await ctl.start();
    ctl.handleAudio(Buffer.alloc(3200));
    await ctl.settled();
    expect(rec.stream.length).toBe(2);
    for (const s of rec.stream) expect(s).toEqual({ model: "m-reply", maxTokens: 123 });
    expect(rec.transcribe).toEqual([{ modelId: "s-1" }]);
    expect(rec.synthesize.length).toBeGreaterThan(0);
    for (const s of rec.synthesize) expect(s).toEqual({ modelId: "t-1", outputFormat: "mp3_22050_32" });
  });

  it("without settings every call uses the BUILT_IN values", async () => {
    const { ctl, rec } = setup();
    await ctl.start();
    ctl.handleAudio(Buffer.alloc(3200));
    await ctl.settled();
    for (const s of rec.stream) expect(s).toEqual({ model: BUILT_IN.replyModel, maxTokens: 300 });
    expect(rec.transcribe).toEqual([{ modelId: BUILT_IN.sttModel }]);
    for (const s of rec.synthesize) {
      expect(s).toEqual({ modelId: BUILT_IN.ttsModel, outputFormat: BUILT_IN.spokenFormat });
    }
    await ctl.end();
    expect(rec.structured).toEqual([{ model: BUILT_IN.reportModel, maxTokens: 3072 }]);
  });

  it("is not refreshed mid-session; a later session gets the new values; the report reads settings at the end", async () => {
    const { source, state, get } = mutableSettings({ replyModel: "m-old", replyMaxTokens: 111, reportModel: "r-old" });
    const a = setup({ settings: source });
    await a.ctl.start();
    state.values = { ...state.values, replyModel: "m-new", replyMaxTokens: 222, ttsModel: "t-new" };
    await textTurn(a.ctl);
    expect(a.rec.stream).toEqual([
      { model: "m-old", maxTokens: 111 },
      { model: "m-old", maxTokens: 111 },
    ]);
    for (const s of a.rec.synthesize) expect(s).toMatchObject({ modelId: BUILT_IN.ttsModel });

    const b = setup({ settings: source });
    await b.ctl.start();
    expect(b.rec.stream).toEqual([{ model: "m-new", maxTokens: 222 }]);
    for (const s of b.rec.synthesize) expect(s).toMatchObject({ modelId: "t-new" });

    state.values = { ...state.values, reportModel: "r-new" };
    expect(await a.ctl.end()).toBe("complete");
    expect(a.rec.structured).toEqual([{ model: "r-new", maxTokens: 3072 }]);
    // One read at each session's start, one at a's end: none per turn.
    expect(get).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenCalledWith("owner-1");
    await b.ctl.end();
  });

  it("an utterance arriving before the snapshot has resolved waits for it and uses it", async () => {
    const { source, release, get } = gatedSettings(CUSTOM);
    const { ctl, rec } = setup({ settings: source });
    const started = ctl.start();
    ctl.handleText(USER_TEXT);
    ctl.handleAudio(Buffer.alloc(3200));
    await new Promise((r) => setTimeout(r, 20));
    expect(rec.stream).toEqual([]);
    expect(rec.transcribe).toEqual([]);
    release();
    await started;
    await ctl.settled();
    expect(rec.stream.length).toBe(3);
    for (const s of rec.stream) expect(s).toEqual({ model: "m-reply", maxTokens: 123 });
    expect(rec.transcribe).toEqual([{ modelId: "s-1" }]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("an interrupt while the snapshot is pending cancels the turn at once; later turns use the snapshot", async () => {
    const { source, release } = gatedSettings(CUSTOM);
    const { ctl, rec, events } = setup({ settings: source });
    const started = ctl.start();
    let interrupted = false;
    const interrupt = ctl.interrupt().then(() => (interrupted = true));
    await new Promise((r) => setTimeout(r, 20));
    // Settled without the snapshot: the interrupt never waits on settings.
    expect(interrupted).toBe(true);
    await started;
    await interrupt;
    expect(ctl.state).toBe("listening");
    expect(rec.stream).toEqual([]);
    expect(events.filter((e) => e.type === "transcript")).toEqual([]);
    release();
    await textTurn(ctl);
    expect(rec.stream).toEqual([{ model: "m-reply", maxTokens: 123 }]);
    expect(ctl.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("a settings read that rejects at the start falls back to BUILT_IN; only the error class is logged", async () => {
    const logs = captureErrors();
    const { source, state } = mutableSettings({ replyModel: "m-reply", reportModel: "r-1" });
    state.failNext = 1;
    const { ctl, rec } = setup({ settings: source });
    await ctl.start();
    await textTurn(ctl);
    for (const s of rec.stream) expect(s).toEqual({ model: BUILT_IN.replyModel, maxTokens: BUILT_IN.replyMaxTokens });
    expect(ctl.turns.map((t) => t.role)).toEqual(["assistant", "user", "assistant"]);
    expect(await ctl.end()).toBe("complete");
    // The end-of-session read succeeds and is fresh.
    expect(rec.structured.map((s) => s.model)).toEqual(["r-1"]);
    expect(logs()).toContain("TypeError");
    expect(logs()).not.toContain("okapi-settings-secret-value");
    expect(logs()).not.toContain("m-reply");
  });

  it("a settings read that rejects at the end falls back to the snapshot for the report", async () => {
    const logs = captureErrors();
    const { source, state } = mutableSettings({ reportModel: "r-start" });
    const { ctl, rec } = setup({ settings: source });
    await ctl.start();
    await textTurn(ctl);
    state.values = { ...state.values, reportModel: "r-never" };
    state.failNext = 1;
    expect(await ctl.end()).toBe("complete");
    expect(rec.structured.map((s) => s.model)).toEqual(["r-start"]);
    expect(logs()).not.toContain("okapi-settings-secret-value");
  });
});

describe("designer and trial sessions", () => {
  it("a designer session uses replyModel for the conversation and draftModel for its draft", async () => {
    const { source, state } = mutableSettings({ replyModel: "m-reply", draftModel: "d-start" });
    const { ctl, rec, events } = setup({ settings: source, kind: "designer", script: { structured: DRAFT } });
    await ctl.start();
    await textTurn(ctl);
    state.values = { ...state.values, draftModel: "d-end" };
    expect(await ctl.end()).toBe("complete");
    for (const s of rec.stream) expect(s.model).toBe("m-reply");
    expect(rec.structured.map((s) => s.model)).toEqual(["d-end"]);
    expect(events.some((e) => e.type === "draft")).toBe(true);
  });

  it("a trial session uses replyModel and makes no final model call", async () => {
    const { ctl, rec } = setup({ settings: staticSettings({ replyModel: "m-reply", draftModel: "d-1" }), kind: "trial" });
    await ctl.start();
    await textTurn(ctl);
    expect(await ctl.end()).toBe("complete");
    expect(rec.stream.length).toBe(2);
    for (const s of rec.stream) expect(s.model).toBe("m-reply");
    expect(rec.structured).toEqual([]);
  });
});

describe("HTTP draft makers", () => {
  const LEAKY = { ...DRAFT, behaviours: "You sound like Priya Shah when price comes up." };
  const CALL = [
    "Our side 1: So what matters most to you?",
    "Buyer: Price, honestly. We got burned by the last vendor.",
    "Our side 1: Understood.",
    "Buyer: And we need references before anything else.",
  ].join("\n");

  function sequenceLlm(...outputs: unknown[]) {
    const models: (string | undefined)[] = [];
    const llm: LlmProvider = {
      stream: async function* () {},
      async structured(req) {
        models.push(req.model);
        return req.schema.parse(outputs[Math.min(models.length - 1, outputs.length - 1)]);
      },
    };
    return { llm, models };
  }

  it("the description draft maker reads settings per request and passes draftModel", async () => {
    const { source, state, get } = mutableSettings({ draftModel: "d-1" });
    const { llm, models } = sequenceLlm(DRAFT);
    const make = createDraftMaker(makeConfig(), llm, source);
    const text = "An interviewer that helps me rehearse a hard conversation with my manager.";
    expect((await make("owner-1", text)).ok).toBe(true);
    state.values = { ...state.values, draftModel: "d-2" };
    expect((await make("owner-1", text)).ok).toBe(true);
    expect(models).toEqual(["d-1", "d-2"]);
    expect(get).toHaveBeenCalledWith("owner-1");
  });

  it("the calls draft maker passes draftModel on the first call and on the leak retry", async () => {
    const { llm, models } = sequenceLlm(LEAKY, DRAFT);
    const make = createCallsDraftMaker(makeConfig(), llm, staticSettings({ draftModel: "d-calls" }));
    const out = await make("owner-1", [{ text: CALL, forbidden: ["Priya Shah", "Priya", "Shah"] }]);
    expect(out.ok).toBe(true);
    expect(models).toEqual(["d-calls", "d-calls"]);
  });

  it("without settings the draft makers use the BUILT_IN draft model", async () => {
    const a = sequenceLlm(DRAFT);
    await createDraftMaker(makeConfig(), a.llm)("o", "An interviewer that helps me rehearse a pitch to investors.");
    const b = sequenceLlm(DRAFT);
    await createCallsDraftMaker(makeConfig(), b.llm)("o", [{ text: CALL, forbidden: [] }]);
    expect([...a.models, ...b.models]).toEqual([BUILT_IN.draftModel, BUILT_IN.draftModel]);
  });
});

describe("usage rows carry the model actually used", () => {
  it("a conversation turn and the report record the settings' models", async () => {
    const usage = { input_tokens: 10, output_tokens: 5 };
    const create = vi.fn(async (_params: { model: string }) => ({
      content: [{ type: "text", text: JSON.stringify(REPORT) }],
      usage,
    }));
    const stream = vi.fn((_params: { model: string }) =>
      (async function* () {
        yield { type: "message_start", message: { usage } };
        yield { type: "content_block_delta", delta: { type: "text_delta", text: REPLY } };
        yield { type: "message_delta", usage: { output_tokens: 5 } };
      })(),
    );
    const anthropic = { messages: { create, stream } } as unknown as Pick<Anthropic, "messages">;
    const records: UsageRecord[] = [];
    const cloud = createCloudProviders(makeConfig(), { anthropic, onUsage: (r) => records.push(r) });
    const mock = createMockProviders();
    const { ctl } = setup({
      providers: { stt: mock.stt, tts: mock.tts, llm: cloud.llm },
      settings: staticSettings({ replyModel: "m-reply", reportModel: "r-1" }),
    });
    await ctl.start();
    await textTurn(ctl);
    expect(await ctl.end()).toBe("complete");
    expect(stream.mock.calls.map((c) => c[0].model)).toEqual(["m-reply", "m-reply"]);
    expect(create.mock.calls.map((c) => c[0].model)).toEqual(["r-1"]);
    expect(records.map((r) => [r.feature, r.model])).toEqual([
      ["conversation", "m-reply"],
      ["conversation", "m-reply"],
      ["report", "r-1"],
    ]);
  });
});
