import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Builds a database exactly as it looked before the delivery/report-v2 change (only the
// migrations that existed then), fills it with raw SQL, then applies the remaining migrations
// the way `prisma migrate deploy` does on a real upgrade, and checks nothing was lost.

const backendDir = path.resolve(__dirname, "../..");
const migrationsDir = path.join(backendDir, "prisma", "migrations");
const PRE_CHANGE = [
  "20260409092624_init",
  "20261018180617_owner_and_status",
  "20261018201922_interviewers",
];

let tmpDir: string;
let url: string;
let db: PrismaClient;

type Row = Record<string, string>;
const before: { sessions: Row[]; turns: Row[]; reports: Row[] } = {
  sessions: [],
  turns: [],
  reports: [],
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

async function columnNames(table: string): Promise<string[]> {
  return (await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("${table}")`)).map(
    (c) => c.name
  );
}

async function indexNames(): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );
  return rows.map((r) => r.name);
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "delivery-migration-test-"));
  url = `file:${path.join(tmpDir, "test.db")}`;

  const allMigrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  expect(allMigrations.slice(0, PRE_CHANGE.length)).toEqual(PRE_CHANGE);
  expect(allMigrations.some((m) => m.endsWith("_delivery_and_report_v2"))).toBe(true);

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
  // Dates as Prisma writes them (integer ms).
  await db.$executeRawUnsafe(
    `INSERT INTO "Session" ("id", "ownerId", "interviewerId", "interviewerJson", "status", "phase", "startedAt", "endedAt") VALUES
      ('old-a', 'local', 'ai-se-delivery', '{"id":"x"}', 'complete', 'wrap_up', 1760000000000, 1760000600000),
      ('old-b', 'local', 'experience-design', NULL, 'abandoned', 'share_work', 1760100000000, 1760100300000),
      ('old-c', 'someone-else', 'product-design-strategy', NULL, 'active', 'intro', 1760200000000, NULL)`
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

  before.sessions = await dump("Session");
  before.turns = await dump("ConversationTurn");
  before.reports = await dump("Report");
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

describe("delivery and report v2 migration over a populated database", () => {
  it("keeps every session byte-for-byte", async () => {
    expect(before.sessions).toHaveLength(3);
    expect(await dump("Session")).toEqual(before.sessions);
  });

  it("keeps every turn and report byte-for-byte, apart from the new columns", async () => {
    expect(before.turns).toHaveLength(4);
    expect(before.reports).toHaveLength(1);
    expect(await dump("ConversationTurn", ["metricsJson"])).toEqual(before.turns);
    expect(await dump("Report", ["reportJson"])).toEqual(before.reports);
  });

  it("adds the two columns, null on every existing row", async () => {
    expect(await columnNames("ConversationTurn")).toContain("metricsJson");
    expect(await columnNames("Report")).toContain("reportJson");
    const turns = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM "ConversationTurn" WHERE "metricsJson" IS NULL`
    );
    const reports = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM "Report" WHERE "reportJson" IS NULL`
    );
    expect(Number(turns[0].n)).toBe(4);
    expect(Number(reports[0].n)).toBe(1);
  });

  it("keeps the indexes, the report sessionId unique constraint and the foreign keys", async () => {
    expect(await indexNames()).toEqual(
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

  it("lets the generated client read old rows", async () => {
    const turn = await db.conversationTurn.findUnique({ where: { id: "t-2" } });
    expect(turn).toMatchObject({ role: "user", phase: "share_work", metricsJson: null });
    const report = await db.report.findUnique({ where: { sessionId: "old-a" } });
    expect(report).toMatchObject({ summary: "A summary", reportJson: null });
  });
});
