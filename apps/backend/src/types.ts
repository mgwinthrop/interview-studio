import type { DeliverySummary, TurnMetrics } from "./delivery/metrics";

// Typed outbound messages — all send(ws, ...) calls must use this union (spec §5.3).
// tts_chunk is sent as a raw binary frame (the controller's sendAudio) — not through send().
export type ServerToClientMessage =
  | { type: "tts_chunk"; data: Buffer }
  | { type: "tts_start" }
  | { type: "tts_end" }
  | { type: "transcript"; text: string; role: "user" | "assistant"; partial?: boolean }
  | { type: "phase_change"; phase: string }
  | { type: "session_started"; sessionId: string }
  | { type: "session_complete"; reportId: string }
  | { type: "session_failed"; reason: string }
  | { type: "stt_error"; reason: string }
  | { type: "latency_metric"; ms: number };

export interface ConversationTurn {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  phase: string;
  timestamp: Date;
  /** Delivery measures for a user turn; absent or null when not measured. */
  metrics?: TurnMetrics | null;
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

/** The original report shape, as stored in the legacy columns. */
export interface ReportV1 extends Report {
  format: 1;
}

export interface ReportV2 {
  format: 2;
  sessionId: string;
  generatedAt: Date;
  content?: {
    summary: string;
    strengths: { area: string; quote: string; note: string }[];
    developAreas: { area: string; suggestion: string }[];
  };
  delivery?: { summary: DeliverySummary; reading: string };
  /** Set when delivery feedback was on but no spoken answers were measured. */
  deliveryUnavailable?: true;
  nextSteps: string[];
}

export type AnyReport = ReportV1 | ReportV2;

export type SessionStatus = "active" | "complete" | "abandoned" | "failed";
