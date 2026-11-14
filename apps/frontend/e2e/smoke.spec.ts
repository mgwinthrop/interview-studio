import { expect, test, type Page } from "@playwright/test";

// Console messages the app is allowed to produce. Anything else at error level fails a test.
const ALLOWED_ERRORS: RegExp[] = [];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !ALLOWED_ERRORS.some((re) => re.test(m.text()))) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

const PAGES: { path: string; heading: RegExp }[] = [
  { path: "/", heading: /microphone/i },
  { path: "/avatar", heading: /face for the conversation/i },
  { path: "/dashboard", heading: /dashboard/i },
  { path: "/interviewers", heading: /interviewers/i },
  { path: "/interviewers/edit", heading: /new interviewer/i },
  { path: "/settings", heading: /settings/i },
  { path: "/usage", heading: /usage/i },
  { path: "/mic-check", heading: /microphone/i },
];

test.describe("pages", () => {
  for (const { path, heading } of PAGES) {
    test(`${path} renders with no console errors`, async ({ page }) => {
      const errors = collectErrors(page);
      const res = await page.goto(path, { waitUntil: "networkidle" });
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1, h2").first()).toHaveText(heading);
      expect(errors).toEqual([]);
    });
  }

  test("an unknown report shows a message instead of crashing", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/report/does-not-exist", { waitUntil: "networkidle" });
    await expect(page.locator("main, body")).not.toBeEmpty();
    expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
  });

  test("lists the four preset interviewers from the backend", async ({ page, request }) => {
    const res = await request.get("http://127.0.0.1:3001/api/interviewers", { headers: { Origin: "http://localhost:3000" } });
    expect(res.status()).toBe(200);
    const presets = (await res.json()).filter((i: { source: string }) => i.source === "preset");
    expect(presets).toHaveLength(4);
    await page.goto("/interviewers", { waitUntil: "networkidle" });
    for (const p of presets) await expect(page.getByText(p.name, { exact: true }).first()).toBeVisible();
  });
});

test.describe("what the voice session depends on", () => {
  test("sets the cross-origin isolation headers on /session", async ({ request }) => {
    const res = await request.get("/session");
    expect(res.headers()["cross-origin-opener-policy"]).toBe("same-origin");
    expect(res.headers()["cross-origin-embedder-policy"]).toBe("require-corp");
  });

  for (const asset of ["vad.worklet.bundle.min.js", "silero_vad_v5.onnx", "silero_vad_legacy.onnx", "ort-wasm-simd-threaded.wasm"]) {
    test(`serves the VAD asset ${asset}`, async ({ request }) => {
      const res = await request.get(`/${asset}`);
      expect(res.status()).toBe(200);
      expect((await res.body()).length).toBeGreaterThan(1000);
    });
  }
});

test.describe("a live mock conversation", () => {
  test("connects, streams the greeting and waits for the person", async ({ page }) => {
    const errors = collectErrors(page);
    const frames: string[] = [];
    page.on("websocket", (ws) =>
      ws.on("framereceived", (f) => {
        if (typeof f.payload === "string") frames.push(f.payload);
      }),
    );

    // Skip the mic check page the way a passed check does.
    await page.goto("/mic-check");
    await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
    await page.goto("/session?interviewerId=explain-an-idea&demo=true");

    await expect(page.getByText("This is a mock reply.").first()).toBeVisible({ timeout: 20_000 });
    // Voice detection does not start here (no autoplay flag), so the panel must not claim "Listening"
    // (FQ-41); hearing.spec.ts covers real listening. Here: the reply has finished playing.
    await expect(page.locator(".interviewer-panel")).toHaveAttribute("data-hearing", /.+/, { timeout: 20_000 });
    await expect(page.locator(".interviewer-panel").getByRole("status")).not.toHaveText("Speaking", { timeout: 20_000 });
    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);

    const types = frames.map((f) => (JSON.parse(f) as { type: string }).type);
    expect(types).toContain("session_started");
    expect(types).toContain("tts_start");
    expect(types).toContain("tts_end");

    // Ignore the autoplay warning and the mock TTS's tiny audio stub: those are warnings, not errors.
    expect(errors).toEqual([]);
  });

  test("a session for an unknown interviewer does not crash the page", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/mic-check");
    await page.evaluate(() => sessionStorage.setItem("mic_gesture_granted", "1"));
    await page.goto("/session?interviewerId=does-not-exist&demo=true");
    await expect(page.locator("body")).not.toBeEmpty();
    await page.waitForTimeout(1500);
    expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
  });
});
