import { describe, it, expect } from "vitest";
import { PRESETS, PRESET_TIMESTAMP, SYNCED_PRESETS, designer, DESIGNER_ID } from "../interviewer/presets/index.js";
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
    expect(p.createdAt).toBe(PRESET_TIMESTAMP);
    expect(p.updatedAt).toBe(PRESET_TIMESTAMP);
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

  describe("text rules", () => {
    const fields = PRESETS.flatMap((p) => [
      { where: `${p.id}.persona`, key: "persona", text: p.persona },
      { where: `${p.id}.style`, key: "style", text: p.style },
      { where: `${p.id}.opening`, key: "opening", text: p.opening },
      { where: `${p.id}.closing`, key: "closing", text: p.closing },
      ...p.phases.map((ph) => ({
        where: `${p.id}.${ph.name}`,
        key: ph.name === "wrap_up" ? "wrap_up" : "phase",
        text: ph.instruction,
      })),
    ]);

    const banned: Record<string, RegExp> = {
      phaseSwitching: /\b(after|within)\s+\d+|\bturns?\b|\bexchanges?\b|move (on|forward) to/i,
      listMarkers: /^\s*(?:[-*#]|\d+\.)|\bbullet|\bnumbered list/im,
      summarising: /say back|reflect back|summaris|summariz|recap|paraphras/i,
      scoring:
        /\b(?:assessment|assess|score|scored|scoring|grade|grading|pass\/fail|pass or fail|marking|rating)\b/i,
      oldTopics: /ai-se-delivery|experience-design|product-design-strategy/i,
    };

    for (const [rule, re] of Object.entries(banned)) {
      it(`has no ${rule} language`, () => {
        for (const f of fields) expect(f.text, f.where).not.toMatch(re);
      });
    }

    it("has no double quotes in opening and closing (guidance, not a script)", () => {
      for (const f of fields.filter((x) => x.key === "opening" || x.key === "closing")) {
        expect(f.text, f.where).not.toMatch(/["“”]/);
      }
    });

    it("has no question in opening and closing (intro owns the first question)", () => {
      for (const f of fields.filter((x) => x.key === "opening" || x.key === "closing")) {
        expect(f.text, f.where).not.toContain("?");
      }
    });

    it("has every wrap_up instruction mention the reflection", () => {
      for (const f of fields.filter((x) => x.key === "wrap_up")) {
        expect(f.text, f.where).toMatch(/reflection/i);
      }
    });

    it("has at most one question mark per instruction", () => {
      for (const f of fields.filter((x) => x.key === "phase" || x.key === "wrap_up")) {
        expect((f.text.match(/\?/g) ?? []).length, f.where).toBeLessThanOrEqual(1);
      }
    });
  });

  it("does not mention the old topic ids", () => {
    const all = JSON.stringify(PRESETS);
    for (const old of ["ai-se-delivery", "experience-design", "product-design-strategy"]) {
      expect(all).not.toContain(old);
    }
  });
});

describe("designer preset", () => {
  it("is valid, has the designer id and is not one of the four user-facing presets", () => {
    expect(() => parseInterviewerDefinition(designer)).not.toThrow();
    expect(designer.id).toBe(DESIGNER_ID);
    expect(DESIGNER_ID).toBe("interviewer-designer");
    expect(designer.source).toBe("preset");
    expect(designer.ownerId).toBe(SYSTEM_OWNER);
    expect(PRESETS.map((p) => p.id)).not.toContain(DESIGNER_ID);
  });

  it("SYNCED_PRESETS holds all five with unique ids", () => {
    expect(SYNCED_PRESETS.map((p) => p.id)).toEqual([...IDS, DESIGNER_ID]);
    expect(new Set(SYNCED_PRESETS.map((p) => p.id)).size).toBe(5);
  });

  it("has three phases and content feedback only", () => {
    expect(designer.phases.map((p) => p.name)).toEqual(["understand", "shape", "confirm"]);
    expect(designer.phases[0]).toMatchObject({ minTurns: 1, maxTurns: 3 });
    expect(designer.phases[1]).toMatchObject({ minTurns: 2, maxTurns: 4 });
    expect(designer.phases[2].minTurns).toBeUndefined();
    expect(designer.phases[2].maxTurns).toBeUndefined();
    expect(designer.contentFeedback).toBe(true);
    expect(designer.deliveryFeedback).toBe(false);
    expect(designer.focus).toEqual([]);
  });

  it("uses no assessment language and says it cannot save anything", () => {
    const all = JSON.stringify(designer);
    for (const word of ["assessment", "score", "grade", "rating", "pass/fail"]) {
      expect(all.toLowerCase()).not.toContain(word);
    }
    expect(all).toContain("cannot save or change anything");
  });
});
