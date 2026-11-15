import { expect, test, type Page } from "@playwright/test";

// FQ-43: the live transcript stays fully opaque while the interviewer speaks. Captions matter
// most then. The mock backend sends tts_start and tts_end a few milliseconds apart, so the
// panel would never visibly show "Speaking". The test sits between the page and the real mock
// backend and holds back the first tts_end until the checks are done.

async function holdFirstSpeechOpen(page: Page): Promise<() => void> {
  let held: string | null = null;
  let deliver: ((message: string) => void) | null = null;
  await page.routeWebSocket(/localhost:3001/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (held === null && deliver === null && typeof message === "string" && (JSON.parse(message) as { type: string }).type === "tts_end") {
        held = message;
        deliver = (m) => ws.send(m);
        return;
      }
      ws.send(message);
    });
  });
  return () => {
    if (held !== null && deliver) deliver(held);
  };
}

// Effective opacity of the transcript log: its own opacity times every ancestor's.
async function transcriptOpacity(page: Page): Promise<number> {
  return page.getByLabel("Interview transcript").evaluate((log) => {
    let opacity = 1;
    for (let el: Element | null = log; el; el = el.parentElement) opacity *= parseFloat(getComputedStyle(el).opacity);
    return opacity;
  });
}

test("the live transcript is not dimmed while the interviewer speaks", async ({ page }) => {
  const release = await holdFirstSpeechOpen(page);

  // Skip the mic check page the way a passed check does.
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=explain-an-idea&demo=true");

  const status = page.locator(".interviewer-panel").getByRole("status");
  await expect(status).toHaveText("Speaking", { timeout: 20_000 });
  await expect(page.getByText("This is a mock reply.").first()).toBeVisible();
  // Let any opacity transition (0.2s before FQ-43) finish before measuring.
  await page.waitForTimeout(500);
  await expect(status).toHaveText("Speaking");

  expect(await transcriptOpacity(page)).toBe(1);

  // The blinking cursor on the current question still follows the interviewer's speech.
  const blinking = await page
    .getByLabel("Interview transcript")
    .evaluate((log) => Array.from(log.querySelectorAll("span")).some((s) => getComputedStyle(s).animationName === "blink"));
  expect(blinking).toBe(true);

  await page.screenshot({ path: test.info().outputPath("speaking.png") });

  release();
  await expect(status).not.toHaveText("Speaking", { timeout: 20_000 });
  expect(await transcriptOpacity(page)).toBe(1);
});
