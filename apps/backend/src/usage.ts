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
