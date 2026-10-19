import { randomUUID } from "node:crypto";
import type { Interviewer as Row, Prisma } from "@prisma/client";
import prisma from "./db";
import {
  ID_SHAPE,
  INTERVIEWER_LIMITS,
  SYSTEM_OWNER,
  parseInterviewerDefinition,
  type InterviewerDefinition,
  type InterviewerInput,
  type InterviewerSummary,
} from "./interviewer/schema";
import { DESIGNER_ID } from "./interviewer/presets/designer";

// Presets (source "preset", owner "system") are visible to every owner and writable by none.
// A custom interviewer is visible only to its owner: every query below goes through visibleTo
// or filters on { ownerId, source: "custom" }. Nothing here logs interviewer text.

/** Most custom interviewers one owner may hold. */
export const MAX_CUSTOM_PER_OWNER = 50;

const COPY_SUFFIX = " (copy)";

export class InterviewerLimitError extends Error {
  constructor() {
    super(`limit of ${MAX_CUSTOM_PER_OWNER} custom interviewers reached`);
    this.name = "InterviewerLimitError";
  }
}

/** A preset failed validation. The message names the preset id (or index) and field paths only. */
export class PresetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresetValidationError";
  }
}

export type UpdateResult =
  | { status: "ok"; value: InterviewerDefinition }
  | { status: "not_found" | "conflict" | "preset" };

function visibleTo(id: string, ownerId: string): Prisma.InterviewerWhereInput {
  return {
    id,
    OR: [
      { source: "preset", ownerId: SYSTEM_OWNER },
      { source: "custom", ownerId },
    ],
  };
}

/**
 * The stored record, or null when definitionJson is unparsable, invalid, or disagrees with the
 * row's identity columns. Never throws and never logs the stored text.
 */
function toRecord(row: Row): InterviewerDefinition | null {
  try {
    const def = parseInterviewerDefinition(JSON.parse(row.definitionJson));
    if (
      def.id !== row.id ||
      def.ownerId !== row.ownerId ||
      def.source !== row.source ||
      def.version !== row.version
    ) {
      return null;
    }
    return def;
  } catch {
    return null;
  }
}

/** Copies only the input fields, so identity fields smuggled into `input` are dropped. */
function inputFields(input: InterviewerInput): InterviewerInput {
  const out: InterviewerInput = {
    name: input.name,
    purpose: input.purpose,
    persona: input.persona,
    style: input.style,
    opening: input.opening,
    closing: input.closing,
    phases: input.phases,
    focus: input.focus,
    contentFeedback: input.contentFeedback,
    deliveryFeedback: input.deliveryFeedback,
  };
  if (input.voice !== undefined) out.voice = input.voice;
  return out;
}

/** Builds and validates a custom record; throws (paths only) if the result is invalid. */
function customRecord(
  input: InterviewerInput,
  meta: { id: string; ownerId: string; version: number; createdAt: string; updatedAt: string },
): InterviewerDefinition {
  return parseInterviewerDefinition({ ...inputFields(input), source: "custom", ...meta });
}

function columns(def: InterviewerDefinition) {
  return {
    ownerId: def.ownerId,
    source: def.source,
    name: def.name,
    purpose: def.purpose,
    version: def.version,
    definitionJson: JSON.stringify(def),
    createdAt: new Date(def.createdAt),
    updatedAt: new Date(def.updatedAt),
  };
}

function byName(a: InterviewerSummary, b: InterviewerSummary): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** Presets (except the hidden designer), then the owner's custom interviewers, each ordered by name. Corrupt rows are skipped. */
export async function listInterviewers(ownerId: string): Promise<InterviewerSummary[]> {
  const rows = await prisma.interviewer.findMany({
    where: {
      id: { not: DESIGNER_ID },
      OR: [{ source: "preset", ownerId: SYSTEM_OWNER }, { source: "custom", ownerId }],
    },
  });
  const summaries = rows.flatMap((row) => {
    const def = toRecord(row);
    if (!def) return [];
    const { id, name, purpose, source, version } = def;
    return [{ id, name, purpose, source, version }];
  });
  return [
    ...summaries.filter((s) => s.source === "preset").sort(byName),
    ...summaries.filter((s) => s.source === "custom").sort(byName),
  ];
}

/** A preset for anyone; a custom interviewer only for its owner. Null otherwise or if corrupt. */
export async function getInterviewer(id: string, ownerId: string): Promise<InterviewerDefinition | null> {
  const row = await prisma.interviewer.findFirst({ where: visibleTo(id, ownerId) });
  return row ? toRecord(row) : null;
}

/** Creates a custom interviewer with a new UUID at version 1. Throws InterviewerLimitError at the cap. */
export async function createInterviewer(
  ownerId: string,
  input: InterviewerInput,
): Promise<InterviewerDefinition> {
  if (ownerId === SYSTEM_OWNER) throw new Error("custom interviewers cannot be owned by system");
  const now = new Date().toISOString();
  const def = customRecord(input, { id: randomUUID(), ownerId, version: 1, createdAt: now, updatedAt: now });
  // Count and insert in one transaction so the cap is not overshot by concurrent creates.
  await prisma.$transaction(async (tx) => {
    const count = await tx.interviewer.count({ where: { ownerId, source: "custom" } });
    if (count >= MAX_CUSTOM_PER_OWNER) throw new InterviewerLimitError();
    await tx.interviewer.create({ data: { id: def.id, ...columns(def) } });
  });
  return def;
}

/**
 * Replaces the owner's custom interviewer if it is still at expectedVersion; the version goes up
 * by one. The version check is part of the write itself, so concurrent updates cannot both win.
 */
export async function updateInterviewer(
  id: string,
  ownerId: string,
  input: InterviewerInput,
  expectedVersion: number,
): Promise<UpdateResult> {
  const row = await prisma.interviewer.findFirst({ where: visibleTo(id, ownerId) });
  if (!row) return { status: "not_found" };
  if (row.source === "preset") return { status: "preset" };
  if (row.version !== expectedVersion) return { status: "conflict" };

  const def = customRecord(input, {
    id,
    ownerId,
    version: expectedVersion + 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const { count } = await prisma.interviewer.updateMany({
    where: { id, ownerId, source: "custom", version: expectedVersion },
    data: columns(def),
  });
  if (count === 1) return { status: "ok", value: def };
  // Lost a race: another update bumped the version, or a delete removed the row.
  const still = await prisma.interviewer.count({ where: { id, ownerId, source: "custom" } });
  return { status: still > 0 ? "conflict" : "not_found" };
}

/** `<name> (copy)`, with the name shortened (by whole code points) to keep within the cap. */
function copyName(name: string): string {
  const chars = Array.from(name);
  while (chars.join("").length + COPY_SUFFIX.length > INTERVIEWER_LIMITS.name) chars.pop();
  return `${chars.join("").trimEnd()}${COPY_SUFFIX}`;
}

/** Creates the owner's custom copy of any interviewer visible to them; null if not visible. */
export async function duplicateInterviewer(
  id: string,
  ownerId: string,
): Promise<InterviewerDefinition | null> {
  if (id === DESIGNER_ID) return null;
  const source = await getInterviewer(id, ownerId);
  if (!source) return null;
  return createInterviewer(ownerId, { ...inputFields(source), name: copyName(source.name) });
}

/** Deletes the owner's custom interviewer. Sessions keep their own snapshot and are unaffected. */
export async function deleteInterviewer(
  id: string,
  ownerId: string,
): Promise<"deleted" | "not_found" | "preset"> {
  const row = await prisma.interviewer.findFirst({
    where: visibleTo(id, ownerId),
    select: { source: true },
  });
  if (!row) return "not_found";
  if (row.source === "preset") return "preset";
  const { count } = await prisma.interviewer.deleteMany({ where: { id, ownerId, source: "custom" } });
  return count > 0 ? "deleted" : "not_found";
}


function presetLabel(raw: unknown, index: number): string {
  const id = (raw as { id?: unknown } | null)?.id;
  return typeof id === "string" && ID_SHAPE.test(id) ? id : `#${index}`;
}

/** Validates every preset; throws PresetValidationError (id and field paths only) on the first bad one. */
function validatePresets(presets: readonly InterviewerDefinition[]): InterviewerDefinition[] {
  const seen = new Set<string>();
  return presets.map((raw, i) => {
    const label = presetLabel(raw, i);
    let def: InterviewerDefinition;
    try {
      def = parseInterviewerDefinition(raw);
    } catch (err) {
      // parseInterviewerDefinition's message lists field paths only.
      const detail = err instanceof Error ? err.message : "invalid";
      throw new PresetValidationError(`Preset ${label}: ${detail}`);
    }
    const bad: string[] = [];
    if (def.source !== "preset") bad.push("source");
    if (def.ownerId !== SYSTEM_OWNER) bad.push("ownerId");
    if (seen.has(def.id)) bad.push("id (duplicate)");
    if (bad.length > 0) {
      throw new PresetValidationError(`Preset ${label}: Invalid interviewer definition: ${bad.join(", ")}`);
    }
    seen.add(def.id);
    return def;
  });
}

/**
 * Makes the preset rows match `presets`: inserts new ones, updates changed ones and removes
 * preset rows whose ids are gone. Everything is validated before anything is written, and the
 * writes run in one transaction. Custom interviewers and sessions are never touched.
 */
export async function syncPresets(
  presets: readonly InterviewerDefinition[],
): Promise<{ inserted: number; updated: number; removed: number }> {
  const defs = validatePresets(presets);
  return prisma.$transaction(async (tx) => {
    let inserted = 0;
    let updated = 0;
    for (const def of defs) {
      const data = columns(def);
      const existing = await tx.interviewer.findUnique({ where: { id: def.id } });
      if (!existing) {
        await tx.interviewer.create({ data: { id: def.id, ...data } });
        inserted++;
        continue;
      }
      if (existing.source !== "preset") {
        throw new PresetValidationError(`Preset ${def.id}: id is taken by a custom interviewer`);
      }
      const same =
        existing.definitionJson === data.definitionJson &&
        existing.ownerId === data.ownerId &&
        existing.name === data.name &&
        existing.purpose === data.purpose &&
        existing.version === data.version &&
        existing.createdAt.getTime() === data.createdAt.getTime() &&
        existing.updatedAt.getTime() === data.updatedAt.getTime();
      if (!same) {
        await tx.interviewer.update({ where: { id: def.id }, data });
        updated++;
      }
    }
    const { count: removed } = await tx.interviewer.deleteMany({
      where: { source: "preset", id: { notIn: defs.map((d) => d.id) } },
    });
    return { inserted, updated, removed };
  });
}
