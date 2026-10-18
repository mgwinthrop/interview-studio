import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Builds a database exactly as it looked before the interviewer change (only the migrations
// that existed then), fills it with raw SQL, then applies the remaining migrations the way
// `prisma migrate deploy` does on a real upgrade, and checks nothing was lost.

const backendDir = path.resolve(__dirname, "../..");
const migrationsDir = path.join(backendDir, "prisma", "migrations");
const PRE_CHANGE = ["20260409092624_init", "20261018180617_owner_and_status"];

let tmpDir: string;
let url: string;
let db: PrismaClient;

type Row = Record<string, string>;
const before: { sessions: Row[]; turns: Row[]; reports: Row[]; topicIds: Row[] } = {
  sessions: [],
  turns: [],
  reports: [],
  topicIds: [],
};

function deploy(schemaPath: string) {
  execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", schemaPath], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

function connect() {
  return new PrismaClient({ datasources: { db: { url } } });
}

/** Every column as SQLite's quote() text, so values and storage types compare exactly. */
async function dump(table: string, exclude: string[] = []): Promise<Row[]> {
  const cols = (await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("${table}")`))
    .map((c) => c.name)
    .filter((c) => !exclude.includes(c))
    .sort();
  const select = cols.map((c) => `quote("${c}") AS "${c}"`).join(", ");
  return db.$queryRawUnsafe<Row[]>(`SELECT ${select} FROM "${table}" ORDER BY "id"`);
}

async function indexNames(): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );
  return rows.map((r) => r.name);
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "interviewer-migration-test-"));
  url = `file:${path.join(tmpDir, "test.db")}`;

  const allMigrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  expect(allMigrations.slice(0, PRE_CHANGE.length)).toEqual(PRE_CHANGE);
  expect(allMigrations.some((m) => m.endsWith("_interviewers"))).toBe(true);

  // A prisma dir holding only the pre-change migrations.
  const prismaDir = path.join(tmpDir, "prisma");
  const tmpMigrations = path.join(prismaDir, "migrations");
  mkdirSync(tmpMigrations, { recursive: true });
  cpSync(path.join(backendDir, "prisma", "schema.prisma"), path.join(prismaDir, "schema.prisma"));
  cpSync(path.join(migrationsDir, "migration_lock.toml"), path.join(tmpMigrations, "migration_lock.toml"));
  for (const m of PRE_CHANGE) {
    cpSync(path.join(migrationsDir, m), path.join(tmpMigrations, m), { recursive: true });
  }
  deploy(path.join(prismaDir, "schema.prisma"));

  db = connect();
  // Dates as Prisma writes them (integer ms) and as the column default writes them (text).
  await db.$executeRawUnsafe(
    `INSERT INTO "Session" ("id", "ownerId", "topicId", "status", "phase", "startedAt", "endedAt") VALUES
      ('old-a', 'local', 'ai-se-delivery', 'complete', 'wrap_up', 1760000000000, 1760000600000),
      ('old-b', 'local', 'experience-design', 'abandoned', 'share_work', 1760100000000, 1760100300000),
      ('old-c', 'someone-else', 'product-design-strategy', 'active', 'intro', 1760200000000, NULL)`
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "Session" ("id", "topicId") VALUES ('old-d', 'ai-se-delivery')`
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "ConversationTurn" ("id", "sessionId", "role", "content", "phase", "timestamp") VALUES
      ('t-1', 'old-a', 'assistant', 'Hello there.', 'intro', 1760000001000),
      ('t-2', 'old-a', 'user', 'Line one
line two, with ''quotes'' and ünïcödé', 'share_work', 1760000002000),
      ('t-3', 'old-a', 'assistant', 'Tell me more.', 'deep_dive', 1760000003000),
      ('t-4', 'old-b', 'user', 'Partial answer', 'share_work', 1760100001000)`
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "Report" ("id", "sessionId", "summary", "strengthsJson", "improvementsJson", "highlightsJson", "overallAssessment", "generatedAt") VALUES
      ('r-1', 'old-a', 'A summary', '[{"area":"a","evidence":"e"}]', '[{"area":"a","suggestion":"s"}]', '["h"]', 'Good', 1760000700000)`
  );

  before.sessions = await dump("Session", ["topicId"]);
  before.turns = await dump("ConversationTurn");
  before.reports = await dump("Report");
  before.topicIds = await db.$queryRawUnsafe<Row[]>(
    `SELECT "id", "topicId" FROM "Session" ORDER BY "id"`
  );
  await db.$disconnect();

  // Upgrade: add the remaining migrations and deploy again.
  for (const m of allMigrations.filter((name) => !PRE_CHANGE.includes(name))) {
    cpSync(path.join(migrationsDir, m), path.join(tmpMigrations, m), { recursive: true });
  }
  deploy(path.join(prismaDir, "schema.prisma"));
  db = connect();
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("interviewers migration over a populated database", () => {
  it("keeps every session column unchanged and copies topicId into interviewerId", async () => {
    expect(before.sessions).toHaveLength(4);
    expect(await dump("Session", ["interviewerId", "interviewerJson"])).toEqual(before.sessions);
    const after = await db.$queryRawUnsafe<Row[]>(
      `SELECT "id", "interviewerId" AS "topicId" FROM "Session" ORDER BY "id"`
    );
    expect(after).toEqual(before.topicIds);
  });

  it("drops the topicId column and leaves interviewerJson null on old rows", async () => {
    const cols = (await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("Session")`)).map(
      (c) => c.name
    );
    expect(cols).not.toContain("topicId");
    expect(cols).toContain("interviewerId");
    const nulls = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM "Session" WHERE "interviewerJson" IS NULL`
    );
    expect(Number(nulls[0].n)).toBe(4);
  });

  it("keeps every turn and report byte-for-byte", async () => {
    expect(before.turns).toHaveLength(4);
    expect(before.reports).toHaveLength(1);
    expect(await dump("ConversationTurn")).toEqual(before.turns);
    expect(await dump("Report")).toEqual(before.reports);
  });

  it("keeps the indexes, the report sessionId unique constraint and the foreign keys", async () => {
    const names = await indexNames();
    expect(names).toEqual(
      expect.arrayContaining(["Session_ownerId_idx", "Report_sessionId_key", "Interviewer_ownerId_idx"])
    );
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "Report" ("id", "sessionId", "summary", "strengthsJson", "improvementsJson", "highlightsJson", "overallAssessment") VALUES ('r-dup', 'old-a', 's', '[]', '[]', '[]', 'o')`
      )
    ).rejects.toThrow(/UNIQUE constraint failed/);
    for (const table of ["ConversationTurn", "Report"]) {
      const fks = await db.$queryRawUnsafe<{ table: string; from: string; to: string }[]>(
        `PRAGMA foreign_key_list("${table}")`
      );
      expect(fks).toEqual([expect.objectContaining({ table: "Session", from: "sessionId", to: "id" })]);
    }
    expect(await db.$queryRawUnsafe(`PRAGMA foreign_key_check`)).toEqual([]);
  });

  it("creates the Interviewer table empty", async () => {
    const n = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "Interviewer"`);
    expect(Number(n[0].n)).toBe(0);
  });

  it("lets the generated client read old rows", async () => {
    const row = await db.session.findUnique({ where: { id: "old-b" }, include: { turns: true } });
    expect(row).toMatchObject({
      interviewerId: "experience-design",
      interviewerJson: null,
      status: "abandoned",
      phase: "share_work",
    });
    expect(row?.turns.map((t) => t.phase)).toEqual(["share_work"]);
  });
});
