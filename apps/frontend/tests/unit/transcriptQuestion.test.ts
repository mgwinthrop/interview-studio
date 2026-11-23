import { describe, expect, it } from "vitest";
import { questionFor, type TranscriptTurn } from "../../app/lib/transcript";

// FQ-50 S1 (#152): the question shown on each "Answer N" card is the interviewer's turns
// between answer N-1 and answer N. An interrupted reply is never stored, so after a barge-in
// two answers sit back to back and the second has no question (null), never a wrong one.

const ai = (content: string): TranscriptTurn => ({ role: "assistant", content, phase: "intro" });
const you = (answer: number, content = `answer ${answer}`): TranscriptTurn => ({ role: "user", content, phase: "intro", answer });

const TURNS: TranscriptTurn[] = [
  ai("Hello, I'm glad you're here."),
  ai("What would you like to talk about?"),
  you(1),
  ai("Tell me more about that."),
  you(2),
  you(3), // spoke during the interviewer's reply: that reply was not stored
  ai("Thank you, that's all for today."),
];

describe("questionFor", () => {
  it("joins a greeting and the question before the first answer", () => {
    expect(questionFor(TURNS, 1)).toBe("Hello, I'm glad you're here.\n\nWhat would you like to talk about?");
  });

  it("gives the interviewer's turn between the previous answer and this one", () => {
    expect(questionFor(TURNS, 2)).toBe("Tell me more about that.");
  });

  it("gives null when no interviewer turn comes before the answer", () => {
    expect(questionFor(TURNS, 3)).toBeNull();
    expect(questionFor([you(1)], 1)).toBeNull();
  });

  it("never attaches the closing turn, and gives null for an answer that does not exist", () => {
    expect(questionFor(TURNS, 4)).toBeNull();
    expect(questionFor([], 1)).toBeNull();
  });
});
