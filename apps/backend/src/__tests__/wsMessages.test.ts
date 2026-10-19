import { describe, expect, it } from "vitest";
import { DESIGNER_ID } from "../interviewer/presets";
import { INTERVIEWER_LIMITS, type InterviewerInput } from "../interviewer/schema";
import {
  INVALID_DRAFT,
  UNKNOWN_INTERVIEWER,
  parseMessage,
  safeType,
  startTargetOf,
  toBuffer,
  trialInterviewer,
  type ClientMessage,
} from "../wsMessages";

function draft(): InterviewerInput {
  return {
    name: "Trial name",
    purpose: "Trial purpose.",
    persona: "You are a patient listener.",
    style: "Trial style.",
    opening: "Trial opening.",
    closing: "Trial closing.",
    phases: [
      { name: "one", instruction: "First.", minTurns: 1, maxTurns: 3 },
      { name: "two", instruction: "Last." },
    ],
    focus: ["Trial focus"],
    contentFeedback: true,
    deliveryFeedback: false,
  };
}

const start = (extra: Record<string, unknown>): ClientMessage => ({ type: "session_start", ...extra });

describe("startTargetOf", () => {
  it("returns a stored target for a well-formed interviewerId", () => {
    expect(startTargetOf(start({ interviewerId: "tell-a-story" }))).toEqual({
      kind: "stored",
      interviewerId: "tell-a-story",
    });
  });

  it("returns the designer target for the designer id", () => {
    expect(startTargetOf(start({ interviewerId: DESIGNER_ID }))).toEqual({ kind: "designer" });
  });

  it("returns a trial target with the parsed draft", () => {
    const target = startTargetOf(start({ draft: draft() }));
    expect(target).toEqual({ kind: "trial", draft: draft() });
  });

  it("rejects a draft sent with an interviewerId as an invalid draft", () => {
    expect(startTargetOf(start({ interviewerId: "tell-a-story", draft: draft() }))).toEqual({
      reject: INVALID_DRAFT,
    });
  });

  it("rejects a message with neither key as an unknown interviewer", () => {
    expect(startTargetOf(start({}))).toEqual({ reject: UNKNOWN_INTERVIEWER });
  });

  it.each([
    ["malformed", "bad id!"],
    ["empty", ""],
    ["too long", "a".repeat(65)],
    ["a number", 42],
    ["null", null],
  ])("rejects a %s interviewerId as an unknown interviewer", (_label, interviewerId) => {
    expect(startTargetOf(start({ interviewerId }))).toEqual({ reject: UNKNOWN_INTERVIEWER });
  });

  it.each([
    ["an array", [draft()]],
    ["null", null],
    ["a string", "draft"],
    ["undefined", undefined],
    ["oversized", { ...draft(), persona: "x".repeat(INTERVIEWER_LIMITS.persona + 1) }],
    ["with unknown keys", { ...draft(), extra: true }],
    ["with both feedback switches off", { ...draft(), contentFeedback: false, deliveryFeedback: false }],
  ])("rejects a draft that is %s as an invalid draft", (_label, value) => {
    expect(startTargetOf(start({ draft: value }))).toEqual({ reject: INVALID_DRAFT });
  });

  it("ignores unknown top-level keys next to an interviewerId", () => {
    expect(startTargetOf(start({ interviewerId: "tell-a-story", demo: true, other: 1 }))).toEqual({
      kind: "stored",
      interviewerId: "tell-a-story",
    });
  });
});

describe("parseMessage", () => {
  const parse = (text: string) => parseMessage(Buffer.from(text, "utf8"));

  it("parses an object with a string type", () => {
    expect(parse('{"type":"interrupt","x":1}')).toEqual({ type: "interrupt", x: 1 });
  });

  it.each([
    ["non-JSON", "not json"],
    ["a JSON string", '"session_start"'],
    ["a JSON number", "3"],
    ["null", "null"],
    ["an array", '[{"type":"session_start"}]'],
    ["an object without type", '{"interviewerId":"x"}'],
    ["an object with a non-string type", '{"type":1}'],
  ])("returns null for %s", (_label, text) => {
    expect(parse(text)).toBeNull();
  });
});

describe("safeType", () => {
  it.each(["session_start", "session_end", "interrupt", "text_input", "turn_timing"])("names %s", (t) => {
    expect(safeType(t)).toBe(t);
  });

  it.each([["tts_chunk"], ["other"], [""], [1], [null], [undefined], [{}]])("logs %j as unknown", (t) => {
    expect(safeType(t)).toBe("unknown");
  });
});

describe("toBuffer", () => {
  it("returns a buffer as is, concatenates a list and wraps an ArrayBuffer", () => {
    const b = Buffer.from("ab");
    expect(toBuffer(b)).toBe(b);
    expect(toBuffer([Buffer.from("a"), Buffer.from("b")]).toString()).toBe("ab");
    expect(toBuffer(new Uint8Array([97, 98]).buffer).toString()).toBe("ab");
  });
});

describe("trialInterviewer", () => {
  it("makes an in-memory custom interviewer owned by the caller", () => {
    const def = trialInterviewer(draft(), "owner-1");
    expect(def).toMatchObject({ ...draft(), id: "draft", source: "custom", ownerId: "owner-1", version: 1 });
    expect(def.createdAt).toBe(def.updatedAt);
    expect(Number.isNaN(Date.parse(def.createdAt))).toBe(false);
  });

  it("adds no voice when the draft has none", () => {
    expect(trialInterviewer(draft(), "owner-1")).not.toHaveProperty("voice");
  });
});
