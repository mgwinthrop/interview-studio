import { expect, test, type Page } from "@playwright/test";

// FQ-59 (#59): the report embedded in the Dashboard (History) shows no second "Sessions"
// sidebar, because the Dashboard already lists the sessions; the standalone report page keeps
// its sidebar. Both pages fetch from the browser, so the backend is stubbed with page.route.
// The report body copies the format-2 fixture in tests/unit/report.test.ts, so it parses and
// the report renders (a wrong shape would show an error and fail the heading check).

const SESSION_ID = "e2e-embedded-1";

const report = {
  format: 2,
  sessionId: SESSION_ID,
  generatedAt: "2026-11-01T10:00:00Z",
  nextSteps: ["Practise the ending"],
  content: {
    summary: "Clear.",
    strengths: [{ area: "Structure", quote: "First,", note: "Good signposting" }],
    developAreas: [{ area: "Pace", suggestion: "Pause more" }],
  },
};

const sessions = {
  sessions: [
    {
      id: SESSION_ID,
      interviewerId: "tell-a-story",
      interviewerName: "Story listener",
      startedAt: "2026-11-01T09:50:00Z",
      endedAt: "2026-11-01T10:00:00Z",
      turnCount: 3,
      hasReport: true,
    },
  ],
};

// A format-1 report (the v1 fixture in tests/unit/report.test.ts). Its highlights used to appear
// only in the sidebar, so the embedded view must show them elsewhere.
const reportV1 = {
  sessionId: SESSION_ID,
  summary: "You told a clear story.",
  strengths: [{ area: "Structure", evidence: "Clear arc" }],
  improvements: [{ area: "Pace", suggestion: "Slow down" }],
  highlights: ["Strong opening"],
  overallAssessment: "Good",
  generatedAt: "2026-11-01T10:00:00Z",
};

async function stubBackend(page: Page, body: unknown = report) {
  const json = (b: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  await page.route("**/api/sessions", (route) => route.fulfill(json(sessions)));
  await page.route(`**/api/session/${SESSION_ID}/report`, (route) => route.fulfill(json(body)));
  await page.route(`**/report/${SESSION_ID}`, (route) =>
    // Only the backend call, not the page navigation to /report/<id> on port 3000.
    new URL(route.request().url()).port === "3001" ? route.fulfill(json(report)) : route.fallback(),
  );
}

const reportHeading = (page: Page) => page.getByRole("heading", { name: "Report", exact: true });

test("the report embedded in the Dashboard has no second sessions sidebar", async ({ page }) => {
  await stubBackend(page);
  await page.goto("/dashboard");
  await expect(reportHeading(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".report-sidebar")).toHaveCount(0);
});

test("an older report's highlights still show in the Dashboard without the sidebar", async ({ page }) => {
  await stubBackend(page, reportV1);
  await page.goto("/dashboard");
  await expect(reportHeading(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".report-sidebar")).toHaveCount(0);
  await expect(page.getByText("Identified outcomes")).toBeVisible();
  await expect(page.getByText("Strong opening")).toBeVisible();
});

test("the standalone report page keeps its sidebar", async ({ page }) => {
  await stubBackend(page);
  await page.goto(`/report/${SESSION_ID}`);
  await expect(reportHeading(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".report-sidebar")).toHaveCount(1);
});
