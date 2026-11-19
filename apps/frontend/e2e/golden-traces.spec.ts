import { expect, test, type Page } from "@playwright/test";
import { recordRegions, expectGolden, type RegionTrace } from "./support/regions";
import { installProbes, proxySession, speech, type Probes, type ProxyControl } from "./support/session";

// FQ-108 S9 (#130), design T10 (part 1): golden traces of today's behaviour for three
// scenarios. Each records the client frame order (O3) and the per-region visible states (O4)
// and compares them with e2e/golden/<scenario>.json. Phases 2-5 of the rebuild must keep these
// unchanged except for owner-approved D items.
//
// Determinism: React may skip a state when two server frames land in one render (gate 2 §0.2),
// so every reply is held at tts_start and stepped: tts_start alone (wait for "Speaking"), then
// through tts_end (the reply's audio decodes and plays), then the rest. The greeting is also
// held until voice detection is ready, so the two startup races never interleave in the panel.
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

async function playbackSettled(probes: Probes, n: number): Promise<void> {
  await expect.poll(() => probes.playbackStarts(), { timeout: 20_000 }).toBeGreaterThanOrEqual(n);
  await expect.poll(async () => (await probes.playbackEnds()) === (await probes.playbackStarts()), { timeout: 10_000 }).toBe(true);
}

/**
 * Plays out a reply whose tts_start is held: tts_start alone, then through tts_end, then the
 * rest. Waits for the state each step causes, so no step can be batched with the next.
 */
async function stepReply(page: Page, proxy: ProxyControl, probes: Probes, nth: number): Promise<void> {
  await expect.poll(() => proxy.releaseThrough("tts_start"), { timeout: 10_000 }).toBe(true);
  await expect(status(page)).toHaveText("Speaking");
  expect(proxy.releaseThrough("tts_end")).toBe(true);
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

test("golden: start to first reply", async ({ page }) => {
  const { proxy, probes, stop } = await startSession(page);

  proxy.hold("tts_start");
  await speech.start(page);
  await speech.end(page);
  await expect(page.getByText("hello there")).toBeVisible({ timeout: 10_000 });
  await expect(status(page)).toHaveText("Thinking");
  await stepReply(page, proxy, probes, 2);

  await expectGolden("start-to-first-reply", { frames: proxy.clientFrames(), regions: await stop() });
});

test("golden: pause and resume", async ({ page }) => {
  const { proxy, stop } = await startSession(page);

  await page.getByRole("button", { name: "Pause session" }).click();
  await expect(page.getByRole("dialog", { name: "Session paused" })).toBeVisible();
  await expect(status(page)).toHaveText("Paused");
  await page.getByRole("button", { name: "Resume session" }).first().click();
  await expect(page.getByRole("dialog", { name: "Session paused" })).toHaveCount(0);
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 10_000 });
  await expect(status(page)).toHaveText("Listening");

  await expectGolden("pause-resume", { frames: proxy.clientFrames(), regions: await stop() });
});

test("golden: open the end dialog and keep talking", async ({ page }) => {
  const { proxy, stop } = await startSession(page);

  await page.getByRole("button", { name: "End Session", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "End this interview?" });
  await expect(dialog).toBeVisible();
  await expect(status(page)).toHaveText("Paused");
  await dialog.getByRole("button", { name: "Keep talking" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 10_000 });
  await expect(status(page)).toHaveText("Listening");

  await expectGolden("end-confirm-dismiss", { frames: proxy.clientFrames(), regions: await stop() });
});
