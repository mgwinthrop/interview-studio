import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Report } from "../types";
import type { InterviewerDefinition } from "../interviewer/schema";
import { PRESETS } from "../interviewer/presets";

const INTERVIEWER: InterviewerDefinition = PRESETS[0];
const OTHER: InterviewerDefinition = PRESETS[1];

const backendDir = path.resolve(__dirname, "../..");
let tmpDir: string;
let p: typeof import("../persistence");
let prisma: typeof import("../db").default;

function report(sessionId: string): Report {
  return {
    sessionId,
    summary: "s",
    strengths: [{ area: "a", evidence: "e" }],
    improvements: [{ area: "a", suggestion: "s" }],
    highlights: ["h"],
    overallAssessment: "ok",
    generatedAt: new Date(),
  };
}

async function seed(id: string, owner: string) {
  await p.persistSessionCreate(id, owner, INTERVIEWER);
  await p.persistTurn({
    id: `${id}-t1`,
    sessionId: id,
    role: "user",
    content: "hello",
    phase: "intro",
    timestamp: new Date(),
  });
  await p.persistReport(id, report(id));
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "persist-test-"));
  const url = `file:${path.join(tmpDir, "test.db")}`;
  process.env.DATABASE_URL = url;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  p = await import("../persistence");
  prisma = (await import("../db")).default;
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("owner scoping", () => {
  it("hides turns, report and delete from another owner", async () => {
    await seed("s-owner", "a");
    expect(await p.readTurnsFromDb("s-owner", "b")).toBeNull();
    expect(await p.readReportFromDb("s-owner", "b")).toBeNull();
    expect(await p.deleteSessionFromDb("s-owner", "b")).toBe(false);
    expect(await p.readTurnsFromDb("s-owner", "a")).toHaveLength(1);
    expect((await p.readReportFromDb("s-owner", "a"))?.report).not.toBeNull();
  });

  it("deletes turns and report for the owner", async () => {
    await seed("s-del", "a");
    expect(await p.deleteSessionFromDb("s-del", "a")).toBe(true);
    expect(await p.readTurnsFromDb("s-del", "a")).toBeNull();
    expect(await prisma.report.count({ where: { sessionId: "s-del" } })).toBe(0);
    expect(await prisma.session.count({ where: { id: "s-del" } })).toBe(0);
  });
});

describe("statuses", () => {
  it("keeps abandoned status and does not change it when a report is persisted", async () => {
    await p.persistSessionCreate("s-ab", "a", INTERVIEWER);
    await p.persistSessionStatus("s-ab", "abandoned");
    await p.persistReport("s-ab", report("s-ab"));
    const row = await prisma.session.findUnique({ where: { id: "s-ab" } });
    expect(row?.status).toBe("abandoned");
    expect(row?.endedAt).not.toBeNull();
  });

  it("lists only complete sessions for the owner", async () => {
    for (const [id, status] of [
      ["l-complete", "complete"],
      ["l-abandoned", "abandoned"],
      ["l-failed", "failed"],
    ] as const) {
      await p.persistSessionCreate(id, "lister", INTERVIEWER);
      await p.persistSessionStatus(id, status);
    }
    await p.persistSessionCreate("l-other", "someone-else", INTERVIEWER);
    await p.persistSessionStatus("l-other", "complete");
    const list = await p.listSessionsFromDb("lister");
    expect(list.map((s) => s.id)).toEqual(["l-complete"]);
  });
});

describe("status transitions", () => {
  it("leaves complete untouched on a later abandoned write", async () => {
    await p.persistSessionCreate("t-1", "a", INTERVIEWER);
    expect(await p.persistSessionStatus("t-1", "complete")).toBe(true);
    const first = await prisma.session.findUnique({ where: { id: "t-1" } });
    expect(await p.persistSessionStatus("t-1", "abandoned")).toBe(false);
    const after = await prisma.session.findUnique({ where: { id: "t-1" } });
    expect(after?.status).toBe("complete");
    expect(after?.endedAt?.getTime()).toBe(first?.endedAt?.getTime());
  });

  it("leaves failed untouched on a later complete write", async () => {
    await p.persistSessionCreate("t-2", "a", INTERVIEWER);
    expect(await p.persistSessionStatus("t-2", "failed")).toBe(true);
    expect(await p.persistSessionStatus("t-2", "complete")).toBe(false);
    const row = await prisma.session.findUnique({ where: { id: "t-2" } });
    expect(row?.status).toBe("failed");
  });

  it("returns false for an unknown id", async () => {
    expect(await p.persistSessionStatus("no-such-id", "complete")).toBe(false);
  });
});

describe("persistSessionCreate", () => {
  it("rejects a duplicate id, even under another owner, and keeps the original row", async () => {
    await p.persistSessionCreate("c-dup", "a", INTERVIEWER);
    await expect(
      p.persistSessionCreate("c-dup", "a", INTERVIEWER)
    ).rejects.toThrow();
    await expect(
      p.persistSessionCreate("c-dup", "b", OTHER)
    ).rejects.toThrow();
    const row = await prisma.session.findUnique({ where: { id: "c-dup" } });
    expect(row?.ownerId).toBe("a");
    expect(row?.interviewerId).toBe(INTERVIEWER.id);
    expect(row?.phase).toBe(INTERVIEWER.phases[0].name);
  });
});

describe("interviewer snapshot", () => {
  it("persistSessionCreate stores the interviewer id, the full snapshot and the first phase name", async () => {
    await p.persistSessionCreate("snap-1", "a", INTERVIEWER);
    const row = await prisma.session.findUnique({ where: { id: "snap-1" } });
    expect(row?.interviewerId).toBe(INTERVIEWER.id);
    expect(row?.phase).toBe(INTERVIEWER.phases[0].name);
    expect(row?.status).toBe("active");
    expect(JSON.parse(row?.interviewerJson ?? "null")).toEqual(INTERVIEWER);
  });

  it("listSessionsFromDb returns interviewerName from the snapshot, null without one, and no topicId", async () => {
    await p.persistSessionCreate("name-new", "namer", INTERVIEWER);
    await p.persistSessionStatus("name-new", "complete");
    await prisma.session.create({
      data: { id: "name-old", ownerId: "namer", interviewerId: "ai-se-delivery", status: "complete" },
    });
    await prisma.session.create({
      data: {
        id: "name-corrupt",
        ownerId: "namer",
        interviewerId: "x",
        interviewerJson: "{not json",
        status: "complete",
      },
    });
    const list = await p.listSessionsFromDb("namer");
    const byId = Object.fromEntries(list.map((s) => [s.id, s]));
    expect(byId["name-new"]).toMatchObject({ interviewerId: INTERVIEWER.id, interviewerName: INTERVIEWER.name });
    expect(byId["name-old"]).toMatchObject({ interviewerId: "ai-se-delivery", interviewerName: null });
    expect(byId["name-corrupt"]).toMatchObject({ interviewerName: null });
    for (const s of list) expect(s).not.toHaveProperty("topicId");
  });

  it("readReportFromDb returns interviewerName, null for a session without a snapshot", async () => {
    await seed("rep-new", "a");
    expect((await p.readReportFromDb("rep-new", "a"))?.interviewerName).toBe(INTERVIEWER.name);
    await prisma.session.create({
      data: { id: "rep-old", ownerId: "a", interviewerId: "experience-design", status: "complete" },
    });
    const old = await p.readReportFromDb("rep-old", "a");
    expect(old).toMatchObject({ report: null, sessionStatus: "complete", interviewerName: null });
  });

  it("readSnapshot is owner-scoped and returns null for a missing or invalid snapshot", async () => {
    await p.persistSessionCreate("rs-1", "a", INTERVIEWER);
    expect(await p.readSnapshot("rs-1", "a")).toEqual(INTERVIEWER);
    expect(await p.readSnapshot("rs-1", "b")).toBeNull();
    expect(await p.readSnapshot("rs-unknown", "a")).toBeNull();
    await prisma.session.create({ data: { id: "rs-old", ownerId: "a", interviewerId: "ai-se-delivery" } });
    expect(await p.readSnapshot("rs-old", "a")).toBeNull();
    await prisma.session.create({
      data: {
        id: "rs-invalid",
        ownerId: "a",
        interviewerId: "x",
        interviewerJson: JSON.stringify({ ...INTERVIEWER, phases: [] }),
      },
    });
    expect(await p.readSnapshot("rs-invalid", "a")).toBeNull();
  });
});

describe("purgeOlderThan", () => {
  it.each([0, -1, NaN, Infinity])("throws RangeError for days=%s", async (d) => {
    await expect(p.purgeOlderThan(d)).rejects.toThrow(RangeError);
  });

  it("deletes sessions ended more than N days ago and returns the count", async () => {
    await seed("p-old", "a");
    await seed("p-new", "a");
    await p.persistSessionStatus("p-old", "complete");
    await p.persistSessionStatus("p-new", "complete");
    await prisma.session.update({
      where: { id: "p-old" },
      data: { endedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) },
    });
    expect(await p.purgeOlderThan(1)).toBe(1);
    expect(await prisma.session.count({ where: { id: "p-old" } })).toBe(0);
    expect(await prisma.conversationTurn.count({ where: { sessionId: "p-old" } })).toBe(0);
    expect(await prisma.session.count({ where: { id: "p-new" } })).toBe(1);
  });
});

describe("abandonStaleActiveSessions", () => {
  it("marks every active row abandoned with endedAt set, leaves ended rows alone, returns the count", async () => {
    for (const id of ["st-active-1", "st-active-2", "st-complete", "st-failed"]) {
      await p.persistSessionCreate(id, "a", INTERVIEWER);
    }
    await p.persistSessionStatus("st-complete", "complete");
    await p.persistSessionStatus("st-failed", "failed");
    const ended = await prisma.session.findMany({
      where: { id: { in: ["st-complete", "st-failed"] } },
      orderBy: { id: "asc" },
    });
    const activeBefore = await prisma.session.count({ where: { status: "active" } });
    expect(activeBefore).toBeGreaterThanOrEqual(2);

    const before = Date.now();
    expect(await p.abandonStaleActiveSessions()).toBe(activeBefore);
    expect(await prisma.session.count({ where: { status: "active" } })).toBe(0);

    for (const id of ["st-active-1", "st-active-2"]) {
      const row = await prisma.session.findUnique({ where: { id } });
      expect(row?.status).toBe("abandoned");
      expect(row?.endedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    }
    const endedAfter = await prisma.session.findMany({
      where: { id: { in: ["st-complete", "st-failed"] } },
      orderBy: { id: "asc" },
    });
    expect(endedAfter).toEqual(ended);
    expect(await p.abandonStaleActiveSessions()).toBe(0);
  });

  it("lets purgeOlderThan remove a swept row once it is old enough", async () => {
    await seed("st-crashed", "a");
    await p.abandonStaleActiveSessions();
    expect(await p.purgeOlderThan(1)).toBe(0);
    await prisma.session.update({
      where: { id: "st-crashed" },
      data: { endedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) },
    });
    expect(await p.purgeOlderThan(1)).toBe(1);
    expect(await prisma.session.count({ where: { id: "st-crashed" } })).toBe(0);
    expect(await prisma.conversationTurn.count({ where: { sessionId: "st-crashed" } })).toBe(0);
    expect(await prisma.report.count({ where: { sessionId: "st-crashed" } })).toBe(0);
  });
});
