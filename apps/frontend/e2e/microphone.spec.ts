import { expect, test, type Page } from "@playwright/test";

// FQ-40 (#40): the session records from the microphone chosen in the mic check, keeps it after
// Pause/Resume, and falls back to the default with a notice when it is missing.
//
// Chromium's fake devices give three inputs: "Fake Default Audio Input" (default), "Fake Audio
// Input 1" and "Fake Audio Input 2". An init script records every getUserMedia call: the exact
// device asked for and the device that actually opened. As in hearing.spec.ts, the autoplay flag
// lets voice detection start without a click, and test.use repeats the fake-device flags.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

type Open = { wanted: string | null; label: string };
const KEY = "interview-studio:mic";
const LOCAL = new Set(["localhost:3000", "localhost:3001", "127.0.0.1:3000", "127.0.0.1:3001"]);

test.beforeEach(async ({ page }) => {
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.protocol.startsWith("http") && !LOCAL.has(url.host) ? route.abort("blockedbyclient") : route.fallback();
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __opens: Open[] };
    w.__opens = [];
    const md = navigator.mediaDevices;
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      const audio = c?.audio;
      const exact = typeof audio === "object" && audio && typeof audio.deviceId === "object" && audio.deviceId && "exact" in audio.deviceId ? String(audio.deviceId.exact) : null;
      // Recorded before awaiting, so a request that fails (a missing device) is recorded too.
      const entry: Open = { wanted: exact, label: "" };
      w.__opens.push(entry);
      const s = await original(c);
      entry.label = s.getAudioTracks()[0]?.label ?? "(none)";
      return s;
    };
  });
});

const opens = (page: Page) => page.evaluate(() => (window as unknown as { __opens: Open[] }).__opens);
const lastOpen = async (page: Page) => (await opens(page)).at(-1);
const panel = (page: Page) => page.locator(".interviewer-panel");

async function enableMicCheck(page: Page): Promise<void> {
  await page.goto("/mic-check");
  await page.getByRole("button", { name: "Enable microphone" }).click();
  await expect(page.getByLabel("Microphone", { exact: true })).toBeVisible();
}

// Note: in this test browser a microphone's id changes on every page load, so test 1 also proves
// the session finds the chosen microphone by name when its saved id no longer matches.

/** Opens a session the way a passed mic check does, in the same tab (localStorage carries over). */
async function openSession(page: Page): Promise<void> {
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  await expect(panel(page)).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
}

test.describe("microphone choice", () => {
  test("the session and its resume use the microphone chosen on the mic check", async ({ page }) => {
    await enableMicCheck(page);
    await page.getByLabel("Microphone", { exact: true }).selectOption({ label: "Fake Audio Input 2" });
    await expect.poll(async () => (await lastOpen(page))?.label).toBe("Fake Audio Input 2"); // the check itself uses it

    await openSession(page);
    expect((await lastOpen(page))?.label).toBe("Fake Audio Input 2");
    await expect(page.getByText(/isn't connected/)).toHaveCount(0);

    const before = (await opens(page)).length;
    await page.getByRole("button", { name: "Pause session" }).click();
    await page.getByRole("button", { name: "Resume session" }).first().click();
    await expect.poll(async () => (await opens(page)).length).toBeGreaterThan(before);
    expect((await lastOpen(page))?.label).toBe("Fake Audio Input 2");
  });

  test("a missing remembered microphone falls back to the default and says so, on the check and in the session", async ({ page }) => {
    await page.goto("/mic-check");
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ deviceId: "unplugged-headset", label: "USB Headset" })), KEY);
    await page.reload();
    await page.getByRole("button", { name: "Enable microphone" }).click();
    await expect(page.getByText(/Your saved microphone \(USB Headset\) isn't connected/)).toBeVisible();
    await expect(page.getByText(/access denied/i)).toHaveCount(0);

    await openSession(page);
    await expect(page.getByText(/Your chosen microphone \(USB Headset\) isn't connected, so we're using/)).toBeVisible();
    const all = await opens(page);
    expect(all.some((o) => o.wanted === "unplugged-headset")).toBe(true);
    expect(all.at(-1)).toEqual({ wanted: null, label: "Fake Default Audio Input" });
    await expect(panel(page)).toHaveAttribute("data-hearing", "ready");
  });

  test('choosing "System default" forgets the choice', async ({ page }) => {
    await enableMicCheck(page);
    const picker = page.getByLabel("Microphone", { exact: true });
    await picker.selectOption({ label: "Fake Audio Input 1" });
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).not.toBeNull();
    await picker.selectOption({ label: "System default" });
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();

    await openSession(page);
    expect((await lastOpen(page))?.wanted).toBeNull();
  });

  test("with nothing chosen the session asks for no particular device (as before)", async ({ page }) => {
    await page.goto("/mic-check");
    await openSession(page);
    expect((await lastOpen(page))?.wanted).toBeNull();
    await expect(page.getByText(/isn't connected/)).toHaveCount(0);
  });
});
