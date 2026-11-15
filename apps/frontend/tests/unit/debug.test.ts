import { describe, expect, it } from "vitest";
import { isDebug } from "../../app/lib/debug";

describe("isDebug (operator details on the live session only with ?debug=1)", () => {
  it("is on only for the exact value 1", () => {
    expect(isDebug(new URLSearchParams("debug=1"))).toBe(true);
    expect(isDebug(new URLSearchParams("interviewerId=explain-an-idea&demo=true&debug=1"))).toBe(true);
  });

  it.each([
    ["true", "debug=true"],
    ["0", "debug=0"],
    ["empty value", "debug="],
    ["bare key", "debug"],
    ["padded value", "debug=%201"],
    ["absent", "interviewerId=explain-an-idea"],
    ["no query at all", ""],
  ])("is off for %s", (_name, query) => {
    expect(isDebug(new URLSearchParams(query))).toBe(false);
  });

  it("uses the first value when the key repeats", () => {
    expect(isDebug(new URLSearchParams("debug=1&debug=0"))).toBe(true);
    expect(isDebug(new URLSearchParams("debug=0&debug=1"))).toBe(false);
  });

  it("is off when there are no search params", () => {
    expect(isDebug(null)).toBe(false);
    expect(isDebug(undefined)).toBe(false);
  });
});
