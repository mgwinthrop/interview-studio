// Session history (FQ-108 S11). LOAD-BEARING: a privacy surface.
//
// An in-memory ring of what happened in a session and what the screen showed, for the debug
// panel (?debug=1) and its copy button. It is never stored or sent. Each entry is a time, a
// label from labels.ts, and a snapshot of state names. Snapshot values are checked against
// allow-lists at run time too, so nothing but these fixed names can be recorded. Do not add a
// field that can carry text.

import type { ConnectionState } from "../../hooks/useWebSocket";
import type { Hearing, OrbState } from "../../types";
import { eventLabel, type HistoryEventInput } from "./labels";

export type EndFlowState = "none" | "confirming" | "settling" | "ending";

/** What the screen showed when the event was recorded. State names only. */
export interface ScreenSnapshot {
  connection: ConnectionState;
  turn: OrbState;
  mic: Hearing;
  paused: boolean;
  end: EndFlowState;
}

export interface HistoryEntry {
  t: number;
  label: string;
  screen: ScreenSnapshot;
}

// Frozen, like the event allow-list, so it cannot be widened at run time.
const SCREEN_VALUES = Object.freeze({
  connection: Object.freeze(["connecting", "connected", "disconnected", "error"] as const),
  turn: Object.freeze(["listening", "thinking", "speaking", "interrupted"] as const),
  mic: Object.freeze(["off", "starting", "ready", "failed"] as const),
  end: Object.freeze(["none", "confirming", "settling", "ending"] as const),
} satisfies { [K in Exclude<keyof ScreenSnapshot, "paused">]: readonly ScreenSnapshot[K][] });

const DEFAULT_CAPACITY = 500;

function pick<K extends keyof typeof SCREEN_VALUES>(key: K, value: unknown): ScreenSnapshot[K] {
  const allowed = SCREEN_VALUES[key] as readonly string[];
  return (typeof value === "string" && allowed.includes(value) ? value : "?") as ScreenSnapshot[K];
}

/** A copy of the snapshot with only the allow-listed fields and values ("?" otherwise). */
function cleanScreen(screen: ScreenSnapshot): ScreenSnapshot {
  const s = (typeof screen === "object" && screen !== null ? screen : {}) as Partial<Record<keyof ScreenSnapshot, unknown>>;
  return {
    connection: pick("connection", s.connection),
    turn: pick("turn", s.turn),
    mic: pick("mic", s.mic),
    paused: s.paused === true,
    end: pick("end", s.end),
  };
}

export class SessionHistory {
  // True private fields (#): `private` alone only stops the type checker, and a caller with a
  // cast could then write text straight into the history.
  readonly #capacity: number;
  readonly #items: HistoryEntry[] = [];

  /** Keeps the newest `capacity` entries (default 500; anything not a positive integer uses it). */
  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.#capacity = Number.isInteger(capacity) && capacity > 0 ? capacity : DEFAULT_CAPACITY;
  }

  /**
   * `t` is a time in ms (e.g. performance.now()); anything not a finite number is recorded as 0.
   * Does not throw on a missing or malformed event or screen. It can still rethrow an error
   * raised by the caller's own getter or Proxy, so callers that must never fail (the session
   * page, S12) wrap it in try/catch: a debug recorder must not break a session.
   */
  record(e: HistoryEventInput, screen: ScreenSnapshot, t: number): void {
    this.#items.push({ t: Number.isFinite(t) ? t : 0, label: eventLabel(e), screen: cleanScreen(screen) });
    if (this.#items.length > this.#capacity) this.#items.splice(0, this.#items.length - this.#capacity);
  }

  /** The entries, oldest first. A deep copy: changing it does not change the history. */
  entries(): readonly HistoryEntry[] {
    return this.#items.map((e) => ({ ...e, screen: { ...e.screen } }));
  }

  /** The copy format: one line per entry, "+<ms>ms <label> | <screen>". */
  toText(): string {
    return this.#items
      .map(({ t, label, screen: s }) =>
        `+${Math.round(t)}ms ${label} | connection=${s.connection} turn=${s.turn} mic=${s.mic} paused=${s.paused ? "yes" : "no"} end=${s.end}`,
      )
      .join("\n");
  }
}
