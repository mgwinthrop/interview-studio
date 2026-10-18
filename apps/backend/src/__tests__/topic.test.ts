import { describe, it, expect } from "vitest";
import { getTopicConfig } from "../topic";

const VALID_IDS = ["ai-se-delivery", "experience-design", "product-design-strategy"] as const;

describe("getTopicConfig", () => {
  describe("valid topic IDs", () => {
    for (const id of VALID_IDS) {
      describe(id, () => {
        it("returns config with matching id", () => {
          expect(getTopicConfig(id).id).toBe(id);
        });

        it("has a non-empty label", () => {
          expect(getTopicConfig(id).label.length).toBeGreaterThan(0);
        });

        it("systemPromptContext is a single-line string (no indented continuation lines)", () => {
          const ctx = getTopicConfig(id).systemPromptContext;
          expect(ctx).not.toMatch(/\n\s+/);
        });

        it("systemPromptContext identifies as Interview Studio interviewer", () => {
          const ctx = getTopicConfig(id).systemPromptContext.toLowerCase();
          expect(ctx).toContain("interview studio");
          expect(ctx).toContain("interviewer");
        });

        it("has at least one suggestedArea", () => {
          expect(getTopicConfig(id).suggestedAreas.length).toBeGreaterThan(0);
        });

        it("all suggestedAreas are non-empty strings", () => {
          for (const area of getTopicConfig(id).suggestedAreas) {
            expect(typeof area).toBe("string");
            expect(area.length).toBeGreaterThan(0);
          }
        });

        it("has a non-empty sessionGoal", () => {
          expect(getTopicConfig(id).sessionGoal.length).toBeGreaterThan(0);
        });
      });
    }
  });

  describe("unknown topic IDs", () => {
    it("throws for an unrecognised topicId", () => {
      expect(() => getTopicConfig("unknown-persona")).toThrow();
    });

    it("error message includes the unknown topicId", () => {
      expect(() => getTopicConfig("bad-id")).toThrow("bad-id");
    });

    it("throws for empty string", () => {
      expect(() => getTopicConfig("")).toThrow();
    });
  });
});
