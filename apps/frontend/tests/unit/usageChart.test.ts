import { describe, expect, it } from "vitest";
import {
  FEATURE_ORDER,
  addCost,
  buildChartData,
  formatDayLabel,
  formatTokens,
  hasCost,
  niceTicks,
  seriesKeyOf,
} from "../../app/lib/usageChart";
import type { TrendDay, UsageTotals, UsageTrend } from "../../app/lib/usage";

const t = (calls: number, inputTokens: number, outputTokens: number, estimatedCostUsd: number | null): UsageTotals => ({
  calls,
  inputTokens,
  outputTokens,
  estimatedCostUsd,
});

const trendOf = (days: TrendDay[], totalsCost: number | null = null): UsageTrend => ({
  days,
  byFeature: [],
  byModel: [],
  totals: t(0, 0, 0, totalsCost),
  priceTableAsOf: null,
});

describe("seriesKeyOf / addCost", () => {
  it("keeps known features and groups the rest as other", () => {
    for (const k of FEATURE_ORDER) expect(seriesKeyOf(k)).toBe(k);
    expect(seriesKeyOf("brand-new-feature")).toBe("other");
    expect(seriesKeyOf("")).toBe("other");
  });

  it("adds known costs and treats null as unknown, not zero", () => {
    expect(addCost(null, null)).toBeNull();
    expect(addCost(null, 2)).toBe(2);
    expect(addCost(1, null)).toBe(1);
    expect(addCost(1.5, 2)).toBe(3.5);
    expect(addCost(0, null)).toBe(0);
  });
});

describe("formatDayLabel", () => {
  it("reads the string so no timezone can shift the day", () => {
    expect(formatDayLabel("2026-11-10")).toBe("10 Nov");
    expect(formatDayLabel("2026-01-01")).toBe("1 Jan");
    expect(formatDayLabel("2026-12-31")).toBe("31 Dec");
  });

  it("returns anything unexpected unchanged", () => {
    expect(formatDayLabel("not a date")).toBe("not a date");
    expect(formatDayLabel("2026-13-01")).toBe("2026-13-01");
    expect(formatDayLabel("2026-00-10")).toBe("2026-00-10");
  });
});

describe("niceTicks", () => {
  it("handles empty and invalid maxima", () => {
    for (const bad of [0, -5, NaN, Infinity]) expect(niceTicks(bad)).toEqual([0, 1]);
  });

  it("uses steps of 1, 2 or 5 times a power of ten", () => {
    expect(niceTicks(100)).toEqual([0, 50, 100]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
  });

  it.each([0.003, 0.5, 1, 9, 37, 152_000, 4_800_000, 1e9])("covers %s with ascending ticks from 0", (max) => {
    const ticks = niceTicks(max);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
    expect(ticks.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
  });
});

describe("formatTokens", () => {
  it.each([
    [0, "0"],
    [950, "950"],
    [1000, "1k"],
    [1500, "1.5k"],
    [152_000, "152k"],
    [1_100_000, "1.1M"],
    [999_999, "1M"],
    [2_000_000_000, "2B"],
  ])("%s -> %s", (n, out) => {
    expect(formatTokens(n)).toBe(out);
  });

  it("never prints NaN or negatives", () => {
    expect(formatTokens(NaN)).toBe("0");
    expect(formatTokens(-5)).toBe("0");
  });
});

describe("hasCost", () => {
  it("is true when the totals or any feature on any day has a cost", () => {
    expect(hasCost(trendOf([], 1))).toBe(true);
    expect(hasCost(trendOf([{ date: "2026-11-10", byFeature: { report: t(1, 1, 1, 0.01) } }]))).toBe(true);
  });
  it("is false when no cost is known anywhere", () => {
    expect(hasCost(trendOf([{ date: "2026-11-10", byFeature: { report: t(1, 1, 1, null) } }]))).toBe(false);
  });
});

describe("buildChartData", () => {
  const trend = trendOf(
    [
      {
        date: "2026-11-09",
        byFeature: { report: t(2, 1000, 500, 0.02), conversation: t(10, 100_000, 10_000, 0.2) },
      },
      { date: "2026-11-10", byFeature: {} },
      { date: "2026-11-11", byFeature: { mystery: t(1, 10, 5, null), conversation: t(0, 999, 999, 9) } },
    ],
    0.22,
  );

  it("stacks parts in the fixed series order, not the order the server sent them", () => {
    const [day] = buildChartData(trend, "tokens").days;
    expect(day.parts.map((p) => p.key)).toEqual(["conversation", "report"]);
    expect(day.parts[0]).toMatchObject({ value: 110_000, calls: 10 });
    expect(day.total).toBe(111_500);
    expect(day.label).toBe("9 Nov");
  });

  it("gives an empty day zero calls and a zero total", () => {
    const empty = buildChartData(trend, "tokens").days[1];
    expect(empty).toMatchObject({ calls: 0, total: 0, parts: [] });
  });

  it("ignores features with no calls", () => {
    const last = buildChartData(trend, "tokens").days[2];
    expect(last.parts.map((p) => p.key)).toEqual(["other"]);
  });

  it("collapses unknown features into other and only then lists that series", () => {
    expect(buildChartData(trend, "tokens").seriesKeys).toEqual([...FEATURE_ORDER, "other"]);
    const known = trendOf([{ date: "2026-11-09", byFeature: { report: t(1, 1, 1, null) } }]);
    expect(buildChartData(known, "tokens").seriesKeys).toEqual([...FEATURE_ORDER]);
  });

  it("reports the busiest day and whether there is any usage", () => {
    const data = buildChartData(trend, "tokens");
    expect(data.maxTotal).toBe(111_500);
    expect(data.hasAnyUsage).toBe(true);
    expect(buildChartData(trendOf([{ date: "2026-11-09", byFeature: {} }]), "tokens").hasAnyUsage).toBe(false);
  });

  it("in the cost measure, a day with calls but no price has a null total, not zero", () => {
    const data = buildChartData(trend, "cost");
    expect(data.days[0].total).toBeCloseTo(0.22);
    expect(data.days[2]).toMatchObject({ total: null, calls: 1 });
    expect(data.days[2].parts[0].value).toBeNull();
    expect(data.maxTotal).toBeCloseTo(0.22);
  });

  it("in the tokens measure the same unpriced day still totals its tokens", () => {
    expect(buildChartData(trend, "tokens").days[2].total).toBe(15);
  });
});
