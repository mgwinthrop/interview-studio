import type { ParsedCall } from "./teamsParser";

// Best-effort, deterministic redaction of a parsed call. Runs locally: no network, no model, no logging.
// The person reviews the result before anything is sent anywhere.

export type ChangeKind = "name" | "term" | "amount" | "contact";
export interface Segment {
  text: string;
  change?: ChangeKind;
}
export type Role = "Buyer" | `Our side ${number}`;
export interface RedactionResult {
  lines: { role: Role; segments: Segment[] }[];
  text: string;
  suggestions: string[];
  forbidden: string[];
}

const NAME = "[NAME]";
const CLIENT = "[CLIENT]";
const AMOUNT = "[AMOUNT]";
const CONTACT = "[CONTACT]";

// Matches the parser's particles; they are not matched or forbidden on their own ("van", "ten").
const PARTICLES = new Set("de da di del della der den van von la le el al bin bint ten ter du dos das".split(" "));
const MIN_PART = 3;

// Word boundaries that work for any script (plain \b only knows ASCII).
const B_START = String.raw`(?<![\p{L}\p{N}])`;
const B_END = String.raw`(?![\p{L}\p{N}])`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A pass turns regex matches into spans. `accept` returns the span length (to trim the match) or null to reject it.
interface Pass {
  re: RegExp;
  change: ChangeKind;
  placeholder: string;
  accept?: (m: string) => number | null;
}

// --- Contacts ---------------------------------------------------------------------------------
const EMAIL = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}(?![\p{L}\p{N}])/gu;
const URL_RE = /(?<![\p{L}\p{N}])(?:https?:\/\/|www\.)[^\s<>"]+/giu;
const TLDS = "com|net|org|io|co|uk|us|eu|de|fr|nl|es|it|ie|au|ca|in|ai|app|dev|biz|info|gov|edu";
const DOMAIN = new RegExp(
  String.raw`(?<![\p{L}\p{N}@.-])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:${TLDS})(?![\p{L}\p{N}-])(?:\/[^\s<>"]*)?`,
  "giu",
);
const PHONE = /(?<![\p{L}\p{N}+(])\+?\(?\d[\d ().-]{6,20}\d(?![\p{N}])/gu;
const TRAILING_PUNCT = /[.,;:!?)\]'"]+$/;

const trimTrailing = (m: string) => m.replace(TRAILING_PUNCT, "").length || null;
// 9+ digits, or 7+ when written like a phone number (+, brackets or a dash).
const phoneDigits = (m: string) => {
  const digits = m.match(/\d/g)?.length ?? 0;
  return digits >= 9 || (digits >= 7 && /[+(-]/.test(m)) ? m.length : null;
};

// --- Amounts ----------------------------------------------------------------------------------
// Used only next to a currency, unit or suffix, so space-separated thousands ("10 000") are safe here.
const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d{3})+(?=,\d)|\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,]\d+)?`;
const SUFFIX = String.raw`(?:(?:[kKmM]|bn|\s(?:million|billion|thousand|grand))(?![\p{L}\p{N}]))`;
const PER = String.raw`\s?\/\s?(?:hr|hour|h|day|d|wk|week|mo|month|yr|year|annum|head|person|seat|user)(?![\p{L}])`;
const CODES = "USD|EUR|GBP|AUD|CAD|CHF|JPY|INR|NZD|SGD";
const AMOUNT_RES = [
  // Currency symbol or code, then a number: £1,200, $50/hr, USD 5,000, EUR 40k.
  new RegExp(String.raw`(?:[£$€¥₹]|${B_START}(?:${CODES}))\s?${NUM}${SUFFIX}?(?:${PER})?`, "gu"),
  // Number then a currency code or word: 250 GBP, 30 dollars.
  new RegExp(
    String.raw`${B_START}${NUM}${SUFFIX}?\s?(?:${CODES}|pounds?|dollars?|euros?|quid|bucks)(?![\p{L}])`,
    "giu",
  ),
  // Pence: 50p.
  new RegExp(String.raw`${B_START}\d+(?:\.\d+)?p${B_END}`, "gu"),
  // Number with a size suffix: 1.2k, 1.5m, 3bn, 2 million.
  new RegExp(String.raw`${B_START}${NUM}${SUFFIX}`, "gu"),
  // Percentages: 20%, 12.5 percent.
  new RegExp(String.raw`${B_START}\d+(?:\.\d+)?\s?(?:%|percent${B_END}|per cent${B_END})`, "giu"),
  // Bare numbers of 4+ digits, with or without separators: 12,500, 1.200,50, 4000.
  new RegExp(
    String.raw`(?<![\p{L}\p{N}.,])(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{4,}(?:\.\d+)?)(?![\p{N}])`,
    "gu",
  ),
];

const CONTACT_PASSES: Pass[] = [
  { re: EMAIL, change: "contact", placeholder: CONTACT },
  { re: URL_RE, change: "contact", placeholder: CONTACT, accept: trimTrailing },
  { re: DOMAIN, change: "contact", placeholder: CONTACT, accept: trimTrailing },
  { re: PHONE, change: "contact", placeholder: CONTACT, accept: phoneDigits },
];
const AMOUNT_PASSES: Pass[] = AMOUNT_RES.map((re) => ({ re, change: "amount", placeholder: AMOUNT }));

// One case-insensitive alternation, longest first so a full name wins over its parts.
function wordListRe(words: string[], possessive: boolean): RegExp | null {
  if (words.length === 0) return null;
  const alts = [...words].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  const poss = possessive ? "(?:['’]s)?" : "";
  return new RegExp(`${B_START}(?:${alts})${poss}${B_END}`, "giu");
}

function nameParts(name: string): string[] {
  return name.split(/[\s-]+/).filter((p) => p.length >= MIN_PART && !PARTICLES.has(p.toLowerCase()));
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

interface Span {
  start: number;
  end: number;
  change: ChangeKind;
  placeholder: string;
}

function findSpans(text: string, passes: Pass[]): Span[] {
  const taken = new Uint8Array(text.length);
  const spans: Span[] = [];
  for (const pass of passes) {
    for (const m of text.matchAll(pass.re)) {
      const start = m.index ?? 0;
      const len = pass.accept ? pass.accept(m[0]) : m[0].length;
      if (!len) continue;
      const end = start + len;
      let free = true;
      for (let i = start; i < end; i++) {
        if (taken[i]) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      taken.fill(1, start, end);
      spans.push({ start, end, change: pass.change, placeholder: pass.placeholder });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

function toSegments(text: string, spans: Span[]): Segment[] {
  const segments: Segment[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start > at) segments.push({ text: text.slice(at, s.start) });
    segments.push({ text: s.placeholder, change: s.change });
    at = s.end;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}

// --- Suggestions ------------------------------------------------------------------------------
const STOP = new Set(
  [
    "I'm", "I'll", "I've", "I'd", "OK", "Okay", "Teams", "Zoom", "Mr", "Mrs", "Ms", "Dr",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
  ].map((w) => w.toLowerCase()),
);
const CAP_WORD = /(?<![\p{L}\p{N}'’-])\p{Lu}[\p{L}\p{N}'’-]*/gu;

function isSentenceStart(text: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && /[\s"'“‘(\[]/.test(text[i])) i--;
  return i < 0 || /[.!?…]/.test(text[i]);
}

function lineSuggestions(text: string, spans: Span[], out: Set<string>): void {
  const inSpan = (start: number, end: number) => spans.some((s) => start < s.end && end > s.start);
  let phrase: string[] = [];
  let phraseEnd = -1;
  const flush = () => {
    if (phrase.length > 0) out.add(phrase.join(" "));
    phrase = [];
  };
  for (const m of text.matchAll(CAP_WORD)) {
    const start = m.index ?? 0;
    const word = m[0].replace(/['’]s$/, "").replace(/['’-]+$/, "");
    const end = start + m[0].length;
    const usable = word.length >= 2 && !STOP.has(word.replace(/’/g, "'").toLowerCase()) && !inSpan(start, end);
    const continues = phrase.length > 0 && start === phraseEnd + 1 && text[phraseEnd] === " ";
    if (!continues) flush();
    if (usable && (continues || !isSentenceStart(text, start))) {
      phrase.push(word);
      phraseEnd = end;
      // A possessive ends the phrase: "Fabrikam's team".
      if (word.length !== m[0].length) flush();
    } else {
      flush();
    }
  }
  flush();
}

// --- Entry point ------------------------------------------------------------------------------
export function redactCall(call: ParsedCall, counterpart: string, terms: string[]): RedactionResult {
  const roles = new Map<string, Role>();
  let ours = 0;
  for (const l of call.lines) {
    if (roles.has(l.speaker)) continue;
    roles.set(l.speaker, l.speaker === counterpart ? "Buyer" : `Our side ${++ours}`);
  }

  // The counterpart is redacted even if they never speak in this call.
  const speakerNames = dedupe(
    [...call.speakers.map((s) => s.name), ...roles.keys(), counterpart]
      .map((n) => n.normalize("NFC").trim())
      .filter(Boolean),
  );
  const names = dedupe(speakerNames.flatMap((n) => [n, ...nameParts(n)]));
  const cleanTerms = dedupe(terms.map((t) => t.normalize("NFC").trim()).filter(Boolean));

  const passes: Pass[] = [...CONTACT_PASSES];
  const nameRe = wordListRe(names, true);
  if (nameRe) passes.push({ re: nameRe, change: "name", placeholder: NAME });
  const termRe = wordListRe(cleanTerms, false);
  if (termRe) passes.push({ re: termRe, change: "term", placeholder: CLIENT });
  passes.push(...AMOUNT_PASSES);

  const found = new Set<string>();
  const lines = call.lines.map((l) => {
    const text = l.text.normalize("NFC");
    const spans = findSpans(text, passes);
    lineSuggestions(text, spans, found);
    return { role: roles.get(l.speaker) as Role, segments: toSegments(text, spans) };
  });

  const blocked = new Set([...names, ...cleanTerms].map((w) => w.toLocaleLowerCase()));
  const suggestions = dedupe([...found].filter((s) => !blocked.has(s.toLocaleLowerCase()))).sort();

  const reserved = new Set(["buyer", NAME, CLIENT, AMOUNT, CONTACT].map((w) => w.toLowerCase()));
  const forbidden = dedupe([...names, ...cleanTerms]).filter(
    (w) => !reserved.has(w.toLowerCase()) && !/^our side \d+$/i.test(w),
  );

  return {
    lines,
    text: lines.map((l) => `${l.role}: ${l.segments.map((s) => s.text).join("")}`).join("\n"),
    suggestions,
    forbidden,
  };
}
