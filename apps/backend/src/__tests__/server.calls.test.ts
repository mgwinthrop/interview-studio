import { describe, expect, it } from "vitest";
import { allLogText, makeConfig, start, setupServerTestEnv, type Running } from "./helpers/server";

setupServerTestEnv();

const MARKER = "zanzibar-quokka-7731";
const CLOUD_OFF = { PROFILE: "cloud", ANTHROPIC_API_KEY: "a", ELEVENLABS_API_KEY: "e" };
const TRANSCRIPT = [
  "Priya Shah   0:05",
  `Thanks for joining, this is the Northwind check-in ${MARKER}.`,
  "",
  "Marcus Webb   0:21",
  "Happy to. Call me on +44 20 7946 0958.",
  "",
].join("\n");

function post(r: Running, path: string, body: unknown): Promise<Response> {
  return fetch(`${r.base}/api/interviewers/calls/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/interviewers/calls/speakers", () => {
  it("lists speakers with line counts", async () => {
    const r = await start({ config: makeConfig(CLOUD_OFF) });
    const res = await post(r, "speakers", { transcript: TRANSCRIPT });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      speakers: [
        { name: "Priya Shah", lines: 1 },
        { name: "Marcus Webb", lines: 1 },
      ],
    });
  });

  it("answers no_speakers with a fixed 422 that does not echo the text", async () => {
    const r = await start();
    const res = await post(r, "speakers", { transcript: `just some prose ${MARKER}` });
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain(MARKER);
    const body = JSON.parse(text);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].path).toBe("transcript");
    expect(typeof body.errors[0].message).toBe("string");
  });

  it("rejects a non-string transcript, an empty one and a too-long one", async () => {
    const r = await start();
    for (const transcript of [42, "   ", "x".repeat(24_001)]) {
      const res = await post(r, "speakers", { transcript });
      expect(res.status).toBe(422);
    }
  });
});

describe("POST /api/interviewers/calls/redact", () => {
  it("redacts with the cloud-send switch off", async () => {
    const r = await start({ config: makeConfig(CLOUD_OFF) });
    const res = await post(r, "redact", { transcript: TRANSCRIPT, counterpart: "Marcus Webb", terms: ["Northwind"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; lines: { role: string }[] };
    expect(Object.keys(body).sort()).toEqual(["forbidden", "lines", "suggestions", "text"]);
    expect(body.text).not.toContain("Northwind");
    expect(body.text).not.toContain("Priya");
    expect(body.text).not.toContain("7946");
    expect(body.lines[1].role).toBe("Buyer");
  });

  it("rejects an unknown counterpart", async () => {
    const r = await start();
    const res = await post(r, "redact", { transcript: TRANSCRIPT, counterpart: "Nobody Here", terms: [] });
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain("Nobody");
    expect(JSON.parse(text).errors[0].path).toBe("counterpart");
  });

  it("accepts a counterpart that differs only by surrounding whitespace", async () => {
    const r = await start();
    const res = await post(r, "redact", { transcript: TRANSCRIPT, counterpart: "  Marcus Webb ", terms: [] });
    expect(res.status).toBe(200);
  });

  it("rejects bad terms", async () => {
    const r = await start();
    const bad: unknown[] = [
      Array.from({ length: 51 }, (_, i) => `t${i}`),
      ["x".repeat(81)],
      ["bad\u0007term"],
      [5],
      "Northwind",
    ];
    for (const terms of bad) {
      const res = await post(r, "redact", { transcript: TRANSCRIPT, counterpart: "Marcus Webb", terms });
      expect(res.status).toBe(422);
      expect(JSON.parse(await res.text()).errors[0].path).toBe("terms");
    }
    const ok = await post(r, "redact", {
      transcript: TRANSCRIPT,
      counterpart: "Marcus Webb",
      terms: Array.from({ length: 50 }, (_, i) => `t${i}`),
    });
    expect(ok.status).toBe(200);
  });

  it("answers 422 for a non-object body", async () => {
    const r = await start();
    expect((await post(r, "redact", [1])).status).toBe(422);
  });
});

describe("body handling", () => {
  it("answers 400 for invalid JSON and 413 for a huge body, without echoing", async () => {
    const r = await start();
    const bad = await post(r, "speakers", `{"transcript": "${MARKER}`);
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain(MARKER);
    const big = await post(r, "speakers", { transcript: MARKER + "y".repeat(300_000) });
    expect(big.status).toBe(413);
    expect(await big.text()).not.toContain(MARKER);
  });
});

describe("logging", () => {
  it("never logs call text across success and failure", async () => {
    const r = await start();
    await post(r, "speakers", { transcript: TRANSCRIPT });
    await post(r, "speakers", { transcript: `prose ${MARKER}` });
    await post(r, "redact", { transcript: TRANSCRIPT, counterpart: "Marcus Webb", terms: [MARKER] });
    await post(r, "redact", { transcript: TRANSCRIPT, counterpart: `${MARKER} Nobody`, terms: [] });
    await post(r, "redact", { transcript: TRANSCRIPT, counterpart: "Marcus Webb", terms: [`${MARKER}\u0007`] });
    await post(r, "speakers", `{"transcript": "${MARKER}`);
    await post(r, "speakers", { transcript: MARKER + "y".repeat(300_000) });
    expect(allLogText()).not.toContain(MARKER);
  });
});
