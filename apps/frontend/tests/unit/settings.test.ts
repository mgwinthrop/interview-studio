import { describe, expect, it } from "vitest";
import {
  SETTINGS_LIMITS,
  isRealDate,
  isValidSttId,
  parsePrice,
  parseReplyTokens,
} from "../../app/lib/settings";

describe("parseReplyTokens", () => {
  const { replyMaxTokensMin: min, replyMaxTokensMax: max } = SETTINGS_LIMITS;

  it("accepts whole numbers inside the range, ignoring surrounding spaces", () => {
    expect(parseReplyTokens(String(min))).toBe(min);
    expect(parseReplyTokens(String(max))).toBe(max);
    expect(parseReplyTokens("  300 ")).toBe(300);
  });
  it("refuses out-of-range values", () => {
    expect(parseReplyTokens(String(min - 1))).toBeNull();
    expect(parseReplyTokens(String(max + 1))).toBeNull();
    expect(parseReplyTokens("0")).toBeNull();
  });
  it.each(["", "abc", "1e3", "-100", "+100", "100.5", "1,000", "0x64", "٣٠٠"])("refuses %j", (v) => {
    expect(parseReplyTokens(v)).toBeNull();
  });
});

describe("parsePrice", () => {
  it.each([
    ["5", 5],
    ["5.", 5],
    [".5", 0.5],
    ["0", 0],
    ["0.30", 0.3],
    [" 12.75 ", 12.75],
    [String(SETTINGS_LIMITS.priceMax), SETTINGS_LIMITS.priceMax],
  ])("accepts %j", (v, n) => {
    expect(parsePrice(v)).toBe(n);
  });

  it.each(["", ".", "-1", "+1", "1,5", "1e3", "abc", "1 000", "NaN", "Infinity", String(SETTINGS_LIMITS.priceMax + 1)])(
    "refuses %j",
    (v) => {
      expect(parsePrice(v)).toBeNull();
    },
  );
});

describe("isRealDate", () => {
  it.each(["2026-11-13", "2024-02-29", "2026-12-31"])("accepts %s", (s) => expect(isRealDate(s)).toBe(true));
  it.each(["2026-02-29", "2026-13-01", "2026-00-10", "2026-11-31", "2026-1-5", "13/11/2026", "", "2026-11-13T00:00"])(
    "refuses %j",
    (s) => expect(isRealDate(s)).toBe(false),
  );
});

describe("isValidSttId", () => {
  it("allows letters, digits, dot, underscore and hyphen up to the limit", () => {
    expect(isValidSttId("scribe_v2")).toBe(true);
    expect(isValidSttId("a".repeat(60))).toBe(true);
  });
  it("refuses empty, too long and other characters", () => {
    expect(isValidSttId("")).toBe(false);
    expect(isValidSttId("a".repeat(61))).toBe(false);
    expect(isValidSttId("has space")).toBe(false);
    expect(isValidSttId("a:b")).toBe(false);
    expect(isValidSttId("../x")).toBe(false);
  });
});
