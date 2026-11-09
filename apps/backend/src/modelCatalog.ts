import type { Config } from "./config.js";
import { errName } from "./errors.js";

export type Tier = "fast" | "balanced" | "most-capable";
export type Job = "reply" | "report" | "draft";
export interface ClaudeModel {
  id: string;
  displayName: string;
  createdAt: string;
  lifecycle: string;
  line: string | null;
  tier: Tier | null;
}
export interface TtsModel {
  id: string;
  name: string;
}
export type Listing<T> = { ok: true; models: T[] } | { ok: false };
export interface ModelCatalog {
  claude(): Promise<Listing<ClaudeModel>>;
  tts(): Promise<Listing<TtsModel>>;
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/models?limit=1000";
const ELEVEN_URL = "https://api.elevenlabs.io/v1/models";
const MAX_PAGES = 5;
const TIMEOUT_MS = 8000;
const FAILURE_TTL_MS = 30_000;
const DEFAULT_TTL_MS = 600_000;

export function tierOf(line: string | null | undefined): Tier | null {
  switch (typeof line === "string" ? line.toLowerCase() : "") {
    case "haiku":
      return "fast";
    case "sonnet":
      return "balanced";
    case "opus":
      return "most-capable";
    default:
      return null;
  }
}

function time(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

export function recommend(job: Job, models: readonly ClaudeModel[]): ClaudeModel | null {
  const want: Tier = job === "reply" ? "fast" : "balanced";
  let best: ClaudeModel | null = null;
  for (const m of models) {
    if (m.tier !== want || m.lifecycle !== "active") continue;
    if (!best) {
      best = m;
      continue;
    }
    const dt = time(m.createdAt) - time(best.createdAt);
    // Equal (including both invalid) falls back to id descending.
    const newer = dt > 0 || (!(dt < 0) && m.id > best.id);
    if (newer) best = m;
  }
  return best;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function parseClaudeEntry(e: unknown): ClaudeModel | null {
  if (!isObj(e)) return null;
  const id = str(e.id);
  if (!id) return null;
  const lifecycle = str(e.lifecycle) ?? "active";
  if (lifecycle === "retired") return null;
  const line = str(e.line);
  return {
    id,
    displayName: str(e.display_name) ?? id,
    createdAt: str(e.created_at) ?? "",
    lifecycle,
    line,
    tier: tierOf(line),
  };
}

class Failure extends Error {}

export function createModelCatalog(
  config: Config,
  deps: { fetch?: typeof fetch; now?: () => number; ttlMs?: number } = {},
): ModelCatalog {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;

  async function get(url: string, headers: Record<string, string>, who: string): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      console.warn(`[catalog] ${who} list unavailable (${errName(err)})`);
      throw new Failure();
    }
    if (res.status !== 200) {
      console.warn(`[catalog] ${who} list unavailable (${res.status})`);
      throw new Failure();
    }
    try {
      return await res.json();
    } catch (err) {
      console.warn(`[catalog] ${who} list unavailable (${errName(err)})`);
      throw new Failure();
    }
  }

  function cached<T>(load: () => Promise<T[]>): () => Promise<Listing<T>> {
    let entry: { value: Listing<T>; expiresAt: number } | null = null;
    let inflight: Promise<Listing<T>> | null = null;
    return () => {
      if (entry && now() < entry.expiresAt) return Promise.resolve(entry.value);
      if (inflight) return inflight;
      inflight = (async (): Promise<Listing<T>> => {
        let value: Listing<T>;
        try {
          const models = await load();
          value = models.length > 0 ? { ok: true, models } : { ok: false };
        } catch {
          value = { ok: false };
        }
        entry = { value, expiresAt: now() + (value.ok ? ttlMs : Math.min(ttlMs, FAILURE_TTL_MS)) };
        return value;
      })().finally(() => {
        inflight = null;
      });
      return inflight;
    };
  }

  const claude = cached<ClaudeModel>(async () => {
    const key = config.anthropicApiKey;
    if (!key) return [];
    const headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
    const out: ClaudeModel[] = [];
    let url = ANTHROPIC_URL;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await get(url, headers, "anthropic");
      if (!isObj(body) || !Array.isArray(body.data)) throw new Failure();
      for (const e of body.data) {
        const m = parseClaudeEntry(e);
        if (m) out.push(m);
      }
      const last = str(body.last_id);
      if (body.has_more !== true || !last) break;
      url = `${ANTHROPIC_URL}&after_id=${encodeURIComponent(last)}`;
    }
    return out;
  });

  const tts = cached<TtsModel>(async () => {
    const key = config.elevenlabsApiKey;
    if (!key) return [];
    const body = await get(ELEVEN_URL, { "xi-api-key": key }, "elevenlabs");
    if (!Array.isArray(body)) throw new Failure();
    const out: TtsModel[] = [];
    for (const e of body) {
      if (!isObj(e) || e.can_do_text_to_speech !== true) continue;
      const id = str(e.model_id);
      if (!id) continue;
      out.push({ id, name: str(e.name) ?? id });
    }
    return out;
  });

  return { claude, tts };
}

export function createMockCatalog(): ModelCatalog {
  const mk = (id: string, displayName: string, line: string, createdAt: string): ClaudeModel => ({
    id,
    displayName,
    createdAt,
    lifecycle: "active",
    line,
    tier: tierOf(line),
  });
  const models = [
    mk("mock-fast", "Mock Fast", "haiku", "2025-01-01T00:00:00Z"),
    mk("mock-balanced", "Mock Balanced", "sonnet", "2025-02-01T00:00:00Z"),
    mk("mock-capable", "Mock Capable", "opus", "2025-03-01T00:00:00Z"),
  ];
  return {
    claude: async () => ({ ok: true, models: models.map((m) => ({ ...m })) }),
    tts: async () => ({ ok: true, models: [{ id: "mock-tts-flash", name: "Mock Flash" }] }),
  };
}
