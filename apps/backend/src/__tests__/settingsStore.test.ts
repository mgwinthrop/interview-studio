import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const backendDir = path.resolve(__dirname, "../..");
let tmpDir: string;
let store: typeof import("../settingsStore");
let prisma: typeof import("../db").default;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "settings-store-test-"));
  const url = `file:${path.join(tmpDir, "test.db")}`;
  process.env.DATABASE_URL = url;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  store = await import("../settingsStore");
  prisma = (await import("../db")).default;
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.appSettings.deleteMany();
  await prisma.modelPrice.deleteMany();
});

const price = (model: string, over = {}) => ({ model, inputPerMtok: 1, outputPerMtok: 2, asOf: "2026-11-08", ...over });

describe("values", () => {
  it("reads {} when nothing is stored", async () => {
    expect(await store.getStoredValues("local")).toEqual({});
  });

  it("round trips and merges, keeping untouched fields", async () => {
    await store.saveValues("local", { replyModel: "a", replyMaxTokens: 120 });
    await store.saveValues("local", { replyMaxTokens: 200, sttModel: "s" });
    expect(await store.getStoredValues("local")).toEqual({ replyModel: "a", replyMaxTokens: 200, sttModel: "s" });
  });

  it("reads corrupt JSON as {}", async () => {
    for (const bad of ["{not json", "[1]", "null", "7"]) {
      await prisma.appSettings.upsert({
        where: { ownerId: "local" },
        create: { ownerId: "local", valuesJson: bad },
        update: { valuesJson: bad },
      });
      expect(await store.getStoredValues("local")).toEqual({});
    }
  });

  it("drops invalid and unknown stored keys but keeps valid ones", async () => {
    await prisma.appSettings.create({
      data: {
        ownerId: "local",
        valuesJson: JSON.stringify({ replyMaxTokens: 99999, spokenFormat: "bogus", sttModel: "has space", ttsModel: "ok", other: 1 }),
      },
    });
    expect(await store.getStoredValues("local")).toEqual({ ttsModel: "ok" });
  });

  it("saveMissingModels writes only absent fields", async () => {
    await store.saveValues("local", { replyModel: "keep" });
    await store.saveMissingModels("local", { replyModel: "new", reportModel: "r", draftModel: "d" });
    expect(await store.getStoredValues("local")).toEqual({ replyModel: "keep", reportModel: "r", draftModel: "d" });
    await store.saveMissingModels("fresh", {});
    expect(await store.getStoredValues("fresh")).toEqual({});
  });

  it("isolates owners", async () => {
    await store.saveValues("a", { replyModel: "ma" });
    await store.saveValues("b", { replyModel: "mb" });
    expect(await store.getStoredValues("a")).toEqual({ replyModel: "ma" });
    await store.deleteOwnerSettings("a");
    expect(await store.getStoredValues("a")).toEqual({});
    expect(await store.getStoredValues("b")).toEqual({ replyModel: "mb" });
  });
});

describe("prices", () => {
  it("upserts and deletes unlisted rows", async () => {
    await store.replacePrices("local", [price("m1"), price("m2")]);
    await store.replacePrices("local", [price("m2", { inputPerMtok: 9 }), price("m3")]);
    expect(await store.listPrices("local")).toEqual([price("m2", { inputPerMtok: 9 }), price("m3")]);
  });

  it("isolates owners and deleteOwnerSettings removes the owner's prices", async () => {
    await store.replacePrices("a", [price("m")]);
    await store.replacePrices("b", [price("m", { inputPerMtok: 5 })]);
    await store.replacePrices("a", []);
    expect(await store.listPrices("a")).toEqual([]);
    expect(await store.listPrices("b")).toHaveLength(1);
    await store.deleteOwnerSettings("b");
    expect(await store.listPrices("b")).toEqual([]);
  });
});
