import { Prisma } from "@prisma/client";
import prisma from "./db";
import { errName } from "./errors";
import type { PriceRow } from "./settings";
import { listPrices } from "./settingsStore";

// LLM usage recording: numbers and ids only. Never prompts, transcripts, responses or drafts.

export type UsageFeature = "conversation" | "report" | "designer-draft" | "persona-draft";

/** Who and what an LLM call is for; set by the call site and passed through the provider. */
export interface UsageMeta {
  feature: UsageFeature;
  ownerId?: string;
  sessionId?: string;
}

export interface UsageRecord extends UsageMeta {
  provider: "anthropic";
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export type PriceTable = Record<string, { inputPerMtok: number; outputPerMtok: number; asOf: string }>;

/** Converts stored price rows (model -> entry) in one place. */
export function priceTableFrom(rows: readonly PriceRow[]): PriceTable {
  const table: PriceTable = {};
  for (const r of rows) table[r.model] = { inputPerMtok: r.inputPerMtok, outputPerMtok: r.outputPerMtok, asOf: r.asOf };
  return table;
}

/** The owner used when a call site has none (the local-mode owner, as in auth.ts). */
const DEFAULT_OWNER = "local";

/** Estimated cost in USD, or null when a token count is missing or the model has no price. */
export function estimateCostUsd(
  r: Pick<UsageRecord, "model" | "inputTokens" | "outputTokens">,
  prices: PriceTable,
): number | null {
  const price = Object.prototype.hasOwnProperty.call(prices, r.model) ? prices[r.model] : undefined;
  if (!price || r.inputTokens === null || r.outputTokens === null) return null;
  return (r.inputTokens * price.inputPerMtok + r.outputTokens * price.outputPerMtok) / 1_000_000;
}

/**
 * Stores one usage row. Prices come from the owner's stored prices unless a table is passed; the
 * cost is fixed at record time, so a price saved later affects only later rows. If the price
 * lookup fails the row is stored with a null cost. Never throws: a failure is logged by error
 * class only. Callers may fire and forget it; it never delays or fails the LLM call it describes.
 */
export async function recordUsage(r: UsageRecord, prices?: PriceTable): Promise<void> {
  try {
    if (!prices) {
      try {
        prices = priceTableFrom(await listPrices(r.ownerId ?? DEFAULT_OWNER));
      } catch (err) {
        console.error(`[usage] price lookup failed: ${errName(err)}`);
        prices = {};
      }
    }
    await prisma.llmUsage.create({
      data: {
        ownerId: r.ownerId ?? DEFAULT_OWNER,
        sessionId: r.sessionId ?? null,
        feature: r.feature,
        provider: r.provider,
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        estimatedCostUsd: estimateCostUsd(r, prices),
      },
    });
  } catch (err) {
    console.error(`[usage] record failed: ${errName(err)}`);
  }
}

/** The latest `asOf` in the price table, or null when it is empty. */
function priceTableAsOf(prices: PriceTable): string | null {
  const dates = Object.values(prices).map((p) => p.asOf);
  return dates.length === 0 ? null : dates.sort().at(-1)!;
}

/**
 * Usage of one owner over the last `sinceDays` days, per feature (sorted by name). A feature's
 * cost sums only the calls that had an estimate; it is null when none had one. The price date is
 * the latest `asOf` among the owner's stored prices (null when none, or when they cannot be read).
 */
export async function summarizeUsage(
  ownerId: string,
  sinceDays: number,
  prices?: PriceTable,
): Promise<{
  byFeature: {
    feature: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number | null;
  }[];
  priceTableAsOf: string | null;
}> {
  let priceAsOf: string | null = null;
  try {
    priceAsOf = priceTableAsOf(prices ?? priceTableFrom(await listPrices(ownerId)));
  } catch (err) {
    console.error(`[usage] price lookup failed: ${errName(err)}`);
  }
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const groups = await prisma.llmUsage.groupBy({
    by: ["feature"],
    where: { ownerId, at: { gte: since } },
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true, estimatedCostUsd: true },
    orderBy: { feature: "asc" },
  });
  return {
    byFeature: groups.map((g) => ({
      feature: g.feature,
      calls: g._count._all,
      inputTokens: g._sum.inputTokens ?? 0,
      outputTokens: g._sum.outputTokens ?? 0,
      estimatedCostUsd: g._sum.estimatedCostUsd ?? null,
    })),
    priceTableAsOf: priceAsOf,
  };
}

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export interface UsageTrend {
  /** Every UTC day in the range, oldest first; a day without calls has an empty `byFeature`. */
  days: { date: string; byFeature: Record<string, UsageTotals> }[];
  byFeature: (UsageTotals & { feature: string })[];
  byModel: (UsageTotals & { model: string })[];
  totals: UsageTotals;
  priceTableAsOf: string | null;
}

interface RawGroup {
  day?: string;
  feature?: string;
  model?: string;
  calls: bigint | number;
  inputTokens: bigint | number | null;
  outputTokens: bigint | number | null;
  cost: number | null;
}

function totalsOf(g: RawGroup): UsageTotals {
  return {
    calls: Number(g.calls),
    inputTokens: Number(g.inputTokens ?? 0),
    outputTokens: Number(g.outputTokens ?? 0),
    estimatedCostUsd: g.cost === null || g.cost === undefined ? null : Number(g.cost),
  };
}

function addTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    calls: a.calls + b.calls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    estimatedCostUsd:
      a.estimatedCostUsd === null && b.estimatedCostUsd === null
        ? null
        : (a.estimatedCostUsd ?? 0) + (b.estimatedCostUsd ?? 0),
  };
}

const EMPTY_TOTALS: UsageTotals = { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: null };

/**
 * Day-by-day usage of one owner over the last `days` UTC days (today included), per feature, plus
 * per-feature, per-model and overall totals. Cost semantics are those of `summarizeUsage`. Days
 * without calls are filled in here, not by the database.
 */
export async function usageTrend(ownerId: string, days: number, prices?: PriceTable): Promise<UsageTrend> {
  let priceAsOf: string | null = null;
  try {
    priceAsOf = priceTableAsOf(prices ?? priceTableFrom(await listPrices(ownerId)));
  } catch (err) {
    console.error(`[usage] price lookup failed: ${errName(err)}`);
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startMs = todayStart - (days - 1) * DAY_MS;

  const byDayFeature = await prisma.$queryRaw<RawGroup[]>(Prisma.sql`
    SELECT strftime('%Y-%m-%d', "at" / 1000, 'unixepoch') AS day, "feature" AS feature,
           COUNT(*) AS calls, SUM("inputTokens") AS inputTokens, SUM("outputTokens") AS outputTokens,
           SUM("estimatedCostUsd") AS cost
    FROM "LlmUsage"
    WHERE "ownerId" = ${ownerId} AND "at" >= ${startMs}
    GROUP BY day, "feature"`);
  const byModelRows = await prisma.$queryRaw<RawGroup[]>(Prisma.sql`
    SELECT "model" AS model,
           COUNT(*) AS calls, SUM("inputTokens") AS inputTokens, SUM("outputTokens") AS outputTokens,
           SUM("estimatedCostUsd") AS cost
    FROM "LlmUsage"
    WHERE "ownerId" = ${ownerId} AND "at" >= ${startMs}
    GROUP BY "model"`);

  const dayMap = new Map<string, Record<string, UsageTotals>>();
  const featureMap = new Map<string, UsageTotals>();
  let totals = EMPTY_TOTALS;
  for (const g of byDayFeature) {
    const t = totalsOf(g);
    const day = g.day!;
    const feature = g.feature!;
    dayMap.set(day, { ...(dayMap.get(day) ?? {}), [feature]: t });
    featureMap.set(feature, addTotals(featureMap.get(feature) ?? EMPTY_TOTALS, t));
    totals = addTotals(totals, t);
  }

  const out: UsageTrend["days"] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(startMs + i * DAY_MS).toISOString().slice(0, 10);
    out.push({ date, byFeature: dayMap.get(date) ?? {} });
  }
  const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    days: out,
    byFeature: [...featureMap.entries()]
      .sort(([a], [b]) => byCode(a, b))
      .map(([feature, t]) => ({ feature, ...t })),
    byModel: byModelRows
      .map((g) => ({ model: g.model!, ...totalsOf(g) }))
      .sort((a, b) => byCode(a.model, b.model)),
    totals,
    priceTableAsOf: priceAsOf,
  };
}

/** Totals for one session of one owner; zero calls for an unknown or foreign session. */
export async function usageForSession(
  ownerId: string,
  sessionId: string,
): Promise<{ calls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number | null }> {
  const agg = await prisma.llmUsage.aggregate({
    where: { ownerId, sessionId },
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true, estimatedCostUsd: true },
  });
  return {
    calls: agg._count._all,
    inputTokens: agg._sum.inputTokens ?? 0,
    outputTokens: agg._sum.outputTokens ?? 0,
    estimatedCostUsd: agg._sum.estimatedCostUsd ?? null,
  };
}
