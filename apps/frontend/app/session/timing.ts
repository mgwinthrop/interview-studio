// How long the avatar may stay in "thinking" after an answer is sent before the watchdog
// resets it to "listening". The watchdog only covers a turn the server dropped, so it must
// outlast a slow but healthy reply; otherwise the avatar invites the user to talk over it.
export const THINKING_WATCHDOG_MS = 10_000;
