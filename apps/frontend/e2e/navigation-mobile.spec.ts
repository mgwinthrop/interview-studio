import { expect, test, type Page } from "@playwright/test";

// FQ-57 (#57): below 768px the main navigation stays usable as one compact row: the logo, the
// three main links and the #56 gear, with no wordmark, no horizontal overflow and tap targets
// at least 44px tall. Measured beforehand: this row needs about 309px, so it fits 320px.
test.use({ hasTouch: true });

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const mainLinks = ["Home", "Interviewers", "Dashboard"] as const;

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
]) {
  test(`phone navigation at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/interviewers", { waitUntil: "networkidle" });

    // The three main links and the gear are visible; the wordmark gives up its room.
    for (const name of mainLinks) {
      await expect(nav(page).getByRole("link", { name, exact: true })).toBeVisible();
    }
    const gear = nav(page).getByRole("button", { name: "Usage and settings" });
    await expect(gear).toBeVisible();
    await expect(nav(page).getByText("Interview Studio", { exact: true })).toBeHidden();

    // No horizontal overflow, for the page or the bar itself.
    const overflow = await page.evaluate(() => {
      const bar = document.querySelector("nav.nav-root") as HTMLElement;
      return {
        page: document.documentElement.scrollWidth - window.innerWidth,
        bar: bar.scrollWidth - bar.clientWidth,
      };
    });
    expect(overflow.page).toBeLessThanOrEqual(0);
    expect(overflow.bar).toBeLessThanOrEqual(0);

    // Tap targets are at least 44px tall.
    for (const name of mainLinks) {
      const box = await nav(page).getByRole("link", { name, exact: true }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const gearBox = await gear.boundingBox();
    expect(gearBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(gearBox?.width ?? 0).toBeGreaterThanOrEqual(44);

    // The gear opens on a tap.
    await gear.tap();
    await expect(gear).toHaveAttribute("aria-expanded", "true");
    await expect(nav(page).getByRole("link", { name: "Usage", exact: true })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  });
}
