import { describe, expect, it } from "vitest";
import { LLM_REPLY, USER_TEXT, start, setupServerTestEnv } from "./helpers/server";
import { seedStored } from "./helpers/report";

// FQ-50 S0 (#151): GET /api/session/:sessionId/turns, the JSON transcript the report page
// renders. Owner-scoped exactly like the text download beside it.

const env = setupServerTestEnv();

describe("GET /api/session/:sessionId/turns", () => {
  it("returns the owner's turns in order, with answer numbers on user turns only", async () => {
    const r = await start();
    await seedStored(env, "turns-own", "local", "complete", { userTurns: 2 });

    const res = await fetch(`${r.base}/api/session/turns-own/turns`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({
      turns: [
        { role: "assistant", content: LLM_REPLY, phase: "intro" },
        { role: "user", content: USER_TEXT, phase: "intro", answer: 1 },
        { role: "user", content: USER_TEXT, phase: "intro", answer: 2 },
      ],
    });
  });

  it("returns 404 for an unknown session", async () => {
    const r = await start();
    const res = await fetch(`${r.base}/api/session/no-such-session/turns`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for another owner's session and does not reveal its text", async () => {
    const r = await start();
    await seedStored(env, "turns-foreign", "someone-else", "complete");
    const res = await fetch(`${r.base}/api/session/turns-foreign/turns`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(USER_TEXT);
  });

  it("leaves the text download unchanged", async () => {
    const r = await start();
    await seedStored(env, "turns-dl", "local", "complete");
    const res = await fetch(`${r.base}/api/session/turns-dl/transcript`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await res.text()).toBe(`Interviewer: ${LLM_REPLY}\n\nParticipant: ${USER_TEXT}`);
  });
});
