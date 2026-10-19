/**
 * Keyless end-to-end conversation test.
 *
 * One full session through a real WebSocket against the real app, with mock providers and
 * a temporary SQLite database. No API keys, no network. Message order is asserted from a
 * recorded event log. Failure and abandonment paths are covered in server.test.ts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import WebSocket from "ws";
import { DESIGNER_ID, PRESETS, SYNCED_PRESETS } from "../interviewer/presets";
import { parseInterviewerInput } from "../interviewer/schema";
import type { Providers } from "../providers/types";

const backendDir = path.resolve(__dirname, "../..");
const INTERVIEWER = "tell-a-story";
const PRESET = PRESETS.find((p) => p.id === INTERVIEWER)!;
const TEXT_1 = "zebra-marmalade I lead a delivery team that uses AI assistants.";
const TEXT_2 = "kestrel-pudding we review every change with a shared checklist.";
const STT_TEXT = "quokka-lantern we pair on prompts and keep a library of review checks.";
const REPLY = "Thanks for sharing that with me.";
const REPORT = {
  content: {
    summary: "A short summary.",
    strengths: [{ area: "Delivery", quote: "I lead a delivery team", note: "Leads a team." }],
    developAreas: [{ area: "Metrics", suggestion: "Track outcomes." }],
  },
  deliveryReading: "An even pace.",
  nextSteps: ["Track one outcome next time."],
};

let tmpDir: string;
let dbUrl: string;
let prisma: typeof import("../db").default;
let appMod: typeof import("../app");
let configMod: typeof import("../config");
let mockMod: typeof import("../providers/mock");

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "conversation-test-"));
  dbUrl = `file:${path.join(tmpDir, "test.db")}`;
  process.env.DATABASE_URL = dbUrl;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
  appMod = await import("../app");
  configMod = await import("../config");
  mockMod = await import("../providers/mock");
  prisma = (await import("../db")).default;
  const { syncPresets } = await import("../interviewerStore");
  await syncPresets(SYNCED_PRESETS);
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

let logSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  logSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});
afterEach(() => {
  for (const s of logSpies) s.mockRestore();
});

type Msg = { type: string; [k: string]: unknown };

/** Records every frame in arrival order: JSON messages as labels, audio as "audio". */
class Recorder {
  readonly ws: WebSocket;
  readonly log: string[] = [];
  readonly messages: Msg[] = [];
  readonly closed: Promise<number>;
  private waiters: { label: string; from: number; resolve: () => void }[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("error", () => {});
    this.closed = new Promise((resolve) => this.ws.once("close", (code) => resolve(code)));
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) {
        this.push("audio");
        return;
      }
      const msg = JSON.parse(data.toString()) as Msg;
      this.messages.push(msg);
      const label =
        msg.type === "transcript"
          ? `transcript:${msg.role}${msg.partial ? ":partial" : ""}`
          : msg.type === "phase_change"
            ? `phase_change:${msg.phase}`
            : msg.type;
      this.push(label);
    });
  }

  private push(label: string): void {
    this.log.push(label);
    this.waiters = this.waiters.filter((w) => {
      if (this.log.indexOf(w.label, w.from) < 0) return true;
      w.resolve();
      return false;
    });
  }

  open(): Promise<void> {
    return new Promise((resolve) => this.ws.once("open", () => resolve()));
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolves when `label` is recorded at index >= from (already recorded or future). */
  until(label: string, from = 0): Promise<void> {
    if (this.log.indexOf(label, from) >= 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ label, from, resolve }));
  }
}

describe("keyless conversation", () => {
  it("runs a full session: greeting, text and audio turns, an interrupt, phase change, report", async () => {
    // Fourth TTS call (the reply to the audio turn) yields one chunk, then waits until aborted.
    let ttsCalls = 0;
    const gateAudioReply = (p: Providers) => {
      const real = p.tts.synthesize.bind(p.tts);
      p.tts.synthesize = async function* (sentence, signal) {
        if (++ttsCalls !== 4) {
          yield* real(sentence, signal);
          return;
        }
        yield new Uint8Array([0xff, 0xfb, 0, 0]);
        await new Promise<void>((_, reject) => {
          const abort = () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      };
    };

    const config = configMod.loadConfig({ PROFILE: "mock", DATABASE_URL: dbUrl });
    const providers = mockMod.createMockProviders({ llmReplies: [REPLY], sttTexts: [STT_TEXT], structured: REPORT });
    gateAudioReply(providers);
    const app = appMod.createApp({ config, providers });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const { port } = app.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    try {
      const c = new Recorder(`ws://127.0.0.1:${port}/`);
      await c.open();
      c.send({ type: "session_start", interviewerId: INTERVIEWER });

      // Greeting.
      await c.until("tts_end");
      const sessionId = c.messages[0].sessionId as string;
      expect(c.messages[0].type).toBe("session_started");

      // Two text turns; the second one crosses the preset's intro threshold (2 user turns).
      c.send({ type: "text_input", content: TEXT_1 });
      await c.until("tts_end", c.log.length);
      c.send({ type: "text_input", content: TEXT_2 });
      await c.until("phase_change:share");

      // A binary audio frame, transcribed by the mock STT. Its reply stalls mid-speech.
      const beforeAudio = c.log.length;
      c.ws.send(Buffer.alloc(3200));
      await c.until("latency_metric", beforeAudio);
      c.send({ type: "interrupt" });

      c.send({ type: "session_end" });
      await c.until("session_complete");
      expect(await c.closed).toBe(1000);

      const reply = ["transcript:assistant:partial", "tts_start", "audio", "latency_metric", "audio"];
      const spoken = [...reply, "transcript:assistant", "tts_end"];
      expect(c.log).toEqual([
        "session_started",
        // greeting
        "transcript:assistant:partial",
        "tts_start",
        "audio",
        "audio",
        "transcript:assistant",
        "tts_end",
        // text turn 1
        "transcript:user",
        ...spoken,
        // text turn 2, then the phase change after the second user turn
        "transcript:user",
        ...spoken,
        "phase_change:share",
        // audio turn, cut off mid-reply: no final transcript and no tts_end
        "transcript:user",
        ...reply.slice(0, 4),
        "session_complete",
      ]);
      const complete = c.messages.find((m) => m.type === "session_complete");
      expect(complete?.reportId).toBe(sessionId);
      expect(c.messages.filter((m) => m.type === "phase_change")).toEqual([
        { type: "phase_change", phase: "share" },
      ]);
      expect(c.messages.filter((m) => m.type === "transcript" && m.role === "user").map((m) => m.text)).toEqual([
        TEXT_1,
        TEXT_2,
        STT_TEXT,
      ]);

      const report = await fetch(`${base}/api/session/${sessionId}/report`);
      expect(report.status).toBe(200);
      expect(await report.json()).toMatchObject({
        format: 2,
        sessionId,
        content: { summary: REPORT.content.summary },
        nextSteps: REPORT.nextSteps,
        interviewerName: PRESET.name,
      });

      const transcript = await fetch(`${base}/api/session/${sessionId}/transcript`);
      expect(transcript.status).toBe(200);
      const text = await transcript.text();
      for (const said of [TEXT_1, TEXT_2, STT_TEXT]) expect(text).toContain(`Participant: ${said}`);

      const row = await prisma.session.findUnique({ where: { id: sessionId } });
      expect(row).toMatchObject({ status: "complete", phase: "share", interviewerId: INTERVIEWER });
      // Greeting and two replies are stored; the interrupted reply is not.
      expect(await prisma.conversationTurn.count({ where: { sessionId, role: "assistant" } })).toBe(3);
      expect(await prisma.conversationTurn.count({ where: { sessionId, role: "user" } })).toBe(3);
    } finally {
      await app.close();
    }
  });

  it("runs a designer conversation: greeting, two typed turns, a draft, then session_complete; stores nothing", async () => {
    const DRAFT = {
      name: "Pitch coach",
      purpose: "Practise a two-minute product pitch.",
      persona: "You are a calm, curious pitch coach.",
      style: "You ask one short question at a time.",
      opening: "Greet the person and ask what they are pitching.",
      closing: "Thank the person and say the reflection will follow.",
      phases: [
        { name: "Warm up", instruction: "Ask an easy opening question.", minTurns: 1, maxTurns: 2 },
        { name: "Wrap up", instruction: "Ask what they take away." },
      ],
      focus: ["Clarity of the main point"],
      contentFeedback: true,
      deliveryFeedback: true,
    };
    const counts = async () => [
      await prisma.session.count(),
      await prisma.conversationTurn.count(),
      await prisma.report.count(),
    ];
    const config = configMod.loadConfig({ PROFILE: "mock", DATABASE_URL: dbUrl });
    const providers = mockMod.createMockProviders({ llmReplies: [REPLY], structured: DRAFT });
    const app = appMod.createApp({ config, providers });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const { port } = app.server.address() as AddressInfo;
    const before = await counts();

    try {
      const c = new Recorder(`ws://127.0.0.1:${port}/`);
      await c.open();
      c.send({ type: "session_start", interviewerId: DESIGNER_ID });
      await c.until("tts_end");
      expect(c.messages[0].type).toBe("session_started");
      c.send({ type: "text_input", content: TEXT_1 });
      await c.until("tts_end", c.log.length);
      c.send({ type: "text_input", content: TEXT_2 });
      await c.until("tts_end", c.log.length);
      c.send({ type: "session_end" });
      await c.until("session_complete");
      expect(await c.closed).toBe(1000);

      expect(c.log.slice(-2)).toEqual(["draft", "session_complete"]);
      const draft = c.messages.find((m) => m.type === "draft")?.draft;
      expect(parseInterviewerInput(draft).ok).toBe(true);
      expect(draft).toEqual(DRAFT);
      expect(await counts()).toEqual(before);
    } finally {
      await app.close();
    }
  });

  it("the providers PROFILE=mock builds produce a report that passes the report schema", async () => {
    const { createProviders } = await import("../providers");
    const { generateReport } = await import("../reportGenerator");
    const config = configMod.loadConfig({ PROFILE: "mock", DATABASE_URL: dbUrl });
    const turn = (role: "user" | "assistant", content: string) => ({
      id: `t-${role}`,
      sessionId: "s1",
      role,
      content,
      phase: "intro" as const,
      timestamp: new Date(),
    });
    const report = await generateReport(
      [turn("assistant", REPLY), turn("user", TEXT_1)],
      PRESET,
      createProviders(config).llm,
      new AbortController().signal,
      { showFillerCounts: config.reportFillerCounts },
    );
    expect(report.format).toBe(2);
    expect(report.content?.summary).toContain("Mock report");
    expect(report.nextSteps).toEqual(["Mock next step."]);
  });
});
