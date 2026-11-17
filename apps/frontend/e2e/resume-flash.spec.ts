import { expect, test } from "@playwright/test";

// FQ-107 (#107): an ordinary Pause and Resume more than 10 s into a session must not flash the
// "can't hear you" alert or open the typing bar. The 10 s hearing deadline from the start had
// already passed, so the Resume render briefly saw "starting" with an expired deadline.
// As in resume.spec.ts, the autoplay flag lets voice detection start without a click and
// test.use repeats the fake-device flags, so the fake microphone is running.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

const LOCAL = new Set(["localhost:3000", "localhost:3001", "127.0.0.1:3000", "127.0.0.1:3001"]);

// Counts every time the hearing alert is added to the page, so even a one-frame flash shows up.
test.beforeEach(async ({ page }) => {
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.protocol.startsWith("http") && !LOCAL.has(url.host) ? route.abort("blockedbyclient") : route.fallback();
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __alertInsertions: number };
    w.__alertInsertions = 0;
    new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (n instanceof Element && (n.matches(".session-hearing-alert") || n.querySelector(".session-hearing-alert"))) {
            w.__alertInsertions++;
          }
        });
      }
    }).observe(document, { childList: true, subtree: true });
  });
});

test("Pause and Resume more than 10 s into a session shows no microphone warning and keeps typing closed", async ({ page }) => {
  await page.goto("/mic-check");
  await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
  const panel = page.locator(".interviewer-panel");
  await expect(panel).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });

  await page.waitForTimeout(11_000); // past the 10 s hearing deadline of the first start
  await expect(page.getByLabel("Type your message")).toHaveCount(0);

  await page.getByRole("button", { name: "Pause session" }).click();
  await page.getByRole("button", { name: "Resume session" }).first().click();
  await expect(panel).toHaveAttribute("data-hearing", "ready", { timeout: 10_000 });
  await expect(panel.locator(".interviewer-status")).toHaveText("Listening");

  const insertions = await page.evaluate(() => (window as unknown as { __alertInsertions: number }).__alertInsertions);
  expect(insertions).toBe(0);
  await expect(page.getByLabel("Type your message")).toHaveCount(0);
});
