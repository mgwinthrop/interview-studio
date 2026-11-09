import express from "express";
import { errName } from "./errors";
import { route } from "./httpUtil";
import type { SettingsService } from "./settingsService";

// Routes under /api/settings, mounted behind the authenticator. Owner-scoped. Every error body
// is fixed text; values, model ids and provider text are never logged.

export interface SettingsRouterDeps {
  service: SettingsService;
  ownerOf: (res: express.Response) => string;
}

const BODY_LIMIT = "32kb";

export function createSettingsRouter(deps: SettingsRouterDeps): express.Router {
  const { service, ownerOf } = deps;
  const router = express.Router();

  router.use(express.json({ limit: BODY_LIMIT }));

  router.get(
    "/",
    route("settings-get", async (_req, res) => {
      res.json(await service.page(ownerOf(res)));
    }),
  );

  router.put(
    "/",
    route("settings-save", async (req, res) => {
      const result = await service.save(ownerOf(res), req.body);
      if (!result.ok) {
        res.status(422).json({ errors: result.errors });
        return;
      }
      res.json(result.page);
    }),
  );

  router.post(
    "/reset",
    route("settings-reset", async (_req, res) => {
      res.json(await service.reset(ownerOf(res)));
    }),
  );

  // Body-parser failures: their message can hold the submitted text, so the answer is fixed.
  router.use(
    (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      const type = (err as { type?: unknown } | null)?.type;
      if (res.headersSent) {
        next(err);
        return;
      }
      if (type === "entity.parse.failed") {
        res.status(400).json({ error: "Request body is not valid JSON." });
        return;
      }
      if (type === "entity.too.large") {
        res.status(413).json({ error: "Request body is too large." });
        return;
      }
      const status = (err as { status?: unknown } | null)?.status;
      if (typeof status === "number" && status >= 400 && status < 500) {
        console.warn(`[http] settings request refused ${status}: ${typeof type === "string" ? type : "unknown"}`);
        res.status(400).json({ error: "Bad request." });
        return;
      }
      console.error(`[http] settings error: ${errName(err)}`);
      res.status(500).json({ error: "Internal error" });
    },
  );

  return router;
}
