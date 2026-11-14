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

// Shared harness for the server.*.test.ts files. Each file calls `const env = setupServerTestEnv()`
// once at its top level and reads the handles (env.prisma, env.store, ...) inside tests and hooks.

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

type Handles = {
  appMod: typeof import("../../app");
  configMod: typeof import("../../config");
  mockMod: typeof import("../../providers/mock");
  persistence: typeof import("../../persistence");
  registry: typeof import("../../sessionRegistry");
  store: typeof import("../../interviewerStore");
  prisma: typeof import("../../db").default;
  dbUrl: string;
};

/** What a test file reads. Every field is filled in `beforeAll`; reading one earlier throws. */
export interface ServerEnv extends Readonly<Handles> {}

// One module instance per test file, so this is per file: the handles and the "called" flag.
let handles: Handles | null = null;
let called = false;

function ready(): Handles {
  if (!handles) throw new Error("server test env used before beforeAll: read it inside a test or hook");
  return handles;
}

export const running: Running[] = [];
export const createdCustom: string[] = [];
let logSpies: ReturnType<typeof vi.spyOn>[] = [];

export interface Running {
  port: number;
  base: string;
  ws: string;
  close(): Promise<void>;
}

export function setupServerTestEnv(): ServerEnv {
  if (called) throw new Error("setupServerTestEnv() called twice in one test file");
  called = true;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "server-test-"));
    const dbUrl = `file:${path.join(tmpDir, "test.db")}`;
    process.env.DATABASE_URL = dbUrl;
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });
    // Dynamic imports: they must run after DATABASE_URL is set.
    const appMod = await import("../../app");
    const configMod = await import("../../config");
    const mockMod = await import("../../providers/mock");
    const persistence = await import("../../persistence");
    const registry = await import("../../sessionRegistry");
    const store = await import("../../interviewerStore");
    const prisma = (await import("../../db")).default;
    await store.syncPresets(SYNCED_PRESETS);
    handles = { appMod, configMod, mockMod, persistence, registry, store, prisma, dbUrl };
  }, 60_000);

  afterAll(async () => {
    await handles?.prisma.$disconnect();
    handles = null;
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
    for (const id of createdCustom.splice(0)) await ready().store.deleteInterviewer(id, "local");
  });

  return {
    get appMod() { return ready().appMod; },
    get configMod() { return ready().configMod; },
    get mockMod() { return ready().mockMod; },
    get persistence() { return ready().persistence; },
    get registry() { return ready().registry; },
    get store() { return ready().store; },
    get prisma() { return ready().prisma; },
    get dbUrl() { return ready().dbUrl; },
  };
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
  const base = ready().configMod.loadConfig({ PROFILE: "mock", DATABASE_URL: ready().dbUrl, ...env });
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
    /** Settings service override; or give only `catalog` to use the real store with it. */
    settings?: import("../../settingsService").SettingsService;
    catalog?: import("../../modelCatalog").ModelCatalog;
  } = {},
): Promise<Running> {
  const config = opts.config ?? makeConfig();
  const providers = ready().mockMod.createMockProviders({
    llmReplies: [LLM_REPLY],
    sttTexts: [STT_TEXT],
    structured: VALID_REPORT,
    ...opts.script,
  });
  opts.customize?.(providers);
  let settings = opts.settings;
  if (!settings && opts.catalog) {
    const [{ createSettingsService }, settingsStore] = await Promise.all([
      import("../../settingsService"),
      import("../../settingsStore"),
    ]);
    settings = createSettingsService({ store: settingsStore, catalog: opts.catalog });
  }
  const app = ready().appMod.createApp({
    config,
    providers,
    persist: opts.persist,
    interviewers: opts.interviewers,
    settings,
  });
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
  const { id: _id, source: _s, ownerId: _o, version: _v, createdAt: _c, updatedAt: _u, displayName: _n, ...rest } = PRESET;
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
