import { describe, expect, it } from "vitest";
import { eventLabel, HISTORY_EVENT_TYPES, type HistoryEventInput } from "../../app/session/history/labels";
import { SessionHistory, type ScreenSnapshot } from "../../app/session/history/history";

// FQ-108 S11 (#132): the debug session history (?debug=1) must never record anything a person
// said or wrote. Labels are built only from allow-listed kinds, types and numeric close codes,
// and the screen snapshot only from allow-listed state names. These tests prove it at compile
// time (the input types have no free-text field) and at run time (sentinel text forced in
// through casts never comes out).

const screen: ScreenSnapshot = { connection: "connected", turn: "listening", mic: "ready", paused: false, end: "none" };

/** Every valid event: one per (kind, type) in the allow-list, with a close code on ws close. */
function everyEvent(): HistoryEventInput[] {
  const out: HistoryEventInput[] = [];
  for (const [kind, types] of Object.entries(HISTORY_EVENT_TYPES)) {
    for (const type of types) {
      out.push(
        (kind === "ws" && type === "close" ? { kind, type, code: 1001 } : { kind, type }) as HistoryEventInput,
      );
    }
  }
  return out;
}

describe("eventLabel", () => {
  it("labels each kind and type, and adds the close code", () => {
    expect(eventLabel({ kind: "ws", type: "tts_start" })).toBe("ws:tts_start");
    expect(eventLabel({ kind: "send", type: "interrupt" })).toBe("send:interrupt");
    expect(eventLabel({ kind: "mic", type: "speechEnd" })).toBe("mic:speechEnd");
    expect(eventLabel({ kind: "ui", type: "endConfirm" })).toBe("ui:endConfirm");
    expect(eventLabel({ kind: "audio", type: "flush" })).toBe("audio:flush");
    expect(eventLabel({ kind: "timer", type: "hearingDeadline" })).toBe("timer:hearingDeadline");
    expect(eventLabel({ kind: "ws", type: "close", code: 1008 })).toBe("ws:close 1008");
  });

  it("gives every allow-listed event a distinct label", () => {
    const labels = everyEvent().map(eventLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("covers every server and client message type", () => {
    // Keeps the allow-list in step with app/types.ts; labels.ts also checks this at compile time.
    expect(HISTORY_EVENT_TYPES.ws).toEqual(
      expect.arrayContaining([
        "tts_start", "tts_end", "tts_chunk", "transcript", "phase_change", "session_started",
        "session_complete", "session_failed", "stt_error", "latency_metric", "draft", "open", "close",
      ]),
    );
    expect(HISTORY_EVENT_TYPES.send).toEqual(
      expect.arrayContaining(["session_start", "session_end", "interrupt", "text_input", "turn_timing", "audio"]),
    );
  });

  it("drops a close code that is not an integer from 1000 to 4999", () => {
    for (const code of [999, 5000, 1000.5, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(eventLabel({ kind: "ws", type: "close", code })).toBe("ws:close");
    }
    expect(eventLabel({ kind: "ws", type: "close", code: 4999 })).toBe("ws:close 4999");
  });

  it("only labels a code on a ws close", () => {
    expect(eventLabel({ kind: "ws", type: "open", code: 1001 })).toBe("ws:open");
  });

  it("replaces an unknown kind or type with ?, whatever was passed", () => {
    expect(eventLabel({ kind: "ws", type: "I said my password" } as unknown as HistoryEventInput)).toBe("ws:?");
    expect(eventLabel({ kind: "whispered", type: "audio" } as unknown as HistoryEventInput)).toBe("?:?");
    // A type that is valid for one kind is not accepted under another.
    expect(eventLabel({ kind: "ui", type: "transcript" } as unknown as HistoryEventInput)).toBe("ui:?");
  });
});

describe("SessionHistory", () => {
  it("keeps entries in order with their time, label and screen", () => {
    const h = new SessionHistory();
    h.record({ kind: "ws", type: "open" }, screen, 10);
    h.record({ kind: "ui", type: "pause" }, { ...screen, paused: true }, 25);
    expect(h.entries()).toEqual([
      { t: 10, label: "ws:open", screen },
      { t: 25, label: "ui:pause", screen: { ...screen, paused: true } },
    ]);
  });

  it("keeps only the newest entries once over capacity, oldest dropped first", () => {
    const h = new SessionHistory(3);
    for (let i = 0; i < 5; i++) h.record({ kind: "timer", type: "thinkingWatchdog" }, screen, i);
    expect(h.entries().map((e) => e.t)).toEqual([2, 3, 4]);
  });

  it("defaults to 500 entries", () => {
    const h = new SessionHistory();
    for (let i = 0; i < 501; i++) h.record({ kind: "audio", type: "playing" }, screen, i);
    expect(h.entries()).toHaveLength(500);
    expect(h.entries()[0].t).toBe(1);
  });

  it("falls back to 500 for a capacity that is not a positive integer", () => {
    for (const bad of [0, -5, 2.5, Number.NaN]) {
      const h = new SessionHistory(bad);
      for (let i = 0; i < 501; i++) h.record({ kind: "audio", type: "playing" }, screen, i);
      expect(h.entries()).toHaveLength(500);
    }
  });

  it("returns a copy, so callers cannot change the history", () => {
    const h = new SessionHistory();
    h.record({ kind: "ws", type: "open" }, screen, 1);
    (h.entries() as unknown as unknown[]).pop();
    expect(h.entries()).toHaveLength(1);
  });

  it("toText writes one line per entry: time, label, then the screen", () => {
    const h = new SessionHistory();
    h.record({ kind: "ws", type: "open" }, screen, 0);
    h.record({ kind: "ws", type: "close", code: 1001 }, { ...screen, connection: "disconnected", mic: "off" }, 1234.6);
    expect(h.toText()).toBe(
      [
        "+0ms ws:open | connection=connected turn=listening mic=ready paused=no end=none",
        "+1235ms ws:close 1001 | connection=disconnected turn=listening mic=off paused=no end=none",
      ].join("\n"),
    );
  });

  it("writes a time that is not a finite number as 0", () => {
    const h = new SessionHistory();
    h.record({ kind: "ws", type: "open" }, screen, Number.NaN);
    expect(h.entries()[0].t).toBe(0);
  });
});

describe("privacy: nothing said or written ever reaches the history", () => {
  const SENTINEL = "SENTINEL-my-secret-words";
  // Strings a real session carries that must never be recorded.
  const sentinels = [SENTINEL, `transcript ${SENTINEL}`, `draft ${SENTINEL}`, `reason ${SENTINEL}`];

  it("records no sentinel, even when sentinel text is forced into every field through casts", () => {
    const h = new SessionHistory();
    let t = 0;
    for (const e of everyEvent()) {
      for (const s of sentinels) {
        // The real message payload fields a caller might mistakenly spread in.
        const polluted = { ...e, text: s, content: s, reason: s, draft: { name: s }, phase: s, sessionId: s, reportId: s };
        h.record(polluted as unknown as HistoryEventInput, screen, t++);
        // A sentinel in place of the type and the code.
        h.record({ kind: e.kind, type: s, code: s } as unknown as HistoryEventInput, screen, t++);
        // A sentinel in every screen field.
        const pollutedScreen = { connection: s, turn: s, mic: s, paused: s, end: s, extra: s };
        h.record(e, pollutedScreen as unknown as ScreenSnapshot, t++);
      }
    }
    const everything = JSON.stringify(h.entries()) + "\n" + h.toText();
    expect(everything).not.toContain("SENTINEL");
    expect(everything).not.toContain("secret");
    // And the polluted records were still recorded, with ? in place of what was not allowed.
    expect(h.toText()).toContain("connection=? turn=? mic=? paused=no end=?");
  });

  it("keeps only the allow-listed screen fields", () => {
    const h = new SessionHistory();
    h.record({ kind: "ws", type: "open" }, { ...screen, extra: "x" } as unknown as ScreenSnapshot, 0);
    expect(Object.keys(h.entries()[0].screen).sort()).toEqual(["connection", "end", "mic", "paused", "turn"]);
  });

  it("has no free-text field in its input types (compile-time check)", () => {
    // Each line is a type error: these fields do not exist or are not free text.
    // @ts-expect-error a transcript's text cannot be passed
    const a: HistoryEventInput = { kind: "ws", type: "transcript", text: "words" };
    // @ts-expect-error the type is a fixed union, not any string
    const b: HistoryEventInput = { kind: "send", type: "something I said" };
    // @ts-expect-error a close code is a number
    const c: HistoryEventInput = { kind: "ws", type: "close", code: "words" };
    // @ts-expect-error screen fields are fixed state names, not any string
    const d: ScreenSnapshot = { ...screen, turn: "words" };
    expect([a, b, c, d]).toHaveLength(4);
  });
});
