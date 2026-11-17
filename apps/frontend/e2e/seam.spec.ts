import { expect, test } from "@playwright/test";

// FQ-108 S0 (#121): the e2e build (NEXT_PUBLIC_TEST_SEAMS=1) exposes the live voice detector's
// callbacks as window.__testSeams.vad, so later specs can drive speech deterministically
// instead of relying on Silero hearing the fake microphone. A normal build has no seam
// (checked by `npm run check:no-test-seams`). The mock STT transcribes any audio as
// "hello there", so a seam-driven utterance shows up as a user transcript entry.
// As in resume.spec.ts, the autoplay flag lets voice detection start without a click.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

type SeamWindow = Window & {
  __testSeams?: { vad?: { speechStart(): void; speechEnd(samples?: Float32Array): void; misfire(): void } };
};

test("the speech seam drives an utterance through the real voice-detector callbacks", async ({ page }) => {
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  const panel = page.locator(".interviewer-panel");
  await expect(panel).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
  await expect(panel.locator(".interviewer-status")).toHaveText("Listening", { timeout: 20_000 });

  // The seam is registered once the voice detector is live.
  await page.waitForFunction(() => !!(window as SeamWindow).__testSeams?.vad, undefined, { timeout: 10_000 });
  await expect(page.getByText("hello there")).toHaveCount(0);

  await page.evaluate(() => {
    const vad = (window as SeamWindow).__testSeams!.vad!;
    vad.speechStart();
    vad.speechEnd(); // default: 0.5 s of silence at 16 kHz
  });

  await expect(page.getByText("hello there")).toBeVisible({ timeout: 10_000 });
});

test("a misfire through the seam sends nothing", async ({ page }) => {
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  const panel = page.locator(".interviewer-panel");
  await expect(panel.locator(".interviewer-status")).toHaveText("Listening", { timeout: 20_000 });
  await page.waitForFunction(() => !!(window as SeamWindow).__testSeams?.vad, undefined, { timeout: 10_000 });

  await page.evaluate(() => {
    const vad = (window as SeamWindow).__testSeams!.vad!;
    vad.speechStart();
    vad.misfire();
  });

  await page.waitForTimeout(1_000);
  await expect(page.getByText("hello there")).toHaveCount(0);
  await expect(panel.locator(".interviewer-status")).toHaveText("Listening");
});
