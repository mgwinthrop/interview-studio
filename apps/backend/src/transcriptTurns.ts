import type { ConversationTurn } from "./types";

/** One turn as the report page's transcript shows it (FQ-50). */
export interface TranscriptTurn {
  role: "user" | "assistant";
  content: string;
  phase: string;
  /**
   * User turns only: 1-based position among user turns, in the given order. Every user turn
   * counts, measured or typed, so this is the same rule as summarizeDelivery's perTurn.turn:
   * the report's "Answer N" and the transcript's answer N are the same turn.
   */
  answer?: number;
}

/** Stored turns to the transcript shape. Keeps only what the page shows: no ids, timestamps or metrics. */
export function toTranscriptTurns(turns: readonly ConversationTurn[]): TranscriptTurn[] {
  let answer = 0;
  return turns.map((t) =>
    t.role === "user"
      ? { role: t.role, content: t.content, phase: t.phase, answer: ++answer }
      : { role: t.role, content: t.content, phase: t.phase },
  );
}
