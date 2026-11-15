import { expect, test, type Page } from "@playwright/test";

// FQ-46: the response time ("Last response: …ms") and the session id ("interview_…") are
// operator details. They show on the live session only when its URL has ?debug=1.
// The backend sends a response time only after a reply to the person's turn, not after the
// greeting, so each test sends one typed answer before checking.

async function openSessionAndAnswer(page: Page, query: string) {
  let latencyFrames = 0;
  page.on("websocket", (ws) =>
    ws.on("framereceived", (f) => {
      if (typeof f.payload === "string" && (JSON.parse(f.payload) as { type: string }).type === "latency_metric") {
        latencyFrames += 1;
      }
    }),
  );

  // Skip the mic check page the way a passed check does.
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto(`/session?interviewerId=explain-an-idea&demo=true${query}`);
  await expect(page.getByText("This is a mock reply.").first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Type message instead of speaking" }).click();
  await page.getByRole("textbox", { name: "Type your message" }).fill("Here is my answer.");
  await page.getByRole("textbox", { name: "Type your message" }).press("Enter");
  await expect.poll(() => latencyFrames, { timeout: 20_000 }).toBeGreaterThan(0);
}

test.describe("operator details on the live session", () => {
  test("are hidden without ?debug=1", async ({ page }) => {
    await openSessionAndAnswer(page, "");
    // Give the page time to render the response time it has just received.
    await page.waitForTimeout(500);
    // Soft assertions so each detail is checked on its own: a failure of the first must not
    // hide the result of the second.
    await expect.soft(page.getByText(/Last response:/)).toHaveCount(0);
    await expect.soft(page.getByText(/interview_/)).toHaveCount(0);
  });

  test("show with ?debug=1, in the panel and the header", async ({ page }) => {
    await openSessionAndAnswer(page, "&debug=1");
    const panel = page.locator(".interviewer-panel");
    await expect(panel.getByText(/^Last response: \d+ms$/)).toBeVisible();
    await expect(panel.getByText(/^interview_\S+$/)).toBeVisible();
    await expect(page.locator(".session-header-bar").getByText(/^interview_\S+$/)).toBeVisible();
  });
});
