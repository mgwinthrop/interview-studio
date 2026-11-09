// Usage numbers from the backend (counts and estimated cost only, never content).
// Each helper validates the response defensively; anything unexpected is "error".
import { apiUrl } from "./config";

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** null when the backend has no price for the calls (no price is set for the model). */
  estimatedCostUsd: number | null;
}

export interface FeatureUsage extends UsageTotals {
  feature: string;
}

export interface TrendDay {
  /** UTC calendar day, "YYYY-MM-DD". */
  date: string;
  /** Per feature id; empty for a day with no calls. */
  byFeature: Record<string, UsageTotals>;
}

export interface UsageTrend {
  days: TrendDay[];
  byFeature: FeatureUsage[];
  byModel: (UsageTotals & { model: string })[];
  totals: UsageTotals;
  priceTableAsOf: string | null;
}

export type UsageResult<T> = { kind: "ok"; value: T } | { kind: "network" } | { kind: "error" };

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseTotals(o: Record<string, unknown>): UsageTotals | null {
  const { calls, inputTokens, outputTokens, estimatedCostUsd } = o;
  if (!isCount(calls) || !isCount(inputTokens) || !isCount(outputTokens)) return null;
  if (estimatedCostUsd !== null && !isCount(estimatedCostUsd)) return null;
  return { calls, inputTokens, outputTokens, estimatedCostUsd };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseTrend(body: unknown): UsageTrend | null {
  if (!isRecord(body) || !Array.isArray(body.days) || body.days.length === 0) return null;
  if (!Array.isArray(body.byFeature) || !Array.isArray(body.byModel) || !isRecord(body.totals)) {
    return null;
  }
  const asOf = body.priceTableAsOf;
  if (asOf !== null && typeof asOf !== "string") return null;
  const totals = parseTotals(body.totals);
  if (!totals) return null;

  const days: TrendDay[] = [];
  for (const d of body.days) {
    if (!isRecord(d) || typeof d.date !== "string" || !DATE_PATTERN.test(d.date)) return null;
    if (!isRecord(d.byFeature)) return null;
    const byFeature: Record<string, UsageTotals> = {};
    for (const [feature, value] of Object.entries(d.byFeature)) {
      if (!isRecord(value)) return null;
      const t = parseTotals(value);
      if (!t) return null;
      byFeature[feature] = t;
    }
    days.push({ date: d.date, byFeature });
  }

  const byFeature: FeatureUsage[] = [];
  for (const row of body.byFeature) {
    if (!isRecord(row) || typeof row.feature !== "string") return null;
    const t = parseTotals(row);
    if (!t) return null;
    byFeature.push({ feature: row.feature, ...t });
  }
  const byModel: (UsageTotals & { model: string })[] = [];
  for (const row of body.byModel) {
    if (!isRecord(row) || typeof row.model !== "string") return null;
    const t = parseTotals(row);
    if (!t) return null;
    byModel.push({ model: row.model, ...t });
  }
  return { days, byFeature, byModel, totals, priceTableAsOf: asOf };
}

async function get<T>(path: string, parse: (body: unknown) => T | null): Promise<UsageResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`);
  } catch {
    return { kind: "network" };
  }
  if (res.status !== 200) return { kind: "error" };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: "error" };
  }
  const value = parse(body);
  return value ? { kind: "ok", value } : { kind: "error" };
}

export function fetchUsageTrend(days: number): Promise<UsageResult<UsageTrend>> {
  return get(`/api/usage/trend?days=${encodeURIComponent(String(days))}`, parseTrend);
}

export function fetchSessionUsage(sessionId: string): Promise<UsageResult<UsageTotals>> {
  return get(`/api/usage/session/${encodeURIComponent(sessionId)}`, (b) =>
    isRecord(b) ? parseTotals(b) : null
  );
}

const numberFormat = new Intl.NumberFormat("en-US");
export function formatCount(n: number): string {
  return numberFormat.format(n);
}

/** "$1.23" style amount; the caller states the unit (USD). Amounts under a cent keep four decimals. */
export function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: n > 0 && n < 0.01 ? 4 : 2,
  }).format(n);
}
