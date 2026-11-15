import { expect, test, type Page } from "@playwright/test";

// FQ-47: End Session asks for confirmation before ending a normal interview. The dialog pauses
// the session with the existing Pause (so nothing the person says reaches the interviewer),
// Escape or "Keep talking" resumes it only if the dialog paused it, and focus returns to
// End Session. As in resume.spec.ts, the autoplay flag lets voice detection start without a
// click and test.use repeats the fake-device flags, so the fake microphone is running.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

// Counts every time the pause screen is added to the page, so even a one-frame flash shows up.
// Kept in sessionStorage so the count survives the navigation to the report page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    new MutationObserver((records) => {
      for (const r of records) {
        for (const node of Array.from(r.addedNodes)) {
          if (node instanceof Element && node.matches('[aria-labelledby="paused-title"]')) {
            sessionStorage.setItem("pause_screen_shows", String(Number(sessionStorage.getItem("pause_screen_shows") ?? 0) + 1));
          }
        }
      }
    }).observe(document, { subtree: true, childList: true });
  });
});
const pauseScreenShows = (page: Page) => page.evaluate(() => Number(sessionStorage.getItem("pause_screen_shows") ?? 0));

type Sent = { binary: boolean; type: string | null };

function recordSentFrames(page: Page): Sent[] {
  const sent: Sent[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", (f) => {
      if (typeof f.payload === "string") {
        sent.push({ binary: false, type: (JSON.parse(f.payload) as { type: string }).type });
      } else {
        sent.push({ binary: true, type: null });
      }
    }),
  );
  return sent;
}

const panelStatus = (page: Page) => page.locator(".interviewer-panel .interviewer-status");
// The footer's button. exact: the pause screen has its own "End session" button.
const endButton = (page: Page) => page.getByRole("button", { name: "End Session", exact: true });
const pauseScreen = (page: Page) => page.getByRole("dialog", { name: "Session paused" });
const endDialog = (page: Page) => page.getByRole("dialog", { name: "End this interview?" });
const sessionEnds = (sent: Sent[]) => sent.filter((s) => s.type === "session_end").length;

async function openReadySession(page: Page) {
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
  await expect(panelStatus(page)).not.toHaveText("Speaking", { timeout: 20_000 });
}

test.describe("confirm before ending a session", () => {
  test("the dialog pauses the session, and Escape or Keep talking goes back to it", async ({ page }) => {
    const sent = recordSentFrames(page);
    await openReadySession(page);
    const sessionUrl = page.url();

    for (const dismiss of ["Escape", "Keep talking"] as const) {
      await endButton(page).click();

      // (1) A named dialog with the agreed wording; focus starts on Keep talking.
      await expect(endDialog(page)).toBeVisible();
      await expect(endDialog(page)).toContainText(
        "The conversation stops and your report is written. You can't continue this interview afterwards.",
      );
      await expect(endDialog(page).getByRole("button", { name: "Keep talking" })).toBeFocused();
      await expect(endDialog(page).getByRole("button", { name: "End and see report" })).toBeVisible();

      // (2) The session is paused behind the dialog: no audio leaves while it is open.
      await expect(panelStatus(page)).toHaveText("Paused");
      await expect(page.getByText("Session paused")).toHaveCount(0);
      const sentAtOpen = sent.length;
      await page.waitForTimeout(1500);
      expect(sent.slice(sentAtOpen).filter((s) => s.binary)).toEqual([]);

      // (3)/(4) Dismissing ends nothing and resumes the session.
      const showsBeforeDismiss = await pauseScreenShows(page);
      if (dismiss === "Escape") await page.keyboard.press("Escape");
      else await endDialog(page).getByRole("button", { name: "Keep talking" }).click();
      await expect(endDialog(page)).toHaveCount(0);
      expect(sessionEnds(sent)).toBe(0);
      expect(page.url()).toBe(sessionUrl);
      await expect(endButton(page)).toBeFocused();
      await expect(panelStatus(page)).not.toHaveText("Paused");
      // (7) The pause the dialog made ends without the pause screen ever appearing.
      await page.waitForTimeout(300);
      expect.soft(await pauseScreenShows(page)).toBe(showsBeforeDismiss);
    }
  });

  test("a session the person had paused stays paused after the dialog is dismissed", async ({ page }) => {
    const sent = recordSentFrames(page);
    await openReadySession(page);
    await page.getByRole("button", { name: "Pause session" }).click();
    await expect(panelStatus(page)).toHaveText("Paused");

    // (5) The pause screen covers the footer, so it offers its own End session button (a click,
    // no keyboard). Dismissing keeps the session paused and focus goes to Resume session.
    await expect(pauseScreen(page).getByRole("button", { name: "End session" })).toBeVisible();
    await pauseScreen(page).getByRole("button", { name: "End session" }).click();
    await expect(endDialog(page)).toBeVisible();
    await expect(pauseScreen(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(endDialog(page)).toHaveCount(0);
    await expect(panelStatus(page)).toHaveText("Paused");
    await expect(pauseScreen(page)).toBeVisible();
    await expect(pauseScreen(page).getByRole("button", { name: "Resume session" })).toBeFocused();
    expect(sessionEnds(sent)).toBe(0);
  });

  test("confirming ends the session and opens the report", async ({ page }) => {
    const sent = recordSentFrames(page);
    await openReadySession(page);
    await endButton(page).click();
    await expect(endDialog(page)).toBeVisible();
    expect(sessionEnds(sent)).toBe(0);
    await endDialog(page).getByRole("button", { name: "End and see report" }).click();

    // (6) Today's end path: session_end is sent and the report page opens, and the pause the
    // dialog made never shows the pause screen on the way.
    await expect(page).toHaveURL(/\/report\//, { timeout: 20_000 });
    expect(sessionEnds(sent)).toBe(1);
    expect(await pauseScreenShows(page)).toBe(0);
  });

  test("Escape straight after opening does not race the pause", async ({ page }) => {
    // (9) Slow the audio pause down so Escape lands while the dialog's pause is still running.
    await page.addInitScript(() => {
      const original = AudioContext.prototype.suspend;
      AudioContext.prototype.suspend = function (this: AudioContext) {
        return new Promise<void>((resolve) => setTimeout(resolve, 800)).then(() => original.call(this));
      };
    });
    const sent = recordSentFrames(page);
    await openReadySession(page);
    await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready");
    const showsBefore = await pauseScreenShows(page);

    await endButton(page).click();
    await expect(endDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(endDialog(page)).toHaveCount(0);

    // Let the slowed pause finish, then check the session ended up running, not stuck paused.
    await page.waitForTimeout(1500);
    await expect(panelStatus(page)).not.toHaveText("Paused");
    expect(await pauseScreenShows(page)).toBe(showsBefore);
    await expect(endButton(page)).toBeFocused();
    expect(sessionEnds(sent)).toBe(0);
  });

  test("confirming while paused goes to the report without the pause screen coming back", async ({ page }) => {
    const sent = recordSentFrames(page);
    await openReadySession(page);
    await page.getByRole("button", { name: "Pause session" }).click();
    await expect(pauseScreen(page)).toBeVisible();
    const showsWhilePaused = await pauseScreenShows(page);

    // (8) End session on the pause screen, then confirm.
    await pauseScreen(page).getByRole("button", { name: "End session" }).click();
    await expect(endDialog(page)).toBeVisible();
    await endDialog(page).getByRole("button", { name: "End and see report" }).click();
    await expect(page).toHaveURL(/\/report\//, { timeout: 20_000 });
    expect(sessionEnds(sent)).toBe(1);
    expect(await pauseScreenShows(page)).toBe(showsWhilePaused);
  });
});
