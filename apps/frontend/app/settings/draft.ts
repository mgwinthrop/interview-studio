// The Settings page's local draft: the values and price rows as typed, what changed against the
// last page from the server, the client-side checks, and how error paths map to fields.
import {
  MESSAGES,
  isRealDate,
  isValidSttId,
  parsePrice,
  parseReplyTokens,
  type FieldError,
  type PriceRow,
  type SettingsPage,
  type SettingsValues,
} from "../lib/settings";

export type ValueKey = keyof SettingsValues;
export const VALUE_KEYS: readonly ValueKey[] = [
  "replyModel",
  "reportModel",
  "draftModel",
  "replyMaxTokens",
  "sttModel",
  "ttsModel",
  "spokenFormat",
];

export type DraftValues = Record<ValueKey, string>;

export interface DraftPrice {
  model: string;
  input: string;
  output: string;
  asOf: string;
  /** Whether the server has a price row for this model (false = "not set"). */
  stored: boolean;
}

export interface Draft {
  values: DraftValues;
  prices: DraftPrice[];
}

/** Errors keyed by field: "values.<key>", "prices.<row>.<inputPerMtok|outputPerMtok|asOf|row>" or "prices". */
export interface Errors {
  fields: Record<string, string>;
  /** Fixed messages that belong to no field. */
  general: string[];
}

export const NO_ERRORS: Errors = { fields: {}, general: [] };
export const GENERAL_MESSAGE = "Some settings could not be saved. Reload the page and try again.";

export const VALUE_LABELS: Record<ValueKey, string> = {
  replyModel: "Conversation replies",
  reportModel: "Reports",
  draftModel: "Interviewer and persona drafts",
  replyMaxTokens: "Longest spoken reply (tokens)",
  sttModel: "Speech-to-text model",
  ttsModel: "Text-to-speech model",
  spokenFormat: "Spoken-reply format",
};

type PriceField = "inputPerMtok" | "outputPerMtok" | "asOf" | "row";

/** A plain decimal (never "3e-7"), so a stored price passes the client check unchanged. */
function plain(n: number): string {
  return n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
}

export function valuesFromPage(page: SettingsPage): DraftValues {
  const v = page.values;
  return { ...v, replyMaxTokens: String(v.replyMaxTokens) };
}

export function pricesFromPage(page: SettingsPage): DraftPrice[] {
  return [
    ...page.prices.map((p) => ({ model: p.model, input: plain(p.inputPerMtok), output: plain(p.outputPerMtok), asOf: p.asOf, stored: true })),
    ...page.unpriced.map((model) => ({ model, input: "", output: "", asOf: "", stored: false })),
  ];
}

export function draftFromPage(page: SettingsPage): Draft {
  return { values: valuesFromPage(page), prices: pricesFromPage(page) };
}

function sameValue(key: ValueKey, typed: string, page: SettingsPage): boolean {
  if (key === "replyMaxTokens") {
    const t = typed.trim();
    return /^\d+$/.test(t) && Number(t) === page.values.replyMaxTokens;
  }
  return typed === page.values[key];
}

export function changedValueKeys(draft: Draft, page: SettingsPage): ValueKey[] {
  return VALUE_KEYS.filter((k) => !sameValue(k, draft.values[k], page));
}

export function pricesChanged(draft: Draft, page: SettingsPage): boolean {
  const before = pricesFromPage(page);
  if (before.length !== draft.prices.length) return true;
  return draft.prices.some((p, i) => p.model !== before[i].model || p.input !== before[i].input || p.output !== before[i].output || p.asOf !== before[i].asOf);
}

/**
 * After a fresh page arrives without the owner asking to discard edits (a list retry): fields the
 * owner has not touched take the new value, edited fields keep what was typed.
 */
export function mergeDraft(draft: Draft, oldPage: SettingsPage, newPage: SettingsPage): Draft {
  const fresh = valuesFromPage(newPage);
  const values = { ...draft.values };
  for (const k of VALUE_KEYS) if (sameValue(k, draft.values[k], oldPage)) values[k] = fresh[k];
  return { values, prices: mergePrices(draft, oldPage, newPage) };
}

/**
 * Price rows after a fresh page arrives: untouched rows come from the new page; edited rows are
 * kept as typed, with a row added for any model the new page has that the draft lacks.
 */
export function mergePrices(draft: Draft, oldPage: SettingsPage, newPage: SettingsPage): DraftPrice[] {
  const fresh = pricesFromPage(newPage);
  if (!pricesChanged(draft, oldPage)) return fresh;
  const have = new Set(draft.prices.map((p) => p.model));
  return [...draft.prices, ...fresh.filter((p) => !have.has(p.model))];
}

export type Prepared =
  | { ok: true; body: { values?: Partial<SettingsValues>; prices?: PriceRow[] }; sentRows: number[] }
  | { ok: false; errors: Errors };

/** Checks the draft and builds the save body: only changed values, and the full price list if any price changed. */
export function prepareSave(draft: Draft, page: SettingsPage): Prepared {
  const fields: Record<string, string> = {};
  const changed = changedValueKeys(draft, page);
  const values: Partial<SettingsValues> = {};
  for (const k of changed) {
    const typed = draft.values[k];
    if (k === "replyMaxTokens") {
      const n = parseReplyTokens(typed);
      if (n === null) fields["values.replyMaxTokens"] = MESSAGES.tokens;
      else values.replyMaxTokens = n;
    } else if (k === "sttModel") {
      if (!isValidSttId(typed)) fields["values.sttModel"] = MESSAGES.sttId;
      else values.sttModel = typed;
    } else {
      values[k] = typed;
    }
  }

  let prices: PriceRow[] | undefined;
  const sentRows: number[] = [];
  if (pricesChanged(draft, page)) {
    const list: PriceRow[] = [];
    draft.prices.forEach((p, i) => {
      const filled = [p.input, p.output, p.asOf].map((s) => s.trim() !== "");
      if (filled.every((f) => !f)) return; // A cleared row is left out, so it is removed.
      if (!filled.every((f) => f)) {
        fields[`prices.${i}.row`] = MESSAGES.partialRow;
        return;
      }
      const input = parsePrice(p.input);
      const output = parsePrice(p.output);
      const asOf = p.asOf.trim();
      if (input === null) fields[`prices.${i}.inputPerMtok`] = MESSAGES.price;
      if (output === null) fields[`prices.${i}.outputPerMtok`] = MESSAGES.price;
      if (!isRealDate(asOf)) fields[`prices.${i}.asOf`] = MESSAGES.date;
      if (input === null || output === null || !isRealDate(asOf)) return;
      list.push({ model: p.model, inputPerMtok: input, outputPerMtok: output, asOf });
      sentRows.push(i);
    });
    prices = list;
  }

  if (Object.keys(fields).length > 0) return { ok: false, errors: { fields, general: [] } };
  const body: { values?: Partial<SettingsValues>; prices?: PriceRow[] } = {};
  if (Object.keys(values).length > 0) body.values = values;
  if (prices) body.prices = prices;
  return { ok: true, body, sentRows };
}

/** Maps the server's 422 paths to fields. `sentRows[i]` is the draft row sent as prices[i]. */
export function errorsFromServer(errors: FieldError[], sentRows: number[]): Errors {
  const fields: Record<string, string> = {};
  const general = new Set<string>();
  for (const e of errors) {
    const parts = e.path.split(".");
    if (parts[0] === "values" && parts.length === 2 && (VALUE_KEYS as readonly string[]).includes(parts[1])) {
      fields[e.path] ??= e.message;
      continue;
    }
    if (parts[0] === "prices" && parts.length === 1) {
      fields.prices ??= e.message;
      continue;
    }
    if (parts[0] === "prices" && /^\d+$/.test(parts[1] ?? "") && parts.length <= 3) {
      const row = sentRows[Number(parts[1])];
      if (row !== undefined) {
        const f = parts[2];
        const field: PriceField = f === "inputPerMtok" || f === "outputPerMtok" || f === "asOf" ? f : "row";
        fields[`prices.${row}.${field}`] ??= e.message;
        continue;
      }
    }
    general.add(GENERAL_MESSAGE);
  }
  return { fields, general: Array.from(general) };
}

// ---- Field ids and labels for the error summary ----

export function valueId(key: ValueKey): string {
  return `settings-${key}`;
}

export function priceId(row: number, field: "inputPerMtok" | "outputPerMtok" | "asOf"): string {
  return `price-${row}-${field}`;
}

export const PRICES_REGION_ID = "prices-table";

/** The summary text and the id of the field to move to, for one error key. */
export function describeError(key: string, draft: Draft): { label: string; target: string } {
  const parts = key.split(".");
  if (parts[0] === "values") {
    const k = parts[1] as ValueKey;
    return { label: VALUE_LABELS[k], target: valueId(k) };
  }
  if (parts.length === 3) {
    const row = Number(parts[1]);
    const model = draft.prices[row]?.model ?? "";
    if (parts[2] === "inputPerMtok") return { label: `Input price for ${model}`, target: priceId(row, "inputPerMtok") };
    if (parts[2] === "outputPerMtok") return { label: `Output price for ${model}`, target: priceId(row, "outputPerMtok") };
    if (parts[2] === "asOf") return { label: `As of date for ${model}`, target: priceId(row, "asOf") };
    return { label: `Price for ${model}`, target: priceId(row, "inputPerMtok") };
  }
  return { label: "Prices", target: PRICES_REGION_ID };
}

/** Error keys in page order, for the summary. */
export function orderedErrorKeys(errors: Errors, draft: Draft): string[] {
  const order: string[] = [...VALUE_KEYS.map((k) => `values.${k}`), "prices"];
  draft.prices.forEach((_, i) => {
    for (const f of ["row", "inputPerMtok", "outputPerMtok", "asOf"]) order.push(`prices.${i}.${f}`);
  });
  return order.filter((k) => errors.fields[k] !== undefined);
}
