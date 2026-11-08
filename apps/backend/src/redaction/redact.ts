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
export const B_START = String.raw`(?<![\p{L}\p{N}])`;
export const B_END = String.raw`(?![\p{L}\p{N}])`;

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
// All amount patterns are case-insensitive ("usd 500", "3BN").
// Used only next to a currency, unit or suffix, so space-separated thousands ("10 000", with a regular,
// no-break, thin or narrow no-break space) are safe here.
const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d{3})+(?=,\d)|\d{1,3}(?:[    ]\d{3})+|\d+)(?:[.,]\d+)?`;
const SUFFIX = String.raw`(?:(?:k|m|bn|mn|mm|\s(?:million|billion|thousand|grand))(?![\p{L}\p{N}]))`;
const PER = String.raw`\s?\/\s?(?:hr|hour|h|day|d|wk|week|mo|month|yr|year|annum|head|person|seat|user)(?![\p{L}])`;
const PER_WORDS = String.raw`\s(?:an?|per)\s(?:hour|day|week|month|year|head|person|seat|user)(?![\p{L}])`;
const SYMBOL = "[£$€¥₹]";
const CODES = "USD|EUR|GBP|AUD|CAD|CHF|JPY|INR|NZD|SGD";
// Letter-prefixed symbols (US$, HK$, A$) keep the prefix inside the span.
const SYMBOL_PREFIX = "US|HK|AU|CA|NZ|SG|NT|A|C|S|R";
const PRE = String.raw`(?:(?:(?<![\p{L}\p{N}])(?:${SYMBOL_PREFIX}))?${SYMBOL}|(?<![\p{L}\p{N}])(?:${CODES}))\s?`;
const POST = String.raw`[    ]?(?:${SYMBOL}|(?:${CODES}|pounds?|dollars?|euros?|quid|bucks)(?![\p{L}]))`;
const PCT = String.raw`\s?(?:%|percent${B_END}|per cent${B_END})`;
// One end of a range: optional currency before, number, optional suffix, optional currency or percent after.
const END_BODY = String.raw`${NUM}${SUFFIX}?(?:${POST}|${PCT})?`;
const END = String.raw`(?:${PRE})?${END_BODY}`;
const NUM_START = String.raw`(?<![\p{L}\p{N}.,])`;
// A range counts as an amount only if it carries a currency, a size suffix or a percent somewhere.
const AMOUNT_SIGNAL = new RegExp(
  String.raw`${SYMBOL}|%|\d(?:k|m|bn|mn|mm)(?![\p{L}])|(?<![\p{L}])(?:${CODES}|pounds?|dollars?|euros?|quid|bucks|percent|per cent|million|billion|thousand|grand)(?![\p{L}])`,
  "iu",
);
const amountRange = (m: string) => (AMOUNT_SIGNAL.test(m) ? m.length : null);

const AMOUNT_RES: { re: RegExp; accept?: (m: string) => number | null }[] = [
  // Ranges, as one span with both ends and any unit: $50-75/hr, 20-25%, 2-3k a month, $50 to 75 per hour,
  // and "between 10 and 15%" (the word "between" itself stays).
  {
    re: new RegExp(
      String.raw`(?:(?<=(?<![\p{L}])between\s{1,3})${END}\s{1,3}and\s{1,3}|(?:${PRE}|${NUM_START})${END_BODY}\s{0,3}(?:[-–—]|\sto\s)\s{0,3})${END}(?:${PER}|${PER_WORDS})?`,
      "giu",
    ),
    accept: amountRange,
  },
  // Currency symbol or code, then a number: £1,200, $50/hr, USD 5,000, EUR 40k.
  { re: new RegExp(String.raw`${PRE}${NUM}${SUFFIX}?(?:${PER})?`, "giu") },
  // Number then a currency symbol, code or word: 250 GBP, 300 €, 30 dollars.
  { re: new RegExp(String.raw`${NUM_START}${NUM}${SUFFIX}?${POST}`, "giu") },
  // Pence: 50p.
  { re: new RegExp(String.raw`${B_START}\d+(?:\.\d+)?p${B_END}`, "giu") },
  // Number with a size suffix: 1.2k, 1.5m, 3bn, 2 million.
  { re: new RegExp(String.raw`${NUM_START}${NUM}${SUFFIX}`, "giu") },
  // Percentages: 20%, 12.5 percent.
  { re: new RegExp(String.raw`${B_START}\d+(?:\.\d+)?${PCT}`, "giu") },
  // Bare numbers of 4+ digits, with or without separators: 12,500, 1.200,50, 4000.
  {
    re: new RegExp(
      String.raw`(?<![\p{L}\p{N}.,])(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{4,}(?:\.\d+)?)(?![\p{N}])`,
      "gu",
    ),
  },
];

const CONTACT_PASSES: Pass[] = [
  { re: EMAIL, change: "contact", placeholder: CONTACT },
  { re: URL_RE, change: "contact", placeholder: CONTACT, accept: trimTrailing },
  { re: DOMAIN, change: "contact", placeholder: CONTACT, accept: trimTrailing },
  { re: PHONE, change: "contact", placeholder: CONTACT, accept: phoneDigits },
];
const AMOUNT_PASSES: Pass[] = AMOUNT_RES.map(({ re, accept }) => ({
  re,
  accept,
  change: "amount",
  placeholder: AMOUNT,
}));

// Straight, curly and modifier-letter apostrophes are treated as the same character in names.
export const APOSTROPHES = /['’ʼ]/g;
export const ANY_APOSTROPHE = "['’ʼ]";

// One case-insensitive alternation, longest first so a full name wins over its parts.
function wordListRe(words: string[], possessive: boolean): RegExp | null {
  if (words.length === 0) return null;
  const alts = [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => escapeRe(w).replace(APOSTROPHES, ANY_APOSTROPHE))
    .join("|");
  const poss = possessive ? `(?:${ANY_APOSTROPHE}s)?` : "";
  return new RegExp(`${B_START}(?:${alts})${poss}${B_END}`, "giu");
}

// Parts are split on spaces, dots and hyphens ("Priya.Shah"); a part with an apostrophe also
// yields its pieces ("O'Brien" and "Brien").
function nameParts(name: string): string[] {
  return name
    .split(/[\s.-]+/)
    .flatMap((w) => [w, ...(/['’ʼ]/.test(w) ? w.split(/['’ʼ]+/) : [])])
    .filter((p) => p.length >= MIN_PART && !PARTICLES.has(p.toLowerCase()));
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

// Overlapping spans are merged so no character of either survives. The merged span takes the
// placeholder of the longest one; on a tie the earlier pass wins (contacts, names, terms, amounts).
function findSpans(text: string, passes: Pass[]): Span[] {
  const owner = new Int32Array(text.length).fill(-1);
  const spans: (Span | null)[] = [];
  for (const pass of passes) {
    for (const m of text.matchAll(pass.re)) {
      const start = m.index ?? 0;
      const len = pass.accept ? pass.accept(m[0]) : m[0].length;
      if (!len) continue;
      let merged: Span = { start, end: start + len, change: pass.change, placeholder: pass.placeholder };
      const hit = new Set<number>();
      for (let i = start; i < merged.end; i++) if (owner[i] >= 0) hit.add(owner[i]);
      if (hit.size > 0) {
        // Ids grow in pass order, so visiting them sorted lets the earliest span keep a tie.
        let winner = merged;
        let winnerLen = -1;
        let lo = merged.start;
        let hi = merged.end;
        for (const id of [...hit].sort((a, b) => a - b)) {
          const s = spans[id] as Span;
          lo = Math.min(lo, s.start);
          hi = Math.max(hi, s.end);
          if (s.end - s.start > winnerLen) {
            winner = s;
            winnerLen = s.end - s.start;
          }
          spans[id] = null;
        }
        if (len > winnerLen) winner = merged;
        merged = { start: lo, end: hi, change: winner.change, placeholder: winner.placeholder };
      }
      const id = spans.length;
      spans.push(merged);
      owner.fill(id, merged.start, merged.end);
    }
  }
  return spans.filter((s): s is Span => s !== null).sort((a, b) => a.start - b.start);
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
  const norm = (s: string) => s.normalize("NFC").trim();
  const buyer = norm(counterpart);
  const roles = new Map<string, Role>();
  let ours = 0;
  for (const l of call.lines) {
    if (roles.has(l.speaker)) continue;
    roles.set(l.speaker, norm(l.speaker) === buyer ? "Buyer" : `Our side ${++ours}`);
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
