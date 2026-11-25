import { expect, test, type Page } from "@playwright/test";

// FQ-50 S2 (#153): a strength quote whose words appear in exactly one answer links to it, and
// the link lands on that answer, highlighted and focused. A quote that matches nothing has no
// link. The backend is stubbed with page.route (as report-embedded.spec.ts does): the mock
// profile's report quote cannot match, and changing it would touch load-bearing providers/**
// (owner decision, FQ-50 gate 3 D1).

const ID = "e2e-quotes-1";
const report = {
  format: 2,
  sessionId: ID,
  generatedAt: "2026-11-01T10:00:00Z",
  nextSteps: ["Practise the ending"],
  content: {
    summary: "Clear.",
    strengths: [
      { area: "Framing", quote: "I'd start by asking who the customer is", note: "Starts from the user" },
      { area: "Pilots", quote: "something like a pilot with two teams", note: "Paraphrased by the model" },
    ],
    developAreas: [],
  },
};
const turns = {
  turns: [
    { role: "assistant", content: "What would you like to talk about?", phase: "intro" },
    { role: "user", content: "A product nobody is using.", phase: "intro", answer: 1 },
    { role: "assistant", content: "How would you approach it?", phase: "intro" },
    { role: "user", content: "I'd start by asking who the customer is, then talk to the five who signed up.", phase: "intro", answer: 2 },
  ],
};

async function stub(page: Page, body: object = report): Promise<void> {
  await page.route(`**/report/${ID}`, (route) =>
    // Only the backend call, not the page navigation to /report/<id> on port 3000.
    new URL(route.request().url()).port === "3001" ? route.fulfill({ json: body }) : route.fallback(),
  );
  await page.route(`**/api/session/${ID}/turns`, (route) => route.fulfill({ json: turns }));
}

test("a traced quote links to its answer; an untraceable quote has no link", async ({ page }) => {
  await stub(page);
  await page.goto(`/report/${ID}`);

  const framing = page.getByRole("listitem").filter({ hasText: "Framing" });
  const pilots = page.getByRole("listitem").filter({ hasText: "Pilots" });
  await expect(framing.getByRole("button", { name: "See answer 2" })).toBeVisible({ timeout: 20_000 });
  await expect(pilots.getByRole("button")).toHaveCount(0);

  await framing.getByRole("button", { name: "See answer 2" }).click();
  await expect(page.getByRole("tab", { name: "Transcript" })).toHaveAttribute("aria-selected", "true");
  const answer = page.locator("#answer-2");
  await expect(answer).toBeFocused();
  await expect(answer).toHaveAttribute("aria-current", "true");
  await expect(answer).toContainText("I'd start by asking who the customer is");
});

test("an older (format 1) report shows no quote links", async ({ page }) => {
  // Format 1 has evidence, not quotes (the v1 fixture in report-embedded.spec.ts), even when a
  // line of it appears in an answer.
  await stub(page, {
    sessionId: ID,
    summary: "You framed it well.",
    strengths: [{ area: "Framing", evidence: "I'd start by asking who the customer is" }],
    improvements: [{ area: "Pace", suggestion: "Slow down" }],
    highlights: ["Strong opening"],
    overallAssessment: "Good",
    generatedAt: "2026-11-01T10:00:00Z",
  });
  await page.goto(`/report/${ID}`);
  await expect(page.getByText("You framed it well.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /See answer/ })).toHaveCount(0);
});
