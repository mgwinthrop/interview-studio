import express from "express";
import { ownerOf, route } from "./httpUtil";
import { ID_SHAPE } from "./interviewer/schema";
import type * as usage from "./usage";

export interface UsageRoutesDeps {
  usage: Pick<typeof usage, "summarizeUsage" | "usageForSession" | "usageTrend">;
}

const DAYS_ERROR = [{ path: "days", message: "days must be a whole number from 1 to 365" }];
/** The same body as the session routes for malformed ids. */
const NOT_FOUND = { error: "Session not found" } as const;

/** `days` from the query: default 30, else a whole number 1..365; null when invalid. */
function parseDays(raw: unknown): number | null {
  if (raw === undefined) return 30;
  if (typeof raw !== "string" || !/^[0-9]{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 365 ? n : null;
}

/** Owner-scoped LLM usage: numbers only. Mounted at /api/usage behind the authenticator. */
export function createUsageRouter(deps: UsageRoutesDeps): express.Router {
  const router = express.Router();

  router.get(
    "/summary",
    route("usage-summary", async (req, res) => {
      const days = parseDays(req.query.days);
      if (days === null) {
        res.status(422).json({ errors: DAYS_ERROR });
        return;
      }
      res.json(await deps.usage.summarizeUsage(ownerOf(res), days));
    }),
  );

  router.get(
    "/trend",
    route("usage-trend", async (req, res) => {
      const days = parseDays(req.query.days);
      if (days === null) {
        res.status(422).json({ errors: DAYS_ERROR });
        return;
      }
      res.json(await deps.usage.usageTrend(ownerOf(res), days));
    }),
  );

  router.get(
    "/session/:sessionId",
    route("usage-session", async (req, res) => {
      const { sessionId } = req.params;
      if (!ID_SHAPE.test(sessionId)) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      res.json(await deps.usage.usageForSession(ownerOf(res), sessionId));
    }),
  );

  return router;
}
