import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import WebSocket from "ws";
import type { Config } from "../../config";
import { PRESETS, SYNCED_PRESETS } from "../../interviewer/presets";
import type { InterviewerDefinition, InterviewerInput } from "../../interviewer/schema";
import type { MockScript } from "../../providers/mock";
import type { Providers } from "../../providers/types";

// Shared harness for the server.*.test.ts files. Each file calls setupServerTestEnv() once at its top
// level. The module-level `let`s below are live bindings: they are assigned in beforeAll and read by
// the tests (and by start() below) after that.

const backendDir = path.resolve(__dirname, "../../..");
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const INTERVIEWER = "tell-a-story";
export const PRESET: InterviewerDefinition = PRESETS.find((p) => p.id === INTERVIEWER)!;
export const USER_TEXT = "zebra-marmalade I lead a delivery team that uses AI assistants for code review.";
export const STT_TEXT = "quokka-lantern we pair on prompts and keep a shared library of review checks.";
export const LLM_REPLY = "Thanks for sharing that with me. Could you tell me a little more about it?";
export const VALID_REPORT = {
  content: {
    summary: "A short summary.",
    strengths: [{ area: "Delivery", quote: "I lead a delivery team", note: "Leads a team." }],
    developAreas: [{ area: "Metrics", suggestion: "Track outcomes." }],
  },
  deliveryReading: "An even pace.",
  nextSteps: ["Track one outcome next time."],
};

export let tmpDir: string;
export let dbUrl: string;
export let appMod: typeof import("../../app");
export let configMod: typeof import("../../config");
export let mockMod: typeof import("../../providers/mock");
export let persistence: typeof import("../../persistence");
export let registry: typeof import("../../sessionRegistry");
export let store: typeof import("../../interviewerStore");
export let prisma: typeof import("../../db").default;

export const running: Running[] = [];
export const createdCustom: string[] = [];
let logSpies: ReturnType<typeof vi.spyOn>[] = [];

export interface Running {
  port: number;
  base: string;
  ws: string;
  close(): Promise<void>;
}

export function setupServerTestEnv(): void {
  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "server-test-"));
    dbUrl = `file:${path.join(tmpDir, "test.db")}`;
    process.env.DATABASE_URL = dbUrl;
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });
    appMod = await import("../../app");
    configMod = await import("../../config");
    mockMod = await import("../../providers/mock");
    persistence = await import("../../persistence");
    registry = await import("../../sessionRegistry");
    store = await import("../../interviewerStore");
    prisma = (await import("../../db")).default;
    await store.syncPresets(SYNCED_PRESETS);
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Every console call is captured (keeps output pristine and lets tests inspect logs).
  beforeEach(() => {
    logSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
  });
  afterEach(() => {
    for (const s of logSpies) s.mockRestore();
  });

  afterEach(async () => {
    while (running.length) await running.pop()!.close();
  });

  // Custom interviewers a test created (owner "local"), removed so the 50 cap is never reached.
  afterEach(async () => {
    for (const id of createdCustom.splice(0)) await store.deleteInterviewer(id, "local");
  });
}

export function allLogText(): string {
  return logSpies
    .flatMap((s) => s.mock.calls)
    .map((args) => args.map((a: unknown) => (a instanceof Error ? `${a.name} ${a.message}` : String(a))).join(" "))
    .join("\n");
}

export function makeConfig(
  env: Record<string, string> = {},
  overrides: { limits?: Partial<Config["limits"]>; debugLogText?: boolean } = {},
): Config {
  const base = configMod.loadConfig({ PROFILE: "mock", DATABASE_URL: dbUrl, ...env });
  return {
    ...base,
    ...(overrides.debugLogText !== undefined ? { debugLogText: overrides.debugLogText } : {}),
    limits: { ...base.limits, ...overrides.limits },
  };
}

export async function start(
  opts: {
    config?: Config;
    script?: MockScript;
    customize?: (p: Providers) => void;
    persist?: typeof import("../../persistence");
    interviewers?: typeof import("../../interviewerStore");
  } = {},
): Promise<Running> {
  const config = opts.config ?? makeConfig();
  const providers = mockMod.createMockProviders({
    llmReplies: [LLM_REPLY],
    sttTexts: [STT_TEXT],
    structured: VALID_REPORT,
    ...opts.script,
  });
  opts.customize?.(providers);
  const app = appMod.createApp({ config, providers, persist: opts.persist, interviewers: opts.interviewers });
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address() as AddressInfo;
  const r: Running = {
    port,
    base: `http://127.0.0.1:${port}`,
    ws: `ws://127.0.0.1:${port}`,
    close: () => app.close(),
  };
  running.push(r);
  return r;
}

export type Msg = { type: string; [k: string]: unknown };

export class Client {
  readonly ws: WebSocket;
  readonly messages: Msg[] = [];
  readonly binary: number[] = [];
  readonly opened: Promise<void>;
  readonly closed: Promise<{ code: number; reason: string }>;
  readonly rejected: Promise<number>;
  private waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];

  constructor(url: string, options: WebSocket.ClientOptions = {}) {
    this.ws = new WebSocket(url, options);
    this.opened = new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("unexpected-response", () => reject(new Error("upgrade refused")));
    });
    this.opened.catch(() => {});
    this.rejected = new Promise((resolve) => {
      this.ws.once("unexpected-response", (_req, res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
      });
    });
    this.closed = new Promise((resolve) => {
      this.ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    this.ws.on("error", () => {});
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) {
        this.binary.push((data as Buffer).length);
        return;
      }
      const msg = JSON.parse(data.toString()) as Msg;
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(msg)) return true;
        w.resolve(msg);
        return false;
      });
    });
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolves with the first message (already received or future) matching pred. */
  next(pred: (m: Msg) => boolean, from = 0): Promise<Msg> {
    const found = this.messages.slice(from).find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve) => this.waiters.push({ pred, resolve }));
  }

  /** Waits for a final assistant transcript after index `from`. */
  assistantFinal(from = 0): Promise<Msg> {
    return this.next((m) => m.type === "transcript" && m.role === "assistant" && !m.partial, from);
  }

  async startSession(extra: Record<string, unknown> = {}): Promise<string> {
    await this.opened;
    this.send({ type: "session_start", interviewerId: INTERVIEWER, ...extra });
    const started = await this.next((m) => m.type === "session_started");
    return started.sessionId as string;
  }
}

export function connect(r: Running, options: WebSocket.ClientOptions = {}, query = ""): Client {
  return new Client(`${r.ws}/${query}`, options);
}

// Interviewer-written text that must never reach the logs.
export const SENTINEL_NAME = "Okapi-sentinel-name";
export const SENTINEL_PERSONA = "okapi-sentinel-persona";
export const CUSTOM_PHASES = ["okapi-sentinel-warm", "okapi-sentinel-middle", "okapi-sentinel-end"];

/** A custom interviewer: three named phases, the first ending after 1 user turn, the second after 2. */
export function customInput(): InterviewerInput {
  const { id: _id, source: _s, ownerId: _o, version: _v, createdAt: _c, updatedAt: _u, ...rest } = PRESET;
  return {
    ...rest,
    name: SENTINEL_NAME,
    persona: `You are ${SENTINEL_PERSONA}, a calm and curious listener.`,
    phases: [
      { name: CUSTOM_PHASES[0], instruction: "Ask what they want to talk about.", minTurns: 1, maxTurns: 1 },
      { name: CUSTOM_PHASES[1], instruction: "Ask one follow-up question.", minTurns: 1, maxTurns: 2 },
      { name: CUSTOM_PHASES[2], instruction: "Thank them and close." },
    ],
  };
}

/** Sends a text turn and waits for the reply to finish. */
export async function textTurn(c: Client): Promise<void> {
  const mark = c.messages.length;
  c.send({ type: "text_input", content: USER_TEXT });
  await c.assistantFinal(mark);
}

/** Resolves when `count` phase_change messages have been received. */
export async function phaseChanges(c: Client, count: number): Promise<string[]> {
  await vi.waitFor(() => expect(c.messages.filter((m) => m.type === "phase_change").length).toBe(count));
  return c.messages.filter((m) => m.type === "phase_change").map((m) => m.phase as string);
}

// ── Report API and regenerate ────────────────────────────────────────────────

export const MEASURED: import("../../delivery/metrics").TurnMetrics = {
  wordCount: 14,
  timedWordCount: 14,
  durationSec: 6,
  wordsPerMinute: 140,
  pauseCount: 1,
  longestPauseSec: 0.9,
  responseGapMs: 800,
  fillerCount: 0,
};

/**
 * A stored session for `owner` in `status`. By default it has the preset snapshot, one user
 * turn and one interviewer turn.
 */
export async function seedStored(
  id: string,
  owner: string,
  status: "failed" | "complete" | "abandoned" | "active",
  opts: {
    userTurns?: number;
    snapshot?: InterviewerDefinition | null;
    metrics?: import("../../delivery/metrics").TurnMetrics;
    userText?: string;
  } = {},
): Promise<void> {
  await persistence.persistSessionCreate(id, owner, opts.snapshot ?? PRESET);
  if (opts.snapshot === null) await prisma.session.update({ where: { id }, data: { interviewerJson: null } });
  const t0 = Date.now() - 60_000;
  await persistence.persistTurn({
    id: `${id}-a0`,
    sessionId: id,
    role: "assistant",
    content: LLM_REPLY,
    phase: "intro",
    timestamp: new Date(t0),
  });
  for (let i = 0; i < (opts.userTurns ?? 1); i++) {
    await persistence.persistTurn({
      id: `${id}-u${i}`,
      sessionId: id,
      role: "user",
      content: opts.userText ?? USER_TEXT,
      phase: "intro",
      timestamp: new Date(t0 + 1000 * (i + 1)),
      ...(opts.metrics ? { metrics: opts.metrics } : {}),
    });
  }
  if (status !== "active") await persistence.persistSessionStatus(id, status);
}

export function regenerate(r: Running, id: string): Promise<Response> {
  return fetch(`${r.base}/api/session/${id}/report/regenerate`, { method: "POST" });
}

export async function statusOf(id: string): Promise<string | undefined> {
  return (await prisma.session.findUnique({ where: { id } }))?.status;
}

/** Replaces the report call with a counting one; `impl` decides each call's outcome. */
export function structuredWith(impl: (call: number, req: Parameters<Providers["llm"]["structured"]>[0]) => Promise<unknown>) {
  const calls = { n: 0 };
  const customize = (p: Providers) => {
    p.llm.structured = (async (req: Parameters<Providers["llm"]["structured"]>[0]) => {
      calls.n += 1;
      return impl(calls.n, req);
    }) as Providers["llm"]["structured"];
  };
  return { calls, customize };
}
