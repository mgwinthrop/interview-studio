import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import {
  createMockCatalog,
  createModelCatalog,
  recommend,
  tierOf,
  type ClaudeModel,
} from "../modelCatalog.js";

const KEY = "sk-ant-SECRET-key-123";
const XI = "xi-SECRET-456";
const cfg = (over: Partial<Config> = {}) =>
  ({ profile: "cloud", anthropicApiKey: KEY, elevenlabsApiKey: XI, ...over }) as Config;

const json = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

function entry(id: string, line: string | null, createdAt: string, lifecycle = "active") {
  return { id, display_name: id.toUpperCase(), created_at: createdAt, lifecycle, line };
}

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

type F = typeof globalThis.fetch;

afterEach(() => vi.restoreAllMocks());

describe("tierOf", () => {
  it("maps lines case-insensitively and nothing else", () => {
    expect(tierOf("haiku")).toBe("fast");
    expect(tierOf("Sonnet")).toBe("balanced");
    expect(tierOf("OPUS")).toBe("most-capable");
    expect(tierOf("fable")).toBeNull();
    expect(tierOf("mythos")).toBeNull();
    expect(tierOf(null)).toBeNull();
    expect(tierOf(undefined)).toBeNull();
  });
});

describe("claude listing", () => {
  it("maps fields, tiers, drops retired, keeps deprecated, sends headers", async () => {
    const fetch = vi.fn(async () =>
      json({
        data: [
          entry("h1", "haiku", "2025-01-01T00:00:00Z"),
          entry("s1", "sonnet", "2025-02-01T00:00:00Z", "deprecated"),
          entry("o1", "opus", "2025-03-01T00:00:00Z"),
          entry("f1", "fable", "2025-04-01T00:00:00Z"),
          entry("r1", "haiku", "2024-01-01T00:00:00Z", "retired"),
          { display_name: "no id" },
          { id: "bare" },
        ],
        has_more: false,
      }),
    );
    const c = createModelCatalog(cfg(), { fetch: fetch as unknown as F });
    const r = await c.claude();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error();
    expect(r.models.map((m) => m.id)).toEqual(["h1", "s1", "o1", "f1", "bare"]);
    expect(r.models[0]).toEqual({
      id: "h1",
      displayName: "H1",
      createdAt: "2025-01-01T00:00:00Z",
      lifecycle: "active",
      line: "haiku",
      tier: "fast",
    });
    expect(r.models[1].lifecycle).toBe("deprecated");
    expect(r.models[1].tier).toBe("balanced");
    expect(r.models[2].tier).toBe("most-capable");
    expect(r.models[3].tier).toBeNull();
    expect(r.models[4].line).toBeNull();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    const h = init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe(KEY);
    expect(h["anthropic-version"]).toBe("2023-06-01");
  });

  it("follows has_more with after_id and stops at 5 pages", async () => {
    let n = 0;
    const fetch = vi.fn(async () => {
      n++;
      return json({ data: [entry(`m${n}`, "haiku", "2025-01-01T00:00:00Z")], has_more: true, last_id: `m${n}` });
    });
    const c = createModelCatalog(cfg(), { fetch: fetch as unknown as F });
    const r = await c.claude();
    expect(fetch).toHaveBeenCalledTimes(5);
    const urls = fetch.mock.calls.map((x) => (x as unknown as [string])[0]);
    expect(urls[1]).toBe("https://api.anthropic.com/v1/models?limit=1000&after_id=m1");
    expect(r.ok && r.models.length).toBe(5);
  });

  it.each([
    ["non-200", () => json({ error: "x" }, 500)],
    ["bad json", () => json("not json{")],
    ["empty data", () => json({ data: [], has_more: false })],
    ["only retired", () => json({ data: [entry("r", "haiku", "2024-01-01T00:00:00Z", "retired")] })],
  ])("gives ok:false (unavailable) on %s", async (_n, make) => {
    const c = createModelCatalog(cfg(), { fetch: (async () => make()) as unknown as F });
    expect(await c.claude()).toEqual({ ok: false, reason: "unavailable" });
  });

  it("gives ok:false on a thrown fetch without leaking the key anywhere", async () => {
    const logs: string[] = [];
    for (const m of ["log", "warn", "error", "info", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
    }
    const fetch = async () => {
      throw new Error(`boom ${KEY}`);
    };
    const c = createModelCatalog(cfg(), { fetch: fetch as unknown as F });
    const r = await c.claude();
    expect(r).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("returns ok:false with no network call when the key is missing or empty", async () => {
    const fetch = vi.fn();
    for (const k of [undefined, ""]) {
      const c = createModelCatalog(cfg({ anthropicApiKey: k, elevenlabsApiKey: k }), {
        fetch: fetch as unknown as F,
      });
      expect(await c.claude()).toEqual({ ok: false, reason: "no-key" });
      expect(await c.tts()).toEqual({ ok: false, reason: "no-key" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([401, 403])("maps HTTP %i on the first page to key-rejected", async (status) => {
    const c = createModelCatalog(cfg(), { fetch: (async () => json({ error: "x" }, status)) as unknown as F });
    expect(await c.claude()).toEqual({ ok: false, reason: "key-rejected" });
  });

  it("maps a 401 on page 2 to key-rejected, and a 500 on page 2 to unavailable", async () => {
    for (const [status, reason] of [[401, "key-rejected"], [500, "unavailable"]] as const) {
      let n = 0;
      const fetch = async () =>
        n++ === 0
          ? json({ data: [entry("a", "haiku", "2025-01-01T00:00:00Z")], has_more: true, last_id: "a" })
          : json("x", status);
      const c = createModelCatalog(cfg(), { fetch: fetch as unknown as F });
      expect(await c.claude()).toEqual({ ok: false, reason });
    }
  });

  it("maps a timeout to unavailable", async () => {
    const fetch = async () => {
      throw new DOMException("timed out", "TimeoutError");
    };
    const c = createModelCatalog(cfg(), { fetch: fetch as unknown as F });
    expect(await c.claude()).toEqual({ ok: false, reason: "unavailable" });
  });

  it.each([400, 401, 403])("maps an ElevenLabs %i to key-rejected", async (status) => {
    const c = createModelCatalog(cfg(), { fetch: (async () => json({}, status)) as unknown as F });
    expect(await c.tts()).toEqual({ ok: false, reason: "key-rejected" });
  });

  it("maps an ElevenLabs 500 to unavailable and an Anthropic 400 to unavailable", async () => {
    const c = createModelCatalog(cfg(), { fetch: (async () => json({}, 500)) as unknown as F });
    expect(await c.tts()).toEqual({ ok: false, reason: "unavailable" });
    const d = createModelCatalog(cfg(), { fetch: (async () => json({}, 400)) as unknown as F });
    expect(await d.claude()).toEqual({ ok: false, reason: "unavailable" });
  });

  it("returns a cached failure with the same reason and no new fetch", async () => {
    const fetch = vi.fn(async () => json({}, 401));
    const c = createModelCatalog(cfg(), { fetch: fetch as unknown as F });
    expect(await c.claude()).toEqual({ ok: false, reason: "key-rejected" });
    expect(await c.claude()).toEqual({ ok: false, reason: "key-rejected" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("caches a success for ttlMs and refetches after", async () => {
    const k = clock();
    const fetch = vi.fn(async () => json({ data: [entry("a", "haiku", "2025-01-01T00:00:00Z")] }));
    const c = createModelCatalog(cfg(), { fetch: fetch as unknown as F, now: k.now, ttlMs: 60_000 });
    await c.claude();
    k.advance(59_000);
    await c.claude();
    expect(fetch).toHaveBeenCalledTimes(1);
    k.advance(2_000);
    await c.claude();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a failure after 30 s but not within", async () => {
    const k = clock();
    const fetch = vi.fn(async () => json("x", 500));
    const c = createModelCatalog(cfg(), { fetch: fetch as unknown as F, now: k.now });
    await c.claude();
    k.advance(29_000);
    await c.claude();
    expect(fetch).toHaveBeenCalledTimes(1);
    k.advance(2_000);
    await c.claude();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight fetch between concurrent calls", async () => {
    const fetch = vi.fn(async () => json({ data: [entry("a", "haiku", "2025-01-01T00:00:00Z")] }));
    const c = createModelCatalog(cfg(), { fetch: fetch as unknown as F });
    const [a, b] = await Promise.all([c.claude(), c.claude()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
});

describe("tts listing", () => {
  it("keeps only text-to-speech models and sends xi-api-key", async () => {
    const fetch = vi.fn(async () =>
      json([
        { model_id: "eleven_flash_v2_5", name: "Flash", can_do_text_to_speech: true },
        { model_id: "scribe", name: "Scribe", can_do_text_to_speech: false },
        { model_id: "x", name: "X" },
        { name: "no id", can_do_text_to_speech: true },
      ]),
    );
    const c = createModelCatalog(cfg(), { fetch: fetch as unknown as F });
    expect(await c.tts()).toEqual({ ok: true, models: [{ id: "eleven_flash_v2_5", name: "Flash" }] });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/models");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(XI);
  });

  it("gives ok:false on non-array or no TTS models", async () => {
    const c1 = createModelCatalog(cfg(), { fetch: (async () => json({})) as unknown as F });
    expect(await c1.tts()).toEqual({ ok: false, reason: "unavailable" });
    const c2 = createModelCatalog(cfg(), {
      fetch: (async () => json([{ model_id: "a", name: "A", can_do_text_to_speech: false }])) as unknown as F,
    });
    expect(await c2.tts()).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("recommend", () => {
  const m = (id: string, tier: ClaudeModel["tier"], createdAt: string, lifecycle = "active"): ClaudeModel => ({
    id,
    displayName: id,
    createdAt,
    lifecycle,
    line: null,
    tier,
  });
  const models = [
    m("fast-old", "fast", "2025-01-01T00:00:00Z"),
    m("fast-new", "fast", "2025-06-01T00:00:00Z"),
    m("fast-dep", "fast", "2026-01-01T00:00:00Z", "deprecated"),
    m("bal-old", "balanced", "2025-01-01T00:00:00Z"),
    m("bal-new", "balanced", "2025-06-01T00:00:00Z"),
    m("cap", "most-capable", "2026-06-01T00:00:00Z"),
  ];

  it("reply picks newest active fast", () => {
    expect(recommend("reply", models)?.id).toBe("fast-new");
  });
  it("report and draft pick newest active balanced", () => {
    expect(recommend("report", models)?.id).toBe("bal-new");
    expect(recommend("draft", models)?.id).toBe("bal-new");
  });
  it("returns null when none, and ignores deprecated", () => {
    expect(recommend("reply", [m("d", "fast", "2025-01-01T00:00:00Z", "deprecated")])).toBeNull();
    expect(recommend("reply", [])).toBeNull();
  });
  it("breaks ties by id descending and sorts invalid dates oldest", () => {
    const t = [m("a", "fast", "2025-01-01T00:00:00Z"), m("b", "fast", "2025-01-01T00:00:00Z")];
    expect(recommend("reply", t)?.id).toBe("b");
    const bad = [m("z", "fast", "garbage"), m("a", "fast", "2025-01-01T00:00:00Z")];
    expect(recommend("reply", bad)?.id).toBe("a");
  });
});

describe("mock catalog", () => {
  it("returns the fixed mock ids", async () => {
    const c = createMockCatalog();
    const r = await c.claude();
    if (!r.ok) throw new Error();
    expect(r.models.map((x) => [x.id, x.line, x.tier, x.lifecycle])).toEqual([
      ["mock-fast", "haiku", "fast", "active"],
      ["mock-balanced", "sonnet", "balanced", "active"],
      ["mock-capable", "opus", "most-capable", "active"],
    ]);
    expect(new Set(r.models.map((x) => x.createdAt)).size).toBe(3);
    const t = await c.tts();
    expect(t.ok && t.models.map((x) => x.id)).toEqual(["mock-tts-flash"]);
  });
});
