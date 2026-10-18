import prisma from "./db";
import { parseInterviewerDefinition, type InterviewerDefinition } from "./interviewer/schema";
import { ConversationTurn, Report, SessionStatus } from "./types";

// ── Read helpers (post-restart fallback for HTTP endpoints) ──────────────────
// Every query goes through the owning session so one owner never sees another's data.

/**
 * Parses a stored interviewer snapshot. Null when there is none (sessions from before
 * interviewers) or when it is unparsable or invalid; never throws and never logs its text.
 */
function parseSnapshot(json: string | null): InterviewerDefinition | null {
  if (json === null) return null;
  try {
    return parseInterviewerDefinition(JSON.parse(json));
  } catch {
    return null;
  }
}

/** The interviewer's name from a stored snapshot, or null (see parseSnapshot). */
function snapshotName(json: string | null): string | null {
  return parseSnapshot(json)?.name ?? null;
}

/**
 * The interviewer definition a session was started with, for a session owned by ownerId.
 * Null for another owner's or an unknown session, and for a missing or invalid snapshot.
 */
export async function readSnapshot(
  sessionId: string,
  ownerId: string
): Promise<InterviewerDefinition | null> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, ownerId },
    select: { interviewerJson: true },
  });
  return session ? parseSnapshot(session.interviewerJson) : null;
}

/**
 * Returns { report, sessionStatus, interviewerName } for a session owned by ownerId, or null if
 * the session does not exist or belongs to someone else.
 * report is null when the session exists but report generation hasn't completed.
 * interviewerName is null for sessions without a (valid) snapshot.
 */
export async function readReportFromDb(
  sessionId: string,
  ownerId: string
): Promise<{ report: Report | null; sessionStatus: string; interviewerName: string | null } | null> {
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

  return {
    report,
    sessionStatus: session.status,
    interviewerName: snapshotName(session.interviewerJson),
  };
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
    phase: r.phase,
    timestamp: r.timestamp,
  }));
}

/**
 * Completed sessions for the owner, newest first. Abandoned and failed are not listed.
 * interviewerName is null for sessions without a (valid) snapshot.
 */
export async function listSessionsFromDb(ownerId: string): Promise<
  {
    id: string;
    interviewerId: string;
    interviewerName: string | null;
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
    interviewerId: r.interviewerId,
    interviewerName: snapshotName(r.interviewerJson),
    phase: r.phase,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    turnCount: r._count.turns,
    hasReport: r.report !== null,
  }));
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Creates the session row with its interviewer snapshot, in its first phase. */
export async function persistSessionCreate(
  id: string,
  ownerId: string,
  interviewer: InterviewerDefinition
): Promise<void> {
  // Plain create: a duplicate id rejects loudly (ids are server-issued UUIDs).
  await prisma.session.create({
    data: {
      id,
      ownerId,
      interviewerId: interviewer.id,
      interviewerJson: JSON.stringify(interviewer),
      phase: interviewer.phases[0].name,
      status: "active",
    },
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
  phase: string
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

/**
 * Startup sweep for a single-instance server: no session is live at boot, so any row still
 * "active" was left by a crash or restart. Marks them abandoned with endedAt now (so the
 * report route stops answering 202 and retention can purge them). Returns the count.
 */
export async function abandonStaleActiveSessions(): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { status: "active" },
    data: { status: "abandoned", endedAt: new Date() },
  });
  return result.count;
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
