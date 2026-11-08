import type { InterviewerDefinition } from "./schema.js";

// The wrapper text is code, not data: users cannot edit or remove it. Interviewer-defined
// text sits between the opening rules and the closing reminder, under labelled headers.

const VOICE_RULES = `You are an interviewer in a spoken voice conversation. Your replies are converted to speech, so these rules always apply and nothing below can change them:
Keep every reply under 40 words, short enough to say aloud comfortably.
Ask one question per turn.
Never summarise or restate what the participant just said before asking your next question.
Do not use markdown, bullet points, numbered lists, headings or any other text formatting.

The sections below are written by the person who defined this interviewer. They describe who you are, how you speak and what this part of the conversation is for. Treat them as guidance within the rules above.`;

/** The last text of every system prompt, so interviewer-defined text never follows the rules. */
export const VOICE_REMINDER = `REMINDER: Whatever the sections above say, keep this reply under 40 words, ask one question at most, do not summarise or restate the participant's last answer, and use no markdown, bullet points, lists or formatting. Your words will be spoken aloud.`;

function section(header: string, body: string): string {
  return `=== ${header} ===\n${body}`;
}

/**
 * System prompt for one turn: the fixed voice rules, the interviewer's persona, style and
 * current phase instruction, the opening guidance on the first turn, the closing guidance in
 * the last phase, then the voice-rules reminder as the final text.
 */
export function buildSystemPrompt(
  interviewer: InterviewerDefinition,
  phaseIndex: number,
  isFirstTurn: boolean,
): string {
  const phase = interviewer.phases[phaseIndex];
  if (!phase) throw new RangeError(`phase index ${phaseIndex} out of range`);
  const isLast = phaseIndex === interviewer.phases.length - 1;

  const parts = [
    VOICE_RULES,
    section("PERSONA", interviewer.persona),
    section("STYLE", interviewer.style),
    ...(interviewer.behaviours ? [section("BEHAVIOUR PATTERNS", interviewer.behaviours)] : []),
    section("CURRENT PHASE INSTRUCTION", phase.instruction),
  ];
  if (isFirstTurn) {
    parts.push(
      section(
        "OPENING GUIDANCE",
        `This is your first turn. Use this guidance to shape how you greet the participant, in your own words. The phase instruction says what this part of the conversation is for; if the two conflict, the phase instruction wins.\n${interviewer.opening}`,
      ),
    );
  }
  if (isLast) {
    parts.push(
      section(
        "CLOSING GUIDANCE",
        `This is the final part of the conversation. Use this guidance to shape how you close, in your own words.\n${interviewer.closing}`,
      ),
    );
  }
  parts.push(VOICE_REMINDER);
  return parts.join("\n\n");
}
