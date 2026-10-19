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
      format: 1,
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

  it("a gap and a spoken answer reach the saved report's delivery summary; the typed answer adds nothing", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    c.send({ type: "turn_timing", responseGapMs: 2468 });
    await audioTurn(c);
    await textTurn(c);
    c.send({ type: "session_end" });
    await c.next((m) => m.type === "session_complete");
    await c.closed;
    const res = await fetch(`${r.base}/api/session/${id}/report`);
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.format).toBe(2);
    const summary = body.delivery.summary;
    expect(summary.turnsMeasured).toBe(1);
    expect(summary.perTurn).toHaveLength(1);
    expect(summary.perTurn[0]).toMatchObject({ turn: 1, responseGapMs: 2468 });
    expect(typeof summary.speakingTimeSec).toBe("number");
    expect(typeof summary.pauseCount).toBe("number");
    expect(typeof summary.longestPauseSec).toBe("number");
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

// ── Report API and regenerate ────────────────────────────────────────────────

const MEASURED: import("../delivery/metrics").TurnMetrics = {
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
async function seedStored(
  id: string,
  owner: string,
  status: "failed" | "complete" | "abandoned" | "active",
  opts: {
    userTurns?: number;
    snapshot?: InterviewerDefinition | null;
    metrics?: import("../delivery/metrics").TurnMetrics;
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

function regenerate(r: Running, id: string): Promise<Response> {
  return fetch(`${r.base}/api/session/${id}/report/regenerate`, { method: "POST" });
}

async function statusOf(id: string): Promise<string | undefined> {
  return (await prisma.session.findUnique({ where: { id } }))?.status;
}

/** Replaces the report call with a counting one; `impl` decides each call's outcome. */
function structuredWith(impl: (call: number, req: Parameters<Providers["llm"]["structured"]>[0]) => Promise<unknown>) {
  const calls = { n: 0 };
  const customize = (p: Providers) => {
    p.llm.structured = (async (req: Parameters<Providers["llm"]["structured"]>[0]) => {
      calls.n += 1;
      return impl(calls.n, req);
    }) as Providers["llm"]["structured"];
  };
  return { calls, customize };
}

describe("GET report: format and status", () => {
  it("returns format 2 for a new report and format 1 for a legacy row, both with interviewerName", async () => {
    const r = await start();
    await seedStored("fmt-2", "local", "active");
    await persistence.persistReport("fmt-2", {
      format: 2,
      sessionId: "fmt-2",
      generatedAt: new Date("2026-10-18T12:00:00.000Z"),
      nextSteps: ["Try one thing."],
      deliveryUnavailable: true,
    });
    await persistence.persistSessionStatus("fmt-2", "complete");

    await persistence.persistSessionCreate("fmt-1", "local", PRESET);
    await persistence.persistSessionStatus("fmt-1", "complete");
    await prisma.report.create({
      data: {
        sessionId: "fmt-1",
        summary: "An older summary.",
        strengthsJson: "[]",
        improvementsJson: "[]",
        highlightsJson: "[]",
        overallAssessment: "Fine.",
        generatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    for (const prefix of ["/api/session/", "/report/"]) {
      const v2 = await fetch(`${r.base}${prefix}fmt-2${prefix === "/report/" ? "" : "/report"}`);
      expect(v2.status).toBe(200);
      expect(await v2.json()).toEqual({
        format: 2,
        sessionId: "fmt-2",
        generatedAt: "2026-10-18T12:00:00.000Z",
        nextSteps: ["Try one thing."],
        deliveryUnavailable: true,
        interviewerName: PRESET.name,
      });
      const v1 = await fetch(`${r.base}${prefix}fmt-1${prefix === "/report/" ? "" : "/report"}`);
      expect(v1.status).toBe(200);
      expect(await v1.json()).toMatchObject({
        format: 1,
        sessionId: "fmt-1",
        summary: "An older summary.",
        generatedAt: "2026-01-01T00:00:00.000Z",
        interviewerName: PRESET.name,
      });
    }
  });

  it("a failed session with user turns and a snapshot has canRegenerate true", async () => {
    const r = await start();
    await seedStored("cr-yes", "local", "failed");
    for (const p of ["/api/session/cr-yes/report", "/report/cr-yes"]) {
      const res = await fetch(`${r.base}${p}`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ status: "failed", error: "Report generation failed", canRegenerate: true });
    }
  });

  it("a failed session without user turns or without a snapshot has canRegenerate false", async () => {
    const r = await start();
    await seedStored("cr-no-user", "local", "failed", { userTurns: 0 });
    await persistence.persistSessionCreate("cr-no-turns", "local", PRESET);
    await persistence.persistSessionStatus("cr-no-turns", "failed");
    await seedStored("cr-no-snap", "local", "failed", { snapshot: null });
    for (const id of ["cr-no-user", "cr-no-turns", "cr-no-snap"]) {
      const res = await fetch(`${r.base}/api/session/${id}/report`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ status: "failed", error: "Report generation failed", canRegenerate: false });
    }
  });

  it("an abandoned session's 500 carries no canRegenerate", async () => {
    const r = await start();
    await seedStored("cr-ab", "local", "abandoned");
    const res = await fetch(`${r.base}/api/session/cr-ab/report`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ status: "abandoned", error: "Report generation failed" });
  });

  it("a complete session whose report cannot be read is 500 unreadable, not failed", async () => {
    const r = await start();
    await seedStored("unread-none", "local", "complete");
    await seedStored("unread-bad", "local", "complete");
    await prisma.report.create({
      data: {
        sessionId: "unread-bad",
        reportJson: "{oops",
        summary: "",
        strengthsJson: "{oops",
        improvementsJson: "[]",
        highlightsJson: "[]",
        overallAssessment: "",
      },
    });
    for (const p of ["/api/session/unread-none/report", "/report/unread-none", "/api/session/unread-bad/report"]) {
      const res = await fetch(`${r.base}${p}`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ status: "unreadable", error: "The report could not be read" });
    }
  });
});

describe("POST /api/session/:sessionId/report/regenerate", () => {
  it("turns a failed session complete; GET then serves the new report", async () => {
    const r = await start();
    await seedStored("rg-ok", "local", "failed");
    const res = await regenerate(r, "rg-ok");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      format: 2,
      sessionId: "rg-ok",
      content: VALID_REPORT.content,
      nextSteps: VALID_REPORT.nextSteps,
      // The preset asks for delivery feedback, and typed answers are not measured.
      deliveryUnavailable: true,
      interviewerName: PRESET.name,
    });
    expect(body).not.toHaveProperty("delivery");
    expect(typeof body.generatedAt).toBe("string");
    expect(await statusOf("rg-ok")).toBe("complete");

    const got = await fetch(`${r.base}/api/session/rg-ok/report`);
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual(body);
    const legacy = await fetch(`${r.base}/report/rg-ok`);
    expect(await legacy.json()).toEqual(body);
    // Once complete it cannot be regenerated again.
    const again = await regenerate(r, "rg-ok");
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "report cannot be regenerated" });
  });

  it("uses the stored turn metrics: a measured answer yields a delivery section", async () => {
    const r = await start();
    await seedStored("rg-measured", "local", "failed", { metrics: MEASURED });
    const res = await regenerate(r, "rg-measured");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      format: 2,
      delivery: { reading: VALID_REPORT.deliveryReading, summary: { turnsMeasured: 1, averageWordsPerMinute: 140 } },
    });
    expect(body).not.toHaveProperty("deliveryUnavailable");
  });

  it("answers 404 for another owner's session with the same body as an unknown one, and changes nothing", async () => {
    const { calls, customize } = structuredWith(async (_n, req) => req.schema.parse(VALID_REPORT));
    const r = await start({ customize });
    await seedStored("rg-foreign", "someone-else", "failed");
    const foreign = await regenerate(r, "rg-foreign");
    const unknown = await regenerate(r, "no-such-session");
    const malformed = await regenerate(r, "not%20a%20valid%20id");
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(404);
    const body = await foreign.json();
    expect(body).toEqual({ error: "Session not found" });
    expect(await unknown.json()).toEqual(body);
    expect(await malformed.json()).toEqual(body);
    expect(calls.n).toBe(0);
    expect(await statusOf("rg-foreign")).toBe("failed");
    expect(await prisma.report.count({ where: { sessionId: "rg-foreign" } })).toBe(0);
  });

  it("answers 409 for complete, active and abandoned sessions without calling the model", async () => {
    const { calls, customize } = structuredWith(async (_n, req) => req.schema.parse(VALID_REPORT));
    const r = await start({ customize });
    for (const status of ["complete", "active", "abandoned"] as const) {
      const id = `rg-${status}`;
      await seedStored(id, "local", status);
      const res = await regenerate(r, id);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "report cannot be regenerated" });
      expect(await statusOf(id)).toBe(status);
    }
    expect(calls.n).toBe(0);
  });

  it("answers 409 for a failed session with no user turns or no snapshot", async () => {
    const { calls, customize } = structuredWith(async (_n, req) => req.schema.parse(VALID_REPORT));
    const r = await start({ customize });
    await seedStored("rg-no-user", "local", "failed", { userTurns: 0 });
    await persistence.persistSessionCreate("rg-no-turns", "local", PRESET);
    await persistence.persistSessionStatus("rg-no-turns", "failed");
    await seedStored("rg-no-snap", "local", "failed", { snapshot: null });
    for (const id of ["rg-no-user", "rg-no-turns", "rg-no-snap"]) {
      const res = await regenerate(r, id);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "report cannot be regenerated" });
      expect(await statusOf(id)).toBe("failed");
    }
    expect(calls.n).toBe(0);
  });

  it("two concurrent requests: exactly one 200 and one 409; the gated one completes cleanly", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { calls, customize } = structuredWith(async (_n, req) => {
      await gate;
      return req.schema.parse(VALID_REPORT);
    });
    const r = await start({ customize });
    await seedStored("rg-race", "local", "failed");
    const first = regenerate(r, "rg-race");
    await vi.waitFor(() => expect(calls.n).toBe(1));
    const second = await regenerate(r, "rg-race");
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "report cannot be regenerated" });
    expect(await statusOf("rg-race")).toBe("failed");
    release();
    const done = await first;
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ format: 2, sessionId: "rg-race" });
    expect(calls.n).toBe(1);
    expect(await statusOf("rg-race")).toBe("complete");
  });

  it("two requests sent at once: exactly one 200 and one 409", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { calls, customize } = structuredWith(async (_n, req) => {
      await gate;
      return req.schema.parse(VALID_REPORT);
    });
    const r = await start({ customize });
    await seedStored("rg-race2", "local", "failed");
    let answeredEarly = 0;
    const track = async () => {
      const res = await regenerate(r, "rg-race2");
      if (res.status === 409) answeredEarly++;
      return res;
    };
    const both = Promise.all([track(), track()]);
    await vi.waitFor(() => expect(calls.n).toBe(1));
    // The other request is answered (409) while the gate is still closed.
    await vi.waitFor(() => expect(answeredEarly).toBe(1));
    release();
    const statuses = (await both).map((res) => res.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(calls.n).toBe(1);
    expect(await statusOf("rg-race2")).toBe("complete");
  });

  it("a model failure is 502, leaves the session failed, and it can be regenerated afterwards", async () => {
    const { calls, customize } = structuredWith(async (n, req) => {
      if (n === 1) throw new Error("provider down");
      return req.schema.parse(VALID_REPORT);
    });
    const r = await start({ customize });
    await seedStored("rg-fail", "local", "failed");
    const failed = await regenerate(r, "rg-fail");
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ status: "failed", error: "Report generation failed" });
    expect(await statusOf("rg-fail")).toBe("failed");
    expect(await prisma.report.count({ where: { sessionId: "rg-fail" } })).toBe(0);
    const get = await fetch(`${r.base}/api/session/rg-fail/report`);
    expect(await get.json()).toMatchObject({ status: "failed", canRegenerate: true });

    const ok = await regenerate(r, "rg-fail");
    expect(ok.status).toBe(200);
    expect(calls.n).toBe(2);
    expect(await statusOf("rg-fail")).toBe("complete");
  });

  it("invalid model output is 502 and the session stays failed", async () => {
    const r = await start({ script: { structured: { not: "a report" } } });
    await seedStored("rg-invalid", "local", "failed");
    const res = await regenerate(r, "rg-invalid");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ status: "failed", error: "Report generation failed" });
    expect(await statusOf("rg-invalid")).toBe("failed");
  });

  it("a report call that never resolves is 502 at the deadline; the lock is released", async () => {
    const { calls, customize } = structuredWith(() => new Promise<never>(() => {}));
    const r = await start({ config: makeConfig({}, { limits: { reportTimeoutMs: 150 } }), customize });
    await seedStored("rg-hang", "local", "failed");
    const t0 = Date.now();
    const res = await regenerate(r, "rg-hang");
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ status: "failed", error: "Report generation failed" });
    expect(await statusOf("rg-hang")).toBe("failed");
    // Released: a second attempt runs the model again rather than being refused as in flight.
    const again = await regenerate(r, "rg-hang");
    expect(again.status).toBe(502);
    expect(calls.n).toBe(2);
  });

  it("aborts the report call at the deadline, and a late result does not write or change the status", async () => {
    const seen: { signal?: AbortSignal } = {};
    let releaseLate!: () => void;
    const lateGate = new Promise<void>((resolve) => (releaseLate = resolve));
    let lateDone!: () => void;
    const lateFinished = new Promise<void>((resolve) => (lateDone = resolve));
    const r = await start({
      config: makeConfig({}, { limits: { reportTimeoutMs: 100 } }),
      customize: (p) => {
        p.llm.structured = (async (req: Parameters<Providers["llm"]["structured"]>[0], signal: AbortSignal) => {
          seen.signal = signal;
          // Ignores the abort and answers late.
          await lateGate;
          const out = req.schema.parse(VALID_REPORT);
          lateDone();
          return out;
        }) as Providers["llm"]["structured"];
      },
    });
    await seedStored("rg-late", "local", "failed");
    const res = await regenerate(r, "rg-late");
    expect(res.status).toBe(502);
    expect(seen.signal?.aborted).toBe(true);
    // The late result arrives after the deadline; let the event loop drain before checking.
    releaseLate();
    await lateFinished;
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(await statusOf("rg-late")).toBe("failed");
    expect(await prisma.report.count({ where: { sessionId: "rg-late" } })).toBe(0);
  });

  it("answers 409 when the session is no longer failed by the time the report is ready", async () => {
    const { customize } = structuredWith(async (_n, req) => {
      // Something else ends the failed state meanwhile.
      await prisma.session.update({ where: { id: "rg-moved" }, data: { status: "abandoned" } });
      return req.schema.parse(VALID_REPORT);
    });
    const r = await start({ customize });
    await seedStored("rg-moved", "local", "failed");
    const res = await regenerate(r, "rg-moved");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "report cannot be regenerated" });
    expect(await statusOf("rg-moved")).toBe("abandoned");
    expect(await prisma.report.count({ where: { sessionId: "rg-moved" } })).toBe(0);
  });

  it("runs the authenticator", async () => {
    await seedStored("rg-auth", "local", "failed");
    const t = await start({ config: makeConfig({ AUTH_TOKEN: "another-token" }) });
    expect((await regenerate(t, "rg-auth")).status).toBe(401);
    const r = await start();
    const bad = await fetch(`${r.base}/api/session/rg-auth/report/regenerate`, {
      method: "POST",
      headers: { Origin: "http://evil.example" },
    });
    expect(bad.status).toBe(403);
    expect(await statusOf("rg-auth")).toBe("failed");
  });

  it("never logs transcript, interviewer or report text", async () => {
    const REPORT_SENTINEL = "wombat-sentinel-report";
    const sentinelReport = {
      ...VALID_REPORT,
      content: { ...VALID_REPORT.content, summary: `${REPORT_SENTINEL} summary.` },
      nextSteps: [`${REPORT_SENTINEL} next step.`],
    };
    const { customize } = structuredWith(async (n, req) => {
      if (n === 1) throw new Error(`${REPORT_SENTINEL} provider error text`);
      return req.schema.parse(sentinelReport);
    });
    const r = await start({ customize });
    const custom = await store.createInterviewer("local", customInput());
    createdCustom.push(custom.id);
    await seedStored("rg-logs", "local", "failed", { snapshot: custom });
    expect((await regenerate(r, "rg-logs")).status).toBe(502);
    expect((await regenerate(r, "rg-logs")).status).toBe(200);
    const logs = allLogText();
    expect(logs).toContain("rg-logs");
    for (const text of ["zebra-marmalade", LLM_REPLY, SENTINEL_NAME, SENTINEL_PERSONA, ...CUSTOM_PHASES, REPORT_SENTINEL]) {
      expect(logs).not.toContain(text);
    }
    expect(logs.toLowerCase()).not.toContain("okapi");
    expect(logs).not.toContain("wombat");
  });
});

describe("POST /api/interviewers/draft", () => {
  const DRAFT_SENTINEL = "quagga-lighthouse-draft";
  const DESCRIPTION = `${DRAFT_SENTINEL} an interviewer that helps me rehearse a hard conversation with my manager.`;
  const VALID_DRAFT = {
    name: "Hard conversation",
    purpose: "Rehearse a difficult talk with a manager.",
    persona: "You are a calm, direct coach.",
    style: "You ask one short question at a time.",
    opening: "Greet the person and ask what they need to say.",
    closing: "Thank them and say the reflection will follow.",
    phases: [
      { name: "Set up", instruction: "Ask what the talk is about.", minTurns: 1, maxTurns: 2 },
      { name: "Practise", instruction: "Ask them to say it out loud.", minTurns: 2, maxTurns: 4 },
      { name: "Wrap up", instruction: "Ask what they will do next." },
    ],
    focus: ["How clearly they say the hard part"],
    contentFeedback: true,
    deliveryFeedback: true,
  };

  function draft(r: Running, description: unknown = DESCRIPTION): Promise<Response> {
    return fetch(`${r.base}/api/interviewers/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
  }

  async function ownedCount(): Promise<number> {
    return prisma.interviewer.count({ where: { ownerId: "local" } });
  }

  it("returns a draft that POST /api/interviewers then accepts, and the draft call writes nothing", async () => {
    const r = await start({ script: { structured: VALID_DRAFT } });
    const before = await prisma.interviewer.count();
    const res = await draft(r);
    expect(res.status).toBe(200);
    const { draft: body } = (await res.json()) as { draft: Record<string, unknown> };
    expect(await prisma.interviewer.count()).toBe(before);

    const saved = await fetch(`${r.base}/api/interviewers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(saved.status).toBe(201);
    const created = (await saved.json()) as InterviewerDefinition;
    createdCustom.push(created.id);
    for (const [k, v] of Object.entries(body)) expect(created[k as keyof InterviewerDefinition]).toEqual(v);
  });

  it("a second concurrent draft gets 429 while the first is in flight, then the lock is released", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    let n = 0;
    const r = await start({
      customize: (p) => {
        p.llm.structured = (async (req: Parameters<Providers["llm"]["structured"]>[0]) => {
          n += 1;
          if (n === 1) await gate;
          return req.schema.parse(VALID_DRAFT);
        }) as Providers["llm"]["structured"];
      },
    });
    const first = draft(r);
    await vi.waitFor(() => expect(n).toBe(1));
    const second = await draft(r);
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: "a draft is already being made" });
    release();
    expect((await first).status).toBe(200);
    expect((await draft(r)).status).toBe(200);
  });

  it("a failing LLM is 502 with a fixed body, releases the lock, and logs no text", async () => {
    let failing = true;
    const { customize } = structuredWith(async (_n, req) => {
      if (failing) throw new Error(`${DRAFT_SENTINEL} provider error text`);
      return req.schema.parse(VALID_DRAFT);
    });
    const r = await start({ customize });
    const res = await draft(r);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Draft generation failed" });
    failing = false;
    expect((await draft(r)).status).toBe(200);
    expect(allLogText()).not.toContain(DRAFT_SENTINEL);
  });

  it("too short a description is 422 without calling the LLM or taking the lock", async () => {
    const { calls, customize } = structuredWith(async (_n, req) => req.schema.parse(VALID_DRAFT));
    const r = await start({ customize });
    const res = await draft(r, "hi");
    expect(res.status).toBe(422);
    expect(calls.n).toBe(0);
    expect((await draft(r)).status).toBe(200);
    expect(calls.n).toBe(1);
  });

  it("a hung LLM is cut at the deadline", async () => {
    const hung = structuredWith(() => new Promise<never>(() => {}));
    const r2 = await start({ config: makeConfig({}, { limits: { reportTimeoutMs: 150 } }), customize: hung.customize });
    const res = await draft(r2);
    expect(res.status).toBe(502);
    expect((await draft(r2)).status).toBe(502);
  });

  it("an invalid description is 422 and nothing is echoed", async () => {
    const r = await start({ script: { structured: VALID_DRAFT } });
    const res = await draft(r, "   ");
    expect(res.status).toBe(422);
    expect(await ownedCount()).toBe(0);
  });

  it("is refused without the shared token in token mode", async () => {
    const r = await start({ config: makeConfig({ AUTH_TOKEN: "secret-token-value-123456" }) });
    const res = await draft(r);
    expect([401, 403]).toContain(res.status);
  });
});

describe("createDraftMaker", () => {
  it("locks per owner: the same owner is 429, another owner is not blocked", async () => {
    const { createDraftMaker } = await import("../app");
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    let n = 0;
    const providers = mockMod.createMockProviders({ structured: {} });
    providers.llm.structured = (async (req: Parameters<Providers["llm"]["structured"]>[0]) => {
      n += 1;
      if (n === 1) await gate;
      return req.schema.parse({
        name: "N",
        purpose: "P",
        persona: "You are calm.",
        style: "Short questions.",
        opening: "Greet them.",
        closing: "Thank them.",
        phases: [
          { name: "One", instruction: "Ask.", minTurns: 1, maxTurns: 2 },
          { name: "Two", instruction: "Ask more." },
        ],
        focus: [],
        contentFeedback: true,
        deliveryFeedback: true,
      });
    }) as Providers["llm"]["structured"];
    const make = createDraftMaker(makeConfig(), providers.llm);
    const text = "an interviewer that helps me rehearse a hard conversation";
    const a1 = make("owner-a", text);
    await vi.waitFor(() => expect(n).toBe(1));
    expect(await make("owner-a", text)).toEqual({ ok: false, status: 429 });
    const b = await make("owner-b", text);
    expect(b.ok).toBe(true);
    release();
    expect((await a1).ok).toBe(true);
    expect((await make("owner-a", text)).ok).toBe(true);
  });
});
