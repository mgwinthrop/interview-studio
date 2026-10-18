import type { InterviewerDefinition } from "../schema.js";
import { tellAStory } from "./tellAStory.js";
import { explainAnIdea } from "./explainAnIdea.js";
import { rehearseAnInterview } from "./rehearseAnInterview.js";
import { workOutAPointOfView } from "./workOutAPointOfView.js";

export { PRESET_TIMESTAMP } from "./timestamps.js";

export const PRESETS: readonly InterviewerDefinition[] = [
  tellAStory,
  explainAnIdea,
  rehearseAnInterview,
  workOutAPointOfView,
];
