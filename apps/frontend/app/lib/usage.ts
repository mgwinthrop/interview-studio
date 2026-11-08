// Usage numbers from the backend (counts and estimated cost only, never content).
// Each helper validates the response defensively; anything unexpected is "error".
import { apiUrl } from "./config";

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** null when the backend has no price for the calls (the price table ships empty). */
  estimatedCostUsd: number | null;
}

export interface FeatureUsage extends UsageTotals {
  feature: string;
}

export interface UsageSummary {
  byFeature: FeatureUsage[];
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

function parseSummary(body: unknown): UsageSummary | null {
  if (!isRecord(body) || !Array.isArray(body.byFeature)) return null;
  const asOf = body.priceTableAsOf;
  if (asOf !== null && typeof asOf !== "string") return null;
  const byFeature: FeatureUsage[] = [];
  for (const row of body.byFeature) {
    if (!isRecord(row) || typeof row.feature !== "string") return null;
    const totals = parseTotals(row);
    if (!totals) return null;
    byFeature.push({ feature: row.feature, ...totals });
  }
  return { byFeature, priceTableAsOf: asOf };
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

export function fetchUsageSummary(days: number): Promise<UsageResult<UsageSummary>> {
  return get(`/api/usage/summary?days=${encodeURIComponent(String(days))}`, parseSummary);
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
