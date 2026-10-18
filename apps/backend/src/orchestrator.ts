import { buildSystemPrompt, shouldTransition, nextPhase } from "./llm";
import { getTopicConfig } from "./topic";
import type { ChatMessage } from "./providers/types";
import type { ConversationTurn, Phase } from "./types";

/** The parts of a live session the pure turn helpers need. */
export interface TurnSession {
  topicId: string;
  phase: Phase;
  turns: readonly ConversationTurn[];
}

/** The greeting is generated in reply to this priming message, which is never stored. */
export const GREETING_PRIME = "Hello";

/**
 * System prompt for the current phase plus the stored history as chat messages.
 * The history always starts with a user message (the greeting prime), and consecutive
 * same-role messages (left by an interrupted or failed turn) are merged.
 */
export function buildTurnRequest(session: TurnSession): { system: string; messages: ChatMessage[] } {
  const system = buildSystemPrompt(session.phase, getTopicConfig(session.topicId));
  const messages: ChatMessage[] = [];
  for (const turn of session.turns) {
    const last = messages[messages.length - 1];
    if (last && last.role === turn.role) {
      last.content = `${last.content}\n\n${turn.content}`;
    } else {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  if (messages.length === 0 || messages[0].role !== "user") {
    messages.unshift({ role: "user", content: GREETING_PRIME });
  }
  return { system, messages };
}

/**
 * Phase transitions are driven by the user-turn count, never by the LLM.
 * Returns the next phase if the session should move on now, otherwise null.
 */
export function advancePhase(session: TurnSession, demo: boolean): Phase | null {
  const userTurns = session.turns.filter((t) => t.role === "user").length;
  return shouldTransition(session.phase, userTurns, demo) ? nextPhase(session.phase) : null;
}
