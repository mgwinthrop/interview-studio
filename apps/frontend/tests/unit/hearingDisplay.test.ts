import { describe, expect, it } from "vitest";
import { HEARING_DEADLINE_MS, hearingUnavailable, panelState } from "../../app/lib/sessionDisplay";

// FQ-41 (#41): the panel never says "Listening" while nothing is listening, and the person is
// told within 10 s of the session opening if hearing has not started, for any reason.

describe("hearingUnavailable", () => {
  it("has a 10 second deadline", () => {
    expect(HEARING_DEADLINE_MS).toBe(10_000);
  });

  it("is true at once when hearing failed, and after the deadline for anything but ready", () => {
    expect(hearingUnavailable("failed", false)).toBe(true);
    for (const h of ["off", "starting", "failed"] as const) expect(hearingUnavailable(h, true)).toBe(true);
    expect(hearingUnavailable("starting", false)).toBe(false);
    expect(hearingUnavailable("off", false)).toBe(false);
  });

  it("clears when hearing becomes ready, even after the deadline (a late load recovers)", () => {
    expect(hearingUnavailable("ready", true)).toBe(false);
  });
});

describe("panelState", () => {
  it("shows listening only when hearing is ready", () => {
    expect(panelState("listening", "ready", false)).toBe("listening");
    expect(panelState("listening", "starting", false)).toBe("starting");
    expect(panelState("listening", "off", false)).toBe("starting");
    expect(panelState("listening", "failed", false)).toBe("unavailable");
    expect(panelState("listening", "starting", true)).toBe("unavailable");
  });

  it("leaves thinking, speaking and interrupted alone, so typed turns still show them", () => {
    for (const s of ["thinking", "speaking", "interrupted"] as const) {
      expect(panelState(s, "failed", true)).toBe(s);
    }
  });
});
