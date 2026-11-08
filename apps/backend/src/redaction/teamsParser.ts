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
// Name, then a tab or two or more spaces, then the timestamp.
const HEADER_WIDE = new RegExp(String.raw`^(\S.{0,80}?)(?:\t|\s{2,})(${TIME})$`);
// Single space only when the name is a few capitalised words, so prose like "We met at 10:30" is not a header.
const HEADER_SINGLE = new RegExp(
  String.raw`^((?:\p{Lu}[\p{L}'.-]*)(?: \p{Lu}[\p{L}'.-]*){0,4}(?: \((?:Guest|External)\))?) (${TIME})$`,
  "u",
);

function cleanName(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s*[|–—-]\s+.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function headerName(line: string): string | null {
  const m = HEADER_WIDE.exec(line) ?? HEADER_SINGLE.exec(line);
  if (!m) return null;
  const name = cleanName(m[1]);
  return name.length > 0 && name.length <= 80 && !/\d{1,2}:\d{2}/.test(name) ? name : null;
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
    const name = forged ? null : headerName(trimmed);
    if (name) {
      out.push({ speaker: name, parts: [] });
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
