import { describe, expect, it } from "vitest";
import { makeConfig, start, setupServerTestEnv } from "./helpers/server";

setupServerTestEnv();

const CLOUD = { PROFILE: "cloud", ANTHROPIC_API_KEY: "a", ELEVENLABS_API_KEY: "e" };

async function features(env: Record<string, string>): Promise<unknown> {
  const r = await start({ config: makeConfig(env) });
  const res = await fetch(`${r.base}/api/features`);
  expect(res.status).toBe(200);
  return res.json();
}

describe("GET /api/features", () => {
  it("is off for the cloud profile with the switch off", async () => {
    expect(await features(CLOUD)).toEqual({ personaFromCalls: false });
  });
  it("is on for the cloud profile with the switch on", async () => {
    expect(await features({ ...CLOUD, CLOUD_SEND_TRANSCRIPTS: "1" })).toEqual({ personaFromCalls: true });
  });
  it("is on for the mock profile", async () => {
    expect(await features({ PROFILE: "mock" })).toEqual({ personaFromCalls: true });
  });
});
