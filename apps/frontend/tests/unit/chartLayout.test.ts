import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIDTH,
  MAX_WIDTH,
  MIN_WIDTH,
  NO_CALLS_CELL,
  axisTicks,
  clampWidth,
  dayAriaLabel,
  formatTicks,
  nextActiveIndex,
  roundedTopPath,
  stackSegments,
  tableCell,
  tableTotalCell,
  thinLabelIndices,
  tooltipContent,
} from "../../app/components/usage/chartLayout";
import type { DayPoint } from "../../app/lib/usageChart";

const day = (over: Partial<DayPoint> = {}): DayPoint => ({
  date: "2026-11-10",
  label: "10 Nov",
  total: 152_000,
  calls: 12,
  parts: [
    { key: "conversation", value: 110_000, calls: 10 },
    { key: "report", value: 42_000, calls: 2 },
  ],
  ...over,
});

describe("clampWidth", () => {
  it("falls back to the default for unusable measurements", () => {
    for (const bad of [0, -10, NaN, Infinity]) expect(clampWidth(bad)).toBe(DEFAULT_WIDTH);
  });
  it("clamps to the allowed range and rounds down", () => {
    expect(clampWidth(50)).toBe(MIN_WIDTH);
    expect(clampWidth(5000)).toBe(MAX_WIDTH);
    expect(clampWidth(500.9)).toBe(500);
  });
});

describe("axisTicks and formatTicks", () => {
  it("uses whole-number ticks for tiny token maxima", () => {
    expect(axisTicks("tokens", 0)).toEqual([0, 1]);
    expect(axisTicks("tokens", 0.2)).toEqual([0, 1]);
    expect(axisTicks("tokens", 3)).toEqual([0, 1, 2, 3]);
  });
  it("uses nice ticks otherwise", () => {
    expect(axisTicks("tokens", 10)).toEqual([0, 5, 10]);
    expect(axisTicks("cost", 10)).toEqual([0, 5, 10]);
  });
  it("prints every tick with the same number of decimals", () => {
    expect(formatTicks("cost", [0, 0.005, 0.01])).toEqual(["$0.000", "$0.005", "$0.010"]);
    expect(formatTicks("cost", [0, 500, 1000])).toEqual(["$0", "$500", "$1,000"]);
    expect(formatTicks("tokens", [0, 1000, 2000])).toEqual(["0", "1k", "2k"]);
  });
});

describe("thinLabelIndices", () => {
  it("handles zero and one day", () => {
    expect(thinLabelIndices(0, 50)).toEqual([]);
    expect(thinLabelIndices(1, 50)).toEqual([0]);
  });
  it("labels every day when there is room", () => {
    expect(thinLabelIndices(5, 200)).toEqual([0, 1, 2, 3, 4]);
  });
  it.each([
    [7, 20],
    [14, 30],
    [30, 18],
    [90, 6],
  ])("for %s days in %spx slots always includes the first and last day, ascending, without crowding", (n, slotW) => {
    const idx = thinLabelIndices(n, slotW);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(n - 1);
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
    expect(idx.length).toBeLessThan(n);
  });
});

describe("roundedTopPath", () => {
  it("is a closed path, and the radius never exceeds half the width or the height", () => {
    const p = roundedTopPath(10, 20, 2, 100);
    expect(p.startsWith("M10,120")).toBe(true);
    expect(p.endsWith("Z")).toBe(true);
    // width 2 -> radius 1, so the top-left arc starts one unit below y
    expect(p).toContain("L10,21");
  });
  it("copes with a very short segment", () => {
    expect(roundedTopPath(0, 0, 20, 1)).toContain("L0,1");
  });
});

describe("stackSegments", () => {
  it("places a single part at the baseline", () => {
    expect(stackSegments([{ key: "a", raw: 50 }], 200)).toEqual([{ key: "a", start: 0, end: 50 }]);
  });

  it("separates parts with a gap and keeps order", () => {
    const [a, b] = stackSegments([{ key: "a", raw: 50 }, { key: "b", raw: 50 }], 400);
    expect(a.start).toBe(0);
    expect(b.start).toBeGreaterThan(a.end - 1);
    expect(b.end).toBeGreaterThan(b.start);
  });

  it("keeps every segment inside the maximum height and non-overlapping, even for tiny parts", () => {
    const parts = [
      { key: "a", raw: 100 },
      { key: "b", raw: 0.2 },
      { key: "c", raw: 0.2 },
      { key: "d", raw: 0.2 },
    ];
    const segs = stackSegments(parts, 101);
    for (const s of segs) {
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.end).toBeLessThanOrEqual(101);
      expect(s.end).toBeGreaterThan(s.start);
    }
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBeGreaterThanOrEqual(segs[i - 1].end);
  });
});

describe("nextActiveIndex (roving focus)", () => {
  it("moves by one and stops at the ends", () => {
    expect(nextActiveIndex("ArrowRight", 2, 5)).toBe(3);
    expect(nextActiveIndex("ArrowRight", 4, 5)).toBe(4);
    expect(nextActiveIndex("ArrowLeft", 2, 5)).toBe(1);
    expect(nextActiveIndex("ArrowLeft", 0, 5)).toBe(0);
  });
  it("jumps with Home and End", () => {
    expect(nextActiveIndex("Home", 3, 5)).toBe(0);
    expect(nextActiveIndex("End", 1, 5)).toBe(4);
  });
  it("ignores other keys and empty charts", () => {
    expect(nextActiveIndex("Enter", 1, 5)).toBeNull();
    expect(nextActiveIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("spoken and visible wording", () => {
  it("reads a normal day in tokens", () => {
    expect(dayAriaLabel(day(), "tokens")).toBe("10 Nov: 152,000 tokens. Conversation replies 110,000; Reports 42,000.");
  });
  it("reads a day in dollars", () => {
    const d = day({ total: 1.5, parts: [{ key: "report", value: 1.5, calls: 2 }] });
    expect(dayAriaLabel(d, "cost")).toBe("10 Nov: $1.50 estimated. Reports $1.50.");
  });
  it("says no usage for an empty day and not available for an unpriced one", () => {
    expect(dayAriaLabel(day({ calls: 0, total: 0, parts: [] }), "tokens")).toBe("10 Nov: no usage.");
    expect(dayAriaLabel(day({ total: null }), "cost")).toBe("10 Nov: not available (calls without a price).");
  });
  it("marks a part with calls but no price", () => {
    const d = day({ total: 2, parts: [{ key: "report", value: null, calls: 1 }, { key: "conversation", value: 2, calls: 1 }] });
    expect(dayAriaLabel(d, "cost")).toContain("Reports not available");
  });

  it("the tooltip carries the same numbers, with the series colour", () => {
    const tip = tooltipContent(day(), "tokens");
    expect(tip.title).toBe("10 Nov");
    expect(tip.total).toBe("152,000 tokens");
    expect(tip.rows[0]).toMatchObject({ key: "conversation", label: "Conversation replies", value: "110,000", color: "#0098AA" });
    expect(tooltipContent(day({ calls: 0, total: 0, parts: [] }), "tokens").total).toBe("No usage");
    expect(tooltipContent(day({ total: null }), "cost").total).toMatch(/^Not available/);
  });

  it("table cells show a dash for no calls and a word for no price", () => {
    expect(tableCell("tokens", undefined)).toBe(NO_CALLS_CELL);
    expect(tableCell("tokens", { key: "report", value: 42_000, calls: 2 })).toBe("42,000");
    expect(tableCell("cost", { key: "report", value: null, calls: 2 })).toBe("not available");
    expect(tableTotalCell("tokens", day())).toBe("152,000");
    expect(tableTotalCell("cost", day({ total: null }))).toBe("not available");
    expect(tableTotalCell("tokens", day({ calls: 0, total: 0 }))).toBe(NO_CALLS_CELL);
  });
});
