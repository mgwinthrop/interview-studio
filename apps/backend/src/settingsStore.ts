import prisma from "./db";
import { errName } from "./errors";
import { VALUE_FIELD_SCHEMAS, type PriceRow, type SettingsValues } from "./settings";

// Owner-scoped storage for settings and prices. Numbers, ids and format names only.

type ModelKey = "replyModel" | "reportModel" | "draftModel";

/** Keeps only known keys whose value passes the same field rule as a PUT; drops the rest. */
function sanitize(raw: unknown): Partial<SettingsValues> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(VALUE_FIELD_SCHEMAS)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const parsed = schema.safeParse((raw as Record<string, unknown>)[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as Partial<SettingsValues>;
}

/** What the owner has stored; {} when nothing, or when the row is unreadable. Never throws. */
export async function getStoredValues(ownerId: string): Promise<Partial<SettingsValues>> {
  try {
    const row = await prisma.appSettings.findUnique({ where: { ownerId } });
    if (!row) return {};
    return sanitize(JSON.parse(row.valuesJson));
  } catch (err) {
    console.error(`[settings] read failed: ${errName(err)}`);
    return {};
  }
}

async function writeMerged(ownerId: string, patch: Partial<SettingsValues>, onlyMissing: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.appSettings.findUnique({ where: { ownerId } });
    let current: Partial<SettingsValues> = {};
    try {
      current = row ? sanitize(JSON.parse(row.valuesJson)) : {};
    } catch {
      current = {};
    }
    const merged: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (onlyMissing && merged[k] !== undefined) continue;
      merged[k] = v;
    }
    const valuesJson = JSON.stringify(merged);
    await tx.appSettings.upsert({
      where: { ownerId },
      create: { ownerId, valuesJson },
      update: { valuesJson },
    });
  });
}

/** Merges `patch` into the stored values; untouched fields stay. The patch is already validated. */
export async function saveValues(ownerId: string, patch: Partial<SettingsValues>): Promise<void> {
  await writeMerged(ownerId, patch, false);
}

/** Stores a model only for fields that have no stored value yet; never overwrites a choice. */
export async function saveMissingModels(
  ownerId: string,
  models: Partial<Pick<SettingsValues, ModelKey>>,
): Promise<void> {
  const picked: Partial<SettingsValues> = {};
  for (const k of ["replyModel", "reportModel", "draftModel"] as const) {
    if (models[k] !== undefined) picked[k] = models[k];
  }
  if (Object.keys(picked).length === 0) return;
  await writeMerged(ownerId, picked, true);
}

export async function listPrices(ownerId: string): Promise<PriceRow[]> {
  const rows = await prisma.modelPrice.findMany({ where: { ownerId }, orderBy: { model: "asc" } });
  return rows.map((r) => ({
    model: r.model,
    inputPerMtok: r.inputPerMtok,
    outputPerMtok: r.outputPerMtok,
    asOf: r.asOf,
  }));
}

/** Makes the owner's prices exactly `rows`: upserts the listed ones, deletes the rest. */
export async function replacePrices(ownerId: string, rows: PriceRow[]): Promise<void> {
  await prisma.$transaction([
    prisma.modelPrice.deleteMany({ where: { ownerId, model: { notIn: rows.map((r) => r.model) } } }),
    ...rows.map((r) =>
      prisma.modelPrice.upsert({
        where: { ownerId_model: { ownerId, model: r.model } },
        create: { ownerId, ...r },
        update: { inputPerMtok: r.inputPerMtok, outputPerMtok: r.outputPerMtok, asOf: r.asOf },
      }),
    ),
  ]);
}

export async function deleteOwnerSettings(ownerId: string): Promise<void> {
  await prisma.$transaction([
    prisma.appSettings.deleteMany({ where: { ownerId } }),
    prisma.modelPrice.deleteMany({ where: { ownerId } }),
  ]);
}
