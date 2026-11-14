"use client";

import type { ConnectionState } from "../hooks/useWebSocket";
import type { OrbState } from "../types";
import { InterviewerAvatar, AVATAR_LABELS, type AvatarState } from "./InterviewerAvatar";
import { MotionToggle } from "./MotionToggle";
import { interviewerLabel } from "../lib/sessionDisplay";

interface AgentPanelProps {
  orbState: OrbState;
  connectionState: ConnectionState;
  lastLatencyMs: number | null;
  sessionId: string;
  paused?: boolean;
  /** Who the person talks to; absent shows "Interviewer". */
  displayName?: string;
  /** The interviewer's own one-line purpose, shown under its name. */
  purpose: string;
}

export function AgentPanel({ orbState, connectionState, lastLatencyMs, sessionId, paused = false, displayName, purpose }: AgentPanelProps) {
  const state: AvatarState = paused ? "paused" : connectionState === "connected" ? orbState : connectionState;
  return (
    <div className="interviewer-panel">
      <div className="interviewer-heading"><span className="interviewer-eyebrow">YOUR AI INTERVIEWER</span><h2>{interviewerLabel(displayName)}</h2><p>{purpose}</p></div>
      <InterviewerAvatar state={state} />
      <div className="interviewer-status" role="status" aria-live="polite"><span className="interviewer-status-dot" data-state={state} />{AVATAR_LABELS[state]}</div>
      <p className="interviewer-caption">{state === "listening" ? "Take your time. I’m all ears." : state === "thinking" ? "Considering your experience…" : state === "speaking" ? "You can interrupt at any time." : state === "interrupted" ? "Go ahead — I’m listening." : state === "paused" ? "Resume whenever you’re ready." : "Waiting for the interview connection."}</p>
      <MotionToggle />
      {lastLatencyMs !== null && <p className="interviewer-latency">Last response: {lastLatencyMs}ms</p>}
      {sessionId && <span className="interviewer-session">interview_{sessionId.slice(0, 11)}</span>}
    </div>
  );
}
