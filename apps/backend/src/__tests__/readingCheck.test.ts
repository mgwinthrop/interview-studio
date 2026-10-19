import { describe, expect, it } from "vitest";
import type { DeliverySummary } from "../delivery/metrics";
import { readingQuotesOnlySuppliedNumbers } from "../delivery/readingCheck";

/** A realistic summary: 4 answers, 3 measured (answer 3 was typed), filler count hidden. */
const summary: DeliverySummary = {
  turnsMeasured: 3,
  totalWords: 87,
  speakingTimeSec: 45.2,
  averageWordsPerMinute: 142.3,
  pauseCount: 6,
  longestPauseSec: 1.84,
  medianResponseGapMs: 1200,
  fillerCount: null,
  perTurn: [
    { turn: 1, wordCount: 31, wordsPerMinute: 139.5, longestPauseSec: 0.92, responseGapMs: 900 },
    { turn: 2, wordCount: 24, wordsPerMinute: 146.1, longestPauseSec: 1.84, responseGapMs: 1200 },
    { turn: 4, wordCount: 32, wordsPerMinute: 141.0, longestPauseSec: 1.1, responseGapMs: 1500 },
  ],
};
const counts = { answers: 4, measured: 3 };
const check = (reading: string, s: DeliverySummary = summary) =>
  readingQuotesOnlySuppliedNumbers(reading, s, counts);

describe("readingQuotesOnlySuppliedNumbers", () => {
  it.each([
    ["the summary pace as given", "You spoke at about 142.3 words per minute."],
    ["pace rounded to an integer", "You spoke at 142 words per minute."],
    ["pace abbreviated", "Your pace was about 142 wpm."],
    ["a per-turn pace", "Your second answer was the quickest, at 146.1 words per minute."],
    ["milliseconds as seconds", "There was a median gap of 1.2 seconds before you answered."],
    ["milliseconds as given", "The median gap was 1200 ms."],
    ["milliseconds with a thousands separator", "The median gap was 1,200 milliseconds."],
    ["seconds as given", "Your longest pause was 1.84 seconds."],
    ["seconds rounded", "Your longest pause was 1.8 seconds."],
    ["seconds with a decimal comma", "Your longest pause was 1,84 seconds."],
    ["seconds abbreviated", "Your longest pause was about 1.8s."],
    ["the pause threshold", "The summary counts pauses of 0.7 seconds or longer."],
    ["the pause threshold hyphenated", "There were 6 pauses of 0.7-second length or more."],
    ["answer counts", "3 of your 4 answers were spoken and measured."],
    ["a turn number", "In answer 2 you paused longest."],
    ["speaking time rounded", "You had about 45 seconds of speech in all."],
    ["speaking time in minutes", "You spoke for about 0.75 minutes in all."],
    ["word counts", "You used 87 words across 3 answers; answer 4 had 32 words."],
    ["no digits at all", "You kept a steady pace and took time to think before answering."],
  ])("accepts %s", (_label, reading) => {
    expect(check(reading)).toBe(true);
  });

  it.each([
    ["an invented pace", "You spoke at 150 words per minute."],
    ["an invented pause length", "There was a pause of 3 seconds in your second answer."],
    ["a percentage", "You were 30% faster in your last answer."],
    ["a percentage in words", "You were 30 percent faster in your last answer."],
    ["an invented duration in minutes", "You spoke for about 2 minutes."],
    ["a number embedded in a quote", 'You said "I spent 18 months on it" without a pause.'],
    ["milliseconds read as seconds", "The median gap was 1200 seconds."],
    ["one invented number among valid ones", "At 142 words per minute and 7 pauses, you were steady."],
  ])("rejects %s", (_label, reading) => {
    expect(check(reading)).toBe(false);
  });

  it("does not check number words (a documented limit)", () => {
    // Only digits are checked: "fifty" is not in the summary, but it is not detected.
    expect(check("You gave three answers and paused fifty times.")).toBe(true);
  });

  it("skips null summary fields", () => {
    const noPace: DeliverySummary = {
      ...summary,
      averageWordsPerMinute: null,
      perTurn: summary.perTurn.map((t) => ({ ...t, wordsPerMinute: null })),
    };
    expect(check("You spoke at 142 words per minute.", noPace)).toBe(false);
  });

  it("rejects a hidden filler count and accepts a shown one", () => {
    expect(check("You used 5 filler words.")).toBe(false);
    expect(check("You used 5 filler words.", { ...summary, fillerCount: 5 })).toBe(true);
  });
});
