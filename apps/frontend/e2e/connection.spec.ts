import { expect, test, type Page } from "@playwright/test";
import { installProbes, proxySession, type Probes, type ProxyControl } from "./support/session";

// FQ-108 S5 (#126), design T5: a connection the server closes shows Connection lost with its
// reason; Start over opens a new session; End from Connection lost goes to the report.
// The last block records what Start over carries over from the dead session TODAY. Phase 1
// (S13, #134) changes it on purpose, and that slice updates the block.
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

const TIMEOUT_WORDING = "The conversation timed out from inactivity. Start over.";
const status = (page: Page) => page.locator(".interviewer-panel .interviewer-status");
const lost = (page: Page) => page.getByRole("heading", { name: "Connection lost" });
const startOver = (page: Page) => page.getByRole("button", { name: "Start over" });
const endButton = (page: Page) => page.getByRole("button", { name: "End Session", exact: true });

/** Opens a session and waits for voice detection; the greeting may still be held by the proxy. */
async function openSessionUntilReady(page: Page): Promise<void> {
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
}

async function openSession(page: Page): Promise<void> {
  await openSessionUntilReady(page);
  await expect(status(page)).toHaveText("Listening", { timeout: 20_000 });
}

async function setup(page: Page): Promise<{ proxy: ProxyControl; probes: Probes }> {
  const proxy = await proxySession(page);
  const probes = await installProbes(page);
  return { proxy, probes };
}

const sessionStarts = (proxy: ProxyControl) => proxy.clientFrames().filter((f) => f === "session_start").length;

test("a server close 1001 shows Connection lost with the timeout wording", async ({ page }) => {
  const { proxy } = await setup(page);
  await openSession(page);

  proxy.inject({ close: 1001, reason: "idle" });
  await expect(lost(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(TIMEOUT_WORDING)).toBeVisible();
  await expect(startOver(page)).toBeVisible();
});

test("Start over opens a new connection that sends a new session_start", async ({ page }) => {
  const { proxy } = await setup(page);
  await openSession(page);
  expect(sessionStarts(proxy)).toBe(1);

  proxy.inject({ close: 1001 });
  await expect(lost(page)).toBeVisible({ timeout: 10_000 });
  await startOver(page).click();

  await expect.poll(() => sessionStarts(proxy), { timeout: 10_000 }).toBe(2);
  await expect(lost(page)).toHaveCount(0);
  await expect(status(page)).toHaveText("Listening", { timeout: 20_000 });
});

test("End session from Connection lost goes to this session's report", async ({ page }) => {
  const { proxy } = await setup(page);
  await openSession(page);

  proxy.inject({ close: 1001 });
  await expect(lost(page)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page).toHaveURL(/\/report\/[0-9a-f-]{8,}$/, { timeout: 10_000 });
});

type RxWindow = Window & { __rx: string[][] };

/** Records, per page-side socket in creation order, the type of every text frame it receives. */
async function recordReceivedFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as RxWindow;
    w.__rx = [];
    const Native = window.WebSocket;
    class Recording extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        const log: string[] = [];
        w.__rx.push(log);
        this.addEventListener("message", (e) => {
          if (typeof e.data === "string") log.push((JSON.parse(e.data) as { type: string }).type);
        });
      }
    }
    window.WebSocket = Recording;
  });
}
const received = (page: Page) => page.evaluate(() => (window as unknown as RxWindow).__rx);

test("frames held on the dead connection never reach the new one after Start over", async ({ page }) => {
  const { proxy } = await setup(page);
  await recordReceivedFrames(page);
  // Holds the first connection's tts_start and every frame after it on that connection.
  proxy.hold("tts_start");
  await openSessionUntilReady(page);
  await page.waitForTimeout(500);
  expect((await received(page))[0]).not.toContain("tts_start");

  proxy.inject({ close: 1001 });
  await expect(lost(page)).toBeVisible({ timeout: 10_000 });
  await startOver(page).click();
  await expect(status(page)).toHaveText("Listening", { timeout: 20_000 });
  await expect.poll(async () => (await received(page))[1]?.filter((t) => t === "tts_end").length ?? 0, { timeout: 10_000 }).toBe(1);
  const before = (await received(page))[1].length;
  expect((await received(page))[1].filter((t) => t === "tts_start")).toHaveLength(1);

  // Releasing after the first connection closed neither throws nor delivers to the new one.
  expect(() => proxy.release()).not.toThrow();
  await page.waitForTimeout(1_000);
  const after = await received(page);
  expect(after[1]).toHaveLength(before);
  expect(after[1].filter((t) => t === "tts_start")).toHaveLength(1);
  expect(after).toHaveLength(2);
});

test.describe("today, changed by phase 1 D3/D4/D7", () => {
  test("D7: the microphone stays live while Connection lost shows", async ({ page }) => {
    const { proxy, probes } = await setup(page);
    await openSession(page);
    expect(await probes.liveTracks()).toBe(1);

    proxy.inject({ close: 1001 });
    await expect(lost(page)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    expect(await probes.liveTracks()).toBe(1);
  });

  test("D3: a session paused before the loss is still paused after Start over", async ({ page }) => {
    const { proxy, probes } = await setup(page);
    await openSession(page);
    await page.getByRole("button", { name: "Pause session" }).click();
    await expect(page.getByRole("dialog", { name: "Session paused" })).toBeVisible();

    proxy.inject({ close: 1001 });
    await expect(lost(page)).toBeVisible({ timeout: 10_000 });
    await startOver(page).click();

    await expect.poll(() => sessionStarts(proxy), { timeout: 10_000 }).toBe(2);
    await expect(page.getByRole("dialog", { name: "Session paused" })).toBeVisible({ timeout: 10_000 });
    await expect(status(page)).toHaveText("Paused");
    expect(await probes.liveTracks()).toBe(0);
  });

  test("D4: with the end dialog open at the loss, Start over leaves a paused session with no way to end or resume", async ({ page }) => {
    const { proxy, probes } = await setup(page);
    await openSession(page);
    await endButton(page).click();
    await expect(page.getByRole("dialog", { name: "End this interview?" })).toBeVisible();

    proxy.inject({ close: 1001 });
    await expect(lost(page)).toBeVisible({ timeout: 10_000 });
    await startOver(page).click();
    await expect.poll(() => sessionStarts(proxy), { timeout: 10_000 }).toBe(2);
    await expect(status(page)).toHaveText("Paused", { timeout: 10_000 });

    // Neither the end dialog nor the pause screen comes back, so there is no Resume button.
    await expect(page.getByRole("dialog", { name: "End this interview?" })).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Session paused" })).toHaveCount(0);
    // End Session does nothing: no dialog opens and the page stays on the session.
    await endButton(page).click();
    await page.waitForTimeout(800);
    await expect(page.getByRole("dialog", { name: "End this interview?" })).toBeHidden();
    await expect(page).toHaveURL(/\/session\?/);
    expect(await probes.liveTracks()).toBe(0);
  });
});
