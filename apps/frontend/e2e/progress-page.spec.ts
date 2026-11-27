import { expect, test, type Page } from "@playwright/test";

// FQ-52 S0 (#180): /progress is not linked yet, so tests open it directly. States are stubbed;
// the real-backend checks never depend on how many sessions the shared backend holds.

const NOT_ENOUGH = /Not enough yet/;
const LOAD_FAILED = "Your delivery numbers could not be loaded.";

async function stubTrend(page: Page, status: number, body: unknown) {
  await page.route("**/api/delivery/trend", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

test("with no measured sessions, /progress says there is not enough yet", async ({ page }) => {
  await stubTrend(page, 200, { showFillers: false, sessions: [] });
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "Your delivery over time" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(NOT_ENOUGH)).toBeVisible();
  await expect(page.getByText(LOAD_FAILED)).toHaveCount(0);
});

test("when the trend cannot be loaded, /progress shows a plain line and a way back", async ({ page }) => {
  await stubTrend(page, 500, { error: "Internal error" });
  await page.goto("/progress");
  await expect(page.getByText(LOAD_FAILED)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Back to the Dashboard" })).toHaveAttribute("href", "/dashboard");
  await expect(page.getByText(NOT_ENOUGH)).toHaveCount(0);
});

test("the real backend's trend route answers 200 with the expected shape", async ({ request }) => {
  const res = await request.get("http://127.0.0.1:3001/api/delivery/trend", {
    headers: { Origin: "http://localhost:3000" },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { showFillers: unknown; sessions: unknown };
  expect(typeof body.showFillers).toBe("boolean");
  expect(Array.isArray(body.sessions)).toBe(true);
});

test("the page loads against the real backend without the error line", async ({ page }) => {
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "Your delivery over time" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("progress-loaded")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(LOAD_FAILED)).toHaveCount(0);
});
