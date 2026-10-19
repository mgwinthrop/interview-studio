// Form model for the interviewer editor: limits, blank and copied values, the sessionStorage
// hand-off of a draft, and field-error lookup. The server validates everything again; the
// checks here only keep the form and storage from misbehaving.
import type { FieldError, InterviewerDetail, InterviewerInput } from "./interviewers";

// Copy of INTERVIEWER_LIMITS in apps/backend/src/interviewer/schema.ts. Keep the two in sync.
export const INTERVIEWER_LIMITS = {
  name: 60,
  purpose: 200,
  persona: 1500,
  style: 600,
  opening: 400,
  closing: 400,
  phaseName: 40,
  phaseInstruction: 1200,
  phases: 8,
  focusItem: 120,
  focusItems: 6,
  turns: 50,
} as const;

/** A blank form: two phases (the first with turn counts, the last without) and both switches on. */
export function emptyInput(): InterviewerInput {
  return {
    name: "",
    purpose: "",
    persona: "",
    style: "",
    opening: "",
    closing: "",
    phases: [
      { name: "opening", instruction: "", minTurns: 1, maxTurns: 3 },
      { name: "closing", instruction: "" },
    ],
    focus: [],
    contentFeedback: true,
    deliveryFeedback: true,
  };
}

/** The editable fields of a loaded record, copied so the form never mutates the original. */
export function inputFromDetail(d: InterviewerDetail): InterviewerInput {
  return {
    name: d.name,
    purpose: d.purpose,
    persona: d.persona,
    style: d.style,
    opening: d.opening,
    closing: d.closing,
    phases: d.phases.map((p) => ({
      name: p.name,
      instruction: p.instruction,
      ...(p.minTurns !== undefined ? { minTurns: p.minTurns } : {}),
      ...(p.maxTurns !== undefined ? { maxTurns: p.maxTurns } : {}),
    })),
    focus: [...d.focus],
    contentFeedback: d.contentFeedback,
    deliveryFeedback: d.deliveryFeedback,
    ...(d.voice !== undefined ? { voice: { ...d.voice } } : {}),
  };
}

/** The first error for each path. */
export function errorsByPath(errors: FieldError[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of errors) {
    if (!(e.path in out)) out[e.path] = e.message;
  }
  return out;
}

// ---- Draft hand-off through sessionStorage ----

const DRAFT_KEY = "interviewer_draft";
const DEFAULT_RETURN_TO = "/interviewers/edit?from=draft";
// A tampered value must not be able to inject huge values: strings are capped at twice the
// limit (the server still enforces the real limit) and arrays are capped for display.
const MAX_PHASES_STORED = 16;
const MAX_FOCUS_STORED = 12;
const MAX_STORED_BYTES = 200_000;
const MAX_VOICE_CHARS = 80;
const MAX_RETURN_TO_CHARS = 200;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, limit: number): string | null {
  return typeof v === "string" && v.length <= limit * 2 ? v : null;
}

function turns(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  return typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= 1000 ? v : null;
}

/** Checks the shape strictly and returns a clean copy (unknown keys dropped), or null. */
function parseShape(raw: unknown): InterviewerInput | null {
  if (!isRecord(raw)) return null;
  const name = str(raw.name, INTERVIEWER_LIMITS.name);
  const purpose = str(raw.purpose, INTERVIEWER_LIMITS.purpose);
  const persona = str(raw.persona, INTERVIEWER_LIMITS.persona);
  const style = str(raw.style, INTERVIEWER_LIMITS.style);
  const opening = str(raw.opening, INTERVIEWER_LIMITS.opening);
  const closing = str(raw.closing, INTERVIEWER_LIMITS.closing);
  if (
    name === null || purpose === null || persona === null ||
    style === null || opening === null || closing === null
  ) {
    return null;
  }
  if (typeof raw.contentFeedback !== "boolean" || typeof raw.deliveryFeedback !== "boolean") {
    return null;
  }

  if (!Array.isArray(raw.phases) || raw.phases.length > MAX_PHASES_STORED) return null;
  const phases: InterviewerInput["phases"] = [];
  for (const p of raw.phases) {
    if (!isRecord(p)) return null;
    const pn = str(p.name, INTERVIEWER_LIMITS.phaseName);
    const pi = str(p.instruction, INTERVIEWER_LIMITS.phaseInstruction);
    const min = turns(p.minTurns);
    const max = turns(p.maxTurns);
    if (pn === null || pi === null || min === null || max === null) return null;
    phases.push({
      name: pn,
      instruction: pi,
      ...(min !== undefined ? { minTurns: min } : {}),
      ...(max !== undefined ? { maxTurns: max } : {}),
    });
  }

  if (!Array.isArray(raw.focus) || raw.focus.length > MAX_FOCUS_STORED) return null;
  const focus: string[] = [];
  for (const f of raw.focus) {
    const s = str(f, INTERVIEWER_LIMITS.focusItem);
    if (s === null) return null;
    focus.push(s);
  }

  let voice: InterviewerInput["voice"];
  if (raw.voice !== undefined) {
    if (!isRecord(raw.voice)) return null;
    if (raw.voice.cloud === undefined) {
      voice = {};
    } else if (typeof raw.voice.cloud === "string" && raw.voice.cloud.length <= MAX_VOICE_CHARS) {
      voice = { cloud: raw.voice.cloud };
    } else {
      return null;
    }
  }

  return {
    name, purpose, persona, style, opening, closing,
    phases, focus,
    contentFeedback: raw.contentFeedback,
    deliveryFeedback: raw.deliveryFeedback,
    ...(voice !== undefined ? { voice } : {}),
  };
}

/**
 * The shape check used for stored drafts, for any other untrusted draft (the one-box reply).
 * Null when the value is not an interviewer input of the expected shape.
 */
export function parseDraftInput(raw: unknown): InterviewerInput | null {
  return parseShape(raw);
}

// Control characters (tab and newline included): browsers strip them from URLs, so
// "/\t/evil.com" would become the protocol-relative "//evil.com".
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function safeReturnTo(v: unknown): string {
  // Same-site paths only; anything else falls back to the default.
  if (
    typeof v === "string" && v.length <= MAX_RETURN_TO_CHARS &&
    v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") && !CONTROL_CHARS.test(v)
  ) {
    return v;
  }
  return DEFAULT_RETURN_TO;
}

/**
 * Keeps a draft for the next page (editor, or Try it). Returns false when storage is
 * unavailable or full; the hand-off is then lost and the caller should say so.
 */
export function storeDraft(input: InterviewerInput, returnTo?: string): boolean {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ input, returnTo: safeReturnTo(returnTo) }));
    return true;
  } catch {
    // Private mode, quota or disabled storage.
    return false;
  }
}

/** Removes the stored draft (after it has been saved or discarded). */
export function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing more to do.
  }
}

function readDraft(remove: boolean): { input: InterviewerInput; returnTo: string } | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let result: { input: InterviewerInput; returnTo: string } | null = null;
  if (raw.length <= MAX_STORED_BYTES) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const input = isRecord(parsed) ? parseShape(parsed.input) : null;
      if (input && isRecord(parsed)) result = { input, returnTo: safeReturnTo(parsed.returnTo) };
    } catch {
      result = null;
    }
  }

  // Take removes the key whether or not it was valid; peek removes it only when invalid.
  if (remove || result === null) {
    try {
      window.sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // Nothing more to do.
    }
  }
  return result;
}

/** Reads and removes the stored draft. Null when missing, corrupt or the wrong shape. */
export function takeDraft(): { input: InterviewerInput; returnTo: string } | null {
  return readDraft(true);
}

/** Reads the stored draft and leaves it in place (Try it must not consume it). */
export function peekDraft(): { input: InterviewerInput; returnTo: string } | null {
  return readDraft(false);
}
