import { z } from "zod";
import { getTopicConfig } from "./topic";
import type { LlmProvider } from "./providers/types";
import type { ConversationTurn, Report } from "./types";

export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportError";
  }
}

export const reportSchema = z.object({
  summary: z.string(),
  strengths: z.array(z.object({ area: z.string(), evidence: z.string() })),
  improvements: z.array(z.object({ area: z.string(), suggestion: z.string() })),
  highlights: z.array(z.string()),
  overall_assessment: z.string(),
});

/**
 * Generate a post-session report with one structured LLM call (spec §6).
 * Rejects with ReportError when the transcript is too short, or with the provider's
 * error (an AbortError on abort) when the call fails.
 */
export async function generateReport(
  turns: readonly ConversationTurn[],
  topicId: string,
  llm: LlmProvider,
  signal: AbortSignal,
): Promise<Report> {
  const transcript = turns
    .map(
      (t) =>
        `${t.role === "user" ? "Participant" : "Interviewer"}: ${t.content}`,
    )
    .join("\n");

  const userTurns = turns.filter((t) => t.role === "user").length;
  if (userTurns < 1 || transcript.trim().length < 50) {
    throw new ReportError("transcript too short");
  }

  const topic = getTopicConfig(topicId);
  const system = `You are evaluating a recorded interview on the following topic:
${topic.label}

Context: ${topic.systemPromptContext}

Below is the full conversation transcript. Generate a structured assessment report in the following JSON format:

{
  "summary": "2-3 sentence overview of the conversation",
  "strengths": [
    { "area": "string", "evidence": "specific quote or paraphrase from the transcript" }
  ],
  "improvements": [
    { "area": "string", "suggestion": "actionable recommendation" }
  ],
  "highlights": ["2-3 memorable or insightful quotes from the participant"],
  "overall_assessment": "1-2 sentences suitable for sharing with the participant"
}

Return only the JSON object. No preamble or markdown formatting.`;

  let raw: unknown;
  try {
    raw = await llm.structured(
      {
        system,
        messages: [{ role: "user", content: `TRANSCRIPT:\n${transcript}` }],
        schema: reportSchema,
        // 1024: intentional exception to the 300 conversational limit; a full JSON report
        // needs the headroom. See AGENTS.md Report Generation Rules.
        maxTokens: 1024,
      },
      signal,
    );
  } catch (err) {
    // Aborts propagate as aborts; anything else becomes a ReportError carrying only the
    // cause's class name (never model output or transcript text).
    if (signal.aborted || (err instanceof Error && err.name === "AbortError"))
      throw err;
    throw new ReportError(
      `report generation failed: ${err instanceof Error ? err.constructor.name : "unknown"}`,
    );
  }

  const checked = reportSchema.safeParse(raw);
  if (!checked.success)
    throw new ReportError("report generation failed: invalid output");
  const parsed = checked.data;

  return {
    sessionId: turns[0].sessionId,
    summary: parsed.summary,
    strengths: parsed.strengths,
    improvements: parsed.improvements,
    highlights: parsed.highlights,
    overallAssessment: parsed.overall_assessment,
    generatedAt: new Date(),
  };
}
