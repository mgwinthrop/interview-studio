import { expect, test } from "@playwright/test";
import { speech } from "./support/session";

// FQ-50 S1 (#152): each "Answer N" card in the report shows the question it answered, and
// "Read answer" opens the Transcript tab on that answer, highlighted and focused, with its
// delivery numbers beside it. A real mock session end to end.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

test("an answer card shows its question and Read answer lands on that answer", async ({ page }) => {
  const status = page.locator(".interviewer-panel .interviewer-status");
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
  await expect(status).toHaveText("Listening", { timeout: 20_000 });
  await speech.start(page);
  await speech.end(page);
  await expect(page.getByText("hello there")).toBeVisible({ timeout: 10_000 });
  await expect(status).toHaveText("Listening", { timeout: 20_000 });

  await page.getByRole("button", { name: "End Session", exact: true }).click();
  await page.getByRole("dialog", { name: "End this interview?" }).getByRole("button", { name: "End and see report" }).click();
  await expect(page).toHaveURL(/\/report\//, { timeout: 20_000 });

  // The card names its question: the mock interviewer's greeting.
  const card = page.getByRole("listitem").filter({ hasText: "Answer 1" });
  await expect(card.getByText("This is a mock reply.")).toBeVisible({ timeout: 10_000 });

  await card.getByRole("button", { name: "Read answer 1" }).click();
  await expect(page.getByRole("tab", { name: "Transcript" })).toHaveAttribute("aria-selected", "true");
  const answer = page.locator("#answer-1");
  await expect(answer).toBeFocused();
  await expect(answer).toHaveAttribute("aria-current", "true");
  await expect(answer).toContainText("hello there");
  await expect(answer).toContainText(/\d+ words? · pace/);
});
