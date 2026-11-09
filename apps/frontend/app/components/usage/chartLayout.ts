// Pure geometry and wording for the usage trend chart and table. No React, no DOM.
// Coordinates are real pixels: the SVG's viewBox equals its width and height, so 12px text stays 12px.
import { formatCount, formatUsd } from "../../lib/usage";
import {
  FEATURE_LABELS,
  SERIES_COLORS,
  formatTokens,
  niceTicks,
  type ChartData,
  type DayPart,
  type DayPoint,
  type Measure,
  type SeriesKey,
} from "../../lib/usageChart";

export const CHART_HEIGHT = 240;
export const DEFAULT_WIDTH = 640;
/**
 * Lower bound for a measured width. Below 280 on purpose: a card at a 320px viewport leaves about
 * 232px of content, and a wider SVG would scroll the page sideways.
 */
export const MIN_WIDTH = 200;
export const MAX_WIDTH = 720;
/** Estimated width of an x-axis label such as "30 Sep" at 12px. */
export const X_LABEL_WIDTH = 44;
/** Extra room kept between x labels, so that pulling an edge label inward never makes two touch. */
const X_LABEL_PAD = 12;
const CHAR_WIDTH = 8;
const TOP_MARGIN = 24;
const BOTTOM_BAND = 28;
const RIGHT_MARGIN = 12;
const GAP = 2;
const MAX_COLUMN = 24;
const TOP_RADIUS = 4;

export const NOT_AVAILABLE = "not available";
export const NO_CALLS_CELL = "–";

export interface Segment {
  key: SeriesKey;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The top segment of a stack has rounded top corners. */
  rounded: boolean;
}

export interface DayGeom {
  index: number;
  slotX: number;
  slotW: number;
  cx: number;
  colX: number;
  colW: number;
  segments: Segment[];
}

export interface Layout {
  width: number;
  height: number;
  plot: { left: number; top: number; right: number; bottom: number };
  ticks: { value: number; y: number; label: string }[];
  xLabels: { index: number; x: number; label: string }[];
  days: DayGeom[];
  direct: { index: number; x: number; y: number; text: string } | null;
}

export function clampWidth(measured: number): number {
  if (!Number.isFinite(measured) || measured <= 0) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor(measured)));
}

export function formatValue(measure: Measure, v: number): string {
  return measure === "tokens" ? formatTokens(v) : formatUsd(v);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/**
 * Which day indices get an x label: every `step`-th day counted back from the last, plus the first.
 * `step` is chosen so that adjacent labels are at least `labelWidth + pad` apart.
 */
export function thinLabelIndices(n: number, slotW: number, labelWidth = X_LABEL_WIDTH): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const step = Math.max(1, Math.ceil((labelWidth + X_LABEL_PAD) / Math.max(slotW, 0.001)));
  const picked: number[] = [];
  for (let i = n - 1; i >= 0; i -= step) picked.unshift(i);
  if (picked[0] !== 0) {
    if (picked[0] >= step) picked.unshift(0);
    else if (picked.length > 1) picked[0] = 0; // too close to the first day: swap it for the first day
  }
  return picked;
}

/** Path for a column segment with rounded top corners and a square bottom. */
export function roundedTopPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(TOP_RADIUS, w / 2, h);
  const f = (n: number) => Number(n.toFixed(2));
  return [
    `M${f(x)},${f(y + h)}`,
    `L${f(x)},${f(y + r)}`,
    `Q${f(x)},${f(y)} ${f(x + r)},${f(y)}`,
    `L${f(x + w - r)},${f(y)}`,
    `Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)}`,
    `L${f(x + w)},${f(y + h)}`,
    "Z",
  ].join(" ");
}

export function computeLayout(data: ChartData, measure: Measure, measuredWidth: number): Layout {
  const width = clampWidth(measuredWidth);
  const height = CHART_HEIGHT;
  const tickValues = niceTicks(data.maxTotal);
  const topValue = tickValues[tickValues.length - 1] || 1;
  const tickLabels = tickValues.map((v) => formatValue(measure, v));
  const widest = Math.max(...tickLabels.map((l) => l.length));
  const left = Math.max(X_LABEL_WIDTH / 2 + 2, widest * CHAR_WIDTH + 8);
  const right = width - RIGHT_MARGIN;
  const top = TOP_MARGIN;
  const bottom = height - BOTTOM_BAND;
  const plotH = bottom - top;
  const scale = plotH / topValue;
  const n = data.days.length;
  const slotW = n > 0 ? (right - left) / n : right - left;

  const ticks = tickValues.map((value, i) => ({ value, y: bottom - value * scale, label: tickLabels[i] }));

  const days: DayGeom[] = data.days.map((day, index) => {
    const slotX = left + index * slotW;
    const colW = Math.min(MAX_COLUMN, Math.max(2, slotW * 0.7));
    const colX = clamp(slotX + (slotW - colW) / 2, left, right - colW);
    const visible = day.parts.filter((p): p is DayPart & { value: number } => p.value !== null && p.value > 0);
    const segments: Segment[] = [];
    let cumPx = 0;
    visible.forEach((p, j) => {
      const raw = p.value * scale;
      const segBottom = bottom - cumPx - (j > 0 ? GAP : 0);
      let h = Math.max(1, raw - (j > 0 ? GAP : 0));
      let y = segBottom - h;
      if (y < top) {
        h = Math.max(0, segBottom - top);
        y = top;
      }
      cumPx += raw;
      if (h <= 0) return;
      segments.push({ key: p.key, color: SERIES_COLORS[p.key], x: colX, y, w: colW, h, rounded: j === visible.length - 1 });
    });
    return { index, slotX, slotW, cx: slotX + slotW / 2, colX, colW, segments };
  });

  let direct: Layout["direct"] = null;
  let maxIndex = -1;
  let maxValue = 0;
  data.days.forEach((d, i) => {
    if (d.total !== null && d.total > 0 && d.total >= maxValue) {
      maxValue = d.total;
      maxIndex = i;
    }
  });
  if (maxIndex >= 0) {
    const text = formatValue(measure, maxValue);
    const half = (text.length * CHAR_WIDTH) / 2;
    const segs = days[maxIndex].segments;
    const colTop = segs.length > 0 ? Math.min(...segs.map((s) => s.y)) : bottom;
    direct = { index: maxIndex, x: clamp(days[maxIndex].cx, half, width - half), y: colTop - 6, text };
  }

  const half = X_LABEL_WIDTH / 2;
  const xLabels = thinLabelIndices(n, slotW).map((index) => ({
    index,
    x: clamp(days[index].cx, half, width - half),
    label: data.days[index].label,
  }));

  return { width, height, plot: { left, top, right, bottom }, ticks, xLabels, days, direct };
}

/** Roving focus: the day index a key moves to, or null when the key is not a navigation key. */
export function nextActiveIndex(key: string, current: number, n: number): number | null {
  if (n <= 0) return null;
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, current - 1);
    case "ArrowRight":
      return Math.min(n - 1, current + 1);
    case "Home":
      return 0;
    case "End":
      return n - 1;
    default:
      return null;
  }
}

/** Left edge of a tooltip centred on `anchorX`, kept inside a wrapper of `wrapperWidth`. */
export function tooltipLeft(anchorX: number, tooltipWidth: number, wrapperWidth: number): number {
  return clamp(anchorX - tooltipWidth / 2, 0, wrapperWidth - tooltipWidth);
}

function partValue(measure: Measure, p: DayPart): string {
  if (p.value === null) return NOT_AVAILABLE;
  return measure === "tokens" ? formatCount(p.value) : formatUsd(p.value);
}

/** The spoken label of one day; the tooltip and the table carry the same numbers. */
export function dayAriaLabel(day: DayPoint, measure: Measure): string {
  if (day.calls === 0) return `${day.label}: no usage.`;
  if (day.total === null) return `${day.label}: not available (calls without a price).`;
  const total = measure === "tokens" ? `${formatCount(day.total)} tokens` : `${formatUsd(day.total)} estimated`;
  const parts = day.parts.map((p) => `${FEATURE_LABELS[p.key]} ${partValue(measure, p)}`).join("; ");
  return `${day.label}: ${total}. ${parts}.`;
}

export interface TooltipContent {
  title: string;
  total: string;
  rows: { key: SeriesKey; label: string; color: string; value: string }[];
}

export function tooltipContent(day: DayPoint, measure: Measure): TooltipContent {
  let total: string;
  if (day.calls === 0) total = "No usage";
  else if (day.total === null) total = "Not available (calls without a price)";
  else total = measure === "tokens" ? `${formatCount(day.total)} tokens` : `${formatUsd(day.total)} estimated`;
  const rows = day.parts.map((p) => ({
    key: p.key,
    label: FEATURE_LABELS[p.key],
    color: SERIES_COLORS[p.key],
    value: partValue(measure, p),
  }));
  return { title: day.label, total, rows };
}

/** Table cell for one part of a day: "–" when it had no calls, "not available" when it had no price. */
export function tableCell(measure: Measure, part: DayPart | undefined): string {
  if (!part || part.calls === 0) return NO_CALLS_CELL;
  return partValue(measure, part);
}

export function tableTotalCell(measure: Measure, day: DayPoint): string {
  if (day.calls === 0) return NO_CALLS_CELL;
  if (day.total === null) return NOT_AVAILABLE;
  return measure === "tokens" ? formatCount(day.total) : formatUsd(day.total);
}
