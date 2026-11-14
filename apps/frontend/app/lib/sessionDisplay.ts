// What the session screen shows about who is talking. Pure, so the panel and the transcript
// can share one answer and it can be unit-tested.

import type { OrbState } from "../types";

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
