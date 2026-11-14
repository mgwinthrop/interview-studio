import { describe, expect, it } from "vitest";
import { INTERVIEWER_LIMITS, inputFromDetail, parseDraftInput } from "../../app/lib/interviewerForm";
import type { InterviewerDetail, InterviewerInput } from "../../app/lib/interviewers";
import { formFromInput, inputFromForm } from "../../app/interviewers/edit/formState";

// FQ-44 slice 2 (#67): the optional display name must survive every place the editor copies
// an interviewer field by field, and a blank one must be left out (the server refuses "").

const base: InterviewerInput = {
  name: "Rehearse an interview",
  purpose: "Practise answering interview questions out loud.",
  persona: "You play a supportive interviewer.",
  style: "Short, warm questions.",
  opening: "Open warmly.",
  closing: "Close warmly.",
  phases: [{ name: "only", instruction: "Ask one question." }],
  focus: [],
  contentFeedback: true,
  deliveryFeedback: true,
};

const detail = (extra: Partial<InterviewerDetail> = {}): InterviewerDetail => ({
  ...base,
  id: "custom-1",
  source: "custom",
  version: 3,
  createdAt: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-14T00:00:00.000Z",
  ...extra,
});

describe("displayName in the editor", () => {
  it("has the backend's limit of 40", () => {
    expect(INTERVIEWER_LIMITS.displayName).toBe(40);
  });

  it("inputFromDetail keeps it, so opening and saving does not erase it", () => {
    expect(inputFromDetail(detail({ displayName: "Practice interviewer" })).displayName).toBe("Practice interviewer");
    expect("displayName" in inputFromDetail(detail())).toBe(false);
  });

  it("the form round-trips it and leaves out a blank one", () => {
    const withName = inputFromForm(formFromInput({ ...base, displayName: "Story listener" }));
    expect(withName.displayName).toBe("Story listener");
    expect("displayName" in inputFromForm(formFromInput(base))).toBe(false);
    const blank = formFromInput(base);
    expect("displayName" in inputFromForm({ ...blank, displayName: "   " })).toBe(false);
    expect(inputFromForm({ ...blank, displayName: "  Ada  " }).displayName).toBe("Ada");
  });

  it("the draft hand-off keeps it, still accepts a draft without it, and refuses a wrong type", () => {
    expect(parseDraftInput({ ...base, displayName: "Thinking partner" })?.displayName).toBe("Thinking partner");
    const without = parseDraftInput(base);
    expect(without).not.toBeNull();
    expect("displayName" in (without as InterviewerInput)).toBe(false);
    expect(parseDraftInput({ ...base, displayName: 7 })).toBeNull();
  });
});
