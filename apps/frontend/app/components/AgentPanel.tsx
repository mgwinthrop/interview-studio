"use client";

import type { ConnectionState } from "../hooks/useWebSocket";
import type { OrbState } from "../types";
import { InterviewerAvatar, AVATAR_LABELS, type AvatarState } from "./InterviewerAvatar";

interface AgentPanelProps {
  orbState: OrbState;
  connectionState: ConnectionState;
  lastLatencyMs: number | null;
  sessionId: string;
  paused?: boolean;
}

export function AgentPanel({ orbState, connectionState, lastLatencyMs, sessionId, paused = false }: AgentPanelProps) {
  const state: AvatarState = paused ? "paused" : connectionState === "connected" ? orbState : connectionState;
  return (
    <div className="interviewer-panel">
      <div className="interviewer-heading"><span className="interviewer-eyebrow">YOUR AI INTERVIEWER</span><h2>Meet MG</h2><p>A little curiosity. A better conversation.</p></div>
      <InterviewerAvatar state={state} />
      <div className="interviewer-status" role="status" aria-live="polite"><span className="interviewer-status-dot" data-state={state} />{AVATAR_LABELS[state]}</div>
      <p className="interviewer-caption">{state === "listening" ? "Take your time. I’m all ears." : state === "thinking" ? "Considering your experience…" : state === "speaking" ? "You can interrupt at any time." : state === "interrupted" ? "Go ahead — I’m listening." : state === "paused" ? "Resume whenever you’re ready." : "Waiting for the interview connection."}</p>
      {lastLatencyMs !== null && <p className="interviewer-latency">Last response: {lastLatencyMs}ms</p>}
      <span className="interviewer-session">mg_interview_{sessionId.slice(0, 11)}</span>
    </div>
  );
}
