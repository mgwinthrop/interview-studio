import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../app/lib/config", () => ({ apiUrl: "http://api.test" }));

import { parseReport, parseReportFailure, regenerateReport } from "../../app/lib/report";

const v1 = {
  sessionId: "s1",
  summary: "You told a clear story.",
  strengths: [{ area: "Structure", evidence: "Clear arc" }],
  improvements: [{ area: "Pace", suggestion: "Slow down" }],
  highlights: ["Strong opening"],
  overallAssessment: "Good",
  generatedAt: "2026-11-01T10:00:00Z",
};

const v2 = {
  format: 2,
  sessionId: "s2",
  generatedAt: "2026-11-01T10:00:00Z",
  nextSteps: ["Practise the ending"],
  content: {
    summary: "Clear.",
    strengths: [{ area: "Structure", quote: "First,", note: "Good signposting" }],
    developAreas: [{ area: "Pace", suggestion: "Pause more" }],
  },
};

const summary = {
  turnsMeasured: 3,
  totalWords: 210,
  speakingTimeSec: 90,
  averageWordsPerMinute: 140,
  pauseCount: 4,
  longestPauseSec: 2.1,
  medianResponseGapMs: 800,
  fillerCount: null,
  perTurn: [{ turn: 1, wordCount: 70, wordsPerMinute: 140, longestPauseSec: 1.2, responseGapMs: 700 }],
};

// The parser returns a typed union; these tests poke at fields the union does not always have.
type DeliveryLoose = { delivery: { reading?: string; summary: Record<string, unknown> } };

describe("parseReport", () => {
  it("reads the legacy v1 shape, with or without a format field", () => {
    expect(parseReport(v1)).toMatchObject({ format: 1, sessionId: "s1", interviewerName: null });
    expect(parseReport({ ...v1, format: 1, interviewerName: "Maya" })).toMatchObject({ format: 1, interviewerName: "Maya" });
  });

  it("turns a parseable date string into a Date and keeps an unparseable one as text", () => {
    expect((parseReport(v1) as unknown as { generatedAt: unknown }).generatedAt).toBeInstanceOf(Date);
    expect((parseReport({ ...v1, generatedAt: "someday" }) as unknown as { generatedAt: unknown }).generatedAt).toBe("someday");
  });

  it("rejects v1 with a missing or wrongly typed field", () => {
    expect(parseReport({ ...v1, summary: undefined })).toBeNull();
    expect(parseReport({ ...v1, highlights: ["ok", 3] })).toBeNull();
    expect(parseReport({ ...v1, strengths: [{ area: "x" }] })).toBeNull();
    expect(parseReport({ ...v1, generatedAt: 5 })).toBeNull();
  });

  it("reads a v2 report with content only", () => {
    const r = parseReport(v2);
    expect(r).toMatchObject({ format: 2, sessionId: "s2", nextSteps: ["Practise the ending"] });
    expect((r as unknown as { content?: unknown }).content).toBeDefined();
    expect((r as unknown as { delivery?: unknown }).delivery).toBeUndefined();
  });

  it("reads delivery, keeps a missing reading valid, and turns bad numbers into null", () => {
    const withDelivery = parseReport({ ...v2, delivery: { summary } }) as unknown as DeliveryLoose;
    expect(withDelivery.delivery.reading).toBeUndefined();
    expect(withDelivery.delivery.summary.totalWords).toBe(210);
    expect(withDelivery.delivery.summary.fillerCount).toBeNull();

    const odd = parseReport({
      ...v2,
      delivery: { reading: "Steady pace.", summary: { ...summary, totalWords: Infinity, pauseCount: "4" } },
    }) as unknown as DeliveryLoose;
    expect(odd.delivery.reading).toBe("Steady pace.");
    expect(odd.delivery.summary.totalWords).toBeNull();
    expect(odd.delivery.summary.pauseCount).toBeNull();
  });

  it("rejects a v2 report whose sections are malformed", () => {
    expect(parseReport({ ...v2, nextSteps: "x" })).toBeNull();
    expect(parseReport({ ...v2, content: { summary: "x" } })).toBeNull();
    expect(parseReport({ ...v2, delivery: { summary: { ...summary, perTurn: "no" } } })).toBeNull();
    expect(parseReport({ ...v2, delivery: { summary: { ...summary, perTurn: [{ wordCount: 1 }] } } })).toBeNull();
    expect(parseReport({ ...v2, delivery: { reading: 5, summary } })).toBeNull();
  });

  it("flags deliveryUnavailable only when it is exactly true", () => {
    expect((parseReport({ ...v2, deliveryUnavailable: true }) as unknown as { deliveryUnavailable?: boolean }).deliveryUnavailable).toBe(true);
    expect((parseReport({ ...v2, deliveryUnavailable: "true" }) as unknown as { deliveryUnavailable?: boolean }).deliveryUnavailable).toBeUndefined();
  });

  it("returns null for anything that is not a known report and never throws", () => {
    for (const bad of [null, undefined, 5, "x", [], {}, { format: 3 }, { format: "2" }]) {
      expect(parseReport(bad)).toBeNull();
    }
  });
});

describe("parseReportFailure", () => {
  it("maps the known statuses", () => {
    expect(parseReportFailure({ status: "failed", canRegenerate: true })).toEqual({ kind: "failed", canRegenerate: true });
    expect(parseReportFailure({ status: "failed" })).toEqual({ kind: "failed", canRegenerate: false });
    expect(parseReportFailure({ status: "failed", canRegenerate: "yes" })).toEqual({ kind: "failed", canRegenerate: false });
    expect(parseReportFailure({ status: "unreadable" })).toEqual({ kind: "unreadable" });
    expect(parseReportFailure({ status: "abandoned" })).toEqual({ kind: "abandoned" });
  });

  it("falls back to other for anything else", () => {
    for (const bad of [null, 5, [], {}, { status: "weird" }]) expect(parseReportFailure(bad)).toEqual({ kind: "other" });
  });
});

describe("regenerateReport", () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });
  const respond = (status: number, body?: unknown, jsonFails = false) =>
    fetchMock.mockResolvedValue({
      status,
      json: jsonFails ? () => Promise.reject(new Error("bad json")) : () => Promise.resolve(body),
    });

  it("posts to the encoded session path and returns the parsed report", async () => {
    respond(200, v2);
    const r = await regenerateReport("a/b c");
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/session/a%2Fb%20c/report/regenerate", { method: "POST" });
    expect(r).toMatchObject({ ok: true, report: { format: 2 } });
  });

  it("gives fixed messages for each failure and never echoes server text", async () => {
    respond(200, { nope: true });
    expect(await regenerateReport("s")).toMatchObject({ ok: false, message: expect.stringContaining("Something went wrong") });

    respond(200, undefined, true);
    expect(await regenerateReport("s")).toMatchObject({ ok: false, message: expect.stringContaining("Something went wrong") });

    for (const status of [404, 409]) {
      respond(status, { error: "secret internal detail" });
      expect(await regenerateReport("s")).toEqual({ ok: false, message: "This report can't be regenerated." });
    }

    respond(500, { error: "secret internal detail" });
    const failed = await regenerateReport("s");
    expect(failed).toMatchObject({ ok: false });
    expect(JSON.stringify(failed)).not.toContain("secret");

    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await regenerateReport("s")).toMatchObject({ ok: false, message: expect.stringContaining("couldn't reach the server") });
  });
});
