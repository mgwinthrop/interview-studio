import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Config } from "./config";
import prisma from "./db";

const execFileAsync = promisify(execFile);

/** The backend package directory (holds prisma/), from both src/ and dist/. */
const backendDir = path.resolve(__dirname, "..");

/**
 * Applies pending Prisma migrations, then enables WAL for SQLite file databases.
 * Rejects on any failure: the caller must not start the server on a stale schema.
 */
export async function runMigrations(config: Config): Promise<void> {
  await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: config.databaseUrl },
  });
  if (config.databaseUrl.startsWith("file:")) {
    await prisma.$queryRaw`PRAGMA journal_mode=WAL`;
  }
}
