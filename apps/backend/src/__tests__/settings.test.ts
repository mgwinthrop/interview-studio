import { describe, expect, it } from "vitest";
import { BUILT_IN, SETTINGS_LIMITS, SPOKEN_FORMATS, parsePriceRows, parseValuesPatch } from "../settings";

const bad = (r: { ok: boolean }) => expect(r.ok).toBe(false);

describe("parseValuesPatch", () => {
  it("accepts an empty patch and every field", () => {
    expect(parseValuesPatch({})).toEqual({ ok: true, value: {} });
    const all = {
      replyModel: "claude-a:1",
      reportModel: "r.b_2",
      draftModel: "d",
      replyMaxTokens: 300,
      sttModel: "scribe_v2",
      ttsModel: "eleven_flash_v2_5",
      spokenFormat: "mp3_44100_128",
    };
    expect(parseValuesPatch(all)).toEqual({ ok: true, value: all });
  });

  it("accepts reply tokens at the limits and rejects outside them", () => {
    expect(parseValuesPatch({ replyMaxTokens: 50 }).ok).toBe(true);
    expect(parseValuesPatch({ replyMaxTokens: 1000 }).ok).toBe(true);
    for (const v of [49, 1001, 100.5, "300", null, NaN]) bad(parseValuesPatch({ replyMaxTokens: v }));
  });

  it("refuses unknown keys, non-objects, bad formats and bad ids", () => {
    bad(parseValuesPatch({ nope: 1 }));
    bad(parseValuesPatch(null));
    bad(parseValuesPatch([]));
    bad(parseValuesPatch({ spokenFormat: "mp3_1_1" }));
    bad(parseValuesPatch({ sttModel: "has space" }));
    bad(parseValuesPatch({ sttModel: "a".repeat(61) }));
    bad(parseValuesPatch({ replyModel: "a".repeat(101) }));
    expect(parseValuesPatch({ replyModel: "a".repeat(100) }).ok).toBe(true);
    bad(parseValuesPatch({ ttsModel: "" }));
  });

  it("accepts every spoken format", () => {
    for (const f of SPOKEN_FORMATS) expect(parseValuesPatch({ spokenFormat: f }).ok).toBe(true);
  });

  it("uses fixed messages, paths and never echoes input", () => {
    const secret = "sk-secret value!";
    const r = parseValuesPatch({ replyModel: secret, extraSecretKey: secret, replyMaxTokens: secret });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const text = JSON.stringify(r.errors);
      expect(text).not.toContain("sk-secret");
      expect(text).not.toContain("extraSecretKey");
      expect(r.errors.map((e) => e.path).sort()).toEqual(["", "replyMaxTokens", "replyModel"].sort());
    }
  });
});

describe("BUILT_IN and limits", () => {
  it("has the documented fallbacks", () => {
    expect(BUILT_IN).toEqual({
      replyModel: "claude-sonnet-4-6",
      reportModel: "claude-sonnet-4-6",
      draftModel: "claude-sonnet-4-6",
      replyMaxTokens: 300,
      sttModel: "scribe_v2",
      ttsModel: "eleven_flash_v2_5",
      spokenFormat: "mp3_44100_128",
    });
    expect(SETTINGS_LIMITS.maxPriceRows).toBe(50);
  });
});

describe("parsePriceRows", () => {
  const row = { model: "m", inputPerMtok: 0, outputPerMtok: 100000, asOf: "2026-11-08" };

  it("accepts a valid row and an empty list", () => {
    expect(parsePriceRows([row])).toEqual({ ok: true, value: [row] });
    expect(parsePriceRows([])).toEqual({ ok: true, value: [] });
  });

  it("rejects bad numbers, dates, shapes and extra keys", () => {
    for (const patch of [
      { inputPerMtok: -1 },
      { outputPerMtok: NaN },
      { outputPerMtok: Infinity },
      { outputPerMtok: 100001 },
      { inputPerMtok: "1" },
      { asOf: "2026-13-40" },
      { asOf: "2026-02-30" },
      { asOf: "11/08/2026" },
      { model: "bad id" },
      { extra: 1 },
    ]) {
      bad(parsePriceRows([{ ...row, ...patch }]));
    }
    bad(parsePriceRows("x"));
    bad(parsePriceRows([null]));
    expect(parsePriceRows([{ ...row, asOf: "2028-02-29" }]).ok).toBe(true);
  });

  it("rejects duplicates (case-sensitive) and more than 50 rows", () => {
    bad(parsePriceRows([row, row]));
    expect(parsePriceRows([row, { ...row, model: "M" }]).ok).toBe(true);
    const many = Array.from({ length: 51 }, (_, i) => ({ ...row, model: `m${i}` }));
    bad(parsePriceRows(many));
    expect(parsePriceRows(many.slice(0, 50)).ok).toBe(true);
  });

  it("gives indexed paths and never echoes input", () => {
    const r = parsePriceRows([row, { ...row, model: "leak me", inputPerMtok: -5 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["prices.1.model", "prices.1.inputPerMtok"]));
      expect(JSON.stringify(r.errors)).not.toContain("leak me");
    }
  });
});
