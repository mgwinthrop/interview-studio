import { expect, test, type Page } from "@playwright/test";
import { speech } from "./support/session";

// FQ-50 S0 (#151): the Transcript tab shows the conversation, not only a download. (1) a real
// mock session; (2) turns route failing: report unchanged, download only; (3) Dashboard
// switching shows each session's own turns. (2) and (3) stub the backend with page.route.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

const transcriptTab = (page: Page) => page.getByRole("tab", { name: "Transcript" });
const downloadLink = (page: Page) => page.getByRole("link", { name: /Download/ });

test("a real session's report shows the conversation on the Transcript tab", async ({ page }) => {
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
  await expect(page.locator(".interviewer-panel .interviewer-status")).toHaveText("Listening", { timeout: 20_000 });
  await speech.start(page);
  await speech.end(page);
  await expect(page.getByText("hello there")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".interviewer-panel .interviewer-status")).toHaveText("Listening", { timeout: 20_000 });

  await page.getByRole("button", { name: "End Session", exact: true }).click();
  await page.getByRole("dialog", { name: "End this interview?" }).getByRole("button", { name: "End and see report" }).click();
  await expect(page).toHaveURL(/\/report\//, { timeout: 20_000 });

  await transcriptTab(page).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("hello there")).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText("You · Answer 1")).toBeVisible();
  await expect(panel.getByText("This is a mock reply.").first()).toBeVisible();
  await expect(downloadLink(page)).toBeVisible();
});

// ── Stubbed backend ──

// The report copies report-embedded.spec.ts's format-2 fixture, so it parses and renders.
const report = (id: string) => ({
  format: 2, sessionId: id, generatedAt: "2026-11-01T10:00:00Z", nextSteps: ["Practise the ending"],
  content: { summary: "Clear.", strengths: [{ area: "Structure", quote: "First,", note: "Good signposting" }], developAreas: [] },
});
const turnsFor = (answer: string) => ({
  turns: [
    { role: "assistant", content: "What would you like to talk about?", phase: "intro" },
    { role: "user", content: answer, phase: "intro", answer: 1 },
  ],
});
const session = (id: string, startedAt: string) =>
  ({ id, interviewerId: "tell-a-story", interviewerName: "Story listener", startedAt, endedAt: startedAt, turnCount: 2, hasReport: true });

async function stub(page: Page, turns: (id: string) => object | null): Promise<void> {
  const sessions = [session("s-one", "2026-11-02T09:00:00Z"), session("s-two", "2026-11-01T09:00:00Z")];
  await page.route("**/api/sessions", (route) => route.fulfill({ json: { sessions } }));
  for (const id of ["s-one", "s-two"]) {
    await page.route(`**/api/session/${id}/report`, (route) => route.fulfill({ json: report(id) }));
    await page.route(`**/report/${id}`, (route) =>
      // Only the backend call, not the page navigation to /report/<id> on port 3000.
      new URL(route.request().url()).port === "3001" ? route.fulfill({ json: report(id) }) : route.fallback(),
    );
    await page.route(`**/api/session/${id}/turns`, (route) => {
      const body = turns(id);
      return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404, json: { error: "not found" } });
    });
  }
}

const sessionButton = (page: Page, nth: number) =>
  page.getByRole("button").filter({ hasText: "Story listener" }).nth(nth);

test("if the transcript cannot be loaded, the report is unchanged and the tab offers the download", async ({ page }) => {
  await stub(page, () => null);
  await page.goto("/report/s-one");
  await expect(page.getByText("Good signposting")).toBeVisible({ timeout: 10_000 });

  await transcriptTab(page).click();
  await expect(downloadLink(page)).toBeVisible();
  await expect(page.getByRole("tabpanel").getByText(/Answer 1/)).toHaveCount(0);
});

test("in the Dashboard, switching sessions shows each session's own turns", async ({ page }) => {
  await stub(page, (id) => turnsFor(id === "s-one" ? "first session answer" : "second session answer"));
  await page.goto("/dashboard");

  // The Dashboard selects the newest session (s-one) first.
  await transcriptTab(page).click();
  await expect(page.getByRole("tabpanel").getByText("first session answer")).toBeVisible({ timeout: 20_000 });

  await sessionButton(page, 1).click();
  await transcriptTab(page).click();
  await expect(page.getByRole("tabpanel").getByText("second session answer")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("tabpanel").getByText("first session answer")).toHaveCount(0);
});
