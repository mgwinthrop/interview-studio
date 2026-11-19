import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

// Visible-state recorder and golden traces for the client session rebuild's oracle
// (FQ-108 phase 0, design §2.2 and §7; O3 and O4 in gate 2 §0.2).
//
// The screen is recorded per REGION, not as one global sequence: independent races (voice
// detection loading, the greeting) interleave differently from run to run, but within one
// region the order of states is stable. Each region keeps only changes (repeats collapsed)
// and records order, not timing.
//
// Golden files live in e2e/golden/<name>.json. A changed trace fails with a diff. To accept a
// change on purpose, run locally with UPDATE_GOLDEN=1, and list the changed entries in the PR
// (golden files are treated as existing tests: changing one needs an owner-approved reason).
// UPDATE_GOLDEN is refused when CI is set.

export const REGION_NAMES = ["panelStatus", "hearing", "paused", "endDialog", "warning", "typing", "overlay", "focus"] as const;
export type RegionName = (typeof REGION_NAMES)[number];
export type RegionTrace = Record<RegionName, string[]>;

type RegionWindow = Window & { __regions: RegionTrace };

/** Starts recording on every page load. Call before page.goto. */
export async function recordRegions(page: Page): Promise<{ stop(): Promise<RegionTrace> }> {
  await page.addInitScript((names: readonly string[]) => {
    const w = window as unknown as RegionWindow;
    w.__regions = Object.fromEntries(names.map((n) => [n, [] as string[]])) as RegionTrace;

    const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const read = (): Record<RegionName, string> => {
      const active = document.activeElement as HTMLElement | null;
      const focus =
        !active || active === document.body
          ? "body"
          : `${active.getAttribute("role") ?? active.tagName.toLowerCase()}:${(active.getAttribute("aria-label") ?? text(active)).slice(0, 40)}`;
      const overlay = document.querySelector('[role="alert"] > h2, [role="status"] > h2');
      return {
        panelStatus: document.querySelector(".interviewer-status-dot")?.getAttribute("data-state") ?? "none",
        hearing: document.querySelector(".interviewer-panel")?.getAttribute("data-hearing") ?? "none",
        paused: document.querySelector('[aria-labelledby="paused-title"]') ? "shown" : "hidden",
        endDialog: document.querySelector("dialog.end-confirm-dialog[open]") ? "open" : "closed",
        warning: text(document.querySelector(".session-hearing-alert")) || "none",
        typing: document.querySelector('[aria-label="Type your message"]') ? "open" : "closed",
        overlay: text(overlay) || "none",
        focus,
      };
    };
    const record = () => {
      const now = read();
      for (const name of Object.keys(now) as RegionName[]) {
        const list = w.__regions[name];
        if (list[list.length - 1] !== now[name]) list.push(now[name]);
      }
    };
    const start = () => {
      record();
      new MutationObserver(record).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      document.addEventListener("focusin", record, true);
      document.addEventListener("focusout", () => queueMicrotask(record), true);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }, REGION_NAMES);

  return {
    stop: () => page.evaluate(() => (window as unknown as RegionWindow).__regions),
  };
}

export interface GoldenTrace {
  /** Client→server frame types in order (O3), from proxySession's clientFrames(). */
  frames: string[];
  /** Per-region visible states in order (O4). */
  regions: RegionTrace;
}

const GOLDEN_DIR = path.join(__dirname, "..", "golden");

/** Compares the trace with e2e/golden/<name>.json; with UPDATE_GOLDEN=1 (never in CI) writes it instead. */
export async function expectGolden(name: string, trace: GoldenTrace): Promise<void> {
  const file = path.join(GOLDEN_DIR, `${name}.json`);
  if (process.env.UPDATE_GOLDEN === "1") {
    if (process.env.CI) throw new Error("UPDATE_GOLDEN is not allowed in CI: golden files change only in a reviewed PR.");
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(trace, null, 2) + "\n");
    return;
  }
  if (!fs.existsSync(file)) {
    throw new Error(`No golden trace at e2e/golden/${name}.json. Record it locally with UPDATE_GOLDEN=1 and review it.`);
  }
  const golden = JSON.parse(fs.readFileSync(file, "utf8")) as GoldenTrace;
  expect(trace.frames, `client frame order (O3) for ${name}`).toEqual(golden.frames);
  for (const region of REGION_NAMES) {
    expect(trace.regions[region], `visible states of region "${region}" (O4) for ${name}`).toEqual(golden.regions[region]);
  }
}
