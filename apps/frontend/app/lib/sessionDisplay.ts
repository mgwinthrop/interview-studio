// What the session screen shows about who is talking. Pure, so the panel and the transcript
// can share one answer and it can be unit-tested.

import type { Hearing, OrbState } from "../types";

type Role = "user" | "assistant";

/** Shown when an interviewer has no display name (custom interviewers may leave it out). */
export const FALLBACK_INTERVIEWER_LABEL = "Interviewer";

export function interviewerLabel(displayName: string | undefined): string {
  return displayName?.trim() || FALLBACK_INTERVIEWER_LABEL;
}

export function speakerLabel(role: Role, displayName: string | undefined): string {
  return role === "user" ? "You" : interviewerLabel(displayName);
}

/** First whole character of the label, upper-cased (Array.from keeps surrogate pairs together). */
export function speakerBadge(role: Role, displayName: string | undefined): string {
  const [first = ""] = Array.from(speakerLabel(role, displayName));
  return first.toUpperCase();
}

/**
 * The orb state the screen shows. Speech can still be playing from the buffer after the
 * server's tts_end has put the orb back to listening; that still counts as speaking. An
 * interrupt stays visible while the last audio drains.
 */
export function displayedOrbState(orbState: OrbState, audioPlaying: boolean): OrbState {
  return audioPlaying && orbState !== "interrupted" ? "speaking" : orbState;
}

/** How long after the session opens hearing may take to start before the person is told (FQ-41). */
export const HEARING_DEADLINE_MS = 10_000;

/**
 * True when the person must be told their voice cannot be heard: at once if hearing failed, and
 * once the deadline has passed for anything short of ready (still loading, never started).
 * A late start that becomes ready clears it.
 */
export function hearingUnavailable(hearing: Hearing, deadlinePassed: boolean): boolean {
  return hearing === "failed" || (hearing !== "ready" && deadlinePassed);
}

/** What the side panel shows: never "listening" unless hearing is ready. */
export type PanelState = OrbState | "starting" | "unavailable";

export function panelState(shown: OrbState, hearing: Hearing, deadlinePassed: boolean): PanelState {
  if (shown !== "listening" || hearing === "ready") return shown;
  return hearingUnavailable(hearing, deadlinePassed) ? "unavailable" : "starting";
}
