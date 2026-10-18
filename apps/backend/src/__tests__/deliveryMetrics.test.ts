import { describe, expect, it } from "vitest";
import {
  FILLER_WORDS,
  PAUSE_THRESHOLD_SEC,
  computeTurnMetrics,
  summarizeDelivery,
  type TurnMetrics,
} from "../delivery/metrics";

const w = (text: string, start: number, end: number) => ({ text, start, end });

/** n words, each 0.25 s long, one every `step` seconds. */
function evenWords(n: number, step = 0.3) {
  return Array.from({ length: n }, (_, i) => w(`w${i}`, i * step, i * step + 0.25));
}

function metrics(over: Partial<TurnMetrics> = {}): TurnMetrics {
  return {
    wordCount: 10,
    durationSec: 5,
    wordsPerMinute: 120,
    pauseCount: 0,
    longestPauseSec: 0,
    responseGapMs: null,
    fillerCount: 0,
    ...over,
  };
}

describe("constants", () => {
  it("exposes the pause threshold and filler list", () => {
    expect(PAUSE_THRESHOLD_SEC).toBe(0.7);
    expect([...FILLER_WORDS]).toEqual(["um", "uh", "uhm", "er", "erm", "ah", "hmm", "mm", "mmm"]);
  });
});

describe("computeTurnMetrics", () => {
  it("computes pace and duration from first start to last end", () => {
    // 20 words, step 0.3 -> first start 0, last end 19*0.3+0.25 = 5.95
    const m = computeTurnMetrics({ text: "x", words: evenWords(20) });
    expect(m.wordCount).toBe(20);
    expect(m.durationSec).toBe(5.95);
    expect(m.wordsPerMinute).toBe(201.7); // 20 / (5.95/60)
  });

  it("uses first-word-start, not zero, as the origin", () => {
    const words = [w("a", 10, 10.5), w("b", 11, 11.5), w("c", 12, 12.5), w("d", 13, 13.5), w("e", 14, 14.5)];
    const m = computeTurnMetrics({ text: "", words });
    expect(m.durationSec).toBe(4.5);
    expect(m.wordsPerMinute).toBe(66.7);
  });

  it("counts a gap of exactly 0.7 s as a pause and 0.69 s as not", () => {
    const at = computeTurnMetrics({ text: "", words: [w("a", 0, 1), w("b", 1.7, 2)] });
    expect(at.pauseCount).toBe(1);
    expect(at.longestPauseSec).toBe(0.7);
    const below = computeTurnMetrics({ text: "", words: [w("a", 0, 1), w("b", 1.69, 2)] });
    expect(below.pauseCount).toBe(0);
    expect(below.longestPauseSec).toBe(0.69);
  });

  it("counts float-error gaps just under 0.7 and rejects 0.69", () => {
    const gap = 2.3 - 1.6;
    expect(gap).toBeLessThan(0.7);
    const under = computeTurnMetrics({ text: "", words: [w("a", 0, 1.6), w("b", 2.3, 3)] });
    expect(under.pauseCount).toBe(1);
    const no = computeTurnMetrics({ text: "", words: [w("a", 0, 1.6), w("b", 2.29, 3)] });
    expect(no.pauseCount).toBe(0);
  });

  it("reports the longest pause", () => {
    const words = [w("a", 0, 1), w("b", 2, 2.5), w("c", 4.25, 5), w("d", 5.1, 5.5)];
    const m = computeTurnMetrics({ text: "", words });
    expect(m.pauseCount).toBe(2);
    expect(m.longestPauseSec).toBe(1.75);
  });

  it("returns null pace under 2 s or under 5 words", () => {
    const short = computeTurnMetrics({ text: "", words: evenWords(5, 0.2) }); // 1.05 s
    expect(short.durationSec).toBe(1.05);
    expect(short.wordsPerMinute).toBeNull();
    const few = computeTurnMetrics({ text: "", words: [w("a", 0, 1), w("b", 2, 3), w("c", 4, 5), w("d", 6, 7)] });
    expect(few.durationSec).toBe(7);
    expect(few.wordsPerMinute).toBeNull();
  });

  it("counts fillers case-insensitively, ignoring punctuation, whole token only", () => {
    const words = ["Um,", "UH", "so", "(hmm)", "umbrella", "errand", "Mmm...", "ah!", "okay"].map((t, i) =>
      w(t, i, i + 0.5),
    );
    const m = computeTurnMetrics({ text: "", words });
    expect(m.fillerCount).toBe(5);
    expect(m.wordCount).toBe(9);
  });

  it("handles one word: timing is unknown, counts are known", () => {
    const m = computeTurnMetrics({ text: "hi", words: [w("hi", 1, 1.4)] });
    expect(m.wordCount).toBe(1);
    expect(m.durationSec).toBeNull();
    expect(m.wordsPerMinute).toBeNull();
    expect(m.pauseCount).toBeNull();
    expect(m.longestPauseSec).toBeNull();
    expect(m.fillerCount).toBe(0);
  });

  it("returns null timing when only one of many words has finite timestamps", () => {
    const words = [w("w0", 0, 2.5), ...Array.from({ length: 19 }, (_, i) => w(`x${i}`, NaN, NaN))];
    const m = computeTurnMetrics({ text: "", words });
    expect(m.wordCount).toBe(20);
    expect(m.durationSec).toBeNull();
    expect(m.wordsPerMinute).toBeNull();
    expect(m.pauseCount).toBeNull();
    expect(m.longestPauseSec).toBeNull();
    expect(m.fillerCount).toBe(0);
  });

  it("computes pace from timed words only when some timestamps are non-finite", () => {
    const timedWords = Array.from({ length: 6 }, (_, i) => w(`t${i}`, i * 2, i * 2 + 1)); // span 0..11
    const untimed = Array.from({ length: 14 }, (_, i) => w(`u${i}`, NaN, NaN));
    const m = computeTurnMetrics({ text: "", words: [...timedWords, ...untimed] });
    expect(m.wordCount).toBe(20);
    expect(m.durationSec).toBe(11);
    expect(m.wordsPerMinute).toBe(32.7); // 6 / (11/60), not 20 / (11/60)
  });

  it("pace threshold at 2.0 s is robust to float error", () => {
    const span = 2.3 - 0.3; // 1.9999999999999998
    expect(span).toBeLessThan(2);
    const five = (end: number) => [w("a", 0, 0.1), w("b", 0.2, 0.3), w("c", 0.4, 0.5), w("d", 0.6, 0.7), w("e", 0.8, end)];
    expect(computeTurnMetrics({ text: "", words: five(span) }).wordsPerMinute).toBe(150);
    expect(computeTurnMetrics({ text: "", words: five(1.99) }).wordsPerMinute).toBeNull();
    const four = five(2).slice(0, 3).concat(w("d", 0.6, 2));
    expect(four).toHaveLength(4);
    expect(computeTurnMetrics({ text: "", words: four }).wordsPerMinute).toBeNull();
  });

  it("pins filler tokenisation: hyphenated forms are not fillers (intentional for now)", () => {
    const m = (t: string) => computeTurnMetrics({ text: "", words: [w(t, 0, 0.5)] }).fillerCount;
    expect(m("um-hm")).toBe(0);
    expect(m("mm-hmm")).toBe(0);
    expect(m("don't")).toBe(0);
    expect(m("hmm,")).toBe(1);
  });

  it("handles equal timestamps without NaN or negatives", () => {
    const m = computeTurnMetrics({ text: "", words: [w("a", 1, 1), w("b", 1, 1), w("c", 1, 1)] });
    expect(m.durationSec).toBe(0);
    expect(m.wordsPerMinute).toBeNull();
    expect(m.pauseCount).toBe(0);
    expect(m.longestPauseSec).toBe(0);
  });

  it("sorts out-of-order words by start and clamps negative gaps to 0", () => {
    const words = [w("c", 3, 3.5), w("a", 0, 1), w("b", 0.5, 2.5)]; // b overlaps a; c follows b by 0.5
    const m = computeTurnMetrics({ text: "", words });
    expect(m.pauseCount).toBe(0);
    expect(m.longestPauseSec).toBe(0.5);
    expect(m.durationSec).toBe(3.5);
  });

  it("handles words with end before start", () => {
    const words = [w("a", 2, 1), w("b", 3, 3.2)];
    const m = computeTurnMetrics({ text: "", words });
    expect(m.longestPauseSec).toBe(1); // a treated as ending at its start (2)
    expect(m.pauseCount).toBe(1);
    expect(m.durationSec).toBe(1.2);
  });

  it("does not mutate the input array", () => {
    const words = [w("b", 2, 3), w("a", 0, 1)];
    computeTurnMetrics({ text: "", words });
    expect(words.map((x) => x.text)).toEqual(["b", "a"]);
  });

  it("handles a 10-minute utterance", () => {
    const words = evenWords(1500, 0.4); // last end 599.6+0.25
    const m = computeTurnMetrics({ text: "", words });
    expect(m.wordCount).toBe(1500);
    expect(m.durationSec).toBe(599.85);
    expect(m.wordsPerMinute).toBe(150.0);
    expect(m.pauseCount).toBe(0);
  });

  it("ignores words with non-finite timestamps for timing only", () => {
    const m = computeTurnMetrics({ text: "", words: [w("a", NaN, 1), w("b", 0, Infinity)] });
    expect(m.wordCount).toBe(2);
    expect(m.durationSec).toBeNull();
    expect(m.pauseCount).toBeNull();
    expect(m.fillerCount).toBe(0);
  });

  it("passes responseGapMs through only when finite and in [0, 600000]", () => {
    const run = (g: number | null | undefined) =>
      computeTurnMetrics({ text: "a", words: [], responseGapMs: g }).responseGapMs;
    expect(run(0)).toBe(0);
    expect(run(1234)).toBe(1234);
    expect(run(600000)).toBe(600000);
    expect(run(-1)).toBeNull();
    expect(run(NaN)).toBeNull();
    expect(run(Infinity)).toBeNull();
    expect(run(700000)).toBeNull();
    expect(run(null)).toBeNull();
    expect(run(undefined)).toBeNull();
  });

  it("falls back to splitting text when there are no words", () => {
    const m = computeTurnMetrics({ text: "  hello   there\nfriend ", words: [] });
    expect(m).toEqual({
      wordCount: 3,
      durationSec: null,
      wordsPerMinute: null,
      pauseCount: null,
      longestPauseSec: null,
      responseGapMs: null,
      fillerCount: null,
    });
    expect(computeTurnMetrics({ text: "   ", words: [] }).wordCount).toBe(0);
  });
});

describe("summarizeDelivery", () => {
  it("returns null when no user turn has metrics", () => {
    expect(summarizeDelivery([])).toBeNull();
    expect(
      summarizeDelivery([
        { role: "assistant", metrics: metrics() },
        { role: "user" },
        { role: "user", metrics: null },
      ]),
    ).toBeNull();
  });

  it("ignores assistant turns and numbers turns by user index including unmeasured", () => {
    const s = summarizeDelivery([
      { role: "assistant", metrics: metrics({ wordCount: 999 }) },
      { role: "user", metrics: null },
      { role: "assistant" },
      {
        role: "user",
        metrics: metrics({
          wordCount: 20,
          durationSec: 10,
          wordsPerMinute: 120,
          longestPauseSec: 1.5,
          pauseCount: 2,
          responseGapMs: 800,
          fillerCount: 1,
        }),
      },
    ])!;
    expect(s.turnsMeasured).toBe(1);
    expect(s.totalWords).toBe(20);
    expect(s.perTurn).toEqual([
      { turn: 2, wordCount: 20, wordsPerMinute: 120, longestPauseSec: 1.5, responseGapMs: 800 },
    ]);
  });

  it("computes average pace from totals, not a mean of means", () => {
    const s = summarizeDelivery([
      { role: "user", metrics: metrics({ wordCount: 10, durationSec: 2, wordsPerMinute: 300 }) },
      { role: "user", metrics: metrics({ wordCount: 90, durationSec: 60, wordsPerMinute: 90 }) },
    ])!;
    expect(s.speakingTimeSec).toBe(62);
    expect(s.averageWordsPerMinute).toBe(96.8); // 100 / (62/60); mean of means would be 195
  });

  it("average pace ignores words from untimed turns", () => {
    const s = summarizeDelivery([
      { role: "user", metrics: metrics({ wordCount: 10, durationSec: 5, wordsPerMinute: 120 }) },
      { role: "user", metrics: metrics({ wordCount: 50, durationSec: null, wordsPerMinute: null }) },
    ])!;
    expect(s.totalWords).toBe(60);
    expect(s.averageWordsPerMinute).toBe(120); // 10 / (5/60)
  });

  it("average pace threshold at exactly 2.0 s total is float-robust", () => {
    const at = summarizeDelivery([
      { role: "user", metrics: metrics({ wordCount: 2, durationSec: 0.7 }) },
      { role: "user", metrics: metrics({ wordCount: 1, durationSec: 0.6 }) },
      { role: "user", metrics: metrics({ wordCount: 2, durationSec: 0.7 }) },
    ])!;
    expect(at.speakingTimeSec).toBeLessThan(2); // 1.9999999999999998
    expect(at.averageWordsPerMinute).toBe(150);
    const below = summarizeDelivery([{ role: "user", metrics: metrics({ wordCount: 5, durationSec: 1.99 }) }])!;
    expect(below.averageWordsPerMinute).toBeNull();
  });

  it("returns null average pace under 2 s total speaking time", () => {
    const s = summarizeDelivery([
      { role: "user", metrics: metrics({ wordCount: 3, durationSec: 1.5, wordsPerMinute: null }) },
    ])!;
    expect(s.averageWordsPerMinute).toBeNull();
    const none = summarizeDelivery([
      { role: "user", metrics: metrics({ wordCount: 3, durationSec: null, wordsPerMinute: null }) },
    ])!;
    expect(none.speakingTimeSec).toBe(0);
    expect(none.averageWordsPerMinute).toBeNull();
  });

  it("sums pauses, takes max longest pause, and skips nulls", () => {
    const s = summarizeDelivery([
      { role: "user", metrics: metrics({ pauseCount: 2, longestPauseSec: 1.2 }) },
      { role: "user", metrics: metrics({ pauseCount: null, longestPauseSec: null }) },
      { role: "user", metrics: metrics({ pauseCount: 3, longestPauseSec: 2.4 }) },
    ])!;
    expect(s.pauseCount).toBe(5);
    expect(s.longestPauseSec).toBe(2.4);
    const empty = summarizeDelivery([
      { role: "user", metrics: metrics({ pauseCount: null, longestPauseSec: null }) },
    ])!;
    expect(empty.pauseCount).toBe(0);
    expect(empty.longestPauseSec).toBe(0);
  });

  it("computes median response gap for odd and even counts", () => {
    const gaps = (xs: (number | null)[]) =>
      summarizeDelivery(xs.map((g) => ({ role: "user" as const, metrics: metrics({ responseGapMs: g }) })))!
        .medianResponseGapMs;
    expect(gaps([900, 100, 500])).toBe(500);
    expect(gaps([100, 200, null, 400, 1000])).toBe(300);
    expect(gaps([100, 201])).toBe(151); // 150.5 rounds up
    expect(gaps([null, null])).toBeNull();
  });

  it("sums fillers, null only when every count is unknown", () => {
    const f = (xs: (number | null)[]) =>
      summarizeDelivery(xs.map((c) => ({ role: "user" as const, metrics: metrics({ fillerCount: c }) })))!
        .fillerCount;
    expect(f([2, null, 3])).toBe(5);
    expect(f([0, null])).toBe(0);
    expect(f([null, null])).toBeNull();
  });
});
