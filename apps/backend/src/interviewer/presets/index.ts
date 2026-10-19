import type { InterviewerDefinition } from "../schema.js";
import { tellAStory } from "./tellAStory.js";
import { explainAnIdea } from "./explainAnIdea.js";
import { rehearseAnInterview } from "./rehearseAnInterview.js";
import { workOutAPointOfView } from "./workOutAPointOfView.js";

import { designer, DESIGNER_ID } from "./designer.js";

export { PRESET_TIMESTAMP } from "./timestamps.js";

export const PRESETS: readonly InterviewerDefinition[] = [
  tellAStory,
  explainAnIdea,
  rehearseAnInterview,
  workOutAPointOfView,
];

export { designer, DESIGNER_ID };

/** Everything synced into the database: the four user-facing presets plus the hidden designer. */
export const SYNCED_PRESETS: readonly InterviewerDefinition[] = [...PRESETS, designer];
