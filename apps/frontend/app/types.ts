// Shared client-side types for the AI Interview Tool frontend.
// These must stay in sync with the backend protocol defined in spec §5.3.

import type { InterviewerInput } from "./lib/interviewers";

// Orb state — drives AgentPanel visual (spec §7 Agent Panel)
export type OrbState = "listening" | "thinking" | "speaking" | "interrupted";

// Whether voice detection is actually listening (useVAD): "off" before any start or after a
// stop, "starting" while it loads, "ready" once listening, "failed" if it could not start.
export type Hearing = "off" | "starting" | "ready" | "failed";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
}

// Report types (format 1 and format 2) and their parser live in lib/report.ts.

// Discriminated union of all server → client message types (spec §5.3)
export type ServerMessage =
  | { type: "tts_start" }
  | { type: "tts_end" }
  | { type: "tts_chunk"; data: ArrayBuffer }
  | { type: "transcript"; text: string; role: "user" | "assistant"; partial?: boolean }
  // Phase NAME from the session's interviewer; interviewers define their own phases.
  | { type: "phase_change"; phase: string }
  | { type: "session_started"; sessionId: string }
  | { type: "session_complete"; reportId: string }
  | { type: "session_failed"; reason: string }
  | { type: "stt_error"; reason?: string }
  | { type: "latency_metric"; ms: number }
  // Designer sessions only: the drafted interviewer, sent before session_complete.
  | { type: "draft"; draft: InterviewerInput };

// Discriminated union of all client → server message types (spec §5.3)
export type ClientMessage =
  // The server issues the session id (session_started) and starts at the interviewer's first phase.
  | { type: "session_start"; interviewerId: string; demo: boolean }
  // Try it: an unsaved draft instead of an interviewer id (the server validates it).
  | { type: "session_start"; draft: InterviewerInput; demo: boolean }
  | { type: "session_end" }
  | { type: "interrupt" }
  | { type: "text_input"; content: string }
  // Sent just before the audio frame of an answer: ms between the interviewer finishing and the user starting.
  | { type: "turn_timing"; responseGapMs: number }
  | { type: "audio"; data: ArrayBuffer };
