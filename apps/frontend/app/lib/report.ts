// The report as the UI sees it. The backend serves two shapes: format 1 (older reports,
// stored in the legacy columns) and format 2 (content, delivery and next steps).
// parseReport checks every field the views rely on, so a malformed body never reaches them.
import { apiUrl } from "./config";

/** Older reports. Rendered exactly as before. */
export interface ReportV1View {
  format: 1;
  sessionId: string;
  summary: string;
  strengths: { area: string; evidence: string }[];
  improvements: { area: string; suggestion: string }[];
  highlights: string[];
  overallAssessment: string;
  /** A Date when the server's value parses; otherwise the raw string. */
  generatedAt: Date | string;
  /** null for sessions stored before interviewers had names. */
  interviewerName: string | null;
}

/** Measured delivery numbers. `null` means not measured; it never stands in for zero. */
export interface DeliverySummaryView {
  turnsMeasured: number | null;
  totalWords: number | null;
  speakingTimeSec: number | null;
  averageWordsPerMinute: number | null;
  pauseCount: number | null;
  longestPauseSec: number | null;
  medianResponseGapMs: number | null;
  fillerCount: number | null;
  perTurn: {
    turn: number;
    wordCount: number | null;
    wordsPerMinute: number | null;
    longestPauseSec: number | null;
    responseGapMs: number | null;
  }[];
}

export interface ReportV2View {
  format: 2;
  sessionId: string;
  generatedAt: Date | string;
  interviewerName: string | null;
  content?: {
    summary: string;
    strengths: { area: string; quote: string; note: string }[];
    developAreas: { area: string; suggestion: string }[];
  };
  /** `reading` is absent when the server omitted one that quoted a number outside the summary. */
  delivery?: { summary: DeliverySummaryView; reading?: string };
  deliveryUnavailable?: true;
  nextSteps: string[];
}

export type ReportView = ReportV1View | ReportV2View;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/** A finite number, or null for anything else (missing, null, NaN, wrong type). */
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);

/** Each item must be an object with every named field a string; otherwise the whole list fails. */
function stringRecords<K extends string>(v: unknown, keys: readonly K[]): Record<K, string>[] | null {
  if (!Array.isArray(v)) return null;
  const out: Record<K, string>[] = [];
  for (const item of v) {
    if (!isObj(item)) return null;
    const rec = {} as Record<K, string>;
    for (const k of keys) {
      const value = item[k];
      if (!isStr(value)) return null;
      rec[k] = value;
    }
    out.push(rec);
  }
  return out;
}

function parseDate(v: unknown): Date | string | null {
  if (!isStr(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d;
}

function parseName(v: unknown): string | null {
  return isStr(v) ? v : null;
}

function parseV1(o: Obj): ReportV1View | null {
  const strengths = stringRecords(o.strengths, ["area", "evidence"] as const);
  const improvements = stringRecords(o.improvements, ["area", "suggestion"] as const);
  const generatedAt = parseDate(o.generatedAt);
  if (
    !isStr(o.sessionId) ||
    !isStr(o.summary) ||
    !isStr(o.overallAssessment) ||
    !isStrArray(o.highlights) ||
    !strengths ||
    !improvements ||
    generatedAt === null
  ) {
    return null;
  }
  return {
    format: 1,
    sessionId: o.sessionId,
    summary: o.summary,
    strengths,
    improvements,
    highlights: o.highlights,
    overallAssessment: o.overallAssessment,
    generatedAt,
    interviewerName: parseName(o.interviewerName),
  };
}

function parseDelivery(v: unknown): ReportV2View["delivery"] | null {
  // A missing reading is valid: the server omits one that quoted a number outside the summary.
  if (!isObj(v) || (v.reading !== undefined && !isStr(v.reading)) || !isObj(v.summary)) return null;
  const s = v.summary;
  if (!Array.isArray(s.perTurn)) return null;
  const perTurn: DeliverySummaryView["perTurn"] = [];
  for (const t of s.perTurn) {
    if (!isObj(t) || !isNum(t.turn)) return null;
    perTurn.push({
      turn: t.turn,
      wordCount: numOrNull(t.wordCount),
      wordsPerMinute: numOrNull(t.wordsPerMinute),
      longestPauseSec: numOrNull(t.longestPauseSec),
      responseGapMs: numOrNull(t.responseGapMs),
    });
  }
  return {
    ...(isStr(v.reading) ? { reading: v.reading } : {}),
    summary: {
      turnsMeasured: numOrNull(s.turnsMeasured),
      totalWords: numOrNull(s.totalWords),
      speakingTimeSec: numOrNull(s.speakingTimeSec),
      averageWordsPerMinute: numOrNull(s.averageWordsPerMinute),
      pauseCount: numOrNull(s.pauseCount),
      longestPauseSec: numOrNull(s.longestPauseSec),
      medianResponseGapMs: numOrNull(s.medianResponseGapMs),
      fillerCount: numOrNull(s.fillerCount),
      perTurn,
    },
  };
}

function parseV2(o: Obj): ReportV2View | null {
  const generatedAt = parseDate(o.generatedAt);
  if (!isStr(o.sessionId) || !isStrArray(o.nextSteps) || generatedAt === null) return null;
  const report: ReportV2View = {
    format: 2,
    sessionId: o.sessionId,
    generatedAt,
    interviewerName: parseName(o.interviewerName),
    nextSteps: o.nextSteps,
  };

  if (o.content !== undefined) {
    const c = o.content;
    if (!isObj(c) || !isStr(c.summary)) return null;
    const strengths = stringRecords(c.strengths, ["area", "quote", "note"] as const);
    const developAreas = stringRecords(c.developAreas, ["area", "suggestion"] as const);
    if (!strengths || !developAreas) return null;
    report.content = { summary: c.summary, strengths, developAreas };
  }

  if (o.delivery !== undefined) {
    const delivery = parseDelivery(o.delivery);
    if (!delivery) return null;
    report.delivery = delivery;
  }

  if (o.deliveryUnavailable === true) report.deliveryUnavailable = true;
  return report;
}

/** Checks a report body from the server. Unknown or malformed shapes give null; never throws. */
export function parseReport(json: unknown): ReportView | null {
  try {
    if (!isObj(json)) return null;
    if (json.format === 2) return parseV2(json);
    // Older servers sent the legacy shape with no format field.
    if (json.format === 1 || json.format === undefined) return parseV1(json);
    return null;
  } catch {
    return null;
  }
}

/** What a 5xx body from the report endpoint says went wrong. Never throws. */
export type ReportFailure =
  | { kind: "failed"; canRegenerate: boolean }
  | { kind: "unreadable" }
  | { kind: "abandoned" }
  | { kind: "other" };

export function parseReportFailure(json: unknown): ReportFailure {
  if (!isObj(json)) return { kind: "other" };
  if (json.status === "failed") return { kind: "failed", canRegenerate: json.canRegenerate === true };
  if (json.status === "unreadable") return { kind: "unreadable" };
  if (json.status === "abandoned") return { kind: "abandoned" };
  return { kind: "other" };
}

const REGENERATE_MESSAGES = {
  refused: "This report can't be regenerated.",
  failed: "We couldn't write the reflection this time. You can try again.",
  network: "We couldn't reach the server. Check your connection and try again.",
  malformed: "Something went wrong while loading the new report. You can try again.",
} as const;

/**
 * Asks the server to write the report again for a failed session. The request is synchronous
 * and can take up to about 90 seconds. Only fixed messages are returned; response text is
 * never shown to the user.
 */
export async function regenerateReport(
  sessionId: string,
): Promise<{ ok: true; report: ReportView } | { ok: false; message: string }> {
  if (!apiUrl) return { ok: false, message: REGENERATE_MESSAGES.network };
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/session/${encodeURIComponent(sessionId)}/report/regenerate`, {
      method: "POST",
    });
  } catch {
    return { ok: false, message: REGENERATE_MESSAGES.network };
  }

  if (res.status === 200) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, message: REGENERATE_MESSAGES.malformed };
    }
    const report = parseReport(body);
    return report ? { ok: true, report } : { ok: false, message: REGENERATE_MESSAGES.malformed };
  }
  if (res.status === 409 || res.status === 404) return { ok: false, message: REGENERATE_MESSAGES.refused };
  return { ok: false, message: REGENERATE_MESSAGES.failed };
}
