// Display configuration for the three interview personas (spec §7).
// These are display-only — do not use interviewerTitle or sessionGoal in LLM prompts.
// id values must match the backend TOPIC_REGISTRY keys exactly (AGENTS.md locked decisions).

export interface TopicDisplayConfig {
  id: string;
  interviewerTitle: string;
  sessionGoal: string;
  sessionLabel: string; // display-only, shown in session header
}

export const TOPICS: TopicDisplayConfig[] = [
  {
    id: "ai-se-delivery",
    interviewerTitle: "Software Engineering Interviewer",
    sessionLabel: "Software Engineering Assessment",
    sessionGoal:
      "Share how you've used AI tools to improve software delivery outcomes. You'll receive personalised feedback on your experience and approach.",
  },
  {
    id: "experience-design",
    interviewerTitle: "Experience Design Interviewer",
    sessionLabel: "Experience Design Assessment",
    sessionGoal:
      "Share how AI tools are shaping your design research, journey mapping, prototyping, and usability testing practice. You'll receive personalised feedback on your approach.",
  },
  {
    id: "product-design-strategy",
    interviewerTitle: "Product Design & Strategy Interviewer",
    sessionLabel: "Product Design & Strategy Assessment",
    sessionGoal:
      "Share how AI tools are influencing how you frame problems, define product direction, prioritise features, and align stakeholders. You'll receive personalised feedback on your approach.",
  },
];

export function getTopicConfig(id: string): TopicDisplayConfig | undefined {
  return TOPICS.find((t) => t.id === id);
}
