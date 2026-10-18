import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const backendDir = path.resolve(__dirname, "../..");
let tmpDir: string;
let p: typeof import("../persistence");
let prisma: typeof import("../db").default;
let retention: typeof import("../retention");

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "retention-test-"));
  const url = `file:${path.join(tmpDir, "test.db")}`;
  process.env.DATABASE_URL = url;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  p = await import("../persistence");
  prisma = (await import("../db")).default;
  retention = await import("../retention");
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
});

describe("runRetention", () => {
  it("removes an old ended session, keeps a recent one, and returns the count", async () => {
    await p.persistSessionCreate("old-1", "local", "ai-se-delivery", "intro");
    await p.persistSessionStatus("old-1", "complete");
    await p.persistSessionCreate("recent-1", "local", "ai-se-delivery", "intro");
    await p.persistSessionStatus("recent-1", "complete");
    await prisma.session.update({
      where: { id: "old-1" },
      data: { endedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
    });

    const purged = await retention.runRetention({ retentionDays: 1 }, p.purgeOlderThan);
    expect(purged).toBe(1);
    expect(await prisma.session.count({ where: { id: "old-1" } })).toBe(0);
    expect(await prisma.session.count({ where: { id: "recent-1" } })).toBe(1);
    expect(logSpy.mock.calls.flat().join(" ")).not.toContain("old-1");
  });

  it("returns 0 without calling purge when retentionDays is undefined", async () => {
    const purge = vi.fn(async () => 5);
    expect(await retention.runRetention({ retentionDays: undefined }, purge)).toBe(0);
    expect(purge).not.toHaveBeenCalled();
  });
});
