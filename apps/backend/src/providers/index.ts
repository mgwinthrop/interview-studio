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

/** Canned interviewer draft for PROFILE=mock; it must pass the save validation. */
const MOCK_DRAFT = {
  name: "Mock interviewer",
  purpose: "A mock draft made on the mock profile.",
  persona: "You are a friendly mock interviewer.",
  style: "You ask one short question at a time.",
  opening: "Greet the person and ask what they want to talk about.",
  closing: "Thank the person and say the reflection will follow.",
  phases: [
    { name: "Warm up", instruction: "Ask an easy opening question.", minTurns: 1, maxTurns: 2 },
    { name: "Explore", instruction: "Ask follow-up questions.", minTurns: 2, maxTurns: 4 },
    { name: "Wrap up", instruction: "Ask what they take away." },
  ],
  focus: ["Clarity of the main point"],
  contentFeedback: true,
  deliveryFeedback: true,
};

/**
 * One canned structured value serves both calls: the report schema keeps only its own keys
 * (zod strips unknown keys) and the draft schema picks only the interviewer fields.
 */
const MOCK_STRUCTURED = { ...MOCK_REPORT, ...MOCK_DRAFT };

export function createProviders(config: Config): Providers {
  return config.profile === "mock" ? createMockProviders({ structured: MOCK_STRUCTURED }) : createCloudProviders(config);
}
