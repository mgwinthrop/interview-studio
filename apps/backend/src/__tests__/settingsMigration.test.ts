import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Builds a database as it looked before the LLM usage table (every migration up to the
// delivery/report-v2 one), fills it with raw SQL, then applies the remaining migrations the
// way `prisma migrate deploy` does on a real upgrade, and checks nothing was lost.

const backendDir = path.resolve(__dirname, "../..");
const migrationsDir = path.join(backendDir, "prisma", "migrations");
const PRE_CHANGE = [
  "20260409092624_init",
  "20261018180617_owner_and_status",
  "20261018201922_interviewers",
  "20261018221459_delivery_and_report_v2",
  "20261108120000_llm_usage",
];

let tmpDir: string;
let url: string;
let db: PrismaClient;

type Row = Record<string, string>;
const before: Record<string, Row[]> = {};
const TABLES = ["Session", "ConversationTurn", "Report", "Interviewer", "LlmUsage"];

function deploy(schemaPath: string) {
  execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", schemaPath], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

const connect = () => new PrismaClient({ datasources: { db: { url } } });

/** Every column as SQLite's quote() text, so values and storage types compare exactly. */
async function dump(table: string): Promise<Row[]> {
  const cols = (await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("${table}")`))
    .map((c) => c.name)
    .sort();
  const select = cols.map((c) => `quote("${c}") AS "${c}"`).join(", ");
  return db.$queryRawUnsafe<Row[]>(`SELECT ${select} FROM "${table}" ORDER BY "id"`);
}

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "settings-migration-test-"));
  url = `file:${path.join(tmpDir, "test.db")}`;

  const allMigrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  expect(allMigrations.slice(0, PRE_CHANGE.length)).toEqual(PRE_CHANGE);
  expect(allMigrations.some((m) => m.endsWith("_app_settings"))).toBe(true);

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
  await db.$executeRawUnsafe(
    `INSERT INTO "Session" ("id", "ownerId", "interviewerId", "interviewerJson", "status", "phase", "startedAt", "endedAt") VALUES
      ('s-a', 'local', 'tell-a-story', '{"id":"x"}', 'complete', 'Wrap up', 1760000000000, 1760000600000),
      ('s-b', 'token', 'explain-an-idea', NULL, 'active', 'intro', 1760200000000, NULL)`
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "ConversationTurn" ("id", "sessionId", "role", "content", "phase", "timestamp", "metricsJson") VALUES
      ('t-1', 's-a', 'assistant', 'Hello there.', 'intro', 1760000001000, NULL),
      ('t-2', 's-a', 'user', 'With ''quotes'' and ünïcödé', 'intro', 1760000002000, '{"wordCount":4}')`
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "Report" ("id", "sessionId", "summary", "strengthsJson", "improvementsJson", "highlightsJson", "overallAssessment", "generatedAt", "reportJson") VALUES
      ('r-1', 's-a', 'A summary', '[]', '[]', '[]', 'Good', 1760000700000, '{"format":2}')`
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "Interviewer" ("id", "ownerId", "source", "name", "purpose", "version", "definitionJson", "createdAt", "updatedAt") VALUES
      ('i-1', 'local', 'custom', 'Coach', 'Practise', 1, '{}', 1760000000000, 1760000000000)`
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "LlmUsage" ("id", "ownerId", "sessionId", "at", "feature", "provider", "model", "inputTokens", "outputTokens", "estimatedCostUsd") VALUES
      ('u-1', 'local', 's-a', 1760000000000, 'report', 'anthropic', 'm', 10, NULL, NULL)`
  );
  for (const t of TABLES) before[t] = await dump(t);
  await db.$disconnect();

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

describe("app settings migration over a populated database", () => {
  it("keeps every existing row byte-for-byte", async () => {
    for (const t of TABLES) {
      expect(before[t].length).toBeGreaterThan(0);
      expect(await dump(t)).toEqual(before[t]);
    }
  });

  it("adds empty AppSettings and ModelPrice tables", async () => {
    const cols = async (t: string) =>
      (await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("${t}")`)).map((c) => c.name).sort();
    expect(await cols("AppSettings")).toEqual(["ownerId", "updatedAt", "valuesJson"].sort());
    expect(await cols("ModelPrice")).toEqual(["asOf", "inputPerMtok", "model", "outputPerMtok", "ownerId", "updatedAt"].sort());
    expect(await db.appSettings.count()).toBe(0);
    expect(await db.modelPrice.count()).toBe(0);
  });

  it("lets the generated client write and read rows, one price per owner and model", async () => {
    await db.appSettings.create({ data: { ownerId: "local", valuesJson: "{}" } });
    const data = { ownerId: "local", model: "m", inputPerMtok: 1, outputPerMtok: 2, asOf: "2026-11-08" };
    await db.modelPrice.create({ data });
    await expect(db.modelPrice.create({ data })).rejects.toThrow();
    await db.modelPrice.create({ data: { ...data, ownerId: "other" } });
    expect(await db.modelPrice.count()).toBe(2);
  });
});

