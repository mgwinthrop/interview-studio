import Anthropic from "@anthropic-ai/sdk";
import { getSession, updateSession } from "./sessionStore";
import { getTopicConfig } from "./topic";
import { Report } from "./types";

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
}

/**
 * Generate a post-session report via a single non-streaming LLM call (spec §6).
 * Stores the result on the session and returns it, or null on failure.
 */
export async function generateReport(sessionId: string): Promise<Report | null> {
  const session = getSession(sessionId);
  if (!session) return null;

  const transcript = session.turns
    .map((t) => `${t.role === "user" ? "Participant" : "Interviewer"}: ${t.content}`)
    .join("\n");

  const userTurns = session.turns.filter((t) => t.role === "user").length;
  if (userTurns < 1 || !transcript || transcript.trim().length < 50) {
    console.error(
      `[${sessionId}] Transcript too short for report generation (${userTurns} user turns, ${transcript.trim().length} chars)`
    );
    return null;
  }

  const topic = getTopicConfig(session.topicId);
  const prompt = `You are evaluating a recorded interview on the following topic:
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

Return only the JSON object. No preamble or markdown formatting.

TRANSCRIPT:
${transcript}`;

  let raw: string;
  try {
    const response = await getAnthropicClient().messages.create({
      model: "claude-sonnet-4-6",
      // max_tokens: 1024 — intentional exception to the 300 conversational limit
      // Full JSON report (strengths + improvements + highlights + assessment) requires headroom
      // See AGENTS.md Report Generation Rules
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const block = response.content[0];
    if (block.type !== "text") {
      console.error(`[${sessionId}] Report: unexpected content block type: ${block.type}`);
      return null;
    }
    raw = block.text.trim();
  } catch (err) {
    console.error(`[${sessionId}] Report LLM call failed:`, err);
    return null;
  }

  // Strip markdown fences if present (Claude sometimes adds them despite instructions)
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[${sessionId}] Report JSON parse failed:`, err, "\nRaw:", raw);
    return null;
  }

  // Validate all required fields are present and array fields are arrays
  const required = ["summary", "strengths", "improvements", "highlights", "overall_assessment"];
  for (const key of required) {
    if (!(key in parsed)) {
      console.error(`[${sessionId}] Report missing field: ${key}`);
      return null;
    }
  }
  for (const key of ["strengths", "improvements", "highlights"] as const) {
    if (!Array.isArray(parsed[key])) {
      console.error(`[${sessionId}] Report field "${key}" is not an array`);
      return null;
    }
  }

  const report: Report = {
    sessionId,
    summary: parsed.summary as string,
    strengths: parsed.strengths as { area: string; evidence: string }[],
    improvements: parsed.improvements as { area: string; suggestion: string }[],
    highlights: parsed.highlights as string[],
    overallAssessment: parsed.overall_assessment as string,
    generatedAt: new Date(),
  };

  updateSession(sessionId, { report });
  console.log(`[${sessionId}] Report generated`);
  return report;
}
