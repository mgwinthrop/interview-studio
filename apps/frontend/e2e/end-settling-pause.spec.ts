import { expect, test, type Page } from "@playwright/test";
import { installProbes, proxySession } from "./support/session";

// FQ-108 S7 (#128), design T8: the footer Pause used while the end dialog is settling. Closing
// the dialog (Escape) waits for the dialog's own pause before it resumes; in that window
// `isPaused` is still false, so the footer offers "Pause session".
//
// Defect D5 (FQ-108 02-architecture.md §6): before FQ-148 the close resumed anyway, so the
// page showed Paused while the microphone was open again. FQ-148 (#148, owner-approved
// change to this file) honours the Pause: the last press wins, and Paused means the mic is
// off. The D5 block pins that invariant, which the FQ-108 rebuild must keep.
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

/** End Session, Escape, then the footer Pause while the close is still settling; then settle. */
async function pauseWhileEndDialogSettles(page: Page): Promise<void> {
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
}

test.describe("D5: footer Pause during end-dialog settling (fixed by FQ-148)", () => {
  test("the session ends up Paused with the microphone off", async ({ page }) => {
    const probes = await installProbes(page);
    const proxy = await proxySession(page);
    await openSession(page);

    await pauseWhileEndDialogSettles(page);

    // The last press (Pause) wins: Paused, with the pause screen and its Resume focused.
    await expect(panelStatus(page)).toHaveText("Paused");
    await expect(pauseScreen(page)).toHaveCount(1);
    await expect(pauseScreen(page).getByRole("button", { name: /Resume session/ })).toBeFocused();
    await expect(endDialog(page)).toHaveCount(0);

    // Screen and mic agree: no track live behind the pause screen, as after an ordinary Pause.
    expect(await probes.liveTracks()).toBe(0);

    // Nothing reached the server beyond the start: no end, and no audio.
    expect(proxy.clientFrames()).toEqual(["session_start"]);
  });

  test("the kept pause is an ordinary pause: Resume listens again and End Session still works", async ({ page }) => {
    const probes = await installProbes(page);
    await openSession(page);

    await pauseWhileEndDialogSettles(page);
    await expect(panelStatus(page)).toHaveText("Paused");

    await pauseScreen(page).getByRole("button", { name: /Resume session/ }).click();
    await expect(pauseScreen(page)).toHaveCount(0);
    await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 10_000 });
    await expect(panelStatus(page)).toHaveText("Listening");
    expect(await probes.liveTracks()).toBe(1);
    await expect(page.locator(".session-hearing-alert")).toHaveCount(0);

    // Nothing is left stuck in the end flow.
    await endButton(page).click();
    await expect(endDialog(page)).toBeVisible();
  });
});
