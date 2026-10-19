import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { DESIGNER_ID } from "../interviewer/presets";
import { INTERVIEWER_LIMITS, parseInterviewerInput, type InterviewerDefinition, type InterviewerInput } from "../interviewer/schema";
import type { Providers } from "../providers/types";
import {
  Client,
  INTERVIEWER,
  Running,
  UUID_RE,
  allLogText,
  connect,
  createdCustom,
  makeConfig,
  mockMod,
  persistence,
  phaseChanges,
  prisma,
  registry,
  start,
  store,
  structuredWith,
  textTurn,
  setupServerTestEnv,
} from "./helpers/server";

setupServerTestEnv();

describe("POST /api/interviewers/draft", () => {
  const DRAFT_SENTINEL = "quagga-lighthouse-draft";
  const DESCRIPTION = `${DRAFT_SENTINEL} an interviewer that helps me rehearse a hard conversation with my manager.`;
  const VALID_DRAFT = {
    name: "Hard conversation",
    purpose: "Rehearse a difficult talk with a manager.",
    persona: "You are a calm, direct coach.",
    style: "You ask one short question at a time.",
    opening: "Greet the person and ask what they need to say.",
    closing: "Thank them and say the reflection will follow.",
    phases: [
      { name: "Set up", instruction: "Ask what the talk is about.", minTurns: 1, maxTurns: 2 },
      { name: "Practise", instruction: "Ask them to say it out loud.", minTurns: 2, maxTurns: 4 },
      { name: "Wrap up", instruction: "Ask what they will do next." },
    ],
    focus: ["How clearly they say the hard part"],
    contentFeedback: true,
    deliveryFeedback: true,
  };

  function draft(r: Running, description: unknown = DESCRIPTION): Promise<Response> {
    return fetch(`${r.base}/api/interviewers/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
  }

  async function ownedCount(): Promise<number> {
    return prisma.interviewer.count({ where: { ownerId: "local" } });
  }

  it("returns a draft that POST /api/interviewers then accepts, and the draft call writes nothing", async () => {
    const r = await start({ script: { structured: VALID_DRAFT } });
    const before = await prisma.interviewer.count();
    const res = await draft(r);
    expect(res.status).toBe(200);
    const { draft: body } = (await res.json()) as { draft: Record<string, unknown> };
    expect(await prisma.interviewer.count()).toBe(before);

    const saved = await fetch(`${r.base}/api/interviewers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(saved.status).toBe(201);
    const created = (await saved.json()) as InterviewerDefinition;
    createdCustom.push(created.id);
    for (const [k, v] of Object.entries(body)) expect(created[k as keyof InterviewerDefinition]).toEqual(v);
  });

  it("a second concurrent draft gets 429 while the first is in flight, then the lock is released", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    let n = 0;
    const r = await start({
      customize: (p) => {
        p.llm.structured = (async (req: Parameters<Providers["llm"]["structured"]>[0]) => {
          n += 1;
          if (n === 1) await gate;
          return req.schema.parse(VALID_DRAFT);
        }) as Providers["llm"]["structured"];
      },
    });
    const first = draft(r);
    await vi.waitFor(() => expect(n).toBe(1));
    const second = await draft(r);
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: "a draft is already being made" });
    release();
    expect((await first).status).toBe(200);
    expect((await draft(r)).status).toBe(200);
  });

  it("a failing LLM is 502 with a fixed body, releases the lock, and logs no text", async () => {
    let failing = true;
    const { customize } = structuredWith(async (_n, req) => {
      if (failing) throw new Error(`${DRAFT_SENTINEL} provider error text`);
      return req.schema.parse(VALID_DRAFT);
    });
    const r = await start({ customize });
    const res = await draft(r);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Draft generation failed" });
    failing = false;
    expect((await draft(r)).status).toBe(200);
    expect(allLogText()).not.toContain(DRAFT_SENTINEL);
  });

  it("too short a description is 422 without calling the LLM or taking the lock", async () => {
    const { calls, customize } = structuredWith(async (_n, req) => req.schema.parse(VALID_DRAFT));
    const r = await start({ customize });
    const res = await draft(r, "hi");
    expect(res.status).toBe(422);
    expect(calls.n).toBe(0);
    expect((await draft(r)).status).toBe(200);
    expect(calls.n).toBe(1);
  });

  it("a hung LLM is cut at the deadline", async () => {
    const hung = structuredWith(() => new Promise<never>(() => {}));
    const r2 = await start({ config: makeConfig({}, { limits: { reportTimeoutMs: 150 } }), customize: hung.customize });
    const res = await draft(r2);
    expect(res.status).toBe(502);
    expect((await draft(r2)).status).toBe(502);
  });

  it("an invalid description is 422 and nothing is echoed", async () => {
    const r = await start({ script: { structured: VALID_DRAFT } });
    const res = await draft(r, "   ");
    expect(res.status).toBe(422);
    expect(await ownedCount()).toBe(0);
  });

  it("is refused without the shared token in token mode", async () => {
    const r = await start({ config: makeConfig({ AUTH_TOKEN: "secret-token-value-123456" }) });
    const res = await draft(r);
    expect(res.status).toBe(401);
  });
});


describe("createDraftMaker", () => {
  it("locks per owner: the same owner is 429, another owner is not blocked", async () => {
    const { createDraftMaker } = await import("../app");
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    let n = 0;
    const providers = mockMod.createMockProviders({ structured: {} });
    providers.llm.structured = (async (req: Parameters<Providers["llm"]["structured"]>[0]) => {
      n += 1;
      if (n === 1) await gate;
      return req.schema.parse({
        name: "N",
        purpose: "P",
        persona: "You are calm.",
        style: "Short questions.",
        opening: "Greet them.",
        closing: "Thank them.",
        phases: [
          { name: "One", instruction: "Ask.", minTurns: 1, maxTurns: 2 },
          { name: "Two", instruction: "Ask more." },
        ],
        focus: [],
        contentFeedback: true,
        deliveryFeedback: true,
      });
    }) as Providers["llm"]["structured"];
    const make = createDraftMaker(makeConfig(), providers.llm);
    const text = "an interviewer that helps me rehearse a hard conversation";
    const a1 = make("owner-a", text);
    await vi.waitFor(() => expect(n).toBe(1));
    expect(await make("owner-a", text)).toEqual({ ok: false, status: 429 });
    const b = await make("owner-b", text);
    expect(b.ok).toBe(true);
    release();
    expect((await a1).ok).toBe(true);
    expect((await make("owner-a", text)).ok).toBe(true);
  });
});


// ── Designer and Try it (ephemeral sessions) ─────────────────────────────────

describe("designer and trial sessions over the WebSocket", () => {
  // Sentinel text that must never reach the logs.
  const TRIAL_PERSONA = "You are okapi-trial-persona, a warm and patient listener.";
  const TRIAL_PHASES = ["okapi-trial-one", "okapi-trial-two", "okapi-trial-three"];

  /** A valid interviewer input: three phases ending after 1 and 1 more user turn in demo mode. */
  function trialDraft(): InterviewerInput {
    return {
      name: "Okapi trial name",
      purpose: "Okapi trial purpose.",
      persona: TRIAL_PERSONA,
      style: "Okapi trial style.",
      opening: "Okapi trial opening.",
      closing: "Okapi trial closing.",
      phases: [
        { name: TRIAL_PHASES[0], instruction: "Okapi trial first.", minTurns: 1, maxTurns: 3 },
        { name: TRIAL_PHASES[1], instruction: "Okapi trial second.", minTurns: 1, maxTurns: 3 },
        { name: TRIAL_PHASES[2], instruction: "Okapi trial last." },
      ],
      focus: ["Okapi trial focus"],
      contentFeedback: true,
      deliveryFeedback: false,
    };
  }

  /** What the mock model returns for the designer's draft call. */
  const DESIGNED: InterviewerInput = {
    ...trialDraft(),
    name: "Pitch coach",
    persona: "You are a calm, curious pitch coach.",
  };

  async function rowCounts() {
    return {
      sessions: await prisma.session.count(),
      turns: await prisma.conversationTurn.count(),
      reports: await prisma.report.count(),
    };
  }

  /** The real persistence module with every write spied on, so a test can assert none ran. */
  function spiedPersist() {
    const spies = {
      persistSessionCreate: vi.fn(persistence.persistSessionCreate),
      persistSessionStatus: vi.fn(persistence.persistSessionStatus),
      persistTurn: vi.fn(persistence.persistTurn),
      persistPhaseTransition: vi.fn(persistence.persistPhaseTransition),
      persistReport: vi.fn(persistence.persistReport),
    };
    return { persist: { ...persistence, ...spies }, spies };
  }

  function expectNoWrites(spies: ReturnType<typeof spiedPersist>["spies"]): void {
    for (const s of Object.values(spies)) expect(s).not.toHaveBeenCalled();
  }

  async function startWith(c: Client, fields: Record<string, unknown>): Promise<string> {
    await c.opened;
    c.send({ type: "session_start", ...fields });
    const started = await c.next((m) => m.type === "session_started");
    return started.sessionId as string;
  }

  it("a designer session: greeting, two typed turns, then draft, session_complete, close 1000; nothing is written", async () => {
    const { persist, spies } = spiedPersist();
    const r = await start({ script: { structured: DESIGNED }, persist });
    const before = await rowCounts();
    const c = connect(r);
    const id = await startWith(c, { interviewerId: DESIGNER_ID });
    expect(id).toMatch(UUID_RE);
    await c.assistantFinal();
    await textTurn(c);
    await textTurn(c);
    c.send({ type: "session_end" });
    const complete = await c.next((m) => m.type === "session_complete");
    expect(await c.closed).toEqual({ code: 1000, reason: "session complete" });
    const draftAt = c.messages.findIndex((m) => m.type === "draft");
    expect(draftAt).toBeGreaterThanOrEqual(0);
    expect(draftAt).toBeLessThan(c.messages.indexOf(complete));
    const draft = c.messages[draftAt].draft;
    expect(parseInterviewerInput(draft)).toMatchObject({ ok: true });
    expect(draft).toEqual(DESIGNED);
    expect(await rowCounts()).toEqual(before);
    expectNoWrites(spies);
    expect(registry.countForOwner("local")).toBe(0);
    expect(allLogText()).toContain(`[session ${id}] started designer`);
  });

  it("a trial session uses the draft's persona and thresholds, ends complete with no draft and stores nothing", async () => {
    const systems: string[] = [];
    const { persist, spies } = spiedPersist();
    const r = await start({
      persist,
      customize: (p) => {
        const real = p.llm.stream.bind(p.llm);
        p.llm.stream = (req, signal) => {
          systems.push(req.system);
          return real(req, signal);
        };
      },
    });
    const before = await rowCounts();
    const c = connect(r);
    const id = await startWith(c, { draft: trialDraft(), demo: true });
    await c.assistantFinal();
    expect(systems[0]).toContain(TRIAL_PERSONA);
    await textTurn(c);
    expect(await phaseChanges(c, 1)).toEqual([TRIAL_PHASES[1]]);
    await textTurn(c);
    expect(await phaseChanges(c, 2)).toEqual([TRIAL_PHASES[1], TRIAL_PHASES[2]]);
    c.send({ type: "session_end" });
    const complete = await c.next((m) => m.type === "session_complete");
    expect(complete.reportId).toBe(id);
    expect(await c.closed).toEqual({ code: 1000, reason: "session complete" });
    expect(c.messages.some((m) => m.type === "draft")).toBe(false);

    expect(await rowCounts()).toEqual(before);
    expectNoWrites(spies);
    const list = (await (await fetch(`${r.base}/api/sessions`)).json()) as { sessions: { id: string }[] };
    expect(list.sessions.map((s) => s.id)).not.toContain(id);
    expect((await fetch(`${r.base}/api/session/${id}/report`)).status).toBe(404);
    expect((await fetch(`${r.base}/api/session/${id}/transcript`)).status).toBe(404);

    const logs = allLogText();
    expect(logs).toContain(`[session ${id}] started draft interviewer (3 phases) (demo) (trial)`);
    expect(logs).not.toContain("okapi");
    expect(logs).not.toContain("Okapi");
  });

  it("a trial session with no user turn still ends complete, sends no draft and writes nothing", async () => {
    const { persist, spies } = spiedPersist();
    const r = await start({ persist });
    const before = await rowCounts();
    const c = connect(r);
    await startWith(c, { draft: trialDraft() });
    await c.assistantFinal();
    c.send({ type: "session_end" });
    await c.next((m) => m.type === "session_complete");
    expect(await c.closed).toEqual({ code: 1000, reason: "session complete" });
    expect(c.messages.some((m) => m.type === "draft")).toBe(false);
    expect(await rowCounts()).toEqual(before);
    expectNoWrites(spies);
  });

  const over = (n: number) => "x".repeat(n + 1);
  const L = INTERVIEWER_LIMITS;
  const withPhase = (i: number, patch: Record<string, unknown>) => {
    const d = trialDraft();
    return { ...d, phases: d.phases.map((p, j) => (j === i ? { ...p, ...patch } : p)) };
  };
  // [case, session_start fields]; every one closes 1008 "invalid draft".
  const BAD_DRAFTS: [string, Record<string, unknown>][] = [
    ["both interviewerId and draft", { interviewerId: INTERVIEWER, draft: trialDraft() }],
    ["the designer id and a draft", { interviewerId: DESIGNER_ID, draft: trialDraft() }],
    ["draft: []", { draft: [] }],
    ["draft: null", { draft: null }],
    ['draft: "x"', { draft: "x" }],
    ["draft: 42", { draft: 42 }],
    ["an unknown key", { draft: { ...trialDraft(), ocelotKey: "ocelot-sentinel" } }],
    ["a stored-record key (id)", { draft: { ...trialDraft(), id: "ocelot-sentinel" } }],
    ["a missing field", { draft: { ...trialDraft(), persona: undefined } }],
    ["both feedback switches off", { draft: { ...trialDraft(), contentFeedback: false, deliveryFeedback: false } }],
    ...(["name", "purpose", "persona", "style", "opening", "closing"] as const).map(
      (k): [string, Record<string, unknown>] => [`${k} over its cap`, { draft: { ...trialDraft(), [k]: over(L[k]) } }],
    ),
    ["a phase name over its cap", { draft: withPhase(0, { name: over(L.phaseName) }) }],
    ["a phase instruction over its cap", { draft: withPhase(0, { instruction: over(L.phaseInstruction) }) }],
    ["maxTurns over its cap", { draft: withPhase(0, { maxTurns: L.turns + 1 }) }],
    [
      "too many phases",
      {
        draft: {
          ...trialDraft(),
          phases: [
            ...Array.from({ length: L.phases }, (_, i) => ({ name: `p${i}`, instruction: "Ask.", minTurns: 1, maxTurns: 1 })),
            { name: "last", instruction: "Close." },
          ],
        },
      },
    ],
    ["a focus item over its cap", { draft: { ...trialDraft(), focus: [over(L.focusItem)] } }],
    ["too many focus items", { draft: { ...trialDraft(), focus: Array.from({ length: L.focusItems + 1 }, () => "f") } }],
    ["turn limits on the last phase", { draft: withPhase(2, { minTurns: 1, maxTurns: 1 }) }],
  ];

  it.each(BAD_DRAFTS)("closes 1008 'invalid draft' on %s, creates nothing and logs no draft text", async (_what, body) => {
    const getInterviewer = vi.fn(store.getInterviewer);
    const r = await start({
      config: makeConfig({}, { limits: { maxConcurrentSessionsPerOwner: 1 } }),
      interviewers: { ...store, getInterviewer },
    });
    const before = await rowCounts();
    const c = connect(r);
    await c.opened;
    c.send({ type: "session_start", ...body });
    expect(await c.closed).toEqual({ code: 1008, reason: "invalid draft" });
    expect(c.messages).toHaveLength(0);
    expect(getInterviewer).not.toHaveBeenCalled();
    expect(await rowCounts()).toEqual(before);
    expect(registry.countForOwner("local")).toBe(0);
    const logs = allLogText();
    expect(logs).not.toContain("ocelot");
    expect(logs).not.toContain("Okapi");
    expect(logs).not.toContain("okapi");

    // Cap 1: a later start proves the session counter was never left taken.
    const ok = connect(r);
    await ok.startSession();
    ok.ws.close();
    await ok.closed;
  });

  it("accepts a draft at every cap (the text-frame limit leaves room for it)", async () => {
    const max = (n: number) => "y".repeat(n);
    const draft = {
      ...trialDraft(),
      name: max(L.name),
      purpose: max(L.purpose),
      persona: max(L.persona),
      style: max(L.style),
      opening: max(L.opening),
      closing: max(L.closing),
      phases: Array.from({ length: L.phases }, (_, i) => ({
        name: `${i}${max(L.phaseName - 1)}`,
        instruction: max(L.phaseInstruction),
        ...(i < L.phases - 1 ? { minTurns: 1, maxTurns: L.turns } : {}),
      })),
      focus: Array.from({ length: L.focusItems }, () => max(L.focusItem)),
    };
    expect(parseInterviewerInput(draft).ok).toBe(true);
    const r = await start();
    const c = connect(r);
    await startWith(c, { draft });
    c.ws.close();
    await c.closed;
  });

  it("the concurrent-session cap counts designer and trial sessions", async () => {
    const r = await start();
    const a = connect(r);
    const b = connect(r);
    await startWith(a, { interviewerId: DESIGNER_ID });
    await startWith(b, { draft: trialDraft() });
    expect(registry.countForOwner("local")).toBe(2);
    const c = connect(r);
    await c.opened;
    c.send({ type: "session_start", interviewerId: INTERVIEWER });
    expect(await c.closed).toEqual({ code: 1013, reason: "too many sessions" });
    a.ws.close();
    b.ws.close();
    await Promise.all([a.closed, b.closed]);
  });

  it("a designer session whose draft call fails ends session_failed, no draft, close 1000, nothing written", async () => {
    const { persist, spies } = spiedPersist();
    // Calls: 1 greeting, 2 the reply to the typed turn, 3 the draft.
    const r = await start({ script: { structured: DESIGNED, failLlmOnCall: 3 }, persist });
    const before = await rowCounts();
    const c = connect(r);
    await startWith(c, { interviewerId: DESIGNER_ID });
    await c.assistantFinal();
    await textTurn(c);
    c.send({ type: "session_end" });
    const failed = await c.next((m) => m.type === "session_failed");
    expect(failed.reason).toBe("report generation failed");
    expect(await c.closed).toEqual({ code: 1000, reason: "session failed" });
    expect(c.messages.some((m) => m.type === "draft" || m.type === "session_complete")).toBe(false);
    expect(await rowCounts()).toEqual(before);
    expectNoWrites(spies);
  });

  it.each([
    ["designer", { interviewerId: DESIGNER_ID }],
    ["trial", { draft: trialDraft() }],
  ])("closing the socket mid-%s abandons it: nothing written, the registry is empty", async (_kind, fields) => {
    const { persist, spies } = spiedPersist();
    const r = await start({ persist });
    const before = await rowCounts();
    const c = connect(r);
    const id = await startWith(c, fields);
    await c.assistantFinal();
    await textTurn(c);
    c.ws.close();
    await c.closed;
    await vi.waitFor(() => expect(allLogText()).toContain(`[session ${id}] ended abandoned`));
    expect(registry.get(id)).toBeUndefined();
    expect(registry.countForOwner("local")).toBe(0);
    expect(await rowCounts()).toEqual(before);
    expectNoWrites(spies);
  });

  it("a socket closed during the designer lookup creates nothing and writes no status", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const getInterviewer = vi.fn(async (id: string, ownerId: string) => {
      await gate;
      return store.getInterviewer(id, ownerId);
    });
    const { persist, spies } = spiedPersist();
    const r = await start({
      config: makeConfig({}, { limits: { maxConcurrentSessionsPerOwner: 1 } }),
      interviewers: { ...store, getInterviewer },
      persist,
    });
    const before = await rowCounts();
    const c = connect(r);
    await c.opened;
    c.send({ type: "session_start", interviewerId: DESIGNER_ID });
    await vi.waitFor(() => expect(getInterviewer).toHaveBeenCalledTimes(1));
    c.ws.close();
    await c.closed;
    release();
    await vi.waitFor(() => expect(allLogText()).toContain("[ws] socket closed before start: nothing created"));
    expect(c.messages).toHaveLength(0);
    expect(await rowCounts()).toEqual(before);
    expectNoWrites(spies);
    expect(registry.countForOwner("local")).toBe(0);
  });

  it("a stored interviewer still persists through the same start path", async () => {
    const { persist, spies } = spiedPersist();
    const r = await start({ persist });
    const c = connect(r);
    const id = await c.startSession();
    expect(spies.persistSessionCreate).toHaveBeenCalledTimes(1);
    expect(spies.persistSessionCreate.mock.calls[0][0]).toBe(id);
    c.ws.close();
    await c.closed;
  });
});

