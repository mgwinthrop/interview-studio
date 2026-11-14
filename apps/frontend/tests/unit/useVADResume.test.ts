// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FQ-79 (#79): a microphone that fails to reopen after Pause is never silent, a stray Resume
// cannot claim "ready", a stale reopen cannot overwrite a newer result, and a reopen that lands
// after a Pause never leaves a microphone live. vad-web is mocked; its start() calls the hook's
// resumeStream on a resume, as vad-web's does.

vi.mock("@ricky0123/vad-web", () => ({ MicVAD: { new: vi.fn() } }));

import { MicVAD } from "@ricky0123/vad-web";
import { useVAD } from "../../hooks/useVAD";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useVAD>;
type Options = { resumeStream: (s: MediaStream) => Promise<MediaStream> };
type Track = { stop: ReturnType<typeof vi.fn>; label: string };

const newMock = MicVAD.new as unknown as ReturnType<typeof vi.fn>;
const gum = vi.fn();

function stream(label = "Mic"): MediaStream & { track: Track } {
  const track: Track = { stop: vi.fn(), label };
  return { track, getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream & { track: Track };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let root: Root | null = null;
let api: Api;
let options: Options;
// What the fake VAD's start() does after the first (successful) start: by default it reopens
// through the hook's resumeStream, like vad-web.
let onResume: () => Promise<unknown>;
let vad: { start: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };

function mount(): void {
  function Harness() {
    api = useVAD({ sendMessage: () => {}, aiSpeaking: false });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root!.render(createElement(Harness)));
}

async function startReady(): Promise<void> {
  let started = false;
  vad = {
    start: vi.fn(() => {
      if (!started) { started = true; return Promise.resolve(); }
      return onResume();
    }),
    pause: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(() => Promise.resolve()),
  };
  newMock.mockResolvedValue(vad);
  mount();
  await act(() => api.startMic());
  options = newMock.mock.calls[0][0] as Options;
  onResume = () => options.resumeStream(stream("old"));
  expect(api.hearing).toBe("ready");
}

async function flush(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  newMock.mockReset();
  gum.mockReset();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: gum, enumerateDevices: vi.fn(async () => []) }, configurable: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("useVAD resume", () => {
  it('goes "starting" then "ready" when the microphone reopens', async () => {
    await startReady();
    const open = deferred<MediaStream>();
    gum.mockReturnValueOnce(open.promise);
    act(() => api.pauseMic());
    act(() => api.resumeMic());
    expect(api.hearing).toBe("starting");
    expect(api.hearingAttempt).toBe("resume");
    open.resolve(stream());
    await flush();
    expect(api.hearing).toBe("ready");
  });

  it('reports "failed" (from a resume) when the microphone does not reopen, and drops a stale fallback notice', async () => {
    await startReady();
    gum.mockRejectedValueOnce(Object.assign(new Error("busy"), { name: "NotReadableError" }));
    act(() => api.pauseMic());
    act(() => api.resumeMic());
    await flush();
    expect(api.hearing).toBe("failed");
    expect(api.hearingAttempt).toBe("resume");
    expect(api.micFallback).toBeNull();
  });

  it('stays "starting" while the reopen hangs (the page turns that into the message after 10 s)', async () => {
    await startReady();
    gum.mockReturnValueOnce(new Promise(() => {}));
    act(() => api.pauseMic());
    act(() => api.resumeMic());
    await flush();
    expect(api.hearing).toBe("starting");
  });

  it("a Resume without a Pause does nothing, so a failure is not masked as ready (decision A)", async () => {
    await startReady();
    gum.mockRejectedValueOnce(Object.assign(new Error("busy"), { name: "NotReadableError" }));
    act(() => api.pauseMic());
    act(() => api.resumeMic());
    await flush();
    expect(api.hearing).toBe("failed");
    const starts = vad.start.mock.calls.length;
    act(() => api.resumeMic());
    await flush();
    expect(vad.start.mock.calls.length).toBe(starts);
    expect(api.hearing).toBe("failed");
  });

  it("Resume with no voice detector (its start failed) leaves the start failure alone", async () => {
    newMock.mockRejectedValue(new Error("no available backend found"));
    mount();
    await act(() => api.startMic());
    expect(api.hearing).toBe("failed");
    act(() => api.pauseMic());
    act(() => api.resumeMic());
    await flush();
    expect(api.hearing).toBe("failed");
    expect(api.hearingAttempt).toBe("start");
  });

  it("Resume while the first start is still loading does not claim ready", async () => {
    newMock.mockReturnValue(new Promise(() => {}));
    mount();
    act(() => { void api.startMic(); });
    act(() => api.pauseMic());
    act(() => api.resumeMic());
    await flush();
    expect(api.hearing).toBe("starting");
    expect(api.hearingAttempt).toBe("start");
  });

  it("a late result from an older reopen cannot overwrite a newer one", async () => {
    await startReady();
    const first = deferred<MediaStream>();
    gum.mockReturnValueOnce(first.promise).mockResolvedValueOnce(stream("new"));
    act(() => api.pauseMic());
    act(() => api.resumeMic()); // hangs
    act(() => api.pauseMic());
    act(() => api.resumeMic()); // succeeds
    await flush();
    expect(api.hearing).toBe("ready");
    first.reject(Object.assign(new Error("late"), { name: "NotReadableError" }));
    await flush();
    expect(api.hearing).toBe("ready");
  });

  it("a reopen that lands after a Pause is stopped instead of left live", async () => {
    await startReady();
    const open = deferred<MediaStream>();
    gum.mockReturnValueOnce(open.promise);
    act(() => api.pauseMic());
    let resumed!: Promise<unknown>;
    onResume = () => { resumed = options.resumeStream(stream("old")); return resumed; };
    act(() => api.resumeMic());
    act(() => api.pauseMic());
    const late = stream("late");
    open.resolve(late);
    await act(async () => { await expect(resumed).rejects.toThrow(); });
    expect(late.track.stop).toHaveBeenCalled();
  });

  it("a stop during a reopen is not reported as a failure", async () => {
    await startReady();
    const open = deferred<MediaStream>();
    gum.mockReturnValueOnce(open.promise);
    act(() => api.pauseMic());
    act(() => api.resumeMic());
    act(() => api.stopMic());
    open.reject(Object.assign(new Error("late"), { name: "NotReadableError" }));
    await flush();
    expect(api.hearing).toBe("off");
  });
});
