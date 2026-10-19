"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DESIGNER_ID,
  createInterviewer,
  deleteInterviewer,
  duplicateInterviewer,
  fetchInterviewer,
  updateInterviewer,
  type ApiResult,
  type InterviewerDetail,
  type InterviewerInput,
} from "../../lib/interviewers";
import {
  DEFAULT_RETURN_TO,
  INTERVIEWER_LIMITS,
  clearDraft,
  clearDraftFor,
  editPathFor,
  emptyInput,
  errorsByPath,
  inputFromDetail,
  parseDraftInput,
  peekDraft,
  storeDraft,
} from "../../lib/interviewerForm";
import { startVoiceSession } from "../../lib/voiceSession";
import { ErrorText, TextField, hintStyle, primaryButtonStyle, secondaryButtonStyle } from "./FieldRow";
import { FocusFields, PhaseFields, disabledStyle, sectionHeadingStyle } from "./PhaseFields";
import {
  ActionBar,
  FailureMessage,
  LIST_PATH,
  NOT_FOUND_MESSAGE,
  Shell,
  Switch,
  bodyStyle,
  panelStyle,
  type Busy,
  type Failure,
} from "./EditorParts";
import {
  fieldId,
  formFromInput,
  formSignature,
  inputFromForm,
  type FormState,
  type TextKey,
} from "./formState";

const AUTOSAVE_DELAY_MS = 400;
const LEAVE_MESSAGE = "Leave without saving? Your changes to this interviewer will be lost.";
const STORAGE_MESSAGE =
  "Try it could not start because this browser is not letting the page keep a draft. Nothing is lost; you can still save.";
const PRESET_MESSAGE = "Presets can't be edited. Duplicate it to make your own copy.";
// The schema allows a cloud voice id of 10 to 40 letters and digits (voice.cloud).
const VOICE_MAX_CHARS = 40;

// A status to show once the editor has moved to another record's URL (after create or
// duplicate the page remounts, so local state does not survive the move).
let pendingNotice: { id: string; text: string } | null = null;

type Source = { kind: "id"; id: string } | { kind: "draft" } | { kind: "blank" };

type Loaded = {
  form: FormState;
  baseline: FormState;
  record: InterviewerDetail | null;
  /**
   * The version a Save sends (PUT): the version these edits started from. Usually the record's,
   * but for edits restored from Try it it is the draft's base version, so a save made elsewhere
   * in the meantime still gives a 409. Null for a new interviewer.
   */
  putVersion: number | null;
  note: "draft" | "draft_missing" | "restored" | null;
};

const TEXT_FIELDS: { key: TextKey; label: string; rows?: number; hint: string }[] = [
  { key: "name", label: "Name", hint: "Shown in the list of interviewers." },
  { key: "purpose", label: "Purpose", rows: 2, hint: "One or two sentences on what this interviewer is for." },
  { key: "persona", label: "Persona", rows: 6, hint: "Who the interviewer is, written to the interviewer (\"You are…\")." },
  { key: "style", label: "Style", rows: 4, hint: "How the interviewer asks questions and responds." },
  { key: "opening", label: "Opening", rows: 3, hint: "Guidance for how the interviewer starts. Not a script." },
  { key: "closing", label: "Closing", rows: 3, hint: "Guidance for how the interviewer ends. Not a script." },
];

function Editor({ source }: { source: Source }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "error" | "not_found" | "ready">("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const messageRef = useRef<HTMLDivElement>(null);
  // The stored draft is read once per mount: StrictMode runs effects twice, and the second run
  // must not set the form again (edits typed in between would be overwritten).
  const draftReadRef = useRef(false);
  // Autosave of a new form that came from a draft: the edits waiting to be written, and a stop
  // switch set once the draft is saved (the create clears it; nothing may write it back).
  const pendingDraftRef = useRef<InterviewerInput | null>(null);
  const autosaveStoppedRef = useRef(false);

  const form = loaded?.form ?? null;
  const record = loaded?.record ?? null;
  const readOnly = record?.source === "preset";
  // A new form that came from a draft has never been saved, so it always counts as unsaved.
  const dirty =
    loaded !== null &&
    !readOnly &&
    ((record === null && loaded.note === "draft") || formSignature(loaded.form) !== formSignature(loaded.baseline));

  // Load the form: a stored record, a stored draft, or a blank form.
  useEffect(() => {
    if (source.kind === "blank") {
      const f = formFromInput(emptyInput());
      setLoaded({ form: f, baseline: f, record: null, putVersion: null, note: null });
      setLoadState("ready");
      return;
    }
    if (source.kind === "draft") {
      if (draftReadRef.current) return;
      draftReadRef.current = true;
      // The draft is only peeked (from the designer and back from Try it alike), so leaving the
      // page by a link and coming back, a second Try it, or a reload still finds it. A Save
      // clears it (see save()).
      const stored = peekDraft();
      const f = formFromInput(stored ? stored.input : emptyInput());
      setLoaded({ form: f, baseline: f, record: null, putVersion: null, note: stored ? "draft" : "draft_missing" });
      setLoadState("ready");
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    fetchInterviewer(source.id)
      .then((found) => {
        if (cancelled) return;
        // The hidden designer is not an interviewer anyone can view, edit or duplicate here.
        if (!found || found.id === DESIGNER_ID) {
          setLoadState("not_found");
          return;
        }
        const baseline = formFromInput(inputFromDetail(found));
        // Back from Try it on this interviewer: the tried edits are in the stored draft. They are
        // consumed here (held only in state from now on), so they never come back on a later
        // visit; one without a base version, or with no edits, is dropped.
        const stored = found.source === "custom" ? peekDraft() : null;
        let restoredForm: FormState | null = null;
        let restoredVersion: number | null = null;
        if (stored && stored.returnTo === editPathFor(found.id)) {
          clearDraft();
          const f = formFromInput(stored.input);
          if (stored.baseVersion !== undefined && formSignature(f) !== formSignature(baseline)) {
            restoredForm = f;
            restoredVersion = stored.baseVersion;
          }
        }
        setLoaded({
          form: restoredForm ?? baseline,
          baseline,
          record: found,
          putVersion: restoredVersion ?? found.version,
          note: restoredForm ? "restored" : null,
        });
        if (pendingNotice?.id === found.id) {
          setNotice(pendingNotice.text);
          pendingNotice = null;
        }
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]); // the source is fixed for this mount (the page remounts on a new URL)

  // Keep the edits of a draft form across in-app navigation and reloads: write them to the stored
  // draft a moment after the last change, and flush a waiting write on unmount and page hide.
  // Only a new form from a draft does this; an existing record's stored draft belongs to Try it.
  const autosaveOn = loaded !== null && loaded.record === null && loaded.note === "draft";
  const autosaveForm = autosaveOn ? loaded?.form ?? null : null;
  useEffect(() => {
    if (!autosaveOn) return;
    const flush = () => {
      const input = pendingDraftRef.current;
      pendingDraftRef.current = null;
      if (input && !autosaveStoppedRef.current) storeDraft(input, DEFAULT_RETURN_TO); // a failure is silent
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [autosaveOn]);
  useEffect(() => {
    if (!autosaveForm) return;
    const input = inputFromForm(autosaveForm);
    if (!parseDraftInput(input)) {
      pendingDraftRef.current = null;
      return;
    }
    pendingDraftRef.current = input;
    const timer = window.setTimeout(() => {
      const waiting = pendingDraftRef.current;
      pendingDraftRef.current = null;
      if (waiting && !autosaveStoppedRef.current) storeDraft(waiting, DEFAULT_RETURN_TO);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [autosaveForm]);

  // Unsaved-edit guard for in-app links: a plain click on an internal link asks first.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!(e.target instanceof Element)) return;
      const a = e.target.closest("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      if (a.target === "_blank" || a.hasAttribute("download") || a.origin !== window.location.origin) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  // Unsaved-edit guard for reloads, closing the tab and leaving the site.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // After a failed action the message (the error summary for a 422) takes the focus.
  useEffect(() => {
    if (focusToken > 0) messageRef.current?.focus();
  }, [focusToken]);

  function setForm(update: (f: FormState) => FormState) {
    setLoaded((l) => (l ? { ...l, form: update(l.form) } : l));
    setNotice(null);
  }

  // Indexes change when a list is restructured, so its old errors no longer point anywhere.
  function dropErrors(prefix: string) {
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([p]) => p !== prefix && !p.startsWith(prefix + "."))));
  }

  function fail(f: Failure) {
    setFailure(f);
    setFocusToken((n) => n + 1);
  }

  function failFrom(r: Exclude<ApiResult<unknown>, { ok: true }>, invalidTitle: string) {
    if (r.kind === "invalid") {
      setErrors(errorsByPath(r.errors));
      if (r.errors.some((e) => e.path === "voice" || e.path.startsWith("voice."))) setAdvancedOpen(true);
      fail({ kind: "invalid", title: invalidTitle, errors: r.errors });
    } else if (r.kind === "conflict") {
      fail({ kind: "conflict" });
    } else if (r.kind === "not_found") {
      fail({ kind: "not_found" });
    } else {
      fail({ kind: "message", text: r.message });
    }
  }

  function startAction(b: Busy) {
    setBusy(b);
    setFailure(null);
    setNotice(null);
    setConfirmDelete(false);
  }

  function showRecord(saved: InterviewerDetail, text: string) {
    const f = formFromInput(inputFromDetail(saved));
    setLoaded({ form: f, baseline: f, record: saved, putVersion: saved.version, note: null });
    setErrors({});
    setNotice(text);
  }

  async function save() {
    if (!loaded || !form || busy || readOnly) return;
    startAction("save");
    setErrors({});
    const input = inputFromForm(form);
    const r = record
      ? await updateInterviewer(record.id, loaded.putVersion ?? record.version, input)
      : await createInterviewer(input);
    setBusy(null);
    if (!r.ok) {
      failFrom(r, "The interviewer was not saved.");
      return;
    }
    // A new form from a draft: that draft is saved now, so a later visit must not bring it
    // back. Any other stored draft (a pending Try it elsewhere) is left alone.
    if (record === null && loaded.note === "draft") {
      autosaveStoppedRef.current = true;
      pendingDraftRef.current = null;
      clearDraft();
    }
    if (!record) {
      pendingNotice = { id: r.value.id, text: "Saved." };
      router.replace(editPathFor(r.value.id));
      return;
    }
    showRecord(r.value, "Saved.");
  }

  function tryIt() {
    if (!loaded || !form || readOnly) return;
    const returnTo = record ? editPathFor(record.id) : DEFAULT_RETURN_TO;
    // The base version goes with the draft so the Save after the trial is still version-checked.
    const baseVersion = record ? loaded.putVersion ?? record.version : undefined;
    if (!storeDraft(inputFromForm(form), returnTo, baseVersion)) {
      fail({ kind: "message", text: STORAGE_MESSAGE });
      return;
    }
    // Through the mic check first unless it has just passed (the session page starts the
    // microphone only then); the check comes back to the trial. The draft stays stored.
    startVoiceSession(router, "/session?mode=try");
  }

  async function duplicate() {
    if (!record || busy) return;
    if (dirty && !window.confirm("Duplicate copies the last saved version. Your unsaved edits here will be lost.")) {
      return;
    }
    // The edits here are given up; a stored Try it draft of them must not come back either.
    clearDraftFor(editPathFor(record.id));
    startAction("duplicate");
    const r = await duplicateInterviewer(record.id);
    setBusy(null);
    if (!r.ok) {
      failFrom(r, "The copy was not made.");
      return;
    }
    pendingNotice = { id: r.value.id, text: "Copy made. Edit it and save." };
    router.push(editPathFor(r.value.id));
  }

  async function remove() {
    if (!record || busy) return;
    startAction("delete");
    const r = await deleteInterviewer(record.id);
    setBusy(null);
    if (!r.ok) {
      failFrom(r, "The interviewer was not deleted.");
      return;
    }
    clearDraftFor(editPathFor(record.id));
    router.push(LIST_PATH);
  }

  // After a 409: load the stored version, dropping the edits here (the user chose Reload).
  async function reload() {
    if (!record || busy) return;
    startAction("reload");
    let found: InterviewerDetail | null;
    try {
      found = await fetchInterviewer(record.id);
    } catch {
      setBusy(null);
      fail({ kind: "message", text: "Could not reach the server. Your edits are still here." });
      return;
    }
    setBusy(null);
    if (!found) {
      fail({ kind: "not_found" });
      return;
    }
    showRecord(found, "Reloaded the latest version.");
  }

  function discardRestored() {
    // The draft was consumed on load; only the state copy is left to drop.
    setLoaded((l) => (l ? { ...l, form: l.baseline, putVersion: l.record?.version ?? null, note: null } : l));
    setErrors({});
  }

  if (loadState === "loading") {
    return (
      <Shell>
        <p role="status" style={hintStyle}>Loading the interviewer…</p>
      </Shell>
    );
  }
  if (loadState === "error") {
    return (
      <Shell>
        <div role="alert">
          <p style={bodyStyle}>Could not load the interviewer. Check your connection, then try again.</p>
          <div style={{ display: "flex", gap: 12 }}>
            <button type="button" onClick={() => setLoadAttempt((n) => n + 1)} style={primaryButtonStyle}>
              Try again
            </button>
            <Link href={LIST_PATH} style={secondaryButtonStyle}>All interviewers</Link>
          </div>
        </div>
      </Shell>
    );
  }
  if (loadState === "not_found" || !loaded || !form) {
    return (
      <Shell>
        <div role="alert">
          <p style={bodyStyle}>{NOT_FOUND_MESSAGE}</p>
          <Link href={LIST_PATH} style={primaryButtonStyle}>All interviewers</Link>
        </div>
      </Shell>
    );
  }

  const title = readOnly ? form.name : record ? "Edit interviewer" : "New interviewer";
  const feedbackError = errors.contentFeedback ?? errors.deliveryFeedback;
  const voiceError = errors["voice.cloud"] ?? errors.voice;
  const disabled = busy !== null;

  return (
    <Shell>
      <Link href={LIST_PATH} style={{ fontSize: 14, color: "#087E8B", fontWeight: 600 }}>
        ← All interviewers
      </Link>
      <h1 dir="auto" style={{ fontSize: 30, fontWeight: 800, color: "#102B33", margin: "12px 0 8px", letterSpacing: "-0.02em", overflowWrap: "anywhere" }}>
        {title}
      </h1>

      {readOnly && (
        <div style={panelStyle}>
          <p style={bodyStyle}>{PRESET_MESSAGE}</p>
          <button type="button" onClick={duplicate} disabled={disabled} style={disabledStyle(primaryButtonStyle, disabled)}>
            {busy === "duplicate" ? "Duplicating…" : "Duplicate"}
          </button>
        </div>
      )}
      {!readOnly && record === null && loaded.note === "draft" && (
        <p style={{ ...bodyStyle, ...panelStyle }}>Review this draft. Nothing is saved until you press Save.</p>
      )}
      {loaded.note === "draft_missing" && (
        <p style={{ ...bodyStyle, ...panelStyle }}>The draft could not be opened, so this is a blank form.</p>
      )}
      {loaded.note === "restored" && (
        <div style={panelStyle}>
          <p style={bodyStyle}>Your edits from Try it are back. Nothing is saved until you press Save, and reloading the page drops them.</p>
          <button type="button" onClick={discardRestored} disabled={disabled} style={disabledStyle(secondaryButtonStyle, disabled)}>
            Discard these edits
          </button>
        </div>
      )}

      <div role="status">
        {notice && <p style={{ ...bodyStyle, ...panelStyle, fontWeight: 700 }}>{notice}</p>}
      </div>

      {failure && (
        <div ref={messageRef} tabIndex={-1} role="alert" style={{ ...panelStyle, borderColor: "#B42318", borderWidth: 2 }}>
          <FailureMessage failure={failure} form={form} />
          {failure.kind === "conflict" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
              <button type="button" onClick={reload} disabled={disabled} style={disabledStyle(primaryButtonStyle, disabled)}>
                {busy === "reload" ? "Reloading…" : "Reload"}
              </button>
              <button type="button" onClick={() => setFailure(null)} style={secondaryButtonStyle}>
                Keep editing
              </button>
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        {TEXT_FIELDS.map((f) => (
          <TextField
            key={f.key}
            path={f.key}
            label={f.label}
            hint={readOnly ? undefined : f.hint}
            value={form[f.key]}
            maxLength={INTERVIEWER_LIMITS[f.key]}
            rows={f.rows}
            onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))}
            error={errors[f.key]}
            readOnly={readOnly}
          />
        ))}

        <PhaseFields
          phases={form.phases}
          errors={errors}
          readOnly={readOnly}
          onChange={(phases, structural) => {
            if (structural) dropErrors("phases");
            setForm((s) => ({ ...s, phases }));
          }}
        />

        <FocusFields
          focus={form.focus}
          errors={errors}
          readOnly={readOnly}
          onChange={(focus, structural) => {
            if (structural) dropErrors("focus");
            setForm((s) => ({ ...s, focus }));
          }}
        />

        <section aria-labelledby="feedback-heading" style={{ marginBottom: 28 }}>
          <h2 id="feedback-heading" style={sectionHeadingStyle}>Feedback in the report</h2>
          <Switch
            id={fieldId("contentFeedback")}
            label="Written feedback on content"
            checked={form.contentFeedback}
            disabled={readOnly}
            describedBy={feedbackError ? "feedback-error" : undefined}
            onChange={(v) => setForm((s) => ({ ...s, contentFeedback: v }))}
          />
          <Switch
            id={fieldId("deliveryFeedback")}
            label="Feedback on how you spoke"
            checked={form.deliveryFeedback}
            disabled={readOnly}
            describedBy={feedbackError ? "feedback-error" : undefined}
            onChange={(v) => setForm((s) => ({ ...s, deliveryFeedback: v }))}
          />
          {feedbackError && <ErrorText id="feedback-error" message={feedbackError} />}
        </section>

        <section style={{ marginBottom: 28 }}>
          <button
            type="button"
            aria-expanded={advancedOpen}
            aria-controls="advanced-panel"
            onClick={() => setAdvancedOpen((o) => !o)}
            style={{ ...secondaryButtonStyle, padding: "8px 14px", fontSize: 14 }}
          >
            {advancedOpen ? "Hide advanced settings" : "Show advanced settings"}
          </button>
          <div id="advanced-panel" hidden={!advancedOpen} style={{ marginTop: 16 }}>
            <TextField
              path="voice.cloud"
              label="Cloud voice id (optional)"
              hint={readOnly ? undefined : "The text-to-speech voice id, 10 to 40 letters and digits. Leave it empty for the default voice."}
              value={form.voiceCloud}
              maxLength={VOICE_MAX_CHARS}
              onChange={(v) => setForm((s) => ({ ...s, voiceCloud: v }))}
              error={voiceError}
              readOnly={readOnly}
            />
          </div>
        </section>

        {!readOnly && (
          <ActionBar
            existing={record !== null}
            busy={busy}
            confirmDelete={confirmDelete}
            onTry={tryIt}
            onDuplicate={duplicate}
            onAskDelete={() => setConfirmDelete(true)}
            onCancelDelete={() => setConfirmDelete(false)}
            onDelete={remove}
          />
        )}
      </form>
    </Shell>
  );
}

// Inner component — must be inside <Suspense> because it calls useSearchParams().
function EditorPageInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const from = searchParams.get("from");
  const source: Source = id
    ? { kind: "id", id }
    : from === "design" || from === "draft"
      ? { kind: "draft" }
      : { kind: "blank" };
  // A new URL (after create or duplicate) is a new form: remount so every state starts fresh.
  return <Editor key={`${id ?? ""}|${from ?? ""}`} source={source} />;
}

export default function InterviewerEditPage() {
  return (
    <Suspense fallback={<Shell><p role="status" style={hintStyle}>Loading…</p></Shell>}>
      <EditorPageInner />
    </Suspense>
  );
}
