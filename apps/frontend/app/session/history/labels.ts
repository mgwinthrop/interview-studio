// Session history labels (FQ-108 S11). LOAD-BEARING: a privacy surface.
//
// The debug session history (?debug=1, in memory only, never sent) must never record anything
// a person said or wrote. So an event is described only by its kind, its type and, for a socket
// close, a numeric close code. No input type here has a free-text field, and every value is
// also checked against these allow-lists at run time, so text passed in through a cast or an
// `any` becomes "?" instead of being recorded. Do not add a field that can carry text.

import type { ClientMessage, ServerMessage } from "../../types";

/** Freezes the object and each of its arrays, so the allow-list cannot be widened at run time. */
function deepFreeze<T extends Record<string, readonly string[]>>(lists: T): T {
  for (const list of Object.values(lists)) Object.freeze(list);
  return Object.freeze(lists);
}

/**
 * The only kinds and types the history accepts. Also the source of the input types below.
 * Frozen: `as const` only stops the type checker, and a widened list would let text through.
 */
export const HISTORY_EVENT_TYPES = deepFreeze({
  // Server frames by type, plus the socket's own open and close.
  ws: [
    "tts_start", "tts_end", "tts_chunk", "transcript", "phase_change", "session_started",
    "session_complete", "session_failed", "stt_error", "latency_metric", "draft", "open", "close",
  ],
  // Client frames by type.
  send: ["session_start", "session_end", "interrupt", "text_input", "turn_timing", "audio"],
  mic: ["start", "ready", "failed", "pause", "resume", "reopened", "reopenFailed", "stop", "speechStart", "speechEnd", "misfire"],
  ui: ["pause", "resume", "endClick", "endConfirm", "endDismiss", "startOver", "sendText", "toggleTyping"],
  audio: ["playing", "stopped", "flush", "suspend", "resume"],
  timer: ["hearingDeadline", "thinkingWatchdog", "interruptSettle"],
} as const);

type Types = typeof HISTORY_EVENT_TYPES;
export type HistoryKind = keyof Types;

// Compile-time check: the ws and send lists cover every protocol message type. Adding a message
// to app/types.ts without adding it here is a type error on these lines.
type Missing<All extends string, Listed extends string> = Exclude<All, Listed>;
const serverCovered: Missing<ServerMessage["type"], Types["ws"][number]> extends never ? true : never = true;
const clientCovered: Missing<ClientMessage["type"], Types["send"][number]> extends never ? true : never = true;
void serverCovered;
void clientCovered;

export type HistoryEventInput =
  | { kind: "ws"; type: Types["ws"][number]; code?: number }
  | { kind: "send"; type: Types["send"][number] }
  | { kind: "mic"; type: Types["mic"][number] }
  | { kind: "ui"; type: Types["ui"][number] }
  | { kind: "audio"; type: Types["audio"][number] }
  | { kind: "timer"; type: Types["timer"][number] };

function isKind(kind: unknown): kind is HistoryKind {
  return typeof kind === "string" && Object.prototype.hasOwnProperty.call(HISTORY_EVENT_TYPES, kind);
}

function isCloseCode(code: unknown): code is number {
  return typeof code === "number" && Number.isInteger(code) && code >= 1000 && code <= 4999;
}

/**
 * A fixed label built only from the kind, the type and a numeric close code. Never reads any
 * other field, and reads each of these exactly once (a getter cannot pass the check with one
 * value and then supply another). An unknown kind or type (only possible through a cast)
 * becomes "?". Never throws.
 */
export function eventLabel(e: HistoryEventInput): string {
  if (typeof e !== "object" || e === null) return "?:?";
  const { kind, type, code } = e as { kind?: unknown; type?: unknown; code?: unknown };
  if (!isKind(kind)) return "?:?";
  const allowed: readonly string[] = HISTORY_EVENT_TYPES[kind];
  const typeLabel = typeof type === "string" && allowed.includes(type) ? type : "?";
  const label = `${kind}:${typeLabel}`;
  if (kind === "ws" && typeLabel === "close" && isCloseCode(code)) return `${label} ${code}`;
  return label;
}
