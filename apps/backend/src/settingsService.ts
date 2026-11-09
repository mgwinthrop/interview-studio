import type { FieldError } from "./interviewer/schema.js";
import { recommend, type ClaudeModel, type Job, type ListFailure, type Listing, type ModelCatalog, type Tier, type TtsModel } from "./modelCatalog.js";
import {
  BUILT_IN,
  SPOKEN_FORMATS,
  parsePriceRows,
  parseValuesPatch,
  type PriceRow,
  type SettingsValues,
  type SpokenFormat,
} from "./settings.js";
import type * as settingsStore from "./settingsStore.js";

// The logic between the settings store, the live model lists and the routes/session code.
// Never logs values, model ids or provider text. Error messages are fixed strings.

export interface SettingsSource {
  get(ownerId: string): Promise<SettingsValues>;
}
export interface ClaudeModelOption {
  id: string;
  displayName: string;
  tier: Tier | null;
  deprecated: boolean;
}
export interface Recommendation {
  model: string;
  tier: Tier | null;
}
export interface SettingsPage {
  values: SettingsValues;
  recommended: { reply: Recommendation | null; report: Recommendation | null; draft: Recommendation | null };
  claudeModels: ClaudeModelOption[] | null; // null = list unavailable
  ttsModels: { id: string; name: string }[] | null;
  claudeListIssue: ListFailure | null; // why claudeModels is null; null when it loaded
  ttsListIssue: ListFailure | null;
  spokenFormats: { id: SpokenFormat; label: string; note: string | null }[];
  micFormat: { sampleRateHz: 16000; channels: 1; bitDepth: 16 };
  prices: PriceRow[];
  unpriced: string[]; // selected Claude models with no price row
}
export type SaveResult = { ok: true; page: SettingsPage } | { ok: false; errors: FieldError[] };
export interface SettingsService extends SettingsSource {
  page(ownerId: string): Promise<SettingsPage>;
  save(ownerId: string, body: unknown): Promise<SaveResult>;
  reset(ownerId: string): Promise<SettingsPage>;
}

export type SettingsStoreDeps = Pick<
  typeof settingsStore,
  "getStoredValues" | "saveValues" | "saveMissingModels" | "listPrices" | "replacePrices"
>;

type ModelKey = "replyModel" | "reportModel" | "draftModel";
const JOBS: readonly { job: Job; key: ModelKey }[] = [
  { job: "reply", key: "replyModel" },
  { job: "report", key: "reportModel" },
  { job: "draft", key: "draftModel" },
];

const MSG = {
  body: "Must be an object with only values and prices.",
  notListed: "That model is not available.",
  listDown: "The model list could not be loaded, so this value cannot be changed.",
  priceModel: "Prices can only be set for listed, already priced or selected models.",
} as const;

const RECOMMENDED_FORMAT: SpokenFormat = "mp3_44100_128";
const CREATOR_NOTE = "Needs the ElevenLabs Creator plan or above.";

function formatLabel(id: SpokenFormat): string {
  const [, rate, kbps] = id.split("_");
  const label = `MP3, ${Number(rate) / 1000} kHz, ${kbps} kbps`;
  return id === RECOMMENDED_FORMAT ? `${label} (recommended)` : label;
}

const SPOKEN_FORMAT_OPTIONS = SPOKEN_FORMATS.map((id) => ({
  id,
  label: formatLabel(id),
  note: id === "mp3_44100_192" ? CREATOR_NOTE : null,
}));

async function safeListing<T>(load: () => Promise<Listing<T>>): Promise<Listing<T>> {
  try {
    const l = await load();
    return l && l.ok ? l : { ok: false, reason: l && l.reason ? l.reason : "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

function idSet(models: readonly { id: string }[]): Set<string> {
  return new Set(models.map((m) => m.id));
}

export function createSettingsService(deps: { store: SettingsStoreDeps; catalog: ModelCatalog }): SettingsService {
  const { store, catalog } = deps;

  const claudeList = () => safeListing<ClaudeModel>(() => catalog.claude());
  const ttsList = () => safeListing<TtsModel>(() => catalog.tts());

  /** Effective values: stored over BUILT_IN, missing jobs resolved and remembered. Never throws. */
  async function resolveOnce(ownerId: string): Promise<SettingsValues> {
    let stored: Partial<SettingsValues>;
    try {
      stored = await store.getStoredValues(ownerId);
    } catch {
      return { ...BUILT_IN };
    }
    const values: SettingsValues = { ...BUILT_IN, ...stored };
    const missing = JOBS.filter(({ key }) => stored[key] === undefined);
    if (missing.length === 0) return values;

    const list = await claudeList();
    if (!list.ok) return values;
    const toSave: Partial<Pick<SettingsValues, ModelKey>> = {};
    for (const { job, key } of missing) {
      const rec = recommend(job, list.models);
      if (rec) {
        values[key] = rec.id;
        toSave[key] = rec.id;
      }
    }
    if (Object.keys(toSave).length > 0) {
      try {
        await store.saveMissingModels(ownerId, toSave);
      } catch {
        // Not remembered this time; a later call resolves and saves again.
        return values;
      }
      // A racing caller may have stored its own pick first (the write only fills absent
      // fields): return what is actually stored so every caller sees the same set.
      try {
        return { ...BUILT_IN, ...(await store.getStoredValues(ownerId)) };
      } catch {
        return values;
      }
    }
    return values;
  }

  function resolve(ownerId: string): Promise<SettingsValues> {
    return resolveOnce(ownerId).catch(() => ({ ...BUILT_IN }));
  }

  async function buildPage(ownerId: string, values: SettingsValues): Promise<SettingsPage> {
    const [claude, tts, prices] = await Promise.all([claudeList(), ttsList(), store.listPrices(ownerId)]);
    const rec = (job: Job): Recommendation | null => {
      if (!claude.ok) return null;
      const m = recommend(job, claude.models);
      return m ? { model: m.id, tier: m.tier } : null;
    };
    const sortedPrices = [...prices].sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
    const priced = new Set(sortedPrices.map((p) => p.model));
    const selected = new Set(JOBS.map(({ key }) => values[key]));
    return {
      values,
      recommended: { reply: rec("reply"), report: rec("report"), draft: rec("draft") },
      claudeModels: claude.ok
        ? claude.models.map((m) => ({
            id: m.id,
            displayName: m.displayName,
            tier: m.tier,
            deprecated: m.lifecycle === "deprecated",
          }))
        : null,
      ttsModels: tts.ok ? tts.models.map((m) => ({ id: m.id, name: m.name })) : null,
      claudeListIssue: claude.ok ? null : claude.reason,
      ttsListIssue: tts.ok ? null : tts.reason,
      spokenFormats: SPOKEN_FORMAT_OPTIONS.map((f) => ({ ...f })),
      micFormat: { sampleRateHz: 16000, channels: 1, bitDepth: 16 },
      prices: sortedPrices,
      unpriced: [...selected].filter((m) => !priced.has(m)).sort(),
    };
  }

  async function page(ownerId: string): Promise<SettingsPage> {
    return buildPage(ownerId, await resolve(ownerId));
  }

  async function save(ownerId: string, body: unknown): Promise<SaveResult> {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return { ok: false, errors: [{ path: "body", message: MSG.body }] };
    }
    const keys = Object.keys(body);
    if (keys.some((k) => k !== "values" && k !== "prices")) {
      return { ok: false, errors: [{ path: "body", message: MSG.body }] };
    }
    const raw = body as { values?: unknown; prices?: unknown };
    const errors: FieldError[] = [];

    let patch: Partial<SettingsValues> = {};
    if ("values" in raw) {
      const parsed = parseValuesPatch(raw.values);
      if (parsed.ok) patch = parsed.value;
      else errors.push(...parsed.errors.map((e) => ({ path: e.path ? `values.${e.path}` : "values", message: e.message })));
    }
    let rows: PriceRow[] | null = null;
    if ("prices" in raw) {
      const parsed = parsePriceRows(raw.prices);
      if (parsed.ok) rows = parsed.value;
      else errors.push(...parsed.errors);
    }

    // A save already rejected by parsing needs no lookups when no membership checks apply,
    // so it never triggers a remember-defaults write.
    const hasMembershipChecks =
      rows !== null || JOBS.some(({ key }) => patch[key] !== undefined) || patch.ttsModel !== undefined;
    if (errors.length > 0 && !hasMembershipChecks) return { ok: false, errors };

    const effective = await resolve(ownerId);
    const needClaude = JOBS.some(({ key }) => patch[key] !== undefined && patch[key] !== effective[key]) || rows !== null;
    const needTts = patch.ttsModel !== undefined && patch.ttsModel !== effective.ttsModel;
    const [claude, tts] = await Promise.all([
      needClaude ? claudeList() : Promise.resolve<Listing<ClaudeModel>>({ ok: false, reason: "unavailable" }),
      needTts ? ttsList() : Promise.resolve<Listing<TtsModel>>({ ok: false, reason: "unavailable" }),
    ]);
    const claudeIds = claude.ok ? idSet(claude.models) : null;
    const ttsIds = tts.ok ? idSet(tts.models) : null;

    const checkMember = (key: keyof SettingsValues, ids: Set<string> | null) => {
      const v = patch[key];
      if (v === undefined || v === effective[key]) return;
      if (ids === null) errors.push({ path: `values.${key}`, message: MSG.listDown });
      else if (!ids.has(v as string)) errors.push({ path: `values.${key}`, message: MSG.notListed });
    };
    for (const { key } of JOBS) checkMember(key, claudeIds);
    checkMember("ttsModel", ttsIds);

    if (rows !== null) {
      const already = new Set((await store.listPrices(ownerId)).map((p) => p.model));
      const after = { ...effective, ...patch };
      const selected = new Set(JOBS.map(({ key }) => after[key]));
      rows.forEach((row, i) => {
        const ok = claudeIds?.has(row.model) || already.has(row.model) || selected.has(row.model);
        if (!ok) errors.push({ path: `prices.${i}.model`, message: MSG.priceModel });
      });
    }

    if (errors.length > 0) return { ok: false, errors };

    // A model key that changes nothing is not written: one equal to its stored value is a
    // no-op, and one with nothing stored that equals the effective value (the per-call
    // fallback, list down) must not become an explicit choice.
    let storedNow: Partial<SettingsValues> = {};
    try {
      storedNow = await store.getStoredValues(ownerId);
    } catch {
      // Unreadable: treat as nothing stored; the write below decides.
    }
    for (const key of [...JOBS.map((j) => j.key), "ttsModel" as const]) {
      if (patch[key] !== undefined && patch[key] === effective[key] && (storedNow[key] === undefined || storedNow[key] === patch[key])) {
        delete patch[key];
      }
    }

    // saveValues and replacePrices are separate transactions: if the second fails after the
    // first, the values stay saved and this call throws (routes map throws to a fixed 500).
    if (Object.keys(patch).length > 0) await store.saveValues(ownerId, patch);
    if (rows !== null) await store.replacePrices(ownerId, rows);
    return { ok: true, page: await page(ownerId) };
  }

  async function reset(ownerId: string): Promise<SettingsPage> {
    // Job models are only reset to a live recommendation; a job without one keeps its field
    // as it is (stored or not), so the per-call fallback is never saved as a choice.
    const list = await claudeList();
    const next: Partial<SettingsValues> = {
      replyMaxTokens: BUILT_IN.replyMaxTokens,
      sttModel: BUILT_IN.sttModel,
      ttsModel: BUILT_IN.ttsModel,
      spokenFormat: BUILT_IN.spokenFormat,
    };
    if (list.ok) {
      for (const { job, key } of JOBS) {
        const rec = recommend(job, list.models);
        if (rec) next[key] = rec.id;
      }
    }
    await store.saveValues(ownerId, next);
    return page(ownerId);
  }

  return { get: resolve, page, save, reset };
}

/** A fixed source: BUILT_IN merged with `values`. For tests and defaults. */
export function staticSettings(values: Partial<SettingsValues> = {}): SettingsSource {
  return { get: async () => ({ ...BUILT_IN, ...values }) };
}
