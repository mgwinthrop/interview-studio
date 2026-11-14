import { describe, expect, it } from "vitest";
import { PRESET_TIMESTAMP } from "../interviewer/presets/timestamps";
import {
  INTERVIEWER_LIMITS,
  parseInterviewerDefinition,
  parseInterviewerInput,
  type InterviewerInput,
} from "../interviewer/schema";

// FQ-44 slice 1 (#66): the optional per-interviewer display name ("who you talk to"),
// separate from `name` (the activity). Stored inside the existing definition JSON.

function input(extra: Record<string, unknown> = {}): Record<string, unknown> {
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
  return { ...base, ...extra };
}

function definition(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...input(extra),
    id: "custom-1",
    source: "custom",
    ownerId: "local",
    version: 1,
    createdAt: PRESET_TIMESTAMP,
    updatedAt: PRESET_TIMESTAMP,
  };
}

describe("displayName", () => {
  it("has a limit of 40 characters", () => {
    expect(INTERVIEWER_LIMITS.displayName).toBe(40);
  });

  it("is optional: an input and a stored definition without it still parse, with no key added", () => {
    const parsed = parseInterviewerInput(input());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect("displayName" in parsed.value).toBe(false);
    expect("displayName" in parseInterviewerDefinition(definition())).toBe(false);
  });

  it("is kept, trimmed, on an input and on a stored definition", () => {
    const parsed = parseInterviewerInput(input({ displayName: "  Practice interviewer " }));
    expect(parsed).toEqual({ ok: true, value: expect.objectContaining({ displayName: "Practice interviewer" }) });
    expect(parseInterviewerDefinition(definition({ displayName: "Ada" })).displayName).toBe("Ada");
  });

  it("accepts 40 characters and rejects 41 at its own path", () => {
    expect(parseInterviewerInput(input({ displayName: "x".repeat(40) })).ok).toBe(true);
    expect(parseInterviewerInput(input({ displayName: "x".repeat(41) }))).toEqual({
      ok: false,
      errors: [{ path: "displayName", message: "Must be at most 40 characters." }],
    });
  });

  it("rejects an empty or blank value, a non-string and control characters (clients omit a blank name)", () => {
    for (const bad of ["", "   ", 7, "Ada\tLovelace"]) {
      const r = parseInterviewerInput(input({ displayName: bad }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.map((e) => e.path)).toEqual(["displayName"]);
    }
  });
});
