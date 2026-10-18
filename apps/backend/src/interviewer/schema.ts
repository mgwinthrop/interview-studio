import { z } from "zod";

export const SYSTEM_OWNER = "system";

export interface PhaseDefinition {
  name: string;
  instruction: string;
  minTurns?: number;
  maxTurns?: number;
}

export interface InterviewerInput {
  name: string;
  purpose: string;
  persona: string;
  style: string;
  opening: string;
  closing: string;
  phases: PhaseDefinition[];
  focus: string[];
  contentFeedback: boolean;
  deliveryFeedback: boolean;
  voice?: { cloud?: string };
}

export interface InterviewerDefinition extends InterviewerInput {
  id: string;
  source: "preset" | "custom";
  ownerId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewerSummary {
  id: string;
  name: string;
  purpose: string;
  source: "preset" | "custom";
  version: number;
}

export type FieldError = { path: string; message: string };

// Line endings are normalised first (CRLF and lone CR become LF). Then every remaining control
// character is rejected, including tab: U+0000-U+0008, U+0009, U+000B-U+001F and U+007F.
// Newline (U+000A) is allowed.
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F]/;

const MSG = {
  required: "This field is required.",
  type: "Wrong type for this field.",
  control: "Control characters are not allowed.",
  unknownKey: "Unknown field.",
  invalid: "Invalid value.",
  voice: "Voice id must be 10 to 40 letters and digits.",
  integer: "Must be a whole number.",
  turnsRange: "Must be between 1 and 50.",
  maxBelowMin: "Must not be less than minTurns.",
  duplicatePhase: "Phase names must be unique.",
  turnsRequired: "Required on every phase except the last.",
  turnsForbidden: "Not allowed on the last phase.",
  date: "Must be an ISO date string.",
  id: "Must be letters, digits, underscore or hyphen.",
  feedbackOff: "Turn on content or delivery feedback (or both).",
};

const tooLong = (cap: number) => `Must be at most ${cap} characters.`;

function text(cap: number) {
  return z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : v),
    z
      .string({ invalid_type_error: MSG.type, required_error: MSG.required })
      .min(1, MSG.required)
      .max(cap, tooLong(cap))
      .refine((s) => !CONTROL_CHARS.test(s), MSG.control),
  );
}

const turns = z
  .number({ invalid_type_error: MSG.type })
  .int(MSG.integer)
  .min(1, MSG.turnsRange)
  .max(50, MSG.turnsRange);

const phaseSchema = z
  .object({
    name: text(40),
    instruction: text(1200),
    minTurns: turns.optional(),
    maxTurns: turns.optional(),
  })
  .strict();

const inputShape = {
  name: text(60),
  purpose: text(200),
  persona: text(1500),
  style: text(600),
  opening: text(400),
  closing: text(400),
  phases: z
    .array(phaseSchema, { invalid_type_error: MSG.type, required_error: MSG.required })
    .min(1, "At least 1 phase is required.")
    .max(8, "At most 8 phases are allowed.")
    .superRefine((phases, ctx) => {
      // Phase names identify phases on the wire and in stored turns, so they must be unique
      // (case-insensitive; names are already trimmed). The later duplicate is reported.
      const seen = new Set<string>();
      phases.forEach((p, i) => {
        if (typeof p.name !== "string") return;
        const key = p.name.trim().toLowerCase();
        if (seen.has(key)) {
          ctx.addIssue({ code: "custom", path: [i, "name"], message: MSG.duplicatePhase });
        }
        seen.add(key);
      });
      phases.forEach((p, i) => {
        const last = i === phases.length - 1;
        if (last) {
          for (const k of ["minTurns", "maxTurns"] as const) {
            if (p[k] !== undefined) {
              ctx.addIssue({ code: "custom", path: [i, k], message: MSG.turnsForbidden });
            }
          }
          return;
        }
        for (const k of ["minTurns", "maxTurns"] as const) {
          if (p[k] === undefined) {
            ctx.addIssue({ code: "custom", path: [i, k], message: MSG.turnsRequired });
          }
        }
        if (p.minTurns !== undefined && p.maxTurns !== undefined && p.maxTurns < p.minTurns) {
          ctx.addIssue({ code: "custom", path: [i, "maxTurns"], message: MSG.maxBelowMin });
        }
      });
    }),
  focus: z
    .array(text(120), { invalid_type_error: MSG.type, required_error: MSG.required })
    .max(6, "At most 6 focus items are allowed."),
  contentFeedback: z.boolean({ invalid_type_error: MSG.type }).default(true),
  deliveryFeedback: z.boolean({ invalid_type_error: MSG.type }).default(true),
  voice: z
    .object({
      cloud: z
        .string({ invalid_type_error: MSG.type })
        .regex(/^[A-Za-z0-9]{10,40}$/, MSG.voice)
        .optional(),
    })
    .strict()
    .optional(),
};

// Saving an interviewer with both feedback switches off is refused (the report would be empty).
// Stored definitions are not checked, so an older snapshot still loads; the report generator
// treats both-off as content-on.
const inputSchema = z
  .object(inputShape)
  .strict()
  .superRefine((v, ctx) => {
    if (!v.contentFeedback && !v.deliveryFeedback) {
      ctx.addIssue({ code: "custom", path: ["contentFeedback"], message: MSG.feedbackOff });
    }
  });

const definitionSchema = z
  .object({
    ...inputShape,
    id: z
      .string({ invalid_type_error: MSG.type, required_error: MSG.required })
      .min(1, MSG.required)
      .max(64, tooLong(64))
      .regex(/^[A-Za-z0-9_-]+$/, MSG.id),
    source: z.enum(["preset", "custom"], {
      errorMap: () => ({ message: "Must be preset or custom." }),
    }),
    ownerId: z
      .string({ invalid_type_error: MSG.type, required_error: MSG.required })
      .min(1, MSG.required)
      .max(64, tooLong(64)),
    version: z
      .number({ invalid_type_error: MSG.type, required_error: MSG.required })
      .int(MSG.integer)
      .min(1, "Must be at least 1."),
    createdAt: isoDate(),
    updatedAt: isoDate(),
  })
  .strict();

function isoDate() {
  return z
    .string({ invalid_type_error: MSG.type, required_error: MSG.required })
    .refine((s) => !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}/.test(s), MSG.date);
}

function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => {
    let message: string;
    switch (issue.code) {
      case "unrecognized_keys":
        message = MSG.unknownKey;
        break;
      case "invalid_type":
        message =
          issue.received === "undefined"
            ? MSG.required
            : issue.expected === "integer"
              ? MSG.integer
              : MSG.type;
        break;
      case "too_small":
      case "too_big":
      case "custom":
      case "invalid_string":
      case "invalid_enum_value":
        message = issue.message;
        break;
      default:
        message = MSG.invalid;
    }
    return { path: issue.path.join("."), message };
  });
}

export function parseInterviewerInput(
  raw: unknown,
): { ok: true; value: InterviewerInput } | { ok: false; errors: FieldError[] } {
  const r = inputSchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data as InterviewerInput };
  return { ok: false, errors: toFieldErrors(r.error) };
}

/** Throws on invalid input; used for presets and stored snapshots. The message lists paths only. */
export function parseInterviewerDefinition(raw: unknown): InterviewerDefinition {
  const r = definitionSchema.safeParse(raw);
  if (r.success) return r.data as InterviewerDefinition;
  const paths = toFieldErrors(r.error).map((e) => e.path || "(root)");
  throw new Error(`Invalid interviewer definition: ${[...new Set(paths)].join(", ")}`);
}
