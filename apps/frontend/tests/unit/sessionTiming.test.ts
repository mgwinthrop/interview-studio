import { describe, expect, it } from "vitest";
import { THINKING_WATCHDOG_MS } from "../../app/session/timing";

describe("session timing", () => {
  it("resets a stuck Thinking state after 10 seconds, not sooner", () => {
    expect(THINKING_WATCHDOG_MS).toBe(10_000);
  });
});
