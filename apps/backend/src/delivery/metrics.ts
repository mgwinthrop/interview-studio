import type { Word } from "../providers/types";

/** A gap of at least this many seconds between consecutive words counts as a pause. */
export const PAUSE_THRESHOLD_SEC = 0.7;

/** Whole-token filler words, matched case-insensitively with surrounding punctuation ignored. */
export const FILLER_WORDS: readonly string[] = ["um", "uh", "uhm", "er", "erm", "ah", "hmm", "mm", "mmm"];

/** Pace is not reported for very short answers, where it would be noise. */
const MIN_PACE_DURATION_SEC = 2;
const MIN_PACE_WORDS = 5;
const MAX_RESPONSE_GAP_MS = 600_000;
/** Guards float error at the pause boundary (e.g. 1.7 - 1.0). */
const EPSILON = 1e-9;

/** `null` means unknown; it is never used as a stand-in for zero. */
export interface TurnMetrics {
  wordCount: number;
  /** Words with finite timestamps used for timing; 0 when timing is unknown. */
  timedWordCount: number;
  durationSec: number | null;
  wordsPerMinute: number | null;
  pauseCount: number | null;
  longestPauseSec: number | null;
  responseGapMs: number | null;
  fillerCount: number | null;
}

export interface DeliverySummary {
  turnsMeasured: number;
  totalWords: number;
  speakingTimeSec: number | null;
  averageWordsPerMinute: number | null;
  pauseCount: number | null;
  longestPauseSec: number | null;
  medianResponseGapMs: number | null;
  fillerCount: number | null;
  perTurn: {
    turn: number;
    wordCount: number;
    wordsPerMinute: number | null;
    longestPauseSec: number | null;
    responseGapMs: number | null;
  }[];
}

const round = (value: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

const FILLER_SET: ReadonlySet<string> = new Set(FILLER_WORDS);

function isFiller(token: string): boolean {
  const core = token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return FILLER_SET.has(core);
}

function paceOrNull(wordCount: number, durationSec: number): number | null {
  if (durationSec < MIN_PACE_DURATION_SEC || wordCount < MIN_PACE_WORDS) return null;
  return round(wordCount / (durationSec / 60), 1);
}

export function computeTurnMetrics(input: {
  text: string;
  words: Word[];
  responseGapMs?: number | null;
}): TurnMetrics {
  const { text, words } = input;
  const gap = input.responseGapMs;
  const responseGapMs =
    typeof gap === "number" && Number.isFinite(gap) && gap >= 0 && gap <= MAX_RESPONSE_GAP_MS ? gap : null;

  if (words.length === 0) {
    return {
      wordCount: text.split(/\s+/).filter(Boolean).length,
      timedWordCount: 0,
      durationSec: null,
      wordsPerMinute: null,
      pauseCount: null,
      longestPauseSec: null,
      responseGapMs,
      fillerCount: null,
    };
  }

  const wordCount = words.length;
  const fillerCount = words.reduce((n, word) => n + (isFiller(word.text) ? 1 : 0), 0);

  // Timing uses only words with finite timestamps. Words are sorted by start (on a copy);
  // an end before its start is treated as ending at its start, and negative gaps
  // (overlaps) are clamped to 0.
  const timed = words
    .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end))
    .map((word) => ({ start: word.start, end: Math.max(word.start, word.end) }))
    .sort((a, b) => a.start - b.start);

  // Fewer than two timed words: no span or gap can be measured, so timing is unknown.
  if (timed.length < 2) {
    return {
      wordCount,
      timedWordCount: 0,
      durationSec: null,
      wordsPerMinute: null,
      pauseCount: null,
      longestPauseSec: null,
      responseGapMs,
      fillerCount,
    };
  }

  let pauseCount = 0;
  let longestPause = 0;
  let latestEnd = timed[0].end;
  for (let i = 1; i < timed.length; i++) {
    const pause = Math.max(0, timed[i].start - latestEnd);
    if (pause + EPSILON >= PAUSE_THRESHOLD_SEC) pauseCount++;
    if (pause > longestPause) longestPause = pause;
    latestEnd = Math.max(latestEnd, timed[i].end);
  }

  // Round before comparing with the 2 s threshold so float error cannot flip the result.
  const durationSec = round(Math.max(0, latestEnd - timed[0].start), 2);
  return {
    wordCount,
    timedWordCount: timed.length,
    durationSec,
    // Pace uses only the words that have timing.
    wordsPerMinute: paceOrNull(timed.length, durationSec),
    pauseCount,
    longestPauseSec: round(longestPause, 2),
    responseGapMs,
    fillerCount,
  };
}

export function summarizeDelivery(
  turns: readonly { role: "user" | "assistant"; metrics?: TurnMetrics | null }[],
): DeliverySummary | null {
  const perTurn: DeliverySummary["perTurn"] = [];
  const measured: TurnMetrics[] = [];
  let userIndex = 0;
  for (const t of turns) {
    if (t.role !== "user") continue;
    userIndex++;
    if (!t.metrics) continue;
    measured.push(t.metrics);
    perTurn.push({
      turn: userIndex,
      wordCount: t.metrics.wordCount,
      wordsPerMinute: t.metrics.wordsPerMinute,
      longestPauseSec: t.metrics.longestPauseSec,
      responseGapMs: t.metrics.responseGapMs,
    });
  }
  if (measured.length === 0) return null;

  const totalWords = measured.reduce((n, m) => n + m.wordCount, 0);
  // Unknown is never zero: each of these is null when no measured turn has the underlying value.
  const durations = measured.map((m) => m.durationSec).filter((v): v is number => v !== null);
  const speakingTimeSec = durations.length === 0 ? null : durations.reduce((a, b) => a + b, 0);
  // Average pace uses only turns with a positive duration: their timed words over their time.
  const paceTurns = measured.filter((m) => m.durationSec !== null && m.durationSec > 0);
  const timedWords = paceTurns.reduce((n, m) => n + m.timedWordCount, 0);
  const paceTimeSec = paceTurns.reduce((n, m) => n + (m.durationSec ?? 0), 0);
  const pauseCounts = measured.map((m) => m.pauseCount).filter((v): v is number => v !== null);
  const pauseCount = pauseCounts.length === 0 ? null : pauseCounts.reduce((a, b) => a + b, 0);
  const longest = measured.map((m) => m.longestPauseSec).filter((v): v is number => v !== null);
  const longestPauseSec = longest.length === 0 ? null : Math.max(...longest);

  const gaps = measured
    .map((m) => m.responseGapMs)
    .filter((g): g is number => g !== null)
    .sort((a, b) => a - b);
  let medianResponseGapMs: number | null = null;
  if (gaps.length > 0) {
    const mid = Math.floor(gaps.length / 2);
    medianResponseGapMs = Math.round(gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2);
  }

  const fillers = measured.map((m) => m.fillerCount).filter((c): c is number => c !== null);

  return {
    turnsMeasured: measured.length,
    totalWords,
    speakingTimeSec,
    averageWordsPerMinute:
      round(paceTimeSec, 2) < MIN_PACE_DURATION_SEC ? null : round(timedWords / (paceTimeSec / 60), 1),
    pauseCount,
    longestPauseSec,
    medianResponseGapMs,
    fillerCount: fillers.length === 0 ? null : fillers.reduce((a, b) => a + b, 0),
    perTurn,
  };
}
