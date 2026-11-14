import { describe, expect, it } from "vitest";
import { FLOW_STEPS } from "../../app/components/FlowStepper";
import { interviewersUsedLabel } from "../../app/lib/interviewerWording";

// FQ-45 (#45): the UI calls them interviewers, not personas. ("Persona" in the calls feature
// is the interviewer's own `persona` field and stays.)

describe("interviewer wording", () => {
  it('names step 2 of the flow "Choose an interviewer"', () => {
    expect(FLOW_STEPS.map((s) => s.label)).toEqual(["Mic check", "Choose an interviewer", "Live session", "Report"]);
  });

  it("counts interviewers used, singular only for one", () => {
    expect(interviewersUsedLabel(1)).toBe("1 interviewer used");
    expect(interviewersUsedLabel(0)).toBe("0 interviewers used");
    expect(interviewersUsedLabel(3)).toBe("3 interviewers used");
  });
});
