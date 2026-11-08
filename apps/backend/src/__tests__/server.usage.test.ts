import { beforeEach, describe, expect, it } from "vitest";
import type { Providers } from "../providers/types";
import type { UsageMeta } from "../usage";
import { DESIGNER_ID } from "../interviewer/presets";
import { PRESET, USER_TEXT, VALID_REPORT, connect, makeConfig, setupServerTestEnv, start } from "./helpers/server";

const env = setupServerTestEnv();

const DRAFT = {
  name: "Pitch coach",
  purpose: "Practise a pitch.",
  persona: "You are a calm pitch coach.",
  style: "Short questions.",
  opening: "Say hello.",
  closing: "Say goodbye.",
  phases: [
    { name: "One", instruction: "Ask.", minTurns: 1, maxTurns: 2 },
    { name: "Two", instruction: "Ask more.", minTurns: 1, maxTurns: 2 },
    { name: "Three", instruction: "Close." },
  ],
  focus: ["Clarity"],
  contentFeedback: true,
  deliveryFeedback: false,
};

beforeEach(async () => {
  await env.prisma.llmUsage.deleteMany();
});

async function seed(over: Record<string, unknown>) {
  await env.prisma.llmUsage.create({
    data: {
      ownerId: "local",
      feature: "report",
      provider: "anthropic",
      model: "m",
      inputTokens: 100,
      outputTokens: 10,
      estimatedCostUsd: null,
      ...over,
    },
  });
}

describe("GET /api/usage/summary", () => {
  it("groups by feature for the caller's owner only", async () => {
    const r = await start();
    await seed({ feature: "conversation", sessionId: "s1", estimatedCostUsd: 0.5 });
    await seed({ feature: "conversation", sessionId: "s1" });
    await seed({ feature: "report", sessionId: "s1", estimatedCostUsd: 0.25 });
    await seed({ feature: "report", ownerId: "someone-else", estimatedCostUsd: 3 });
    await seed({ feature: "persona-draft", ownerId: "someone-else" });

    const res = await fetch(`${r.base}/api/usage/summary`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      byFeature: [
        { feature: "conversation", calls: 2, inputTokens: 200, outputTokens: 20, estimatedCostUsd: 0.5 },
        { feature: "report", calls: 1, inputTokens: 100, outputTokens: 10, estimatedCostUsd: 0.25 },
      ],
      priceTableAsOf: null,
    });
  });

  it("honours days", async () => {
    const r = await start();
    await seed({ at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) });
    const narrow = (await (await fetch(`${r.base}/api/usage/summary?days=5`)).json()) as { byFeature: unknown[] };
    expect(narrow.byFeature).toEqual([]);
    const wide = (await (await fetch(`${r.base}/api/usage/summary?days=365`)).json()) as { byFeature: unknown[] };
    expect(wide.byFeature).toHaveLength(1);
  });

  it.each(["0", "366", "-1", "1.5", "abc", "", "30x"])("days=%j is 422", async (days) => {
    const r = await start();
    const res = await fetch(`${r.base}/api/usage/summary?days=${encodeURIComponent(days)}`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { path: string; message: unknown }[] };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].path).toBe("days");
    expect(typeof body.errors[0].message).toBe("string");
  });

  it("repeated days is 422", async () => {
    const r = await start();
    const res = await fetch(`${r.base}/api/usage/summary?days=1&days=2`);
    expect(res.status).toBe(422);
  });
});

describe("GET /api/usage/session/:sessionId", () => {
  it("totals one session for the caller's owner only", async () => {
    const r = await start();
    await seed({ sessionId: "s1", estimatedCostUsd: 0.5 });
    await seed({ sessionId: "s1", feature: "conversation", estimatedCostUsd: 0.25 });
    await seed({ sessionId: "s1", ownerId: "someone-else", estimatedCostUsd: 5 });
    const res = await fetch(`${r.base}/api/usage/session/s1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ calls: 2, inputTokens: 200, outputTokens: 20, estimatedCostUsd: 0.75 });
  });

  it("a malformed id is a fixed 404", async () => {
    const r = await start();
    const res = await fetch(`${r.base}/api/usage/session/${"x".repeat(65)}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Session not found" });
  });
});

describe("session delete", () => {
  it("DELETE /api/session/:id also removes that session's usage rows", async () => {
    const r = await start();
    await env.persistence.persistSessionCreate("del-u", "local", PRESET);
    await env.persistence.persistSessionStatus("del-u", "complete");
    await seed({ sessionId: "del-u" });
    await seed({ sessionId: "keep-u" });
    const res = await fetch(`${r.base}/api/session/del-u`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(await env.prisma.llmUsage.count({ where: { sessionId: "del-u" } })).toBe(0);
    expect(await env.prisma.llmUsage.count({ where: { sessionId: "keep-u" } })).toBe(1);
  });
});

describe("call sites tag usage meta", () => {
  /** Wraps the mock LLM so each request's usage meta is recorded. */
  function recordMeta() {
    const metas: (UsageMeta | undefined)[] = [];
    const customize = (p: Providers) => {
      const { stream, structured } = p.llm;
      p.llm.stream = (req, signal) => {
        metas.push(req.usage);
        return stream.call(p.llm, req, signal);
      };
      p.llm.structured = ((req, signal) => {
        metas.push(req.usage);
        return structured.call(p.llm, req, signal);
      }) as Providers["llm"]["structured"];
    };
    return { metas, customize };
  }

  it("a conversation tags its replies 'conversation' and its report 'report', with owner and session", async () => {
    const { metas, customize } = recordMeta();
    const r = await start({ customize });
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    const mark = c.messages.length;
    c.send({ type: "text_input", content: USER_TEXT });
    await c.assistantFinal(mark);
    c.send({ type: "session_end" });
    await c.next((m) => m.type === "session_complete");
    expect(metas.length).toBeGreaterThanOrEqual(3);
    expect(metas.slice(0, -1).every((m) => m?.feature === "conversation")).toBe(true);
    for (const m of metas.slice(0, -1)) expect(m).toEqual({ feature: "conversation", ownerId: "local", sessionId: id });
    expect(metas.at(-1)).toEqual({ feature: "report", ownerId: "local", sessionId: id });
  });

  it("the description and calls draft makers tag 'designer-draft' and 'persona-draft' with the owner", async () => {
    const metas: (UsageMeta | undefined)[] = [];
    const llm: Providers["llm"] = {
      stream: async function* () {},
      async structured(req) {
        metas.push(req.usage);
        return req.schema.parse(DRAFT);
      },
    };
    const config = makeConfig();
    const one = await env.appMod.createDraftMaker(config, llm)(
      "owner-x",
      "A friendly coach who helps me practise explaining my research to a general audience.",
    );
    expect(one.ok).toBe(true);
    const two = await env.appMod.createCallsDraftMaker(config, llm)("owner-y", [
      { text: "Our side 1: Hello there.\nBuyer: Price matters most to us right now.", forbidden: ["Zorvex"] },
    ]);
    expect(two.ok).toBe(true);
    expect(metas).toEqual([
      { feature: "designer-draft", ownerId: "owner-x" },
      { feature: "persona-draft", ownerId: "owner-y" },
    ]);
  });

  it("a designer session tags its draft 'designer-draft' with the owner and no session id", async () => {
    const { metas, customize } = recordMeta();
    const r = await start({
      customize,
      script: {
        structured: { ...VALID_REPORT, ...DRAFT },
      },
    });
    const c = connect(r);
    await c.opened;
    c.send({ type: "session_start", interviewerId: DESIGNER_ID });
    await c.next((m) => m.type === "session_started");
    await c.assistantFinal();
    for (let i = 0; i < 2; i++) {
      const mark = c.messages.length;
      c.send({ type: "text_input", content: USER_TEXT });
      await c.assistantFinal(mark);
    }
    c.send({ type: "session_end" });
    await c.next((m) => m.type === "draft");
    expect(metas.at(-1)).toEqual({ feature: "designer-draft", ownerId: "local" });
  });
});
