// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RETURN_TO,
  INTERVIEWER_LIMITS,
  clearDraft,
  clearDraftFor,
  editPathFor,
  emptyInput,
  errorsByPath,
  inputFromDetail,
  isSameSitePath,
  parseDraftInput,
  peekDraft,
  storeDraft,
} from "../../app/lib/interviewerForm";
import type { InterviewerDetail } from "../../app/lib/interviewers";

const KEY = "interviewer_draft";

function validDraft() {
  return {
    ...emptyInput(),
    name: "Maya",
    purpose: "Practise a pitch",
    persona: "Warm and curious",
    style: "Short questions",
    opening: "Hi, I'm Maya.",
    closing: "Thanks for talking.",
    focus: ["clarity"],
  };
}

describe("emptyInput", () => {
  it("is a blank form with both feedback switches on and two phases", () => {
    const e = emptyInput();
    expect(e.contentFeedback).toBe(true);
    expect(e.deliveryFeedback).toBe(true);
    expect(e.phases).toHaveLength(2);
    expect(e.phases[0]).toMatchObject({ minTurns: 1, maxTurns: 3 });
    expect(e.phases[1].minTurns).toBeUndefined();
  });

  it("returns a fresh object each call", () => {
    expect(emptyInput()).not.toBe(emptyInput());
    expect(emptyInput().phases).not.toBe(emptyInput().phases);
  });
});

describe("inputFromDetail", () => {
  const detail: InterviewerDetail = {
    ...validDraft(),
    id: "abc",
    source: "custom",
    version: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    behaviours: "Never interrupt",
    voice: { cloud: "abcdefghij12" },
  };

  it("copies only the editable fields", () => {
    const input = inputFromDetail(detail) as unknown as Record<string, unknown>;
    expect(input.id).toBeUndefined();
    expect(input.version).toBeUndefined();
    expect(input.createdAt).toBeUndefined();
    expect(input.name).toBe("Maya");
    expect(input.behaviours).toBe("Never interrupt");
  });

  it("does not let edits leak back into the loaded record", () => {
    const input = inputFromDetail(detail);
    input.phases[0].instruction = "changed";
    input.focus.push("more");
    input.voice!.cloud = "zzzzzzzzzz99";
    expect(detail.phases[0].instruction).toBe("");
    expect(detail.focus).toEqual(["clarity"]);
    expect(detail.voice!.cloud).toBe("abcdefghij12");
  });

  it("leaves out optional fields that are not set", () => {
    const bare: InterviewerDetail = { ...detail };
    delete bare.behaviours;
    delete bare.voice;
    const input = inputFromDetail(bare);
    expect("behaviours" in input).toBe(false);
    expect("voice" in input).toBe(false);
  });
});

describe("errorsByPath and editPathFor", () => {
  it("keeps the first error for each path", () => {
    expect(
      errorsByPath([
        { path: "name", message: "first" },
        { path: "name", message: "second" },
        { path: "phases.0.name", message: "other" },
      ]),
    ).toEqual({ name: "first", "phases.0.name": "other" });
  });

  it("encodes the id in the editor path", () => {
    expect(editPathFor("a b&c")).toBe("/interviewers/edit?id=a%20b%26c");
  });
});

describe("isSameSitePath", () => {
  it.each(["/", "/interviewers/edit?id=1", "/session?interviewerId=x"])("accepts %s", (v) => {
    expect(isSameSitePath(v)).toBe(true);
  });

  it.each([
    ["protocol-relative", "//evil.example"],
    ["absolute http", "http://evil.example"],
    ["javascript url", "javascript:alert(1)"],
    ["backslash", "/\\evil.example"],
    ["tab", "/\t/evil.example"],
    ["carriage return", "/a\rb"],
    ["DEL character", "/a\u007fb"],
    ["relative", "interviewers"],
    ["too long", "/" + "a".repeat(200)],
    ["number", 5],
  ])("refuses %s", (_l, v) => {
    expect(isSameSitePath(v)).toBe(false);
  });
});

describe("parseDraftInput (untrusted drafts)", () => {
  it("accepts a well-formed draft and drops unknown keys", () => {
    const parsed = parseDraftInput({ ...validDraft(), isAdmin: true, ownerId: "x" });
    expect(parsed).not.toBeNull();
    expect(parsed as unknown as Record<string, unknown>).not.toHaveProperty("isAdmin");
    expect(parsed as unknown as Record<string, unknown>).not.toHaveProperty("ownerId");
    expect(parsed!.name).toBe("Maya");
  });

  it.each([
    ["null", null],
    ["array", []],
    ["string", "x"],
  ])("rejects %s", (_l, v) => {
    expect(parseDraftInput(v)).toBeNull();
  });

  it("rejects non-boolean feedback switches", () => {
    expect(parseDraftInput({ ...validDraft(), contentFeedback: "yes" })).toBeNull();
    expect(parseDraftInput({ ...validDraft(), deliveryFeedback: undefined })).toBeNull();
  });

  it("rejects text more than twice the limit (the server enforces the real limit)", () => {
    const tooBig = "a".repeat(INTERVIEWER_LIMITS.name * 2 + 1);
    expect(parseDraftInput({ ...validDraft(), name: tooBig })).toBeNull();
    const ok = "a".repeat(INTERVIEWER_LIMITS.name * 2);
    expect(parseDraftInput({ ...validDraft(), name: ok })).not.toBeNull();
  });

  it("rejects non-string text fields", () => {
    expect(parseDraftInput({ ...validDraft(), persona: 7 })).toBeNull();
    expect(parseDraftInput({ ...validDraft(), behaviours: 7 })).toBeNull();
  });

  it("caps phases and focus items", () => {
    const phase = { name: "p", instruction: "i" };
    expect(parseDraftInput({ ...validDraft(), phases: Array(16).fill(phase) })).not.toBeNull();
    expect(parseDraftInput({ ...validDraft(), phases: Array(17).fill(phase) })).toBeNull();
    expect(parseDraftInput({ ...validDraft(), focus: Array(12).fill("f") })).not.toBeNull();
    expect(parseDraftInput({ ...validDraft(), focus: Array(13).fill("f") })).toBeNull();
  });

  it("rejects bad turn counts", () => {
    const withTurns = (minTurns: unknown) => ({
      ...validDraft(),
      phases: [{ name: "p", instruction: "i", minTurns }],
    });
    expect(parseDraftInput(withTurns(2))).not.toBeNull();
    expect(parseDraftInput(withTurns(1.5))).toBeNull();
    expect(parseDraftInput(withTurns("2"))).toBeNull();
    expect(parseDraftInput(withTurns(1001))).toBeNull();
    expect(parseDraftInput(withTurns(null))).toBeNull();
  });

  it("checks the voice field", () => {
    expect(parseDraftInput({ ...validDraft(), voice: {} })!.voice).toEqual({});
    expect(parseDraftInput({ ...validDraft(), voice: { cloud: "abcdefghij12" } })!.voice).toEqual({ cloud: "abcdefghij12" });
    expect(parseDraftInput({ ...validDraft(), voice: "x" })).toBeNull();
    expect(parseDraftInput({ ...validDraft(), voice: { cloud: 5 } })).toBeNull();
    expect(parseDraftInput({ ...validDraft(), voice: { cloud: "a".repeat(81) } })).toBeNull();
  });
});

describe("draft hand-off through sessionStorage", () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("round-trips a draft and peek leaves it in place", () => {
    expect(storeDraft(validDraft(), "/interviewers/edit?id=1", 4)).toBe(true);
    const first = peekDraft();
    expect(first).toMatchObject({ returnTo: "/interviewers/edit?id=1", baseVersion: 4 });
    expect(first!.input.name).toBe("Maya");
    expect(peekDraft()).not.toBeNull();
  });

  it("falls back to the default return path for an unsafe one", () => {
    storeDraft(validDraft(), "https://evil.example/");
    expect(peekDraft()!.returnTo).toBe(DEFAULT_RETURN_TO);
    storeDraft(validDraft(), "//evil.example");
    expect(peekDraft()!.returnTo).toBe(DEFAULT_RETURN_TO);
  });

  it("drops a base version that is not a positive whole number", () => {
    storeDraft(validDraft(), undefined, 0);
    expect(peekDraft()!.baseVersion).toBeUndefined();
    storeDraft(validDraft(), undefined, 1.5);
    expect(peekDraft()!.baseVersion).toBeUndefined();
  });

  it("does not trust a tampered base version already in storage", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ input: validDraft(), returnTo: "/x", baseVersion: -3 }));
    expect(peekDraft()!.baseVersion).toBeUndefined();
  });

  it("treats corrupt JSON as no draft and removes it", () => {
    window.sessionStorage.setItem(KEY, "{not json");
    expect(peekDraft()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("rejects and removes a draft with the wrong shape", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ input: { name: 1 } }));
    expect(peekDraft()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("rejects and removes an oversized stored value", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ input: validDraft(), pad: "x".repeat(200_001) }));
    expect(peekDraft()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("clearDraft removes it; clearDraftFor only removes a matching hand-off", () => {
    storeDraft(validDraft(), "/a");
    clearDraftFor("/b");
    expect(peekDraft()).not.toBeNull();
    clearDraftFor("/a");
    expect(peekDraft()).toBeNull();
    storeDraft(validDraft(), "/a");
    clearDraft();
    expect(peekDraft()).toBeNull();
  });

  it("reports false when storage is full or disabled, and never throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(storeDraft(validDraft())).toBe(false);
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(peekDraft()).toBeNull();
  });
});
