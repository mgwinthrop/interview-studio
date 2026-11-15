import { expect, test, type Page } from "@playwright/test";

// FQ-98 (#98): while the end-confirm flow is still settling (closing waits for the dialog's own
// pause before resuming), End Session must do nothing. Before the fix a second click in that
// window started a new pause that outlived the close, leaving the session Paused.
// The audio pause is slowed to 800 ms so the window is wide enough to click in reliably.
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
    // Counts every insertion of the pause screen, so even a one-frame flash shows up.
    new MutationObserver((records) => {
      for (const r of records) {
        for (const node of Array.from(r.addedNodes)) {
          if (node instanceof Element && node.matches('[aria-labelledby="paused-title"]')) {
            (window as unknown as { __pauseScreenShows: number }).__pauseScreenShows =
              ((window as unknown as { __pauseScreenShows?: number }).__pauseScreenShows ?? 0) + 1;
          }
        }
      }
    }).observe(document, { subtree: true, childList: true });
  });
});

const panelStatus = (page: Page) => page.locator(".interviewer-panel .interviewer-status");
const endButton = (page: Page) => page.getByRole("button", { name: "End Session", exact: true });
const endDialog = (page: Page) => page.getByRole("dialog", { name: "End this interview?" });
const pauseScreenShows = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pauseScreenShows?: number }).__pauseScreenShows ?? 0);

test("End Session clicked while the dialog is still closing does nothing", async ({ page }) => {
  const sessionEnds: string[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", (f) => {
      if (typeof f.payload === "string" && (JSON.parse(f.payload) as { type: string }).type === "session_end") {
        sessionEnds.push("session_end");
      }
    }),
  );

  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
  await expect(panelStatus(page)).not.toHaveText("Speaking", { timeout: 20_000 });

  await endButton(page).click();
  await expect(endDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(endDialog(page)).toHaveCount(0);
  // Still inside the ~800 ms the close waits for the dialog's pause.
  await endButton(page).click();

  // Let every pause and resume settle.
  await page.waitForTimeout(2500);
  await expect(panelStatus(page)).not.toHaveText("Paused");
  expect(await pauseScreenShows(page)).toBe(0);
  await expect(endDialog(page)).toHaveCount(0);
  await expect(endButton(page)).toBeFocused();
  expect(sessionEnds).toEqual([]);

  // Once settled, End Session works as before.
  await endButton(page).click();
  await expect(endDialog(page)).toBeVisible();
});
