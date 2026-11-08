import http from "node:http";
import cors from "cors";
import express from "express";
import { createAuthenticator } from "./auth";
import { createCallsRouter, type CallsDraftMaker } from "./callsRoutes";
import { callsEnabled, type Config } from "./config";
import prisma from "./db";
import { withDeadline } from "./deadline";
import { errName } from "./errors";
import { ownerOf, route } from "./httpUtil";
import { createInterviewerRouter, type InterviewerRouterDeps } from "./interviewerRoutes";
import { generateDraft } from "./interviewer/designer";
import * as interviewerStore from "./interviewerStore";
import * as persistence from "./persistence";
import type { Providers } from "./providers/types";
import { createSessionRouter } from "./reportRoutes";
import { createMockCatalog, createModelCatalog } from "./modelCatalog";
import { createSettingsRouter } from "./settingsRoutes";
import { createSettingsService, type SettingsService } from "./settingsService";
import * as settingsStore from "./settingsStore";
import * as usage from "./usage";
import { createUsageRouter } from "./usageRoutes";
import { attachWebSocket } from "./wsServer";

export interface AppDeps {
  config: Config;
  providers: Providers;
  persist?: typeof persistence;
  interviewers?: typeof interviewerStore;
  /** Override for the settings service (tests). */
  settings?: SettingsService;
}

export interface App {
  server: http.Server;
  /** Ends live sessions as abandoned, closes every socket and stops the server. */
  close(): Promise<void>;
}

/**
 * The one-box draft maker behind POST /api/interviewers/draft. One draft per owner at a time
 * (an in-memory set, taken before the first await and released in finally); the call is bounded
 * by limits.reportTimeoutMs. A DraftError, a provider error or a timeout is 502; the cause is
 * logged by class name only, never the description or the draft.
 */
export function createDraftMaker(
  config: Config,
  llm: Providers["llm"],
): InterviewerRouterDeps["makeDraft"] {
  const drafting = new Set<string>();
  return async (ownerId, text) => {
    if (drafting.has(ownerId)) return { ok: false, status: 429 };
    drafting.add(ownerId);
    try {
      const outcome = await withDeadline(config.limits.reportTimeoutMs, (signal) =>
        generateDraft({ kind: "description", text }, llm, signal, { feature: "designer-draft", ownerId }),
      );
      if (!outcome.ok) {
        console.error(`[http] draft interviewer 502: ${outcome.why}`);
        return { ok: false, status: 502 };
      }
      return { ok: true, draft: outcome.value };
    } finally {
      drafting.delete(ownerId);
    }
  };
}

/**
 * Draft from approved calls. Same guards as createDraftMaker: one draft per owner (taken before
 * the first await), bounded by limits.reportTimeoutMs, 429 when busy, 502 on any failure. Only
 * the failure reason is logged, never call text, forbidden strings or the draft.
 */
export function createCallsDraftMaker(config: Config, llm: Providers["llm"]): CallsDraftMaker {
  const drafting = new Set<string>();
  return async (ownerId, calls) => {
    if (drafting.has(ownerId)) return { ok: false, status: 429 };
    drafting.add(ownerId);
    try {
      const outcome = await withDeadline(config.limits.reportTimeoutMs, (signal) =>
        generateDraft({ kind: "calls", calls }, llm, signal, { feature: "persona-draft", ownerId }),
      );
      if (!outcome.ok) {
        console.error(`[http] draft from calls 502: ${outcome.why}`);
        return { ok: false, status: 502 };
      }
      return { ok: true, draft: outcome.value };
    } finally {
      drafting.delete(ownerId);
    }
  };
}

export function createApp(deps: AppDeps): App {
  const { config, providers } = deps;
  const persist = deps.persist ?? persistence;
  const interviewers = deps.interviewers ?? interviewerStore;
  const authenticate = createAuthenticator(config);
  // The one settings service for this app; later wiring hands it to sessions and reports.
  const settings =
    deps.settings ??
    createSettingsService({
      store: settingsStore,
      catalog: config.profile === "mock" ? createMockCatalog() : createModelCatalog(config),
    });

  // ── HTTP ───────────────────────────────────────────────────────────────────

  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: config.allowedOrigins }));
  // Every route is behind the authenticator. CORS preflight (OPTIONS) is answered by cors()
  // above before this runs, which is correct: browsers send no credentials on preflight.
  // Never log req.url: it can carry ?token=.
  app.use((req, res, next) => {
    const result = authenticate(req);
    if (!result.ok) {
      res.status(result.status).json({ error: result.reason });
      return;
    }
    res.locals.ownerId = result.ownerId;
    next();
  });

  app.get("/api/features", (_req, res) => {
    res.json({ personaFromCalls: callsEnabled(config) });
  });

  // Before /api/interviewers so the interviewers router never captures /calls/...
  app.use(
    "/api/interviewers/calls",
    createCallsRouter({
      config,
      ownerOf,
      makeCallsDraft: createCallsDraftMaker(config, providers.llm),
    }),
  );

  app.use(
    "/api/interviewers",
    createInterviewerRouter({ store: interviewers, ownerOf, makeDraft: createDraftMaker(config, providers.llm) }),
  );

  app.get(
    "/health",
    route("health", async (_req, res) => {
      let database = false;
      try {
        await prisma.$queryRaw`SELECT 1`;
        database = true;
      } catch (err) {
        console.error(`[http] health database check failed: ${errName(err)}`);
      }
      res.status(database ? 200 : 503).json({
        status: database ? "ok" : "degraded",
        database,
        providers: { profile: config.profile },
      });
    }),
  );

  app.use("/api/usage", createUsageRouter({ usage }));

  app.use("/api/settings", createSettingsRouter({ service: settings, ownerOf }));

  // Transcript, report, regenerate, delete and the session list (absolute paths).
  app.use(createSessionRouter({ config, llm: providers.llm, persist }));

  const server = http.createServer(app);

  // ── WebSocket ──────────────────────────────────────────────────────────────

  const ws = attachWebSocket({ server, config, providers, persist, interviewers, authenticate });

  return {
    server,
    async close() {
      await ws.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err && (err as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(err);
          else resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}
