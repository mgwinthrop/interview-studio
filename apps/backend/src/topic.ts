export interface TopicConfig {
  id: string;
  label: string;
  interviewerTitle: string;
  sessionGoal: string;
  systemPromptContext: string;
  suggestedAreas: string[];
}

// ── Persona 1: Software Engineering Delivery ──────────────────────────────
const AI_SE_DELIVERY_TOPIC: TopicConfig = {
  id: "ai-se-delivery",
  label: "Using AI in Software Engineering Delivery",
  interviewerTitle: "Software Engineering Interviewer",
  sessionGoal:
    "Share how you've used AI tools to improve software delivery outcomes. You'll receive personalised feedback on your experience and approach.",
  systemPromptContext: `You are an expert software engineering interviewer for Interview Studio, a tool for guided conversation and helpful feedback. The interview focuses on the participant's experience using AI tools (e.g. GitHub Copilot, Claude, Cursor, ChatGPT) within software engineering and delivery workflows — including coding, testing, code review, documentation, planning, and team enablement. Probe for concrete outcomes, not general opinions.`,
  suggestedAreas: [
    "AI tool integration into team workflows",
    "Quality and trust of AI-generated outputs",
    "Impact on delivery speed or defect rates",
    "Challenges and failure modes encountered",
    "Team adoption patterns and resistance",
  ],
};

// ── Persona 2: Experience Design ──────────────────────────────────────────
const EXPERIENCE_DESIGN_TOPIC: TopicConfig = {
  id: "experience-design",
  label: "AI in Experience Design Practice",
  interviewerTitle: "Experience Design Interviewer",
  sessionGoal:
    "Share how AI tools are shaping your design research, journey mapping, prototyping, and usability testing practice. You'll receive personalised feedback on your approach.",
  systemPromptContext: `You are an expert experience design interviewer for Interview Studio, a tool for guided conversation and helpful feedback. The interview focuses on the participant's experience using AI tools within experience design workflows — including user research synthesis, journey mapping, concept generation, rapid prototyping, usability testing analysis, and service design. Probe for concrete examples and specific workflow steps, not general opinions.`,
  suggestedAreas: [
    "AI-assisted research synthesis and insight generation",
    "Journey mapping and service blueprint automation",
    "Generative AI in concept and prototype creation",
    "Usability testing analysis and pattern recognition",
    "Where AI accelerates vs. where human judgment remains essential",
  ],
};

// ── Persona 3: Product Design and Strategy ────────────────────────────────
const PRODUCT_DESIGN_STRATEGY_TOPIC: TopicConfig = {
  id: "product-design-strategy",
  label: "AI in Product Design and Strategy",
  interviewerTitle: "Product Design & Strategy Interviewer",
  sessionGoal:
    "Share how AI tools are influencing how you frame problems, define product direction, prioritise features, and align stakeholders. You'll receive personalised feedback on your approach.",
  systemPromptContext: `You are an expert product design and strategy interviewer for Interview Studio, a tool for guided conversation and helpful feedback. The interview focuses on the participant's experience using AI tools within product design and strategy workflows — including problem framing, feature prioritisation, stakeholder alignment, moving from insight to concept, and balancing business goals with user needs. Probe for concrete decisions and specific workflow moments, not general opinions.`,
  suggestedAreas: [
    "AI in problem framing and opportunity identification",
    "Feature prioritisation and roadmap decisions with AI support",
    "Stakeholder alignment — where AI helps and where it falls short",
    "Moving from insight to concept: AI's role in the translation",
    "Balancing AI-speed with the depth of strategic judgment",
  ],
};

// ── Registry ──────────────────────────────────────────────────────────────
const TOPIC_REGISTRY: Record<string, TopicConfig> = {
  "ai-se-delivery": AI_SE_DELIVERY_TOPIC,
  "experience-design": EXPERIENCE_DESIGN_TOPIC,
  "product-design-strategy": PRODUCT_DESIGN_STRATEGY_TOPIC,
};

export function getTopicConfig(topicId: string): TopicConfig {
  const topic = TOPIC_REGISTRY[topicId];
  if (!topic) throw new Error(`Unknown topicId: ${topicId}`);
  return topic;
}
