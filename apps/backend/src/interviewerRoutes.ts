import express from "express";
import { MAX_DESCRIPTION_CHARS } from "./interviewer/designer";
import {
  parseInterviewerInput,
  type FieldError,
  type InterviewerDefinition,
  type InterviewerInput,
} from "./interviewer/schema";
import * as interviewerStore from "./interviewerStore";

// Routes under /api/interviewers. Mounted behind the authenticator; the owner comes from
// ownerOf(res). Every response body is fixed text or stored data: submitted values are never
// echoed, and logs carry ids and statuses only.

export interface InterviewerRouterDeps {
  store: typeof interviewerStore;
  /** One-box draft: 429 when this owner already has one in flight, 502 on any failure. */
  makeDraft: (
    ownerId: string,
    description: string,
  ) => Promise<{ ok: true; draft: InterviewerInput } | { ok: false; status: 429 | 502 }>;
  ownerOf: (res: express.Response) => string;
}

const BODY_LIMIT = "64kb";
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const NOT_FOUND = { error: "Interviewer not found" };
const PRESET_LOCKED = { error: "presets cannot be changed" };
const NOT_OBJECT: FieldError[] = [{ path: "", message: "Request body must be a JSON object." }];
const LIMIT_REACHED: FieldError[] = [{ path: "", message: `limit of ${interviewerStore.MAX_CUSTOM_PER_OWNER} custom interviewers reached` }];
const BAD_DESCRIPTION: FieldError[] = [
  {
    path: "description",
    message: `Must be text of 1 to ${MAX_DESCRIPTION_CHARS} characters, with no control characters other than newlines.`,
  },
];
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const BAD_VERSION: FieldError = { path: "version", message: "Must be a whole number of at least 1." };

type Handler = (req: express.Request<{ id: string }>, res: express.Response) => Promise<void>;

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** Express 4 does not catch rejected handlers: log the error class and answer 500. */
function route(name: string, fn: Handler): Handler {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`[http] ${name} error: ${errName(err)}`);
      if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    }
  };
}

/** The record as sent to clients: every field except ownerId. */
function toResponse(def: InterviewerDefinition) {
  return {
    id: def.id,
    name: def.name,
    purpose: def.purpose,
    source: def.source,
    persona: def.persona,
    style: def.style,
    opening: def.opening,
    closing: def.closing,
    phases: def.phases,
    focus: def.focus,
    contentFeedback: def.contentFeedback,
    deliveryFeedback: def.deliveryFeedback,
    ...(def.voice !== undefined ? { voice: def.voice } : {}),
    version: def.version,
    createdAt: def.createdAt,
    updatedAt: def.updatedAt,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A well-formed route id; anything else is answered 404 without touching the store. */
function validId(req: express.Request<{ id: string }>, res: express.Response): string | null {
  const { id } = req.params;
  if (typeof id === "string" && ID_RE.test(id)) return id;
  res.status(404).json(NOT_FOUND);
  return null;
}

export function createInterviewerRouter(deps: InterviewerRouterDeps): express.Router {
  const { store, ownerOf, makeDraft } = deps;
  const router = express.Router();
  router.use(express.json({ limit: BODY_LIMIT }));

  router.get(
    "/",
    route("list-interviewers", async (_req, res) => {
      res.json(await store.listInterviewers(ownerOf(res)));
    }),
  );

  router.get(
    "/:id",
    route("get-interviewer", async (req, res) => {
      const id = validId(req, res);
      if (id === null) return;
      const def = await store.getInterviewer(id, ownerOf(res));
      if (!def) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      res.json(toResponse(def));
    }),
  );

  router.post(
    "/",
    route("create-interviewer", async (req, res) => {
      if (!isPlainObject(req.body)) {
        res.status(422).json({ errors: NOT_OBJECT });
        return;
      }
      const parsed = parseInterviewerInput(req.body);
      if (!parsed.ok) {
        res.status(422).json({ errors: parsed.errors });
        return;
      }
      try {
        const def = await store.createInterviewer(ownerOf(res), parsed.value);
        console.log(`[http] created interviewer ${def.id} (201)`);
        res.status(201).json(toResponse(def));
      } catch (err) {
        if (!(err instanceof store.InterviewerLimitError)) throw err;
        res.status(422).json({ errors: LIMIT_REACHED });
      }
    }),
  );

  router.put(
    "/:id",
    route("update-interviewer", async (req, res) => {
      const id = validId(req, res);
      if (id === null) return;
      if (!isPlainObject(req.body)) {
        res.status(422).json({ errors: NOT_OBJECT });
        return;
      }
      const { version, ...rest } = req.body;
      const versionOk = typeof version === "number" && Number.isInteger(version) && version >= 1;
      const parsed = parseInterviewerInput(rest);
      if (!versionOk || !parsed.ok) {
        const errors = [...(versionOk ? [] : [BAD_VERSION]), ...(parsed.ok ? [] : parsed.errors)];
        res.status(422).json({ errors });
        return;
      }
      const result = await store.updateInterviewer(id, ownerOf(res), parsed.value, version);
      switch (result.status) {
        case "ok":
          console.log(`[http] updated interviewer ${id} to version ${result.value.version} (200)`);
          res.json(toResponse(result.value));
          return;
        case "preset":
          res.status(403).json(PRESET_LOCKED);
          return;
        case "conflict":
          res.status(409).json({ error: "version conflict" });
          return;
        default:
          res.status(404).json(NOT_FOUND);
      }
    }),
  );

  // Declared before /:id/duplicate. The description is never logged or echoed.
  router.post(
    "/draft",
    route("draft-interviewer", async (req, res) => {
      const description = isPlainObject(req.body) ? req.body.description : undefined;
      const text = typeof description === "string" ? description.trim() : "";
      if (text.length === 0 || text.length > MAX_DESCRIPTION_CHARS || CONTROL_CHARS.test(text)) {
        res.status(422).json({ errors: isPlainObject(req.body) ? BAD_DESCRIPTION : NOT_OBJECT });
        return;
      }
      const result = await makeDraft(ownerOf(res), text);
      if (!result.ok) {
        console.warn(`[http] draft interviewer (${result.status})`);
        res
          .status(result.status)
          .json({ error: result.status === 429 ? "a draft is already being made" : "Draft generation failed" });
        return;
      }
      console.log("[http] drafted interviewer (200)");
      res.json({ draft: result.draft });
    }),
  );

  router.post(
    "/:id/duplicate",
    route("duplicate-interviewer", async (req, res) => {
      const id = validId(req, res);
      if (id === null) return;
      try {
        const def = await store.duplicateInterviewer(id, ownerOf(res));
        if (!def) {
          res.status(404).json(NOT_FOUND);
          return;
        }
        console.log(`[http] duplicated interviewer ${id} as ${def.id} (201)`);
        res.status(201).json(toResponse(def));
      } catch (err) {
        if (!(err instanceof store.InterviewerLimitError)) throw err;
        res.status(422).json({ errors: LIMIT_REACHED });
      }
    }),
  );

  router.delete(
    "/:id",
    route("delete-interviewer", async (req, res) => {
      const id = validId(req, res);
      if (id === null) return;
      const result = await store.deleteInterviewer(id, ownerOf(res));
      if (result === "preset") {
        res.status(403).json(PRESET_LOCKED);
        return;
      }
      if (result === "not_found") {
        res.status(404).json(NOT_FOUND);
        return;
      }
      console.log(`[http] deleted interviewer ${id} (204)`);
      res.status(204).end();
    }),
  );

  // Body-parser failures. Their message and `body` can hold the submitted text, so the answer
  // is fixed and only the error type is logged.
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
        console.warn(`[http] interviewers request refused ${status}: ${typeof type === "string" ? type : "unknown"}`);
        res.status(400).json({ error: "Bad request." });
        return;
      }
      console.error(`[http] interviewers error: ${errName(err)}`);
      res.status(500).json({ error: "Internal error" });
    },
  );

  return router;
}
