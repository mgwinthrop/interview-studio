import { expect, test, type Page } from "@playwright/test";

// FQ-79 (#79): after Pause, a microphone that does not reopen is never silent, Pause/Resume
// gets the voice back, and a reopen that lands after a Pause never leaves a microphone live.
//
// An init script wraps getUserMedia: window.__mic = "ok" | "fail" | "hang" decides what the
// next opens do, window.__release() lets held opens through, and window.__live() counts
// microphone tracks still live. As in hearing.spec.ts, the autoplay flag lets voice detection
// start without a click and test.use repeats the fake-device flags.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

const RESUME_MESSAGE = "We can't hear your microphone.";
const LOCAL = new Set(["localhost:3000", "localhost:3001", "127.0.0.1:3000", "127.0.0.1:3001"]);

test.beforeEach(async ({ page }) => {
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.protocol.startsWith("http") && !LOCAL.has(url.host) ? route.abort("blockedbyclient") : route.fallback();
  });
  await page.addInitScript(() => {
    type W = { __mic: string; __release: () => void; __live: () => number; __held: (() => void)[]; __tracks: MediaStreamTrack[] };
    const w = window as unknown as W;
    w.__mic = "ok";
    w.__held = [];
    w.__tracks = [];
    w.__release = () => { w.__held.splice(0).forEach((go) => go()); };
    w.__live = () => w.__tracks.filter((t) => t.readyState === "live").length;
    const md = navigator.mediaDevices;
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      if (w.__mic === "fail") throw new DOMException("Could not start audio source", "NotReadableError");
      if (w.__mic === "hang") await new Promise<void>((go) => w.__held.push(go));
      const s = await original(c);
      w.__tracks.push(...s.getAudioTracks());
      return s;
    };
  });
});

const panel = (page: Page) => page.locator(".interviewer-panel");
const status = (page: Page) => panel(page).locator(".interviewer-status");
const setMic = (page: Page, mode: "ok" | "fail" | "hang") => page.evaluate((m) => { (window as unknown as { __mic: string }).__mic = m; }, mode);
const live = (page: Page) => page.evaluate(() => (window as unknown as { __live: () => number }).__live());

async function openReadySession(page: Page): Promise<void> {
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  await expect(panel(page)).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
}

async function pause(page: Page) {
  await page.getByRole("button", { name: "Pause session" }).click();
}
async function resume(page: Page) {
  await page.getByRole("button", { name: "Resume session" }).first().click();
}

test.describe("resuming after a pause", () => {
  test("a microphone that does not reopen is reported, typing opens, and Pause/Resume gets the voice back", async ({ page }) => {
    await openReadySession(page);
    await pause(page);
    await setMic(page, "fail");
    await resume(page);

    await expect(page.getByText(RESUME_MESSAGE)).toBeVisible({ timeout: 10_000 });
    await expect(panel(page)).toHaveAttribute("data-hearing", "failed");
    await expect(status(page)).toHaveText("Can't hear you");
    await expect(page.getByLabel("Type your message")).toBeVisible();
    await expect(page.getByText("We can't hear you in this browser.")).toHaveCount(0);

    await setMic(page, "ok");
    await pause(page);
    await resume(page);
    await expect(panel(page)).toHaveAttribute("data-hearing", "ready", { timeout: 10_000 });
    await expect(status(page)).toHaveText("Listening");
    await expect(page.getByText(RESUME_MESSAGE)).toHaveCount(0);
  });

  test("a reopen that hangs is reported after 10 s, and one that lands after a Pause leaves no microphone live", async ({ page }) => {
    await openReadySession(page);
    await pause(page);
    await setMic(page, "hang");
    await resume(page);

    await expect(status(page)).toHaveText("Getting ready…");
    await expect(page.getByText(RESUME_MESSAGE)).toBeVisible({ timeout: 12_000 });
    await expect(status(page)).toHaveText("Can't hear you");

    await pause(page);
    await setMic(page, "ok");
    await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
    await expect.poll(() => live(page)).toBe(0); // the late stream was stopped, not connected

    await resume(page);
    await expect(panel(page)).toHaveAttribute("data-hearing", "ready", { timeout: 10_000 });
    await expect.poll(() => live(page)).toBe(1); // exactly one microphone, not two
    await expect(page.getByText(RESUME_MESSAGE)).toHaveCount(0);
  });

  test("an ordinary Pause and Resume shows no message (as before)", async ({ page }) => {
    await openReadySession(page);
    await pause(page);
    await resume(page);
    await expect(panel(page)).toHaveAttribute("data-hearing", "ready", { timeout: 10_000 });
    await expect(status(page)).toHaveText("Listening");
    await expect(page.getByText(RESUME_MESSAGE)).toHaveCount(0);
  });
});
