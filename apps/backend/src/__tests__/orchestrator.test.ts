import { describe, expect, it } from "vitest";
import { advancePhase, buildTurnRequest, GREETING_PRIME } from "../orchestrator";
import type { ConversationTurn, Phase } from "../types";

function turn(role: "user" | "assistant", content: string): ConversationTurn {
  return { id: content, sessionId: "s", role, content, phase: "intro", timestamp: new Date(0) };
}

describe("buildTurnRequest", () => {
  it("primes an empty history with the greeting message", () => {
    const req = buildTurnRequest({ topicId: "ai-se-delivery", phase: "intro", turns: [] });
    expect(req.messages).toEqual([{ role: "user", content: GREETING_PRIME }]);
    expect(req.system).toContain("Greet the participant");
  });

  it("starts with the prime before a stored greeting and merges same-role runs", () => {
    const req = buildTurnRequest({
      topicId: "ai-se-delivery",
      phase: "share_work",
      turns: [turn("assistant", "hi"), turn("user", "a"), turn("user", "b")],
    });
    expect(req.messages).toEqual([
      { role: "user", content: GREETING_PRIME },
      { role: "assistant", content: "hi" },
      { role: "user", content: "a\n\nb" },
    ]);
    expect(req.system).toContain("walk you through one specific project");
  });
});

describe("advancePhase", () => {
  const users = (n: number) => Array.from({ length: n }, (_, i) => turn("user", `u${i}`));
  const at = (phase: Phase, n: number, demo = false) =>
    advancePhase({ topicId: "ai-se-delivery", phase, turns: [turn("assistant", "g"), ...users(n)] }, demo);

  it("uses user-turn thresholds 2/5/10 and demo intro 1", () => {
    expect(at("intro", 1)).toBeNull();
    expect(at("intro", 2)).toBe("share_work");
    expect(at("intro", 1, true)).toBe("share_work");
    expect(at("share_work", 4)).toBeNull();
    expect(at("share_work", 5)).toBe("deep_dive");
    expect(at("deep_dive", 9)).toBeNull();
    expect(at("deep_dive", 10)).toBe("wrap_up");
    expect(at("wrap_up", 50)).toBeNull();
  });
});
