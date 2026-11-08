import { describe, expect, it, vi } from "vitest";
import { parseInterviewerInput } from "../interviewer/schema";
import type { Providers } from "../providers/types";
import { allLogText, makeConfig, start, setupServerTestEnv, structuredWith, type Running } from "./helpers/server";

const env = setupServerTestEnv();

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
      ["line\nbreak"],
      ["line\rbreak"],
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

  it("rejects a missing or non-string counterpart", async () => {
    const r = await start();
    for (const body of [{ transcript: TRANSCRIPT, terms: [] }, { transcript: TRANSCRIPT, counterpart: 7, terms: [] }]) {
      const res = await post(r, "redact", body);
      expect(res.status).toBe(422);
      expect(JSON.parse(await res.text()).errors[0].path).toBe("counterpart");
    }
  });

  it("does not parse a body with the wrong content type", async () => {
    const r = await start();
    const res = await fetch(`${r.base}/api/interviewers/calls/redact`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ transcript: TRANSCRIPT, counterpart: "Marcus Webb", terms: [] }),
    });
    expect(res.status).toBe(422);
  });

  it("keeps the 256kb limit on redact", async () => {
    const r = await start();
    const res = await post(r, "redact", { transcript: "y".repeat(300_000), counterpart: "a", terms: [] });
    expect(res.status).toBe(413);
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

const VALID_DRAFT = {
  name: "Composite buyer",
  purpose: "Rehearse a sales call with a typical buyer.",
  persona: "You are a pragmatic buyer.",
  style: "You ask one short question at a time.",
  opening: "Greet the person and ask what they offer.",
  closing: "Thank them and say the reflection will follow.",
  phases: [
    { name: "Set up", instruction: "Ask what they offer.", minTurns: 1, maxTurns: 2 },
    { name: "Probe", instruction: "Ask about price.", minTurns: 2, maxTurns: 4 },
    { name: "Wrap up", instruction: "Ask about next steps." },
  ],
  focus: ["How clearly they explain value"],
  contentFeedback: true,
  deliveryFeedback: true,
};
const CALL = { text: `Buyer: We need a quote ${MARKER}.\nOur side 1: Sure.`, forbidden: [`Zorblax ${MARKER}`] };
const ON = { PROFILE: "mock" };
const CLOUD_ON = { PROFILE: "cloud", ANTHROPIC_API_KEY: "a", ELEVENLABS_API_KEY: "e", CLOUD_SEND_TRANSCRIPTS: "1" };
const body = (over: Record<string, unknown> = {}) => ({ calls: [CALL], confirmed: true, ...over });

function counting(impl?: (n: number) => unknown) {
  return structuredWith(async (n, req) => req.schema.parse(impl ? impl(n) : VALID_DRAFT));
}

describe("POST /api/interviewers/calls/draft", () => {
  it("is 403 with zero LLM calls when drafting from calls is off", async () => {
    const { calls, customize } = counting();
    const r = await start({ config: makeConfig(CLOUD_OFF), customize });
    for (const b of [body(), "not json", { nonsense: true }]) {
      const res = await post(r, "draft", b);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Drafting from calls is turned off." });
    }
    expect(calls.n).toBe(0);
  });

  it("is 422 with zero LLM calls without confirmed: true", async () => {
    const { calls, customize } = counting();
    const r = await start({ config: makeConfig(ON), customize });
    for (const confirmed of [undefined, false, "true", 1, null]) {
      const res = await post(r, "draft", body({ confirmed }));
      expect(res.status).toBe(422);
      expect(await res.text()).not.toContain(MARKER);
    }
    expect(calls.n).toBe(0);
  });

  it("is 422 for bad shapes and limits, without echoing input", async () => {
    const { calls, customize } = counting();
    const r = await start({ config: makeConfig(ON), customize });
    const bad: unknown[] = [
      [1],
      body({ calls: undefined }),
      body({ calls: "x" }),
      body({ calls: [] }),
      body({ calls: Array.from({ length: 9 }, () => CALL) }),
      body({ calls: [null] }),
      body({ calls: [{ text: 5, forbidden: [] }] }),
      body({ calls: [{ text: "   ", forbidden: [] }] }),
      body({ calls: [{ text: `a\u0007${MARKER}`, forbidden: [] }] }),
      body({ calls: [{ text: `a\r${MARKER}`, forbidden: [] }] }),
      body({ calls: [{ text: MARKER + "x".repeat(30_001 - MARKER.length), forbidden: [] }] }),
      body({ calls: [{ text: MARKER, forbidden: "x" }] }),
      body({ calls: [{ text: MARKER, forbidden: [MARKER, 5] }] }),
      body({ calls: [{ text: MARKER, forbidden: Array.from({ length: 501 }, (_, i) => `f${i}`) }] }),
      body({ calls: [{ text: MARKER, forbidden: ["x".repeat(121)] }] }),
    ];
    for (const b of bad) {
      const res = await post(r, "draft", b);
      expect(res.status).toBe(422);
      const text = await res.text();
      expect(text).not.toContain(MARKER);
      expect(JSON.parse(text).errors[0].path).toEqual(expect.any(String));
    }
    expect(calls.n).toBe(0);
    const ok = await post(
      r,
      "draft",
      body({ calls: [{ text: "Buyer: " + "a".repeat(29_993), forbidden: Array.from({ length: 500 }, () => "x".repeat(120)) }] }),
    );
    expect(ok.status).toBe(200);
  });

  it("returns exactly { draft } that parses, and saves nothing", async () => {
    const { calls, customize } = counting();
    const r = await start({ config: makeConfig(CLOUD_ON), customize });
    const before = await env.prisma.interviewer.count();
    const res = await post(r, "draft", body());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { draft: unknown };
    expect(Object.keys(json)).toEqual(["draft"]);
    expect(parseInterviewerInput(json.draft).ok).toBe(true);
    expect(calls.n).toBe(1);
    expect(await env.prisma.interviewer.count()).toBe(before);
  });

  it("answers a second concurrent request for the same owner with 429, then releases", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    let n = 0;
    const r = await start({
      config: makeConfig(ON),
      customize: (p) => {
        p.llm.structured = (async (req: Parameters<Providers["llm"]["structured"]>[0]) => {
          n += 1;
          if (n === 1) await gate;
          return req.schema.parse(VALID_DRAFT);
        }) as Providers["llm"]["structured"];
      },
    });
    const first = post(r, "draft", body());
    await vi.waitFor(() => expect(n).toBe(1));
    const second = await post(r, "draft", body());
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: "a draft is already being made" });
    release();
    expect((await first).status).toBe(200);
    expect((await post(r, "draft", body())).status).toBe(200);
  });

  it("is 502 with a fixed body when the model leaks a forbidden name after the retry", async () => {
    const { calls, customize } = counting(() => ({ ...VALID_DRAFT, persona: "You are Zorblax Quillfeather, a buyer." }));
    const r = await start({ config: makeConfig(ON), customize });
    const res = await post(r, "draft", body({ calls: [{ text: "Buyer: hi", forbidden: ["Zorblax", "Quillfeather"] }] }));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Draft generation failed" });
    expect(text).not.toContain("Zorblax");
    expect(calls.n).toBe(2);
  });

  it("is 502 when the provider fails, and logs no call text", async () => {
    const r = await start({
      config: makeConfig(ON),
      customize: (p) => {
        p.llm.structured = (async () => {
          throw new Error(`boom ${MARKER}`);
        }) as Providers["llm"]["structured"];
      },
    });
    expect((await post(r, "draft", body())).status).toBe(502);
    expect(allLogText()).not.toContain(MARKER);
  });

  it("never logs call text or forbidden strings across outcomes", async () => {
    const { customize } = counting();
    const r = await start({ config: makeConfig(ON), customize });
    await post(r, "draft", body());
    await post(r, "draft", body({ confirmed: false }));
    await post(r, "draft", body({ calls: [{ text: `x\u0007${MARKER}`, forbidden: [MARKER] }] }));
    await post(r, "draft", `{"calls": "${MARKER}`);
    expect(allLogText()).not.toContain(MARKER);
  });

  it("accepts a body of about 700kb here but refuses over 768kb with a fixed 413", async () => {
    const { customize } = counting();
    const r = await start({ config: makeConfig(ON), customize });
    const bigCalls = Array.from({ length: 8 }, () => ({ text: "Buyer: " + "a".repeat(29_993), forbidden: ["x".repeat(120)] }));
    const forb = Array.from({ length: 500 }, () => "y".repeat(120)); // 60kb per call
    const ok = await post(r, "draft", { calls: bigCalls.map((c) => ({ ...c, forbidden: forb })), confirmed: true });
    expect(ok.status).toBe(200);
    const huge = await post(r, "draft", { calls: [{ text: MARKER + "a".repeat(800_000), forbidden: [] }], confirmed: true });
    expect(huge.status).toBe(413);
    expect(await huge.text()).not.toContain(MARKER);
  });
});
