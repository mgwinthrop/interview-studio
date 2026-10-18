import { describe, it, expect } from "vitest";
import { createAuthenticator } from "../auth";
import type { Config } from "../config";

const ORIGIN = "http://localhost:3000";

function cfg(auth: Config["auth"]): Config {
  return { allowedOrigins: [ORIGIN], auth } as Config;
}

function req(opts: {
  addr?: string;
  origin?: string;
  authorization?: string;
  url?: string;
  /** Host header; defaults to a loopback host. null omits it. */
  host?: string | null;
}) {
  const headers: Record<string, string> = {};
  const host = opts.host === undefined ? "localhost:3001" : opts.host;
  if (host !== null) headers.host = host;
  if (opts.origin) headers.origin = opts.origin;
  if (opts.authorization) headers.authorization = opts.authorization;
  return {
    headers,
    socket: { remoteAddress: opts.addr ?? "127.0.0.1" },
    url: opts.url ?? "/",
  } as never;
}

describe("local mode", () => {
  const auth = createAuthenticator(cfg({ mode: "local" }));

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])("accepts loopback %s", (addr) => {
    expect(auth(req({ addr, origin: ORIGIN }))).toEqual({ ok: true, ownerId: "local" });
  });

  it("rejects non-loopback with 403", () => {
    const r = auth(req({ addr: "10.0.0.5", origin: ORIGIN }));
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects missing remote address", () => {
    const r = auth({ headers: { origin: ORIGIN, host: "localhost:3001" }, socket: {}, url: "/" } as never);
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
});

describe("local mode Host check", () => {
  const auth = createAuthenticator(cfg({ mode: "local" }));

  it.each([
    "localhost:3001",
    "localhost",
    "LOCALHOST",
    "LocalHost:3001",
    "127.0.0.1:3001",
    "127.0.0.1",
    "127.1.2.3:8080",
    "[::1]:3001",
    "[::1]",
    "::1",
  ])("accepts loopback Host %j", (host) => {
    expect(auth(req({ host }))).toEqual({ ok: true, ownerId: "local" });
    expect(auth(req({ host, origin: ORIGIN }))).toEqual({ ok: true, ownerId: "local" });
  });

  it.each([
    "evil.example",
    "evil.example:3001",
    "",
    "127.0.0.1.evil.example",
    "localhost.evil.example:3001",
    "[::1].evil.example",
    "[::2]:3001",
    "0.0.0.0:3001",
    "localhost:abc",
  ])("rejects Host %j with a fixed 403 reason", (host) => {
    const r = auth(req({ host }));
    expect(r).toEqual({ ok: false, status: 403, reason: "host not allowed" });
    if (host) expect(JSON.stringify(r)).not.toContain(host);
  });

  it("rejects a missing Host header", () => {
    expect(auth(req({ host: null }))).toEqual({ ok: false, status: 403, reason: "host not allowed" });
  });

  it("token mode ignores the Host header when the token is valid", () => {
    const t = createAuthenticator(cfg({ mode: "token", token: "s3cret" }));
    for (const host of ["app.example.com", "evil.example:3001", null]) {
      expect(t(req({ host, addr: "10.0.0.5", origin: ORIGIN, authorization: "Bearer s3cret" }))).toEqual({
        ok: true,
        ownerId: "token",
      });
    }
  });
});

describe("origin check", () => {
  const auth = createAuthenticator(cfg({ mode: "local" }));

  it("rejects an origin not in the allow list", () => {
    expect(auth(req({ origin: "http://evil.example" }))).toEqual({
      ok: false,
      status: 403,
      reason: "origin not allowed",
    });
  });

  it("accepts a missing origin from loopback", () => {
    expect(auth(req({}))).toEqual({ ok: true, ownerId: "local" });
  });

  it("rejects a missing origin from non-loopback in token mode", () => {
    const t = createAuthenticator(cfg({ mode: "token", token: "s3cret" }));
    const r = t(req({ addr: "10.0.0.5", authorization: "Bearer s3cret" }));
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
});

describe("token mode", () => {
  const auth = createAuthenticator(cfg({ mode: "token", token: "s3cret" }));

  it("accepts a bearer header", () => {
    expect(auth(req({ origin: ORIGIN, authorization: "Bearer s3cret" }))).toEqual({
      ok: true,
      ownerId: "token",
    });
  });

  it("accepts a token query parameter", () => {
    expect(auth(req({ origin: ORIGIN, url: "/?token=s3cret" }))).toEqual({
      ok: true,
      ownerId: "token",
    });
  });

  it("accepts a non-loopback client with allowed origin and valid token", () => {
    expect(auth(req({ addr: "10.0.0.5", origin: ORIGIN, authorization: "Bearer s3cret" }))).toEqual({
      ok: true,
      ownerId: "token",
    });
  });

  it("returns 401 when the token is missing", () => {
    expect(auth(req({ origin: ORIGIN }))).toMatchObject({ ok: false, status: 401 });
  });

  it.each(["wrong", "s3cret-longer", "s3", ""])("returns 401 for wrong token %j", (t) => {
    const r = auth(req({ origin: ORIGIN, authorization: `Bearer ${t}` }));
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("never includes the token in the reason", () => {
    const r = auth(req({ origin: ORIGIN, authorization: "Bearer guess-token" }));
    expect(JSON.stringify(r)).not.toContain("guess-token");
    expect(JSON.stringify(r)).not.toContain("s3cret");
  });

  it("checks origin before token", () => {
    const r = auth(req({ origin: "http://evil.example", authorization: "Bearer s3cret" }));
    expect(r).toMatchObject({ ok: false, status: 403, reason: "origin not allowed" });
  });
});
