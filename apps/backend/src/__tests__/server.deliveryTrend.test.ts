import { describe, expect, it } from "vitest";
import { makeConfig, start, setupServerTestEnv } from "./helpers/server";

// FQ-52 S0 (#180): GET /api/delivery/trend is mounted behind the existing auth and returns
// { showFillers, sessions }. Later slices fill `sessions`, so no assertion here depends on
// its length or contents.
setupServerTestEnv();

async function trend(env: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const r = await start({ config: makeConfig(env) });
  const res = await fetch(`${r.base}/api/delivery/trend`);
  return { status: res.status, body: await res.json() };
}

describe("GET /api/delivery/trend", () => {
  it("returns 200 with showFillers off by default and a sessions array", async () => {
    const { status, body } = await trend();
    expect(status).toBe(200);
    expect(body).toMatchObject({ showFillers: false });
    expect(Array.isArray((body as { sessions: unknown }).sessions)).toBe(true);
  });

  it("reports showFillers true when REPORT_FILLER_COUNTS is on", async () => {
    const { status, body } = await trend({ REPORT_FILLER_COUNTS: "1" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ showFillers: true });
  });

  it("is refused without the token in AUTH_TOKEN mode exactly as /api/sessions is", async () => {
    const r = await start({ config: makeConfig({ AUTH_TOKEN: "trend-token" }) });
    const sessions = await fetch(`${r.base}/api/sessions`);
    const refused = await fetch(`${r.base}/api/delivery/trend`);
    expect(sessions.status).toBe(401);
    expect(refused.status).toBe(sessions.status);
    expect(await refused.json()).toEqual(await sessions.json());

    const ok = await fetch(`${r.base}/api/delivery/trend`, {
      headers: { Authorization: "Bearer trend-token" },
    });
    expect(ok.status).toBe(200);
  });
});
