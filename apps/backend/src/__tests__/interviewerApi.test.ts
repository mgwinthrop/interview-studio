import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import type { InterviewerDefinition, InterviewerInput } from "../interviewer/schema";
import { PRESETS, SYNCED_PRESETS } from "../interviewer/presets";

// The router is tested on a small Express app: the real authenticator in front (as app.ts
// does), then the router. Owners are switched with a test-only header read by ownerOf.

const backendDir = path.resolve(__dirname, "../..");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SENTINEL = "SENTINEL-zebra-marmalade";
const RECORD_KEYS = [
  "id",
  "name",
  "purpose",
  "source",
  "persona",
  "style",
  "opening",
  "closing",
  "phases",
  "focus",
  "contentFeedback",
  "deliveryFeedback",
  "version",
  "createdAt",
  "updatedAt",
];

let tmpDir: string;
let dbUrl: string;
let store: typeof import("../interviewerStore");
let routes: typeof import("../interviewerRoutes");
let auth: typeof import("../auth");
let configMod: typeof import("../config");
let prisma: typeof import("../db").default;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "interviewer-api-test-"));
  dbUrl = `file:${path.join(tmpDir, "test.db")}`;
  process.env.DATABASE_URL = dbUrl;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
  store = await import("../interviewerStore");
  routes = await import("../interviewerRoutes");
  auth = await import("../auth");
  configMod = await import("../config");
  prisma = (await import("../db")).default;
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

let logSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(async () => {
  logSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
  await prisma.interviewer.deleteMany();
  await store.syncPresets(PRESETS);
});
afterEach(async () => {
  for (const s of logSpies) s.mockRestore();
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

function allLogText(): string {
  return logSpies
    .flatMap((s) => s.mock.calls)
    .map((args) => args.map(String).join(" "))
    .join("\n");
}

// ── Harness ──────────────────────────────────────────────────────────────────

const servers: http.Server[] = [];

async function start(
  opts: { env?: Record<string, string>; store?: typeof import("../interviewerStore") } = {},
): Promise<string> {
  const config = configMod.loadConfig({ PROFILE: "mock", DATABASE_URL: dbUrl, ...opts.env });
  const authenticate = auth.createAuthenticator(config);
  const app = express();
  app.use((req, res, next) => {
    const result = authenticate(req);
    if (!result.ok) {
      res.status(result.status).json({ error: result.reason });
      return;
    }
    res.locals.ownerId = result.ownerId;
    next();
  });
  app.use(
    "/api/interviewers",
    routes.createInterviewerRouter({
      store: opts.store ?? store,
      ownerOf: (res) => {
        const h = res.req.headers["x-test-owner"];
        return typeof h === "string" ? h : (res.locals.ownerId as string);
      },
    }),
  );
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/interviewers`;
}

function headers(owner: string, extra: Record<string, string> = {}) {
  return { "content-type": "application/json", "x-test-owner": owner, ...extra };
}

async function call(
  base: string,
  method: string,
  pathPart: string,
  owner: string,
  body?: unknown,
  raw?: string,
) {
  const res = await fetch(`${base}${pathPart}`, {
    method,
    headers: headers(owner),
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? (JSON.parse(text) as unknown) : undefined };
}

function inputOf(d: InterviewerDefinition): InterviewerInput {
  const { id: _i, source: _s, ownerId: _o, version: _v, createdAt: _c, updatedAt: _u, ...input } = d;
  return input;
}

function input(name = "My interviewer"): InterviewerInput {
  return { ...inputOf(PRESETS[0]), name };
}

async function createAs(base: string, owner: string, name = "Mine") {
  const r = await call(base, "POST", "", owner, input(name));
  expect(r.status).toBe(201);
  return r.json as Record<string, unknown> & { id: string; version: number };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET", () => {
  it("lists presets and only the caller's custom interviewers, as summaries", async () => {
    const base = await start();
    const mine = await createAs(base, "a", "Alpha");
    await createAs(base, "b", "Beta");
    const r = await call(base, "GET", "", "a");
    expect(r.status).toBe(200);
    const list = r.json as Record<string, unknown>[];
    expect(list).toHaveLength(PRESETS.length + 1);
    expect(list[list.length - 1]).toEqual({
      id: mine.id,
      name: "Alpha",
      purpose: mine.purpose,
      source: "custom",
      version: 1,
    });
    for (const s of list) expect(Object.keys(s).sort()).toEqual(["id", "name", "purpose", "source", "version"]);
    expect(list.map((s) => s.name)).not.toContain("Beta");
  });

  it("returns a preset's full record without ownerId", async () => {
    const base = await start();
    const r = await call(base, "GET", `/${PRESETS[0].id}`, "a");
    expect(r.status).toBe(200);
    const { ownerId: _o, ...expected } = PRESETS[0];
    expect(r.json).toEqual(expected);
    expect(Object.keys(r.json as object)).toEqual(RECORD_KEYS);
  });

  it("answers a foreign custom interviewer exactly like an unknown id", async () => {
    const base = await start();
    const theirs = await createAs(base, "b");
    const foreign = await call(base, "GET", `/${theirs.id}`, "a");
    const unknown = await call(base, "GET", "/no-such-id", "a");
    expect(foreign.status).toBe(404);
    expect(foreign.text).toBe(JSON.stringify({ error: "Interviewer not found" }));
    expect(unknown.status).toBe(404);
    expect(unknown.text).toBe(foreign.text);
    expect((await call(base, "GET", `/${theirs.id}`, "b")).status).toBe(200);
  });

  it("answers 404 for an overlong or malformed id without querying the store", async () => {
    const spy = { ...store, getInterviewer: vi.fn(store.getInterviewer) };
    const base = await start({ store: spy });
    for (const id of ["x".repeat(65), "bad.id", "bad%20id", "%E2%9C%93"]) {
      const r = await call(base, "GET", `/${id}`, "a");
      expect(r.status).toBe(404);
      expect(r.text).toBe(JSON.stringify({ error: "Interviewer not found" }));
    }
    expect((await call(base, "PUT", `/${"x".repeat(65)}`, "a", { ...input(), version: 1 })).status).toBe(404);
    expect((await call(base, "DELETE", "/bad.id", "a")).status).toBe(404);
    expect((await call(base, "POST", "/bad.id/duplicate", "a")).status).toBe(404);
    expect(spy.getInterviewer).not.toHaveBeenCalled();
    // A 64-character id is well-formed and does reach the store.
    expect((await call(base, "GET", `/${"x".repeat(64)}`, "a")).status).toBe(404);
    expect(spy.getInterviewer).toHaveBeenCalledTimes(1);
  });
});

describe("POST", () => {
  it("creates a custom interviewer: 201 with the record", async () => {
    const base = await start();
    const r = await call(base, "POST", "", "a", input("Created"));
    expect(r.status).toBe(201);
    const body = r.json as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(RECORD_KEYS);
    expect(body).toMatchObject({ ...input("Created"), source: "custom", version: 1 });
    expect(String(body.id)).toMatch(UUID_RE);
    expect((await store.getInterviewer(String(body.id), "a"))?.ownerId).toBe("a");
  });

  it("answers 422 with field errors that never echo the submitted text", async () => {
    const base = await start();
    const bad = {
      ...input(),
      name: `${SENTINEL}\u0001`,
      persona: SENTINEL.repeat(200),
      focus: [7],
      [SENTINEL]: SENTINEL,
      source: "preset",
      ownerId: "system",
    };
    const r = await call(base, "POST", "", "a", bad);
    expect(r.status).toBe(422);
    const errors = (r.json as { errors: { path: string; message: string }[] }).errors;
    expect(errors.map((e) => e.path)).toEqual(expect.arrayContaining(["name", "persona", "focus.0"]));
    expect(r.text).not.toContain("zebra");
    expect(await prisma.interviewer.count({ where: { source: "custom" } })).toBe(0);
    expect(allLogText()).not.toContain("zebra");
  });

  it("answers 422 for a body that is not an object", async () => {
    const base = await start();
    for (const raw of ["[]", `["${SENTINEL}"]`]) {
      const r = await call(base, "POST", "", "a", undefined, raw);
      expect(r.status).toBe(422);
      expect(r.json).toEqual({ errors: [{ path: "", message: "Request body must be a JSON object." }] });
    }
  });

  it("answers 400 with a fixed message for malformed JSON, and 413 for an oversized body", async () => {
    const base = await start();
    for (const raw of [`{"name": "${SENTINEL}`, `"${SENTINEL}"`, "null"]) {
      const r = await call(base, "POST", "", "a", undefined, raw);
      expect(r.status).toBe(400);
      expect(r.text).toBe(JSON.stringify({ error: "Request body is not valid JSON." }));
    }
    const big = await call(base, "POST", "", "a", { ...input(), persona: SENTINEL.repeat(4000) });
    expect(big.status).toBe(413);
    expect(big.text).toBe(JSON.stringify({ error: "Request body is too large." }));
    expect(allLogText()).not.toContain("zebra");
  });

  it("answers 422 with the limit message at 50 custom interviewers", async () => {
    const base = await start();
    for (let i = 0; i < 50; i++) await store.createInterviewer("a", input(`n${i}`));
    const r = await call(base, "POST", "", "a", input("51st"));
    expect(r.status).toBe(422);
    expect(r.json).toEqual({ errors: [{ path: "", message: "limit of 50 custom interviewers reached" }] });
    const dup = await call(base, "POST", `/${PRESETS[0].id}/duplicate`, "a");
    expect(dup.status).toBe(422);
    expect(dup.json).toEqual(r.json);
  });
});

describe("PUT", () => {
  it("replaces a custom interviewer and bumps the version; a stale version is 409", async () => {
    const base = await start();
    const created = await createAs(base, "a", "Before");
    const r = await call(base, "PUT", `/${created.id}`, "a", { ...input("After"), version: 1 });
    expect(r.status).toBe(200);
    expect(Object.keys(r.json as object)).toEqual(RECORD_KEYS);
    expect(r.json).toMatchObject({ id: created.id, name: "After", version: 2, createdAt: created.createdAt });
    const stale = await call(base, "PUT", `/${created.id}`, "a", { ...input("Stale"), version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.json).toEqual({ error: "version conflict" });
  });

  it("answers 403 for a preset", async () => {
    const base = await start();
    const r = await call(base, "PUT", `/${PRESETS[0].id}`, "a", { ...input(), version: 1 });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "presets cannot be changed" });
    expect(await store.getInterviewer(PRESETS[0].id, "a")).toEqual(PRESETS[0]);
  });

  it("answers a foreign custom interviewer exactly like an unknown id", async () => {
    const base = await start();
    const theirs = await createAs(base, "b", "Theirs");
    const foreign = await call(base, "PUT", `/${theirs.id}`, "a", { ...input("Hijack"), version: 1 });
    const unknown = await call(base, "PUT", "/no-such-id", "a", { ...input("Hijack"), version: 1 });
    expect(foreign.status).toBe(404);
    expect(foreign.text).toBe(JSON.stringify({ error: "Interviewer not found" }));
    expect(unknown.text).toBe(foreign.text);
    expect((await store.getInterviewer(theirs.id, "b"))?.name).toBe("Theirs");
  });

  it("answers 422 with path version for a missing or invalid version", async () => {
    const base = await start();
    const created = await createAs(base, "a");
    for (const version of [undefined, "1", 1.5, 0, null]) {
      const r = await call(base, "PUT", `/${created.id}`, "a", { ...input(), version });
      expect(r.status).toBe(422);
      const errors = (r.json as { errors: { path: string }[] }).errors;
      expect(errors.map((e) => e.path)).toEqual(["version"]);
    }
  });

  it("answers 422 for invalid input without echoing it", async () => {
    const base = await start();
    const created = await createAs(base, "a", "Kept");
    const r = await call(base, "PUT", `/${created.id}`, "a", { ...input(""), style: SENTINEL.repeat(100), version: 1 });
    expect(r.status).toBe(422);
    const errors = (r.json as { errors: { path: string }[] }).errors;
    expect(errors.map((e) => e.path).sort()).toEqual(["name", "style"]);
    expect(r.text).not.toContain("zebra");
    expect((await store.getInterviewer(created.id, "a"))?.name).toBe("Kept");
  });
});

describe("duplicate", () => {
  it("copies a preset into a custom interviewer: 201", async () => {
    const base = await start();
    const r = await call(base, "POST", `/${PRESETS[0].id}/duplicate`, "a");
    expect(r.status).toBe(201);
    expect(Object.keys(r.json as object)).toEqual(RECORD_KEYS);
    expect(r.json).toMatchObject({ name: `${PRESETS[0].name} (copy)`, source: "custom", version: 1 });
  });

  it("answers a foreign custom interviewer exactly like an unknown id", async () => {
    const base = await start();
    const theirs = await createAs(base, "b");
    const foreign = await call(base, "POST", `/${theirs.id}/duplicate`, "a");
    const unknown = await call(base, "POST", "/no-such-id/duplicate", "a");
    expect(foreign.status).toBe(404);
    expect(foreign.text).toBe(JSON.stringify({ error: "Interviewer not found" }));
    expect(unknown.text).toBe(foreign.text);
    expect(await prisma.interviewer.count({ where: { ownerId: "a" } })).toBe(0);
  });
});

describe("DELETE", () => {
  it("deletes a custom interviewer: 204", async () => {
    const base = await start();
    const created = await createAs(base, "a");
    const r = await call(base, "DELETE", `/${created.id}`, "a");
    expect(r.status).toBe(204);
    expect(r.text).toBe("");
    expect((await call(base, "GET", `/${created.id}`, "a")).status).toBe(404);
  });

  it("answers 403 for a preset", async () => {
    const base = await start();
    const r = await call(base, "DELETE", `/${PRESETS[0].id}`, "a");
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "presets cannot be changed" });
  });

  it("answers a foreign custom interviewer exactly like an unknown id", async () => {
    const base = await start();
    const theirs = await createAs(base, "b");
    const foreign = await call(base, "DELETE", `/${theirs.id}`, "a");
    const unknown = await call(base, "DELETE", "/no-such-id", "a");
    expect(foreign.status).toBe(404);
    expect(foreign.text).toBe(JSON.stringify({ error: "Interviewer not found" }));
    expect(unknown.text).toBe(foreign.text);
    expect(await store.getInterviewer(theirs.id, "b")).not.toBeNull();
  });
});

describe("authentication", () => {
  it("refuses a foreign origin and a missing token, as on other routes", async () => {
    const local = await start();
    const foreign = await fetch(local, { headers: { origin: "http://evil.example" } });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: "origin not allowed" });

    const tokenBase = await start({ env: { AUTH_TOKEN: "test-token-123" } });
    const none = await fetch(tokenBase);
    expect(none.status).toBe(401);
    const post = await fetch(tokenBase, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input()),
    });
    expect(post.status).toBe(401);
    expect(await prisma.interviewer.count({ where: { source: "custom" } })).toBe(0);
    const ok = await fetch(tokenBase, { headers: { authorization: "Bearer test-token-123" } });
    expect(ok.status).toBe(200);
  });

  it("uses the authenticated owner when no test header is sent", async () => {
    const base = await start();
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input("Local")),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect((await store.getInterviewer(id, "local"))?.ownerId).toBe("local");
  });
});

describe("logging", () => {
  it("logs ids and counts only, never interviewer text", async () => {
    const base = await start();
    const created = await createAs(base, "a", SENTINEL);
    await call(base, "PUT", `/${created.id}`, "a", { ...input(SENTINEL), version: 1 });
    await call(base, "POST", `/${created.id}/duplicate`, "a");
    await call(base, "DELETE", `/${created.id}`, "a");
    expect(allLogText()).not.toContain("zebra");
  });
});

describe("hidden designer preset", () => {
  it("is not listed, is readable, and is not writable or duplicable", async () => {
    await store.syncPresets(SYNCED_PRESETS);
    const base = await start();
    const list = await call(base, "GET", "", "a");
    expect(list.status).toBe(200);
    expect(list.text).not.toContain("interviewer-designer");
    expect((await call(base, "GET", "/interviewer-designer", "a")).status).toBe(200);
    expect((await call(base, "PUT", "/interviewer-designer", "a", { ...input("x"), version: 1 })).status).toBe(403);
    expect((await call(base, "DELETE", "/interviewer-designer", "a")).status).toBe(403);
    expect((await call(base, "POST", "/interviewer-designer/duplicate", "a")).status).toBe(404);
  });
});
