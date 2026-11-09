import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { Providers } from "../providers/types";
import {
  Client,
  INTERVIEWER,
  LLM_REPLY,
  PRESET,
  Running,
  SENTINEL_NAME,
  SENTINEL_PERSONA,
  STT_TEXT,
  USER_TEXT,
  VALID_REPORT,
  allLogText,
  connect,
  createdCustom,
  customInput,
  makeConfig,
  start,
  textTurn,
  CUSTOM_PHASES,
  setupServerTestEnv,
} from "./helpers/server";

import { BUILT_IN } from "../settings";
import type { SettingsService } from "../settingsService";

const env = setupServerTestEnv();

describe("full conversation", () => {
  it("session_end yields session_complete with the started id; report, transcript and list are served", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    const mark = c.messages.length;
    c.send({ type: "text_input", content: USER_TEXT });
    await c.assistantFinal(mark);
    c.send({ type: "session_end" });
    const done = await c.next((m) => m.type === "session_complete");
    expect(done.reportId).toBe(id);
    expect(c.messages.some((m) => m.type === "session_failed")).toBe(false);
    expect((await c.closed).code).toBe(1000);

    for (const p of [`/api/session/${id}/report`, `/report/${id}`]) {
      const res = await fetch(`${r.base}${p}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        format: 2,
        sessionId: id,
        content: { summary: VALID_REPORT.content.summary },
        nextSteps: VALID_REPORT.nextSteps,
        interviewerName: PRESET.name,
      });
    }

    const tr = await fetch(`${r.base}/api/session/${id}/transcript`);
    expect(tr.status).toBe(200);
    expect(tr.headers.get("content-disposition")).toContain(`transcript-${id}.txt`);
    const text = await tr.text();
    expect(text).toContain(`Participant: ${USER_TEXT}`);
    expect(text).toContain(`Interviewer: ${LLM_REPLY}`);

    // A foreign owner's complete session is never listed.
    await env.persistence.persistSessionCreate("foreign-complete", "someone-else", PRESET);
    await env.persistence.persistSessionStatus("foreign-complete", "complete");

    const list = await fetch(`${r.base}/api/sessions`);
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      sessions: Record<string, unknown>[];
      stats: Record<string, number>;
    };
    expect(body.sessions.map((s) => s.id)).not.toContain("foreign-complete");
    const mine = body.sessions.find((s) => s.id === id);
    expect(mine).toMatchObject({
      id,
      interviewerId: INTERVIEWER,
      interviewerName: PRESET.name,
      turnCount: 3,
      hasReport: true,
    });
    expect(mine).not.toHaveProperty("topicId");
    expect(Object.keys(mine!).sort()).toEqual(
      [
        "durationMinutes",
        "endedAt",
        "hasReport",
        "id",
        "interviewerId",
        "interviewerName",
        "startedAt",
        "turnCount",
      ].sort(),
    );
    expect(typeof mine!.startedAt).toBe("string");
    expect(typeof mine!.endedAt).toBe("string");
    expect(body.stats).toEqual({
      totalSessions: body.sessions.length,
      personasUsed: expect.any(Number),
      avgDurationMinutes: expect.any(Number),
    });
  });

  it("a failed report produces session_failed and a 500 report", async () => {
    const r = await start({ script: { structured: { not: "a report" } } });
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    const mark = c.messages.length;
    c.send({ type: "text_input", content: USER_TEXT });
    await c.assistantFinal(mark);
    c.send({ type: "session_end" });
    const failed = await c.next((m) => m.type === "session_failed");
    expect(typeof failed.reason).toBe("string");
    expect(failed.reason).not.toContain(USER_TEXT);
    expect(c.messages.some((m) => m.type === "session_complete")).toBe(false);
    expect((await c.closed).code).toBe(1000);

    const res = await fetch(`${r.base}/api/session/${id}/report`);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ status: "failed" });
  });

  it("closing the socket without session_end leaves the session abandoned and unlisted", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    c.ws.close();
    await c.closed;
    await vi.waitFor(async () => {
      expect((await env.prisma.session.findUnique({ where: { id } }))?.status).toBe("abandoned");
    });
    const res = await fetch(`${r.base}/api/session/${id}/report`);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ status: "abandoned" });
    const list = (await (await fetch(`${r.base}/api/sessions`)).json()) as { sessions: { id: string }[] };
    expect(list.sessions.map((s) => s.id)).not.toContain(id);
  });

  it("closing the socket after session_end still completes the report", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    const mark = c.messages.length;
    c.send({ type: "text_input", content: USER_TEXT });
    await c.assistantFinal(mark);
    c.send({ type: "session_end" });
    c.ws.close();
    await c.closed;
    await vi.waitFor(async () => {
      expect((await env.prisma.session.findUnique({ where: { id } }))?.status).toBe("complete");
    });
    expect((await fetch(`${r.base}/api/session/${id}/report`)).status).toBe(200);
  });
});


describe("end-of-session deadline", () => {
  const hangReport = (p: Providers) => {
    p.llm.structured = () => new Promise<never>(() => {});
  };

  async function endAfterOneTurn(c: Client): Promise<string> {
    const id = await c.startSession();
    await c.assistantFinal();
    const mark = c.messages.length;
    c.send({ type: "text_input", content: USER_TEXT });
    await c.assistantFinal(mark);
    c.send({ type: "session_end" });
    return id;
  }

  it("a report that never resolves yields session_failed at the deadline and frees the slot", async () => {
    const r = await start({
      config: makeConfig({}, { limits: { reportTimeoutMs: 150, maxConcurrentSessionsPerOwner: 1 } }),
      customize: hangReport,
    });
    const c = connect(r);
    const id = await endAfterOneTurn(c);
    const failed = await c.next((m) => m.type === "session_failed");
    expect(failed.reason).toBe("report generation failed");
    expect((await c.closed).code).toBe(1000);
    expect((await env.prisma.session.findUnique({ where: { id } }))?.status).toBe("failed");
    expect(env.registry.countForOwner("local")).toBe(0);

    const next = connect(r);
    const nextId = await next.startSession();
    expect(nextId).not.toBe(id);
    next.ws.close();
    await next.closed;
  });

  it("session_end then an immediate disconnect still ends failed at the deadline and frees the slot", async () => {
    const r = await start({
      config: makeConfig({}, { limits: { reportTimeoutMs: 150 } }),
      customize: hangReport,
    });
    const c = connect(r);
    const id = await endAfterOneTurn(c);
    c.ws.close();
    await c.closed;
    await vi.waitFor(
      async () => {
        expect((await env.prisma.session.findUnique({ where: { id } }))?.status).toBe("failed");
        expect(env.registry.countForOwner("local")).toBe(0);
      },
      { timeout: 3000 },
    );

    const fresh = Array.from({ length: makeConfig().limits.maxConcurrentSessionsPerOwner }, () => connect(r));
    const ids = await Promise.all(fresh.map((f) => f.startSession()));
    expect(new Set(ids).size).toBe(fresh.length);
    for (const f of fresh) f.ws.close();
    await Promise.all(fresh.map((f) => f.closed));
  });
});


describe("logging", () => {
  async function converse(r: Running, interviewerId = INTERVIEWER): Promise<void> {
    const c = connect(r);
    await c.startSession({ interviewerId });
    await c.assistantFinal();
    let mark = c.messages.length;
    c.send({ type: "text_input", content: USER_TEXT });
    await c.assistantFinal(mark);
    mark = c.messages.length;
    c.ws.send(Buffer.alloc(3200));
    await c.next((m) => m.type === "transcript" && m.role === "user" && m.text === STT_TEXT, mark);
    await c.assistantFinal(mark);
    c.send({ type: "interrupt" });
    c.send({ type: "session_end" });
    await c.next((m) => m.type === "session_complete");
    await c.closed;
  }

  it("never logs conversation text during a full mock conversation", async () => {
    const r = await start();
    await converse(r);
    const logs = allLogText();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).not.toContain("zebra-marmalade");
    expect(logs).not.toContain("quokka-lantern");
    expect(logs).not.toContain("Could you tell me a little more");
  });

  it("never logs interviewer text during a whole conversation with a custom interviewer", async () => {
    const r = await start();
    const custom = await env.store.createInterviewer("local", customInput());
    createdCustom.push(custom.id);
    await converse(r, custom.id);
    const logs = allLogText();
    expect(logs).toContain(custom.id);
    for (const text of [SENTINEL_NAME, SENTINEL_PERSONA, ...CUSTOM_PHASES]) expect(logs).not.toContain(text);
    expect(logs.toLowerCase()).not.toContain("okapi");
  });

  it("logs conversation text only when debugLogText is true", async () => {
    const r = await start({ config: makeConfig({}, { debugLogText: true }) });
    await converse(r);
    expect(allLogText()).toContain("zebra-marmalade");
  });
});


describe("turn_timing", () => {
  const GAP = 4321;

  /** The stored user turns of a session, once `count` of them have landed. */
  async function storedUserTurns(sessionId: string, count: number) {
    let users: import("../types").ConversationTurn[] = [];
    await vi.waitFor(async () => {
      const turns = (await env.persistence.readTurnsFromDb(sessionId, "local")) ?? [];
      users = turns.filter((t) => t.role === "user");
      expect(users).toHaveLength(count);
    });
    return users;
  }

  /** Sends one audio utterance and waits for its reply to finish. */
  async function audioTurn(c: Client): Promise<void> {
    const mark = c.messages.length;
    c.ws.send(Buffer.alloc(3200));
    await c.next((m) => m.type === "transcript" && m.role === "user", mark);
    await c.assistantFinal(mark);
  }

  it("closes 1008 on turn_timing before session_start", async () => {
    const r = await start();
    const c = connect(r);
    await c.opened;
    c.send({ type: "turn_timing", responseGapMs: GAP });
    const closed = await c.closed;
    expect(closed.code).toBe(1008);
    expect(closed.reason).toBe("session_start required");
    expect(allLogText()).toContain("message turn_timing before session_start");
  });

  it("a valid turn_timing before an audio frame is stored as the turn's responseGapMs", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    c.send({ type: "turn_timing", responseGapMs: GAP });
    await audioTurn(c);
    const [turn] = await storedUserTurns(id, 1);
    expect(turn.content).toBe(STT_TEXT);
    expect(turn.metrics).toMatchObject({ responseGapMs: GAP, wordCount: STT_TEXT.split(" ").length });
    c.ws.close();
    await c.closed;
  });

  it("an invalid turn_timing is ignored without closing the socket", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    for (const responseGapMs of [-5, "12", 1e9, null, { ms: 1 }]) c.send({ type: "turn_timing", responseGapMs });
    c.send({ type: "turn_timing" });
    await audioTurn(c);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    const [turn] = await storedUserTurns(id, 1);
    expect(turn.metrics).toMatchObject({ responseGapMs: null });
    expect(allLogText()).not.toContain("ignored message type");
    c.ws.close();
    await c.closed;
  });

  it("a text turn stores no metrics and does not take a pending gap", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    c.send({ type: "turn_timing", responseGapMs: GAP });
    await textTurn(c);
    c.send({ type: "interrupt" });
    await audioTurn(c);
    const turns = await storedUserTurns(id, 2);
    // Found by content: turns stored in the same millisecond have no defined order.
    const typed = turns.find((t) => t.content === USER_TEXT);
    const spoken = turns.find((t) => t.content === STT_TEXT);
    expect(typed).toBeDefined();
    expect(typed!.metrics ?? null).toBeNull();
    // The interrupt discarded the pending gap.
    expect(spoken?.metrics).toMatchObject({ responseGapMs: null });
    c.ws.close();
    await c.closed;
  });

  it("a gap and a spoken answer reach the saved report's delivery summary; the typed answer adds nothing", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    c.send({ type: "turn_timing", responseGapMs: 2468 });
    await audioTurn(c);
    await textTurn(c);
    c.send({ type: "session_end" });
    await c.next((m) => m.type === "session_complete");
    await c.closed;
    const res = await fetch(`${r.base}/api/session/${id}/report`);
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.format).toBe(2);
    const summary = body.delivery.summary;
    expect(summary.turnsMeasured).toBe(1);
    expect(summary.perTurn).toHaveLength(1);
    expect(summary.perTurn[0]).toMatchObject({ turn: 1, responseGapMs: 2468 });
    expect(typeof summary.speakingTimeSec).toBe("number");
    expect(typeof summary.pauseCount).toBe("number");
    expect(typeof summary.longestPauseSec).toBe("number");
  });

  it("never logs the gap value during a conversation", async () => {
    const r = await start();
    const c = connect(r);
    const id = await c.startSession();
    await c.assistantFinal();
    await textTurn(c);
    c.send({ type: "turn_timing", responseGapMs: GAP });
    await audioTurn(c);
    c.send({ type: "turn_timing", responseGapMs: GAP + 1 });
    c.send({ type: "interrupt" });
    c.send({ type: "turn_timing", responseGapMs: -GAP });
    await storedUserTurns(id, 2);
    c.ws.close();
    await c.closed;
    // Session ids are random hex and could contain the digits by chance.
    const logs = allLogText().replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).not.toContain(String(GAP));
    expect(logs).not.toContain(String(GAP + 1));
  });
});

describe("settings", () => {
  it("a WebSocket session uses the app's settings for its replies and its report", async () => {
    const streamCalls: string[] = [];
    const reportModels: (string | undefined)[] = [];
    const settings = {
      get: async () => ({ ...BUILT_IN, replyModel: "m-ws", replyMaxTokens: 77, reportModel: "r-ws" }),
    } as unknown as SettingsService;
    const r = await start({
      settings,
      customize: (p) => {
        const stream = p.llm.stream.bind(p.llm);
        p.llm.stream = (req, signal) => {
          streamCalls.push(`${req.model}/${req.maxTokens}`);
          return stream(req, signal);
        };
        const structured = p.llm.structured.bind(p.llm);
        p.llm.structured = ((req, signal) => {
          reportModels.push(req.model);
          return structured(req, signal);
        }) as Providers["llm"]["structured"];
      },
    });
    const c = connect(r);
    await c.startSession();
    await c.assistantFinal();
    await textTurn(c);
    c.send({ type: "session_end" });
    await c.next((m) => m.type === "session_complete");
    expect(streamCalls).toEqual(["m-ws/77", "m-ws/77"]);
    expect(reportModels).toEqual(["r-ws"]);
  });
});
