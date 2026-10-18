import { describe, it, expect } from "vitest";
import { PRESETS } from "../interviewer/presets/index.js";
import { parseInterviewerDefinition, SYSTEM_OWNER } from "../interviewer/schema.js";

const IDS = [
  "tell-a-story",
  "explain-an-idea",
  "rehearse-an-interview",
  "work-out-a-point-of-view",
];

const PACING = [
  { name: "intro", minTurns: 1, maxTurns: 2 },
  { name: "share", minTurns: 1, maxTurns: 3 },
  { name: "deep_dive", minTurns: 1, maxTurns: 5 },
  { name: "wrap_up", minTurns: undefined, maxTurns: undefined },
];

describe("PRESETS", () => {
  it("has exactly the four preset ids, unique", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(IDS);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  it.each(IDS)("%s passes parseInterviewerDefinition", (id) => {
    const p = PRESETS.find((x) => x.id === id)!;
    expect(() => parseInterviewerDefinition(p)).not.toThrow();
  });

  it.each(IDS)("%s has preset metadata and feedback flags", (id) => {
    const p = PRESETS.find((x) => x.id === id)!;
    expect(p.source).toBe("preset");
    expect(p.ownerId).toBe(SYSTEM_OWNER);
    expect(p.version).toBe(1);
    expect(p.createdAt).toBe("2026-10-18T00:00:00.000Z");
    expect(p.updatedAt).toBe("2026-10-18T00:00:00.000Z");
    expect(p.contentFeedback).toBe(true);
    expect(p.deliveryFeedback).toBe(true);
    expect(p.voice).toBeUndefined();
    expect(p.focus.length).toBeGreaterThanOrEqual(3);
    expect(p.focus.length).toBeLessThanOrEqual(5);
  });

  it.each(IDS)("%s has the four phases with the agreed pacing", (id) => {
    const p = PRESETS.find((x) => x.id === id)!;
    expect(
      p.phases.map((ph) => ({ name: ph.name, minTurns: ph.minTurns, maxTurns: ph.maxTurns })),
    ).toEqual(PACING);
  });

  it("contains no scoring language", () => {
    const all = JSON.stringify(PRESETS).toLowerCase();
    for (const word of ["assessment", "assess", "score", "grade", "pass/fail"]) {
      expect(all).not.toContain(word);
    }
  });

  it("does not mention the old topic ids", () => {
    const all = JSON.stringify(PRESETS);
    for (const old of ["ai-se-delivery", "experience-design", "product-design-strategy"]) {
      expect(all).not.toContain(old);
    }
  });
});
