// Delivery numbers across sessions for the Progress page (FQ-52). The response is checked
// whole: anything unexpected is treated as unavailable, never partly shown.
import { apiUrl } from "./config";

/** Fewer sessions than this leaves nothing to compare, so the page says "Not enough yet". */
export const MIN_POINTS = 2;

export interface TrendPoint {
  sessionId: string;
  startedAt: string;
  interviewerId: string;
  interviewerName: string | null;
  answersMeasured: number;
  /** Each is the median of that session's per-answer figures; null when not measured. */
  paceWpm: number | null;
  gapMs: number | null;
  longestPauseSec: number | null;
  answerWords: number | null;
  /** Present only when showFillers is true. */
  fillersPer100Words?: number | null;
}

export interface TrendResponse {
  showFillers: boolean;
  sessions: TrendPoint[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isMeasure = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
const isDate = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

function parsePoint(p: unknown, showFillers: boolean): TrendPoint | null {
  if (!isRecord(p)) return null;
  const { sessionId, startedAt, interviewerId, interviewerName, answersMeasured } = p;
  const { paceWpm, gapMs, longestPauseSec, answerWords } = p;
  if (typeof sessionId !== "string" || !isDate(startedAt) || typeof interviewerId !== "string") return null;
  if (interviewerName !== null && typeof interviewerName !== "string") return null;
  if (typeof answersMeasured !== "number" || !Number.isInteger(answersMeasured) || answersMeasured < 1) {
    return null;
  }
  if (!isMeasure(paceWpm) || !isMeasure(gapMs) || !isMeasure(longestPauseSec) || !isMeasure(answerWords)) {
    return null;
  }
  const point: TrendPoint = {
    sessionId,
    startedAt,
    interviewerId,
    interviewerName,
    answersMeasured,
    paceWpm,
    gapMs,
    longestPauseSec,
    answerWords,
  };
  const hasRate = "fillersPer100Words" in p;
  if (hasRate !== showFillers) return null;
  if (showFillers) {
    if (!isMeasure(p.fillersPer100Words)) return null;
    point.fillersPer100Words = p.fillersPer100Words;
  }
  return point;
}

/** The route's body, or null if any part of it is malformed. */
export function parseTrend(body: unknown): TrendResponse | null {
  if (!isRecord(body) || typeof body.showFillers !== "boolean" || !Array.isArray(body.sessions)) {
    return null;
  }
  const sessions: TrendPoint[] = [];
  for (const p of body.sessions) {
    const point = parsePoint(p, body.showFillers);
    if (!point) return null;
    sessions.push(point);
  }
  return { showFillers: body.showFillers, sessions };
}

/** GET /api/delivery/trend. Null on a network error, abort, non-200 or bad shape; never throws. */
export async function fetchTrend(signal?: AbortSignal): Promise<TrendResponse | null> {
  try {
    const res = await fetch(`${apiUrl}/api/delivery/trend`, { signal });
    if (res.status !== 200) return null;
    return parseTrend(await res.json());
  } catch {
    return null;
  }
}
