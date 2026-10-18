// Shared client-side types for the AI Interview Tool frontend.
// These must stay in sync with the backend protocol defined in spec §5.3.

export type Phase = "intro" | "share_work" | "deep_dive" | "wrap_up";

// Orb state — drives AgentPanel visual (spec §7 Agent Panel)
export type OrbState = "listening" | "thinking" | "speaking" | "interrupted";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
}

// Report interface — spec §8 Data Model
// generatedAt is string (JSON-serialised Date from backend)
export interface Report {
  sessionId: string;
  summary: string;
  strengths: { area: string; evidence: string }[];
  improvements: { area: string; suggestion: string }[];
  highlights: string[];
  overallAssessment: string;
  generatedAt: string;
}

// Discriminated union of all server → client message types (spec §5.3)
export type ServerMessage =
  | { type: "tts_start" }
  | { type: "tts_end" }
  | { type: "tts_chunk"; data: ArrayBuffer }
  | { type: "transcript"; text: string; role: "user" | "assistant"; partial?: boolean }
  | { type: "phase_change"; phase: Phase }
  | { type: "session_started"; sessionId: string }
  | { type: "session_complete"; reportId: string }
  | { type: "session_failed"; reason: string }
  | { type: "stt_error"; reason?: string }
  | { type: "latency_metric"; ms: number };

// Discriminated union of all client → server message types (spec §5.3)
export type ClientMessage =
  // The server issues the session id (session_started) and always starts at "intro".
  | { type: "session_start"; topicId: string; demo: boolean }
  | { type: "session_end" }
  | { type: "interrupt" }
  | { type: "text_input"; content: string }
  | { type: "audio"; data: ArrayBuffer };
