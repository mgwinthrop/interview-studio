"use client";

import type { OrbState } from "../types";

// "starting" and "unavailable" stand in for listening until voice detection is really listening (FQ-41).
export type AvatarState = OrbState | "connecting" | "disconnected" | "error" | "paused" | "starting" | "unavailable";
export const AVATAR_LABELS: Record<AvatarState, string> = {
  listening: "Listening", thinking: "Thinking", speaking: "Speaking",
  interrupted: "Go ahead", connecting: "Connecting", disconnected: "Disconnected",
  error: "Connection error", paused: "Paused",
  starting: "Getting ready…", unavailable: "Can't hear you",
};

/** Local SVG character: state-driven animation, no avatar API or tracking. */
export function InterviewerAvatar({ state, compact = false }: { state: AvatarState; compact?: boolean }) {
  return (
    <div className={`interviewer-avatar ${compact ? "interviewer-avatar-compact" : ""}`} data-state={state}>
      <svg viewBox="0 0 240 240" role="img" aria-label={`AI interviewer — ${AVATAR_LABELS[state]}`}>
        <circle cx="120" cy="120" r="114" fill="#183E46" />
        <circle className="avatar-halo" cx="120" cy="120" r="106" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={state === "thinking" ? "4 12" : undefined} />
        <path d="M37 230c3-49 29-70 83-70s80 21 83 70" fill="#087E8B" />
        <path d="m92 170 28 39 28-39" fill="#EFF5EC" />
        <path d="M104 143h32v32c-8 13-24 13-32 0" fill="#A96E4D" />
        <g className="avatar-head">
          <ellipse cx="66" cy="111" rx="10" ry="17" fill="#B78059" />
          <ellipse cx="174" cy="111" rx="10" ry="17" fill="#B78059" />
          <path d="M67 91c0-40 20-59 53-59s53 19 53 59v30c0 34-23 54-53 54s-53-20-53-54Z" fill="#C58C63" />
          <path d="M80 70c8-21 25-29 40-29" fill="none" stroke="#D8A783" strokeWidth="5" strokeLinecap="round" />
          <path className="avatar-brows" d="m84 88 21-2m30 0 21 2" stroke="#503B30" strokeWidth="4" strokeLinecap="round" />
          <g fill="none" stroke="#183039" strokeWidth="5">
            <rect x="77" y="95" width="35" height="27" rx="10" />
            <rect x="128" y="95" width="35" height="27" rx="10" />
            <path d="M112 104q8-5 16 0M67 100l10 3m86 0 10-3" />
          </g>
          <g className="avatar-eyes" fill="#24353A">
            <ellipse cx="95" cy="108" rx="3" ry="4" />
            <ellipse cx="145" cy="108" rx="3" ry="4" />
          </g>
          <path d="m120 112-4 17h9" fill="none" stroke="#A76C49" strokeWidth="3" strokeLinecap="round" />
          <path className="avatar-smile" d="M106 142q14 12 28 0" fill="none" stroke="#623E32" strokeWidth="3" strokeLinecap="round" />
          <g className="avatar-mouth"><ellipse cx="120" cy="146" rx="12" ry="8" fill="#5E362F" /><path d="M112 141h16" stroke="#FAF6EC" strokeWidth="3" strokeLinecap="round" /></g>
        </g>
        <g className="avatar-thought" fill="#E8BB61"><circle cx="184" cy="48" r="4" /><circle cx="198" cy="40" r="5" /><circle cx="214" cy="29" r="6" /></g>
      </svg>
    </div>
  );
}
