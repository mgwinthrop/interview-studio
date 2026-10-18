import { describe, it, expect } from "vitest";
import { shouldTransition, nextPhase, buildSystemPrompt } from "../llm";
import { getTopicConfig } from "../topic";
import type { Phase } from "../types";

// ── shouldTransition ──────────────────────────────────────────────────────────
// Thresholds are LOCKED in AGENTS.md: intro=2, share_work=5, deep_dive=10, demo intro=1
// These tests are the machine-readable version of that lock.

describe("shouldTransition", () => {
  describe("intro (threshold 2)", () => {
    it("returns false below threshold", () => expect(shouldTransition("intro", 1)).toBe(false));
    it("returns true at threshold",     () => expect(shouldTransition("intro", 2)).toBe(true));
    it("returns true above threshold",  () => expect(shouldTransition("intro", 3)).toBe(true));
  });

  describe("intro demo mode (threshold 1)", () => {
    it("returns false below demo threshold", () => expect(shouldTransition("intro", 0, true)).toBe(false));
    it("returns true at demo threshold",     () => expect(shouldTransition("intro", 1, true)).toBe(true));
    it("returns true above demo threshold",  () => expect(shouldTransition("intro", 2, true)).toBe(true));
  });

  describe("share_work (threshold 5)", () => {
    it("returns false below threshold", () => expect(shouldTransition("share_work", 4)).toBe(false));
    it("returns true at threshold",     () => expect(shouldTransition("share_work", 5)).toBe(true));
    it("returns true above threshold",  () => expect(shouldTransition("share_work", 6)).toBe(true));
  });

  describe("deep_dive (threshold 10)", () => {
    it("returns false below threshold", () => expect(shouldTransition("deep_dive", 9)).toBe(false));
    it("returns true at threshold",     () => expect(shouldTransition("deep_dive", 10)).toBe(true));
    it("returns true above threshold",  () => expect(shouldTransition("deep_dive", 11)).toBe(true));
  });

  describe("wrap_up (terminal — never transitions)", () => {
    it("returns false at 0",   () => expect(shouldTransition("wrap_up", 0)).toBe(false));
    it("returns false at 100", () => expect(shouldTransition("wrap_up", 100)).toBe(false));
  });
});

// ── nextPhase ─────────────────────────────────────────────────────────────────

describe("nextPhase", () => {
  it("intro → share_work",   () => expect(nextPhase("intro")).toBe("share_work"));
  it("share_work → deep_dive", () => expect(nextPhase("share_work")).toBe("deep_dive"));
  it("deep_dive → wrap_up",  () => expect(nextPhase("deep_dive")).toBe("wrap_up"));
  it("wrap_up → wrap_up (terminal)", () => expect(nextPhase("wrap_up")).toBe("wrap_up"));
});

// ── buildSystemPrompt ─────────────────────────────────────────────────────────
// Assert structural properties only — not exact wording, which changes with tuning.

const TOPIC_IDS = ["ai-se-delivery", "experience-design", "product-design-strategy"] as const;
const PHASES: Phase[] = ["intro", "share_work", "deep_dive", "wrap_up"];

describe("buildSystemPrompt", () => {
  // 12 combinations: 3 topics × 4 phases
  for (const topicId of TOPIC_IDS) {
    const topic = getTopicConfig(topicId);
    for (const phase of PHASES) {
      describe(`${topicId} × ${phase}`, () => {
        const prompt = buildSystemPrompt(phase, topic);

        it("is a non-empty string", () => {
          expect(typeof prompt).toBe("string");
          expect(prompt.length).toBeGreaterThan(100);
        });

        it("contains systemPromptContext", () => {
          expect(prompt).toContain(topic.systemPromptContext);
        });

        it("contains no markdown fences", () => {
          expect(prompt).not.toMatch(/^```/m);
        });

        it("contains no bullet/list characters at line start", () => {
          expect(prompt).not.toMatch(/^\s*[-*•]\s/m);
        });
      });
    }
  }

  it("intro phase instructs to greet", () => {
    const prompt = buildSystemPrompt("intro", getTopicConfig("ai-se-delivery"));
    expect(prompt.toLowerCase()).toContain("greet");
  });

  it("share_work phase asks for a specific example", () => {
    const prompt = buildSystemPrompt("share_work", getTopicConfig("ai-se-delivery"));
    expect(prompt.toLowerCase()).toContain("specific");
  });

  it("deep_dive phase injects suggestedAreas", () => {
    const topic = getTopicConfig("ai-se-delivery");
    const prompt = buildSystemPrompt("deep_dive", topic);
    expect(prompt).toContain(topic.suggestedAreas[0]);
  });

  it("wrap_up phase instructs to thank participant", () => {
    const prompt = buildSystemPrompt("wrap_up", getTopicConfig("ai-se-delivery"));
    expect(prompt.toLowerCase()).toContain("thank");
  });
});
