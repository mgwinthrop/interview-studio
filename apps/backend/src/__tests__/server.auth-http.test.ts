import { describe, expect, it } from "vitest";
import http from "node:http";
import {
  PRESET,
  allLogText,
  connect,
  makeConfig,
  persistence,
  prisma,
  start,
  setupServerTestEnv,
} from "./helpers/server";

setupServerTestEnv();

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

