import { describe, expect, it } from "vitest";
import { advancePhase, buildTurnRequest, endsWithQuestion, GREETING_PRIME } from "../orchestrator";
import { buildSystemPrompt } from "../interviewer/prompt";
import { PRESETS } from "../interviewer/presets";
import type { InterviewerDefinition, PhaseDefinition } from "../interviewer/schema";
import type { ConversationTurn } from "../types";

function turn(role: "user" | "assistant", content: string): ConversationTurn {
  return { id: content, sessionId: "s", role, content, phase: "intro", timestamp: new Date(0) };
}

function withPhases(phases: PhaseDefinition[]): InterviewerDefinition {
  return { ...PRESETS[0], id: "custom-1", source: "custom", ownerId: "o", phases };
}

const preset = PRESETS[0];

describe("buildTurnRequest", () => {
  it("primes an empty history with the greeting message and uses the first-turn prompt", () => {
    const req = buildTurnRequest({ interviewer: preset, phaseIndex: 0, phaseUserTurns: 0, turns: [] });
    expect(req.messages).toEqual([{ role: "user", content: GREETING_PRIME }]);
    expect(req.system).toBe(buildSystemPrompt(preset, 0, true));
    expect(req.system).toContain(preset.opening);
  });

  it("starts with the prime before a stored greeting and merges same-role runs", () => {
    const req = buildTurnRequest({
      interviewer: preset,
      phaseIndex: 1,
      phaseUserTurns: 1,
      turns: [turn("assistant", "hi"), turn("user", "a"), turn("user", "b")],
    });
    expect(req.messages).toEqual([
      { role: "user", content: GREETING_PRIME },
      { role: "assistant", content: "hi" },
      { role: "user", content: "a\n\nb" },
    ]);
    expect(req.system).toBe(buildSystemPrompt(preset, 1, false));
    expect(req.system).toContain(preset.phases[1].instruction);
    expect(req.system).not.toContain(preset.opening);
  });

  it("is not a first turn once any turn is stored", () => {
    const req = buildTurnRequest({
      interviewer: preset,
      phaseIndex: 0,
      phaseUserTurns: 0,
      turns: [turn("assistant", "hi")],
    });
    expect(req.system).not.toContain(preset.opening);
  });
});

describe("advancePhase", () => {
  const def = withPhases([
    { name: "a", instruction: "A", minTurns: 1, maxTurns: 2 },
    { name: "b", instruction: "B", minTurns: 1, maxTurns: 3 },
    { name: "c", instruction: "C", minTurns: 2, maxTurns: 4 },
    { name: "end", instruction: "E" },
  ]);

  it("advances at maxTurns of the current phase (1/2 vs 1/3 thresholds)", () => {
    expect(advancePhase(def, 0, 1, false)).toBeNull();
    expect(advancePhase(def, 0, 2, false)).toBe(1);
    expect(advancePhase(def, 1, 2, false)).toBeNull();
    expect(advancePhase(def, 1, 3, false)).toBe(2);
    expect(advancePhase(def, 2, 3, false)).toBeNull();
    expect(advancePhase(def, 2, 4, false)).toBe(3);
  });

  it("demo mode advances every phase at minTurns", () => {
    expect(advancePhase(def, 0, 0, true)).toBeNull();
    expect(advancePhase(def, 0, 1, true)).toBe(1);
    expect(advancePhase(def, 1, 1, true)).toBe(2);
    expect(advancePhase(def, 2, 1, true)).toBeNull();
    expect(advancePhase(def, 2, 2, true)).toBe(3);
  });

  it("judges only the current phase's own count against its own threshold", () => {
    // The same count (2) ends phase a (max 2) but not phase c (max 4).
    expect(advancePhase(def, 0, 2, false)).toBe(1);
    expect(advancePhase(def, 2, 2, false)).toBeNull();
  });

  it("advances at most one phase per evaluation", () => {
    expect(advancePhase(def, 0, 50, false)).toBe(1);
  });

  it("returns null for the last phase whatever the count", () => {
    expect(advancePhase(def, 3, 0, false)).toBeNull();
    expect(advancePhase(def, 3, 100, false)).toBeNull();
    expect(advancePhase(def, 3, 100, true)).toBeNull();
  });

  it("returns null for a single-phase interviewer", () => {
    const one = withPhases([{ name: "only", instruction: "O" }]);
    expect(advancePhase(one, 0, 100, false)).toBeNull();
    expect(advancePhase(one, 0, 100, true)).toBeNull();
  });

  it("gives every preset the default pacing 2/3/5 (2/5/10 cumulative)", () => {
    for (const p of PRESETS) {
      expect(advancePhase(p, 0, 1, false)).toBeNull();
      expect(advancePhase(p, 0, 2, false)).toBe(1);
      expect(advancePhase(p, 1, 3, false)).toBe(2);
      expect(advancePhase(p, 2, 4, false)).toBeNull();
      expect(advancePhase(p, 2, 5, false)).toBe(3);
      expect(advancePhase(p, 3, 50, false)).toBeNull();
    }
  });
});

describe("endsWithQuestion", () => {
  it.each([
    "What was the room like?",
    "  Where were you standing?  ",
    'Did she say "come in?"',
    "Was that the moment (the first one?)",
    "And then what happened\u2019s next?",
    "What did you feel?\u201d",
  ])("is true for %j", (s) => expect(endsWithQuestion(s)).toBe(true));

  it.each([
    "Thanks for sharing that.",
    "Take all the time you need!",
    "Who was there? Tell me more.",
    "What is going on? I wonder",
    "",
  ])("is false for %j", (s) => expect(endsWithQuestion(s)).toBe(false));
});
