import { expect, test, type Page } from "@playwright/test";
import { installProbes, proxySession } from "./support/session";

// FQ-108 S7 (#128), design T8: the footer Pause used while the end dialog is settling. Closing
// the dialog (Escape) waits for the dialog's own pause before it resumes; in that window
// `isPaused` is still false, so the footer offers "Pause session", and unlike End Session
// (FQ-98) it is not guarded. Its pauseMic runs before the close's resumeMic, and its
// setIsPaused(true) lands after the close's setIsPaused(false).
//
// This spec records today's end state, including defect D5 (02-architecture.md): the page
// shows Paused while the microphone is open again. D5 changes on purpose in phase 2; when it
// does, the D5 block below is updated in the same slice, not before.
//
// The audio pause is slowed to 800 ms (as in end-confirm-settling.spec.ts) so the settling
// window is wide enough to click in reliably.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const original = AudioContext.prototype.suspend;
    AudioContext.prototype.suspend = function (this: AudioContext) {
      return new Promise<void>((resolve) => setTimeout(resolve, 800)).then(() => original.call(this));
    };
  });
});

const panelStatus = (page: Page) => page.locator(".interviewer-panel .interviewer-status");
const endButton = (page: Page) => page.getByRole("button", { name: "End Session", exact: true });
const endDialog = (page: Page) => page.getByRole("dialog", { name: "End this interview?" });
const footerPause = (page: Page) => page.getByRole("button", { name: "Pause session", exact: true });
const pauseScreen = (page: Page) => page.locator('[aria-labelledby="paused-title"]');

async function openSession(page: Page): Promise<void> {
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
  await expect(panelStatus(page)).not.toHaveText("Speaking", { timeout: 20_000 });
}

// Baseline for the D5 block: an ordinary footer Pause closes the microphone.
test("an ordinary footer Pause shows Paused and leaves no microphone live", async ({ page }) => {
  const probes = await installProbes(page);
  await openSession(page);
  expect(await probes.liveTracks()).toBe(1);

  await footerPause(page).click();
  await page.waitForTimeout(2500);
  await expect(panelStatus(page)).toHaveText("Paused");
  await expect(pauseScreen(page)).toHaveCount(1);
  expect(await probes.liveTracks()).toBe(0);
});

test.describe("D5: footer Pause during end-dialog settling (today's behaviour, changes in phase 2)", () => {
  test("the session ends up Paused with the microphone live", async ({ page }) => {
    const probes = await installProbes(page);
    const proxy = await proxySession(page);
    await openSession(page);

    await endButton(page).click();
    await expect(endDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(endDialog(page)).toHaveCount(0);
    // Still inside the ~800 ms the close waits for the dialog's pause: the footer still offers
    // Pause, because the dialog's pause has not set isPaused yet.
    await expect(footerPause(page)).toBeVisible();
    await footerPause(page).click();

    // Let every pause and resume settle.
    await page.waitForTimeout(2500);

    // The footer Pause wins on screen: Paused, with the pause screen and its Resume focused.
    await expect(panelStatus(page)).toHaveText("Paused");
    await expect(pauseScreen(page)).toHaveCount(1);
    await expect(pauseScreen(page).getByRole("button", { name: /Resume session/ })).toBeFocused();
    await expect(endDialog(page)).toHaveCount(0);

    // D5: the close's resume reopened the microphone after the footer's pauseMic, so a track is
    // live behind the pause screen. Compare the ordinary Pause above, which leaves 0.
    expect(await probes.liveTracks()).toBe(1);

    // Nothing reached the server beyond the start: no end, and no audio.
    expect(proxy.clientFrames()).toEqual(["session_start"]);
  });
});
