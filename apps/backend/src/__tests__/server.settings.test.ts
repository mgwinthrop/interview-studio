import { afterEach, describe, expect, it } from "vitest";
import type { ModelCatalog } from "../modelCatalog";
import type { SettingsService } from "../settingsService";
import { allLogText, makeConfig, setupServerTestEnv, start } from "./helpers/server";

const env = setupServerTestEnv();

const ANTHROPIC = "sk-ant-test-DO-NOT-LEAK";
const ELEVEN = "xi-test-DO-NOT-LEAK";
const TOKEN = "settings-token-value-123456";

afterEach(async () => {
  await env.prisma.appSettings.deleteMany();
  await env.prisma.modelPrice.deleteMany();
});

function model(id: string, line: string) {
  const tier = line === "haiku" ? "fast" : line === "sonnet" ? "balanced" : "most-capable";
  return { id, displayName: id, createdAt: "2025-01-01T00:00:00Z", lifecycle: "active", line, tier } as const;
}
function catalog(up = true): ModelCatalog {
  return {
    claude: async () =>
      up
        ? { ok: true, models: [model("c-haiku", "haiku"), model("c-sonnet", "sonnet"), model("c-opus", "opus")] }
        : { ok: false },
    tts: async () => ({ ok: true, models: [{ id: "tts-a", name: "A" }] }),
  };
}
const cloud = () => makeConfig({ PROFILE: "cloud", ANTHROPIC_API_KEY: ANTHROPIC, ELEVENLABS_API_KEY: ELEVEN });

const json = { "Content-Type": "application/json" };
const put = (base: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/settings`, { method: "PUT", headers: { ...json, ...headers }, body: JSON.stringify(body) });

describe("/api/settings", () => {
  it("GET on a fresh database in mock profile picks and remembers mock models", async () => {
    const r = await start();
    const res = await fetch(`${r.base}/api/settings`);
    expect(res.status).toBe(200);
    const page = await res.json() as any;
    expect(page.values.replyModel).toBe("mock-fast");
    expect(page.values.reportModel).toBe("mock-balanced");
    expect(page.values.draftModel).toBe("mock-balanced");
    expect(page.micFormat).toEqual({ sampleRateHz: 16000, channels: 1, bitDepth: 16 });
    expect(Array.isArray(page.spokenFormats)).toBe(true);
    const again = await (await fetch(`${r.base}/api/settings`)).json() as any;
    expect(again.values).toEqual(page.values);
  });

  it("PUT a valid change then GET shows it", async () => {
    const r = await start({ config: cloud(), catalog: catalog() });
    const res = await put(r.base, { values: { replyModel: "c-opus", replyMaxTokens: 400 } });
    expect(res.status).toBe(200);
    expect((await res.json() as any).values.replyModel).toBe("c-opus");
    const got = await (await fetch(`${r.base}/api/settings`)).json() as any;
    expect(got.values.replyModel).toBe("c-opus");
    expect(got.values.replyMaxTokens).toBe(400);
  });

  it("PUT invalid model, format and tokens give 422 with paths and change nothing", async () => {
    const r = await start({ config: cloud(), catalog: catalog() });
    const before = await (await fetch(`${r.base}/api/settings`)).json() as any;
    const res = await put(r.base, { values: { spokenFormat: "wav", replyMaxTokens: 5 } });
    expect(res.status).toBe(422);
    const paths = (await res.json() as any).errors.map((e: { path: string }) => e.path);
    expect(paths).toContain("values.replyMaxTokens");
    expect(paths).toContain("values.spokenFormat");
    const unlisted = await put(r.base, { values: { replyModel: "nope" } });
    expect(unlisted.status).toBe(422);
    expect((await unlisted.json() as any).errors).toEqual([
      { path: "values.replyModel", message: "That model is not available." },
    ]);
    const after = await (await fetch(`${r.base}/api/settings`)).json() as any;
    expect(after.values).toEqual(before.values);
  });

  it("with the Claude list down: rejects a changed model, accepts a price edit and an unchanged value", async () => {
    const up = await start({ config: cloud(), catalog: catalog() });
    const first = await (await fetch(`${up.base}/api/settings`)).json() as any;
    await up.close();
    const r = await start({ config: cloud(), catalog: catalog(false) });
    const changed = await put(r.base, { values: { replyModel: "c-opus" } });
    expect(changed.status).toBe(422);
    expect((await changed.json() as any).errors[0].path).toBe("values.replyModel");
    const price = { model: first.values.replyModel, inputPerMtok: 1, outputPerMtok: 5, asOf: "2026-01-01" };
    const ok = await put(r.base, { values: { replyModel: first.values.replyModel }, prices: [price] });
    expect(ok.status).toBe(200);
    expect((await ok.json() as any).prices).toEqual([price]);
  });

  it("reset restores recommended values and keeps prices", async () => {
    const r = await start({ config: cloud(), catalog: catalog() });
    const price = { model: "c-opus", inputPerMtok: 15, outputPerMtok: 75, asOf: "2026-01-01" };
    await put(r.base, { values: { replyModel: "c-opus", replyMaxTokens: 700 }, prices: [price] });
    const res = await fetch(`${r.base}/api/settings/reset`, { method: "POST" });
    expect(res.status).toBe(200);
    const page = await res.json() as any;
    expect(page.values.replyModel).toBe("c-haiku");
    expect(page.values.replyMaxTokens).toBe(300);
    expect(page.prices).toEqual([price]);
  });

  it("reset with the list down leaves model fields unchanged", async () => {
    const up = await start({ config: cloud(), catalog: catalog() });
    await put(up.base, { values: { replyModel: "c-opus" } });
    await up.close();
    const r = await start({ config: cloud(), catalog: catalog(false) });
    const page = await (await fetch(`${r.base}/api/settings/reset`, { method: "POST" })).json() as any;
    expect(page.values.replyModel).toBe("c-opus");
  });

  it("requires the authenticator and isolates owners", async () => {
    const t = await start({ config: makeConfig({ AUTH_TOKEN: TOKEN }) });
    expect((await fetch(`${t.base}/api/settings`)).status).toBe(401);
    expect((await fetch(`${t.base}/api/settings/reset`, { method: "POST" })).status).toBe(401);
    expect((await put(t.base, {})).status).toBe(401);
    const auth = { Authorization: `Bearer ${TOKEN}` };
    expect((await fetch(`${t.base}/api/settings`, { headers: auth })).status).toBe(200);
    expect((await put(t.base, { values: { replyMaxTokens: 123 } }, auth)).status).toBe(200);
    // The local owner does not see the token owner's value.
    const l = await start();
    const local = await (await fetch(`${l.base}/api/settings`)).json() as any;
    expect(local.values.replyMaxTokens).toBe(300);
    const tok = await (await fetch(`${t.base}/api/settings`, { headers: auth })).json() as any;
    expect(tok.values.replyMaxTokens).toBe(123);
  });

  it("never exposes API keys in responses or logs", async () => {
    const r = await start({ config: cloud(), catalog: catalog() });
    const texts = [
      await (await fetch(`${r.base}/api/settings`)).text(),
      await (await put(r.base, { values: { replyModel: "nope" } })).text(),
      await (await fetch(`${r.base}/api/settings/reset`, { method: "POST" })).text(),
    ];
    for (const t of texts) {
      expect(t).not.toContain(ANTHROPIC);
      expect(t).not.toContain(ELEVEN);
    }
    expect(allLogText()).not.toContain(ANTHROPIC);
    expect(allLogText()).not.toContain(ELEVEN);
  });

  it("answers fixed 413 and 400 for bad bodies", async () => {
    const r = await start();
    const big = await fetch(`${r.base}/api/settings`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ values: { replyModel: "x".repeat(40_000) } }),
    });
    expect(big.status).toBe(413);
    expect(await big.json() as any).toEqual({ error: "Request body is too large." });
    const bad = await fetch(`${r.base}/api/settings`, { method: "PUT", headers: json, body: "{not json secret-text" });
    expect(bad.status).toBe(400);
    expect(await bad.json() as any).toEqual({ error: "Request body is not valid JSON." });
    expect(allLogText()).not.toContain("secret-text");
  });

  it("answers 500 Internal error when the service throws, and honours the override", async () => {
    const fail = async (): Promise<never> => {
      throw new Error("db secret-detail");
    };
    const boom: SettingsService = { get: fail, page: fail, save: fail, reset: fail };
    const r = await start({ settings: boom });
    for (const res of [
      await fetch(`${r.base}/api/settings`),
      await put(r.base, {}),
      await fetch(`${r.base}/api/settings/reset`, { method: "POST" }),
    ]) {
      expect(res.status).toBe(500);
      expect(await res.json() as any).toEqual({ error: "Internal error" });
    }
    expect(allLogText()).not.toContain("secret-detail");
  });
});
