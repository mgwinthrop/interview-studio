import { describe, expect, it, vi } from "vitest";
import type { Providers } from "../providers/types";
import {
  LLM_REPLY,
  MEASURED,
  PRESET,
  SENTINEL_NAME,
  SENTINEL_PERSONA,
  VALID_REPORT,
  allLogText,
  createdCustom,
  customInput,
  makeConfig,
  persistence,
  prisma,
  regenerate,
  seedStored,
  start,
  statusOf,
  store,
  structuredWith,
  CUSTOM_PHASES,
  setupServerTestEnv,
} from "./helpers/server";

setupServerTestEnv();

describe("GET report: format and status", () => {
  it("returns format 2 for a new report and format 1 for a legacy row, both with interviewerName", async () => {
    const r = await start();
    await seedStored("fmt-2", "local", "active");
    await persistence.persistReport("fmt-2", {
      format: 2,
      sessionId: "fmt-2",
      generatedAt: new Date("2026-10-18T12:00:00.000Z"),
      nextSteps: ["Try one thing."],
      deliveryUnavailable: true,
    });
    await persistence.persistSessionStatus("fmt-2", "complete");

    await persistence.persistSessionCreate("fmt-1", "local", PRESET);
    await persistence.persistSessionStatus("fmt-1", "complete");
    await prisma.report.create({
      data: {
        sessionId: "fmt-1",
        summary: "An older summary.",
        strengthsJson: "[]",
        improvementsJson: "[]",
        highlightsJson: "[]",
        overallAssessment: "Fine.",
        generatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    for (const prefix of ["/api/session/", "/report/"]) {
      const v2 = await fetch(`${r.base}${prefix}fmt-2${prefix === "/report/" ? "" : "/report"}`);
      expect(v2.status).toBe(200);
      expect(await v2.json()).toEqual({
        format: 2,
        sessionId: "fmt-2",
        generatedAt: "2026-10-18T12:00:00.000Z",
        nextSteps: ["Try one thing."],
        deliveryUnavailable: true,
        interviewerName: PRESET.name,
      });
      const v1 = await fetch(`${r.base}${prefix}fmt-1${prefix === "/report/" ? "" : "/report"}`);
      expect(v1.status).toBe(200);
      expect(await v1.json()).toMatchObject({
        format: 1,
        sessionId: "fmt-1",
        summary: "An older summary.",
        generatedAt: "2026-01-01T00:00:00.000Z",
        interviewerName: PRESET.name,
      });
    }
  });

  it("returns a stored format 2 report whose delivery has no reading unchanged", async () => {
    const r = await start();
    await seedStored("fmt-nr", "local", "active");
    const summary = {
      turnsMeasured: 1,
      totalWords: 42,
      speakingTimeSec: 18.5,
      averageWordsPerMinute: 130,
      pauseCount: 2,
      longestPauseSec: 1.4,
      medianResponseGapMs: null,
      fillerCount: null,
      perTurn: [{ turn: 1, wordCount: 42, wordsPerMinute: 130, longestPauseSec: 1.4, responseGapMs: null }],
    };
    await persistence.persistReport("fmt-nr", {
      format: 2,
      sessionId: "fmt-nr",
      generatedAt: new Date("2026-10-18T12:00:00.000Z"),
      nextSteps: ["Try one thing."],
      delivery: { summary },
    });
    await persistence.persistSessionStatus("fmt-nr", "complete");
    const res = await fetch(`${r.base}/api/session/fmt-nr/report`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      format: 2,
      sessionId: "fmt-nr",
      generatedAt: "2026-10-18T12:00:00.000Z",
      nextSteps: ["Try one thing."],
      delivery: { summary },
      interviewerName: PRESET.name,
    });
  });

  it("a failed session with user turns and a snapshot has canRegenerate true", async () => {
    const r = await start();
    await seedStored("cr-yes", "local", "failed");
    for (const p of ["/api/session/cr-yes/report", "/report/cr-yes"]) {
      const res = await fetch(`${r.base}${p}`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ status: "failed", error: "Report generation failed", canRegenerate: true });
    }
  });

  it("a failed session without user turns or without a snapshot has canRegenerate false", async () => {
    const r = await start();
    await seedStored("cr-no-user", "local", "failed", { userTurns: 0 });
    await persistence.persistSessionCreate("cr-no-turns", "local", PRESET);
    await persistence.persistSessionStatus("cr-no-turns", "failed");
    await seedStored("cr-no-snap", "local", "failed", { snapshot: null });
    for (const id of ["cr-no-user", "cr-no-turns", "cr-no-snap"]) {
      const res = await fetch(`${r.base}/api/session/${id}/report`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ status: "failed", error: "Report generation failed", canRegenerate: false });
    }
  });

  it("an abandoned session's 500 carries no canRegenerate", async () => {
    const r = await start();
    await seedStored("cr-ab", "local", "abandoned");
    const res = await fetch(`${r.base}/api/session/cr-ab/report`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ status: "abandoned", error: "Report generation failed" });
  });

  it("a complete session whose report cannot be read is 500 unreadable, not failed", async () => {
    const r = await start();
    await seedStored("unread-none", "local", "complete");
    await seedStored("unread-bad", "local", "complete");
    await prisma.report.create({
      data: {
        sessionId: "unread-bad",
        reportJson: "{oops",
        summary: "",
        strengthsJson: "{oops",
        improvementsJson: "[]",
        highlightsJson: "[]",
        overallAssessment: "",
      },
    });
    for (const p of ["/api/session/unread-none/report", "/report/unread-none", "/api/session/unread-bad/report"]) {
      const res = await fetch(`${r.base}${p}`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ status: "unreadable", error: "The report could not be read" });
    }
  });
});


describe("POST /api/session/:sessionId/report/regenerate", () => {
  it("turns a failed session complete; GET then serves the new report", async () => {
    const r = await start();
    await seedStored("rg-ok", "local", "failed");
    const res = await regenerate(r, "rg-ok");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      format: 2,
      sessionId: "rg-ok",
      content: VALID_REPORT.content,
      nextSteps: VALID_REPORT.nextSteps,
      // The preset asks for delivery feedback, and typed answers are not measured.
      deliveryUnavailable: true,
      interviewerName: PRESET.name,
    });
    expect(body).not.toHaveProperty("delivery");
    expect(typeof body.generatedAt).toBe("string");
    expect(await statusOf("rg-ok")).toBe("complete");

    const got = await fetch(`${r.base}/api/session/rg-ok/report`);
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual(body);
    const legacy = await fetch(`${r.base}/report/rg-ok`);
    expect(await legacy.json()).toEqual(body);
    // Once complete it cannot be regenerated again.
    const again = await regenerate(r, "rg-ok");
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "report cannot be regenerated" });
  });

  it("uses the stored turn metrics: a measured answer yields a delivery section", async () => {
    const r = await start();
    await seedStored("rg-measured", "local", "failed", { metrics: MEASURED });
    const res = await regenerate(r, "rg-measured");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      format: 2,
      delivery: { reading: VALID_REPORT.deliveryReading, summary: { turnsMeasured: 1, averageWordsPerMinute: 140 } },
    });
    expect(body).not.toHaveProperty("deliveryUnavailable");
  });

  it("answers 404 for another owner's session with the same body as an unknown one, and changes nothing", async () => {
    const { calls, customize } = structuredWith(async (_n, req) => req.schema.parse(VALID_REPORT));
    const r = await start({ customize });
    await seedStored("rg-foreign", "someone-else", "failed");
    const foreign = await regenerate(r, "rg-foreign");
    const unknown = await regenerate(r, "no-such-session");
    const malformed = await regenerate(r, "not%20a%20valid%20id");
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(404);
    const body = await foreign.json();
    expect(body).toEqual({ error: "Session not found" });
    expect(await unknown.json()).toEqual(body);
    expect(await malformed.json()).toEqual(body);
    expect(calls.n).toBe(0);
    expect(await statusOf("rg-foreign")).toBe("failed");
    expect(await prisma.report.count({ where: { sessionId: "rg-foreign" } })).toBe(0);
  });

  it("answers 409 for complete, active and abandoned sessions without calling the model", async () => {
    const { calls, customize } = structuredWith(async (_n, req) => req.schema.parse(VALID_REPORT));
    const r = await start({ customize });
    for (const status of ["complete", "active", "abandoned"] as const) {
      const id = `rg-${status}`;
      await seedStored(id, "local", status);
      const res = await regenerate(r, id);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "report cannot be regenerated" });
      expect(await statusOf(id)).toBe(status);
    }
    expect(calls.n).toBe(0);
  });

  it("answers 409 for a failed session with no user turns or no snapshot", async () => {
    const { calls, customize } = structuredWith(async (_n, req) => req.schema.parse(VALID_REPORT));
    const r = await start({ customize });
    await seedStored("rg-no-user", "local", "failed", { userTurns: 0 });
    await persistence.persistSessionCreate("rg-no-turns", "local", PRESET);
    await persistence.persistSessionStatus("rg-no-turns", "failed");
    await seedStored("rg-no-snap", "local", "failed", { snapshot: null });
    for (const id of ["rg-no-user", "rg-no-turns", "rg-no-snap"]) {
      const res = await regenerate(r, id);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "report cannot be regenerated" });
      expect(await statusOf(id)).toBe("failed");
    }
    expect(calls.n).toBe(0);
  });

  it("two concurrent requests: exactly one 200 and one 409; the gated one completes cleanly", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { calls, customize } = structuredWith(async (_n, req) => {
      await gate;
      return req.schema.parse(VALID_REPORT);
    });
    const r = await start({ customize });
    await seedStored("rg-race", "local", "failed");
    const first = regenerate(r, "rg-race");
    await vi.waitFor(() => expect(calls.n).toBe(1));
    const second = await regenerate(r, "rg-race");
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "report cannot be regenerated" });
    expect(await statusOf("rg-race")).toBe("failed");
    release();
    const done = await first;
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ format: 2, sessionId: "rg-race" });
    expect(calls.n).toBe(1);
    expect(await statusOf("rg-race")).toBe("complete");
  });

  it("two requests sent at once: exactly one 200 and one 409", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { calls, customize } = structuredWith(async (_n, req) => {
      await gate;
      return req.schema.parse(VALID_REPORT);
    });
    const r = await start({ customize });
    await seedStored("rg-race2", "local", "failed");
    let answeredEarly = 0;
    const track = async () => {
      const res = await regenerate(r, "rg-race2");
      if (res.status === 409) answeredEarly++;
      return res;
    };
    const both = Promise.all([track(), track()]);
    await vi.waitFor(() => expect(calls.n).toBe(1));
    // The other request is answered (409) while the gate is still closed.
    await vi.waitFor(() => expect(answeredEarly).toBe(1));
    release();
    const statuses = (await both).map((res) => res.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(calls.n).toBe(1);
    expect(await statusOf("rg-race2")).toBe("complete");
  });

  it("a model failure is 502, leaves the session failed, and it can be regenerated afterwards", async () => {
    const { calls, customize } = structuredWith(async (n, req) => {
      if (n === 1) throw new Error("provider down");
      return req.schema.parse(VALID_REPORT);
    });
    const r = await start({ customize });
    await seedStored("rg-fail", "local", "failed");
    const failed = await regenerate(r, "rg-fail");
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ status: "failed", error: "Report generation failed" });
    expect(await statusOf("rg-fail")).toBe("failed");
    expect(await prisma.report.count({ where: { sessionId: "rg-fail" } })).toBe(0);
    const get = await fetch(`${r.base}/api/session/rg-fail/report`);
    expect(await get.json()).toMatchObject({ status: "failed", canRegenerate: true });

    const ok = await regenerate(r, "rg-fail");
    expect(ok.status).toBe(200);
    expect(calls.n).toBe(2);
    expect(await statusOf("rg-fail")).toBe("complete");
  });

  it("invalid model output is 502 and the session stays failed", async () => {
    const r = await start({ script: { structured: { not: "a report" } } });
    await seedStored("rg-invalid", "local", "failed");
    const res = await regenerate(r, "rg-invalid");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ status: "failed", error: "Report generation failed" });
    expect(await statusOf("rg-invalid")).toBe("failed");
  });

  it("a report call that never resolves is 502 at the deadline; the lock is released", async () => {
    const { calls, customize } = structuredWith(() => new Promise<never>(() => {}));
    const r = await start({ config: makeConfig({}, { limits: { reportTimeoutMs: 150 } }), customize });
    await seedStored("rg-hang", "local", "failed");
    const t0 = Date.now();
    const res = await regenerate(r, "rg-hang");
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ status: "failed", error: "Report generation failed" });
    expect(await statusOf("rg-hang")).toBe("failed");
    // Released: a second attempt runs the model again rather than being refused as in flight.
    const again = await regenerate(r, "rg-hang");
    expect(again.status).toBe(502);
    expect(calls.n).toBe(2);
  });

  it("aborts the report call at the deadline, and a late result does not write or change the status", async () => {
    const seen: { signal?: AbortSignal } = {};
    let releaseLate!: () => void;
    const lateGate = new Promise<void>((resolve) => (releaseLate = resolve));
    let lateDone!: () => void;
    const lateFinished = new Promise<void>((resolve) => (lateDone = resolve));
    const completeFailedSession = vi.fn(persistence.completeFailedSession);
    const r = await start({
      persist: { ...persistence, completeFailedSession },
      config: makeConfig({}, { limits: { reportTimeoutMs: 100 } }),
      customize: (p) => {
        p.llm.structured = (async (req: Parameters<Providers["llm"]["structured"]>[0], signal: AbortSignal) => {
          seen.signal = signal;
          // Ignores the abort and answers late.
          await lateGate;
          const out = req.schema.parse(VALID_REPORT);
          lateDone();
          return out;
        }) as Providers["llm"]["structured"];
      },
    });
    await seedStored("rg-late", "local", "failed");
    const res = await regenerate(r, "rg-late");
    expect(res.status).toBe(502);
    expect(seen.signal?.aborted).toBe(true);
    // The late report resolves after the deadline response. lateFinished is the deterministic
    // signal that it did; one macrotask then drains every promise continuation it triggered
    // (a write attempt would call the spied completeFailedSession synchronously within them).
    releaseLate();
    await lateFinished;
    await new Promise((resolve) => setImmediate(resolve));
    expect(completeFailedSession).not.toHaveBeenCalled();
    expect(await statusOf("rg-late")).toBe("failed");
    expect(await prisma.report.count({ where: { sessionId: "rg-late" } })).toBe(0);
  });

  it("answers 409 when the session is no longer failed by the time the report is ready", async () => {
    const { customize } = structuredWith(async (_n, req) => {
      // Something else ends the failed state meanwhile.
      await prisma.session.update({ where: { id: "rg-moved" }, data: { status: "abandoned" } });
      return req.schema.parse(VALID_REPORT);
    });
    const r = await start({ customize });
    await seedStored("rg-moved", "local", "failed");
    const res = await regenerate(r, "rg-moved");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "report cannot be regenerated" });
    expect(await statusOf("rg-moved")).toBe("abandoned");
    expect(await prisma.report.count({ where: { sessionId: "rg-moved" } })).toBe(0);
  });

  it("runs the authenticator", async () => {
    await seedStored("rg-auth", "local", "failed");
    const t = await start({ config: makeConfig({ AUTH_TOKEN: "another-token" }) });
    expect((await regenerate(t, "rg-auth")).status).toBe(401);
    const r = await start();
    const bad = await fetch(`${r.base}/api/session/rg-auth/report/regenerate`, {
      method: "POST",
      headers: { Origin: "http://evil.example" },
    });
    expect(bad.status).toBe(403);
    expect(await statusOf("rg-auth")).toBe("failed");
  });

  it("never logs transcript, interviewer or report text", async () => {
    const REPORT_SENTINEL = "wombat-sentinel-report";
    const sentinelReport = {
      ...VALID_REPORT,
      content: { ...VALID_REPORT.content, summary: `${REPORT_SENTINEL} summary.` },
      nextSteps: [`${REPORT_SENTINEL} next step.`],
    };
    const { customize } = structuredWith(async (n, req) => {
      if (n === 1) throw new Error(`${REPORT_SENTINEL} provider error text`);
      return req.schema.parse(sentinelReport);
    });
    const r = await start({ customize });
    const custom = await store.createInterviewer("local", customInput());
    createdCustom.push(custom.id);
    await seedStored("rg-logs", "local", "failed", { snapshot: custom });
    expect((await regenerate(r, "rg-logs")).status).toBe(502);
    expect((await regenerate(r, "rg-logs")).status).toBe(200);
    const logs = allLogText();
    expect(logs).toContain("rg-logs");
    for (const text of ["zebra-marmalade", LLM_REPLY, SENTINEL_NAME, SENTINEL_PERSONA, ...CUSTOM_PHASES, REPORT_SENTINEL]) {
      expect(logs).not.toContain(text);
    }
    expect(logs.toLowerCase()).not.toContain("okapi");
    expect(logs).not.toContain("wombat");
  });
});

