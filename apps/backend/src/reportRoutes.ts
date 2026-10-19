import express from "express";
import type { Config } from "./config";
import { withDeadline } from "./deadline";
import { ownerOf, route } from "./httpUtil";
import { ID_SHAPE, type InterviewerDefinition } from "./interviewer/schema";
import type * as persistence from "./persistence";
import type { Providers } from "./providers/types";
import { generateReport } from "./reportGenerator";
import * as registry from "./sessionRegistry";
import type { AnyReport, ConversationTurn, ReportV2 } from "./types";

export interface SessionRoutesDeps {
  config: Pick<Config, "limits" | "reportFillerCounts">;
  llm: Providers["llm"];
  persist: typeof persistence;
}

/** One body for unknown, foreign and malformed sessions, so none can be told apart. */
const NOT_FOUND = { error: "Session not found" } as const;
const GENERATION_FAILED = "Report generation failed";

/** The report JSON served by GET and by regenerate: the report plus interviewerName. */
function reportBody(report: AnyReport, interviewerName: string | null) {
  return { ...report, interviewerName };
}

/** 409 for every reason a regenerate is refused; the reason is logged, never sent. */
function refuseRegenerate(res: express.Response, sessionId: string, why: string): void {
  console.warn(`[http] regenerate ${sessionId} 409: ${why}`);
  res.status(409).json({ error: "report cannot be regenerated" });
}

/**
 * The session and report routes: transcript, report (legacy and REST paths), regenerate,
 * delete and the session list. Paths are absolute, so the router is mounted at the root.
 */
export function createSessionRouter(deps: SessionRoutesDeps): express.Router {
  const { config, llm, persist } = deps;
  const router = express.Router();

  router.get(
    "/api/session/:sessionId/transcript",
    route("transcript", async (req, res) => {
      const { sessionId } = req.params;
      const turns = await persist.readTurnsFromDb(sessionId, ownerOf(res));
      if (!turns) {
        res.status(404).json({ error: "Session not found or has no turns" });
        return;
      }
      const text = turns
        .map((t) => `${t.role === "user" ? "Participant" : "Interviewer"}: ${t.content}`)
        .join("\n\n");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="transcript-${sessionId}.txt"`);
      res.send(text);
    }),
  );

  /**
   * What regenerate needs, for a session owned by ownerId: its stored turns (with metrics)
   * when there is at least one user turn, and a valid snapshot. Null when either is missing.
   */
  async function regenerateInputs(
    sessionId: string,
    ownerId: string,
  ): Promise<{ turns: ConversationTurn[]; interviewer: InterviewerDefinition } | null> {
    const [turns, interviewer] = await Promise.all([
      persist.readTurnsFromDb(sessionId, ownerId),
      persist.readSnapshot(sessionId, ownerId),
    ]);
    if (!turns || !turns.some((t) => t.role === "user") || !interviewer) return null;
    return { turns, interviewer };
  }

  const reportHandler = route("report", async (req, res) => {
    const { sessionId } = req.params;
    const ownerId = ownerOf(res);
    const found = await persist.readReportFromDb(sessionId, ownerId);
    if (!found) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    if (found.sessionStatus === "active") {
      res.status(202).json({ status: "generating" });
      return;
    }
    if (found.sessionStatus === "complete") {
      if (found.report) res.json(reportBody(found.report, found.interviewerName));
      else res.status(500).json({ status: "unreadable", error: "The report could not be read" });
      return;
    }
    if (found.sessionStatus === "abandoned") {
      res.status(500).json({ status: "abandoned", error: GENERATION_FAILED });
      return;
    }
    const canRegenerate = (await regenerateInputs(sessionId, ownerId)) !== null;
    res.status(500).json({ status: "failed", error: GENERATION_FAILED, canRegenerate });
  });
  // Legacy path used by the report page, and the REST path used by the dashboard.
  router.get("/report/:sessionId", reportHandler);
  router.get("/api/session/:sessionId/report", reportHandler);

  /** Owner-scoped keys (owner, session) of regenerations in flight for this router. */
  const regenerating = new Set<string>();

  router.post(
    "/api/session/:sessionId/report/regenerate",
    route("regenerate", async (req, res) => {
      const { sessionId } = req.params;
      const ownerId = ownerOf(res);
      if (!ID_SHAPE.test(sessionId)) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      // Taken before the first await, so of two concurrent requests only one can hold it. The
      // key includes the owner: another owner's request never touches this session's lock, and
      // a held lock is reported only after the ownership check, so it reveals nothing.
      const key = `${ownerId}\u0000${sessionId}`;
      const held = regenerating.has(key);
      if (!held) regenerating.add(key);
      try {
        const found = await persist.readReportFromDb(sessionId, ownerId);
        if (!found) {
          res.status(404).json(NOT_FOUND);
          return;
        }
        if (held || found.sessionStatus !== "failed") {
          refuseRegenerate(res, sessionId, held ? "in flight" : "not failed");
          return;
        }
        const inputs = await regenerateInputs(sessionId, ownerId);
        if (!inputs) {
          refuseRegenerate(res, sessionId, "no user turns or snapshot");
          return;
        }

        const outcome = await generateWithDeadline(inputs.turns, inputs.interviewer);
        if (!outcome.ok) {
          console.error(`[http] regenerate ${sessionId} 502: ${outcome.why}`);
          res.status(502).json({ status: "failed", error: GENERATION_FAILED });
          return;
        }
        if (!(await persist.completeFailedSession(sessionId, ownerId, outcome.report))) {
          refuseRegenerate(res, sessionId, "no longer failed");
          return;
        }
        console.log(`[http] regenerate ${sessionId} 200`);
        res.json(reportBody(outcome.report, found.interviewerName));
      } finally {
        if (!held) regenerating.delete(key);
      }
    }),
  );

  /**
   * Runs the report call bounded by limits.reportTimeoutMs, as SessionController.finish()
   * does: an unref'd timer races the work and aborts it. The deadline does not rely on the
   * provider honouring the abort; a late result is dropped here and never written.
   */
  async function generateWithDeadline(
    turns: ConversationTurn[],
    interviewer: InterviewerDefinition,
  ): Promise<{ ok: true; report: ReportV2 } | { ok: false; why: string }> {
    const outcome = await withDeadline(config.limits.reportTimeoutMs, (signal) =>
      generateReport(turns, interviewer, llm, signal, {
        showFillerCounts: config.reportFillerCounts,
      }),
    );
    return outcome.ok ? { ok: true, report: outcome.value } : outcome;
  }

  router.delete(
    "/api/session/:sessionId",
    route("delete-session", async (req, res) => {
      const { sessionId } = req.params;
      const ownerId = ownerOf(res);
      // Only the owner's own live session is reported as active; a foreign one is a plain 404.
      if (registry.get(sessionId)?.ownerId === ownerId) {
        res.status(409).json({ error: "session is active" });
        return;
      }
      const deleted = await persist.deleteSessionFromDb(sessionId, ownerId);
      if (!deleted) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      console.log(`[http] deleted session ${sessionId} (204)`);
      res.status(204).end();
    }),
  );

  router.get(
    "/api/sessions",
    route("sessions", async (_req, res) => {
      const rows = await persist.listSessionsFromDb(ownerOf(res));
      const sessions = rows.map((s) => {
        const endedAt = s.endedAt ?? s.startedAt;
        return {
          id: s.id,
          interviewerId: s.interviewerId,
          interviewerName: s.interviewerName,
          startedAt: s.startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMinutes: Math.round((endedAt.getTime() - s.startedAt.getTime()) / 60000),
          turnCount: s.turnCount,
          hasReport: s.hasReport,
        };
      });
      const totalSessions = sessions.length;
      const personasUsed = new Set(sessions.map((s) => s.interviewerId)).size;
      const avgDurationMinutes =
        totalSessions > 0
          ? Math.round(sessions.reduce((sum, s) => sum + s.durationMinutes, 0) / totalSessions)
          : 0;
      res.json({ sessions, stats: { totalSessions, personasUsed, avgDurationMinutes } });
    }),
  );

  return router;
}
