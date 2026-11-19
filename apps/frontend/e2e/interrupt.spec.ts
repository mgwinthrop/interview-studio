import { expect, test, type Page } from "@playwright/test";
import { installProbes, proxySession, speech, type ProxyControl } from "./support/session";

// FQ-108 S4 (#125), design T4: the CLAUDE.md interrupt contract, end to end. Speech that starts
// while the interviewer is speaking snaps the panel to "interrupted" locally (no server
// round-trip), sends `interrupt` before the answer's audio, stops playback and drops the
// interrupted reply's audio, and sends no turn_timing for that answer (a barge-in has no gap).
// Two cases: while the reply is still streaming (tts_end held, nothing decoded yet), and during
// real playback of the proxy's MP3.
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

type InterruptWindow = Window & {
  __states: string[];
  __stops: number;
  __interruptOnPlay: boolean;
  __testSeams?: { vad?: { speechStart(): void } };
};

/** Records every panel state and every source.stop(); can fire speech 200 ms into playback. */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as InterruptWindow;
    w.__states = [];
    w.__stops = 0;
    w.__interruptOnPlay = false;
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (...args: Parameters<typeof stop>) {
      w.__stops++;
      return stop.apply(this, args);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      if (w.__interruptOnPlay) {
        w.__interruptOnPlay = false;
        // The buffer plays from +100 ms to about +410 ms, and the page reports "playing" at
        // +100 ms, so +200 ms is inside real playback that the page knows about.
        setTimeout(() => w.__testSeams?.vad?.speechStart(), 200);
      }
      return start.apply(this, args);
    };
    const record = () => {
      const s = document.querySelector(".interviewer-status-dot")?.getAttribute("data-state");
      if (s && w.__states[w.__states.length - 1] !== s) w.__states.push(s);
    };
    new MutationObserver(record).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
  });
}

const states = (page: Page) => page.evaluate(() => (window as unknown as InterruptWindow).__states);
const stops = (page: Page) => page.evaluate(() => (window as unknown as InterruptWindow).__stops);
const status = (page: Page) => page.locator(".interviewer-panel .interviewer-status");

async function openHeld(page: Page, proxy: ProxyControl): Promise<void> {
  proxy.hold("tts_end");
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
  await page.waitForFunction(() => !!(window as unknown as InterruptWindow).__testSeams?.vad, undefined, { timeout: 10_000 });
  await expect(status(page)).toHaveText("Speaking", { timeout: 20_000 });
}

test("speech while the reply is still streaming snaps to interrupted, sends interrupt first, and drops the reply", async ({ page }) => {
  const proxy = await proxySession(page);
  const probes = await installProbes(page);
  await instrument(page);
  await openHeld(page, proxy);
  const before = proxy.clientFrames().length;
  const statesBefore = (await states(page)).length;

  await speech.start(page);
  // Local snap: shown while tts_end is still held, so no server frame caused it.
  await expect.poll(async () => (await states(page)).slice(statesBefore), { timeout: 2_000 }).toContain("interrupted");
  await expect.poll(() => proxy.clientFrames().slice(before), { timeout: 2_000 }).toEqual(["interrupt"]);

  // The interrupted reply's buffered audio was flushed: releasing its tts_end plays nothing.
  // (Released before the answer is sent, so no later reply can be among the held frames.)
  proxy.release();
  await page.waitForTimeout(1_000);
  expect(await probes.playbackStarts()).toBe(0);

  await speech.end(page);
  await expect.poll(() => proxy.clientFrames().slice(before), { timeout: 5_000 }).toEqual(["interrupt", "audio"]);
});

test("speech during real playback stops it, sends interrupt before the audio, and no turn_timing", async ({ page }) => {
  const proxy = await proxySession(page);
  const probes = await installProbes(page);
  await instrument(page);
  await openHeld(page, proxy);
  await page.evaluate(() => { (window as unknown as InterruptWindow).__interruptOnPlay = true; });
  const before = proxy.clientFrames().length;
  const statesBefore = (await states(page)).length;

  // Releasing tts_end lets the greeting decode and play; speech starts 200 ms into it.
  proxy.release();
  await expect.poll(() => probes.playbackStarts(), { timeout: 10_000 }).toBe(1);
  await expect.poll(() => proxy.clientFrames().slice(before), { timeout: 5_000 }).toEqual(["interrupt"]);

  // Playback was stopped by the interrupt (source.stop is only called by a flush), and it ended.
  expect(await stops(page)).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await probes.playbackEnds()) === (await probes.playbackStarts()), { timeout: 2_000 }).toBe(true);
  expect((await states(page)).slice(statesBefore)).toContain("interrupted");

  await speech.end(page);
  await expect.poll(() => proxy.clientFrames().slice(before), { timeout: 5_000 }).toEqual(["interrupt", "audio"]);
});
