// The editor's own form state. Turn counts are kept as the typed text and list rows carry a
// stable key, so reordering and half-typed numbers behave; inputFromForm turns it back into
// the API's InterviewerInput. The server validates everything again.
import type { InterviewerInput } from "../../lib/interviewers";

export interface FormPhase {
  key: number;
  name: string;
  instruction: string;
  minTurns: string;
  maxTurns: string;
}

export interface FormFocus {
  key: number;
  text: string;
}

export interface FormState {
  name: string;
  purpose: string;
  persona: string;
  style: string;
  opening: string;
  closing: string;
  phases: FormPhase[];
  focus: FormFocus[];
  contentFeedback: boolean;
  deliveryFeedback: boolean;
  voiceCloud: string;
}

export type TextKey = "name" | "purpose" | "persona" | "style" | "opening" | "closing";

/** Turn counts a phase gets when it stops being the last one. */
export const DEFAULT_MIN_TURNS = "1";
export const DEFAULT_MAX_TURNS = "3";

let nextKey = 1;
export function newKey(): number {
  return nextKey++;
}

export function formFromInput(input: InterviewerInput): FormState {
  const last = input.phases.length - 1;
  return {
    name: input.name,
    purpose: input.purpose,
    persona: input.persona,
    style: input.style,
    opening: input.opening,
    closing: input.closing,
    phases: input.phases.map((p, i) => ({
      key: newKey(),
      name: p.name,
      instruction: p.instruction,
      minTurns: i === last || p.minTurns === undefined ? "" : String(p.minTurns),
      maxTurns: i === last || p.maxTurns === undefined ? "" : String(p.maxTurns),
    })),
    focus: input.focus.map((text) => ({ key: newKey(), text })),
    contentFeedback: input.contentFeedback,
    deliveryFeedback: input.deliveryFeedback,
    voiceCloud: input.voice?.cloud ?? "",
  };
}

// Whole numbers only; anything else is sent as missing and the server says it is required.
// Three digits at most keeps a stored draft within the storage shape check.
function turnsValue(s: string): number | undefined {
  const t = s.trim();
  return /^\d{1,3}$/.test(t) ? Number(t) : undefined;
}

export function inputFromForm(f: FormState): InterviewerInput {
  const last = f.phases.length - 1;
  const voice = f.voiceCloud.trim();
  return {
    name: f.name,
    purpose: f.purpose,
    persona: f.persona,
    style: f.style,
    opening: f.opening,
    closing: f.closing,
    phases: f.phases.map((p, i) => {
      const min = i === last ? undefined : turnsValue(p.minTurns);
      const max = i === last ? undefined : turnsValue(p.maxTurns);
      return {
        name: p.name,
        instruction: p.instruction,
        ...(min !== undefined ? { minTurns: min } : {}),
        ...(max !== undefined ? { maxTurns: max } : {}),
      };
    }),
    focus: f.focus.map((x) => x.text),
    contentFeedback: f.contentFeedback,
    deliveryFeedback: f.deliveryFeedback,
    ...(voice ? { voice: { cloud: voice } } : {}),
  };
}

/** Everything the user can see, without row keys: equal signatures mean no unsaved edits. */
export function formSignature(f: FormState): string {
  return JSON.stringify({
    ...f,
    phases: f.phases.map((p) => [p.name, p.instruction, p.minTurns, p.maxTurns]),
    focus: f.focus.map((x) => x.text),
  });
}

/**
 * After phases are added, removed or moved: the last phase has no turn counts, and a phase that
 * has just stopped being last (both counts empty) gets the defaults.
 */
export function fixTurnFields(phases: FormPhase[]): FormPhase[] {
  const last = phases.length - 1;
  return phases.map((p, i) => {
    if (i === last) return p.minTurns === "" && p.maxTurns === "" ? p : { ...p, minTurns: "", maxTurns: "" };
    if (p.minTurns === "" && p.maxTurns === "") {
      return { ...p, minTurns: DEFAULT_MIN_TURNS, maxTurns: DEFAULT_MAX_TURNS };
    }
    return p;
  });
}

// ---- Error paths to fields ----

/** The DOM id of the input for an error path. */
export function fieldId(path: string): string {
  return "field-" + path.replace(/[^A-Za-z0-9]/g, "-");
}

const TOP_LABELS: Record<string, string> = {
  name: "Name",
  purpose: "Purpose",
  persona: "Persona",
  style: "Style",
  opening: "Opening",
  closing: "Closing",
  phases: "Phases",
  focus: "Focus",
  contentFeedback: "Feedback",
  deliveryFeedback: "Feedback",
  voice: "Cloud voice id",
  "voice.cloud": "Cloud voice id",
  version: "Version",
};

const PHASE_PART_LABELS: Record<string, string> = {
  name: "name",
  instruction: "instruction",
  minTurns: "minimum user turns",
  maxTurns: "maximum user turns",
};

/** A readable name for an error path ("Phase 2 name"), or null for the form as a whole. */
export function labelForPath(path: string): string | null {
  if (path === "") return null;
  if (path in TOP_LABELS) return TOP_LABELS[path];
  const phase = /^phases\.(\d+)(?:\.(\w+))?$/.exec(path);
  if (phase) {
    const n = Number(phase[1]) + 1;
    const part = phase[2] ? PHASE_PART_LABELS[phase[2]] : undefined;
    return part ? `Phase ${n} ${part}` : `Phase ${n}`;
  }
  const focus = /^focus\.(\d+)$/.exec(path);
  if (focus) return `Focus item ${Number(focus[1]) + 1}`;
  return "Form";
}

/**
 * The id of the element an error belongs to, when the form shows one (so the summary can link
 * to it), or null when the error is only in the summary.
 */
export function targetIdForPath(path: string, f: FormState): string | null {
  if (["name", "purpose", "persona", "style", "opening", "closing", "phases", "focus"].includes(path)) {
    return fieldId(path);
  }
  if (path === "contentFeedback" || path === "deliveryFeedback") return fieldId("contentFeedback");
  if (path === "voice" || path === "voice.cloud") return fieldId("voice.cloud");
  const last = f.phases.length - 1;
  const phase = /^phases\.(\d+)(?:\.(\w+))?$/.exec(path);
  if (phase) {
    const i = Number(phase[1]);
    if (i > last) return null;
    const part = phase[2];
    if (part === undefined) return fieldId(`phases.${i}.name`);
    if (part === "name" || part === "instruction") return fieldId(path);
    if ((part === "minTurns" || part === "maxTurns") && i !== last) return fieldId(path);
    return fieldId(`phases.${i}.name`);
  }
  const focus = /^focus\.(\d+)$/.exec(path);
  if (focus && Number(focus[1]) < f.focus.length) return fieldId(path);
  return null;
}
