import { LINE_BREAKS } from "../interviewer/designer";

export interface CallLine {
  speaker: string;
  text: string;
}
export interface ParsedCall {
  lines: CallLine[];
  speakers: { name: string; lines: number }[];
}
export type ParseResult =
  | { ok: true; call: ParsedCall }
  | { ok: false; reason: "no_speakers" | "too_long" | "empty" };

export const MAX_CALL_CHARS = 24_000;

// Control characters except tab and the line breaks handled separately.
const CONTROL = /[\u0000-\u0008\u000E-\u001F\u007F]/g;
const REAL_NEWLINE = /\r\n|\r|\n/;
const TIME = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}`;
// Name, then a tab or two or more spaces, then a standalone timestamp.
const HEADER_WIDE = new RegExp(String.raw`^(\S.{0,120}?)(?:\t|\s{2,})(${TIME})$`);
const HEADER_SINGLE = new RegExp(String.raw`^(\S.{0,120}?) (${TIME})$`);

// Name shape: 1 to 6 words, each capitalised (letters, digits, ' - . after the first) or a known particle.
// Accepted limit: single-space headers for names outside this shape (for example non-cased scripts)
// are treated as text.
const PARTICLES = new Set("de da di del della der den van von la le el al bin bint ten ter du dos das".split(" "));
const NAME_WORD = /^\p{Lu}[\p{L}\p{N}'.-]*$/u;

function isNameShape(name: string): boolean {
  const words = name.split(" ");
  return words.length >= 1 && words.length <= 6 && words.every((w) => NAME_WORD.test(w) || PARTICLES.has(w));
}

function cleanName(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s*[|\u2013\u2014-]\s+.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

type Header = { kind: "header"; name: string } | { kind: "reject" } | { kind: "text" };

function classify(line: string): Header {
  const wide = HEADER_WIDE.exec(line);
  const m = wide ?? HEADER_SINGLE.exec(line);
  if (!m) return { kind: "text" };
  const name = cleanName(m[1]);
  if (name.length > 0 && isNameShape(name)) return { kind: "header", name };
  return wide ? { kind: "reject" } : { kind: "text" };
}

export function parseTeamsTranscript(raw: string): ParseResult {
  if (raw.trim().length === 0) return { ok: false, reason: "empty" };
  if (raw.length > MAX_CALL_CHARS) return { ok: false, reason: "too_long" };

  const lines = raw
    .replace(CONTROL, "")
    .split(REAL_NEWLINE)
    // A line that held an exotic break is text, never a header, so it cannot forge one.
    .map((l) => {
      const text = l.replace(LINE_BREAKS, " ");
      return { text, forged: text !== l };
    });

  const out: { speaker: string; parts: string[] }[] = [];
  for (const { text, forged } of lines) {
    const trimmed = text.trim();
    const c: Header = forged ? { kind: "text" } : classify(trimmed);
    if (c.kind === "reject") return { ok: false, reason: "no_speakers" };
    if (c.kind === "header") {
      out.push({ speaker: c.name, parts: [] });
    } else if (out.length > 0 && trimmed) {
      out[out.length - 1].parts.push(trimmed.replace(/\s+/g, " "));
    }
  }
  if (out.length === 0) return { ok: false, reason: "no_speakers" };

  const callLines: CallLine[] = out
    .map((o) => ({ speaker: o.speaker, text: o.parts.join(" ") }))
    .filter((l) => l.text.length > 0);
  const counts = new Map<string, number>();
  for (const l of callLines) counts.set(l.speaker, (counts.get(l.speaker) ?? 0) + 1);
  if (callLines.length === 0) return { ok: false, reason: "no_speakers" };

  return {
    ok: true,
    call: { lines: callLines, speakers: [...counts].map(([name, lines]) => ({ name, lines })) },
  };
}
