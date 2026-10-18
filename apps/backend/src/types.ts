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

export interface Session {
  id: string;
  topicId: string;
  status: "active" | "complete" | "abandoned";
  phase: Phase;
  startedAt: Date;
  endedAt?: Date;
  turns: ConversationTurn[];
  report?: Report;
}

export interface RuntimeState {
  turnInFlight: boolean;
  activeTTSAborts: Array<() => void>;
  activeTTSChain?: Promise<void>;
  activeLLMAbort?: AbortController;
  activeChunker?: import("./sentenceChunker").SentenceChunker;
  demo?: boolean;
  vadT0?: number; // Date.now() when onSpeechEnd fires (binary audio arrival or text_input)
  activeTurnPromise?: Promise<void>; // Full handleTranscript promise — used by session_end to ensure assistant turn is stored
}
