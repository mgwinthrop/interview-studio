// "Build from calls": the API helpers and the client-side rules of the flow.
// Pasted text and the names to hide live in page state only. Nothing here logs, stores or puts
// text in a URL. Messages shown to the user are fixed client text: a server message is shown
// only when it is one of the known fixed messages below.
import { apiUrl } from "./config";
import { parseDraftInput } from "./interviewerForm";
import type { InterviewerInput } from "./interviewers";

/** Mirrors apps/backend/src/redaction/teamsParser.ts (MAX_CALL_CHARS). */
export const MAX_TRANSCRIPT_CHARS = 24_000;
/** Mirrors apps/backend/src/interviewer/designer.ts (MAX_CALLS, MAX_CALLS_CHARS). */
export const MAX_CALLS = 8;
export const MAX_CALL_TEXT_CHARS = 30_000;
/** Total characters of buyer lines (with the line before each) sent to Claude across all calls. */
export const MAX_SENT_CHARS = 30_000;
/** Mirrors apps/backend/src/callsRoutes.ts. */
export const MAX_TERMS = 50;
export const MAX_TERM_CHARS = 80;

export type ChangeKind = "name" | "term" | "amount" | "contact";

export interface Segment {
  text: string;
  change?: ChangeKind;
}

export interface RedactedLine {
  role: string;
  segments: Segment[];
}

export interface Redaction {
  lines: RedactedLine[];
  /** The redacted transcript, one `Buyer: ...` or `Our side N: ...` line per utterance. */
  text: string;
  suggestions: string[];
  /** Strings the draft must not contain; sent back unchanged with the approved call. */
  forbidden: string[];
}

export interface Speaker {
  name: string;
  lines: number;
}

export interface ApprovedCall {
  text: string;
  forbidden: string[];
}

export type CallsResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "invalid"; message: string }
  | { ok: false; kind: "network" }
  | { ok: false; kind: "error"; status: number };

export const NETWORK_MESSAGE = "Could not reach the server. Check your connection, then try again.";
export const GENERIC_MESSAGE = "Something went wrong. Please try again.";
const INVALID_FALLBACK = "The server did not accept this. Check the text and try again.";

// The fixed messages the calls routes send in a 422. Anything else is replaced by the fallback,
// so text from the server is never shown unless it is one of these.
const KNOWN_MESSAGES = new Set<string>([
  "No speakers were found. Paste a Teams transcript with a name and time above each part.",
  `The transcript is too long. The limit is ${MAX_TRANSCRIPT_CHARS} characters.`,
  "Paste a transcript.",
  "The transcript must be text.",
  "Choose one of the speakers in the transcript.",
  `Must be a list of at most ${MAX_TERMS} terms, each text of at most ${MAX_TERM_CHARS} characters with no control characters or line breaks.`,
]);

/** Fixed text for a failed draft request, by outcome. */
export function draftErrorMessage(r: Exclude<CallsResult<unknown>, { ok: true }>): string {
  if (r.kind === "network") return NETWORK_MESSAGE;
  if (r.kind === "error") {
    if (r.status === 403) return "Drafting from calls is turned off on this server.";
    if (r.status === 429) return "A draft is already being made. Wait for it to finish, then try again.";
    if (r.status === 502) return "The draft could not be made. Try again, or write the interviewer yourself.";
    if (r.status === 413) return "The approved calls are too large to send. Remove a call, then try again.";
  }
  return GENERIC_MESSAGE;
}

/** Fixed text for a failed speakers or redact request. */
export function stepErrorMessage(r: Exclude<CallsResult<unknown>, { ok: true }>): string {
  if (r.kind === "network") return NETWORK_MESSAGE;
  if (r.kind === "invalid") return r.message;
  if (r.status === 413) return "The transcript is too large to send. Shorten it, then try again.";
  return GENERIC_MESSAGE;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function firstKnownMessage(body: unknown): string {
  const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors : [];
  const first: unknown = errors[0];
  const message = isRecord(first) ? first.message : undefined;
  return typeof message === "string" && KNOWN_MESSAGES.has(message) ? message : INVALID_FALLBACK;
}

async function post(path: string, body: unknown): Promise<CallsResult<unknown>> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, kind: "network" };
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // Handled below: a success without a JSON body is an error, a failure keeps its status.
  }
  if (res.ok) {
    return parsed === null ? { ok: false, kind: "error", status: res.status } : { ok: true, value: parsed };
  }
  if (res.status === 422) return { ok: false, kind: "invalid", message: firstKnownMessage(parsed) };
  return { ok: false, kind: "error", status: res.status };
}

/** Whether the server offers building from calls. Any failure counts as off. */
export async function fetchFeatures(): Promise<{ personaFromCalls: boolean }> {
  try {
    const res = await fetch(`${apiUrl}/api/features`, { cache: "no-store" });
    if (!res.ok) return { personaFromCalls: false };
    const body: unknown = await res.json();
    return { personaFromCalls: isRecord(body) && body.personaFromCalls === true };
  } catch {
    return { personaFromCalls: false };
  }
}

const MAX_SPEAKERS_SHOWN = 50;

/** Lists the speakers of a pasted Teams transcript. Parsed by this app's server; nothing is sent on. */
export async function requestSpeakers(transcript: string): Promise<CallsResult<Speaker[]>> {
  const r = await post("/api/interviewers/calls/speakers", { transcript });
  if (!r.ok) return r;
  const raw = isRecord(r.value) && Array.isArray(r.value.speakers) ? r.value.speakers : null;
  if (!raw) return { ok: false, kind: "error", status: 200 };
  const speakers: Speaker[] = [];
  for (const s of raw.slice(0, MAX_SPEAKERS_SHOWN)) {
    if (isRecord(s) && typeof s.name === "string" && typeof s.lines === "number" && Number.isFinite(s.lines)) {
      speakers.push({ name: s.name, lines: s.lines });
    }
  }
  if (speakers.length === 0) return { ok: false, kind: "error", status: 200 };
  return { ok: true, value: speakers };
}

const CHANGE_KINDS: readonly ChangeKind[] = ["name", "term", "amount", "contact"];

function readSegment(v: unknown): Segment | null {
  if (!isRecord(v) || typeof v.text !== "string") return null;
  if (v.change === undefined) return { text: v.text };
  return CHANGE_KINDS.includes(v.change as ChangeKind) ? { text: v.text, change: v.change as ChangeKind } : null;
}

function readStrings(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]) : null;
}

/** Redacts one call by this app's server (no model is called). */
export async function requestRedaction(
  transcript: string,
  counterpart: string,
  terms: string[],
): Promise<CallsResult<Redaction>> {
  const r = await post("/api/interviewers/calls/redact", { transcript, counterpart, terms });
  if (!r.ok) return r;
  const v = r.value;
  const bad = { ok: false, kind: "error", status: 200 } as const;
  if (!isRecord(v) || typeof v.text !== "string" || !Array.isArray(v.lines)) return bad;
  const suggestions = readStrings(v.suggestions);
  const forbidden = readStrings(v.forbidden);
  if (!suggestions || !forbidden) return bad;
  const lines: RedactedLine[] = [];
  for (const l of v.lines) {
    if (!isRecord(l) || typeof l.role !== "string" || !Array.isArray(l.segments)) return bad;
    const segments = l.segments.map(readSegment);
    if (segments.some((s) => s === null)) return bad;
    lines.push({ role: l.role, segments: segments as Segment[] });
  }
  return { ok: true, value: { lines, text: v.text, suggestions, forbidden } };
}

/** Asks Claude (through the server) for a draft from the approved calls. Nothing is saved. */
export async function requestCallsDraft(
  calls: ApprovedCall[],
  confirmed: true,
): Promise<CallsResult<InterviewerInput>> {
  const r = await post("/api/interviewers/calls/draft", { calls, confirmed });
  if (!r.ok) return r;
  const draft = isRecord(r.value) ? parseDraftInput(r.value.draft) : null;
  if (!draft) return { ok: false, kind: "error", status: 502 };
  return { ok: true, value: draft };
}

// ---- Client-side rules ----

/**
 * Reads the "Names to hide" box: comma or newline separated, trimmed, empties dropped, repeats
 * (ignoring case) dropped. At most MAX_TERMS, each at most MAX_TERM_CHARS, no control characters.
 */
export function parseTerms(input: string): { ok: true; terms: string[] } | { ok: false; message: string } {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.split(/[,\r\n]/)) {
    const term = raw.trim();
    if (term.length === 0) continue;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001F\u007F]/.test(term)) {
      return { ok: false, message: "A name contains a tab or other control character. Remove it, then try again." };
    }
    if (term.length > MAX_TERM_CHARS) {
      return { ok: false, message: `Each name can be at most ${MAX_TERM_CHARS} characters. Shorten the long one, then try again.` };
    }
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  if (terms.length > MAX_TERMS) {
    return { ok: false, message: `You can list at most ${MAX_TERMS} names. Remove some, then try again.` };
  }
  return { ok: true, terms };
}

/**
 * The text as it will be approved: line endings as LF, tabs as spaces, other control characters
 * removed (the server refuses them).
 */
export function normaliseApprovedText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, " ")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
      .trim()
  );
}

// eslint-disable-next-line no-control-regex
const LINE_BREAKS = /[\r\n\u000B\u000C\u0085\u2028\u2029]+/g;
const CALL_ROLE_LINE = /^(?:Buyer|Our side \d+): /;
const BUYER_PREFIX = "Buyer: ";

/** Whether the text still has at least one line that starts with "Buyer: ". */
export function hasBuyerLine(text: string): boolean {
  return text.split(/\r?\n/).some((line) => line.trim().startsWith(BUYER_PREFIX));
}

// The same line rules as the server's drafter (apps/backend/src/interviewer/designer.ts), so the
// confirmation can say how much will actually be sent.
function callLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of normaliseApprovedText(text).split("\n")) {
    const line = raw.replace(LINE_BREAKS, " ").trim();
    if (line.length === 0) continue;
    if (CALL_ROLE_LINE.test(line)) lines.push(line);
    else if (lines.length > 0) lines[lines.length - 1] += ` ${line}`;
  }
  return lines;
}

function buyerLines(lines: readonly string[]): string[] {
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (!line.startsWith(BUYER_PREFIX)) return;
    if (i > 0) keep.add(i - 1);
    keep.add(i);
  });
  return lines.filter((_, i) => keep.has(i));
}

/**
 * How much of the approved text is sent: the buyer's lines plus the line just before each, newest
 * kept first up to MAX_SENT_CHARS. `trimmed` is true when the size limit leaves earlier material out.
 */
export function sendSummary(calls: readonly ApprovedCall[]): { approved: number; sent: number; trimmed: boolean } {
  const approved = calls.reduce((n, c) => n + c.text.length, 0);
  const flat = calls.flatMap((c) => buyerLines(callLines(c.text)));
  let sent = 0;
  let kept = 0;
  for (let i = flat.length - 1; i >= 0; i--) {
    const added = flat[i].length + (kept > 0 ? 1 : 0);
    if (sent + added > MAX_SENT_CHARS) break;
    sent += added;
    kept++;
  }
  const trimmed = kept < flat.length;
  // The server keeps the end of one oversized line when nothing else fits.
  if (kept === 0 && flat.length > 0) sent = MAX_SENT_CHARS;
  return { approved, sent, trimmed };
}
