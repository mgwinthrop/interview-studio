import { describe, expect, it } from "vitest";
import { generateReport, ReportError, reportSchema } from "../reportGenerator";
import { createMockProviders } from "../providers/mock";
import type { LlmProvider } from "../providers/types";
import type { ConversationTurn } from "../types";

const TOPIC = "ai-se-delivery";
const SECRET_TURN = "zebra-quokka confidential participant words about shipping software reliably";
const SECRET_OUT = "MODEL-SECRET-OUTPUT-XYZ";

function turn(role: "user" | "assistant", content: string, n: number): ConversationTurn {
  return { id: `t-${n}`, sessionId: "s-1", role, content, phase: "intro", timestamp: new Date() };
}

function turns(userCount = 2): ConversationTurn[] {
  const out: ConversationTurn[] = [];
  for (let i = 0; i < userCount; i++) {
    out.push(turn("assistant", "Tell me more please.", i * 2));
    out.push(turn("user", SECRET_TURN, i * 2 + 1));
  }
  return out;
}

const validOutput = {
  summary: "A solid chat.",
  strengths: [{ area: "Clarity", evidence: "said it plainly" }],
  improvements: [{ area: "Depth", suggestion: "give examples" }],
  highlights: ["a quote"],
  overall_assessment: "Good work.",
};

function llmWith(fn: LlmProvider["structured"]): LlmProvider {
  return { stream: async function* () {}, structured: fn };
}

const live = () => new AbortController().signal;

describe("generateReport", () => {
  it("returns the mapped report with generatedAt set", async () => {
    const { llm } = createMockProviders({ structured: validOutput });
    const report = await generateReport(turns(), TOPIC, llm, live());
    expect(report.summary).toBe("A solid chat.");
    expect(report.overallAssessment).toBe("Good work.");
    expect(report.sessionId).toBe("s-1");
    expect(report.generatedAt).toBeInstanceOf(Date);
  });

  it("exports a schema that rejects a missing summary", () => {
    const { summary: _s, ...rest } = validOutput;
    expect(reportSchema.safeParse(rest).success).toBe(false);
    expect(reportSchema.safeParse(validOutput).success).toBe(true);
  });

  it("rejects invalid output (missing summary) with ReportError", async () => {
    const { summary: _s, ...rest } = validOutput;
    const { llm } = createMockProviders({ structured: rest });
    await expect(generateReport(turns(), TOPIC, llm, live())).rejects.toBeInstanceOf(ReportError);
  });

  it("rejects with ReportError when the provider returns something failing the schema", async () => {
    const llm = llmWith(async () => ({ nope: true }) as never);
    await expect(generateReport(turns(), TOPIC, llm, live())).rejects.toBeInstanceOf(ReportError);
  });

  it("rejects fewer than one user turn as transcript too short", async () => {
    const { llm } = createMockProviders({ structured: validOutput });
    const onlyAssistant = turns(1).filter((t) => t.role === "assistant");
    await expect(generateReport(onlyAssistant, TOPIC, llm, live())).rejects.toThrow(
      new ReportError("transcript too short"),
    );
  });

  it("rejects a transcript under 50 characters", async () => {
    const { llm } = createMockProviders({ structured: validOutput });
    await expect(generateReport([turn("user", "hi", 0)], TOPIC, llm, live())).rejects.toThrow(
      "transcript too short",
    );
  });

  it("propagates an AbortError as an abort, not a ReportError", async () => {
    const ac = new AbortController();
    ac.abort();
    const { llm } = createMockProviders({ structured: validOutput });
    const err = await generateReport(turns(), TOPIC, llm, ac.signal).catch((e) => e);
    expect(err).not.toBeInstanceOf(ReportError);
    expect(err.name).toBe("AbortError");
  });

  it("treats a rejection while signal.aborted as an abort even if not named AbortError", async () => {
    const ac = new AbortController();
    const llm = llmWith(async () => {
      ac.abort();
      throw new Error("socket hang up");
    });
    const err = await generateReport(turns(), TOPIC, llm, ac.signal).catch((e) => e);
    expect(err).not.toBeInstanceOf(ReportError);
  });

  it("wraps a provider failure with the class name only, never transcript or model text", async () => {
    class BoomError extends Error {}
    const llm = llmWith(async () => {
      throw new BoomError(`${SECRET_OUT} ${SECRET_TURN}`);
    });
    const err = await generateReport(turns(), TOPIC, llm, live()).catch((e) => e);
    expect(err).toBeInstanceOf(ReportError);
    expect(err.message).toContain("BoomError");
    expect(err.message).not.toContain(SECRET_OUT);
    expect(err.message).not.toContain("zebra-quokka");
  });

  it("schema-failure message contains no model output or transcript text", async () => {
    const llm = llmWith(async () => ({ summary: 5, extra: SECRET_OUT }) as never);
    const err = await generateReport(turns(), TOPIC, llm, live()).catch((e) => e);
    expect(err).toBeInstanceOf(ReportError);
    expect(err.message).not.toContain(SECRET_OUT);
    expect(err.message).not.toContain("zebra-quokka");
  });
});
