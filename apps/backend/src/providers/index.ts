import type { Config } from "../config";
import { createCloudProviders } from "./cloud";
import { createMockProviders } from "./mock";
import type { Providers } from "./types";

/**
 * Canned report output for PROFILE=mock; it must satisfy reportOutputSchema with every part
 * present, so a mock session completes whichever parts its interviewer asks for.
 */
const MOCK_REPORT = {
  content: {
    summary: "Mock report: this session ran on the mock profile with scripted replies.",
    strengths: [{ area: "Clarity", quote: "Mock quote.", note: "Mock note." }],
    developAreas: [{ area: "Depth", suggestion: "Mock suggestion." }],
  },
  deliveryReading: "Mock reading of the delivery numbers.",
  nextSteps: ["Mock next step."],
};

export function createProviders(config: Config): Providers {
  return config.profile === "mock" ? createMockProviders({ structured: MOCK_REPORT }) : createCloudProviders(config);
}
