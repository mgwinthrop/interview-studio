import { describe, expect, it, vi } from "vitest";
import { tierOf, type ClaudeModel, type Listing, type ModelCatalog, type TtsModel } from "../modelCatalog";
import { BUILT_IN, type PriceRow, type SettingsValues } from "../settings";
import { createSettingsService, staticSettings, type SettingsStoreDeps } from "../settingsService";

const OWNER = "owner-1";
const MARK = "ZZMARKERZZ";

function model(id: string, line: string, createdAt: string, lifecycle = "active"): ClaudeModel {
  return { id, displayName: id.toUpperCase(), createdAt, lifecycle, line, tier: tierOf(line) };
}

const BASE_MODELS = [
  model("haiku-old", "haiku", "2025-01-01T00:00:00Z"),
  model("haiku-new", "haiku", "2025-06-01T00:00:00Z"),
  model("sonnet-old", "sonnet", "2025-02-01T00:00:00Z"),
  model("sonnet-new", "sonnet", "2025-07-01T00:00:00Z"),
  model("opus-1", "opus", "2025-03-01T00:00:00Z"),
  model("sonnet-dep", "sonnet", "2025-08-01T00:00:00Z", "deprecated"),
];
const TTS: TtsModel[] = [
  { id: "eleven_flash_v2_5", name: "Flash" },
  { id: "eleven_multilingual_v2", name: "Multilingual" },
];

function fakeCatalog(init: { claude?: ClaudeModel[] | "fail" | "throw"; tts?: TtsModel[] | "fail" } = {}) {
  const state = { claude: init.claude ?? BASE_MODELS, tts: init.tts ?? TTS };
  const claude = vi.fn(async (): Promise<Listing<ClaudeModel>> => {
    await Promise.resolve();
    if (state.claude === "throw") throw new Error("boom");
    if (state.claude === "fail") return { ok: false };
    return { ok: true, models: state.claude.map((m) => ({ ...m })) };
  });
  const tts = vi.fn(async (): Promise<Listing<TtsModel>> =>
    state.tts === "fail" ? { ok: false } : { ok: true, models: state.tts.map((m) => ({ ...m })) },
  );
  const catalog: ModelCatalog = { claude, tts };
  return { catalog, state, claude, tts };
}

function fakeStore(initial: { values?: Partial<SettingsValues>; prices?: PriceRow[] } = {}) {
  const data = {
    values: { ...(initial.values ?? {}) } as Partial<SettingsValues>,
    prices: [...(initial.prices ?? [])],
    failRead: false,
    failMissingWrite: false,
    readDelayMs: 0,
    onSaveValues: null as null | (() => void),
  };
  const store = {
    getStoredValues: vi.fn(async (_o: string) => {
      if (data.failRead) throw new Error("read failed");
      const snapshot = { ...data.values };
      if (data.readDelayMs > 0) await new Promise((r) => setTimeout(r, data.readDelayMs));
      else await Promise.resolve();
      return snapshot;
    }),
    saveValues: vi.fn(async (_o: string, patch: Partial<SettingsValues>) => {
      data.onSaveValues?.();
      data.values = { ...data.values, ...patch };
    }),
    saveMissingModels: vi.fn(
      async (_o: string, models: Partial<Pick<SettingsValues, "replyModel" | "reportModel" | "draftModel">>) => {
        if (data.failMissingWrite) throw new Error("write failed");
        await Promise.resolve();
        for (const [k, v] of Object.entries(models)) {
          const key = k as keyof SettingsValues;
          if (v !== undefined && data.values[key] === undefined) (data.values as Record<string, unknown>)[key] = v;
        }
      },
    ),
    listPrices: vi.fn(async (_o: string) => [...data.prices].sort((a, b) => a.model.localeCompare(b.model))),
    replacePrices: vi.fn(async (_o: string, rows: PriceRow[]) => {
      data.prices = [...rows];
    }),
  } satisfies SettingsStoreDeps;
  return { store, data };
}

const price = (m: string): PriceRow => ({ model: m, inputPerMtok: 1, outputPerMtok: 5, asOf: "2026-01-01" });

function setup(
  init: {
    values?: Partial<SettingsValues>;
    prices?: PriceRow[];
    claude?: ClaudeModel[] | "fail" | "throw";
    tts?: TtsModel[] | "fail";
  } = {},
) {
  const s = fakeStore(init);
  const c = fakeCatalog(init);
  const svc = createSettingsService({ store: s.store, catalog: c.catalog });
  return { svc, ...s, ...c };
}

describe("get", () => {
  it("picks and saves recommendations once, then remembers them", async () => {
    const { svc, data, store, state } = setup();
    const v = await svc.get(OWNER);
    expect(v).toEqual({ ...BUILT_IN, replyModel: "haiku-new", reportModel: "sonnet-new", draftModel: "sonnet-new" });
    expect(store.saveMissingModels).toHaveBeenCalledTimes(1);
    expect(store.saveMissingModels).toHaveBeenCalledWith(OWNER, {
      replyModel: "haiku-new",
      reportModel: "sonnet-new",
      draftModel: "sonnet-new",
    });
    expect(data.values).toEqual({ replyModel: "haiku-new", reportModel: "sonnet-new", draftModel: "sonnet-new" });

    state.claude = [...BASE_MODELS, model("haiku-newer", "haiku", "2026-01-01T00:00:00Z")];
    const v2 = await svc.get(OWNER);
    expect(v2.replyModel).toBe("haiku-new");
    expect(store.saveMissingModels).toHaveBeenCalledTimes(1);
  });

  it("does not call the catalog when all three jobs are stored", async () => {
    const { svc, claude } = setup({ values: { replyModel: "a", reportModel: "b", draftModel: "c" } });
    expect((await svc.get(OWNER)).replyModel).toBe("a");
    expect(claude).not.toHaveBeenCalled();
  });

  it("uses BUILT_IN and saves nothing when the list fails, then resolves later", async () => {
    const { svc, store, state, data } = setup({ claude: "fail" });
    const v = await svc.get(OWNER);
    expect(v.replyModel).toBe("claude-sonnet-4-6");
    expect(v.reportModel).toBe("claude-sonnet-4-6");
    expect(v.draftModel).toBe("claude-sonnet-4-6");
    expect(store.saveMissingModels).not.toHaveBeenCalled();
    state.claude = BASE_MODELS;
    const v2 = await svc.get(OWNER);
    expect(v2.replyModel).toBe("haiku-new");
    expect(data.values.reportModel).toBe("sonnet-new");
  });

  it("never replaces stored values; a partial set resolves and saves only the missing", async () => {
    const { svc, store } = setup({ values: { replyModel: "my-model", replyMaxTokens: 500 } });
    const v = await svc.get(OWNER);
    expect(v.replyModel).toBe("my-model");
    expect(v.replyMaxTokens).toBe(500);
    expect(v.reportModel).toBe("sonnet-new");
    expect(store.saveMissingModels).toHaveBeenCalledWith(OWNER, { reportModel: "sonnet-new", draftModel: "sonnet-new" });
  });

  it("uses BUILT_IN for a job with no eligible model and does not save it", async () => {
    const { svc, store } = setup({ claude: [model("sonnet-only", "sonnet", "2025-01-01T00:00:00Z")] });
    const v = await svc.get(OWNER);
    expect(v.replyModel).toBe(BUILT_IN.replyModel);
    expect(v.reportModel).toBe("sonnet-only");
    expect(store.saveMissingModels).toHaveBeenCalledWith(OWNER, { reportModel: "sonnet-only", draftModel: "sonnet-only" });
  });

  it("never throws when the catalog throws", async () => {
    const { svc, store } = setup({ claude: "throw" });
    await expect(svc.get(OWNER)).resolves.toEqual(BUILT_IN);
    expect(store.saveMissingModels).not.toHaveBeenCalled();
  });

  it("never throws when the store read throws", async () => {
    const { svc, data } = setup();
    data.failRead = true;
    await expect(svc.get(OWNER)).resolves.toEqual(BUILT_IN);
  });

  it("returns resolved values when the missing-models write fails, and does not stick", async () => {
    const { svc, data, store } = setup();
    data.failMissingWrite = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const v = await svc.get(OWNER);
    expect(v.replyModel).toBe("haiku-new");
    for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("haiku");
    spy.mockRestore();
    data.failMissingWrite = false;
    await svc.get(OWNER);
    expect(store.saveMissingModels).toHaveBeenCalledTimes(2);
    expect(data.values.replyModel).toBe("haiku-new");
  });

  it("two racing gets return the same persisted set even when their picks differ", async () => {
    const { svc, data, claude } = setup();
    let calls = 0;
    const newer = [...BASE_MODELS, model("haiku-newer", "haiku", "2026-01-01T00:00:00Z")];
    claude.mockImplementation(async () => {
      await Promise.resolve();
      calls += 1;
      return { ok: true, models: (calls === 1 ? BASE_MODELS : newer).map((m) => ({ ...m })) };
    });
    const [a, b] = await Promise.all([svc.get(OWNER), svc.get(OWNER)]);
    expect(claude).toHaveBeenCalledTimes(2);
    expect(a).toEqual(b);
    expect(a).toEqual({ ...BUILT_IN, ...data.values });
    expect(data.values.replyModel).toBe("haiku-new");
  });

  it("a get in flight during save does not make save or a later get return old values", async () => {
    const full = { replyModel: "haiku-old", reportModel: "sonnet-new", draftModel: "sonnet-new" };
    const { svc, data } = setup({ values: full });
    data.readDelayMs = 10;
    let inflight: Promise<SettingsValues> | null = null;
    data.onSaveValues = () => {
      data.onSaveValues = null;
      inflight = svc.get(OWNER);
    };
    const r = await svc.save(OWNER, { values: { replyModel: "haiku-new", replyMaxTokens: 400 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.page.values.replyModel).toBe("haiku-new");
    expect(r.page.values.replyMaxTokens).toBe(400);
    const after = await svc.get(OWNER);
    expect(after.replyModel).toBe("haiku-new");
    expect(after.replyMaxTokens).toBe(400);
    await inflight;
  });
});

describe("page", () => {
  it("assembles the page", async () => {
    const { svc } = setup({ prices: [price("sonnet-new"), price("opus-1")] });
    const p = await svc.page(OWNER);
    expect(p.values.replyModel).toBe("haiku-new");
    expect(p.recommended).toEqual({
      reply: { model: "haiku-new", tier: "fast" },
      report: { model: "sonnet-new", tier: "balanced" },
      draft: { model: "sonnet-new", tier: "balanced" },
    });
    expect(p.claudeModels).toContainEqual({ id: "sonnet-dep", displayName: "SONNET-DEP", tier: "balanced", deprecated: true });
    expect(p.claudeModels).toContainEqual({ id: "opus-1", displayName: "OPUS-1", tier: "most-capable", deprecated: false });
    expect(p.ttsModels).toEqual(TTS);
    expect(p.spokenFormats.map((f) => f.id)).toEqual([
      "mp3_22050_32",
      "mp3_24000_48",
      "mp3_44100_32",
      "mp3_44100_64",
      "mp3_44100_96",
      "mp3_44100_128",
      "mp3_44100_192",
    ]);
    expect(p.spokenFormats[0].label).toBe("MP3, 22.05 kHz, 32 kbps");
    expect(p.spokenFormats[5].label).toBe("MP3, 44.1 kHz, 128 kbps (recommended)");
    expect(p.spokenFormats[6].note).toBe("Needs the ElevenLabs Creator plan or above.");
    expect(p.spokenFormats[5].note).toBeNull();
    expect(p.micFormat).toEqual({ sampleRateHz: 16000, channels: 1, bitDepth: 16 });
    expect(p.prices.map((r) => r.model)).toEqual(["opus-1", "sonnet-new"]);
    expect(p.unpriced).toEqual(["haiku-new"]);
  });

  it("two racing pages show the same persisted values even when their picks differ", async () => {
    const { svc, data, claude } = setup();
    let calls = 0;
    const newer = [...BASE_MODELS, model("haiku-newer", "haiku", "2026-01-01T00:00:00Z")];
    claude.mockImplementation(async () => {
      await Promise.resolve();
      calls += 1;
      return { ok: true, models: (calls === 1 ? BASE_MODELS : newer).map((m) => ({ ...m })) };
    });
    const [a, b] = await Promise.all([svc.page(OWNER), svc.page(OWNER)]);
    expect(a.values).toEqual(b.values);
    expect(a.values).toEqual({ ...BUILT_IN, ...data.values });
    expect(data.values.replyModel).toBe("haiku-new");
  });

  it("shows null lists and recommendations when unavailable", async () => {
    const { svc } = setup({ claude: "fail", tts: "fail" });
    const p = await svc.page(OWNER);
    expect(p.claudeModels).toBeNull();
    expect(p.ttsModels).toBeNull();
    expect(p.recommended).toEqual({ reply: null, report: null, draft: null });
    expect(p.values).toEqual(BUILT_IN);
    expect(p.unpriced).toEqual(["claude-sonnet-4-6"]);
  });
});

describe("save", () => {
  const stored = { replyModel: "haiku-new", reportModel: "sonnet-new", draftModel: "sonnet-new" };

  it("accepts a valid change, stores it and returns the new page", async () => {
    const { svc, data } = setup({ values: stored });
    const r = await svc.save(OWNER, {
      values: { reportModel: "opus-1", ttsModel: "eleven_multilingual_v2", replyMaxTokens: 400, spokenFormat: "mp3_44100_192", sttModel: "scribe_v3" },
      prices: [price("opus-1")],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(data.values.reportModel).toBe("opus-1");
    expect(data.values.replyMaxTokens).toBe(400);
    expect(data.prices).toEqual([price("opus-1")]);
    expect(r.page.values.reportModel).toBe("opus-1");
    expect(r.page.unpriced).toEqual(["haiku-new", "sonnet-new"]);
  });

  const rejects: [string, unknown, string][] = [
    ["unknown Claude model", { values: { replyModel: `${MARK}-x` } }, "values.replyModel"],
    ["unknown TTS model", { values: { ttsModel: `${MARK}-tts` } }, "values.ttsModel"],
    ["pcm format", { values: { spokenFormat: "pcm_16000" } }, "values.spokenFormat"],
    ["tokens 49", { values: { replyMaxTokens: 49 } }, "values.replyMaxTokens"],
    ["tokens 1001", { values: { replyMaxTokens: 1001 } }, "values.replyMaxTokens"],
    ["stt with space", { values: { sttModel: `${MARK} x` } }, "values.sttModel"],
    ["unknown value key", { values: { [MARK]: 1 } }, "values"],
    ["price for unknown model", { prices: [price(`${MARK}-m`)] }, "prices.0.model"],
    ["51 price rows", { prices: Array.from({ length: 51 }, (_, i) => price(`m${i}`)) }, "prices"],
    ["unknown top-level key", { values: {}, [MARK]: 1 }, "body"],
    ["array body", [MARK], "body"],
    ["string body", MARK, "body"],
    ["null body", null, "body"],
  ];
  for (const [name, body, path] of rejects) {
    it(`rejects ${name} with a fixed message and saves nothing`, async () => {
      const { svc, store } = setup({ values: stored, prices: [price("sonnet-new")] });
      const r = await svc.save(OWNER, body);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.map((e) => e.path)).toContain(path);
      for (const e of r.errors) expect(typeof e.message).toBe("string");
      expect(JSON.stringify(r.errors)).not.toContain(MARK);
      expect(store.saveValues).not.toHaveBeenCalled();
      expect(store.replacePrices).not.toHaveBeenCalled();
    });
  }

  it("is all-or-nothing: a valid value change plus a bad price saves neither", async () => {
    const { svc, store } = setup({ values: stored });
    const r = await svc.save(OWNER, { values: { replyMaxTokens: 400 }, prices: [price("nope")] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([{ path: "prices.0.model", message: expect.any(String) }]);
    expect(store.saveValues).not.toHaveBeenCalled();
    expect(store.replacePrices).not.toHaveBeenCalled();
  });

  it("collects errors from values and prices together", async () => {
    const { svc } = setup({ values: stored });
    const r = await svc.save(OWNER, { values: { replyMaxTokens: 1 }, prices: [price("nope")] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.path).sort()).toEqual(["prices.0.model", "values.replyMaxTokens"]);
  });

  it("with the lists unavailable, unchanged values pass and changed ones are rejected", async () => {
    const { svc } = setup({ values: stored, claude: "fail", tts: "fail" });
    const ok = await svc.save(OWNER, { values: { replyModel: "haiku-new", ttsModel: BUILT_IN.ttsModel, replyMaxTokens: 350 } });
    expect(ok.ok).toBe(true);
    const bad = await svc.save(OWNER, { values: { replyModel: "sonnet-new", ttsModel: "eleven_multilingual_v2" } });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.map((e) => e.path).sort()).toEqual(["values.replyModel", "values.ttsModel"]);
    const listed = await setup({ values: stored }).svc.save(OWNER, { values: { replyModel: "nope" } });
    if (listed.ok) throw new Error("expected failure");
    expect(bad.errors[0].message).not.toBe(listed.errors[0].message);
  });

  it("allows the effective (unstored, built-in) value when the list is down", async () => {
    const { svc } = setup({ claude: "fail" });
    const r = await svc.save(OWNER, { values: { replyModel: "claude-sonnet-4-6" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.page.values.replyModel).toBe("claude-sonnet-4-6");
  });

  it("does not store the built-in fallback as a choice when the list is down", async () => {
    const { svc, data, store } = setup({ claude: "fail" });
    const r = await svc.save(OWNER, { values: { replyModel: "claude-sonnet-4-6" } });
    expect(r.ok).toBe(true);
    expect(data.values.replyModel).toBeUndefined();
    expect(store.saveValues).not.toHaveBeenCalled();
  });

  it("does not rewrite a stored model submitted unchanged when the list is down", async () => {
    const { svc, store } = setup({ values: stored, claude: "fail" });
    const r = await svc.save(OWNER, { values: { replyModel: "haiku-new" } });
    expect(r.ok).toBe(true);
    expect(store.saveValues).not.toHaveBeenCalled();
  });

  it("saves the built-in fallback when it is an explicit choice from an available list", async () => {
    const fallback = BUILT_IN.replyModel;
    const { svc, data } = setup({ values: stored, claude: [...BASE_MODELS, model(fallback, "sonnet", "2025-01-01T00:00:00Z")] });
    const r = await svc.save(OWNER, { values: { replyModel: fallback } });
    expect(r.ok).toBe(true);
    expect(data.values.replyModel).toBe(fallback);
  });

  it("still saves other keys in the same PUT when a no-op model key is dropped", async () => {
    const { svc, store, data } = setup({ claude: "fail" });
    const r = await svc.save(OWNER, { values: { replyModel: "claude-sonnet-4-6", replyMaxTokens: 350 } });
    expect(r.ok).toBe(true);
    expect(store.saveValues).toHaveBeenCalledWith(OWNER, { replyMaxTokens: 350 });
    expect(data.values.replyModel).toBeUndefined();
  });

  it("allows pricing a selected but unlisted model when the list is down", async () => {
    const { svc, data } = setup({ values: stored, claude: "fail" });
    const r = await svc.save(OWNER, { prices: [price("haiku-new")] });
    expect(r.ok).toBe(true);
    expect(data.prices).toEqual([price("haiku-new")]);
  });

  it("allows keeping an already priced model that is no longer listed", async () => {
    const { svc } = setup({ values: stored, prices: [price("gone-model")] });
    const r = await svc.save(OWNER, { prices: [{ ...price("gone-model"), inputPerMtok: 2 }] });
    expect(r.ok).toBe(true);
  });

  it("allows pricing a model selected in the same save", async () => {
    const { svc } = setup({ values: stored });
    const r = await svc.save(OWNER, { values: { draftModel: "opus-1" }, prices: [price("opus-1")] });
    expect(r.ok).toBe(true);
  });
});

describe("reset", () => {
  it("rewrites stored values to recommended and keeps prices", async () => {
    const { svc, data } = setup({
      values: { replyModel: "opus-1", reportModel: "opus-1", draftModel: "haiku-old", replyMaxTokens: 900, sttModel: "x", ttsModel: "eleven_multilingual_v2", spokenFormat: "mp3_22050_32" },
      prices: [price("opus-1")],
    });
    const p = await svc.reset(OWNER);
    const want = { ...BUILT_IN, replyModel: "haiku-new", reportModel: "sonnet-new", draftModel: "sonnet-new" };
    expect(p.values).toEqual(want);
    expect(data.values).toEqual(want);
    expect(data.prices).toEqual([price("opus-1")]);
    expect(p.prices).toEqual([price("opus-1")]);
  });

  const nonModel = { replyMaxTokens: 900, sttModel: "x", ttsModel: "eleven_multilingual_v2", spokenFormat: "mp3_22050_32" as const };
  const builtInNonModel = {
    replyMaxTokens: BUILT_IN.replyMaxTokens,
    sttModel: BUILT_IN.sttModel,
    ttsModel: BUILT_IN.ttsModel,
    spokenFormat: BUILT_IN.spokenFormat,
  };

  it("with the list down, leaves job models as they are and resets the rest", async () => {
    const { svc, data } = setup({ values: { replyModel: "opus-1", ...nonModel }, prices: [price("opus-1")], claude: "fail" });
    const p = await svc.reset(OWNER);
    expect(data.values).toEqual({ replyModel: "opus-1", ...builtInNonModel });
    expect(data.values.reportModel).toBeUndefined();
    expect(data.values.draftModel).toBeUndefined();
    expect(p.values).toEqual({ ...BUILT_IN, replyModel: "opus-1" });
    expect(p.recommended).toEqual({ reply: null, report: null, draft: null });
    expect(p.claudeModels).toBeNull();
    expect(data.prices).toEqual([price("opus-1")]);
  });

  it("with the list up but one job lacking a recommendation, resets only the others", async () => {
    const { svc, data } = setup({
      values: { replyModel: "opus-1", reportModel: "opus-1", draftModel: "opus-1", ...nonModel },
      prices: [price("opus-1")],
      claude: [model("sonnet-only", "sonnet", "2025-01-01T00:00:00Z"), model("opus-1", "opus", "2025-01-01T00:00:00Z")],
    });
    const p = await svc.reset(OWNER);
    expect(data.values).toEqual({ replyModel: "opus-1", reportModel: "sonnet-only", draftModel: "sonnet-only", ...builtInNonModel });
    expect(p.recommended.reply).toBeNull();
    expect(data.prices).toEqual([price("opus-1")]);
  });
});

describe("staticSettings", () => {
  it("merges over BUILT_IN", async () => {
    expect(await staticSettings().get(OWNER)).toEqual(BUILT_IN);
    expect(await staticSettings({ replyMaxTokens: 123 }).get(OWNER)).toEqual({ ...BUILT_IN, replyMaxTokens: 123 });
  });
});
