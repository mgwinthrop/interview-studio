import prisma from "./db";
import { ConversationTurn, Phase, Report, SessionStatus } from "./types";

// ── Read helpers (post-restart fallback for HTTP endpoints) ──────────────────
// Every query goes through the owning session so one owner never sees another's data.

/**
 * Returns { report, sessionStatus } for a session owned by ownerId, or null if
 * the session does not exist or belongs to someone else.
 * report is null when the session exists but report generation hasn't completed.
 */
export async function readReportFromDb(
  sessionId: string,
  ownerId: string
): Promise<{ report: Report | null; sessionStatus: string } | null> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, ownerId },
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
 * Returns ConversationTurn[] for a session owned by ownerId, ordered by timestamp.
 * Returns null if the session is not owned by ownerId or has no turns.
 */
export async function readTurnsFromDb(
  sessionId: string,
  ownerId: string
): Promise<ConversationTurn[] | null> {
  const rows = await prisma.conversationTurn.findMany({
    where: { sessionId, session: { ownerId } },
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

/** Completed sessions for the owner, newest first. Abandoned and failed are not listed. */
export async function listSessionsFromDb(ownerId: string): Promise<
  {
    id: string;
    topicId: string;
    phase: string;
    startedAt: Date;
    endedAt: Date | null;
    turnCount: number;
    hasReport: boolean;
  }[]
> {
  const rows = await prisma.session.findMany({
    where: { ownerId, status: "complete" },
    orderBy: { startedAt: "desc" },
    include: { report: { select: { id: true } }, _count: { select: { turns: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    topicId: r.topicId,
    phase: r.phase,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    turnCount: r._count.turns,
    hasReport: r.report !== null,
  }));
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function persistSessionCreate(
  id: string,
  ownerId: string,
  topicId: string,
  phase: Phase
): Promise<void> {
  // Plain create: a duplicate id rejects loudly (ids are server-issued UUIDs).
  await prisma.session.create({
    data: { id, ownerId, topicId, phase, status: "active" },
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

/**
 * A session leaves "active" exactly once: only an active row is updated and endedAt is
 * stamped once. Returns true if a row changed. Target "active" is a no-op (returns false).
 */
export async function persistSessionStatus(
  sessionId: string,
  status: SessionStatus
): Promise<boolean> {
  if (status === "active") return false;
  const result = await prisma.session.updateMany({
    where: { id: sessionId, status: "active" },
    data: { status, endedAt: new Date() },
  });
  return result.count > 0;
}

/** Stores the report. Does not change the session status. */
export async function persistReport(sessionId: string, report: Report): Promise<void> {
  const data = {
    summary: report.summary,
    strengthsJson: JSON.stringify(report.strengths),
    improvementsJson: JSON.stringify(report.improvements),
    highlightsJson: JSON.stringify(report.highlights),
    overallAssessment: report.overallAssessment,
    generatedAt: report.generatedAt,
  };
  await prisma.report.upsert({
    where: { sessionId },
    update: data,
    create: { sessionId, ...data },
  });
}

// ── Deletion (cascades in code, one transaction) ─────────────────────────────

function deleteSessionsTx(ids: string[]) {
  return prisma.$transaction([
    prisma.conversationTurn.deleteMany({ where: { sessionId: { in: ids } } }),
    prisma.report.deleteMany({ where: { sessionId: { in: ids } } }),
    prisma.session.deleteMany({ where: { id: { in: ids } } }),
  ]);
}

/** Deletes a session with its turns and report. Returns false if not found for this owner. */
export async function deleteSessionFromDb(
  sessionId: string,
  ownerId: string
): Promise<boolean> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, ownerId },
    select: { id: true },
  });
  if (!session) return false;
  await deleteSessionsTx([sessionId]);
  return true;
}

/** Deletes sessions that ended more than `days` days ago. Returns the number deleted. */
export async function purgeOlderThan(days: number): Promise<number> {
  if (!Number.isFinite(days) || days <= 0) {
    throw new RangeError("days must be a finite number greater than 0");
  }
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const old = await prisma.session.findMany({
    where: { endedAt: { lt: cutoff } },
    select: { id: true },
  });
  if (old.length === 0) return 0;
  const [, , sessions] = await deleteSessionsTx(old.map((s) => s.id));
  return sessions.count;
}
