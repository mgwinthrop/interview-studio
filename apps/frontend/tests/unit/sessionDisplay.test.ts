import { describe, expect, it } from "vitest";
import {
  FALLBACK_INTERVIEWER_LABEL,
  displayedOrbState,
  interviewerLabel,
  speakerBadge,
  speakerLabel,
} from "../../app/lib/sessionDisplay";

// FQ-44 slice 0 (#65): who is speaking, and whether the interviewer is speaking, as the
// session screen shows it. The panel and the transcript must read the same state.

describe("speaker labels", () => {
  it('labels the person "You" with a "Y" badge, whatever the interviewer is called', () => {
    expect(speakerLabel("user", "Practice interviewer")).toBe("You");
    expect(speakerBadge("user", "Practice interviewer")).toBe("Y");
    expect(speakerBadge("user", undefined)).toBe("Y");
  });

  it("labels the interviewer by its display name, with its first letter as the badge", () => {
    expect(speakerLabel("assistant", "Practice interviewer")).toBe("Practice interviewer");
    expect(speakerBadge("assistant", "Practice interviewer")).toBe("P");
    expect(speakerBadge("assistant", "  thinking partner")).toBe("T");
  });

  it('falls back to "Interviewer" and "I" when the display name is absent or blank', () => {
    expect(FALLBACK_INTERVIEWER_LABEL).toBe("Interviewer");
    for (const name of [undefined, "", "   "]) {
      expect(interviewerLabel(name)).toBe("Interviewer");
      expect(speakerLabel("assistant", name)).toBe("Interviewer");
      expect(speakerBadge("assistant", name)).toBe("I");
    }
  });

  it("uses a whole first character, not half of a surrogate pair", () => {
    expect(speakerBadge("assistant", "𝒜lex")).toBe("𝒜");
  });
});

describe("displayedOrbState (one state for the panel and the transcript)", () => {
  it("is speaking while audio still plays after tts_end", () => {
    // tts_end has arrived (the orb went back to listening) but buffered speech is still playing.
    expect(displayedOrbState("listening", true)).toBe("speaking");
    expect(displayedOrbState("thinking", true)).toBe("speaking");
  });

  it("passes the state through once playback has stopped", () => {
    for (const s of ["listening", "thinking", "speaking", "interrupted"] as const) {
      expect(displayedOrbState(s, false)).toBe(s);
    }
  });

  it("keeps an interrupt visible even while the last audio drains", () => {
    expect(displayedOrbState("interrupted", true)).toBe("interrupted");
  });
});
