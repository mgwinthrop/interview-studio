import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTrend, MIN_POINTS, parseTrend } from "../../app/lib/deliveryTrend";

// FQ-52 S0 (#180): the Progress page's response parser and fetch.

const point = {
  sessionId: "s-1",
  startedAt: "2026-11-03T09:00:00.000Z",
  interviewerId: "tell-a-story",
  interviewerName: "Story listener",
  answersMeasured: 4,
  paceWpm: 142.5,
  gapMs: 1400,
  longestPauseSec: 3.21,
  answerWords: 96,
};

describe("parseTrend", () => {
  it("accepts the route's exact shape with no sessions", () => {
    expect(parseTrend({ showFillers: false, sessions: [] })).toEqual({ showFillers: false, sessions: [] });
  });

  it("accepts points, with nulls for numbers that were not measured", () => {
    const unmeasured = { ...point, sessionId: "s-2", paceWpm: null, interviewerName: null };
    expect(parseTrend({ showFillers: false, sessions: [point, unmeasured] })).toEqual({
      showFillers: false,
      sessions: [point, unmeasured],
    });
  });

  it("accepts a filler rate (or null) only when showFillers is true", () => {
    const withRate = { ...point, fillersPer100Words: 2.5 };
    const hidden = { ...point, fillersPer100Words: null };
    expect(parseTrend({ showFillers: true, sessions: [withRate, hidden] })?.sessions).toEqual([withRate, hidden]);
    expect(parseTrend({ showFillers: true, sessions: [point] })).toBeNull();
    expect(parseTrend({ showFillers: false, sessions: [withRate] })).toBeNull();
  });

  it("keeps only known fields", () => {
    const parsed = parseTrend({ showFillers: false, sessions: [{ ...point, content: "words" }] });
    expect(parsed?.sessions[0]).toEqual(point);
  });

  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["an array", []],
    ["showFillers missing", { sessions: [] }],
    ["showFillers not a boolean", { showFillers: "false", sessions: [] }],
    ["sessions missing", { showFillers: false }],
    ["sessions not an array", { showFillers: false, sessions: {} }],
  ])("rejects a body that is %s", (_label, body) => {
    expect(parseTrend(body)).toBeNull();
  });

  it.each([
    ["sessionId not a string", { sessionId: 1 }],
    ["startedAt not a date", { startedAt: "yesterday" }],
    ["interviewerId missing", { interviewerId: undefined }],
    ["interviewerName a number", { interviewerName: 3 }],
    ["answersMeasured zero", { answersMeasured: 0 }],
    ["answersMeasured fractional", { answersMeasured: 1.5 }],
    ["a negative number", { gapMs: -1 }],
    ["a non-finite number", { paceWpm: Number.POSITIVE_INFINITY }],
    ["a number as a string", { answerWords: "96" }],
    ["a number missing", { longestPauseSec: undefined }],
  ])("rejects the whole body when one point has %s", (_label, change) => {
    const bad = { ...point, sessionId: "s-bad", ...change };
    expect(parseTrend({ showFillers: false, sessions: [point, bad] })).toBeNull();
  });
});

describe("fetchTrend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respond = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it("resolves the parsed body on 200", async () => {
    respond(200, { showFillers: true, sessions: [] });
    await expect(fetchTrend()).resolves.toEqual({ showFillers: true, sessions: [] });
  });

  it("asks for /api/delivery/trend", async () => {
    respond(200, { showFillers: false, sessions: [] });
    await fetchTrend();
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toMatch(/\/api\/delivery\/trend$/);
  });

  it("resolves null on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await expect(fetchTrend()).resolves.toBeNull();
  });

  it("resolves null on a non-200 status", async () => {
    respond(500, { error: "Internal error" });
    await expect(fetchTrend()).resolves.toBeNull();
  });

  it("resolves null on a bad shape", async () => {
    respond(200, { showFillers: false });
    await expect(fetchTrend()).resolves.toBeNull();
  });

  it("resolves null on a body that is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(fetchTrend()).resolves.toBeNull();
  });

  it("resolves null when aborted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new DOMException("aborted", "AbortError"))),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(fetchTrend(controller.signal)).resolves.toBeNull();
  });
});

describe("MIN_POINTS", () => {
  it("needs two sessions to compare", () => {
    expect(MIN_POINTS).toBe(2);
  });
});
