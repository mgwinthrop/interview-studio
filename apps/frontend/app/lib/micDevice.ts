// The microphone chosen in the mic check, remembered in this browser so sessions record from it
// (FQ-40). Stored only in localStorage: never sent to the server. Device ids are per-site random
// values; the label can contain a personal name ("Jane's AirPods") and is kept only so a notice
// can say which microphone is missing.

export interface MicChoice {
  deviceId: string;
  label: string;
}

/** What a fallback opened instead of the chosen microphone. */
export interface MicFallback {
  /** The remembered microphone's label ("" if the browser gave none). */
  label: string;
  /** The label of the microphone actually opened ("" if none). */
  using: string;
}

const STORAGE_KEY = "interview-studio:mic";
const MAX_CHARS = 512;

/** The locked processing settings of the session's microphone (unchanged by FQ-40). */
const LOCKED_AUDIO = { echoCancellation: true, noiseSuppression: true, sampleRate: 16000, channelCount: 1 } as const;

export function readMicChoice(): MicChoice | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { deviceId, label } = v as Record<string, unknown>;
    if (typeof deviceId !== "string" || !deviceId || deviceId.length > MAX_CHARS) return null;
    if (typeof label !== "string" || label.length > MAX_CHARS) return null;
    return { deviceId, label };
  } catch {
    return null; // no window (server render), storage blocked, or a corrupt value
  }
}

export function saveMicChoice(choice: MicChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ deviceId: choice.deviceId, label: choice.label }));
  } catch {
    // storage blocked: the choice applies to this page only
  }
}

export function clearMicChoice(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}

/** The session's audio constraints: the locked settings, plus the chosen device when there is one. */
export function audioConstraints(choice: MicChoice | null): MediaTrackConstraints {
  return choice ? { ...LOCKED_AUDIO, deviceId: { exact: choice.deviceId } } : { ...LOCKED_AUDIO };
}

/**
 * The connected microphone with the remembered name, when its id has changed (ids rotate in some
 * browsers and profiles). Pseudo-devices ("default", "communications") never match; an empty
 * name never matches.
 */
export function findByLabel(devices: readonly Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[], label: string): string | null {
  if (!label) return null;
  const match = devices.find(
    (d) => d.kind === "audioinput" && d.label === label && d.deviceId !== "default" && d.deviceId !== "communications",
  );
  return match ? match.deviceId : null;
}

/** True for the errors browsers raise when an exact device is not available. Matched by name. */
export function isMissingDevice(err: unknown): boolean {
  const name = typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
  return name === "OverconstrainedError" || name === "NotFoundError";
}

function describe({ label, using }: MicFallback): { chosen: string; inUse: string } {
  return { chosen: label ? `microphone (${label})` : "microphone", inUse: using || "the default microphone" };
}

/** The session's one-line notice when the chosen microphone is missing. */
export function micFallbackMessage(f: MicFallback): string {
  const { chosen, inUse } = describe(f);
  return `Your chosen ${chosen} isn't connected, so we're using ${inUse}.`;
}

/** The mic check's line when the remembered microphone is missing. */
export function micCheckMissingMessage(f: MicFallback): string {
  const { chosen, inUse } = describe(f);
  return `Your saved ${chosen} isn't connected, so this check is using ${inUse}.`;
}
