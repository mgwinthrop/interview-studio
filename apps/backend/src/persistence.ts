import prisma from "./db";
import { ConversationTurn, Phase, Report } from "./types";

// ── Read helpers (post-restart fallback for HTTP endpoints) ──────────────────

/**
 * Returns { report, sessionStatus } from SQLite, or null if session not found.
 * report is null when the session exists but report generation hasn't completed.
 */
export async function readReportFromDb(
  sessionId: string
): Promise<{ report: Report | null; sessionStatus: string } | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { report: true },
  });
  if (!session) return null;

  const report = session.report
    ? ({
        sessionId: session.report.sessionId,
        summary: session.report.summary,
        strengths: JSON.parse(session.report.strengthsJson),
        improvements: JSON.parse(session.report.improvementsJson),
        highlights: JSON.parse(session.report.highlightsJson),
        overallAssessment: session.report.overallAssessment,
        generatedAt: session.report.generatedAt,
      } satisfies Report)
    : null;

  return { report, sessionStatus: session.status };
}

/**
 * Returns ConversationTurn[] from SQLite for the given session, ordered by timestamp.
 * Returns null if no turns exist for the session.
 */
export async function readTurnsFromDb(
  sessionId: string
): Promise<ConversationTurn[] | null> {
  const rows = await prisma.conversationTurn.findMany({
    where: { sessionId },
    orderBy: { timestamp: "asc" },
  });
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    role: r.role as "user" | "assistant",
    content: r.content,
    phase: r.phase as Phase,
    timestamp: r.timestamp,
  }));
}

export async function persistSessionCreate(
  id: string,
  topicId: string,
  phase: Phase
): Promise<void> {
  await prisma.session.upsert({
    where: { id },
    update: {},
    create: { id, topicId, phase, status: "active" },
  });
}

export async function persistTurn(turn: ConversationTurn): Promise<void> {
  await prisma.conversationTurn.upsert({
    where: { id: turn.id },
    update: {
      content: turn.content,
      phase: turn.phase,
    },
    create: {
      id: turn.id,
      sessionId: turn.sessionId,
      role: turn.role,
      content: turn.content,
      phase: turn.phase,
      timestamp: turn.timestamp,
    },
  });
}

export async function persistPhaseTransition(
  sessionId: string,
  phase: Phase
): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { phase },
  });
}

export async function persistSessionEnd(
  sessionId: string,
  report?: Report
): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: "complete",
      endedAt: new Date(),
    },
  });

  if (report) {
    await prisma.report.upsert({
      where: { sessionId },
      update: {
        summary: report.summary,
        strengthsJson: JSON.stringify(report.strengths),
        improvementsJson: JSON.stringify(report.improvements),
        highlightsJson: JSON.stringify(report.highlights),
        overallAssessment: report.overallAssessment,
        generatedAt: report.generatedAt,
      },
      create: {
        sessionId,
        summary: report.summary,
        strengthsJson: JSON.stringify(report.strengths),
        improvementsJson: JSON.stringify(report.improvements),
        highlightsJson: JSON.stringify(report.highlights),
        overallAssessment: report.overallAssessment,
        generatedAt: report.generatedAt,
      },
    });
  }
}
