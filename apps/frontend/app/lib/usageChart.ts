// Pure helpers that turn the usage trend into chart-ready data. No React, no I/O.
import type { UsageTrend } from "./usage";

export const FEATURE_ORDER = ["conversation", "report", "designer-draft", "persona-draft"] as const;
export type SeriesKey = (typeof FEATURE_ORDER)[number] | "other";

export const FEATURE_LABELS: Record<SeriesKey, string> = {
  conversation: "Conversation replies",
  report: "Reports",
  "designer-draft": "Interviewer drafts",
  "persona-draft": "Persona drafts from calls",
  other: "Other",
};

export const SERIES_COLORS: Record<SeriesKey, string> = {
  conversation: "#0098AA",
  report: "#E9784A",
  "designer-draft": "#6250D6",
  "persona-draft": "#EDA100",
  other: "#7A8590",
};

export type Measure = "tokens" | "cost";

export interface DayPart {
  key: SeriesKey;
  /** null: the part has calls but none had a price (cost measure only). */
  value: number | null;
  calls: number;
}

export interface DayPoint {
  date: string;
  label: string;
  /** Sum of the known part values; null in the cost measure when the day has calls but no priced call. */
  total: number | null;
  calls: number;
  /** In stack order, bottom-up; only the parts that have calls that day. */
  parts: DayPart[];
}

export interface ChartData {
  days: DayPoint[];
  seriesKeys: SeriesKey[];
  maxTotal: number;
  hasCost: boolean;
  hasAnyUsage: boolean;
}

const KNOWN: ReadonlySet<string> = new Set(FEATURE_ORDER);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function hasCost(trend: UsageTrend): boolean {
  if (trend.totals.estimatedCostUsd !== null) return true;
  return trend.days.some((d) =>
    Object.values(d.byFeature).some((t) => t.estimatedCostUsd !== null)
  );
}

/** "2026-11-10" -> "10 Nov", read from the string so no timezone can shift it. */
export function formatDayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return date;
  return `${Number(m[3])} ${month}`;
}

export function buildChartData(trend: UsageTrend, measure: Measure): ChartData {
  let hasUnknown = false;
  let maxTotal = 0;
  let hasAnyUsage = false;

  const days: DayPoint[] = trend.days.map((day) => {
    // Sum per series key; unknown features collapse into "other".
    const acc = new Map<SeriesKey, { calls: number; tokens: number; cost: number | null }>();
    for (const [feature, t] of Object.entries(day.byFeature)) {
      if (t.calls <= 0) continue;
      const key: SeriesKey = KNOWN.has(feature) ? (feature as SeriesKey) : "other";
      if (key === "other") hasUnknown = true;
      const cur = acc.get(key) ?? { calls: 0, tokens: 0, cost: null };
      cur.calls += t.calls;
      cur.tokens += t.inputTokens + t.outputTokens;
      if (t.estimatedCostUsd !== null) cur.cost = (cur.cost ?? 0) + t.estimatedCostUsd;
      acc.set(key, cur);
    }

    const parts: DayPart[] = [];
    let calls = 0;
    let sum = 0;
    let anyValue = false;
    for (const key of [...FEATURE_ORDER, "other" as const]) {
      const cur = acc.get(key);
      if (!cur) continue;
      const value = measure === "tokens" ? cur.tokens : cur.cost;
      parts.push({ key, value, calls: cur.calls });
      calls += cur.calls;
      if (value !== null) {
        sum += value;
        anyValue = true;
      }
    }
    if (calls > 0) hasAnyUsage = true;
    const total = calls === 0 ? 0 : anyValue || measure === "tokens" ? sum : null;
    if (total !== null && total > maxTotal) maxTotal = total;
    return { date: day.date, label: formatDayLabel(day.date), total, calls, parts };
  });

  const seriesKeys: SeriesKey[] = hasUnknown ? [...FEATURE_ORDER, "other"] : [...FEATURE_ORDER];
  return { days, seriesKeys, maxTotal, hasCost: hasCost(trend), hasAnyUsage };
}

/** Ascending ticks from 0 up to at least `max`, in steps of 1, 2 or 5 times a power of ten. */
export function niceTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const start = Math.floor(Math.log10(max / target)) - 1;
  let step = Math.pow(10, start);
  for (let e = start; e < start + 40; e++) {
    const base = Math.pow(10, e);
    const found = [1, 2, 5].map((m) => m * base).find((s) => Math.ceil(max / s - 1e-9) <= target);
    if (found !== undefined) {
      step = found;
      break;
    }
  }
  const count = Math.max(1, Math.ceil(max / step - 1e-9));
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) ticks.push(Number((i * step).toPrecision(12)));
  return ticks;
}

/** 950 -> "950", 152000 -> "152k", 1100000 -> "1.1M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return String(Math.round(Math.max(0, n || 0)));
  const units = ["k", "M", "B"];
  let value = n;
  let i = -1;
  do {
    value /= 1000;
    i++;
  } while (Math.round(value * 10) / 10 >= 1000 && i < units.length - 1);
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(1).replace(/\.0$/, "")}${units[i]}`;
}
