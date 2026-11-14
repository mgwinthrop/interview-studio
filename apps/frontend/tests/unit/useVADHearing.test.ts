// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FQ-41 (#41): the voice-detection setup must load its runtime from the app, report whether
// hearing actually started, and never let a failure escape as an unhandled rejection.
// vad-web is mocked: these tests pin the hook's own behaviour, not Silero or ONNX Runtime.

vi.mock("@ricky0123/vad-web", () => ({ MicVAD: { new: vi.fn() } }));

import { MicVAD } from "@ricky0123/vad-web";
import { useVAD } from "../../hooks/useVAD";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useVAD>;
type FakeVad = { start: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };

const newMock = MicVAD.new as unknown as ReturnType<typeof vi.fn>;

function fakeVad(start: () => Promise<void> = () => Promise.resolve()): FakeVad {
  return { start: vi.fn(start), pause: vi.fn(() => Promise.resolve()), destroy: vi.fn(() => Promise.resolve()) };
}

let root: Root | null = null;
let api: Api;

function mount(): void {
  function Harness() {
    api = useVAD({ sendMessage: () => {}, aiSpeaking: false });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root!.render(createElement(Harness)));
}

beforeEach(() => {
  newMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.restoreAllMocks();
});

describe("useVAD hearing state", () => {
  it('starts "off" before any start is asked for', () => {
    mount();
    expect(api.hearing).toBe("off");
  });

  it('is "ready" once the VAD has loaded and started', async () => {
    const vad = fakeVad();
    newMock.mockResolvedValue(vad);
    mount();
    await act(() => api.startMic());
    expect(vad.start).toHaveBeenCalledTimes(1);
    expect(api.hearing).toBe("ready");
    expect(api.micActive).toBe(true);
  });

  it('is "starting" while the runtime is still loading, then "ready" when it lands late', async () => {
    let resolveNew!: (v: FakeVad) => void;
    newMock.mockReturnValue(new Promise<FakeVad>((r) => { resolveNew = r; }));
    mount();
    let started!: Promise<void>;
    act(() => { started = api.startMic(); });
    expect(api.hearing).toBe("starting");
    await act(async () => { resolveNew(fakeVad()); await started; });
    expect(api.hearing).toBe("ready");
  });

  it('turns a failed runtime load into "failed" instead of an unhandled rejection', async () => {
    newMock.mockRejectedValue(new Error("no available backend found. ERR: [wasm] TypeError: Failed to fetch"));
    mount();
    await act(async () => { await expect(api.startMic()).resolves.toBeUndefined(); });
    expect(api.hearing).toBe("failed");
    expect(api.micActive).toBe(false);
  });

  it('reports "failed" when the VAD loads but cannot start (e.g. a blocked worklet)', async () => {
    newMock.mockResolvedValue(fakeVad(() => Promise.reject(new DOMException("worklet", "AbortError"))));
    mount();
    await act(() => api.startMic());
    expect(api.hearing).toBe("failed");
    expect(api.micActive).toBe(false);
  });

  it('goes back to "off" on stopMic, and a start that lands after the stop never opens the mic', async () => {
    let resolveNew!: (v: FakeVad) => void;
    newMock.mockReturnValue(new Promise<FakeVad>((r) => { resolveNew = r; }));
    mount();
    let started!: Promise<void>;
    act(() => { started = api.startMic(); });
    act(() => api.stopMic());
    expect(api.hearing).toBe("off");
    const late = fakeVad();
    await act(async () => { resolveNew(late); await started; });
    expect(late.start).not.toHaveBeenCalled();
    expect(late.destroy).toHaveBeenCalled();
    expect(api.hearing).toBe("off");
  });
});

describe("useVAD runtime configuration", () => {
  it("loads the ONNX Runtime files from the app, not a CDN", async () => {
    newMock.mockResolvedValue(fakeVad());
    mount();
    await act(() => api.startMic());
    const options = newMock.mock.calls[0][0] as { ortConfig: (ort: { env: { wasm: { wasmPaths?: string } } }) => void };
    const ort = { env: { wasm: {} as { wasmPaths?: string } } };
    options.ortConfig(ort);
    expect(ort.env.wasm.wasmPaths).toBe("/");
  });

  it("keeps the locked thresholds exactly as they were", async () => {
    newMock.mockResolvedValue(fakeVad());
    mount();
    await act(() => api.startMic());
    expect(newMock.mock.calls[0][0]).toMatchObject({
      baseAssetPath: "/",
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.5,
      minSpeechMs: 128,
      preSpeechPadMs: 160,
      startOnLoad: false,
    });
  });
});
