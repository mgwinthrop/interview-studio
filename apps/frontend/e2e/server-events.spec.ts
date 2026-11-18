import { expect, test, type Page } from "@playwright/test";
import { installProbes, proxySession } from "./support/session";

// FQ-108 S5 (#126), design T6: server events the mock backend never sends, injected by the
// proxy. stt_error shows a short, non-blocking toast; session_failed shows the failed overlay
// and closes the microphone.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

const STT_TOAST = "Didn’t catch that — please repeat";

async function openSession(page: Page): Promise<void> {
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
  await expect(page.locator(".interviewer-panel .interviewer-status")).toHaveText("Listening", { timeout: 20_000 });
}

test("stt_error shows the toast for about 3 s, then it goes, and the session carries on", async ({ page }) => {
  const proxy = await proxySession(page);
  await openSession(page);

  proxy.inject({ type: "stt_error", reason: "no speech" });
  const toast = page.getByRole("alert").filter({ hasText: STT_TOAST });
  await expect(toast).toBeVisible({ timeout: 5_000 });
  const shownAt = Date.now();

  // Still there well into the 3 s, gone not long after it.
  await page.waitForTimeout(2_000);
  await expect(toast).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 3_000 });
  expect(Date.now() - shownAt).toBeGreaterThanOrEqual(2_500);

  await expect(page.locator(".interviewer-panel .interviewer-status")).toHaveText("Listening");
});

test("session_failed shows the failed overlay and closes the microphone", async ({ page }) => {
  const proxy = await proxySession(page);
  const probes = await installProbes(page);
  await openSession(page);
  expect(await probes.liveTracks()).toBe(1);

  proxy.inject({ type: "session_failed", reason: "report failed" });
  await expect(page.getByRole("heading", { name: "The session could not be completed" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("link", { name: "Back to start" })).toBeVisible();
  await expect.poll(() => probes.liveTracks(), { timeout: 5_000 }).toBe(0);
});
