import { expect, test, type Page } from "@playwright/test";
import { installProbes, proxySession, speech, type Probes } from "./support/session";

// FQ-108 S1 (#122), the phase 0 tracer (design T3). The interviewer's reply really plays, and
// the response-gap rule holds end to end: an answer that starts after playback has ended is
// preceded by turn_timing, and an answer with no playback since the last one is not.
// The mock backend's own audio is too short to play (two 4-byte frames, dropped by the client
// under 512 bytes), so the proxy swaps in a real silent MP3. The last test shows that without
// the swap nothing plays and turn_timing is never sent: that is why the proxy exists.
// As in resume.spec.ts, the autoplay flag lets audio and voice detection start without a click.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

async function openSession(page: Page): Promise<void> {
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
}

/** Waits until at least `n` audio buffers have started and every started one has ended. */
async function playbackFinished(probes: Probes, n: number): Promise<void> {
  await expect.poll(() => probes.playbackStarts(), { timeout: 20_000 }).toBeGreaterThanOrEqual(n);
  await expect.poll(async () => (await probes.playbackEnds()) === (await probes.playbackStarts()), { timeout: 10_000 }).toBe(true);
}

test("the greeting plays, and an answer after it ends sends turn_timing before the audio", async ({ page }) => {
  const proxy = await proxySession(page);
  const probes = await installProbes(page);
  await openSession(page);

  // The greeting is spoken through the proxy's MP3 and finishes.
  await playbackFinished(probes, 1);
  const status = page.locator(".interviewer-panel .interviewer-status");
  await expect(status).toHaveText("Listening");
  expect(await probes.liveTracks()).toBe(1);

  const before = proxy.clientFrames().length;
  await speech.start(page);
  await speech.end(page);
  await expect(page.getByText("hello there")).toBeVisible({ timeout: 10_000 });

  expect(proxy.clientFrames().slice(before)).toEqual(["turn_timing", "audio"]);
});

test("a second answer with no playback since the first sends no turn_timing", async ({ page }) => {
  const proxy = await proxySession(page);
  const probes = await installProbes(page);
  await openSession(page);
  await playbackFinished(probes, 1);

  const before = proxy.clientFrames().length;
  // Back to back, before any reply can play: the first answer uses the greeting's end, so the
  // second has no playback end to measure from.
  await page.evaluate(() => {
    const vad = (window as unknown as { __testSeams: { vad: { speechStart(): void; speechEnd(): void } } }).__testSeams.vad;
    vad.speechStart();
    vad.speechEnd();
    vad.speechStart();
    vad.speechEnd();
  });
  await expect.poll(() => proxy.clientFrames().length - before, { timeout: 10_000 }).toBe(3);

  expect(proxy.clientFrames().slice(before)).toEqual(["turn_timing", "audio", "audio"]);
});

test("without the proxy's MP3, the mock's audio never plays and no turn_timing is sent", async ({ page }) => {
  const proxy = await proxySession(page, { replaceAudio: false });
  const probes = await installProbes(page);
  await openSession(page);
  // The greeting's transcript arrives, but its 8 bytes of audio are dropped.
  await expect(page.getByText("This is a mock reply.").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".interviewer-panel .interviewer-status")).toHaveText("Listening");
  await page.waitForTimeout(500);

  const before = proxy.clientFrames().length;
  await speech.start(page);
  await speech.end(page);
  await expect(page.getByText("hello there")).toBeVisible({ timeout: 10_000 });

  expect(await probes.playbackStarts()).toBe(0);
  expect(proxy.clientFrames().slice(before)).toEqual(["audio"]);
});
