import { isSameSitePath } from "./interviewerForm";

// Set by the mic check just before it navigates; the session page starts the microphone only
// when it finds it (and removes it), so every voice session goes through the check first.
const MIC_GESTURE_KEY = "mic_gesture_granted";

function micChecked(): boolean {
  try {
    return window.sessionStorage.getItem(MIC_GESTURE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The mic check's `next`: a same-site session path ("/session?…"), or null for anything else,
 * so the check can never send the person off the site.
 */
export function safeSessionNext(v: unknown): string | null {
  return isSameSitePath(v) && v.startsWith("/session?") ? v : null;
}

/**
 * Opens a session page that should start with the microphone on: straight there when the mic
 * check has just passed, otherwise through the mic check, which comes back to `path`.
 */
export function startVoiceSession(router: { push: (href: string) => void }, path: string): void {
  if (micChecked()) {
    router.push(path);
    return;
  }
  router.push(`/mic-check?next=${encodeURIComponent(path)}`);
}
