import type { InterviewerInput } from "../interviewer/schema";
import { ANY_APOSTROPHE, APOSTROPHES, B_END, B_START, escapeRe } from "./redact";

// Last check on a composite draft: no forbidden name or term may appear in it. Runs locally, never logs.
//
// Case rule, a deliberate privacy trade-off. Name parts like "Will", "Mark" or "Price" are also
// ordinary words, and a case-insensitive check would reject nearly every draft for people with such
// names. So a single capitalised token ("Will", "Apple") matches only in its own case or in full
// upper case ("Will", "WILL"), not lowercase-initial ("will"): a lower-case rendering of a bare
// capitalised first name or term is not caught. Multi-word entries (full names) and terms typed in
// lower case ("northwind") keep the strict case-insensitive check.

/** Shorter forbidden strings are ignored: they match ordinary words too often to mean anything. */
const MIN_FORBIDDEN = 3;

const STARTS_UPPER = /^[\p{Lu}\p{Lt}]/u;

function textFields(draft: InterviewerInput): string[] {
  return [
    draft.name,
    draft.purpose,
    draft.persona,
    draft.style,
    draft.behaviours ?? "",
    draft.opening,
    draft.closing,
    ...draft.phases.flatMap((p) => [p.name, p.instruction]),
    ...draft.focus,
  ];
}

/** Escaped for a regex; apostrophe variants match each other and any whitespace run matches any other. */
const pattern = (w: string) => escapeRe(w).replace(APOSTROPHES, ANY_APOSTROPHE).replace(/\s+/g, String.raw`\s+`);

function leakRe(w: string): RegExp {
  if (/\s/.test(w) || !STARTS_UPPER.test(w)) {
    return new RegExp(`${B_START}${pattern(w)}${B_END}`, "iu");
  }
  const forms = [...new Set([w, w.toUpperCase()])].map(pattern).join("|");
  return new RegExp(`${B_START}(?:${forms})${B_END}`, "u");
}

/**
 * The forbidden strings found in any text field of the draft, whole words only (Unicode-aware
 * boundaries), each returned once in input order, with the case rule above. Empty strings and
 * strings shorter than 3 characters are ignored.
 */
export function findLeaks(draft: InterviewerInput, forbidden: readonly string[]): string[] {
  const text = textFields(draft).join("\n").normalize("NFC");
  const found: string[] = [];
  for (const word of forbidden) {
    const w = word.normalize("NFC").trim();
    if (w.length < MIN_FORBIDDEN || found.includes(word)) continue;
    if (leakRe(w).test(text)) found.push(word);
  }
  return found;
}
