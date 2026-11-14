// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FQ-40 (#40): the session opens the remembered microphone on first open AND when it reopens
// after a pause, falls back to the default with a notice when it is missing, and never leaves
// a microphone live after a stop. vad-web is mocked; the tests call the hook's getStream and
// resumeStream themselves, as vad-web would.

vi.mock("@ricky0123/vad-web", () => ({ MicVAD: { new: vi.fn() } }));

import { MicVAD } from "@ricky0123/vad-web";
import { useVAD } from "../../hooks/useVAD";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useVAD>;
type Track = { stop: ReturnType<typeof vi.fn>; label: string };
type Options = { getStream: () => Promise<MediaStream>; resumeStream: (s: MediaStream) => Promise<MediaStream> };

const newMock = MicVAD.new as unknown as ReturnType<typeof vi.fn>;
const gum = vi.fn();
const enumerate = vi.fn();

function stream(label: string): MediaStream & { track: Track } {
  const track: Track = { stop: vi.fn(), label };
  return { track, getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream & { track: Track };
}

function deviceError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

let root: Root | null = null;
let api: Api;

async function mountAndStart(): Promise<Options> {
  newMock.mockResolvedValue({ start: vi.fn(() => Promise.resolve()), pause: vi.fn(() => Promise.resolve()), destroy: vi.fn(() => Promise.resolve()) });
  function Harness() {
    api = useVAD({ sendMessage: () => {}, aiSpeaking: false });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root!.render(createElement(Harness)));
  await act(() => api.startMic());
  return newMock.mock.calls[0][0] as Options;
}

const LOCKED = { echoCancellation: true, noiseSuppression: true, sampleRate: 16000, channelCount: 1 };

beforeEach(() => {
  newMock.mockReset();
  gum.mockReset();
  enumerate.mockReset().mockResolvedValue([]);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: gum, enumerateDevices: enumerate }, configurable: true });
  window.localStorage.setItem("interview-studio:mic", JSON.stringify({ deviceId: "headset-1", label: "USB Headset" }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("useVAD microphone choice", () => {
  it("opens the remembered microphone on first open and again on resume after a pause", async () => {
    const options = await mountAndStart();
    gum.mockResolvedValue(stream("USB Headset"));
    await act(async () => { await options.getStream(); });
    await act(async () => { await options.resumeStream(stream("old")); });
    expect(gum).toHaveBeenCalledTimes(2);
    for (const call of gum.mock.calls) expect(call[0]).toStrictEqual({ audio: { ...LOCKED, deviceId: { exact: "headset-1" } } });
    expect(api.micFallback).toBeNull();
  });

  it("opens with the locked settings and no deviceId when nothing is remembered", async () => {
    window.localStorage.clear();
    const options = await mountAndStart();
    gum.mockResolvedValue(stream("Default"));
    await act(async () => { await options.getStream(); });
    expect(gum.mock.calls[0][0]).toStrictEqual({ audio: LOCKED });
  });

  it("falls back to the default once when the remembered microphone is missing, and says so", async () => {
    const options = await mountAndStart();
    gum.mockRejectedValueOnce(deviceError("OverconstrainedError")).mockResolvedValueOnce(stream("Built-in Microphone"));
    await act(async () => { await options.getStream(); });
    expect(gum).toHaveBeenCalledTimes(2);
    expect(gum.mock.calls[1][0]).toStrictEqual({ audio: LOCKED });
    expect(api.micFallback).toEqual({ label: "USB Headset", using: "Built-in Microphone" });
  });

  it("finds the remembered microphone by name when its id has changed, and remembers the new id", async () => {
    const options = await mountAndStart();
    enumerate.mockResolvedValue([
      { kind: "audioinput", deviceId: "default", label: "Built-in Microphone" },
      { kind: "audioinput", deviceId: "headset-2", label: "USB Headset" },
    ]);
    gum.mockRejectedValueOnce(deviceError("OverconstrainedError")).mockResolvedValueOnce(stream("USB Headset"));
    await act(async () => { await options.getStream(); });
    expect(gum.mock.calls[1][0]).toStrictEqual({ audio: { ...LOCKED, deviceId: { exact: "headset-2" } } });
    expect(api.micFallback).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("interview-studio:mic")!)).toEqual({ deviceId: "headset-2", label: "USB Headset" });
  });

  it("does not retry other errors (e.g. permission denied)", async () => {
    const options = await mountAndStart();
    gum.mockRejectedValueOnce(deviceError("NotAllowedError"));
    await act(async () => { await expect(options.getStream()).rejects.toThrow("NotAllowedError"); });
    expect(gum).toHaveBeenCalledTimes(1);
    expect(api.micFallback).toBeNull();
  });

  it("clears the notice on stopMic, and when a later exact open succeeds (headset plugged back in)", async () => {
    const options = await mountAndStart();
    gum.mockRejectedValueOnce(deviceError("NotFoundError")).mockResolvedValueOnce(stream("Built-in Microphone"));
    await act(async () => { await options.getStream(); });
    expect(api.micFallback).not.toBeNull();
    gum.mockResolvedValueOnce(stream("USB Headset"));
    await act(async () => { await options.resumeStream(stream("old")); });
    expect(api.micFallback).toBeNull();

    gum.mockRejectedValueOnce(deviceError("NotFoundError")).mockResolvedValueOnce(stream("Built-in Microphone"));
    await act(async () => { await options.resumeStream(stream("old")); });
    expect(api.micFallback).not.toBeNull();
    act(() => api.stopMic());
    expect(api.micFallback).toBeNull();
  });

  it("stops a microphone that finishes opening after the session stopped, instead of leaving it live", async () => {
    const options = await mountAndStart();
    let resolveOpen!: (s: MediaStream) => void;
    gum.mockReturnValueOnce(new Promise<MediaStream>((r) => { resolveOpen = r; }));
    let resumed!: Promise<MediaStream>;
    act(() => { resumed = options.resumeStream(stream("old")); });
    act(() => api.stopMic());
    const late = stream("USB Headset");
    await act(async () => {
      resolveOpen(late);
      await expect(resumed).rejects.toThrow();
    });
    expect(late.track.stop).toHaveBeenCalled();
    expect(api.micFallback).toBeNull();
  });
});
