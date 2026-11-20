import { describe, expect, it } from "vitest";
import { summarizeDelivery, type TurnMetrics } from "../delivery/metrics";
import { toTranscriptTurns } from "../transcriptTurns";
import type { ConversationTurn } from "../types";

// FQ-50 S0 (#151): the transcript names each answer by number. It must be the same turn the
// report's "Answer N" means, so it follows summarizeDelivery's rule.

const M: TurnMetrics = {
  wordCount: 10, timedWordCount: 10, durationSec: 4, wordsPerMinute: 150,
  pauseCount: 0, longestPauseSec: 0.2, responseGapMs: 500, fillerCount: 0,
};

const turn = (i: number, role: "user" | "assistant", content: string, metrics?: TurnMetrics | null): ConversationTurn => ({
  id: `t${i}`, sessionId: "s1", role, content, phase: "intro", timestamp: new Date(1_700_000_000_000 + i * 1000),
  ...(metrics !== undefined ? { metrics } : {}),
});

// Greeting, spoken answer, typed answer (no metrics), two interviewer turns in a row, spoken
// answer, closing turn.
const TURNS: ConversationTurn[] = [
  turn(1, "assistant", "Hello. What brings you here?"),
  turn(2, "user", "first spoken answer", M),
  turn(3, "assistant", "Tell me more."),
  turn(4, "user", "a typed answer", null),
  turn(5, "assistant", "Thanks."),
  turn(6, "assistant", "And then?"),
  turn(7, "user", "second spoken answer", M),
  turn(8, "assistant", "Thank you, that's all."),
];

describe("toTranscriptTurns", () => {
  it("numbers user turns 1, 2, 3 in order, counting typed answers, and never the interviewer's", () => {
    const out = toTranscriptTurns(TURNS);
    expect(out.map((t) => t.answer)).toEqual([undefined, 1, undefined, 2, undefined, undefined, 3, undefined]);
    expect(out.map((t) => t.content)).toEqual(TURNS.map((t) => t.content));
  });

  it("gives measured answers the same numbers as the report's Answer by answer", () => {
    const fromReport = summarizeDelivery(TURNS)!.perTurn.map((t) => t.turn);
    const measured = toTranscriptTurns(TURNS).filter((_, i) => TURNS[i].metrics);
    expect(measured.map((t) => t.answer)).toEqual(fromReport);
    expect(fromReport).toEqual([1, 3]);
  });

  it("keeps only role, content, phase and answer: no ids, timestamps or metrics", () => {
    for (const t of toTranscriptTurns(TURNS)) {
      expect(Object.keys(t).sort()).toEqual(t.role === "user" ? ["answer", "content", "phase", "role"] : ["content", "phase", "role"]);
    }
  });
});
