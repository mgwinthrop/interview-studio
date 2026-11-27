import express from "express";
import type { Config } from "./config";
import { route } from "./httpUtil";

/**
 * One session's delivery numbers on the Progress page (FQ-52). Filled from each report's
 * stored delivery summary in a later slice; see docs/factory/specs/FQ-52/03-design.md.
 */
export interface TrendPoint {
  sessionId: string;
  startedAt: string;
  interviewerId: string;
  interviewerName: string | null;
  answersMeasured: number;
  paceWpm: number | null;
  gapMs: number | null;
  longestPauseSec: number | null;
  answerWords: number | null;
  /** Present only when showFillers is true. */
  fillersPer100Words?: number | null;
}

export interface TrendResponse {
  showFillers: boolean;
  sessions: TrendPoint[];
}

export interface DeliveryTrendDeps {
  config: Pick<Config, "reportFillerCounts">;
}

/**
 * GET /api/delivery/trend, mounted after the authenticator so it is owner-scoped like every
 * other route. This slice (FQ-52 S0) returns no sessions yet.
 */
export function createDeliveryTrendRouter(deps: DeliveryTrendDeps): express.Router {
  const router = express.Router();
  router.get(
    "/api/delivery/trend",
    route("delivery-trend", async (_req, res) => {
      const body: TrendResponse = { showFillers: deps.config.reportFillerCounts, sessions: [] };
      res.json(body);
    }),
  );
  return router;
}
