import { z } from "zod";
import type { FieldError } from "./interviewer/schema";

// Settings types, defaults and validation. Pure: no database, no logging. Errors carry fixed
// text and a field path only, never the submitted value.

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

export interface SettingsValues {
  replyModel: string;
  reportModel: string;
  draftModel: string;
  replyMaxTokens: number;
  sttModel: string;
  ttsModel: string;
  spokenFormat: SpokenFormat;
}

/** What the app uses when nothing is stored (and the live model list cannot be loaded). */
export const BUILT_IN: SettingsValues = {
  replyModel: "claude-sonnet-4-6",
  reportModel: "claude-sonnet-4-6",
  draftModel: "claude-sonnet-4-6",
  replyMaxTokens: 300,
  sttModel: "scribe_v2",
  ttsModel: "eleven_flash_v2_5",
  spokenFormat: "mp3_44100_128",
};

export interface PriceRow {
  model: string;
  inputPerMtok: number;
  outputPerMtok: number;
  asOf: string;
}

export const SETTINGS_LIMITS = {
  replyMaxTokensMin: 50,
  replyMaxTokensMax: 1000,
  modelIdMax: 100,
  sttIdMax: 60,
  priceMax: 100000,
  maxPriceRows: 50,
} as const;

const MSG = {
  type: "Must be a valid value of the right type.",
  object: "Must be an object.",
  array: "Must be a list.",
  unknownKey: "Unknown setting.",
  tokens: "Must be a whole number from 50 to 1000.",
  modelId: "Must be 1 to 100 letters, digits, dots, underscores, colons or hyphens.",
  sttId: "Must be 1 to 60 letters, digits, dots, underscores or hyphens.",
  format: "Must be one of the listed spoken-reply formats.",
  price: "Must be a number from 0 to 100000.",
  date: "Must be a real date written YYYY-MM-DD.",
  duplicate: "Each model may appear only once.",
  tooMany: "Too many prices (at most 50).",
} as const;

const MODEL_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const STT_ID = /^[A-Za-z0-9._-]{1,60}$/;

const modelId = z.string({ error: MSG.type }).regex(MODEL_ID, MSG.modelId);

const valueFields = {
  replyModel: modelId,
  reportModel: modelId,
  draftModel: modelId,
  replyMaxTokens: z
    .number({ error: MSG.tokens })
    .int(MSG.tokens)
    .min(SETTINGS_LIMITS.replyMaxTokensMin, MSG.tokens)
    .max(SETTINGS_LIMITS.replyMaxTokensMax, MSG.tokens),
  sttModel: z.string({ error: MSG.type }).regex(STT_ID, MSG.sttId),
  ttsModel: modelId,
  spokenFormat: z.enum(SPOKEN_FORMATS, { error: MSG.format }),
} as const;

const valuesPatchSchema = z.object(valueFields).partial().strict();

/** One field validator per key, for re-checking stored values one at a time. */
export const VALUE_FIELD_SCHEMAS = valueFields;

function toFieldErrors(error: z.ZodError, prefix: string[] = []): FieldError[] {
  const out: FieldError[] = [];
  for (const issue of error.issues) {
    const path = [...prefix, ...issue.path].join(".");
    if (issue.code === "unrecognized_keys") {
      // Report once at the object's own path; never name or echo the submitted keys.
      out.push({ path, message: MSG.unknownKey });
    } else if (issue.code === "invalid_type" && issue.path.length === 0) {
      out.push({ path, message: MSG.object });
    } else {
      out.push({ path, message: issue.message });
    }
  }
  return out;
}

type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

/** Validates a settings patch: any subset of the settings fields; unknown keys are refused. */
export function parseValuesPatch(raw: unknown): Result<Partial<SettingsValues>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [{ path: "", message: MSG.object }] };
  }
  const parsed = valuesPatchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  return { ok: true, value: parsed.data as Partial<SettingsValues> };
}

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const priceNumber = z
  .number({ error: MSG.price })
  .min(0, MSG.price)
  .max(SETTINGS_LIMITS.priceMax, MSG.price);

const priceRowSchema = z
  .object({
    model: modelId,
    inputPerMtok: priceNumber,
    outputPerMtok: priceNumber,
    asOf: z
      .string({ error: MSG.date })
      .refine(isRealDate, MSG.date),
  })
  .strict();

/** Validates the owner's full price list (rows not listed are removed by the store). */
export function parsePriceRows(raw: unknown): Result<PriceRow[]> {
  if (!Array.isArray(raw)) return { ok: false, errors: [{ path: "prices", message: MSG.array }] };
  if (raw.length > SETTINGS_LIMITS.maxPriceRows) {
    return { ok: false, errors: [{ path: "prices", message: MSG.tooMany }] };
  }
  const errors: FieldError[] = [];
  const rows: PriceRow[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const parsed = priceRowSchema.safeParse(item);
    if (!parsed.success) {
      errors.push(...toFieldErrors(parsed.error, ["prices", String(i)]));
      return;
    }
    if (seen.has(parsed.data.model)) {
      errors.push({ path: `prices.${i}.model`, message: MSG.duplicate });
      return;
    }
    seen.add(parsed.data.model);
    rows.push(parsed.data);
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: rows };
}
