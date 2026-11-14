import { buildSystemPrompt } from "./interviewer/prompt";
import type { InterviewerDefinition } from "./interviewer/schema";
import type { ChatMessage } from "./providers/types";
import type { ConversationTurn } from "./types";

/** The parts of a live session the pure turn helpers need. */
export interface TurnSession {
  interviewer: InterviewerDefinition;
  phaseIndex: number;
  /** User turns stored since the current phase began. */
  phaseUserTurns: number;
  turns: readonly ConversationTurn[];
}

/**
 * True when a sentence ends with a question mark, with any closing quote or bracket after it.
 * Used to keep to one question per turn (the voice rule) when the model asks more than one.
 */
export function endsWithQuestion(sentence: string): boolean {
  return /\?["'\u2019\u201d)\]]*$/.test(sentence.trim());
}

/** The greeting is generated in reply to this priming message, which is never stored. */
export const GREETING_PRIME = "Hello";

/**
 * System prompt for the current phase plus the stored history as chat messages.
 * The history always starts with a user message (the greeting prime), and consecutive
 * same-role messages (left by an interrupted or failed turn) are merged.
 */
export function buildTurnRequest(session: TurnSession): { system: string; messages: ChatMessage[] } {
  // Deliberate: if the greeting is interrupted or fails before anything is stored, the
  // opening guidance is not re-sent, because the next user turn is stored before its reply.
  const isFirstTurn = session.turns.length === 0;
  const system = buildSystemPrompt(session.interviewer, session.phaseIndex, isFirstTurn);
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
 * Phase transitions are driven by the per-phase user-turn count, never by the LLM.
 * A phase ends when its count reaches maxTurns (minTurns in demo mode); the last phase
 * never ends. Returns the next phase index, or null to stay. Advances at most one phase.
 */
export function advancePhase(
  interviewer: InterviewerDefinition,
  phaseIndex: number,
  phaseUserTurns: number,
  demo: boolean,
): number | null {
  if (phaseIndex >= interviewer.phases.length - 1) return null;
  const phase = interviewer.phases[phaseIndex];
  const limit = demo ? phase.minTurns : phase.maxTurns;
  // Validation guarantees both on every phase but the last; without one, never advance.
  if (limit === undefined) return null;
  return phaseUserTurns >= limit ? phaseIndex + 1 : null;
}
