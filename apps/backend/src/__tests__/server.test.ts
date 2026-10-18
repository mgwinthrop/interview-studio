import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import WebSocket from "ws";
import type { Config } from "../config";
import { PRESETS } from "../interviewer/presets";
import type { InterviewerDefinition, InterviewerInput } from "../interviewer/schema";
import type { MockScript } from "../providers/mock";
import type { Providers } from "../providers/types";

const backendDir = path.resolve(__dirname, "../..");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INTERVIEWER = "tell-a-story";
const PRESET: InterviewerDefinition = PRESETS.find((p) => p.id === INTERVIEWER)!;
const USER_TEXT = "zebra-marmalade I lead a delivery team that uses AI assistants for code review.";
const STT_TEXT = "quokka-lantern we pair on prompts and keep a shared library of review checks.";
const LLM_REPLY = "Thanks for sharing that with me. Could you tell me a little more about it?";
const VALID_REPORT = {
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
let appMod: typeof import("../app");
let configMod: typeof import("../config");
let mockMod: typeof import("../providers/mock");
let persistence: typeof import("../persistence");
let registry: typeof import("../sessionRegistry");
let store: typeof import("../interviewerStore");
let prisma: typeof import("../db").default;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "server-test-"));
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
  persistence = await import("../persistence");
  registry = await import("../sessionRegistry");
  store = await import("../interviewerStore");
  prisma = (await import("../db")).default;
  await store.syncPresets(PRESETS);
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

// Every console call is captured (keeps output pristine and lets tests inspect logs).
let logSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  logSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});
afterEach(() => {
  for (const s of logSpies) s.mockRestore();
});

function allLogText(): string {
  return logSpies
    .flatMap((s) => s.mock.calls)
    .map((args) => args.map((a: unknown) => (a instanceof Error ? `${a.name} ${a.message}` : String(a))).join(" "))
    .join("\n");
}

// ── Harness ──────────────────────────────────────────────────────────────────

interface Running {
  port: number;
  base: string;
  ws: string;
  close(): Promise<void>;
}

const running: Running[] = [];
afterEach(async () => {
  while (running.length) await running.pop()!.close();
});

// Custom interviewers a test created (owner "local"), removed so the 50 cap is never reached.
const createdCustom: string[] = [];
afterEach(async () => {
  for (const id of createdCustom.splice(0)) await store.deleteInterviewer(id, "local");
});

function makeConfig(
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

async function start(
  opts: {
    config?: Config;
    script?: MockScript;
    customize?: (p: Providers) => void;
    persist?: typeof import("../persistence");
    interviewers?: typeof import("../interviewerStore");
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

type Msg = { type: string; [k: string]: unknown };

class Client {
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

function connect(r: Running, options: WebSocket.ClientOptions = {}, query = ""): Client {
  return new Client(`${r.ws}/${query}`, options);
}

// Interviewer-written text that must never reach the logs.
const SENTINEL_NAME = "Okapi-sentinel-name";
const SENTINEL_PERSONA = "okapi-sentinel-persona";
const CUSTOM_PHASES = ["okapi-sentinel-warm", "okapi-sentinel-middle", "okapi-sentinel-end"];

/** A custom interviewer: three named phases, the first ending after 1 user turn, the second after 2. */
function customInput(): InterviewerInput {
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
async function textTurn(c: Client): Promise<void> {
  const mark = c.messages.length;
  c.send({ type: "text_input", content: USER_TEXT });
  await c.assistantFinal(mark);
}

/** Resolves when `count` phase_change messages have been received. */
async function phaseChanges(c: Client, count: number): Promise<string[]> {
  await vi.waitFor(() => expect(c.messages.filter((m) => m.type === "phase_change").length).toBe(count));
  return c.messages.filter((m) => m.type === "phase_change").map((m) => m.phase as string);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("session start", () => {
  it("issues a server-chosen UUID before the greeting, ignoring client id and phase", async () => {
    const r = await start();
    const c = connect(r);
    await c.opened;
    c.send({ type: "session_start", interviewerId: INTERVIEWER, sessionId: "client-chosen", phase: "wrap_up" });
    const started = await c.next((m) => m.type === "session_started");
    expect(started.sessionId).toMatch(UUID_RE);
    expect(started.sessionId).not.toBe("client-chosen");
    expect(c.messages[0].type).toBe("session_started");
    await c.assistantFinal();
    const row = await prisma.session.findUnique({ where: { id: started.sessionId as string } });
    expect(row).toMatchObject({ ownerId: "local", interviewerId: INTERVIEWER, phase: "intro", status: "active" });
    // The snapshot is the preset exactly as it was at start.
    expect(await persistence.readSnapshot(started.sessionId as string, "local")).toEqual(PRESET);
    expect(await prisma.session.count({ where: { id: "client-chosen" } })).toBe(0);
    c.ws.close();
    await c.closed;
  });

  it("closes 1008 on an audio frame before session_start", async () => {
    const r = await start();
    const c = connect(r);
    await c.opened;
    c.ws.send(Buffer.alloc(320));
    expect((await c.closed).code).toBe(1008);
  });

  it("closes 1008 on session_end before session_start", async () => {
    const r = await start();
    const c = connect(r);
    await c.opened;
    c.send({ type: "session_end" });
    expect((await c.closed).code).toBe(1008);
  });

  it("closes 1008 on malformed JSON as the first frame", async () => {
    const r = await start();
    const c = connect(r);
    await c.opened;
    c.ws.send("{not json");
    expect((await c.closed).code).toBe(1008);
  });

  it.each(PRESETS.map((p) => p.id))(
    "starts from preset %s: session_started first, greeting, phase_change by name after its intro turns",
    async (interviewerId) => {
      const preset = PRESETS.find((p) => p.id === interviewerId)!;
      const r = await start();
      const c = connect(r);
      const id = await c.startSession({ interviewerId });
      expect(c.messages[0]).toEqual({ type: "session_started", sessionId: id });
      await c.assistantFinal();
      const introTurns = preset.phases[0].maxTurns!;
      for (let i = 0; i < introTurns; i++) {
        expect(c.messages.some((m) => m.type === "phase_change")).toBe(false);
        const mark = c.messages.length;
        c.send({ type: "text_input", content: USER_TEXT });
        await c.assistantFinal(mark);
      }
      const change = await c.next((m) => m.type === "phase_change");
      expect(change).toEqual({ type: "phase_change", phase: preset.phases[1].name });
      expect(await persistence.readSnapshot(id, "local")).toEqual(preset);
      c.ws.close();
      await c.closed;
    },
  );

  // [case, session_start fields, whether the id is well-formed enough to reach the lookup]
  const BAD_STARTS: [string, Record<string, unknown>, boolean][] = [
    ["an unknown id", { interviewerId: "unknown-ocelot-sentinel" }, true],
    ["a number", { interviewerId: 42 }, false],
    ["a missing id", {}, false],
    ["an empty string", { interviewerId: "" }, false],
    ["an overlong id", { interviewerId: `overlong-ocelot-${"x".repeat(60)}` }, false],
    ["an id with unsafe characters", { interviewerId: "ocelot sentinel!" }, false],
    ["a legacy topicId only", { topicId: "ai-se-delivery" }, false],
  ];

  it.each(BAD_STARTS)("closes 1008 'unknown interviewerId' on %s, creates nothing and logs no id", async (_what, body, looksUp) => {
    // Cap 1: a later start proves the pending-session counter was released.
    const getInterviewer = vi.fn(store.getInterviewer);
    const r = await start({
      config: makeConfig({}, { limits: { maxConcurrentSessionsPerOwner: 1 } }),
      interviewers: { ...store, getInterviewer },
    });
    const before = await prisma.session.count();
    const c = connect(r);
    await c.opened;
    c.send({ type: "session_start", ...body });
    expect(await c.closed).toEqual({ code: 1008, reason: "unknown interviewerId" });
    expect(c.messages).toHaveLength(0);
    expect(await prisma.session.count()).toBe(before);
    expect(registry.countForOwner("local")).toBe(0);
    const logs = allLogText();
    expect(logs).not.toContain("ocelot");
    expect(logs).not.toContain("ai-se-delivery");
    // Malformed ids are refused before the database is asked.
    expect(getInterviewer).toHaveBeenCalledTimes(looksUp ? 1 : 0);

    const ok = connect(r);
    await ok.startSession();
    ok.ws.close();
    await ok.closed;
  });

  it("closes 1008 'unknown interviewerId' for another owner's custom interviewer", async () => {
    // Two owners: local mode authenticates as "local", token mode as "token".
    const custom = await store.createInterviewer("local", customInput());
    createdCustom.push(custom.id);
    const t = await start({ config: makeConfig({ AUTH_TOKEN: "second-owner-token" }) });
    const before = await prisma.session.count();
    const foreign = connect(t, {}, "?token=second-owner-token");
    await foreign.opened;
    foreign.send({ type: "session_start", interviewerId: custom.id });
    expect(await foreign.closed).toEqual({ code: 1008, reason: "unknown interviewerId" });
    expect(foreign.messages).toHaveLength(0);
    expect(await prisma.session.count()).toBe(before);
    expect(registry.countForOwner("token")).toBe(0);
    expect(allLogText()).not.toContain(custom.id);

    // Its owner can use it.
    const r = await start();
    const own = connect(r);
    const id = await own.startSession({ interviewerId: custom.id });
    expect(await persistence.readSnapshot(id, "local")).toEqual(custom);
    own.ws.close();
    await own.closed;
  });

  it("ignores a second session_start on the same socket", async () => {
    const r = await start();
    const c = connect(r);
    await c.startSession();
    await c.assistantFinal();
    const before = await prisma.session.count();
    c.send({ type: "session_start", interviewerId: INTERVIEWER });
    c.send({ type: "text_input", content: USER_TEXT });
    await c.next((m) => m.type === "transcript" && m.role === "user");
    expect(c.messages.filter((m) => m.type === "session_started")).toHaveLength(1);
    expect(await prisma.session.count()).toBe(before);
    c.ws.close();
    await c.closed;
  });

  it("ignores malformed JSON after start without closing", async () => {
    const r = await start();
    const c = connect(r);
    await c.startSession();
    await c.assistantFinal();
    c.ws.send("{not json");
    c.send({ type: "text_input", content: USER_TEXT });
    const user = await c.next((m) => m.type === "transcript" && m.role === "user");
    expect(user.text).toBe(USER_TEXT);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
    await c.closed;
  });
});

describe("caps and limits", () => {
  it("closes 1009 on a binary frame larger than maxPayloadBytes", async () => {
    const r = await start({ config: makeConfig({}, { limits: { maxPayloadBytes: 1024 } }) });
    const c = connect(r);
    await c.startSession();
    c.ws.send(Buffer.alloc(4096));
    expect((await c.closed).code).toBe(1009);
  });

  it("accepts a binary utterance longer than 33 s of 16 kHz PCM16 (2 MiB) and keeps the socket open", async () => {
    const r = await start();
    const c = connect(r);
    await c.startSession();
    await c.assistantFinal();
    const mark = c.messages.length;
    c.ws.send(Buffer.alloc(2 * 1024 * 1024));
    const user = await c.next((m) => m.type === "transcript" && m.role === "user", mark);
    expect(user.text).toBe(STT_TEXT);
    await c.assistantFinal(mark);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
    await c.closed;
  });

  it("closes 1009 'message too large' on a text frame over maxTextFrameBytes", async () => {
    const r = await start({ config: makeConfig({}, { limits: { maxTextFrameBytes: 1024 } }) });
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    c.send({ type: "text_input", content: "x".repeat(2048) });
    expect(await c.closed).toEqual({ code: 1009, reason: "message too large" });
    expect(c.messages.some((m) => m.type === "transcript" && m.role === "user")).toBe(false);
    await vi.waitFor(async () => {
      expect((await prisma.session.findUnique({ where: { id } }))?.status).toBe("abandoned");
    });
  });

  it("closes 1009 on an oversize text frame before session_start", async () => {
    const r = await start({ config: makeConfig({}, { limits: { maxTextFrameBytes: 64 } }) });
    const c = connect(r);
    await c.opened;
    c.send({ type: "session_start", interviewerId: INTERVIEWER, padding: "x".repeat(128) });
    expect((await c.closed).code).toBe(1009);
    expect(c.messages).toHaveLength(0);
  });

  it("answers an over-8 KB text_input with stt_error too_long and ignores it", async () => {
    const r = await start();
    const c = connect(r);
    await c.startSession();
    await c.assistantFinal();
    const mark = c.messages.length;
    c.send({ type: "text_input", content: "é".repeat(4097) }); // 8194 UTF-8 bytes
    const err = await c.next((m) => m.type === "stt_error", mark);
    expect(err).toEqual({ type: "stt_error", reason: "too_long" });
    // Exactly at the cap is accepted.
    c.send({ type: "text_input", content: "a".repeat(8192) });
    const user = await c.next((m) => m.type === "transcript" && m.role === "user", mark);
    expect((user.text as string).length).toBe(8192);
    expect(c.messages.filter((m) => m.type === "transcript" && m.role === "user")).toHaveLength(1);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
    await c.closed;
  });

  it("closes 1013 on a third concurrent session for the same owner", async () => {
    const r = await start();
    const a = connect(r);
    const b = connect(r);
    await a.startSession();
    await b.startSession();
    const c = connect(r);
    await c.opened;
    c.send({ type: "session_start", interviewerId: INTERVIEWER });
    expect((await c.closed).code).toBe(1013);
    expect(c.messages.some((m) => m.type === "session_started")).toBe(false);
    a.ws.close();
    b.ws.close();
    await Promise.all([a.closed, b.closed]);
  });

  it("closes 1001 with reason 'idle timeout' when the controller idles out", async () => {
    const r = await start({ config: makeConfig({}, { limits: { idleTimeoutMs: 50 } }) });
    const c = connect(r);
    const id = await c.startSession();
    const closed = await c.closed;
    expect(closed).toEqual({ code: 1001, reason: "idle timeout" });
    await vi.waitFor(async () => {
      expect((await prisma.session.findUnique({ where: { id } }))?.status).toBe("abandoned");
    });
  });
});

describe("authentication on upgrade", () => {
  it("refuses an upgrade from a foreign Origin with 403", async () => {
    const r = await start();
    const c = connect(r, { origin: "http://evil.example" });
    expect(await c.rejected).toBe(403);
  });

  it("refuses an upgrade and an HTTP request with a non-loopback Host in local mode (403)", async () => {
    const r = await start();
    const c = connect(r, { headers: { Host: "evil.example:3001" } });
    expect(await c.rejected).toBe(403);
    const status = await new Promise<number>((resolve, reject) => {
      const rq = http.request(
        { host: "127.0.0.1", port: r.port, path: "/health", headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      rq.on("error", reject);
      rq.end();
    });
    expect(status).toBe(403);
    // The default Host (127.0.0.1:port) is accepted.
    expect((await fetch(`${r.base}/health`)).status).toBe(200);
  });

  it("accepts the allowed Origin", async () => {
    const r = await start();
    const c = connect(r, { origin: "http://localhost:3000" });
    await c.startSession();
    c.ws.close();
    await c.closed;
  });

  it("refuses an upgrade without a token in token mode with 401, accepts ?token=", async () => {
    const r = await start({ config: makeConfig({ AUTH_TOKEN: "s3cret-token-value" }) });
    const bad = connect(r);
    expect(await bad.rejected).toBe(401);
    const good = connect(r, {}, "?token=s3cret-token-value");
    await good.startSession();
    good.ws.close();
    await good.closed;
    expect(allLogText()).not.toContain("s3cret-token-value");
  });
});

describe("HTTP routes", () => {
  it("GET /health is 200 with database true and the provider profile", async () => {
    const r = await start();
    const res = await fetch(`${r.base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: true, providers: { profile: "mock" } });
  });

  it("runs the authenticator on HTTP routes (403 foreign origin, 401 no token)", async () => {
    const r = await start();
    const res = await fetch(`${r.base}/health`, { headers: { Origin: "http://evil.example" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toHaveProperty("error");

    const t = await start({ config: makeConfig({ AUTH_TOKEN: "another-token" }) });
    expect((await fetch(`${t.base}/api/sessions`)).status).toBe(401);
    const ok = await fetch(`${t.base}/health`, { headers: { Authorization: "Bearer another-token" } });
    expect(ok.status).toBe(200);
  });

  it("returns 404 for another owner's transcript and report", async () => {
    const r = await start();
    await persistence.persistSessionCreate("foreign-1", "someone-else", PRESET);
    await persistence.persistTurn({
      id: "foreign-1-t1",
      sessionId: "foreign-1",
      role: "user",
      content: "private",
      phase: "intro",
      timestamp: new Date(),
    });
    expect((await fetch(`${r.base}/api/session/foreign-1/transcript`)).status).toBe(404);
    expect((await fetch(`${r.base}/api/session/foreign-1/report`)).status).toBe(404);
    expect((await fetch(`${r.base}/report/foreign-1`)).status).toBe(404);
    expect((await fetch(`${r.base}/api/session/no-such-session/report`)).status).toBe(404);
  });

  describe("DELETE /api/session/:sessionId", () => {
    async function seedSession(id: string, owner: string, status: "complete" | "failed" | "abandoned" = "complete") {
      await persistence.persistSessionCreate(id, owner, PRESET);
      await persistence.persistTurn({
        id: `${id}-t1`,
        sessionId: id,
        role: "user",
        content: "private",
        phase: "intro",
        timestamp: new Date(),
      });
      await persistence.persistSessionStatus(id, status);
    }

    it("deletes the caller's own session with 204, then transcript and report are 404", async () => {
      const r = await start();
      await seedSession("del-own", "local");
      expect((await fetch(`${r.base}/api/session/del-own/transcript`)).status).toBe(200);
      const res = await fetch(`${r.base}/api/session/del-own`, { method: "DELETE" });
      expect(res.status).toBe(204);
      expect((await fetch(`${r.base}/api/session/del-own/transcript`)).status).toBe(404);
      expect((await fetch(`${r.base}/api/session/del-own/report`)).status).toBe(404);
      expect(await prisma.session.count({ where: { id: "del-own" } })).toBe(0);
    });

    it("allows deleting failed and abandoned sessions", async () => {
      const r = await start();
      await seedSession("del-failed", "local", "failed");
      await seedSession("del-abandoned", "local", "abandoned");
      expect((await fetch(`${r.base}/api/session/del-failed`, { method: "DELETE" })).status).toBe(204);
      expect((await fetch(`${r.base}/api/session/del-abandoned`, { method: "DELETE" })).status).toBe(204);
    });

    it("returns 404 for a foreign or unknown session and leaves the foreign session intact", async () => {
      const r = await start();
      await seedSession("del-foreign", "someone-else");
      const foreign = await fetch(`${r.base}/api/session/del-foreign`, { method: "DELETE" });
      const unknown = await fetch(`${r.base}/api/session/no-such-session`, { method: "DELETE" });
      expect(foreign.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(await foreign.json()).toEqual(await unknown.json());
      expect(await prisma.session.count({ where: { id: "del-foreign" } })).toBe(1);
      expect(await persistence.readTurnsFromDb("del-foreign", "someone-else")).not.toBeNull();
    });

    it("refuses with 409 while the session is live, and keeps it", async () => {
      const r = await start();
      const c = connect(r);
      const id = await c.startSession();
      await c.assistantFinal();
      const res = await fetch(`${r.base}/api/session/${id}`, { method: "DELETE" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "session is active" });
      expect(await prisma.session.count({ where: { id } })).toBe(1);
      c.ws.close();
      await c.closed;
    });

    it("runs the authenticator (403 foreign origin, 401 no token) and deletes nothing", async () => {
      await seedSession("del-auth", "local");
      const r = await start();
      const bad = await fetch(`${r.base}/api/session/del-auth`, {
        method: "DELETE",
        headers: { Origin: "http://evil.example" },
      });
      expect(bad.status).toBe(403);
      const t = await start({ config: makeConfig({ AUTH_TOKEN: "another-token" }) });
      expect((await fetch(`${t.base}/api/session/del-auth`, { method: "DELETE" })).status).toBe(401);
      expect(await prisma.session.count({ where: { id: "del-auth" } })).toBe(1);
    });
  });

  it("returns 202 generating for an active session's report", async () => {
    const r = await start();
    await persistence.persistSessionCreate("active-1", "local", PRESET);
    const res = await fetch(`${r.base}/api/session/active-1/report`);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "generating" });
  });
});

describe("full conversation", () => {
  it("session_end yields session_complete with the started id; report, transcript and list are served", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    const mark = c.messages.length;
    c.send({ type: "text_input", content: USER_TEXT });
    await c.assistantFinal(mark);
    c.send({ type: "session_end" });
    const done = await c.next((m) => m.type === "session_complete");
    expect(done.reportId).toBe(id);
    expect(c.messages.some((m) => m.type === "session_failed")).toBe(false);
    expect((await c.closed).code).toBe(1000);

    for (const p of [`/api/session/${id}/report`, `/report/${id}`]) {
      const res = await fetch(`${r.base}${p}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        format: 2,
        sessionId: id,
        content: { summary: VALID_REPORT.content.summary },
        nextSteps: VALID_REPORT.nextSteps,
        interviewerName: PRESET.name,
      });
    }

    const tr = await fetch(`${r.base}/api/session/${id}/transcript`);
    expect(tr.status).toBe(200);
    expect(tr.headers.get("content-disposition")).toContain(`transcript-${id}.txt`);
    const text = await tr.text();
    expect(text).toContain(`Participant: ${USER_TEXT}`);
    expect(text).toContain(`Interviewer: ${LLM_REPLY}`);

    // A foreign owner's complete session is never listed.
    await persistence.persistSessionCreate("foreign-complete", "someone-else", PRESET);
    await persistence.persistSessionStatus("foreign-complete", "complete");

    const list = await fetch(`${r.base}/api/sessions`);
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      sessions: Record<string, unknown>[];
      stats: Record<string, number>;
    };
    expect(body.sessions.map((s) => s.id)).not.toContain("foreign-complete");
    const mine = body.sessions.find((s) => s.id === id);
    expect(mine).toMatchObject({
      id,
      interviewerId: INTERVIEWER,
      interviewerName: PRESET.name,
      turnCount: 3,
      hasReport: true,
    });
    expect(mine).not.toHaveProperty("topicId");
    expect(Object.keys(mine!).sort()).toEqual(
      [
        "durationMinutes",
        "endedAt",
        "hasReport",
        "id",
        "interviewerId",
        "interviewerName",
        "startedAt",
        "turnCount",
      ].sort(),
    );
    expect(typeof mine!.startedAt).toBe("string");
    expect(typeof mine!.endedAt).toBe("string");
    expect(body.stats).toEqual({
      totalSessions: body.sessions.length,
      personasUsed: expect.any(Number),
      avgDurationMinutes: expect.any(Number),
    });
  });

  it("a failed report produces session_failed and a 500 report", async () => {
    const r = await start({ script: { structured: { not: "a report" } } });
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    const mark = c.messages.length;
    c.send({ type: "text_input", content: USER_TEXT });
    await c.assistantFinal(mark);
    c.send({ type: "session_end" });
    const failed = await c.next((m) => m.type === "session_failed");
    expect(typeof failed.reason).toBe("string");
    expect(failed.reason).not.toContain(USER_TEXT);
    expect(c.messages.some((m) => m.type === "session_complete")).toBe(false);
    expect((await c.closed).code).toBe(1000);

    const res = await fetch(`${r.base}/api/session/${id}/report`);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ status: "failed" });
  });

  it("closing the socket without session_end leaves the session abandoned and unlisted", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    c.ws.close();
    await c.closed;
    await vi.waitFor(async () => {
      expect((await prisma.session.findUnique({ where: { id } }))?.status).toBe("abandoned");
    });
    const res = await fetch(`${r.base}/api/session/${id}/report`);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ status: "abandoned" });
    const list = (await (await fetch(`${r.base}/api/sessions`)).json()) as { sessions: { id: string }[] };
    expect(list.sessions.map((s) => s.id)).not.toContain(id);
  });

  it("closing the socket after session_end still completes the report", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    const mark = c.messages.length;
    c.send({ type: "text_input", content: USER_TEXT });
    await c.assistantFinal(mark);
    c.send({ type: "session_end" });
    c.ws.close();
    await c.closed;
    await vi.waitFor(async () => {
      expect((await prisma.session.findUnique({ where: { id } }))?.status).toBe("complete");
    });
    expect((await fetch(`${r.base}/api/session/${id}/report`)).status).toBe(200);
  });
});

describe("end-of-session deadline", () => {
  const hangReport = (p: Providers) => {
    p.llm.structured = () => new Promise<never>(() => {});
  };

  async function endAfterOneTurn(c: Client): Promise<string> {
    const id = await c.startSession();
    await c.assistantFinal();
    const mark = c.messages.length;
    c.send({ type: "text_input", content: USER_TEXT });
    await c.assistantFinal(mark);
    c.send({ type: "session_end" });
    return id;
  }

  it("a report that never resolves yields session_failed at the deadline and frees the slot", async () => {
    const r = await start({
      config: makeConfig({}, { limits: { reportTimeoutMs: 150, maxConcurrentSessionsPerOwner: 1 } }),
      customize: hangReport,
    });
    const c = connect(r);
    const id = await endAfterOneTurn(c);
    const failed = await c.next((m) => m.type === "session_failed");
    expect(failed.reason).toBe("report generation failed");
    expect((await c.closed).code).toBe(1000);
    expect((await prisma.session.findUnique({ where: { id } }))?.status).toBe("failed");
    expect(registry.countForOwner("local")).toBe(0);

    const next = connect(r);
    const nextId = await next.startSession();
    expect(nextId).not.toBe(id);
    next.ws.close();
    await next.closed;
  });

  it("session_end then an immediate disconnect still ends failed at the deadline and frees the slot", async () => {
    const r = await start({
      config: makeConfig({}, { limits: { reportTimeoutMs: 150 } }),
      customize: hangReport,
    });
    const c = connect(r);
    const id = await endAfterOneTurn(c);
    c.ws.close();
    await c.closed;
    await vi.waitFor(
      async () => {
        expect((await prisma.session.findUnique({ where: { id } }))?.status).toBe("failed");
        expect(registry.countForOwner("local")).toBe(0);
      },
      { timeout: 3000 },
    );

    const fresh = Array.from({ length: makeConfig().limits.maxConcurrentSessionsPerOwner }, () => connect(r));
    const ids = await Promise.all(fresh.map((f) => f.startSession()));
    expect(new Set(ids).size).toBe(fresh.length);
    for (const f of fresh) f.ws.close();
    await Promise.all(fresh.map((f) => f.closed));
  });
});

describe("session creation failure", () => {
  it("closes 1011 without session_started or a registry entry; a later start works", async () => {
    const persist = {
      ...persistence,
      persistSessionCreate: vi
        .fn(persistence.persistSessionCreate)
        .mockRejectedValueOnce(new Error("db down")),
    };
    const r = await start({ persist });
    const c = connect(r);
    await c.opened;
    c.send({ type: "session_start", interviewerId: INTERVIEWER });
    expect((await c.closed).code).toBe(1011);
    expect(c.messages.some((m) => m.type === "session_started")).toBe(false);
    expect(registry.countForOwner("local")).toBe(0);

    const ok = connect(r);
    await ok.startSession();
    ok.ws.close();
    await ok.closed;
  });
});

describe("interviewer lookup at session start", () => {
  /** The real store, with getInterviewer held until release() for its first call. */
  function gatedStore() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const getInterviewer = vi.fn(async (id: string, ownerId: string) => {
      if (getInterviewer.mock.calls.length === 1) await gate;
      return store.getInterviewer(id, ownerId);
    });
    return { interviewers: { ...store, getInterviewer }, getInterviewer, release };
  }

  it("two simultaneous starts at the cap: one starts, the other closes 1013 while the first is still looking up", async () => {
    const { interviewers, getInterviewer, release } = gatedStore();
    const r = await start({
      config: makeConfig({}, { limits: { maxConcurrentSessionsPerOwner: 1 } }),
      interviewers,
    });
    const a = connect(r);
    const b = connect(r);
    await Promise.all([a.opened, b.opened]);
    a.send({ type: "session_start", interviewerId: INTERVIEWER });
    await vi.waitFor(() => expect(getInterviewer).toHaveBeenCalledTimes(1));
    b.send({ type: "session_start", interviewerId: INTERVIEWER });
    expect(await b.closed).toEqual({ code: 1013, reason: "too many sessions" });
    expect(b.messages).toHaveLength(0);
    release();
    const started = await a.next((m) => m.type === "session_started");
    expect(started.sessionId).toMatch(UUID_RE);
    expect(getInterviewer).toHaveBeenCalledTimes(1);
    expect(registry.countForOwner("local")).toBe(1);
    a.ws.close();
    await a.closed;
  });

  it("a failing lookup closes 1011 with no session_started, no row and no registry entry; a later start works", async () => {
    const interviewers = {
      ...store,
      getInterviewer: vi.fn(store.getInterviewer).mockRejectedValueOnce(new Error("db down")),
    };
    const r = await start({
      config: makeConfig({}, { limits: { maxConcurrentSessionsPerOwner: 1 } }),
      interviewers,
    });
    const before = await prisma.session.count();
    const c = connect(r);
    await c.opened;
    c.send({ type: "session_start", interviewerId: INTERVIEWER });
    expect(await c.closed).toEqual({ code: 1011, reason: "internal error" });
    expect(c.messages).toHaveLength(0);
    expect(await prisma.session.count()).toBe(before);
    expect(registry.countForOwner("local")).toBe(0);

    const ok = connect(r);
    await ok.startSession();
    ok.ws.close();
    await ok.closed;
  });

  it("a socket closed during the lookup creates no session and frees the slot", async () => {
    const { interviewers, getInterviewer, release } = gatedStore();
    const r = await start({
      config: makeConfig({}, { limits: { maxConcurrentSessionsPerOwner: 1 } }),
      interviewers,
    });
    const before = await prisma.session.count();
    const c = connect(r);
    await c.opened;
    c.send({ type: "session_start", interviewerId: INTERVIEWER });
    await vi.waitFor(() => expect(getInterviewer).toHaveBeenCalledTimes(1));
    c.ws.close();
    await c.closed;
    release();
    await vi.waitFor(() => expect(allLogText()).toContain("socket closed before start"));
    expect(c.messages).toHaveLength(0);
    expect(await prisma.session.count()).toBe(before);
    expect(registry.countForOwner("local")).toBe(0);

    const ok = connect(r);
    await ok.startSession();
    ok.ws.close();
    await ok.closed;
  });
});

describe("custom interviewers", () => {
  async function createViaApi(r: Running): Promise<InterviewerDefinition> {
    const res = await fetch(`${r.base}/api/interviewers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customInput()),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as InterviewerDefinition;
    createdCustom.push(created.id);
    return created;
  }

  it("a custom interviewer from the API starts a session; its phase names and thresholds drive phase_change", async () => {
    const r = await start();
    const custom = await createViaApi(r);
    const c = connect(r);
    const id = await c.startSession({ interviewerId: custom.id });
    await c.assistantFinal();
    await textTurn(c);
    expect(await phaseChanges(c, 1)).toEqual([CUSTOM_PHASES[1]]);
    await textTurn(c);
    expect(c.messages.filter((m) => m.type === "phase_change")).toHaveLength(1);
    await textTurn(c);
    expect(await phaseChanges(c, 2)).toEqual([CUSTOM_PHASES[1], CUSTOM_PHASES[2]]);
    // Phase writes are chained, so the stored phase ends on the last phase reached.
    await vi.waitFor(async () => {
      const row = await prisma.session.findUnique({ where: { id } });
      expect(row?.phase).toBe(CUSTOM_PHASES[2]);
    });
    // The snapshot is the stored definition (the API response omits ownerId).
    expect(await persistence.readSnapshot(id, "local")).toEqual({ ...custom, ownerId: "local" });
    c.ws.close();
    await c.closed;
  });

  it("deleting the interviewer mid-session changes nothing: the session finishes and its report uses the snapshot", async () => {
    const systems: string[] = [];
    const r = await start({
      customize: (p) => {
        const real = p.llm.structured.bind(p.llm);
        p.llm.structured = (req, signal) => {
          systems.push(req.system);
          return real(req, signal);
        };
      },
    });
    const custom = await createViaApi(r);
    const c = connect(r);
    const id = await c.startSession({ interviewerId: custom.id });
    await c.assistantFinal();
    await textTurn(c);

    const del = await fetch(`${r.base}/api/interviewers/${custom.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect(await store.getInterviewer(custom.id, "local")).toBeNull();

    // The running session keeps its own pacing after the delete.
    await textTurn(c);
    await textTurn(c);
    expect(await phaseChanges(c, 2)).toEqual([CUSTOM_PHASES[1], CUSTOM_PHASES[2]]);
    c.send({ type: "session_end" });
    const done = await c.next((m) => m.type === "session_complete");
    expect(done.reportId).toBe(id);
    expect((await c.closed).code).toBe(1000);

    expect(systems).toHaveLength(1);
    expect(systems[0]).toContain(SENTINEL_PERSONA);
    const report = await fetch(`${r.base}/api/session/${id}/report`);
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({ sessionId: id, interviewerName: SENTINEL_NAME });
    const list = (await (await fetch(`${r.base}/api/sessions`)).json()) as { sessions: Record<string, unknown>[] };
    expect(list.sessions.find((s) => s.id === id)).toMatchObject({
      interviewerId: custom.id,
      interviewerName: SENTINEL_NAME,
    });
  });
});

describe("sessions from before interviewers", () => {
  it("a row with no snapshot is listed with interviewerName null and its report still loads", async () => {
    const r = await start();
    await prisma.session.create({
      data: {
        id: "legacy-1",
        ownerId: "local",
        interviewerId: "ai-se-delivery",
        interviewerJson: null,
        phase: "share_work",
        status: "complete",
        endedAt: new Date(),
      },
    });
    // A report row as written before report v2: only the older columns, no reportJson.
    await prisma.report.create({
      data: {
        sessionId: "legacy-1",
        summary: "An earlier summary.",
        strengthsJson: "[]",
        improvementsJson: "[]",
        highlightsJson: "[]",
        overallAssessment: "Fine.",
        generatedAt: new Date(),
      },
    });
    const list = (await (await fetch(`${r.base}/api/sessions`)).json()) as { sessions: Record<string, unknown>[] };
    expect(list.sessions.find((s) => s.id === "legacy-1")).toMatchObject({
      interviewerId: "ai-se-delivery",
      interviewerName: null,
    });
    const report = await fetch(`${r.base}/api/session/legacy-1/report`);
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({
      sessionId: "legacy-1",
      summary: "An earlier summary.",
      interviewerName: null,
    });
  });
});

describe("logging", () => {
  async function converse(r: Running, interviewerId = INTERVIEWER): Promise<void> {
    const c = connect(r);
    await c.startSession({ interviewerId });
    await c.assistantFinal();
    let mark = c.messages.length;
    c.send({ type: "text_input", content: USER_TEXT });
    await c.assistantFinal(mark);
    mark = c.messages.length;
    c.ws.send(Buffer.alloc(3200));
    await c.next((m) => m.type === "transcript" && m.role === "user" && m.text === STT_TEXT, mark);
    await c.assistantFinal(mark);
    c.send({ type: "interrupt" });
    c.send({ type: "session_end" });
    await c.next((m) => m.type === "session_complete");
    await c.closed;
  }

  it("never logs conversation text during a full mock conversation", async () => {
    const r = await start();
    await converse(r);
    const logs = allLogText();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).not.toContain("zebra-marmalade");
    expect(logs).not.toContain("quokka-lantern");
    expect(logs).not.toContain("Could you tell me a little more");
  });

  it("never logs interviewer text during a whole conversation with a custom interviewer", async () => {
    const r = await start();
    const custom = await store.createInterviewer("local", customInput());
    createdCustom.push(custom.id);
    await converse(r, custom.id);
    const logs = allLogText();
    expect(logs).toContain(custom.id);
    for (const text of [SENTINEL_NAME, SENTINEL_PERSONA, ...CUSTOM_PHASES]) expect(logs).not.toContain(text);
    expect(logs.toLowerCase()).not.toContain("okapi");
  });

  it("logs conversation text only when debugLogText is true", async () => {
    const r = await start({ config: makeConfig({}, { debugLogText: true }) });
    await converse(r);
    expect(allLogText()).toContain("zebra-marmalade");
  });
});

describe("turn_timing", () => {
  const GAP = 4321;

  /** The stored user turns of a session, once `count` of them have landed. */
  async function storedUserTurns(sessionId: string, count: number) {
    let users: import("../types").ConversationTurn[] = [];
    await vi.waitFor(async () => {
      const turns = (await persistence.readTurnsFromDb(sessionId, "local")) ?? [];
      users = turns.filter((t) => t.role === "user");
      expect(users).toHaveLength(count);
    });
    return users;
  }

  /** Sends one audio utterance and waits for its reply to finish. */
  async function audioTurn(c: Client): Promise<void> {
    const mark = c.messages.length;
    c.ws.send(Buffer.alloc(3200));
    await c.next((m) => m.type === "transcript" && m.role === "user", mark);
    await c.assistantFinal(mark);
  }

  it("closes 1008 on turn_timing before session_start", async () => {
    const r = await start();
    const c = connect(r);
    await c.opened;
    c.send({ type: "turn_timing", responseGapMs: GAP });
    const closed = await c.closed;
    expect(closed.code).toBe(1008);
    expect(closed.reason).toBe("session_start required");
    expect(allLogText()).toContain("message turn_timing before session_start");
  });

  it("a valid turn_timing before an audio frame is stored as the turn's responseGapMs", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    c.send({ type: "turn_timing", responseGapMs: GAP });
    await audioTurn(c);
    const [turn] = await storedUserTurns(id, 1);
    expect(turn.content).toBe(STT_TEXT);
    expect(turn.metrics).toMatchObject({ responseGapMs: GAP, wordCount: STT_TEXT.split(" ").length });
    c.ws.close();
    await c.closed;
  });

  it("an invalid turn_timing is ignored without closing the socket", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    for (const responseGapMs of [-5, "12", 1e9, null, { ms: 1 }]) c.send({ type: "turn_timing", responseGapMs });
    c.send({ type: "turn_timing" });
    await audioTurn(c);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    const [turn] = await storedUserTurns(id, 1);
    expect(turn.metrics).toMatchObject({ responseGapMs: null });
    expect(allLogText()).not.toContain("ignored message type");
    c.ws.close();
    await c.closed;
  });

  it("a text turn stores no metrics and does not take a pending gap", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    c.send({ type: "turn_timing", responseGapMs: GAP });
    await textTurn(c);
    c.send({ type: "interrupt" });
    await audioTurn(c);
    const turns = await storedUserTurns(id, 2);
    // Found by content: turns stored in the same millisecond have no defined order.
    const typed = turns.find((t) => t.content === USER_TEXT);
    const spoken = turns.find((t) => t.content === STT_TEXT);
    expect(typed).toBeDefined();
    expect(typed!.metrics ?? null).toBeNull();
    // The interrupt discarded the pending gap.
    expect(spoken?.metrics).toMatchObject({ responseGapMs: null });
    c.ws.close();
    await c.closed;
  });

  it("never logs the gap value during a conversation", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    await textTurn(c);
    c.send({ type: "turn_timing", responseGapMs: GAP });
    await audioTurn(c);
    c.send({ type: "turn_timing", responseGapMs: GAP + 1 });
    c.send({ type: "interrupt" });
    c.send({ type: "turn_timing", responseGapMs: -GAP });
    await storedUserTurns(id, 2);
    c.ws.close();
    await c.closed;
    // Session ids are random hex and could contain the digits by chance.
    const logs = allLogText().replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).not.toContain(String(GAP));
    expect(logs).not.toContain(String(GAP + 1));
  });
});
