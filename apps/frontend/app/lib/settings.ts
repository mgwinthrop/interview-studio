// Settings: the API helpers and the client-side rules of the Settings page.
// Types mirror apps/backend/src/settings.ts and apps/backend/src/settingsService.ts (not imported).
// Every response is validated defensively; anything unexpected is "error". Nothing here logs.
// Messages shown to the user are fixed client text: a server message is shown only when it is one
// of the known fixed messages below; any other becomes INVALID_FALLBACK.
import { apiUrl } from "./config";

export type Tier = "fast" | "balanced" | "most-capable";

/** Mirrors SPOKEN_FORMATS in apps/backend/src/settings.ts. */
export const SPOKEN_FORMATS = [
  "mp3_22050_32",
  "mp3_24000_48",
  "mp3_44100_32",
  "mp3_44100_64",
  "mp3_44100_96",
  "mp3_44100_128",
  "mp3_44100_192",
] as const;
export type SpokenFormat = (typeof SPOKEN_FORMATS)[number];
export const RECOMMENDED_FORMAT: SpokenFormat = "mp3_44100_128";

export interface SettingsValues {
  replyModel: string;
  reportModel: string;
  draftModel: string;
  replyMaxTokens: number;
  sttModel: string;
  ttsModel: string;
  /** A string, not SpokenFormat: a stored value the client does not know is still shown. */
  spokenFormat: string;
}

export interface PriceRow {
  model: string;
  inputPerMtok: number;
  outputPerMtok: number;
  asOf: string;
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

export type Job = "reply" | "report" | "draft";

export interface SettingsPage {
  values: SettingsValues;
  recommended: Record<Job, Recommendation | null>;
  /** null = the live list could not be loaded. */
  claudeModels: ClaudeModelOption[] | null;
  ttsModels: { id: string; name: string }[] | null;
  /** Only the formats this client knows, in the server's order. */
  spokenFormats: SpokenFormat[];
  prices: PriceRow[];
  /** Selected Claude models with no price row. */
  unpriced: string[];
}

export interface FieldError {
  path: string;
  message: string;
}

export type SettingsResult<T> = { kind: "ok"; value: T } | { kind: "network" } | { kind: "error" };
export type SaveResult = SettingsResult<SettingsPage> | { kind: "invalid"; errors: FieldError[] };

/** Mirrors SETTINGS_LIMITS in apps/backend/src/settings.ts. */
export const SETTINGS_LIMITS = {
  replyMaxTokensMin: 50,
  replyMaxTokensMax: 1000,
  replyMaxTokensRecommended: 300,
  sttIdMax: 60,
  priceMax: 100000,
  maxPriceRows: 50,
} as const;

export const RECOMMENDED_STT = "scribe_v2";
export const RECOMMENDED_TTS = "eleven_flash_v2_5";

export const NETWORK_MESSAGE = "Could not reach the server. Check your connection, then try again.";
export const INVALID_FALLBACK = "This value is not valid.";

/** Fixed client messages, the same text the server uses for the same rule. */
export const MESSAGES = {
  tokens: "Must be a whole number from 50 to 1000.",
  sttId: "Must be 1 to 60 letters, digits, dots, underscores or hyphens.",
  price: "Must be a number from 0 to 100000.",
  date: "Must be a real date written YYYY-MM-DD.",
  partialRow: "Enter both prices and the date, or clear the row.",
} as const;

// The fixed messages the settings routes send in a 422 (apps/backend/src/settings.ts and
// settingsService.ts). Anything else is replaced by INVALID_FALLBACK.
const KNOWN_MESSAGES = new Set<string>([
  "Must be a valid value of the right type.",
  "Must be an object.",
  "Must be a list.",
  "Unknown setting.",
  MESSAGES.tokens,
  "Must be 1 to 100 letters, digits, dots, underscores, colons or hyphens.",
  MESSAGES.sttId,
  "Must be one of the listed spoken-reply formats.",
  MESSAGES.price,
  MESSAGES.date,
  "Each model may appear only once.",
  "Too many prices (at most 50).",
  "Must be an object with only values and prices.",
  "That model is not available.",
  "The model list could not be loaded, so this value cannot be changed.",
  "Prices can only be set for listed, already priced or selected models.",
]);

const TIERS: readonly Tier[] = ["fast", "balanced", "most-capable"];
const MAX_LIST = 1000;
const MAX_ERRORS = 100;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isText(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 200;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function readTier(v: unknown): Tier | null | undefined {
  if (v === null) return null;
  return TIERS.includes(v as Tier) ? (v as Tier) : undefined;
}

function readValues(v: unknown): SettingsValues | null {
  if (!isRecord(v)) return null;
  const { replyModel, reportModel, draftModel, replyMaxTokens, sttModel, ttsModel, spokenFormat } = v;
  if (!isText(replyModel) || !isText(reportModel) || !isText(draftModel)) return null;
  if (!isFiniteNumber(replyMaxTokens) || !isText(sttModel) || !isText(ttsModel) || !isText(spokenFormat)) return null;
  return { replyModel, reportModel, draftModel, replyMaxTokens, sttModel, ttsModel, spokenFormat };
}

function readRecommendation(v: unknown): Recommendation | null | undefined {
  if (v === null) return null;
  if (!isRecord(v) || !isText(v.model)) return undefined;
  const tier = readTier(v.tier);
  return tier === undefined ? undefined : { model: v.model, tier };
}

function readList<T>(v: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > MAX_LIST) return null;
  const out: T[] = [];
  for (const item of v) {
    const r = read(item);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}

function readClaudeModel(v: unknown): ClaudeModelOption | null {
  if (!isRecord(v) || !isText(v.id) || !isText(v.displayName) || typeof v.deprecated !== "boolean") return null;
  const tier = readTier(v.tier);
  return tier === undefined ? null : { id: v.id, displayName: v.displayName, tier, deprecated: v.deprecated };
}

function readTtsModel(v: unknown): { id: string; name: string } | null {
  return isRecord(v) && isText(v.id) && isText(v.name) ? { id: v.id, name: v.name } : null;
}

function readPrice(v: unknown): PriceRow | null {
  if (!isRecord(v) || !isText(v.model) || !isText(v.asOf)) return null;
  if (!isFiniteNumber(v.inputPerMtok) || !isFiniteNumber(v.outputPerMtok)) return null;
  return { model: v.model, inputPerMtok: v.inputPerMtok, outputPerMtok: v.outputPerMtok, asOf: v.asOf };
}

/** Validates a SettingsPage response. Returns null for anything unexpected. */
export function parseSettingsPage(body: unknown): SettingsPage | null {
  if (!isRecord(body)) return null;
  const values = readValues(body.values);
  if (!values || !isRecord(body.recommended) || !isRecord(body.micFormat)) return null;
  const rec = body.recommended;
  const reply = readRecommendation(rec.reply);
  const report = readRecommendation(rec.report);
  const draft = readRecommendation(rec.draft);
  if (reply === undefined || report === undefined || draft === undefined) return null;
  const claudeModels = body.claudeModels === null ? null : readList(body.claudeModels, readClaudeModel);
  if (body.claudeModels !== null && claudeModels === null) return null;
  const ttsModels = body.ttsModels === null ? null : readList(body.ttsModels, readTtsModel);
  if (body.ttsModels !== null && ttsModels === null) return null;
  const formats = readList(body.spokenFormats, (f) => (isRecord(f) && isText(f.id) ? f.id : null));
  const prices = readList(body.prices, readPrice);
  const unpriced = readList(body.unpriced, (m) => (isText(m) ? m : null));
  if (!formats || !prices || !unpriced) return null;
  const spokenFormats = formats.filter((f): f is SpokenFormat => (SPOKEN_FORMATS as readonly string[]).includes(f));
  return { values, recommended: { reply, report, draft }, claudeModels, ttsModels, spokenFormats, prices, unpriced };
}

/** The 422 errors with every message replaced by a known fixed message or the fallback. */
function readErrors(body: unknown): FieldError[] | null {
  if (!isRecord(body) || !Array.isArray(body.errors)) return null;
  const errors: FieldError[] = [];
  for (const e of body.errors.slice(0, MAX_ERRORS)) {
    if (!isRecord(e) || typeof e.path !== "string" || e.path.length > 200) continue;
    const message = typeof e.message === "string" && KNOWN_MESSAGES.has(e.message) ? e.message : INVALID_FALLBACK;
    errors.push({ path: e.path, message });
  }
  return errors.length > 0 ? errors : null;
}

async function request(method: "GET" | "PUT" | "POST", path: string, body?: unknown): Promise<SaveResult> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { kind: "network" };
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    return { kind: "error" };
  }
  if (res.status === 200) {
    const page = parseSettingsPage(parsed);
    return page ? { kind: "ok", value: page } : { kind: "error" };
  }
  if (res.status === 422) {
    const errors = readErrors(parsed);
    return errors ? { kind: "invalid", errors } : { kind: "error" };
  }
  return { kind: "error" };
}

/** Loads the settings page data. */
export async function fetchSettings(): Promise<SettingsResult<SettingsPage>> {
  const r = await request("GET", "/api/settings");
  return r.kind === "invalid" ? { kind: "error" } : r;
}

/** Saves changed values and/or the full price list (rows not listed are removed). */
export function saveSettings(body: { values?: Partial<SettingsValues>; prices?: PriceRow[] }): Promise<SaveResult> {
  return request("PUT", "/api/settings", body);
}

/** Resets models, reply length, speech and format to the recommended ones. Prices are kept. */
export async function resetSettings(): Promise<SettingsResult<SettingsPage>> {
  const r = await request("POST", "/api/settings/reset");
  return r.kind === "invalid" ? { kind: "error" } : r;
}

// ---- Display helpers ----

export function tierLabel(tier: Tier | null): string | null {
  if (tier === "fast") return "Fast";
  if (tier === "balanced") return "Balanced";
  if (tier === "most-capable") return "Most capable";
  return null;
}

/** "MP3, 44.1 kHz, 128 kbps", built from the id so no server text is shown. */
export function formatLabel(id: SpokenFormat): string {
  const [, rate, kbps] = id.split("_");
  return `MP3, ${Number(rate) / 1000} kHz, ${kbps} kbps`;
}

export const CREATOR_PLAN_FORMAT: SpokenFormat = "mp3_44100_192";

// ---- Client-side rules (the server checks everything again) ----

const STT_ID = /^[A-Za-z0-9._-]{1,60}$/;
const DECIMAL = /^\d+(\.\d+)?$/;

export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** The typed reply length as a number, or null when it breaks the rule. */
export function parseReplyTokens(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= SETTINGS_LIMITS.replyMaxTokensMin && n <= SETTINGS_LIMITS.replyMaxTokensMax ? n : null;
}

export function isValidSttId(text: string): boolean {
  return STT_ID.test(text);
}

/** A typed price as a number, or null when it breaks the rule. */
export function parsePrice(text: string): number | null {
  const t = text.trim();
  if (!DECIMAL.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= SETTINGS_LIMITS.priceMax ? n : null;
}
