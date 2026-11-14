// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  audioConstraints,
  clearMicChoice,
  findByLabel,
  isMissingDevice,
  micCheckMissingMessage,
  micFallbackMessage,
  readMicChoice,
  saveMicChoice,
} from "../../app/lib/micDevice";

// FQ-40 (#40): the microphone chosen in the mic check is remembered in this browser and used by
// the session; the processing settings of the first open stay exactly as they were.

const KEY = "interview-studio:mic";

afterEach(() => window.localStorage.clear());

describe("remembered microphone", () => {
  it("round-trips a saved choice and clears it", () => {
    expect(readMicChoice()).toBeNull();
    saveMicChoice({ deviceId: "abc123", label: "USB Headset" });
    expect(readMicChoice()).toEqual({ deviceId: "abc123", label: "USB Headset" });
    clearMicChoice();
    expect(readMicChoice()).toBeNull();
  });

  it("treats a corrupt or wrongly shaped value as no choice", () => {
    for (const raw of ["not json", "null", "[]", '{"deviceId":""}', '{"deviceId":7,"label":"x"}', '{"label":"x"}']) {
      window.localStorage.setItem(KEY, raw);
      expect(readMicChoice()).toBeNull();
    }
  });
});

describe("audioConstraints", () => {
  const LOCKED = { echoCancellation: true, noiseSuppression: true, sampleRate: 16000, channelCount: 1 };

  it("is exactly the locked first-open settings when nothing is chosen (no deviceId, no extra keys)", () => {
    expect(audioConstraints(null)).toStrictEqual(LOCKED);
  });

  it("adds only an exact deviceId when a microphone is chosen", () => {
    expect(audioConstraints({ deviceId: "abc123", label: "USB Headset" })).toStrictEqual({ ...LOCKED, deviceId: { exact: "abc123" } });
  });
});

describe("findByLabel (ids can change between page loads)", () => {
  const devices = [
    { kind: "audioinput", deviceId: "default", label: "USB Headset" },
    { kind: "audioinput", deviceId: "communications", label: "USB Headset" },
    { kind: "audiooutput", deviceId: "out-1", label: "USB Headset" },
    { kind: "audioinput", deviceId: "new-id", label: "USB Headset" },
    { kind: "audioinput", deviceId: "mic-2", label: "Built-in Microphone" },
  ] as const;

  it("finds the real input with the same name, never a pseudo-device or an output", () => {
    expect(findByLabel(devices, "USB Headset")).toBe("new-id");
  });

  it("finds nothing for an unknown or empty name", () => {
    expect(findByLabel(devices, "Studio Mic")).toBeNull();
    expect(findByLabel([{ kind: "audioinput", deviceId: "x", label: "" }], "")).toBeNull();
  });
});

describe("isMissingDevice", () => {
  it("matches the errors browsers raise for a missing exact device, by name", () => {
    expect(isMissingDevice({ name: "OverconstrainedError" })).toBe(true);
    expect(isMissingDevice({ name: "NotFoundError" })).toBe(true);
    expect(isMissingDevice({ name: "NotAllowedError" })).toBe(false);
    expect(isMissingDevice(new Error("x"))).toBe(false);
    expect(isMissingDevice(undefined)).toBe(false);
  });
});

describe("notice wording", () => {
  it("names the missing microphone and the one actually in use", () => {
    expect(micFallbackMessage({ label: "USB Headset", using: "MacBook Air Microphone" })).toBe(
      "Your chosen microphone (USB Headset) isn't connected, so we're using MacBook Air Microphone.",
    );
    expect(micCheckMissingMessage({ label: "USB Headset", using: "MacBook Air Microphone" })).toBe(
      "Your saved microphone (USB Headset) isn't connected, so this check is using MacBook Air Microphone.",
    );
  });

  it("still reads naturally when a browser gives no labels", () => {
    expect(micFallbackMessage({ label: "", using: "" })).toBe(
      "Your chosen microphone isn't connected, so we're using the default microphone.",
    );
  });
});
