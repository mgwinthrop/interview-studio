import { expect, test, type Page, type Route } from "@playwright/test";

// FQ-41 (#41): voice detection loads its ONNX Runtime from the app, works on a network that
// blocks every third-party host, and never fails silently.
//
// These tests let the page start audio without a click (the autoplay flag), because voice
// detection only starts after the audio context resumes. The smoke tests do not, so they never
// load it. test.use replaces the config's launch args, so the fake-device flags are repeated.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

const UNAVAILABLE = "We can't hear you in this browser.";
const LOCAL = new Set(["localhost:3000", "localhost:3001", "127.0.0.1:3000", "127.0.0.1:3001"]);

/** Blocks every request that leaves the machine, as a filtering network would, and records it. */
async function blockThirdParty(page: Page): Promise<string[]> {
  const blocked: string[] = [];
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol.startsWith("http") && !LOCAL.has(url.host)) {
      blocked.push(url.href);
      return route.abort("blockedbyclient");
    }
    return route.fallback();
  });
  return blocked;
}

/** Opens a session the way a passed mic check does (the gesture flag), unless told not to. */
async function openSession(page: Page, { gesture = true } = {}): Promise<void> {
  await page.goto("/mic-check");
  if (gesture) await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
  await page.goto("/session?interviewerId=tell-a-story&demo=true");
}

const panel = (page: Page) => page.locator(".interviewer-panel");

test.describe("voice detection loading", () => {
  test("loads from the app and starts listening with every third-party host blocked", async ({ page }) => {
    const blocked = await blockThirdParty(page);
    const runtime = new Map<string, { status: number; type?: string; coep?: string }>();
    page.on("response", (r) => {
      const { pathname, host } = new URL(r.url());
      if (/^\/ort-wasm-simd-threaded\.(mjs|wasm)$/.test(pathname) && LOCAL.has(host)) {
        const h = r.headers();
        runtime.set(pathname, { status: r.status(), type: h["content-type"], coep: h["cross-origin-embedder-policy"] });
      }
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await openSession(page);

    // "ready" is set only after vad.start() resolves, which loads the audio worklet; worklet
    // fetches are not visible to Playwright's network events, so this is the proof it loaded.
    await expect(panel(page)).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
    await expect(panel(page).getByRole("status")).toHaveText("Listening");
    expect(runtime.get("/ort-wasm-simd-threaded.mjs")).toMatchObject({ status: 200, coep: "require-corp" });
    expect(runtime.get("/ort-wasm-simd-threaded.mjs")?.type).toMatch(/javascript/);
    expect(runtime.get("/ort-wasm-simd-threaded.wasm")).toMatchObject({ status: 200 });
    expect(blocked).toEqual([]);
    expect(errors).toEqual([]);
    await expect(page.getByText(UNAVAILABLE)).toHaveCount(0);
  });

  test("says it cannot hear you, and opens typing, when the runtime fails to load", async ({ page }) => {
    await blockThirdParty(page);
    await page.route("**/ort-wasm-simd-threaded.wasm", (route) => route.fulfill({ status: 404, body: "" }));
    const started = Date.now();
    await openSession(page);

    await expect(page.getByText(UNAVAILABLE)).toBeVisible({ timeout: 11_000 });
    expect(Date.now() - started).toBeLessThan(15_000);
    await expect(panel(page)).toHaveAttribute("data-hearing", "failed");
    await expect(panel(page).getByRole("status")).toHaveText("Can't hear you");
    await expect(page.getByLabel("Type your message")).toBeVisible();
  });

  test("says it cannot hear you after 10 s when loading hangs, and recovers when it lands", async ({ page }) => {
    await blockThirdParty(page);
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    await page.route("**/ort-wasm-simd-threaded.wasm", async (route: Route) => {
      await held;
      await route.fallback();
    });
    await openSession(page);

    await expect(panel(page).getByRole("status")).toHaveText("Getting ready…");
    await expect(page.getByText(UNAVAILABLE)).toBeVisible({ timeout: 12_000 });
    await expect(panel(page).getByRole("status")).toHaveText("Can't hear you");

    release();
    await expect(panel(page)).toHaveAttribute("data-hearing", "ready", { timeout: 20_000 });
    await expect(page.getByText(UNAVAILABLE)).toHaveCount(0);
    await expect(panel(page).getByRole("status")).toHaveText("Listening");
  });

  test("never shows Listening when hearing was not started (no gesture, e.g. after a reload)", async ({ page }) => {
    await blockThirdParty(page);
    await openSession(page, { gesture: false });

    await expect(panel(page).getByRole("status")).not.toHaveText("Listening");
    await expect(page.getByText(UNAVAILABLE)).toBeVisible({ timeout: 12_000 });
    await expect(panel(page)).toHaveAttribute("data-hearing", "off");
  });
});
