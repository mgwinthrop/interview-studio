import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { InterviewerDefinition } from "../interviewer/schema";
import { DESIGNER_ID, PRESETS, SYNCED_PRESETS } from "../interviewer/presets";

// FQ-44 slice 3 (#68): the role names the owner chose at spec gate 1 (and "Design partner" at
// gate 2), and that syncPresets moves existing databases onto them without a version bump.

const EXPECTED: Record<string, string> = {
  "explain-an-idea": "Curious newcomer",
  "rehearse-an-interview": "Practice interviewer",
  "tell-a-story": "Story listener",
  "work-out-a-point-of-view": "Thinking partner",
  [DESIGNER_ID]: "Design partner",
};

const backendDir = path.resolve(__dirname, "../..");
let tmpDir: string;
let store: typeof import("../interviewerStore");
let prisma: typeof import("../db").default;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "preset-display-names-test-"));
  const url = `file:${path.join(tmpDir, "test.db")}`;
  process.env.DATABASE_URL = url;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  store = await import("../interviewerStore");
  prisma = (await import("../db")).default;
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** A preset as it was stored before display names existed. */
function withoutDisplayName(d: InterviewerDefinition): InterviewerDefinition {
  const { displayName: _d, ...rest } = d;
  return rest;
}

describe("preset display names", () => {
  it("every synced preset carries its approved display name", () => {
    expect(Object.fromEntries(SYNCED_PRESETS.map((p) => [p.id, p.displayName]))).toEqual(EXPECTED);
  });

  it("presets stay at version 1 (the sync compares the stored JSON, so no bump is needed)", () => {
    for (const p of SYNCED_PRESETS) expect(p.version).toBe(1);
  });

  it("the four listed presets are the ones named; the designer stays hidden", () => {
    expect(PRESETS.map((p) => p.id).sort()).toEqual(Object.keys(EXPECTED).filter((id) => id !== DESIGNER_ID).sort());
  });

  it("syncPresets moves a database from before display names onto them, once", async () => {
    await prisma.interviewer.deleteMany();
    const before = await store.syncPresets(SYNCED_PRESETS.map(withoutDisplayName));
    expect(before.inserted).toBe(SYNCED_PRESETS.length);

    const upgrade = await store.syncPresets(SYNCED_PRESETS);
    expect(upgrade).toEqual({ inserted: 0, updated: SYNCED_PRESETS.length, removed: 0 });
    for (const [id, name] of Object.entries(EXPECTED)) {
      const row = await prisma.interviewer.findUniqueOrThrow({ where: { id } });
      expect(JSON.parse(row.definitionJson).displayName).toBe(name);
      expect(row.version).toBe(1);
    }

    expect(await store.syncPresets(SYNCED_PRESETS)).toEqual({ inserted: 0, updated: 0, removed: 0 });
  });
});
