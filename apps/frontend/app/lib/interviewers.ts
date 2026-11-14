// Interviewers come from the backend (GET /api/interviewers). Presets and custom
// interviewers share one shape; the frontend never hard-codes their ids.
import { apiUrl } from "./config";
import { parseDraftInput } from "./interviewerForm";

export interface InterviewerSummary {
  id: string;
  name: string;
  purpose: string;
  source: "preset" | "custom";
  version: number;
}

export interface InterviewerPhase {
  name: string;
  instruction: string;
  minTurns?: number;
  maxTurns?: number;
}

/** The editable fields of an interviewer (the body of create and update). */
export interface InterviewerInput {
  name: string;
  /** Who the person talks to ("Practice interviewer"); optional. `name` is the activity. */
  displayName?: string;
  purpose: string;
  persona: string;
  style: string;
  /** Optional: how the person being practised against tends to react. */
  behaviours?: string;
  opening: string;
  closing: string;
  phases: InterviewerPhase[];
  focus: string[];
  contentFeedback: boolean;
  deliveryFeedback: boolean;
  voice?: { cloud?: string };
}

/** The full record as the API returns it (everything except the owner). */
export interface InterviewerDetail extends InterviewerInput {
  id: string;
  source: "preset" | "custom";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FieldError {
  path: string;
  message: string;
}

export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "invalid"; errors: FieldError[] }
  | {
      ok: false;
      kind: "conflict" | "not_found" | "forbidden" | "busy" | "failed" | "network";
      message: string;
    };

/**
 * The one interviewer id the frontend knows. The designer is hidden from the list, so it cannot
 * be found there; the session page loads it by this id.
 */
export const DESIGNER_ID = "interviewer-designer";

/** Mirrors apps/backend/src/interviewer/designer.ts. */
export const MAX_DESCRIPTION_CHARS = 4000;
export const MIN_DESCRIPTION_CHARS = 20;

/** Label for sessions stored before interviewers had names (interviewerName is null). */
export const EARLIER_INTERVIEW_LABEL = "Earlier interview";

/** Lists the interviewers available to start. Throws on network or server errors. */
export async function fetchInterviewers(): Promise<InterviewerSummary[]> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/interviewers`);
  } catch {
    throw new Error("Could not reach the server");
  }
  if (!res.ok) throw new Error("Could not load interviewers");
  return (await res.json()) as InterviewerSummary[];
}

/** Loads one interviewer. Returns null when it does not exist; throws on other failures. */
export async function fetchInterviewer(id: string): Promise<InterviewerDetail | null> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/interviewers/${encodeURIComponent(id)}`);
  } catch {
    throw new Error("Could not reach the server");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not load interviewer");
  return (await res.json()) as InterviewerDetail;
}

// ---- Create, update, duplicate, delete, draft ----
// These never throw: every outcome is an ApiResult. Messages are fixed client text; only the
// per-field errors of a 422 come from the server.

const MESSAGES = {
  network: "Could not reach the server.",
  conflict: "This interviewer was changed somewhere else. Reload it and try again.",
  not_found: "That interviewer no longer exists.",
  forbidden: "Presets cannot be changed. Duplicate it to make your own copy.",
  busy: "A draft is already being made.",
  failed: "Something went wrong. Please try again.",
  draftFailed: "The draft could not be made. Please try again.",
} as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reads the field errors of a 422 body, keeping only well-formed string pairs. */
function readFieldErrors(body: unknown): FieldError[] {
  const raw = isRecord(body) && Array.isArray(body.errors) ? body.errors : [];
  const errors: FieldError[] = [];
  for (const e of raw.slice(0, 100)) {
    if (isRecord(e) && typeof e.path === "string" && typeof e.message === "string") {
      errors.push({ path: e.path, message: e.message });
    }
  }
  if (errors.length === 0) errors.push({ path: "", message: "Some fields are not valid." });
  return errors;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { empty?: boolean; failedMessage?: string } = {},
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, {
      method,
      ...(body !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
  } catch {
    return { ok: false, kind: "network", message: MESSAGES.network };
  }

  const failedMessage = opts.failedMessage ?? MESSAGES.failed;
  if (res.ok) {
    if (opts.empty) return { ok: true, value: null as T };
    try {
      return { ok: true, value: (await res.json()) as T };
    } catch {
      return { ok: false, kind: "failed", message: failedMessage };
    }
  }

  switch (res.status) {
    case 422: {
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        // Fall through to the generic field error.
      }
      return { ok: false, kind: "invalid", errors: readFieldErrors(parsed) };
    }
    case 409:
      return { ok: false, kind: "conflict", message: MESSAGES.conflict };
    case 403:
      return { ok: false, kind: "forbidden", message: MESSAGES.forbidden };
    case 404:
      return { ok: false, kind: "not_found", message: MESSAGES.not_found };
    case 429:
      return { ok: false, kind: "busy", message: MESSAGES.busy };
    default:
      return { ok: false, kind: "failed", message: failedMessage };
  }
}

const enc = encodeURIComponent;

export function createInterviewer(input: InterviewerInput): Promise<ApiResult<InterviewerDetail>> {
  return request("POST", "/api/interviewers", input);
}

/** `version` is the version the edit started from; a newer stored version gives kind "conflict". */
export function updateInterviewer(
  id: string,
  version: number,
  input: InterviewerInput,
): Promise<ApiResult<InterviewerDetail>> {
  return request("PUT", `/api/interviewers/${enc(id)}`, { ...input, version });
}

export function duplicateInterviewer(id: string): Promise<ApiResult<InterviewerDetail>> {
  return request("POST", `/api/interviewers/${enc(id)}/duplicate`);
}

export function deleteInterviewer(id: string): Promise<ApiResult<null>> {
  return request("DELETE", `/api/interviewers/${enc(id)}`, undefined, { empty: true });
}

/** Asks the designer for a draft from a description. Nothing is saved. 429 is busy, 502 failed. */
export async function requestDraft(description: string): Promise<ApiResult<InterviewerInput>> {
  const r = await request<{ draft?: unknown }>(
    "POST",
    "/api/interviewers/draft",
    { description },
    { failedMessage: MESSAGES.draftFailed },
  );
  if (!r.ok) return r;
  // The same shape check as a stored draft, so a malformed reply fails here instead of
  // opening a blank editor later.
  const draft = isRecord(r.value) ? parseDraftInput(r.value.draft) : null;
  if (!draft) return { ok: false, kind: "failed", message: MESSAGES.draftFailed };
  return { ok: true, value: draft };
}
