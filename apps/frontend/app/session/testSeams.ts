// Test-only seams (FQ-108 S0). Compiled in only when the build sets NEXT_PUBLIC_TEST_SEAMS=1,
// which the Playwright build does (playwright.config.ts). Next inlines the variable at build
// time, so in every other build TEST_SEAMS_ENABLED is the literal false: every guarded call is
// dead code and is removed, and `npm run check:no-test-seams` fails the build output if the
// seam's global name survives. Never set the variable for a build people use.

export const TEST_SEAMS_ENABLED: boolean = process.env.NEXT_PUBLIC_TEST_SEAMS === "1";

/** Drives the live voice detector's own callbacks, as if Silero had heard speech. */
export interface VadSeam {
  speechStart(): void;
  /** Ends the utterance; without samples it sends 0.5 s of silence at 16 kHz. */
  speechEnd(samples?: Float32Array): void;
  misfire(): void;
}

/** The callbacks the hook gave vad-web (MicVAD.options exposes them). */
interface VadCallbacks {
  onSpeechStart(): unknown;
  onSpeechEnd(audio: Float32Array): unknown;
  onVADMisfire(): unknown;
}

type SeamWindow = Window & { __testSeams?: { vad?: VadSeam } };

/** Registers the seam as window.__testSeams.vad, or removes it with null. No-op unless enabled. */
export function registerVadSeam(callbacks: VadCallbacks | null): void {
  if (!TEST_SEAMS_ENABLED || typeof window === "undefined") return;
  const w = window as SeamWindow;
  w.__testSeams = w.__testSeams ?? {};
  w.__testSeams.vad = callbacks
    ? {
        speechStart: () => void callbacks.onSpeechStart(),
        speechEnd: (samples) => void callbacks.onSpeechEnd(samples ?? new Float32Array(8000)),
        misfire: () => void callbacks.onVADMisfire(),
      }
    : undefined;
}
