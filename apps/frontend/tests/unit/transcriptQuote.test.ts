import { describe, expect, it } from "vitest";
import { matchQuote, type TranscriptTurn } from "../../app/lib/transcript";

// FQ-50 S2 (#153): a strength quote links to its answer only when its words appear, in order
// and as whole words, in exactly one answer. Anything else gives no link: never the wrong one.

const ai = (content: string): TranscriptTurn => ({ role: "assistant", content, phase: "intro" });
const you = (answer: number, content: string): TranscriptTurn => ({ role: "user", content, phase: "intro", answer });

const TURNS: TranscriptTurn[] = [
  ai("What would you like to talk about?"),
  you(1, "Yesterday I ran the planning meeting for the first time."),
  ai("How did it go?"),
  you(2, "I'd start by asking who the customer is — that's always step one."),
  ai("And the team?"),
  you(3, "We kept a shared list of review checks."),
  you(4, "Honestly, we kept a shared list, and it helped."),
];

describe("matchQuote", () => {
  it("links an exact quote to its answer", () => {
    expect(matchQuote("I'd start by asking who the customer is", TURNS)).toBe(2);
  });

  it("ignores case and punctuation", () => {
    expect(matchQuote("i'd START by asking, who the customer is!", TURNS)).toBe(2);
  });

  it("treats curly quotes and apostrophes like plain ones", () => {
    expect(matchQuote("“I’d start by asking who the customer is”", TURNS)).toBe(2);
    expect(matchQuote("that’s always step one", TURNS)).toBe(2);
  });

  it("matches whole words only: 'yes' is not inside 'yesterday'", () => {
    expect(matchQuote("yes I ran the planning meeting", TURNS)).toBeNull();
    expect(matchQuote("yesterday I ran the planning meeting", TURNS)).toBe(1);
  });

  it("gives null when two answers contain the quote", () => {
    expect(matchQuote("we kept a shared list", TURNS)).toBeNull();
  });

  it("gives null when no answer contains it, including the interviewer's words", () => {
    expect(matchQuote("something nobody said", TURNS)).toBeNull();
    expect(matchQuote("how did it go", TURNS)).toBeNull();
  });

  it("gives null for a quote of fewer than 2 words", () => {
    expect(matchQuote("Yesterday", TURNS)).toBeNull();
    expect(matchQuote("  “!” ", TURNS)).toBeNull();
  });
});
