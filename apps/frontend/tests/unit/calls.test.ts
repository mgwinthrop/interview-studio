import { describe, expect, it } from "vitest";
import {
  MAX_SENT_CHARS,
  MAX_TERMS,
  MAX_TERM_CHARS,
  hasBuyerLine,
  normaliseApprovedText,
  parseTerms,
  sendSummary,
} from "../../app/lib/calls";

describe("parseTerms (names to hide)", () => {
  it("splits on commas and newlines, trims, and drops empties", () => {
    expect(parseTerms(" Acme ,\n\nGlobex\r\nInitech, ")).toEqual({ ok: true, terms: ["Acme", "Globex", "Initech"] });
  });
  it("drops repeats ignoring case but keeps the first spelling", () => {
    expect(parseTerms("Acme, acme, ACME, Bob")).toEqual({ ok: true, terms: ["Acme", "Bob"] });
  });
  it("accepts an empty box", () => {
    expect(parseTerms("")).toEqual({ ok: true, terms: [] });
  });
  it("refuses control characters", () => {
    const r = parseTerms("Acme, Bo\u0000b");
    expect(r.ok).toBe(false);
  });
  it("refuses a name over the length limit, and allows exactly the limit", () => {
    expect(parseTerms("a".repeat(MAX_TERM_CHARS)).ok).toBe(true);
    expect(parseTerms("a".repeat(MAX_TERM_CHARS + 1)).ok).toBe(false);
  });
  it("refuses more names than the limit", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `n${i}`).join(",");
    expect(parseTerms(many(MAX_TERMS)).ok).toBe(true);
    expect(parseTerms(many(MAX_TERMS + 1)).ok).toBe(false);
  });
});

describe("normaliseApprovedText", () => {
  it("normalises line endings, turns tabs into spaces and removes other control characters", () => {
    expect(normaliseApprovedText("a\r\nb\rc\td\u0000e\u0007f\u007fg")).toBe("a\nb\nc de" + "fg");
  });
  it("trims the ends but keeps inner blank lines", () => {
    expect(normaliseApprovedText("\n  hi\n\nthere  \n")).toBe("hi\n\nthere");
  });
});

describe("hasBuyerLine", () => {
  it("finds a Buyer line, even indented or after other lines", () => {
    expect(hasBuyerLine("Buyer: hello")).toBe(true);
    expect(hasBuyerLine("Our side 1: hi\n  Buyer: yes")).toBe(true);
  });
  it("does not match without the exact prefix", () => {
    expect(hasBuyerLine("buyer: hello")).toBe(false);
    expect(hasBuyerLine("Buyer:hello")).toBe(false);
    expect(hasBuyerLine("The Buyer: said")).toBe(false);
    expect(hasBuyerLine("")).toBe(false);
  });
});

describe("sendSummary", () => {
  const call = (text: string) => ({ text, forbidden: [] as string[] });

  it("counts the buyer's lines and the line before each", () => {
    const text = "Our side 1: one\nOur side 1: two\nBuyer: three\nOur side 1: four";
    const s = sendSummary([call(text)]);
    expect(s.approved).toBe(text.length);
    // "two" + "three" joined by one newline; "one" and "four" are not sent
    expect(s.sent).toBe("Our side 1: two".length + 1 + "Buyer: three".length);
    expect(s.trimmed).toBe(false);
  });

  it("sends nothing when there is no buyer line", () => {
    expect(sendSummary([call("Our side 1: just us")])).toMatchObject({ sent: 0, trimmed: false });
    expect(sendSummary([])).toEqual({ approved: 0, sent: 0, trimmed: false });
  });

  it("joins wrapped lines onto the line they continue", () => {
    const s = sendSummary([call("Buyer: first part\nsecond part")]);
    expect(s.sent).toBe("Buyer: first part second part".length);
  });

  it("keeps the newest material and says so when the size limit trims the rest", () => {
    const line = "Buyer: " + "x".repeat(9_000);
    const s = sendSummary([call([line, line, line, line].join("\n"))]);
    expect(s.trimmed).toBe(true);
    expect(s.sent).toBeLessThanOrEqual(MAX_SENT_CHARS);
    expect(s.sent).toBeGreaterThan(0);
  });

  it("reports the full limit when a single line alone is too large", () => {
    const s = sendSummary([call("Buyer: " + "x".repeat(MAX_SENT_CHARS + 500))]);
    expect(s).toMatchObject({ sent: MAX_SENT_CHARS, trimmed: true });
  });
});
