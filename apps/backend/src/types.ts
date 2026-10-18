export type Phase = "intro" | "share_work" | "deep_dive" | "wrap_up";

// Typed outbound messages — all send(ws, ...) calls must use this union (spec §5.3).
// tts_chunk is sent as raw binary via ws.send(Buffer) in ttsStream.ts — not through send().
export type ServerToClientMessage =
  | { type: "tts_chunk"; data: Buffer }
  | { type: "tts_start" }
  | { type: "tts_end" }
  | { type: "transcript"; text: string; role: "user" | "assistant"; partial?: boolean }
  | { type: "phase_change"; phase: Phase }
  | { type: "session_complete"; reportId: string }
  | { type: "stt_error"; reason: string }
  | { type: "latency_metric"; ms: number };

export interface ConversationTurn {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  phase: Phase;
  timestamp: Date;
}

export interface Report {
  sessionId: string;
  summary: string;
  strengths: { area: string; evidence: string }[];
  improvements: { area: string; suggestion: string }[];
  highlights: string[];
  overallAssessment: string;
  generatedAt: Date;
}

export interface SessionState {
  sessionId: string;
  topicId: string;
  phase: Phase;
  turnCount: number;
  history: ConversationTurn[];
  topicsDiscussed: string[];
  phaseTransitionPending: boolean;
  vadT0?: number;
}

export type SessionStatus = "active" | "complete" | "abandoned" | "failed";
