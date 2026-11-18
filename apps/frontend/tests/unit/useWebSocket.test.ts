// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebSocket } from "../../app/hooks/useWebSocket";
import type { InterviewerInput } from "../../app/lib/interviewers";

// FQ-108 S3 (#124): pins how useWebSocket handles messages before the session rebuild moves it
// into a socket adapter and the core: the start frame, transcript merging (partials, a final
// that arrives before its partials, user turns), the interrupt reset, close reasons, and binary
// versus JSON sends. Reconnect and close suppression are covered by useWebSocketReconnect.test.ts
// (#110) and are not repeated here. Characterization tests: they pass on main by design.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  binaryType = "blob";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = FakeSocket.CLOSED;
  }
  serverOpen(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  serverJson(msg: object): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverClose(code: number, reason = ""): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

type Api = ReturnType<typeof useWebSocket>;
let root: Root | null = null;
let api: Api;
let sock: FakeSocket;
const onAudioChunk = vi.fn();
const onTtsEnd = vi.fn();
const onSttError = vi.fn();

function mount(start: string | InterviewerInput = "tell-a-story", demo = false): void {
  function Harness() {
    api = useWebSocket(start, demo, onAudioChunk, onTtsEnd, onSttError);
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root!.render(createElement(Harness)));
  sock = FakeSocket.instances[FakeSocket.instances.length - 1];
}

function open(): void {
  act(() => sock.serverOpen());
}

function server(msg: object): void {
  act(() => sock.serverJson(msg));
}

const partial = (text: string) => ({ type: "transcript", role: "assistant", text, partial: true });
const final = (text: string) => ({ type: "transcript", role: "assistant", text, partial: false });
const user = (text: string) => ({ type: "transcript", role: "user", text, partial: false });
const contents = () => api.transcript.map((e) => `${e.role}:${e.content}`);

beforeEach(() => {
  FakeSocket.instances = [];
  onAudioChunk.mockReset();
  onTtsEnd.mockReset();
  onSttError.mockReset();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubEnv("NEXT_PUBLIC_WS_URL", "ws://test.invalid");
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("useWebSocket opening", () => {
  it("opens one socket to NEXT_PUBLIC_WS_URL with arraybuffer binary frames, and is connecting", () => {
    mount();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(sock.url).toBe("ws://test.invalid");
    expect(sock.binaryType).toBe("arraybuffer");
    expect(api.connectionState).toBe("connecting");
  });

  it("on open is connected and sends session_start with the interviewerId and demo flag", () => {
    mount("tell-a-story", true);
    open();
    expect(api.connectionState).toBe("connected");
    expect(sock.sent.map((s) => JSON.parse(s as string))).toEqual([
      { type: "session_start", interviewerId: "tell-a-story", demo: true },
    ]);
  });

  it("sends session_start with the draft, not an interviewerId, when started from a draft", () => {
    const draft = { name: "Trial" } as unknown as InterviewerInput;
    mount(draft, false);
    open();
    expect(JSON.parse(sock.sent[0] as string)).toEqual({ type: "session_start", draft, demo: false });
  });

  it("is in error, and opens no socket, when NEXT_PUBLIC_WS_URL is not set", () => {
    vi.stubEnv("NEXT_PUBLIC_WS_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(api.connectionState).toBe("error");
  });

  it("goes to error on a socket error", () => {
    mount();
    act(() => sock.onerror?.());
    expect(api.connectionState).toBe("error");
  });
});

describe("useWebSocket assistant transcript merging", () => {
  beforeEach(() => {
    mount();
    open();
  });

  it("partials create one entry and update it in place; the final confirms its text", () => {
    server(partial("Hel"));
    server(partial("Hello th"));
    expect(contents()).toEqual(["assistant:Hello th"]);
    server(final("Hello there."));
    expect(contents()).toEqual(["assistant:Hello there."]);
  });

  it("a final that arrives before its partials makes one entry that the partials update", () => {
    server(final("Hi."));
    expect(contents()).toEqual(["assistant:Hi."]);
    server(partial("Hi"));
    expect(contents()).toEqual(["assistant:Hi"]);
    server(final("Hi again."));
    expect(contents()).toEqual(["assistant:Hi again."]);
  });

  it("a user turn is appended and the next assistant partial starts a new entry", () => {
    server(partial("Question?"));
    server(final("Question?"));
    server(user("Answer"));
    server(partial("Next"));
    expect(contents()).toEqual(["assistant:Question?", "user:Answer", "assistant:Next"]);
  });

  it("two finals with no partials in one turn make two entries", () => {
    server(final("One."));
    server(final("Two."));
    expect(contents()).toEqual(["assistant:One.", "assistant:Two."]);
  });

  it("gives every entry a distinct id", () => {
    server(partial("A"));
    server(final("A."));
    server(user("B"));
    server(final("C."));
    const ids = api.transcript.map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("useWebSocket interrupt", () => {
  beforeEach(() => {
    mount();
    open();
  });

  it("sending interrupt clears aiSpeaking at once", () => {
    server({ type: "tts_start" });
    expect(api.aiSpeaking).toBe(true);
    act(() => api.sendMessage({ type: "interrupt" }));
    expect(api.aiSpeaking).toBe(false);
  });

  it("after an interrupt, the next assistant partial starts a new entry instead of updating the cut-off one", () => {
    server(partial("I was say"));
    act(() => api.sendMessage({ type: "interrupt" }));
    server(partial("New reply"));
    expect(contents()).toEqual(["assistant:I was say", "assistant:New reply"]);
  });

  it("after an interrupt, a final with no partials starts a new entry too", () => {
    server(final("Old."));
    act(() => api.sendMessage({ type: "interrupt" }));
    server(partial("New"));
    expect(contents()).toEqual(["assistant:Old.", "assistant:New"]);
  });
});

describe("useWebSocket server events", () => {
  beforeEach(() => {
    mount();
    open();
  });

  it("tts_start sets aiSpeaking; tts_end clears it and calls onTtsEnd", () => {
    server({ type: "tts_start" });
    expect(api.aiSpeaking).toBe(true);
    expect(onTtsEnd).not.toHaveBeenCalled();
    server({ type: "tts_end" });
    expect(api.aiSpeaking).toBe(false);
    expect(onTtsEnd).toHaveBeenCalledTimes(1);
  });

  it("forwards binary frames to onAudioChunk and adds nothing to the transcript", () => {
    const buf = new ArrayBuffer(8);
    act(() => sock.onmessage?.({ data: buf }));
    expect(onAudioChunk).toHaveBeenCalledWith(buf);
    expect(api.transcript).toEqual([]);
  });

  it("records phase_change, session_started, latency_metric and draft", () => {
    const draft = { name: "Drafted" } as unknown as InterviewerInput;
    server({ type: "phase_change", phase: "deep_dive" });
    server({ type: "session_started", sessionId: "s-1" });
    server({ type: "latency_metric", ms: 420 });
    server({ type: "draft", draft });
    expect(api.phase).toBe("deep_dive");
    expect(api.sessionId).toBe("s-1");
    expect(api.lastLatencyMs).toBe(420);
    expect(api.draft).toEqual(draft);
  });

  it("session_complete records the report id", () => {
    server({ type: "session_complete", reportId: "r-9" });
    expect(api.sessionComplete).toEqual({ reportId: "r-9" });
  });

  it("session_failed marks the session failed and stops speaking", () => {
    server({ type: "tts_start" });
    server({ type: "session_failed" });
    expect(api.sessionFailed).toBe(true);
    expect(api.aiSpeaking).toBe(false);
  });

  it("stt_error calls onSttError", () => {
    server({ type: "stt_error" });
    expect(onSttError).toHaveBeenCalledTimes(1);
  });

  it("ignores a text frame that is not JSON", () => {
    act(() => sock.onmessage?.({ data: "not json" }));
    expect(api.transcript).toEqual([]);
    expect(api.connectionState).toBe("connected");
  });
});

describe("useWebSocket close reasons", () => {
  const cases: [number, string | null][] = [
    [1013, "Too many active conversations. Close another tab, then start over."],
    [1008, "The server rejected the request. Start over."],
    [1009, "The audio or message was too large. Start over."],
    [1001, "The conversation timed out from inactivity. Start over."],
    [1006, null],
    [1000, null],
  ];
  for (const [code, reason] of cases) {
    it(`close ${code} is disconnected with ${reason === null ? "no specific reason" : "its reason"}`, () => {
      mount();
      open();
      act(() => sock.serverClose(code, "server says"));
      expect(api.connectionState).toBe("disconnected");
      expect(api.closeReason).toBe(reason);
      expect(api.closeInfo).toEqual({ code, reason: "server says" });
    });
  }
});

describe("useWebSocket sendMessage", () => {
  it("sends audio as the raw binary buffer and everything else as JSON", () => {
    mount();
    open();
    const pcm = new Int16Array([1, 2, 3]).buffer;
    act(() => api.sendMessage({ type: "audio", data: pcm }));
    act(() => api.sendMessage({ type: "turn_timing", responseGapMs: 250 }));
    expect(sock.sent[1]).toBe(pcm);
    expect(JSON.parse(sock.sent[2] as string)).toEqual({ type: "turn_timing", responseGapMs: 250 });
  });

  it("drops messages while the socket is not open", () => {
    mount();
    act(() => api.sendMessage({ type: "turn_timing", responseGapMs: 1 }));
    expect(sock.sent).toEqual([]);
    open();
    act(() => sock.serverClose(1000));
    act(() => api.sendMessage({ type: "turn_timing", responseGapMs: 1 }));
    expect(sock.sent).toHaveLength(1); // only session_start
  });
});
