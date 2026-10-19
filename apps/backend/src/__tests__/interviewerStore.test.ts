import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { InterviewerDefinition, InterviewerInput } from "../interviewer/schema";
import { PRESETS, SYNCED_PRESETS } from "../interviewer/presets";
import { DESIGNER_ID } from "../interviewer/presets/designer";

const backendDir = path.resolve(__dirname, "../..");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let tmpDir: string;
let store: typeof import("../interviewerStore");
let persistence: typeof import("../persistence");
let prisma: typeof import("../db").default;

/** The input fields of a definition (drops id, source, owner, version and timestamps). */
function inputOf(d: InterviewerDefinition): InterviewerInput {
  const { id: _i, source: _s, ownerId: _o, version: _v, createdAt: _c, updatedAt: _u, ...input } = d;
  return input;
}

function input(name = "My interviewer"): InterviewerInput {
  return { ...inputOf(PRESETS[0]), name };
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "interviewer-store-test-"));
  const url = `file:${path.join(tmpDir, "test.db")}`;
  process.env.DATABASE_URL = url;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  store = await import("../interviewerStore");
  persistence = await import("../persistence");
  prisma = (await import("../db")).default;
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.interviewer.deleteMany();
  await store.syncPresets(PRESETS);
});

describe("create, get and list", () => {
  it("creates a custom interviewer with a UUID id and version 1", async () => {
    const created = await store.createInterviewer("a", input());
    expect(created.id).toMatch(UUID_RE);
    expect(created).toMatchObject({ source: "custom", ownerId: "a", version: 1, name: "My interviewer" });
    expect(created.createdAt).toBe(created.updatedAt);
    expect(await store.getInterviewer(created.id, "a")).toEqual(created);
    const row = await prisma.interviewer.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.createdAt.toISOString()).toBe(created.createdAt);
    expect(row.updatedAt.toISOString()).toBe(created.updatedAt);
    expect(JSON.parse(row.definitionJson)).toEqual(created);
  });

  it("ignores source and ownerId smuggled into the input", async () => {
    const sneaky = { ...input(), source: "preset", ownerId: "system", id: "tell-a-story" } as InterviewerInput;
    const created = await store.createInterviewer("a", sneaky);
    expect(created).toMatchObject({ source: "custom", ownerId: "a" });
    expect(created.id).not.toBe("tell-a-story");
  });

  it("refuses to create a custom interviewer owned by system", async () => {
    await expect(store.createInterviewer("system", input())).rejects.toThrow();
    expect(await prisma.interviewer.count({ where: { source: "custom" } })).toBe(0);
  });

  it("hides one owner's custom interviewer from another; presets are visible to both", async () => {
    const mine = await store.createInterviewer("a", input("Zed"));
    await store.createInterviewer("a", input("Alpha"));
    expect(await store.getInterviewer(mine.id, "b")).toBeNull();
    expect(await store.getInterviewer(PRESETS[0].id, "a")).toEqual(PRESETS[0]);
    expect(await store.getInterviewer(PRESETS[0].id, "b")).toEqual(PRESETS[0]);
    expect(await store.getInterviewer("no-such-id", "a")).toBeNull();

    const listA = await store.listInterviewers("a");
    const presetNames = [...PRESETS].map((p) => p.name).sort((x, y) => x.localeCompare(y));
    expect(listA.map((s) => s.name)).toEqual([...presetNames, "Alpha", "Zed"]);
    expect(listA[listA.length - 1]).toEqual({
      id: mine.id,
      name: "Zed",
      purpose: mine.purpose,
      source: "custom",
      version: 1,
    });
    const listB = await store.listInterviewers("b");
    expect(listB.map((s) => s.name)).toEqual(presetNames);
  });

  it("throws InterviewerLimitError on the 51st custom interviewer", async () => {
    for (let i = 0; i < 50; i++) await store.createInterviewer("cap", input(`n${i}`));
    await expect(store.createInterviewer("cap", input("one too many"))).rejects.toBeInstanceOf(
      store.InterviewerLimitError,
    );
    expect(await prisma.interviewer.count({ where: { ownerId: "cap" } })).toBe(50);
    // The cap is per owner.
    await expect(store.createInterviewer("other", input())).resolves.toMatchObject({ ownerId: "other" });
  });

  it("skips a corrupt row in the list and returns null from get", async () => {
    const good = await store.createInterviewer("a", input("Good"));
    const now = new Date();
    for (const [id, json] of [
      ["corrupt-json", "{not json"],
      ["corrupt-schema", JSON.stringify({ id: "corrupt-schema", name: 5 })],
      // Valid record whose identity disagrees with its row: treated as corrupt.
      ["corrupt-identity", JSON.stringify({ ...good, id: "corrupt-identity", ownerId: "b" })],
    ]) {
      await prisma.interviewer.create({
        data: {
          id,
          ownerId: "a",
          source: "custom",
          name: "Bad",
          purpose: "Bad",
          version: 1,
          definitionJson: json,
          createdAt: now,
          updatedAt: now,
        },
      });
      expect(await store.getInterviewer(id, "a")).toBeNull();
    }
    const list = await store.listInterviewers("a");
    expect(list.map((s) => s.id)).toContain(good.id);
    expect(list.map((s) => s.name)).not.toContain("Bad");
  });
});

describe("update", () => {
  it("bumps the version and rejects a stale version", async () => {
    const created = await store.createInterviewer("a", input("Before"));
    const r = await store.updateInterviewer(created.id, "a", input("After"), 1);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.value).toMatchObject({ id: created.id, name: "After", version: 2, createdAt: created.createdAt });
    expect(await store.getInterviewer(created.id, "a")).toEqual(r.value);
    const row = await prisma.interviewer.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ name: "After", version: 2 });
    expect(row.updatedAt.toISOString()).toBe(r.value.updatedAt);

    expect(await store.updateInterviewer(created.id, "a", input("Stale"), 1)).toEqual({ status: "conflict" });
    expect((await store.getInterviewer(created.id, "a"))?.name).toBe("After");
  });

  it("lets exactly one of two concurrent updates with the same version win", async () => {
    const created = await store.createInterviewer("a", input());
    const results = await Promise.all([
      store.updateInterviewer(created.id, "a", input("First"), 1),
      store.updateInterviewer(created.id, "a", input("Second"), 1),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["conflict", "ok"]);
    const stored = await store.getInterviewer(created.id, "a");
    expect(stored?.version).toBe(2);
    const winner = results.find((r) => r.status === "ok");
    expect(winner?.status === "ok" && winner.value.name).toBe(stored?.name);
  });

  it("is not_found for another owner's interviewer and an unknown id, preset for a preset", async () => {
    const created = await store.createInterviewer("a", input("Mine"));
    expect(await store.updateInterviewer(created.id, "b", input("Theirs"), 1)).toEqual({ status: "not_found" });
    expect(await store.updateInterviewer("nope", "a", input(), 1)).toEqual({ status: "not_found" });
    expect(await store.updateInterviewer(PRESETS[0].id, "a", input(), 1)).toEqual({ status: "preset" });
    expect((await store.getInterviewer(created.id, "a"))?.name).toBe("Mine");
    expect(await store.getInterviewer(PRESETS[0].id, "a")).toEqual(PRESETS[0]);
  });
});

describe("duplicate", () => {
  it("copies a preset into an owned custom interviewer named with (copy)", async () => {
    const copy = await store.duplicateInterviewer(PRESETS[0].id, "a");
    expect(copy).not.toBeNull();
    expect(copy).toMatchObject({
      ...inputOf(PRESETS[0]),
      name: `${PRESETS[0].name} (copy)`,
      source: "custom",
      ownerId: "a",
      version: 1,
    });
    expect(copy?.id).toMatch(UUID_RE);
    expect(await store.getInterviewer(copy!.id, "b")).toBeNull();
  });

  it("truncates the name so it stays within 60 characters", async () => {
    const long = await store.createInterviewer("a", input("x".repeat(60)));
    const copy = await store.duplicateInterviewer(long.id, "a");
    expect(copy?.name).toBe(`${"x".repeat(53)} (copy)`);
    expect(copy?.name).toHaveLength(60);
    const short = await store.createInterviewer("a", input("y".repeat(53)));
    expect((await store.duplicateInterviewer(short.id, "a"))?.name).toBe(`${"y".repeat(53)} (copy)`);
  });

  it("returns null for another owner's or an unknown interviewer", async () => {
    const theirs = await store.createInterviewer("b", input());
    expect(await store.duplicateInterviewer(theirs.id, "a")).toBeNull();
    expect(await store.duplicateInterviewer("nope", "a")).toBeNull();
    expect(await prisma.interviewer.count({ where: { ownerId: "a" } })).toBe(0);
  });

  it("counts against the cap", async () => {
    for (let i = 0; i < 50; i++) await store.createInterviewer("dupcap", input(`n${i}`));
    await expect(store.duplicateInterviewer(PRESETS[0].id, "dupcap")).rejects.toBeInstanceOf(
      store.InterviewerLimitError,
    );
  });
});

describe("delete", () => {
  it("deletes the owner's custom interviewer and leaves a finished session's snapshot readable", async () => {
    const created = await store.createInterviewer("a", input("Snapshotted"));
    await persistence.persistSessionCreate("del-snap", "a", created);
    await persistence.persistSessionStatus("del-snap", "complete");
    expect(await store.deleteInterviewer(created.id, "a")).toBe("deleted");
    expect(await store.getInterviewer(created.id, "a")).toBeNull();
    expect(await persistence.readSnapshot("del-snap", "a")).toEqual(created);
    expect((await persistence.readReportFromDb("del-snap", "a"))?.interviewerName).toBe("Snapshotted");
  });

  it("is not_found for another owner's or an unknown id, preset for a preset", async () => {
    const created = await store.createInterviewer("a", input());
    expect(await store.deleteInterviewer(created.id, "b")).toBe("not_found");
    expect(await store.deleteInterviewer("nope", "a")).toBe("not_found");
    expect(await store.deleteInterviewer(PRESETS[0].id, "a")).toBe("preset");
    expect(await store.getInterviewer(created.id, "a")).not.toBeNull();
    expect(await store.getInterviewer(PRESETS[0].id, "a")).not.toBeNull();
  });
});

describe("syncPresets", () => {
  it("inserts every preset into an empty table", async () => {
    await prisma.interviewer.deleteMany();
    expect(await store.syncPresets(PRESETS)).toEqual({ inserted: PRESETS.length, updated: 0, removed: 0 });
    for (const p of PRESETS) expect(await store.getInterviewer(p.id, "anyone")).toEqual(p);
    const row = await prisma.interviewer.findUniqueOrThrow({ where: { id: PRESETS[0].id } });
    expect(row).toMatchObject({ ownerId: "system", source: "preset", version: PRESETS[0].version });
    expect(row.createdAt.toISOString()).toBe(PRESETS[0].createdAt);
  });

  it("is a no-op when nothing changed", async () => {
    expect(await store.syncPresets(PRESETS)).toEqual({ inserted: 0, updated: 0, removed: 0 });
  });

  it("updates a changed preset, removes a dropped one and leaves custom rows alone", async () => {
    const custom = await store.createInterviewer("a", input("Custom"));
    await persistence.persistSessionCreate("sync-sess", "a", PRESETS[3]);
    const changed = { ...PRESETS[0], purpose: "A new purpose.", version: 2 };
    const next = [changed, PRESETS[1], PRESETS[2]];
    expect(await store.syncPresets(next)).toEqual({ inserted: 0, updated: 1, removed: 1 });
    expect(await store.getInterviewer(PRESETS[0].id, "a")).toEqual(changed);
    expect(await store.getInterviewer(PRESETS[3].id, "a")).toBeNull();
    expect(await store.getInterviewer(custom.id, "a")).toEqual(custom);
    expect(await persistence.readSnapshot("sync-sess", "a")).toEqual(PRESETS[3]);
  });

  it("throws naming the preset and field paths, without writing anything", async () => {
    await prisma.interviewer.deleteMany({ where: { id: PRESETS[3].id } });
    const before = await prisma.interviewer.findMany({ orderBy: { id: "asc" } });
    const sentinel = "SENTINEL-PRESET-TEXT\u0001";
    const bad = { ...PRESETS[1], persona: sentinel, version: 0 };
    const err = await store
      .syncPresets([{ ...PRESETS[0], purpose: "Changed." }, bad, PRESETS[3]])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(store.PresetValidationError);
    const message = (err as Error).message;
    expect(message).toContain(PRESETS[1].id);
    expect(message).toContain("persona");
    expect(message).toContain("version");
    expect(message).not.toContain("SENTINEL");
    expect(await prisma.interviewer.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });

  it("refuses a preset that is not source preset owned by system, or a duplicate id", async () => {
    await expect(store.syncPresets([{ ...PRESETS[0], source: "custom" }])).rejects.toBeInstanceOf(
      store.PresetValidationError,
    );
    await expect(store.syncPresets([{ ...PRESETS[0], ownerId: "a" }])).rejects.toBeInstanceOf(
      store.PresetValidationError,
    );
    await expect(store.syncPresets([PRESETS[0], PRESETS[0]])).rejects.toBeInstanceOf(
      store.PresetValidationError,
    );
    expect(await prisma.interviewer.count({ where: { source: "preset" } })).toBe(PRESETS.length);
  });
});

describe("hidden designer preset", () => {
  beforeEach(async () => {
    await store.syncPresets(SYNCED_PRESETS);
  });

  it("is not listed but can be fetched by any owner", async () => {
    const list = await store.listInterviewers("a");
    expect(list.map((s) => s.id).sort()).toEqual(PRESETS.map((p) => p.id).sort());
    expect(list.map((s) => s.id)).not.toContain(DESIGNER_ID);
    expect((await store.getInterviewer(DESIGNER_ID, "a"))?.id).toBe(DESIGNER_ID);
    expect((await store.getInterviewer(DESIGNER_ID, "b"))?.id).toBe(DESIGNER_ID);
  });

  it("cannot be duplicated, updated or deleted", async () => {
    const before = await prisma.interviewer.count();
    expect(await store.duplicateInterviewer(DESIGNER_ID, "a")).toBeNull();
    expect(await prisma.interviewer.count()).toBe(before);
    expect((await store.updateInterviewer(DESIGNER_ID, "a", input(), 1)).status).toBe("preset");
    expect(await store.deleteInterviewer(DESIGNER_ID, "a")).toBe("preset");
  });
});
