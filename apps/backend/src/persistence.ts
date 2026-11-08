import { Prisma } from "@prisma/client";
import prisma from "./db";
import { parseInterviewerDefinition, type InterviewerDefinition } from "./interviewer/schema";
import type { TurnMetrics } from "./delivery/metrics";
import type { AnyReport, ConversationTurn, ReportV1, ReportV2, SessionStatus } from "./types";

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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNumOrNull = (v: unknown): boolean => v === null || isNum(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isArrayOf = (v: unknown, check: (item: Record<string, unknown>) => boolean): boolean =>
  Array.isArray(v) && v.every((item) => isRecord(item) && check(item));

/** Parses stored turn metrics. Null when absent, unparsable or the wrong shape; never throws or logs. */
function parseMetrics(json: string | null): TurnMetrics | null {
  if (json === null) return null;
  try {
    const m: unknown = JSON.parse(json);
    if (
      isRecord(m) &&
      isNum(m.wordCount) &&
      isNum(m.timedWordCount) &&
      isNumOrNull(m.durationSec) &&
      isNumOrNull(m.wordsPerMinute) &&
      isNumOrNull(m.pauseCount) &&
      isNumOrNull(m.longestPauseSec) &&
      isNumOrNull(m.responseGapMs) &&
      isNumOrNull(m.fillerCount)
    ) {
      return m as unknown as TurnMetrics;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parses a stored v2 report, reviving generatedAt. Checks the structure the readers rely on;
 * null when absent, unparsable or invalid. Never throws and never logs its text.
 */
function parseReportV2(json: string | null): ReportV2 | null {
  if (json === null) return null;
  try {
    const r: unknown = JSON.parse(json);
    if (!isRecord(r) || r.format !== 2 || !isStr(r.sessionId) || !isStr(r.generatedAt)) return null;
    const generatedAt = new Date(r.generatedAt);
    if (Number.isNaN(generatedAt.getTime()) || !isStrArray(r.nextSteps)) return null;
    if (r.content !== undefined) {
      const c = r.content;
      if (
        !isRecord(c) ||
        !isStr(c.summary) ||
        !isArrayOf(c.strengths, (x) => isStr(x.area) && isStr(x.quote) && isStr(x.note)) ||
        !isArrayOf(c.developAreas, (x) => isStr(x.area) && isStr(x.suggestion))
      ) {
        return null;
      }
    }
    if (r.delivery !== undefined) {
      const d = r.delivery;
      // `reading` is optional: it is omitted when it failed the reading check.
      if (
        !isRecord(d) ||
        (d.reading !== undefined && !isStr(d.reading)) ||
        !isRecord(d.summary) ||
        !Array.isArray(d.summary.perTurn)
      ) {
        return null;
      }
    }
    return { ...(r as unknown as ReportV2), generatedAt };
  } catch {
    return null;
  }
}

/** The v1 report from the older columns. Null if their JSON is unreadable. */
function olderReport(row: {
  sessionId: string;
  summary: string;
  strengthsJson: string;
  improvementsJson: string;
  highlightsJson: string;
  overallAssessment: string;
  generatedAt: Date;
}): ReportV1 | null {
  try {
    return {
      format: 1,
      sessionId: row.sessionId,
      summary: row.summary,
      strengths: JSON.parse(row.strengthsJson),
      improvements: JSON.parse(row.improvementsJson),
      highlights: JSON.parse(row.highlightsJson),
      overallAssessment: row.overallAssessment,
      generatedAt: row.generatedAt,
    };
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
): Promise<{ report: AnyReport | null; sessionStatus: string; interviewerName: string | null } | null> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, ownerId },
    include: { report: true },
  });
  if (!session) return null;

  const report = session.report
    ? (parseReportV2(session.report.reportJson) ?? olderReport(session.report))
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
    metrics: parseMetrics(r.metricsJson),
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
  // Absent metrics leave the column NULL on create and untouched on update.
  const metricsJson =
    typeof turn.metrics === "object" && turn.metrics !== null ? JSON.stringify(turn.metrics) : undefined;
  await prisma.conversationTurn.upsert({
    where: { id: turn.id },
    update: {
      content: turn.content,
      phase: turn.phase,
      metricsJson,
    },
    create: {
      id: turn.id,
      sessionId: turn.sessionId,
      role: turn.role,
      content: turn.content,
      phase: turn.phase,
      timestamp: turn.timestamp,
      metricsJson,
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

/**
 * Stores the report as JSON and also fills the older columns (which are NOT NULL), so older
 * readers keep working. Does not change the session status.
 */
export async function persistReport(sessionId: string, report: ReportV2): Promise<void> {
  await upsertReport(prisma, sessionId, report);
}

/** The report upsert shared by persistReport and completeFailedSession (client or transaction). */
async function upsertReport(
  db: Pick<Prisma.TransactionClient, "report">,
  sessionId: string,
  report: ReportV2
): Promise<void> {
  const data = {
    reportJson: JSON.stringify(report),
    summary: report.content?.summary ?? "",
    strengthsJson: JSON.stringify(
      (report.content?.strengths ?? []).map((s) => ({ area: s.area, evidence: s.quote }))
    ),
    improvementsJson: JSON.stringify(
      (report.content?.developAreas ?? []).map((d) => ({ area: d.area, suggestion: d.suggestion }))
    ),
    highlightsJson: "[]",
    overallAssessment: report.nextSteps.join(" "),
    generatedAt: report.generatedAt,
  };
  await db.report.upsert({
    where: { sessionId },
    update: data,
    create: { sessionId, ...data },
  });
}

/** Thrown inside completeFailedSession's transaction to roll it back; never escapes. */
class NotFailed extends Error {}

/**
 * Regenerate's write: in one transaction, stores the report (as persistReport does) and moves
 * the session from "failed" to "complete", only when it is failed and owned by ownerId. If the
 * status does not change (any other status, another owner's or an unknown session) the whole
 * transaction is rolled back, so no report is left behind, and the result is false. endedAt is
 * kept. This is the only way out of "failed"; persistSessionStatus's rule is unchanged.
 */
export async function completeFailedSession(
  sessionId: string,
  ownerId: string,
  report: ReportV2
): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      await upsertReport(tx, sessionId, report);
      const changed = await tx.session.updateMany({
        where: { id: sessionId, ownerId, status: "failed" },
        data: { status: "complete" },
      });
      if (changed.count === 0) throw new NotFailed();
    });
    return true;
  } catch (err) {
    if (err instanceof NotFailed) return false;
    // The session was deleted meanwhile (or never existed): the report's foreign key fails.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") return false;
    throw err;
  }
}

// ── Deletion (cascades in code, one transaction) ─────────────────────────────

function deleteSessionsTx(ids: string[]) {
  return prisma.$transaction([
    prisma.conversationTurn.deleteMany({ where: { sessionId: { in: ids } } }),
    prisma.report.deleteMany({ where: { sessionId: { in: ids } } }),
    prisma.session.deleteMany({ where: { id: { in: ids } } }),
    prisma.llmUsage.deleteMany({ where: { sessionId: { in: ids } } }),
  ]);
}

/** Deletes a session with its turns, report and usage rows. Returns false if not found for this owner. */
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

/**
 * Deletes sessions that ended more than `days` days ago, and LLM usage rows recorded before the
 * same cutoff. Returns the number of sessions deleted.
 */
export async function purgeOlderThan(days: number): Promise<number> {
  if (!Number.isFinite(days) || days <= 0) {
    throw new RangeError("days must be a finite number greater than 0");
  }
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await prisma.llmUsage.deleteMany({ where: { at: { lt: cutoff } } });
  const old = await prisma.session.findMany({
    where: { endedAt: { lt: cutoff } },
    select: { id: true },
  });
  if (old.length === 0) return 0;
  const [, , sessions] = await deleteSessionsTx(old.map((s) => s.id));
  return sessions.count;
}
