import { expect, test, type Page } from "@playwright/test";

// FQ-56 (#56): the main navigation holds the user pages only. Usage and Settings are operator
// tools and sit behind a gear button that opens a disclosure (a plain list of links, not an
// ARIA menu). The default viewport is desktop width, where the navigation links are shown.

const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const gear = (page: Page) => mainNav(page).getByRole("button", { name: "Usage and settings" });

test.describe("main navigation", () => {
  test("shows Home, Interviewers and Dashboard, then the gear", async ({ page }) => {
    await page.goto("/dashboard");
    const links = mainNav(page).locator(".nav-links-group").getByRole("link");
    await expect(links).toHaveText(["Home", "Interviewers", "Dashboard"]);
    await expect(mainNav(page).getByRole("link", { name: "Usage" })).toHaveCount(0);
    await expect(mainNav(page).getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(gear(page)).toBeVisible();
    await expect(gear(page)).toHaveAttribute("aria-expanded", "false");
    await expect(mainNav(page).getByRole("menu")).toHaveCount(0);
  });

  test("the gear opens a disclosure; Escape closes it and returns focus", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(gear(page)).toBeVisible();
    await gear(page).click();
    await expect(gear(page)).toHaveAttribute("aria-expanded", "true");
    const panelId = await gear(page).getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = page.locator(`[id="${panelId}"]`);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("link")).toHaveText(["Usage", "Settings"]);

    await panel.getByRole("link", { name: "Usage" }).focus();
    await page.keyboard.press("Escape");
    await expect(gear(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await expect(gear(page)).toBeFocused();
  });

  test("an outside click closes the disclosure", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(gear(page)).toBeVisible();
    await gear(page).click();
    await expect(gear(page)).toHaveAttribute("aria-expanded", "true");
    await page.locator("body").click({ position: { x: 5, y: 400 } });
    await expect(gear(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("navigates to Usage from the disclosure", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(gear(page)).toBeVisible();
    await gear(page).click();
    await mainNav(page).getByRole("link", { name: "Usage" }).click();
    await expect(page).toHaveURL(/\/usage$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/usage/i);
  });

  test("/usage and /settings still load directly", async ({ page }) => {
    for (const path of ["/usage", "/settings"]) {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });
});
