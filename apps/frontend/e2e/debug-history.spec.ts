import { expect, test, type Page } from "@playwright/test";
import { installProbes, proxySession, speech, type Probes } from "./support/session";

// FQ-108 S12 (#133): the session history is an operator tool (gate 1 Q1). It shows only with
// ?debug=1, with a copy button, is kept in memory for the session and is never sent. The copied
// text must contain none of the words spoken or written in the session.
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

type CopyWindow = Window & { __copied: string[] };

/** Captures what the page copies, without needing clipboard permissions. */
async function captureClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as CopyWindow;
    w.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => { w.__copied.push(text); } },
    });
  });
}

const history = (page: Page) => page.getByRole("region", { name: "Session history" });
const status = (page: Page) => page.locator(".interviewer-panel .interviewer-status");

async function playbackSettled(probes: Probes, n: number): Promise<void> {
  await expect.poll(() => probes.playbackStarts(), { timeout: 20_000 }).toBeGreaterThanOrEqual(n);
  await expect.poll(async () => (await probes.playbackEnds()) === (await probes.playbackStarts()), { timeout: 10_000 }).toBe(true);
}

/** A session with a greeting, a spoken answer, a typed answer and two replies. */
async function talk(page: Page, url: string, probes: Probes): Promise<void> {
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto(url);
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
  await playbackSettled(probes, 1);
  await expect(status(page)).toHaveText("Listening");

  // Spoken: the mock transcribes any audio as "hello there".
  await speech.start(page);
  await speech.end(page);
  await expect(page.getByText("hello there")).toBeVisible({ timeout: 10_000 });
  await playbackSettled(probes, 2);

  // Written: typed text is sent as text_input and shown as the user's turn.
  await page.getByRole("button", { name: "Type message instead of speaking" }).click();
  await page.getByLabel("Type your message").fill("my secret typed words");
  await page.getByLabel("Type your message").press("Enter");
  await expect(page.getByText("my secret typed words")).toBeVisible({ timeout: 10_000 });
  await playbackSettled(probes, 3);
}

// Every word that appeared in the session's transcript.
const SESSION_WORDS = ["hello", "there", "secret", "typed", "words", "mock", "reply"];

test("with ?debug=1 the history shows and copies, and holds none of the session's words", async ({ page }) => {
  await captureClipboard(page);
  await proxySession(page);
  const probes = await installProbes(page);
  await talk(page, "/session?interviewerId=tell-a-story&demo=true&debug=1", probes);

  await expect(history(page)).toBeVisible();
  await history(page).getByRole("button", { name: "Copy history" }).click();
  await expect(history(page).getByRole("status")).toHaveText("Copied");
  const copied = await page.evaluate(() => (window as unknown as CopyWindow).__copied);
  expect(copied).toHaveLength(1);
  const text = copied[0];

  // It recorded the session: connection, sends, mic, audio and UI events with screen state.
  for (const label of ["ws:open", "ws:tts_start", "ws:transcript", "send:audio", "send:text_input", "mic:speechEnd", "audio:playing", "ui:sendText"]) {
    expect(text).toContain(label);
  }
  expect(text).toMatch(/\| connection=connected turn=\w+ mic=ready paused=no end=none/);

  // And none of what was said or typed.
  for (const word of SESSION_WORDS) expect(text.toLowerCase()).not.toContain(word);

  // Show history displays the same text.
  await history(page).getByRole("button", { name: "Show history" }).click();
  const shown = await history(page).locator("pre").textContent();
  for (const word of SESSION_WORDS) expect((shown ?? "").toLowerCase()).not.toContain(word);
  expect(shown).toContain("ws:open");
});

test("without ?debug=1 there is no history panel", async ({ page }) => {
  await captureClipboard(page);
  await proxySession(page);
  const probes = await installProbes(page);
  await talk(page, "/session?interviewerId=tell-a-story&demo=true", probes);

  await expect(history(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy history" })).toHaveCount(0);
});
