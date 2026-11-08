import express from "express";
import { callsEnabled, type Config } from "./config";
import { errName } from "./errors";
import { route } from "./httpUtil";
import { MAX_CALLS, MAX_CALLS_CHARS } from "./interviewer/designer";
import type { FieldError, InterviewerInput } from "./interviewer/schema";
import { CONTROL_CHARS } from "./interviewer/schema";
import { redactCall } from "./redaction/redact";
import { MAX_CALL_CHARS, parseTeamsTranscript, type ParsedCall } from "./redaction/teamsParser";

// Routes under /api/interviewers/calls. Mounted behind the authenticator, before the interviewers
// router. Parsing and redaction are local: no provider is called and nothing is stored, so they
// work with the cloud-send switch off. Call text is never logged; every error body is fixed text.

export type CallsDraftMaker = (
  ownerId: string,
  calls: { text: string; forbidden: string[] }[],
) => Promise<{ ok: true; draft: InterviewerInput } | { ok: false; status: 429 | 502 }>;

export interface CallsRouterDeps {
  config: Config;
  ownerOf: (res: express.Response) => string;
  /** Used by POST /draft only; the speakers and redact routes never call it. */
  makeCallsDraft: CallsDraftMaker;
}

const BODY_LIMIT = "256kb";
// Draft route only: up to MAX_CALLS calls of MAX_CALLS_CHARS each, plus their forbidden lists.
const DRAFT_BODY_LIMIT = "768kb";
const MAX_FORBIDDEN = 500;
const MAX_FORBIDDEN_CHARS = 120;
const MAX_TERMS = 50;
const MAX_TERM_CHARS = 80;

const NOT_OBJECT: FieldError[] = [{ path: "", message: "Request body must be a JSON object." }];
const TRANSCRIPT_ERRORS: Record<"no_speakers" | "too_long" | "empty" | "not_text", FieldError[]> = {
  no_speakers: [{ path: "transcript", message: "No speakers were found. Paste a Teams transcript with a name and time above each part." }],
  too_long: [{ path: "transcript", message: `The transcript is too long. The limit is ${MAX_CALL_CHARS} characters.` }],
  empty: [{ path: "transcript", message: "Paste a transcript." }],
  not_text: [{ path: "transcript", message: "The transcript must be text." }],
};
const BAD_COUNTERPART: FieldError[] = [{ path: "counterpart", message: "Choose one of the speakers in the transcript." }];
const BAD_TERMS: FieldError[] = [
  {
    path: "terms",
    message: `Must be a list of at most ${MAX_TERMS} terms, each text of at most ${MAX_TERM_CHARS} characters with no control characters or line breaks.`,
  },
];
const CALLS_OFF = { error: "Drafting from calls is turned off." };
const NOT_CONFIRMED: FieldError[] = [{ path: "confirmed", message: "Confirm what will be sent before drafting." }];
const BAD_CALLS: FieldError[] = [
  { path: "calls", message: `Must be a list of 1 to ${MAX_CALLS} calls, each with text and a list of forbidden strings.` },
];
const BAD_CALL_TEXT: FieldError[] = [
  {
    path: "calls.text",
    message: `Each call must be non-empty text of at most ${MAX_CALLS_CHARS} characters, with no control characters other than newlines.`,
  },
];
const BAD_FORBIDDEN: FieldError[] = [
  {
    path: "calls.forbidden",
    message: `Must be a list of at most ${MAX_FORBIDDEN} strings, each at most ${MAX_FORBIDDEN_CHARS} characters.`,
  },
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseTranscript(body: Record<string, unknown>): { ok: true; call: ParsedCall } | { ok: false; errors: FieldError[] } {
  if (typeof body.transcript !== "string") return { ok: false, errors: TRANSCRIPT_ERRORS.not_text };
  const parsed = parseTeamsTranscript(body.transcript);
  if (!parsed.ok) return { ok: false, errors: TRANSCRIPT_ERRORS[parsed.reason] };
  return { ok: true, call: parsed.call };
}

function validTerms(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length <= MAX_TERMS &&
    v.every((t) => typeof t === "string" && t.length <= MAX_TERM_CHARS && !CONTROL_CHARS.test(t) && !/[\r\n]/.test(t))
  );
}

export function createCallsRouter(deps: CallsRouterDeps): express.Router {
  const router = express.Router();

  // Declared before the 256kb parser below so this path alone gets the larger limit. The switch
  // is checked before the body is read at all, and nothing reaches the model before `confirmed`.
  router.post(
    "/draft",
    (_req, res, next) => {
      if (!callsEnabled(deps.config)) {
        console.warn("[http] draft from calls refused (403)");
        res.status(403).json(CALLS_OFF);
        return;
      }
      next();
    },
    express.json({ limit: DRAFT_BODY_LIMIT }),
    route("draft-from-calls", async (req, res) => {
      const body: unknown = req.body;
      if (!isPlainObject(body)) {
        res.status(422).json({ errors: NOT_OBJECT });
        return;
      }
      if (body.confirmed !== true) {
        res.status(422).json({ errors: NOT_CONFIRMED });
        return;
      }
      const raw = body.calls;
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CALLS || !raw.every(isPlainObject)) {
        res.status(422).json({ errors: BAD_CALLS });
        return;
      }
      const calls: { text: string; forbidden: string[] }[] = [];
      for (const c of raw as Record<string, unknown>[]) {
        const { text, forbidden } = c;
        if (
          typeof text !== "string" ||
          text.trim().length === 0 ||
          text.length > MAX_CALLS_CHARS ||
          CONTROL_CHARS.test(text)
        ) {
          res.status(422).json({ errors: BAD_CALL_TEXT });
          return;
        }
        if (
          !Array.isArray(forbidden) ||
          forbidden.length > MAX_FORBIDDEN ||
          !forbidden.every((f) => typeof f === "string" && f.length <= MAX_FORBIDDEN_CHARS)
        ) {
          res.status(422).json({ errors: BAD_FORBIDDEN });
          return;
        }
        calls.push({ text, forbidden: forbidden as string[] });
      }
      const result = await deps.makeCallsDraft(deps.ownerOf(res), calls);
      if (!result.ok) {
        console.warn(`[http] draft from calls (${result.status})`);
        res
          .status(result.status)
          .json({ error: result.status === 429 ? "a draft is already being made" : "Draft generation failed" });
        return;
      }
      console.log(`[http] drafted interviewer from ${calls.length} calls (200)`);
      res.json({ draft: result.draft });
    }),
  );

  router.use(express.json({ limit: BODY_LIMIT }));

  router.post(
    "/speakers",
    route("call-speakers", async (req, res) => {
      if (!isPlainObject(req.body)) {
        res.status(422).json({ errors: NOT_OBJECT });
        return;
      }
      const parsed = parseTranscript(req.body);
      if (!parsed.ok) {
        res.status(422).json({ errors: parsed.errors });
        return;
      }
      res.json({ speakers: parsed.call.speakers });
    }),
  );

  router.post(
    "/redact",
    route("call-redact", async (req, res) => {
      if (!isPlainObject(req.body)) {
        res.status(422).json({ errors: NOT_OBJECT });
        return;
      }
      const parsed = parseTranscript(req.body);
      if (!parsed.ok) {
        res.status(422).json({ errors: parsed.errors });
        return;
      }
      const { counterpart, terms } = req.body;
      // Same normalisation as redactCall uses for its roles.
      const norm = (s: string) => s.normalize("NFC").trim();
      if (typeof counterpart !== "string" || !parsed.call.speakers.some((s) => norm(s.name) === norm(counterpart))) {
        res.status(422).json({ errors: BAD_COUNTERPART });
        return;
      }
      if (!validTerms(terms)) {
        res.status(422).json({ errors: BAD_TERMS });
        return;
      }
      const { lines, text, suggestions, forbidden } = redactCall(parsed.call, counterpart, terms);
      res.json({ lines, text, suggestions, forbidden });
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
        console.warn(`[http] calls request refused ${status}: ${typeof type === "string" ? type : "unknown"}`);
        res.status(400).json({ error: "Bad request." });
        return;
      }
      console.error(`[http] calls error: ${errName(err)}`);
      res.status(500).json({ error: "Internal error" });
    },
  );

  return router;
}
