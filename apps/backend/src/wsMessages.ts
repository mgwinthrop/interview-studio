import type { Duplex } from "node:stream";
import type { RawData } from "ws";
import { DESIGNER_ID } from "./interviewer/presets";
import { ID_SHAPE, parseInterviewerInput, type InterviewerDefinition, type InterviewerInput } from "./interviewer/schema";

/** Fixed text sent with session_failed: never model output or transcript text. */
export const FAILED_REASON = "report generation failed";

/** Largest accepted text_input content, in UTF-8 bytes; larger gets stt_error too_long. */
export const MAX_TEXT_INPUT_BYTES = 8192;

const STATUS_TEXT: Record<number, string> = { 401: "Unauthorized", 403: "Forbidden" };

/** Client message types we name in logs; anything else is logged as "unknown". */
const KNOWN_TYPES = new Set(["session_start", "session_end", "interrupt", "text_input", "turn_timing"]);

export type ClientMessage = { type: string; [key: string]: unknown };

export function safeType(type: unknown): string {
  return typeof type === "string" && KNOWN_TYPES.has(type) ? type : "unknown";
}

export function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

export function parseMessage(buf: Buffer): ClientMessage | null {
  try {
    const value: unknown = JSON.parse(buf.toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    if (typeof (value as { type?: unknown }).type !== "string") return null;
    return value as ClientMessage;
  } catch {
    return null;
  }
}

/** Cheap shape check only; whether the id exists for this owner is decided by the lookup. */
export function isInterviewerIdShape(id: unknown): id is string {
  return typeof id === "string" && ID_SHAPE.test(id);
}

/** Close reason for every bad interviewerId: malformed, unknown or another owner's. */
export const UNKNOWN_INTERVIEWER = "unknown interviewerId";

/** Close reason for every bad draft (and for a draft sent with an interviewerId). Never echoes it. */
export const INVALID_DRAFT = "invalid draft";

/**
 * What a session_start asks to run. "stored" and "designer" are looked up by id (the designer
 * is a hidden preset); "trial" runs an inline, already validated draft. Only "stored" is persisted.
 */
export type StartTarget =
  | { kind: "stored"; interviewerId: string }
  | { kind: "designer" }
  | { kind: "trial"; draft: InterviewerInput };

const has = (msg: ClientMessage, key: string) => Object.prototype.hasOwnProperty.call(msg, key);

/**
 * Exactly one of interviewerId and draft. A message carrying `draft` is a trial and every problem
 * with it (wrong type, failed validation, an interviewerId as well) is INVALID_DRAFT; otherwise the
 * interviewerId shape check applies. No database access, so it runs before the session counter.
 */
export function startTargetOf(msg: ClientMessage): StartTarget | { reject: string } {
  if (has(msg, "draft")) {
    const { draft } = msg;
    if (has(msg, "interviewerId") || typeof draft !== "object" || draft === null || Array.isArray(draft)) {
      return { reject: INVALID_DRAFT };
    }
    const parsed = parseInterviewerInput(draft);
    return parsed.ok ? { kind: "trial", draft: parsed.value } : { reject: INVALID_DRAFT };
  }
  if (!isInterviewerIdShape(msg.interviewerId)) return { reject: UNKNOWN_INTERVIEWER };
  return msg.interviewerId === DESIGNER_ID
    ? { kind: "designer" }
    : { kind: "stored", interviewerId: msg.interviewerId };
}

/** A trial's in-memory interviewer: never stored, owned by the caller. */
export function trialInterviewer(draft: InterviewerInput, ownerId: string): InterviewerDefinition {
  const now = new Date().toISOString();
  return { ...draft, id: "draft", source: "custom", ownerId, version: 1, createdAt: now, updatedAt: now };
}

/** Writes a plain HTTP error on a socket that has not been upgraded, then destroys it. */
export function rejectUpgrade(socket: Duplex, status: number): void {
  const body = STATUS_TEXT[status] ?? "Error";
  socket.once("finish", () => socket.destroy());
  socket.end(
    `HTTP/1.1 ${status} ${body}\r\nConnection: close\r\nContent-Type: text/plain\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}
