import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isLoopback, type Config } from "./config";

export type AuthResult =
  | { ok: true; ownerId: string }
  | { ok: false; status: 401 | 403; reason: string };

type AuthRequest = Pick<IncomingMessage, "headers" | "socket" | "url">;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

// Hash both sides so lengths are equal and timingSafeEqual never throws.
function tokensMatch(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

function extractToken(req: AuthRequest): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === "string") {
    // `\S` after `\s+` keeps the two classes from overlapping, so a failed match cannot backtrack.
    const m = /^Bearer\s+(\S.*)$/i.exec(header.trim());
    if (m) return m[1];
  }
  try {
    const q = new URL(req.url ?? "/", "http://localhost").searchParams.get("token");
    if (q !== null) return q;
  } catch {
    // malformed URL: treat as no token
  }
  return undefined;
}

/**
 * True when a Host header names a loopback host: `localhost`, 127.0.0.0/8 or ::1, with an
 * optional numeric port. Hostname comparison is case-insensitive; IPv6 may be bracketed
 * (`[::1]:3001`) or bare (`::1`, no port). Guards local mode against DNS rebinding.
 */
export function isLoopbackHostHeader(host: string | undefined): boolean {
  if (typeof host !== "string") return false;
  const h = host.trim().toLowerCase();
  let name: string;
  let port: string | undefined;
  if (h.startsWith("[")) {
    const m = /^\[([^\]]+)\](?::(.*))?$/.exec(h);
    if (!m) return false;
    [, name, port] = m;
  } else if (h.indexOf(":") !== h.lastIndexOf(":")) {
    name = h; // bare IPv6 literal: no port
  } else {
    const i = h.indexOf(":");
    name = i < 0 ? h : h.slice(0, i);
    port = i < 0 ? undefined : h.slice(i + 1);
  }
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return false;
  return name === "localhost" || name === "::1" || /^127(\.\d{1,3}){3}$/.test(name);
}

export function createAuthenticator(config: Config): (req: AuthRequest) => AuthResult {
  return (req) => {
    const remote = req.socket.remoteAddress;
    const loopback = remote !== undefined && isLoopback(remote);

    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!config.allowedOrigins.includes(origin)) {
        return { ok: false, status: 403, reason: "origin not allowed" };
      }
    } else if (!loopback) {
      return { ok: false, status: 403, reason: "origin required" };
    }

    if (config.auth.mode === "local") {
      if (!loopback) return { ok: false, status: 403, reason: "local mode accepts loopback only" };
      // A loopback peer is not enough: browsers omit Origin on some same-origin requests,
      // so a rebinding hostname could reach us. The fixed reason never echoes the header.
      if (!isLoopbackHostHeader(req.headers.host)) {
        return { ok: false, status: 403, reason: "host not allowed" };
      }
      return { ok: true, ownerId: "local" };
    }

    const presented = extractToken(req);
    if (presented === undefined || !tokensMatch(presented, config.auth.token)) {
      return { ok: false, status: 401, reason: "unauthorized" };
    }
    return { ok: true, ownerId: "token" };
  };
}
