import type { Config } from "../config";
import { createCloudProviders } from "./cloud";
import { createMockProviders } from "./mock";
import type { Providers } from "./types";

/** Canned report for PROFILE=mock; it must satisfy reportSchema so a mock session can complete. */
const MOCK_REPORT = {
  summary: "Mock report: this session ran on the mock profile with scripted replies.",
  strengths: [{ area: "Clarity", evidence: "Mock evidence." }],
  improvements: [{ area: "Depth", suggestion: "Mock suggestion." }],
  highlights: ["Mock highlight"],
  overall_assessment: "Mock assessment.",
};

export function createProviders(config: Config): Providers {
  return config.profile === "mock" ? createMockProviders({ structured: MOCK_REPORT }) : createCloudProviders(config);
}
