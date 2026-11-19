import { expect, test, type Page } from "@playwright/test";
import { recordRegions, expectGolden, type GoldenTrace, type RegionTrace } from "./support/regions";
import { installProbes, proxySession, speech, type Probes, type ProxyControl } from "./support/session";

// FQ-108 S10 (#131), design T10 (rest): golden traces of today's behaviour for interrupt and
// for a lost connection followed by Start over. Each records the client frame order (O3) and
// the per-region visible states (O4) and compares them with e2e/golden/<scenario>.json, as in
// golden-traces.spec.ts (S9), which this file does not edit.
//
// - connection-lost-start-over: the plain path. Records D3 and D7 as they are today: after
//   Start over, hearing goes straight back to "ready" without "starting", because the
//   microphone was never stopped. Phase 1 (S13) changes this on purpose.
// - connection-lost-end-dialog: the loss happens with the end dialog open. Records D3 and
//   D4: after Start over the panel stays "paused" with no pause screen and no dialog, so
//   there is no way to resume. A third golden by owner decision (2026-11-19), because no
//   single path shows both D4 and D7.
// - Each reply's panel trace includes the gap after tts_end (speaking, listening, speaking,
//   listening): D10 (candidate) in 02-architecture.md §6.
//
// Determinism, as in S9: every reply is held at tts_start and stepped. Both release steps are
// polled, so a frame that has not reached the proxy yet is waited for, not missed.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

const status = (page: Page) => page.locator(".interviewer-panel .interviewer-status");
const lost = (page: Page) => page.getByRole("heading", { name: "Connection lost" });
const sessionStarts = (proxy: ProxyControl) => proxy.clientFrames().filter((f) => f === "session_start").length;

async function playbackSettled(probes: Probes, n: number): Promise<void> {
  await expect.poll(() => probes.playbackStarts(), { timeout: 20_000 }).toBeGreaterThanOrEqual(n);
  await expect.poll(async () => (await probes.playbackEnds()) === (await probes.playbackStarts()), { timeout: 10_000 }).toBe(true);
}

/** Plays out a reply whose tts_start is held: tts_start alone, then through tts_end, then the rest. */
async function stepReply(page: Page, proxy: ProxyControl, probes: Probes, nth: number): Promise<void> {
  await expect.poll(() => proxy.releaseThrough("tts_start"), { timeout: 10_000 }).toBe(true);
  await expect(status(page)).toHaveText("Speaking");
  await expect.poll(() => proxy.releaseThrough("tts_end"), { timeout: 10_000 }).toBe(true);
  await playbackSettled(probes, nth);
  proxy.release();
  await expect(status(page)).toHaveText("Listening");
}

/** Opens a session with the greeting held until voice detection is ready, then steps it out. */
async function startSession(page: Page): Promise<{ proxy: ProxyControl; probes: Probes; stop: () => Promise<RegionTrace> }> {
  const proxy = await proxySession(page);
  const probes = await installProbes(page);
  const recorder = await recordRegions(page);
  proxy.hold("tts_start");
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
  await expect(status(page)).toHaveText("Listening");
  await stepReply(page, proxy, probes, 1);
  return { proxy, probes, stop: recorder.stop };
}

/** Goldens hold control labels only: focus is "body" or a control's role and label, never content text. */
async function expectControlFocusGolden(name: string, trace: GoldenTrace): Promise<void> {
  for (const entry of trace.regions.focus) {
    expect(entry, `focus entry in ${name} must be body or a labelled control`).toMatch(/^(body|(button|link|dialog|input|textbox):\S.*)$/);
  }
  await expectGolden(name, trace);
}

test("golden: interrupt while the reply is streaming", async ({ page }) => {
  const { proxy, probes, stop } = await startSession(page);

  // The reply to this answer arrives with its tts_end held, so it is still streaming.
  proxy.hold("tts_end");
  await speech.start(page);
  await speech.end(page);
  await expect(status(page)).toHaveText("Speaking", { timeout: 10_000 });

  // The local snap to "interrupted" ("Go ahead") lasts about 200 ms; the region recorder
  // captures it, so the test does not wait on it.
  await speech.start(page);
  await expect.poll(() => proxy.clientFrames().filter((f) => f === "interrupt").length, { timeout: 5_000 }).toBe(1);
  // The interrupt timer returns the panel to Listening before the answer ends (today's D6 path).
  await expect(status(page)).toHaveText("Listening");
  // The interrupted reply was flushed: releasing its tts_end plays nothing.
  proxy.release();
  await page.waitForTimeout(1_000);
  expect(await probes.playbackStarts()).toBe(1);

  proxy.hold("tts_start");
  await speech.end(page);
  await expect(status(page)).toHaveText("Thinking");
  await stepReply(page, proxy, probes, 2);

  await expectControlFocusGolden("interrupt", { frames: proxy.clientFrames(), regions: await stop() });
});

test("golden: connection lost, then Start over", async ({ page }) => {
  const { proxy, probes, stop } = await startSession(page);

  // Holds the new connection's greeting so it can be stepped like the first.
  proxy.hold("tts_start");
  proxy.inject({ close: 1001 });
  await expect(lost(page)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Start over" }).click();
  await expect.poll(() => sessionStarts(proxy), { timeout: 10_000 }).toBe(2);
  await stepReply(page, proxy, probes, 2);
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready");

  await expectControlFocusGolden("connection-lost-start-over", { frames: proxy.clientFrames(), regions: await stop() });
});

test("golden: connection lost with the end dialog open, then Start over", async ({ page }) => {
  const { proxy, stop } = await startSession(page);

  await page.getByRole("button", { name: "End Session", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "End this interview?" })).toBeVisible();
  await expect(status(page)).toHaveText("Paused");

  proxy.hold("tts_start");
  proxy.inject({ close: 1001 });
  await expect(lost(page)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Start over" }).click();
  await expect.poll(() => sessionStarts(proxy), { timeout: 10_000 }).toBe(2);

  // The new greeting arrives while the page is still paused (D3): stepped, but never shown as speaking.
  await expect.poll(() => proxy.releaseThrough("tts_start"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => proxy.releaseThrough("tts_end"), { timeout: 10_000 }).toBe(true);
  proxy.release();
  await page.waitForTimeout(1_000);
  // D4: paused, with neither the pause screen nor the end dialog to leave it.
  await expect(status(page)).toHaveText("Paused");
  await expect(page.getByRole("dialog", { name: "Session paused" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "End this interview?" })).toBeHidden();

  await expectControlFocusGolden("connection-lost-end-dialog", { frames: proxy.clientFrames(), regions: await stop() });
});
