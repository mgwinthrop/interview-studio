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
    const m = /^Bearer\s+(.*)$/i.exec(header.trim());
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
      return { ok: true, ownerId: "local" };
    }

    const presented = extractToken(req);
    if (presented === undefined || !tokensMatch(presented, config.auth.token)) {
      return { ok: false, status: 401, reason: "unauthorized" };
    }
    return { ok: true, ownerId: "token" };
  };
}
