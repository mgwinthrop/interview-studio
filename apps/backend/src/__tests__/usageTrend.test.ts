import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const backendDir = path.resolve(__dirname, "../..");
const DAY = 24 * 60 * 60 * 1000;
let tmpDir: string;
let usage: typeof import("../usage");
let prisma: typeof import("../db").default;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "usage-trend-test-"));
  const url = `file:${path.join(tmpDir, "test.db")}`;
  process.env.DATABASE_URL = url;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  usage = await import("../usage");
  prisma = (await import("../db")).default;
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
  vi.restoreAllMocks();
  await prisma.llmUsage.deleteMany();
  await prisma.modelPrice.deleteMany();
});

afterEach(() => {
  vi.useRealTimers();
});

function todayStartMs(): number {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
}
const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function seed(over: Record<string, unknown> = {}) {
  await prisma.llmUsage.create({
    data: {
      ownerId: "local",
      feature: "report",
      provider: "anthropic",
      model: "m",
      inputTokens: 100,
      outputTokens: 10,
      estimatedCostUsd: null,
      at: new Date(todayStartMs()),
      ...over,
    },
  });
}

describe("usageTrend", () => {
  it("returns exactly N UTC days, oldest first, ending today, empty days with byFeature {}", async () => {
    const t = await usage.usageTrend("local", 7);
    expect(t.days).toHaveLength(7);
    const today = todayStartMs();
    expect(t.days.map((d) => d.date)).toEqual(Array.from({ length: 7 }, (_, i) => dayStr(today - (6 - i) * DAY)));
    expect(t.days.every((d) => Object.keys(d.byFeature).length === 0)).toBe(true);
    expect(t.byFeature).toEqual([]);
    expect(t.byModel).toEqual([]);
    expect(t.totals).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: null });
    expect(t.priceTableAsOf).toBeNull();
  });

  it("days=365 works", async () => {
    const t = await usage.usageTrend("local", 365);
    expect(t.days).toHaveLength(365);
    expect(t.days[0].date).toBe(dayStr(todayStartMs() - 364 * DAY));
  });

  it("splits at UTC midnight: 23:59:59.999 and 00:00:00.000 land in different days", async () => {
    const today = todayStartMs();
    await seed({ at: new Date(today - 1), feature: "conversation" });
    await seed({ at: new Date(today), feature: "report" });
    const t = await usage.usageTrend("local", 3);
    const byDate = Object.fromEntries(t.days.map((d) => [d.date, d.byFeature]));
    expect(Object.keys(byDate[dayStr(today - DAY)])).toEqual(["conversation"]);
    expect(Object.keys(byDate[dayStr(today)])).toEqual(["report"]);
  });

  it("excludes a row just before the range start and includes one at the start", async () => {
    const start = todayStartMs() - 2 * DAY;
    await seed({ at: new Date(start - 1), model: "before" });
    await seed({ at: new Date(start), model: "at-start" });
    const t = await usage.usageTrend("local", 3);
    expect(t.byModel.map((m) => m.model)).toEqual(["at-start"]);
    expect(t.totals.calls).toBe(1);
    expect(t.days[0].byFeature.report.calls).toBe(1);
  });

  it("excludes rows dated after today from totals, byFeature, byModel and days", async () => {
    const today = todayStartMs();
    await seed({ model: "now" });
    await seed({ at: new Date(today + DAY), model: "tomorrow", feature: "conversation", estimatedCostUsd: 5 });
    await seed({ at: new Date(today + 3 * DAY), model: "later", feature: "conversation" });
    const t = await usage.usageTrend("local", 3);
    expect(t.totals.calls).toBe(1);
    expect(t.totals.estimatedCostUsd).toBeNull();
    expect(t.byFeature.map((f) => f.feature)).toEqual(["report"]);
    expect(t.byModel.map((m) => m.model)).toEqual(["now"]);
    expect(t.days).toHaveLength(3);
    expect(t.days.every((d) => !("conversation" in d.byFeature))).toBe(true);
  });

  it("sums calls and tokens per day per feature; null token columns count as 0", async () => {
    const today = todayStartMs();
    await seed({ feature: "conversation", inputTokens: 5, outputTokens: 1 });
    await seed({ feature: "conversation", inputTokens: null, outputTokens: null });
    await seed({ feature: "report", inputTokens: 7, outputTokens: 3, at: new Date(today - DAY) });
    const t = await usage.usageTrend("local", 2);
    expect(t.days[1].byFeature.conversation).toEqual({
      calls: 2,
      inputTokens: 5,
      outputTokens: 1,
      estimatedCostUsd: null,
    });
    expect(t.days[0].byFeature.report).toEqual({ calls: 1, inputTokens: 7, outputTokens: 3, estimatedCostUsd: null });
  });

  it("cost: null with no priced call, partial sum when mixed, 0 for a priced zero-cost call", async () => {
    await seed({ feature: "conversation" });
    await seed({ feature: "report", estimatedCostUsd: 0.5 });
    await seed({ feature: "report" });
    await seed({ feature: "persona-draft", estimatedCostUsd: 0 });
    const t = await usage.usageTrend("local", 1);
    const f = t.days[0].byFeature;
    expect(f.conversation.estimatedCostUsd).toBeNull();
    expect(f.report.estimatedCostUsd).toBe(0.5);
    expect(f["persona-draft"].estimatedCostUsd).toBe(0);
    expect(t.totals.estimatedCostUsd).toBe(0.5);
  });

  it("byFeature, byModel and totals match the sums of the days (sorted, only used)", async () => {
    const today = todayStartMs();
    await seed({ feature: "report", model: "m2", estimatedCostUsd: 0.25 });
    await seed({ feature: "conversation", model: "m1", estimatedCostUsd: 0.5, at: new Date(today - DAY) });
    await seed({ feature: "conversation", model: "m2", at: new Date(today - 2 * DAY) });
    const t = await usage.usageTrend("local", 5);
    expect(t.byFeature.map((f) => f.feature)).toEqual(["conversation", "report"]);
    expect(t.byModel.map((m) => m.model)).toEqual(["m1", "m2"]);
    expect(t.byFeature[0]).toEqual({
      feature: "conversation",
      calls: 2,
      inputTokens: 200,
      outputTokens: 20,
      estimatedCostUsd: 0.5,
    });
    expect(t.byModel[1]).toEqual({ model: "m2", calls: 2, inputTokens: 200, outputTokens: 20, estimatedCostUsd: 0.25 });
    expect(t.totals).toEqual({ calls: 3, inputTokens: 300, outputTokens: 30, estimatedCostUsd: 0.75 });
    const sum = (key: "calls" | "inputTokens" | "outputTokens") =>
      t.days.reduce((a, d) => a + Object.values(d.byFeature).reduce((b, x) => b + x[key], 0), 0);
    for (const key of ["calls", "inputTokens", "outputTokens"] as const) {
      expect(sum(key)).toBe(t.totals[key]);
      expect(t.byModel.reduce((a, m) => a + m[key], 0)).toBe(t.totals[key]);
    }
  });

  it("totals cost is null when no row had a cost", async () => {
    await seed();
    expect((await usage.usageTrend("local", 1)).totals.estimatedCostUsd).toBeNull();
  });

  it("never includes another owner's rows", async () => {
    await seed({ ownerId: "someone-else", estimatedCostUsd: 9 });
    await seed();
    const t = await usage.usageTrend("local", 1);
    expect(t.totals.calls).toBe(1);
    expect(t.totals.estimatedCostUsd).toBeNull();
    expect((await usage.usageTrend("nobody", 1)).totals.calls).toBe(0);
  });

  it("takes priceTableAsOf from the owner's stored prices (null when none)", async () => {
    expect((await usage.usageTrend("local", 1)).priceTableAsOf).toBeNull();
    await prisma.modelPrice.createMany({
      data: [
        { ownerId: "local", model: "a", inputPerMtok: 1, outputPerMtok: 1, asOf: "2026-01-15" },
        { ownerId: "local", model: "b", inputPerMtok: 1, outputPerMtok: 1, asOf: "2026-03-01" },
        { ownerId: "someone-else", model: "a", inputPerMtok: 1, outputPerMtok: 1, asOf: "2027-01-01" },
      ],
    });
    expect((await usage.usageTrend("local", 1)).priceTableAsOf).toBe("2026-03-01");
  });

  it("a failing price lookup gives null without throwing, logging the class only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    class PriceDbError extends Error {
      name = "PriceDbError";
    }
    vi.spyOn(prisma.modelPrice, "findMany").mockRejectedValueOnce(new PriceDbError("secret-detail"));
    await seed();
    const t = await usage.usageTrend("local", 1);
    expect(t.priceTableAsOf).toBeNull();
    expect(t.totals.calls).toBe(1);
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("PriceDbError");
    expect(logged).not.toContain("secret-detail");
  });
});
