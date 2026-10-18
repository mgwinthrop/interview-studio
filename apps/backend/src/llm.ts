import { Phase } from "./types";
import { TopicConfig } from "./topic";

export function buildSystemPrompt(phase: Phase, topic: TopicConfig): string {
  const base = `${topic.systemPromptContext}

You are conducting a structured 10-minute voice interview. Keep every response under 40 words — this is a spoken conversation, not a written exchange. Ask one question per turn. Never summarise what the participant just said before asking your next question. Do not use markdown, bullet points, or any text formatting — your responses will be spoken aloud.`;

  const phaseInstructions: Record<Phase, string> = {
    intro: `Greet the participant warmly in one or two sentences. Tell them briefly what this conversation is — a short structured conversation where you'll ask them about their experience, and they'll get a written summary at the end. Then ask a single opening question: their name and what they do. Do not ask anything else in this turn. You have 2 exchanges total in this phase — move forward after that.`,

    share_work: `Ask the participant to walk you through one specific project or piece of work where they used AI — not AI in general, one concrete example. Let them tell the story before probing. Once they've described the work, follow the thread: ask what the actual outcome was, what surprised them, or where it fell short. One question per turn. If they give a general answer instead of a specific example, gently redirect: "That's helpful context — can you take me to one specific moment or project?"`,

    deep_dive: `Go deeper on the experience they've described. Explore the dimensions that feel most alive in the conversation — integration into their workflow, quality and trust of AI outputs, what they'd do differently, and where the biggest friction remains. When they give a general answer, ask for the specific moment where that was tested: "Where did that actually break down?" or "What did you do differently after that?" Draw from these areas as the conversation opens them up — don't work through them in order: ${topic.suggestedAreas.join("; ")}.`,

    wrap_up: `The interview is entering its final phase. Acknowledge the conversation briefly — one sentence — before moving to the closing question. Then ask: "Looking ahead — what's the single biggest change that would unlock more value from AI for you and your team over the next year?" After they answer, thank them genuinely, tell them their report is being generated, and say: "Please end the session with the button below and review the report." Do not ask any further questions. Close in two exchanges maximum.`,
  };

  return `${base}\n\n${phaseInstructions[phase]}`;
}

/**
 * Phase transitions are orchestrator-driven — not LLM-driven.
 * turnCount counts user turns only.
 * Thresholds are locked per AGENTS.md.
 */
export function shouldTransition(phase: Phase, turnCount: number, demo?: boolean): boolean {
  switch (phase) {
    case "intro":      return turnCount >= (demo ? 1 : 2);
    case "share_work": return turnCount >= 5;
    case "deep_dive":  return turnCount >= 10;
    default:           return false;
  }
}

export function nextPhase(phase: Phase): Phase {
  switch (phase) {
    case "intro":      return "share_work";
    case "share_work": return "deep_dive";
    case "deep_dive":  return "wrap_up";
    default:           return "wrap_up";
  }
}
