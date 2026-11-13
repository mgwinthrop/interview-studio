// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeSessionNext, startVoiceSession } from "../../app/lib/voiceSession";

describe("safeSessionNext (the mic check's `next` must never leave the site)", () => {
  it("accepts same-site /session? paths", () => {
    expect(safeSessionNext("/session?interviewerId=explain-an-idea")).toBe("/session?interviewerId=explain-an-idea");
    expect(safeSessionNext("/session?mode=try&x=%2Fy")).toBe("/session?mode=try&x=%2Fy");
  });

  it.each([
    ["other same-site path", "/dashboard"],
    ["bare /session without a query", "/session"],
    ["protocol-relative URL", "//evil.example/session?x=1"],
    ["absolute URL", "https://evil.example/session?x=1"],
    ["backslash trick", "/\\evil.example/session?x=1"],
    ["tab (browsers strip it, making //host)", "/\t/evil.example/session?x=1"],
    ["newline", "/session?x=1\nSet-Cookie: a=b"],
    ["empty string", ""],
    ["non-string", 42],
    ["null", null],
    ["too long", "/session?" + "a".repeat(300)],
  ])("refuses %s", (_label, value) => {
    expect(safeSessionNext(value)).toBeNull();
  });
});

describe("startVoiceSession", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("goes straight to the session when the mic check just passed", () => {
    window.sessionStorage.setItem("mic_gesture_granted", "1");
    const router = { push: vi.fn() };
    startVoiceSession(router, "/session?interviewerId=a");
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/session?interviewerId=a");
  });

  it("goes through the mic check otherwise, passing the destination encoded", () => {
    const router = { push: vi.fn() };
    startVoiceSession(router, "/session?interviewerId=a&mode=try");
    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `/mic-check?next=${encodeURIComponent("/session?interviewerId=a&mode=try")}`,
    );
  });

  it("does not treat any other stored value as a passed check", () => {
    window.sessionStorage.setItem("mic_gesture_granted", "true");
    const router = { push: vi.fn() };
    startVoiceSession(router, "/session?interviewerId=a");
    expect(router.push.mock.calls[0][0]).toMatch(/^\/mic-check\?next=/);
  });

  it("falls back to the mic check when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const router = { push: vi.fn() };
    startVoiceSession(router, "/session?interviewerId=a");
    expect(router.push.mock.calls[0][0]).toMatch(/^\/mic-check\?next=/);
    vi.restoreAllMocks();
  });
});
