import { describe, expect, it } from "vitest";
import { findLeaks } from "../redaction/leakCheck";
import type { InterviewerInput } from "../interviewer/schema";

// All people and companies below are invented.
const DRAFT: InterviewerInput = {
  name: "Cautious buyer",
  purpose: "Practise a first call with a cautious buyer.",
  persona: "You are a cautious buyer.",
  style: "You ask short, pointed questions.",
  opening: "Greet the person and ask why they called.",
  closing: "Thank them and end the call.",
  phases: [
    { name: "Warm up", instruction: "Ask what they offer.", minTurns: 1, maxTurns: 2 },
    { name: "Wrap up", instruction: "Ask about next steps." },
  ],
  focus: ["How they handle price questions"],
  contentFeedback: true,
  deliveryFeedback: true,
};

describe("findLeaks", () => {
  it("finds priya in persona, case-insensitive", () => {
    const draft = { ...DRAFT, persona: "You are a cautious buyer like Priya." };
    expect(findLeaks(draft, ["priya"])).toEqual(["priya"]);
  });

  it("ignores partial words", () => {
    const draft = { ...DRAFT, persona: "You are Priyanka's colleague and a supriya fan." };
    expect(findLeaks(draft, ["priya"])).toEqual([]);
  });

  it("checks every text field", () => {
    const fields: [string, InterviewerInput][] = [
      ["name", { ...DRAFT, name: "Zorvex buyer" }],
      ["purpose", { ...DRAFT, purpose: "Practise with Zorvex." }],
      ["style", { ...DRAFT, style: "You talk like Zorvex." }],
      ["behaviours", { ...DRAFT, behaviours: "You mention Zorvex." }],
      ["opening", { ...DRAFT, opening: "Say Zorvex." }],
      ["closing", { ...DRAFT, closing: "Say Zorvex." }],
      ["phase name", { ...DRAFT, phases: [{ ...DRAFT.phases[0], name: "Zorvex" }, DRAFT.phases[1]] }],
      ["phase instruction", { ...DRAFT, phases: [DRAFT.phases[0], { name: "End", instruction: "Zorvex." }] }],
      ["focus", { ...DRAFT, focus: ["Zorvex habits"] }],
    ];
    for (const [label, draft] of fields) {
      expect(findLeaks(draft, ["Zorvex"]), label).toEqual(["Zorvex"]);
    }
    expect(findLeaks(DRAFT, ["Zorvex"])).toEqual([]);
  });

  it("matches multi-word and non-ASCII names whole, and escapes regex characters", () => {
    const draft = { ...DRAFT, persona: "You echo Émile Durand and Quillon (UK) Ltd." };
    expect(findLeaks(draft, ["émile durand", "Quillon (UK)", "Durand.*"])).toEqual(["émile durand", "Quillon (UK)"]);
    expect(findLeaks({ ...DRAFT, persona: "You like Émilea." }, ["Émile"])).toEqual([]);
  });

  it("does not flag a lowercase common word for a capitalised name part", () => {
    const draft = { ...DRAFT, behaviours: "You will push back and mark every claim on price." };
    expect(findLeaks(draft, ["Will Hart", "Will", "Hart", "Mark", "Price"])).toEqual([]);
  });

  it("flags the capitalised name part mid-sentence and in upper case", () => {
    expect(findLeaks({ ...DRAFT, behaviours: "You talk like Will does." }, ["Will"])).toEqual(["Will"]);
    expect(findLeaks({ ...DRAFT, behaviours: "You shout WILL at people." }, ["Will"])).toEqual(["Will"]);
    expect(findLeaks({ ...DRAFT, behaviours: "You will push back." }, ["Will"])).toEqual([]);
  });

  it("flags a lowercase-typed term in any case", () => {
    expect(findLeaks({ ...DRAFT, persona: "You work at Northwind." }, ["northwind"])).toEqual(["northwind"]);
    expect(findLeaks({ ...DRAFT, persona: "You work at NORTHWIND." }, ["northwind"])).toEqual(["northwind"]);
  });

  it("still flags the full name case-insensitively", () => {
    expect(findLeaks({ ...DRAFT, persona: "You sound like will hart." }, ["Will Hart"])).toEqual(["Will Hart"]);
  });

  it("flags possessive and dotted forms of a name part", () => {
    expect(findLeaks({ ...DRAFT, persona: "You quote Priya’s view." }, ["Priya"])).toEqual(["Priya"]);
    expect(findLeaks({ ...DRAFT, persona: "You quote Priya's view." }, ["Priya"])).toEqual(["Priya"]);
    expect(findLeaks({ ...DRAFT, persona: "You email Priya.Shah often." }, ["Priya Shah", "Priya", "Shah"])).toEqual([
      "Priya",
      "Shah",
    ]);
  });

  it("ignores empty strings and strings shorter than 3 characters", () => {
    const draft = { ...DRAFT, persona: "You are Al, an ox." };
    expect(findLeaks(draft, ["", "  ", "Al", "ox"])).toEqual([]);
  });
});
