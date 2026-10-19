/**
 * Shutdown of the WebSocket server, driven through attachWebSocket with in-memory fakes for
 * persistence and the interviewer store (no database). The rest of the WebSocket lifecycle is
 * covered end to end in server.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { createAuthenticator } from "../auth";
import { loadConfig } from "../config";
import { PRESETS } from "../interviewer/presets";
import type { InterviewerDefinition } from "../interviewer/schema";
import type * as interviewerStore from "../interviewerStore";
import type * as persistence from "../persistence";
import { createMockProviders } from "../providers/mock";
import * as registry from "../sessionRegistry";
import { attachWebSocket, type WsServer } from "../wsServer";

const PRESET: InterviewerDefinition = PRESETS.find((p) => p.id === "tell-a-story")!;

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
    .map((args) => args.map(String).join(" "))
    .join("\n");
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

interface Harness {
  url: string;
  ws: WsServer;
  events: string[];
  persist: Record<string, ReturnType<typeof vi.fn>>;
  getInterviewer: ReturnType<typeof vi.fn>;
}

const servers: http.Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

async function start(opts: { lookup?: Promise<InterviewerDefinition | null>; create?: Promise<void> } = {}) {
  const config = loadConfig({ PROFILE: "mock", DATABASE_URL: "file:./unused.db" });
  const providers = createMockProviders({ llmReplies: ["Thanks. Tell me more?"], sttTexts: ["hello"] });
  const events: string[] = [];
  const persist = {
    persistSessionCreate: vi.fn(async () => {
      events.push("create");
      await opts.create;
    }),
    persistSessionStatus: vi.fn(async (_id: string, status: string) => {
      events.push(`status ${status}`);
      return true;
    }),
    persistTurn: vi.fn(async () => {}),
    persistPhaseTransition: vi.fn(async () => {}),
    persistReport: vi.fn(async () => {}),
  };
  const getInterviewer = vi.fn(async () => (opts.lookup ? opts.lookup : PRESET));
  const server = http.createServer();
  servers.push(server);
  const ws = attachWebSocket({
    server,
    config,
    providers,
    persist: persist as unknown as typeof persistence,
    interviewers: { getInterviewer } as unknown as typeof interviewerStore,
    authenticate: createAuthenticator(config),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `ws://127.0.0.1:${port}/`, ws, events, persist, getInterviewer } satisfies Harness;
}

function client(url: string, events?: string[]) {
  const ws = new WebSocket(url);
  ws.on("error", () => {});
  const opened = new Promise<void>((resolve) => ws.once("open", () => resolve()));
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.once("close", (code, reason) => {
      events?.push(`client closed ${code}`);
      resolve({ code, reason: reason.toString() });
    }),
  );
  const started = new Promise<string>((resolve) =>
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString()) as { type: string; sessionId?: string };
      if (msg.type === "session_started") resolve(msg.sessionId!);
    }),
  );
  const rejected = new Promise<number>((resolve) =>
    ws.once("unexpected-response", (_req, res) => {
      resolve(res.statusCode ?? 0);
      res.resume();
    }),
  );
  const begin = () => ws.send(JSON.stringify({ type: "session_start", interviewerId: PRESET.id }));
  return { ws, opened, closed, started, rejected, begin };
}

describe("WebSocket server shutdown", () => {
  it("abandons a live session, writes its status before the socket goes and closes 1001 'server shutdown'", async () => {
    const h = await start();
    const c = client(h.url, h.events);
    await c.opened;
    c.begin();
    const id = await c.started;
    expect(registry.get(id)).toBeDefined();

    await h.ws.close();
    // Settled before sockets are terminated: the abandoned status is written first.
    expect(h.events.indexOf(`status abandoned`)).toBeGreaterThanOrEqual(0);
    expect(await c.closed).toEqual({ code: 1001, reason: "server shutdown" });
    expect(h.events.indexOf("status abandoned")).toBeLessThan(h.events.indexOf("client closed 1001"));
    expect(registry.get(id)).toBeUndefined();
    expect(allLogText()).toContain(`[session ${id}] ended abandoned`);
  });

  it("refuses an upgrade with 403 once shutdown has begun", async () => {
    const h = await start();
    await h.ws.close();
    const c = client(h.url);
    expect(await c.rejected).toBe(403);
    expect(allLogText()).toContain("[ws] upgrade refused 403");
  });

  it("waits for a start in flight and creates nothing for it", async () => {
    const lookup = deferred<InterviewerDefinition | null>();
    const h = await start({ lookup: lookup.promise });
    const c = client(h.url);
    await c.opened;
    c.begin();
    await vi.waitFor(() => expect(h.getInterviewer).toHaveBeenCalled());

    let closed = false;
    const closing = h.ws.close().then(() => (closed = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(closed).toBe(false);
    lookup.resolve(PRESET);
    await closing;

    expect(h.persist.persistSessionCreate).not.toHaveBeenCalled();
    expect(allLogText()).toContain("[ws] socket closed before start: nothing created");
    expect(allLogText()).not.toContain("started interviewer");
  });

  it("marks a session created during shutdown abandoned without starting it", async () => {
    const create = deferred<void>();
    const h = await start({ create: create.promise });
    const c = client(h.url);
    await c.opened;
    c.begin();
    await vi.waitFor(() => expect(h.persist.persistSessionCreate).toHaveBeenCalled());

    const closing = h.ws.close();
    create.resolve();
    await closing;

    expect(h.events).toEqual(["create", "status abandoned"]);
    expect(allLogText()).toMatch(/\[session [0-9a-f-]{36}\] socket closed before start: abandoned/);
    expect(allLogText()).not.toContain("started interviewer");
  });
});
