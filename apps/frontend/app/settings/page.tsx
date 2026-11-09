"use client";

// Settings: the Claude model for each job, the reply length, the speech models, the spoken-reply
// format and the Claude prices. Edits stay in a local draft until Save; Save sends only what
// changed. Messages are fixed client text. Nothing here logs settings values.
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  NETWORK_MESSAGE,
  fetchSettings,
  resetSettings,
  saveSettings,
  type SettingsPage,
} from "../lib/settings";
import { primaryButtonStyle, secondaryButtonStyle } from "../lib/ui";
import { disabledStyle } from "../interviewers/edit/PhaseFields";
import { Shell, bodyStyle, panelStyle } from "../interviewers/edit/EditorParts";
import {
  NO_ERRORS,
  changedValueKeys,
  describeError,
  draftFromPage,
  errorsFromServer,
  mergeDraft,
  mergePrices,
  orderedErrorKeys,
  prepareSave,
  pricesChanged,
  valuesFromPage,
  type Draft,
  type Errors,
  type ValueKey,
} from "./draft";
import { ERROR_COLOR, hintStyle } from "./fields";
import { ModelsSection } from "./ModelsSection";
import { PricesSection, type PriceInput } from "./PricesSection";
import { SpeechSection } from "./SpeechSection";

const LOAD_FAILED = "The settings could not be loaded. Please try again.";
const SAVE_FAILED = "The settings could not be saved. Please try again.";
const RESET_FAILED = "The settings could not be reset. Please try again.";
const SAVED = "Settings saved.";
const RESET_DONE = "Settings reset to recommended.";
const RESET_PARTIAL = "Some model choices could not be reset because the model list could not be loaded.";

type Load = { kind: "loading" } | { kind: "failed"; message: string; attempt: number } | { kind: "ready" };
type Busy = "save" | "reset" | "reload-claude" | "reload-tts" | "retry-load" | null;
type FocusTo = "status" | "summary" | "title" | "models-heading" | "speech-heading" | "reset-confirm" | "reset-button";

const FOCUS_IDS: Record<FocusTo, string> = {
  status: "settings-status",
  summary: "error-summary-heading",
  title: "settings-title",
  "models-heading": "models-heading",
  "speech-heading": "speech-heading",
  "reset-confirm": "reset-confirm-text",
  "reset-button": "reset-button",
};

export default function SettingsPageView() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [page, setPage] = useState<SettingsPage | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState<{ message: string; n: number } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const busyRef = useRef<Busy>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  // Focus moves after the render that shows its target.
  const [focusTarget, setFocusTarget] = useState<{ to: FocusTo; n: number } | null>(null);

  useEffect(() => {
    if (focusTarget) document.getElementById(FOCUS_IDS[focusTarget.to])?.focus();
  }, [focusTarget]);

  const focus = useCallback((to: FocusTo) => setFocusTarget((f) => ({ to, n: (f?.n ?? 0) + 1 })), []);

  function start(b: Exclude<Busy, null>): boolean {
    if (busyRef.current) return false;
    busyRef.current = b;
    setBusy(b);
    return true;
  }
  function finish() {
    busyRef.current = null;
    setBusy(null);
  }

  function showFailure(message: string) {
    // Announced by role="alert"; focus stays where it is (callers move it when its control goes).
    setFailure((f) => ({ message, n: (f?.n ?? 0) + 1 }));
  }

  useEffect(() => {
    let cancelled = false;
    fetchSettings().then((r) => {
      if (cancelled) return;
      if (r.kind === "ok") {
        setPage(r.value);
        setDraft(draftFromPage(r.value));
        setLoad({ kind: "ready" });
      } else {
        setLoad({ kind: "failed", message: r.kind === "network" ? NETWORK_MESSAGE : LOAD_FAILED, attempt: 1 });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function retryLoad() {
    if (load.kind !== "failed" || !start("retry-load")) return;
    const attempt = load.attempt + 1;
    const r = await fetchSettings();
    finish();
    if (r.kind === "ok") {
      setPage(r.value);
      setDraft(draftFromPage(r.value));
      setLoad({ kind: "ready" });
      focus("title");
    } else {
      // A new attempt number remounts the alert so the same message is announced again.
      setLoad({ kind: "failed", message: r.kind === "network" ? NETWORK_MESSAGE : LOAD_FAILED, attempt });
    }
  }

  async function retryList(which: "claude" | "tts") {
    if (!page || !draft || !start(which === "claude" ? "reload-claude" : "reload-tts")) return;
    setStatus("");
    setFailure(null);
    const r = await fetchSettings();
    finish();
    if (r.kind !== "ok") {
      showFailure(r.kind === "network" ? NETWORK_MESSAGE : LOAD_FAILED);
      return;
    }
    setDraft(mergeDraft(draft, page, r.value));
    setPage(r.value);
    setErrors(NO_ERRORS);
    const loaded = which === "claude" ? r.value.claudeModels !== null : r.value.ttsModels !== null;
    if (which === "claude") setStatus(loaded ? "The model list loaded." : "The model list still could not be loaded.");
    else setStatus(loaded ? "The text-to-speech model list loaded." : "The text-to-speech model list still could not be loaded.");
    // The retry button goes once its list loads: move focus to the section heading.
    if (loaded) focus(which === "claude" ? "models-heading" : "speech-heading");
  }

  const dirty = page !== null && draft !== null && (changedValueKeys(draft, page).length > 0 || pricesChanged(draft, page));
  const locked = busy !== null;

  function clearFieldErrors(match: (key: string) => boolean) {
    setErrors((e) => {
      const keys = Object.keys(e.fields).filter(match);
      if (keys.length === 0) return e;
      const fields = { ...e.fields };
      for (const k of keys) delete fields[k];
      return { ...e, fields };
    });
  }

  function onValueChange(key: ValueKey, value: string) {
    if (busyRef.current) return;
    setDraft((d) => (d ? { ...d, values: { ...d.values, [key]: value } } : d));
    setStatus("");
    clearFieldErrors((k) => k === `values.${key}`);
  }

  function onPriceChange(row: number, field: PriceInput, value: string) {
    if (busyRef.current) return;
    setDraft((d) => (d ? { ...d, prices: d.prices.map((p, i) => (i === row ? { ...p, [field]: value } : p)) } : d));
    setStatus("");
    clearFieldErrors((k) => k === "prices" || k.startsWith(`prices.${row}.`));
  }

  function onClearRow(row: number) {
    if (busyRef.current || !draft) return;
    const model = draft.prices[row]?.model;
    setDraft((d) => (d ? { ...d, prices: d.prices.map((p, i) => (i === row ? { ...p, input: "", output: "", asOf: "" } : p)) } : d));
    clearFieldErrors((k) => k === "prices" || k.startsWith(`prices.${row}.`));
    setStatus(model ? `Price for ${model} cleared. Save to remove it.` : "");
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!page || !draft || !dirty || busyRef.current) return;
    setStatus("");
    setFailure(null);
    const prepared = prepareSave(draft, page);
    if (!prepared.ok) {
      setErrors(prepared.errors);
      focus("summary");
      return;
    }
    if (!start("save")) return;
    const r = await saveSettings(prepared.body);
    finish();
    if (r.kind === "ok") {
      setPage(r.value);
      setDraft(draftFromPage(r.value));
      setErrors(NO_ERRORS);
      setStatus(SAVED);
      focus("status");
    } else if (r.kind === "invalid") {
      setErrors(errorsFromServer(r.errors, prepared.sentRows));
      focus("summary");
    } else {
      setErrors(NO_ERRORS);
      showFailure(r.kind === "network" ? NETWORK_MESSAGE : SAVE_FAILED);
    }
  }

  function openReset() {
    if (busyRef.current) return;
    setConfirmReset(true);
    focus("reset-confirm");
  }

  function cancelReset() {
    if (busyRef.current) return;
    setConfirmReset(false);
    focus("reset-button");
  }

  function onConfirmKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelReset();
    }
  }

  async function confirmResetNow() {
    if (!page || !draft || !start("reset")) return;
    setStatus("");
    setFailure(null);
    const r = await resetSettings();
    finish();
    setConfirmReset(false);
    if (r.kind !== "ok") {
      showFailure(r.kind === "network" ? NETWORK_MESSAGE : RESET_FAILED);
      // The confirmation (and its Confirm button) is gone: return focus to the Reset button.
      focus("reset-button");
      return;
    }
    // Reset replaces the value choices; unsaved price edits are kept (prices are not reset).
    setDraft({ values: valuesFromPage(r.value), prices: mergePrices(draft, page, r.value) });
    setPage(r.value);
    setErrors(NO_ERRORS);
    const rec = r.value.recommended;
    const partial = rec.reply === null || rec.report === null || rec.draft === null;
    setStatus(partial ? `${RESET_DONE} ${RESET_PARTIAL}` : RESET_DONE);
    focus("status");
  }

  const title = (
    <h1
      id="settings-title"
      tabIndex={-1}
      style={{ fontSize: 30, fontWeight: 800, color: "#102B33", margin: "0 0 8px", letterSpacing: "-0.02em", outline: "none" }}
    >
      Settings
    </h1>
  );

  if (load.kind !== "ready" || !page || !draft) {
    return (
      <Shell>
        {title}
        {load.kind === "failed" ? (
          <div>
            {/* Only the message remounts on a new attempt, so the retry button keeps its focus. */}
            <p key={load.attempt} role="alert" style={{ ...bodyStyle, fontWeight: 700 }}>
              {load.message}
            </p>
            <button
              type="button"
              aria-disabled={locked ? true : undefined}
              onClick={() => void retryLoad()}
              style={disabledStyle(secondaryButtonStyle, locked)}
            >
              {busy === "retry-load" ? "Loading…" : "Try again"}
            </button>
          </div>
        ) : (
          <p role="status" style={hintStyle}>Loading settings…</p>
        )}
      </Shell>
    );
  }

  const summaryKeys = orderedErrorKeys(errors, draft);
  const showSummary = summaryKeys.length > 0 || errors.general.length > 0;
  const saveUnavailable = !dirty || locked;

  return (
    <Shell>
      {title}
      <p style={{ ...bodyStyle, marginBottom: 20 }}>
        The first time a model is needed, the app picks the recommended model for each job from the live list and
        remembers it. New models never change your choice; use Reset to recommended to pick again.
      </p>

      <div id="settings-status" role="status" tabIndex={-1} style={{ outline: "none" }}>
        {status && <p style={{ ...bodyStyle, fontWeight: 700 }}>{status}</p>}
      </div>

      {failure && (
        <p key={failure.n} id="settings-failure" role="alert" style={{ ...bodyStyle, color: ERROR_COLOR, fontWeight: 700 }}>
          Error: {failure.message}
        </p>
      )}

      {showSummary && (
        // No role="alert": focus moves to the heading, which reads it once (error-summary pattern).
        <div style={{ ...panelStyle, border: `2px solid ${ERROR_COLOR}` }}>
          <h2 id="error-summary-heading" tabIndex={-1} style={{ fontSize: 16, fontWeight: 700, color: "#102B33", margin: "0 0 8px", outline: "none" }}>
            Some settings were not saved
          </h2>
          <p style={bodyStyle}>Nothing you typed was cleared. Fix these and save again:</p>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {summaryKeys.map((k) => {
              const { label, target } = describeError(k, draft);
              return (
                <li key={k} style={{ ...bodyStyle, marginBottom: 4, overflowWrap: "anywhere" }}>
                  <a
                    href={`#${target}`}
                    onClick={(e) => {
                      const el = document.getElementById(target);
                      if (el) {
                        e.preventDefault();
                        el.focus();
                      }
                    }}
                    style={{ color: "#066C77", fontWeight: 600 }}
                  >
                    {label}: {errors.fields[k]}
                  </a>
                </li>
              );
            })}
            {errors.general.map((m) => (
              <li key={m} style={{ ...bodyStyle, marginBottom: 4 }}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={(e) => void onSave(e)} noValidate>
        <ModelsSection
          page={page}
          values={draft.values}
          errors={errors.fields}
          locked={locked}
          onChange={onValueChange}
          onRetryList={() => void retryList("claude")}
          retrying={busy === "reload-claude"}
        />
        <SpeechSection
          page={page}
          values={draft.values}
          errors={errors.fields}
          locked={locked}
          onChange={onValueChange}
          onRetryList={() => void retryList("tts")}
          retrying={busy === "reload-tts"}
        />
        <PricesSection rows={draft.prices} errors={errors.fields} locked={locked} onChange={onPriceChange} onClear={onClearRow} />

        <div style={{ borderTop: "1px solid #E2E6EA", paddingTop: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <button
              type="submit"
              aria-disabled={saveUnavailable ? true : undefined}
              aria-describedby={!dirty ? "save-hint" : undefined}
              style={disabledStyle(primaryButtonStyle, saveUnavailable)}
            >
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              id="reset-button"
              aria-expanded={confirmReset}
              aria-controls="reset-confirm"
              aria-disabled={locked ? true : undefined}
              onClick={openReset}
              style={disabledStyle(secondaryButtonStyle, locked)}
            >
              Reset to recommended
            </button>
          </div>
          {!dirty && (
            <p id="save-hint" style={{ ...hintStyle, marginTop: 10 }}>
              No changes to save.
            </p>
          )}

          <div id="reset-confirm">
            {confirmReset && (
              <div role="group" aria-labelledby="reset-confirm-text" onKeyDown={onConfirmKeyDown} style={{ ...panelStyle, marginTop: 16 }}>
                <p id="reset-confirm-text" tabIndex={-1} style={{ ...bodyStyle, fontWeight: 700, outline: "none" }}>
                  This replaces your model, reply length, speech and format choices with the recommended ones. Prices
                  are kept.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
                  <button
                    type="button"
                    aria-disabled={locked ? true : undefined}
                    onClick={() => void confirmResetNow()}
                    style={disabledStyle(primaryButtonStyle, locked)}
                  >
                    {busy === "reset" ? "Resetting…" : "Confirm"}
                  </button>
                  <button
                    type="button"
                    aria-disabled={locked ? true : undefined}
                    onClick={cancelReset}
                    style={disabledStyle(secondaryButtonStyle, locked)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </form>
    </Shell>
  );
}
