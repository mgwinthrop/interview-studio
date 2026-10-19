import { PAUSE_THRESHOLD_SEC, type DeliverySummary } from "./metrics";

/**
 * Hard check on the model's delivery reading: every number written in digits must be one the
 * code supplied (a summary value, an answer count or the pause threshold), or a unit
 * conversion or rounding of one. The check is lenient on rounding and units, strict on
 * invented numbers:
 *
 * - A number `x` written with `d` decimals matches a value `c` when `c`, rounded to `d`
 *   decimals, equals `x` (so 142.3 may be written 142, and 1.84 may be written 1.8 or 2).
 * - The unit written right after the number narrows what it may match:
 *   - "words per minute", "wpm", "per minute": a pace value only;
 *   - "ms", "milliseconds": a time, from milliseconds as given or seconds times 1000;
 *   - "s", "seconds": a time, from seconds as given or milliseconds divided by 1000;
 *   - "min", "minutes": a time, from seconds divided by 60 or milliseconds by 60,000;
 *   - "%", "percent": never matches (the summary holds no percentages);
 *   - anything else (for example "answers", "pauses", or nothing): any value, as given,
 *     divided by 1000 or divided by 60.
 * - `,` is a decimal separator only when followed by one or two digits ("1,84"), and a
 *   thousands separator otherwise ("1,200").
 * - Null summary fields are skipped, so a number the code did not measure never matches.
 *
 * Number words ("three answers") are not checked: only digits are.
 */
export function readingQuotesOnlySuppliedNumbers(
  reading: string,
  summary: DeliverySummary,
  counts: { answers: number; measured: number },
): boolean {
  const pace: number[] = [];
  const seconds: number[] = [];
  const millis: number[] = [];
  const plain: number[] = [];
  const add = (into: number[], v: number | null | undefined) => {
    if (typeof v === "number" && Number.isFinite(v)) into.push(v);
  };

  add(pace, summary.averageWordsPerMinute);
  add(seconds, summary.speakingTimeSec);
  add(seconds, summary.longestPauseSec);
  add(seconds, PAUSE_THRESHOLD_SEC);
  add(millis, summary.medianResponseGapMs);
  add(plain, summary.turnsMeasured);
  add(plain, summary.totalWords);
  add(plain, summary.pauseCount);
  add(plain, summary.fillerCount);
  add(plain, counts.answers);
  add(plain, counts.measured);
  for (const t of summary.perTurn) {
    add(plain, t.turn);
    add(plain, t.wordCount);
    add(pace, t.wordsPerMinute);
    add(seconds, t.longestPauseSec);
    add(millis, t.responseGapMs);
  }
  const all = [...pace, ...seconds, ...millis, ...plain];

  // Candidate values for each unit, already converted into that unit.
  const candidates: Record<Unit, number[]> = {
    pace,
    ms: [...millis, ...seconds.map((s) => s * 1000)],
    seconds: [...seconds, ...millis.map((m) => m / 1000)],
    minutes: [...seconds.map((s) => s / 60), ...millis.map((m) => m / 60_000)],
    percent: [],
    none: [...all, ...all.map((c) => c / 1000), ...all.map((c) => c / 60)],
  };

  for (const match of reading.matchAll(NUMBER)) {
    const parsed = parseNumber(match[0]);
    const unit = unitAfter(reading.slice((match.index ?? 0) + match[0].length));
    if (!candidates[unit].some((c) => Math.abs(round(c, parsed.decimals) - parsed.value) < TOLERANCE)) {
      return false;
    }
  }
  return true;
}

type Unit = "pace" | "ms" | "seconds" | "minutes" | "percent" | "none";

const TOLERANCE = 1e-9;

/** A run of digits with optional `.` or `,` groups (each group is split out in parseNumber). */
const NUMBER = /\d+(?:[.,]\d+)*/g;

const UNITS: readonly [RegExp, Unit][] = [
  [/^(?:%|percent\b|per\s*cent\b)/, "percent"],
  [/^(?:words?\s+(?:per|a|an|each|every)\s+minute\b|wpm\b|words?\s*\/\s*min|per\s+minute\b)/, "pace"],
  [/^(?:ms\b|msecs?\b|milliseconds?\b)/, "ms"],
  [/^(?:s\b|secs?\b|seconds?\b)/, "seconds"],
  [/^(?:mins?\b|minutes?\b)/, "minutes"],
];

/** The unit written right after a number, allowing spaces or a hyphen ("0.7-second"). */
function unitAfter(rest: string): Unit {
  const text = rest.replace(/^[\s-]+/, "").toLowerCase();
  for (const [pattern, unit] of UNITS) if (pattern.test(text)) return unit;
  return "none";
}

/**
 * `,` followed by one or two digits is a decimal separator; any other `,` group is a
 * thousands separator. A `.` group is decimals. Only the last decimal group counts as the
 * fraction; earlier groups are joined as whole digits.
 */
function parseNumber(token: string): { value: number; decimals: number } {
  const parts = token.split(/(?=[.,])/);
  let whole = parts[0];
  let fraction = "";
  for (const part of parts.slice(1)) {
    const sep = part[0];
    const digits = part.slice(1);
    const isDecimal = sep === "." || digits.length <= 2;
    if (isDecimal && fraction === "") fraction = digits;
    else if (fraction === "") whole += digits;
    else return { value: Number.NaN, decimals: 0 };
  }
  const value = Number(fraction === "" ? whole : `${whole}.${fraction}`);
  return { value, decimals: fraction.length };
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
