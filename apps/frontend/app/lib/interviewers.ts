// Interviewers come from the backend (GET /api/interviewers). Presets and custom
// interviewers share one shape; the frontend never hard-codes their ids.
import { apiUrl } from "./config";

export interface InterviewerSummary {
  id: string;
  name: string;
  purpose: string;
  source: "preset" | "custom";
  version: number;
}

export interface InterviewerPhase {
  name: string;
  instruction?: string;
  minTurns?: number;
  maxTurns?: number;
}

/** The fields of the full record that the UI uses. */
export interface InterviewerDetail {
  id: string;
  name: string;
  purpose: string;
  source: "preset" | "custom";
  phases: InterviewerPhase[];
}

/** Label for sessions stored before interviewers had names (interviewerName is null). */
export const EARLIER_INTERVIEW_LABEL = "Earlier interview";

/** Lists the interviewers available to start. Throws on network or server errors. */
export async function fetchInterviewers(): Promise<InterviewerSummary[]> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/interviewers`);
  } catch {
    throw new Error("Could not reach the server");
  }
  if (!res.ok) throw new Error("Could not load interviewers");
  return (await res.json()) as InterviewerSummary[];
}

/** Loads one interviewer. Returns null when it does not exist; throws on other failures. */
export async function fetchInterviewer(id: string): Promise<InterviewerDetail | null> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/interviewers/${encodeURIComponent(id)}`);
  } catch {
    throw new Error("Could not reach the server");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not load interviewer");
  return (await res.json()) as InterviewerDetail;
}
