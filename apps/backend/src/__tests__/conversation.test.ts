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
import type { Providers } from "../providers/types";

const backendDir = path.resolve(__dirname, "../..");
const TOPIC = "ai-se-delivery";
const TEXT_1 = "zebra-marmalade I lead a delivery team that uses AI assistants.";
const TEXT_2 = "kestrel-pudding we review every change with a shared checklist.";
const STT_TEXT = "quokka-lantern we pair on prompts and keep a library of review checks.";
const REPLY = "Thanks for sharing that with me.";
const REPORT = {
  summary: "A short summary.",
  strengths: [{ area: "Delivery", evidence: "Leads a team." }],
  improvements: [{ area: "Metrics", suggestion: "Track outcomes." }],
  highlights: ["uses AI assistants"],
  overall_assessment: "Solid.",
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
      c.send({ type: "session_start", topicId: TOPIC });

      // Greeting.
      await c.until("tts_end");
      const sessionId = c.messages[0].sessionId as string;
      expect(c.messages[0].type).toBe("session_started");

      // Two text turns; the second one crosses the intro threshold.
      c.send({ type: "text_input", content: TEXT_1 });
      await c.until("tts_end", c.log.length);
      c.send({ type: "text_input", content: TEXT_2 });
      await c.until("phase_change:share_work");

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
        "phase_change:share_work",
        // audio turn, cut off mid-reply: no final transcript and no tts_end
        "transcript:user",
        ...reply.slice(0, 4),
        "session_complete",
      ]);
      const complete = c.messages.find((m) => m.type === "session_complete");
      expect(complete?.reportId).toBe(sessionId);
      expect(c.messages.filter((m) => m.type === "phase_change")).toEqual([
        { type: "phase_change", phase: "share_work" },
      ]);
      expect(c.messages.filter((m) => m.type === "transcript" && m.role === "user").map((m) => m.text)).toEqual([
        TEXT_1,
        TEXT_2,
        STT_TEXT,
      ]);

      const report = await fetch(`${base}/api/session/${sessionId}/report`);
      expect(report.status).toBe(200);
      expect(await report.json()).toMatchObject({ sessionId, summary: REPORT.summary });

      const transcript = await fetch(`${base}/api/session/${sessionId}/transcript`);
      expect(transcript.status).toBe(200);
      const text = await transcript.text();
      for (const said of [TEXT_1, TEXT_2, STT_TEXT]) expect(text).toContain(`Participant: ${said}`);

      const row = await prisma.session.findUnique({ where: { id: sessionId } });
      expect(row).toMatchObject({ status: "complete", phase: "share_work", topicId: TOPIC });
      // Greeting and two replies are stored; the interrupted reply is not.
      expect(await prisma.conversationTurn.count({ where: { sessionId, role: "assistant" } })).toBe(3);
      expect(await prisma.conversationTurn.count({ where: { sessionId, role: "user" } })).toBe(3);
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
      TOPIC,
      createProviders(config).llm,
      new AbortController().signal,
    );
    expect(report.summary).toContain("Mock report");
  });
});
