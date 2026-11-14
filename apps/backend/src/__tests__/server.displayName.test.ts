import { describe, expect, it } from "vitest";
import {
  type Client,
  type Running,
  connect,
  createdCustom,
  customInput,
  setupServerTestEnv,
  start,
} from "./helpers/server";

// FQ-44 slice 1 (#66): the display name survives every write path (create, update, duplicate)
// and is accepted on a Try it draft over the WebSocket, which uses the same strict schema.

const env = setupServerTestEnv();

type Json = Record<string, unknown>;

async function call(r: Running, method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${r.base}/api/interviewers${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Json) : {} };
}

async function create(r: Running, displayName?: string): Promise<Json> {
  const body = displayName === undefined ? customInput() : { ...customInput(), displayName };
  const res = await call(r, "POST", "", body);
  expect(res.status).toBe(201);
  createdCustom.push(res.json.id as string);
  return res.json;
}

async function startWith(c: Client, fields: Json): Promise<void> {
  await c.opened;
  c.send({ type: "session_start", ...fields });
}

describe("interviewer displayName over HTTP", () => {
  it("POST stores it and GET returns it", async () => {
    const r = await start();
    const created = await create(r, "Practice interviewer");
    expect(created.displayName).toBe("Practice interviewer");
    const got = await call(r, "GET", `/${created.id as string}`);
    expect(got.status).toBe(200);
    expect(got.json.displayName).toBe("Practice interviewer");
    const row = await env.prisma.interviewer.findUnique({ where: { id: created.id as string } });
    expect(JSON.parse(row!.definitionJson).displayName).toBe("Practice interviewer");
  });

  it("PUT changes it, and a PUT without it removes it", async () => {
    const r = await start();
    const created = await create(r, "Ada");
    const id = created.id as string;
    const changed = await call(r, "PUT", `/${id}`, { ...customInput(), displayName: "Grace", version: created.version });
    expect(changed.status).toBe(200);
    expect((await call(r, "GET", `/${id}`)).json.displayName).toBe("Grace");
    const cleared = await call(r, "PUT", `/${id}`, { ...customInput(), version: changed.json.version });
    expect(cleared.status).toBe(200);
    expect("displayName" in (await call(r, "GET", `/${id}`)).json).toBe(false);
  });

  it("duplicate keeps it", async () => {
    const r = await start();
    const created = await create(r, "Story listener");
    const dup = await call(r, "POST", `/${created.id as string}/duplicate`);
    expect(dup.status).toBe(201);
    createdCustom.push(dup.json.id as string);
    expect(dup.json.displayName).toBe("Story listener");
  });

  it("an interviewer created without it has no displayName key", async () => {
    const r = await start();
    const created = await create(r);
    expect("displayName" in created).toBe(false);
  });

  it("rejects 41 characters with a field error and stores nothing", async () => {
    const r = await start();
    const before = await env.prisma.interviewer.count();
    const res = await call(r, "POST", "", { ...customInput(), displayName: "x".repeat(41) });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.json)).toContain("displayName");
    expect(await env.prisma.interviewer.count()).toBe(before);
  });
});

describe("Try it draft with displayName over the WebSocket", () => {
  it("starts a trial session", async () => {
    const r = await start();
    const c = connect(r);
    await startWith(c, { draft: { ...customInput(), displayName: "Thinking partner" } });
    const started = await c.next((m) => m.type === "session_started");
    expect(typeof started.sessionId).toBe("string");
    c.send({ type: "session_end" });
    await c.closed;
  });

  it("closes 1008 'invalid draft' when it is too long", async () => {
    const r = await start();
    const c = connect(r);
    await startWith(c, { draft: { ...customInput(), displayName: "x".repeat(41) } });
    expect(await c.closed).toEqual({ code: 1008, reason: "invalid draft" });
  });
});
