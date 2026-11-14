import { describe, expect, it } from "vitest";
import { speakerBadge, speakerLabel } from "../../app/lib/transcriptLabels";

describe("transcript speaker labels", () => {
  it('labels the user "You" with a "Y" badge, whatever the interviewer is called', () => {
    expect(speakerLabel("user", "Maya")).toBe("You");
    expect(speakerBadge("user", "Maya")).toBe("Y");
  });

  it("labels the interviewer by name, with the name's first letter as the badge", () => {
    expect(speakerLabel("assistant", "Maya")).toBe("Maya");
    expect(speakerBadge("assistant", "Maya")).toBe("M");
    expect(speakerBadge("assistant", "  olu")).toBe("O");
  });

  it("falls back to Interviewer and I for an empty or blank name", () => {
    for (const name of ["", "   "]) {
      expect(speakerLabel("assistant", name)).toBe("Interviewer");
      expect(speakerBadge("assistant", name)).toBe("I");
    }
  });

  it("uses a whole first character, not half of a surrogate pair", () => {
    expect(speakerBadge("assistant", "𝒜lex")).toBe("𝒜");
  });
});
