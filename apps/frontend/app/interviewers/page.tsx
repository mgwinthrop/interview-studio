"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DESIGNER_ID,
  MAX_DESCRIPTION_CHARS,
  MIN_DESCRIPTION_CHARS,
  deleteInterviewer,
  duplicateInterviewer,
  fetchInterviewers,
  requestDraft,
  type InterviewerSummary,
} from "../lib/interviewers";
import { storeDraft } from "../lib/interviewerForm";
import { labelStyle, hintStyle, ERROR_COLOR, primaryButtonStyle, secondaryButtonStyle, smallButtonStyle, dangerButtonStyle } from "./edit/FieldRow";
import { disabledStyle, sectionHeadingStyle } from "./edit/PhaseFields";
import { Shell, bodyStyle, panelStyle } from "./edit/EditorParts";

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; interviewers: InterviewerSummary[] };

type RowBusy = { id: string; action: "duplicate" | "delete" } | null;

const DRAFT_STORAGE_MESSAGE =
  "The draft was made, but this browser is not letting the page keep it, so it cannot be opened. Try again, or start from a blank form.";
const DRAFT_NETWORK_MESSAGE = "Could not reach the server. Your description is still here.";

function editPath(id: string): string {
  return `/interviewers/edit?id=${encodeURIComponent(id)}`;
}

function micGranted(): boolean {
  try {
    return Boolean(sessionStorage.getItem("mic_gesture_granted"));
  } catch {
    return false;
  }
}

export default function InterviewersPage() {
  const router = useRouter();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [rowBusy, setRowBusy] = useState<RowBusy>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const [notice, setNotice] = useState("");
  const rowErrorRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [focusToken, setFocusToken] = useState(0);

  const [description, setDescription] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [needMicCheck, setNeedMicCheck] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setList({ status: "loading" });
    fetchInterviewers()
      .then((interviewers) => {
        if (!cancelled) setList({ status: "ready", interviewers });
      })
      .catch(() => {
        if (!cancelled) setList({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  // A failed duplicate or delete puts the message in focus so a screen reader hears it.
  useEffect(() => {
    if (focusToken > 0) rowErrorRef.current?.focus();
  }, [focusToken]);

  async function duplicate(id: string) {
    if (rowBusy) return;
    setRowBusy({ id, action: "duplicate" });
    setRowError(null);
    setNotice("");
    setConfirmId(null);
    const r = await duplicateInterviewer(id);
    setRowBusy(null);
    if (!r.ok) {
      const text = r.kind === "invalid" ? r.errors[0].message : r.message;
      setRowError({ id, text });
      setFocusToken((n) => n + 1);
      return;
    }
    router.push(editPath(r.value.id));
  }

  async function remove(id: string) {
    if (rowBusy) return;
    setRowBusy({ id, action: "delete" });
    setRowError(null);
    setNotice("");
    const r = await deleteInterviewer(id);
    setRowBusy(null);
    if (!r.ok) {
      setRowError({ id, text: r.kind === "invalid" ? r.errors[0].message : r.message });
      setFocusToken((n) => n + 1);
      return;
    }
    setConfirmId(null);
    setList((l) => (l.status === "ready" ? { status: "ready", interviewers: l.interviewers.filter((i) => i.id !== id) } : l));
    setNotice("Interviewer deleted.");
    headingRef.current?.focus();
  }

  function talkItThrough() {
    // mic-check always returns to the home page, so it cannot bring the person back here. Go
    // straight to the designer when the check has passed, otherwise send them to the check first.
    if (!micGranted()) {
      setNeedMicCheck(true);
      return;
    }
    router.push(`/session?mode=design&interviewerId=${encodeURIComponent(DESIGNER_ID)}`);
  }

  const trimmedLength = description.trim().length;
  const tooShort = trimmedLength < MIN_DESCRIPTION_CHARS;

  async function makeDraft() {
    if (drafting || tooShort) return;
    setDrafting(true);
    setDraftError(null);
    const r = await requestDraft(description.trim());
    setDrafting(false);
    if (!r.ok) {
      if (r.kind === "invalid") setDraftError(r.errors[0].message);
      else if (r.kind === "network") setDraftError(DRAFT_NETWORK_MESSAGE);
      else setDraftError(r.message);
      return;
    }
    if (!storeDraft(r.value)) {
      setDraftError(DRAFT_STORAGE_MESSAGE);
      return;
    }
    router.push("/interviewers/edit?from=design");
  }

  const custom = list.status === "ready" ? list.interviewers.filter((i) => i.source === "custom") : [];
  const presets = list.status === "ready" ? list.interviewers.filter((i) => i.source === "preset") : [];

  return (
    <Shell>
      <h1 ref={headingRef} tabIndex={-1} style={{ fontSize: 30, fontWeight: 800, color: "#102B33", margin: "0 0 8px", letterSpacing: "-0.02em", outline: "none" }}>
        Interviewers
      </h1>
      <p style={{ ...bodyStyle, marginBottom: 24 }}>
        An interviewer decides how a conversation goes and what the report covers. Make your own, or copy a
        preset and change it.
      </p>

      <section aria-labelledby="create-heading" style={{ ...panelStyle, padding: "20px 24px" }}>
        <h2 id="create-heading" style={sectionHeadingStyle}>Create an interviewer</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", marginBottom: 20 }}>
          <button type="button" onClick={talkItThrough} aria-describedby="talk-hint" style={primaryButtonStyle}>
            Talk it through
          </button>
          <Link href="/interviewers/edit" style={secondaryButtonStyle}>
            Start from a blank form
          </Link>
        </div>
        <p id="talk-hint" style={hintStyle}>
          Talk it through starts a short conversation with a designer who asks what you want, then makes a
          draft. You can type instead of speaking once it starts.
        </p>
        {needMicCheck && (
          <p role="status" style={{ ...bodyStyle, fontWeight: 700 }}>
            Check your microphone first.{" "}
            <Link href="/mic-check" style={{ color: "#087E8B" }}>Go to the microphone check</Link>, then come
            back here and choose Talk it through.
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void makeDraft();
          }}
          style={{ marginTop: 20 }}
        >
          <label htmlFor="describe-interviewer" style={labelStyle}>Describe it</label>
          <p id="describe-hint" style={hintStyle}>
            Say who the interviewer is for and what it should help with. A draft appears for you to review
            before anything is saved.
          </p>
          <textarea
            id="describe-interviewer"
            value={description}
            maxLength={MAX_DESCRIPTION_CHARS}
            rows={5}
            dir="auto"
            readOnly={drafting}
            aria-describedby={["describe-hint", "describe-count", tooShort ? "describe-min" : "", draftError ? "describe-error" : ""].filter(Boolean).join(" ")}
            aria-invalid={draftError ? true : undefined}
            onChange={(e) => setDescription(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              borderRadius: 8,
              border: draftError ? `2px solid ${ERROR_COLOR}` : "1px solid #C9D0D6",
              background: "#FFFFFF",
              color: "#102B33",
              fontSize: 15,
              lineHeight: 1.5,
              fontFamily: "var(--font-manrope), sans-serif",
              resize: "vertical",
            }}
          />
          <p id="describe-count" style={{ fontSize: 12, color: "#4B5563", margin: "4px 0 12px", textAlign: "right" }}>
            {description.length} of {MAX_DESCRIPTION_CHARS} characters
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <button
              type="submit"
              disabled={drafting || tooShort}
              style={disabledStyle(primaryButtonStyle, drafting || tooShort)}
            >
              {drafting ? "Making a draft…" : "Make a draft"}
            </button>
            {drafting && (
              <p role="status" style={{ ...hintStyle, margin: 0 }}>Making a draft. This can take a little while.</p>
            )}
          </div>
          {tooShort && (
            <p id="describe-min" style={{ ...hintStyle, marginTop: 8 }}>
              Write at least {MIN_DESCRIPTION_CHARS} characters to make a draft.
            </p>
          )}
          {draftError && (
            <p id="describe-error" role="alert" style={{ fontSize: 14, color: ERROR_COLOR, fontWeight: 600, margin: "8px 0 0" }}>
              Error: {draftError}
            </p>
          )}
        </form>
      </section>

      <div role="status" style={{ minHeight: 0 }}>
        {notice && <p style={{ ...bodyStyle, fontWeight: 700 }}>{notice}</p>}
      </div>

      {list.status === "loading" && <p role="status" style={hintStyle}>Loading interviewers…</p>}
      {list.status === "error" && (
        <div role="alert">
          <p style={bodyStyle}>Could not load the interviewers.</p>
          <button type="button" onClick={() => setLoadAttempt((n) => n + 1)} style={primaryButtonStyle}>
            Retry
          </button>
        </div>
      )}

      {list.status === "ready" && (
        <>
          <section aria-labelledby="mine-heading" style={{ marginBottom: 32 }}>
            <h2 id="mine-heading" style={sectionHeadingStyle}>Your interviewers</h2>
            {custom.length === 0 && (
              <p style={bodyStyle}>You have not made an interviewer yet. Use one of the ways above to start.</p>
            )}
            <ul style={listStyle}>
              {custom.map((i) => (
                <li key={i.id} style={{ ...panelStyle, margin: 0 }}>
                  <Summary interviewer={i} />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                    <Link href={editPath(i.id)} aria-label={`Edit ${i.name}`} style={smallLinkStyle}>Edit</Link>
                    <button
                      type="button"
                      onClick={() => duplicate(i.id)}
                      disabled={rowBusy !== null}
                      aria-label={`Duplicate ${i.name}`}
                      style={disabledStyle(smallButtonStyle, rowBusy !== null)}
                    >
                      {rowBusy?.id === i.id && rowBusy.action === "duplicate" ? "Duplicating…" : "Duplicate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmId(i.id);
                        setRowError(null);
                        setNotice("");
                      }}
                      disabled={rowBusy !== null || confirmId === i.id}
                      aria-label={`Delete ${i.name}`}
                      style={disabledStyle({ ...smallButtonStyle, ...dangerButtonStyle, padding: "6px 12px", fontSize: 13 }, rowBusy !== null || confirmId === i.id)}
                    >
                      Delete
                    </button>
                  </div>
                  {confirmId === i.id && (
                    <div role="group" aria-label={`Delete ${i.name}?`} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #E2E6EA" }}>
                      <p style={{ ...bodyStyle, fontWeight: 700 }}>Delete this interviewer?</p>
                      <p style={bodyStyle}>It can&apos;t be undone. Past sessions with it keep their reports.</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                        <button
                          type="button"
                          onClick={() => remove(i.id)}
                          disabled={rowBusy !== null}
                          style={disabledStyle({ ...dangerButtonStyle, padding: "8px 16px", fontSize: 14 }, rowBusy !== null)}
                        >
                          {rowBusy?.id === i.id && rowBusy.action === "delete" ? "Deleting…" : "Delete interviewer"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          disabled={rowBusy !== null}
                          style={disabledStyle({ ...secondaryButtonStyle, padding: "8px 16px", fontSize: 14 }, rowBusy !== null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {rowError?.id === i.id && (
                    <p ref={rowErrorRef} tabIndex={-1} role="alert" style={{ fontSize: 14, color: ERROR_COLOR, fontWeight: 600, margin: "12px 0 0" }}>
                      Error: {rowError.text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="presets-heading">
            <h2 id="presets-heading" style={sectionHeadingStyle}>Presets</h2>
            <p style={hintStyle}>Presets cannot be changed. Duplicate one to make your own copy.</p>
            <ul style={listStyle}>
              {presets.map((i) => (
                <li key={i.id} style={{ ...panelStyle, margin: 0 }}>
                  <Summary interviewer={i} />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                    <Link href={editPath(i.id)} aria-label={`View ${i.name}`} style={smallLinkStyle}>View</Link>
                    <button
                      type="button"
                      onClick={() => duplicate(i.id)}
                      disabled={rowBusy !== null}
                      aria-label={`Duplicate ${i.name}`}
                      style={disabledStyle(smallButtonStyle, rowBusy !== null)}
                    >
                      {rowBusy?.id === i.id && rowBusy.action === "duplicate" ? "Duplicating…" : "Duplicate"}
                    </button>
                  </div>
                  {rowError?.id === i.id && (
                    <p ref={rowErrorRef} tabIndex={-1} role="alert" style={{ fontSize: 14, color: ERROR_COLOR, fontWeight: 600, margin: "12px 0 0" }}>
                      Error: {rowError.text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </Shell>
  );
}

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const smallLinkStyle: React.CSSProperties = { ...smallButtonStyle, display: "inline-block" };

function Summary({ interviewer }: { interviewer: InterviewerSummary }) {
  return (
    <>
      <h3 dir="auto" style={{ fontSize: 17, fontWeight: 700, color: "#102B33", margin: "0 0 4px", overflowWrap: "anywhere" }}>
        {interviewer.name}
      </h3>
      <p dir="auto" style={{ ...bodyStyle, margin: 0, overflowWrap: "anywhere" }}>{interviewer.purpose}</p>
    </>
  );
}
