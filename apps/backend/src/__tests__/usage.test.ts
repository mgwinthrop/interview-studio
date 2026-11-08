import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const backendDir = path.resolve(__dirname, "../..");
let tmpDir: string;
let usage: typeof import("../usage");
let prisma: typeof import("../db").default;

// Invented prices for the arithmetic only; never real ones.
const TEST_PRICES = {
  "model-a": { inputPerMtok: 2, outputPerMtok: 10, asOf: "2026-01-15" },
  "model-b": { inputPerMtok: 1, outputPerMtok: 1, asOf: "2026-03-01" },
};

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "usage-test-"));
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
  vi.restoreAllMocks();
  await prisma.llmUsage.deleteMany();
});

const record = (over: Partial<import("../usage").UsageRecord> = {}): import("../usage").UsageRecord => ({
  feature: "report",
  ownerId: "local",
  sessionId: "sess-1",
  provider: "anthropic",
  model: "model-a",
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  ...over,
});

describe("estimateCostUsd", () => {
  it("multiplies tokens by the per-million price", () => {
    // 1M in at 2 + 0.5M out at 10 = 2 + 5
    expect(usage.estimateCostUsd(record(), TEST_PRICES)).toBeCloseTo(7, 10);
    expect(usage.estimateCostUsd(record({ inputTokens: 120, outputTokens: 40 }), TEST_PRICES)).toBeCloseTo(
      (120 * 2 + 40 * 10) / 1_000_000,
      12,
    );
  });

  it("is null for an unknown model or a missing token count", () => {
    expect(usage.estimateCostUsd(record({ model: "model-z" }), TEST_PRICES)).toBeNull();
    expect(usage.estimateCostUsd(record({ inputTokens: null }), TEST_PRICES)).toBeNull();
    expect(usage.estimateCostUsd(record({ outputTokens: null }), TEST_PRICES)).toBeNull();
  });

  it("is null with an empty table, and priceTableFrom keys rows by model", () => {
    expect(usage.estimateCostUsd(record(), {})).toBeNull();
    expect(usage.priceTableFrom([{ model: "model-a", inputPerMtok: 2, outputPerMtok: 10, asOf: "2026-01-15" }])).toEqual({
      "model-a": { inputPerMtok: 2, outputPerMtok: 10, asOf: "2026-01-15" },
    });
    expect(usage.priceTableFrom([])).toEqual({});
  });
});

describe("recordUsage", () => {
  it("stores numbers and ids only (no content columns)", async () => {
    await usage.recordUsage(record(), TEST_PRICES);
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "LlmUsage"`);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "at",
        "estimatedCostUsd",
        "feature",
        "id",
        "inputTokens",
        "model",
        "outputTokens",
        "ownerId",
        "provider",
        "sessionId",
      ].sort(),
    );
    expect(rows[0]).toMatchObject({
      ownerId: "local",
      sessionId: "sess-1",
      feature: "report",
      provider: "anthropic",
      model: "model-a",
    });
    expect(Number(rows[0].inputTokens)).toBe(1_000_000);
    expect(Number(rows[0].outputTokens)).toBe(500_000);
    expect(rows[0].estimatedCostUsd).toBeCloseTo(7, 10);
  });

  it("uses the local owner when none is given and keeps a missing session null", async () => {
    await usage.recordUsage(record({ ownerId: undefined, sessionId: undefined, inputTokens: null }), TEST_PRICES);
    const row = await prisma.llmUsage.findFirstOrThrow();
    expect(row).toMatchObject({ ownerId: "local", sessionId: null, inputTokens: null, estimatedCostUsd: null });
  });

  it("swallows a database error and logs only the error class", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    class SecretDbError extends Error {
      name = "SecretDbError";
    }
    vi.spyOn(prisma.llmUsage, "create").mockRejectedValueOnce(new SecretDbError("okapi-detail"));
    await expect(usage.recordUsage(record(), TEST_PRICES)).resolves.toBeUndefined();
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("[usage]");
    expect(logged).toContain("SecretDbError");
    expect(logged).not.toContain("okapi-detail");
  });

  describe("with stored prices", () => {
    const savePrice = (over: Record<string, unknown> = {}) =>
      prisma.modelPrice.upsert({
        where: { ownerId_model: { ownerId: "local", model: "model-a" } },
        create: { ownerId: "local", model: "model-a", inputPerMtok: 2, outputPerMtok: 10, asOf: "2026-01-15", ...over },
        update: { inputPerMtok: 2, outputPerMtok: 10, asOf: "2026-01-15", ...over },
      });
    beforeEach(async () => {
      await prisma.modelPrice.deleteMany();
    });

    it("writes the computed cost from the owner's stored price", async () => {
      await savePrice();
      await usage.recordUsage(record());
      expect((await prisma.llmUsage.findFirstOrThrow()).estimatedCostUsd).toBeCloseTo(7, 10);
    });

    it("writes a null cost when there is no price row, or only another owner's", async () => {
      await prisma.modelPrice.create({
        data: { ownerId: "someone-else", model: "model-a", inputPerMtok: 2, outputPerMtok: 10, asOf: "2026-01-15" },
      });
      await usage.recordUsage(record());
      expect((await prisma.llmUsage.findFirstOrThrow()).estimatedCostUsd).toBeNull();
    });

    it("a price saved later changes only rows recorded later", async () => {
      await savePrice();
      await usage.recordUsage(record());
      await savePrice({ inputPerMtok: 4, outputPerMtok: 20 });
      await usage.recordUsage(record());
      const costs = (await prisma.llmUsage.findMany()).map((r) => r.estimatedCostUsd as number).sort((a, b) => a - b);
      expect(costs).toHaveLength(2);
      expect(costs[0]).toBeCloseTo(7, 10);
      expect(costs[1]).toBeCloseTo(14, 10);
    });

    it("records a null cost, does not throw and logs only the class when the lookup fails", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      class PriceDbError extends Error {
        name = "PriceDbError";
      }
      vi.spyOn(prisma.modelPrice, "findMany").mockRejectedValueOnce(new PriceDbError("secret-detail"));
      await expect(usage.recordUsage(record())).resolves.toBeUndefined();
      expect((await prisma.llmUsage.findFirstOrThrow()).estimatedCostUsd).toBeNull();
      const logged = error.mock.calls.flat().join(" ");
      expect(logged).toContain("[usage] price lookup failed: PriceDbError");
      expect(logged).not.toContain("secret-detail");
    });
  });
});

describe("summarizeUsage and usageForSession", () => {
  async function seed(over: Record<string, unknown>) {
    await prisma.llmUsage.create({
      data: {
        ownerId: "local",
        feature: "report",
        provider: "anthropic",
        model: "model-a",
        inputTokens: 100,
        outputTokens: 10,
        estimatedCostUsd: null,
        ...over,
      },
    });
  }

  it("groups by feature within the window, owner-scoped, summing only known costs", async () => {
    await seed({ feature: "conversation", sessionId: "s1", estimatedCostUsd: 0.5 });
    await seed({ feature: "conversation", sessionId: "s1", estimatedCostUsd: null, inputTokens: null });
    await seed({ feature: "report", sessionId: "s1", estimatedCostUsd: 0.25 });
    await seed({ feature: "persona-draft" });
    await seed({ feature: "report", ownerId: "someone-else", estimatedCostUsd: 9 });
    await seed({ feature: "report", at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), estimatedCostUsd: 9 });

    const s = await usage.summarizeUsage("local", 30, TEST_PRICES);
    expect(s.priceTableAsOf).toBe("2026-03-01");
    expect(s.byFeature).toEqual([
      { feature: "conversation", calls: 2, inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.5 },
      { feature: "persona-draft", calls: 1, inputTokens: 100, outputTokens: 10, estimatedCostUsd: null },
      { feature: "report", calls: 1, inputTokens: 100, outputTokens: 10, estimatedCostUsd: 0.25 },
    ]);
  });

  it("takes priceTableAsOf from the owner's stored prices (latest date, owner-scoped, null when none)", async () => {
    await prisma.modelPrice.deleteMany();
    expect((await usage.summarizeUsage("local", 30)).priceTableAsOf).toBeNull();
    await prisma.modelPrice.createMany({
      data: [
        { ownerId: "local", model: "model-a", inputPerMtok: 2, outputPerMtok: 10, asOf: "2026-01-15" },
        { ownerId: "local", model: "model-b", inputPerMtok: 1, outputPerMtok: 1, asOf: "2026-03-01" },
        { ownerId: "someone-else", model: "model-a", inputPerMtok: 1, outputPerMtok: 1, asOf: "2027-01-01" },
      ],
    });
    expect((await usage.summarizeUsage("local", 30)).priceTableAsOf).toBe("2026-03-01");
    expect((await usage.summarizeUsage("nobody", 30)).priceTableAsOf).toBeNull();
    await prisma.modelPrice.deleteMany();
  });

  it("returns a null priceTableAsOf when the price lookup fails, logging the class only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    class PriceDbError extends Error {
      name = "PriceDbError";
    }
    vi.spyOn(prisma.modelPrice, "findMany").mockRejectedValueOnce(new PriceDbError("secret-detail"));
    const s = await usage.summarizeUsage("local", 30);
    expect(s.priceTableAsOf).toBeNull();
    expect(Array.isArray(s.byFeature)).toBe(true);
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("PriceDbError");
    expect(logged).not.toContain("secret-detail");
  });

  it("usageForSession totals one session for its owner only", async () => {
    await seed({ feature: "conversation", sessionId: "s1", estimatedCostUsd: 0.5 });
    await seed({ feature: "report", sessionId: "s1", estimatedCostUsd: 0.25 });
    await seed({ feature: "report", sessionId: "s2", estimatedCostUsd: 1 });
    await seed({ feature: "report", sessionId: "s1", ownerId: "someone-else", estimatedCostUsd: 1 });
    expect(await usage.usageForSession("local", "s1")).toEqual({
      calls: 2,
      inputTokens: 200,
      outputTokens: 20,
      estimatedCostUsd: 0.75,
    });
    expect(await usage.usageForSession("local", "none")).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: null,
    });
  });
});
