import { apiUrl } from "./config";

/**
 * One turn of a stored conversation, as GET /api/session/:id/turns returns it (FQ-50).
 * `answer` is set on user turns only: the same number as the report's "Answer N".
 */
export interface TranscriptTurn {
  role: "user" | "assistant";
  content: string;
  phase: string;
  answer?: number;
}

function parseTurn(t: unknown): TranscriptTurn | null {
  if (typeof t !== "object" || t === null) return null;
  const { role, content, phase, answer } = t as Record<string, unknown>;
  if (typeof content !== "string" || typeof phase !== "string") return null;
  if (role === "assistant") return answer === undefined ? { role, content, phase } : null;
  if (role === "user" && typeof answer === "number" && Number.isInteger(answer) && answer > 0) {
    return { role, content, phase, answer };
  }
  return null;
}

/** Shape-checks the route's JSON. Null on any malformed entry, so the report then renders as today. */
export function parseTurns(json: unknown): TranscriptTurn[] | null {
  if (typeof json !== "object" || json === null) return null;
  const { turns } = json as { turns?: unknown };
  if (!Array.isArray(turns)) return null;
  const out: TranscriptTurn[] = [];
  for (const t of turns) {
    const parsed = parseTurn(t);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

/**
 * The question for "Answer N": the interviewer's turns after answer N-1 and before answer N,
 * joined with a blank line. Null when there are none (an interrupted reply is never stored, so
 * after a barge-in two answers are adjacent) or answer N does not exist.
 */
export function questionFor(turns: readonly TranscriptTurn[], answer: number): string | null {
  const at = turns.findIndex((t) => t.answer === answer);
  if (at < 0) return null;
  const asked: string[] = [];
  for (let i = at - 1; i >= 0 && turns[i].role === "assistant"; i--) asked.unshift(turns[i].content);
  return asked.length > 0 ? asked.join("\n\n") : null;
}

/** Lower-cased words: curly quotes and apostrophes made plain, split on anything but letters, digits and '. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return true;
  }
  return false;
}

/**
 * The answer a strength quote came from: its words, in order and as whole words, appear in
 * exactly one answer. Null for a quote under 2 words, no match or more than one match, so a
 * quote is never linked to the wrong answer (FQ-50 gate 1). The interviewer's turns never match.
 */
export function matchQuote(quote: string, turns: readonly TranscriptTurn[]): number | null {
  const q = words(quote);
  if (q.length < 2) return null;
  const hits = turns.filter((t) => t.answer !== undefined && containsRun(words(t.content), q));
  return hits.length === 1 ? hits[0].answer! : null;
}

/** The session's turns, or null on a network error, a 404 or a bad shape. Never throws. */
export async function fetchTurns(sessionId: string, signal?: AbortSignal): Promise<TranscriptTurn[] | null> {
  try {
    const res = await fetch(`${apiUrl}/api/session/${encodeURIComponent(sessionId)}/turns`, { signal });
    if (!res.ok) return null;
    return parseTurns(await res.json());
  } catch {
    return null;
  }
}
