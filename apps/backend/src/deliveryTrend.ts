import express from "express";
import type { Config } from "./config";
import { route } from "./httpUtil";

/**
 * GET /api/delivery/trend (FQ-52): delivery numbers across sessions for the Progress page.
 * Mounted after the authenticator, so it is owner-scoped like every other route. Sessions
 * come from stored reports in a later slice (docs/factory/specs/FQ-52/03-design.md).
 */
export function createDeliveryTrendRouter(deps: { config: Pick<Config, "reportFillerCounts"> }): express.Router {
  const router = express.Router();
  router.get(
    "/api/delivery/trend",
    route("delivery-trend", async (_req, res) => {
      res.json({ showFillers: deps.config.reportFillerCounts, sessions: [] });
    }),
  );
  return router;
}
