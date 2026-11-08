import type { InterviewerInput } from "../interviewer/schema";
import { ANY_APOSTROPHE, APOSTROPHES, B_END, B_START, escapeRe } from "./redact";

// Last check on a composite draft: no forbidden name or term may appear in it. Runs locally, never logs.

/** Shorter forbidden strings are ignored: they match ordinary words too often to mean anything. */
const MIN_FORBIDDEN = 3;

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

/**
 * The forbidden strings found in any text field of the draft: case-insensitive, whole words
 * (Unicode-aware boundaries), each returned once in input order. Empty strings and strings shorter
 * than 3 characters are ignored.
 */
export function findLeaks(draft: InterviewerInput, forbidden: readonly string[]): string[] {
  const text = textFields(draft).join("\n").normalize("NFC");
  const found: string[] = [];
  for (const word of forbidden) {
    const w = word.normalize("NFC").trim();
    if (w.length < MIN_FORBIDDEN || found.includes(word)) continue;
    // Any run of whitespace matches any other ("Tobias  Vrell"); apostrophe variants match each other.
    const body = escapeRe(w).replace(APOSTROPHES, ANY_APOSTROPHE).replace(/\s+/g, String.raw`\s+`);
    const re = new RegExp(`${B_START}${body}${B_END}`, "iu");
    if (re.test(text)) found.push(word);
  }
  return found;
}
