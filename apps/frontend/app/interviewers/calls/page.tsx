"use client";

// Build from calls: paste a call, choose the buyer, redact, review and approve; repeat for up to
// MAX_CALLS calls; then confirm before the approved text is sent to draft a persona.
// Pasted text, the names to hide and the approved calls live in this page's state only: never in
// storage, cookies or the URL, and never in a log or an error message.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MAX_CALLS,
  MAX_CALL_TEXT_CHARS,
  draftErrorMessage,
  fetchFeatures,
  hasBuyerLine,
  normaliseApprovedText,
  parseTerms,
  requestCallsDraft,
  requestRedaction,
  requestSpeakers,
  sendSummary,
  stepErrorMessage,
  type ApprovedCall,
  type Redaction,
  type Speaker,
} from "../../lib/calls";
import { DEFAULT_RETURN_TO, storeDraft } from "../../lib/interviewerForm";
import { primaryButtonStyle, secondaryButtonStyle } from "../../lib/ui";
import { dangerButtonStyle, hintStyle, smallButtonStyle } from "../edit/FieldRow";
import { disabledStyle, sectionHeadingStyle } from "../edit/PhaseFields";
import { Shell, bodyStyle, panelStyle } from "../edit/EditorParts";
import { CallPaste } from "./CallPaste";
import { RedactionReview } from "./RedactionReview";
import { SendConfirm } from "./SendConfirm";
import { errorTextStyle } from "./styles";

type Features = "loading" | "off" | "on";

interface CurrentCall {
  transcript: string;
  speakers: Speaker[] | null;
  buyer: string | null;
  redaction: Redaction | null;
  /** The names to hide the redaction was made with (lower-cased, one per line). */
  redactedKey: string | null;
  editing: boolean;
  editedText: string | null;
}

const EMPTY_CALL: CurrentCall = {
  transcript: "",
  speakers: null,
  buyer: null,
  redaction: null,
  redactedKey: null,
  editing: false,
  editedText: null,
};

const STORAGE_MESSAGE =
  "The draft was made, but this browser is not letting the page keep it, so it cannot be opened. Try again, or write the interviewer yourself.";
const NEEDS_BUYER = "The buyer's lines are needed to build the persona.";
const STALE = "The names to hide have changed. Select Redact again to apply them before approving.";

const fmt = (n: number) => n.toLocaleString("en-GB");
const termsKey = (terms: string[]) => terms.map((t) => t.toLocaleLowerCase()).join("\n");

export default function BuildFromCallsPage() {
  const router = useRouter();
  const [features, setFeatures] = useState<Features>("loading");

  const [call, setCall] = useState<CurrentCall>(EMPTY_CALL);
  const [termsText, setTermsText] = useState("");
  const [termsError, setTermsError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"speakers" | "redact" | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [redactError, setRedactError] = useState<string | null>(null);

  const [approved, setApproved] = useState<ApprovedCall[]>([]);
  const [mode, setMode] = useState<"call" | "list">("call");
  const [status, setStatus] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  const pasteErrorRef = useRef<HTMLParagraphElement>(null);
  const redactErrorRef = useRef<HTMLParagraphElement>(null);
  const callHeadingRef = useRef<HTMLHeadingElement>(null);
  const approvedHeadingRef = useRef<HTMLHeadingElement>(null);
  const draftButtonRef = useRef<HTMLButtonElement>(null);
  // Focus moves after the render that shows its target.
  const [focusTarget, setFocusTarget] = useState<{ to: "pasteError" | "redactError" | "call" | "approved" | "review" | "draftButton"; n: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFeatures().then((f) => {
      if (!cancelled) setFeatures(f.personaFromCalls ? "on" : "off");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!focusTarget) return;
    const el =
      focusTarget.to === "pasteError"
        ? pasteErrorRef.current
        : focusTarget.to === "redactError"
          ? redactErrorRef.current
          : focusTarget.to === "call"
            ? callHeadingRef.current
            : focusTarget.to === "approved"
              ? approvedHeadingRef.current
              : focusTarget.to === "draftButton"
                ? draftButtonRef.current
                : document.getElementById("review-heading");
    el?.focus();
  }, [focusTarget]);

  const focus = (to: NonNullable<typeof focusTarget>["to"]) => setFocusTarget((f) => ({ to, n: (f?.n ?? 0) + 1 }));

  const parsedTerms = useMemo(() => parseTerms(termsText), [termsText]);
  const termKeys = useMemo(
    () => new Set(parsedTerms.ok ? parsedTerms.terms.map((t) => t.toLocaleLowerCase()) : []),
    [parsedTerms],
  );
  const summary = useMemo(() => sendSummary(approved), [approved]);

  function resetCall() {
    setCall(EMPTY_CALL);
    setPasteError(null);
    setRedactError(null);
    setTermsError(null);
  }

  function onTranscriptChange(transcript: string) {
    // A changed transcript makes the speakers and the redaction stale.
    setCall({ ...EMPTY_CALL, transcript });
    setPasteError(null);
    setRedactError(null);
  }

  async function findSpeakers() {
    if (busy) return;
    setBusy("speakers");
    setPasteError(null);
    setRedactError(null);
    setStatus("");
    const r = await requestSpeakers(call.transcript);
    setBusy(null);
    if (!r.ok) {
      setCall((c) => ({ ...EMPTY_CALL, transcript: c.transcript }));
      setPasteError(stepErrorMessage(r));
      focus("pasteError");
      return;
    }
    setCall((c) => ({ ...EMPTY_CALL, transcript: c.transcript, speakers: r.value }));
    setStatus(`Found ${r.value.length === 1 ? "1 speaker" : `${r.value.length} speakers`}. Choose who is the buyer.`);
  }

  function onBuyerChange(buyer: string) {
    setCall((c) => ({ ...c, buyer, redaction: null, redactedKey: null, editing: false, editedText: null }));
    setRedactError(null);
  }

  async function redact(text: string, moveFocus: boolean) {
    if (busy || !call.buyer) return;
    const parsed = parseTerms(text);
    if (!parsed.ok) {
      setTermsError(parsed.message);
      return;
    }
    setTermsError(null);
    setRedactError(null);
    setBusy("redact");
    setStatus("");
    const r = await requestRedaction(call.transcript, call.buyer, parsed.terms);
    setBusy(null);
    if (!r.ok) {
      setRedactError(stepErrorMessage(r));
      focus("redactError");
      return;
    }
    const changes = r.value.lines.reduce((n, l) => n + l.segments.filter((s) => s.change).length, 0);
    setCall((c) => ({ ...c, redaction: r.value, redactedKey: termsKey(parsed.terms), editing: false, editedText: null }));
    setStatus(`Redacted: ${changes === 1 ? "1 change" : `${changes} changes`} highlighted. Read the whole text before approving.`);
    if (moveFocus) focus("review");
  }

  function toggleSuggestion(term: string, checked: boolean) {
    const items = termsText.split(/[,\r\n]/).map((t) => t.trim()).filter((t) => t.length > 0);
    const key = term.trim().toLocaleLowerCase();
    const next = checked
      ? [...items, term.trim()]
      : items.filter((t) => t.toLocaleLowerCase() !== key);
    const text = next.join("\n");
    setTermsText(text);
    void redact(text, false);
  }

  function toggleEdit() {
    setCall((c) => {
      if (!c.redaction) return c;
      if (!c.editing) return { ...c, editing: true, editedText: c.editedText ?? c.redaction.text };
      // Leaving the editor with no change keeps the highlighted view.
      return { ...c, editing: false, editedText: c.editedText === c.redaction.text ? null : c.editedText };
    });
  }

  const approvedText = call.redaction ? normaliseApprovedText(call.editedText ?? call.redaction.text) : "";
  const stale =
    call.redaction !== null && (!parsedTerms.ok || termsKey(parsedTerms.terms) !== call.redactedKey);
  const blockReason = !call.redaction
    ? null
    : stale
      ? STALE
      : !hasBuyerLine(approvedText)
        ? NEEDS_BUYER
        : approvedText.length > MAX_CALL_TEXT_CHARS
          ? `The text is longer than ${fmt(MAX_CALL_TEXT_CHARS)} characters. Shorten it before approving.`
          : null;
  const approveDisabled = busy !== null || blockReason !== null || approved.length >= MAX_CALLS;

  function approve() {
    if (approveDisabled || !call.redaction) return;
    const next = [...approved, { text: approvedText, forbidden: call.redaction.forbidden }];
    setApproved(next);
    resetCall();
    setMode("list");
    setStatus(`Call ${next.length} approved.`);
    focus("approved");
  }

  function addAnother() {
    if (approved.length >= MAX_CALLS) return;
    resetCall();
    setMode("call");
    setStatus("");
    focus("call");
  }

  function cancelCall() {
    resetCall();
    setMode("list");
    setStatus("The call was not added.");
    focus("approved");
  }

  function removeCall(index: number) {
    const next = approved.filter((_, i) => i !== index);
    setApproved(next);
    setStatus(`Call ${index + 1} removed.`);
    if (next.length === 0) {
      setMode("call");
      focus("call");
    } else {
      focus("approved");
    }
  }

  function openConfirm() {
    if (approved.length === 0 || busy) return;
    setSendError(null);
    setConfirmOpen(true);
  }

  function closeConfirm() {
    if (sendingRef.current) return;
    setConfirmOpen(false);
    setSendError(null);
    focus("draftButton");
  }

  async function send() {
    if (sendingRef.current || approved.length === 0) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    const r = await requestCallsDraft(approved, true);
    sendingRef.current = false;
    setSending(false);
    if (!r.ok) {
      setSendError(draftErrorMessage(r));
      return;
    }
    if (!storeDraft(r.value)) {
      setSendError(STORAGE_MESSAGE);
      return;
    }
    // Hand-off done: drop everything pasted or approved before leaving.
    setApproved([]);
    resetCall();
    setTermsText("");
    setConfirmOpen(false);
    router.push(DEFAULT_RETURN_TO);
  }

  const heading = (
    <h1 style={{ fontSize: 30, fontWeight: 800, color: "#102B33", margin: "0 0 8px", letterSpacing: "-0.02em" }}>
      Build from calls
    </h1>
  );

  if (features !== "on") {
    return (
      <Shell>
        {heading}
        {features === "loading" ? (
          <p role="status" style={hintStyle}>Checking whether this is available…</p>
        ) : (
          <div role="status">
            <p style={{ ...bodyStyle, fontWeight: 700 }}>Building a persona from calls is turned off on this server.</p>
            <p style={bodyStyle}>
              The person who runs this server has not enabled it, so call text cannot be sent to draft a persona here.
              You can still describe an interviewer or write one yourself.
            </p>
            <Link href="/interviewers" style={{ color: "#066C77", fontWeight: 700 }}>Back to interviewers</Link>
          </div>
        )}
      </Shell>
    );
  }

  const callNumber = approved.length + 1;

  return (
    <Shell>
      {heading}
      <p style={bodyStyle}>
        Paste transcripts of real calls to draft a persona that behaves like the buyers in them. For each call you
        choose the buyer, hide names, read the redacted text and approve it. This app&apos;s server finds the speakers
        and does the redaction; nothing is sent to Claude until you confirm at the end.
      </p>
      <p style={{ ...bodyStyle, marginBottom: 24 }}>
        <Link href="/interviewers" style={{ color: "#066C77", fontWeight: 700 }}>Back to interviewers</Link>
      </p>

      <div role="status" aria-live="polite" style={{ minHeight: 0 }}>
        {status && <p style={{ ...bodyStyle, fontWeight: 700 }}>{status}</p>}
      </div>

      {mode === "call" && (
        <section aria-labelledby="call-heading" style={{ ...panelStyle, padding: "20px 20px" }}>
          <h2 id="call-heading" ref={callHeadingRef} tabIndex={-1} style={{ ...sectionHeadingStyle, outline: "none" }}>
            Call {callNumber} of up to {MAX_CALLS}
          </h2>
          <CallPaste
            ref={pasteErrorRef}
            transcript={call.transcript}
            onTranscriptChange={onTranscriptChange}
            onFindSpeakers={() => void findSpeakers()}
            finding={busy === "speakers"}
            locked={busy === "redact"}
            speakers={call.speakers}
            buyer={call.buyer}
            onBuyerChange={onBuyerChange}
            error={pasteError}
          />

          {call.buyer && (
            <div style={{ marginTop: 24 }}>
              <RedactionReview
                ref={redactErrorRef}
                termsText={termsText}
                onTermsChange={(v) => {
                  setTermsText(v);
                  setTermsError(null);
                }}
                termsError={termsError}
                onRedact={() => void redact(termsText, true)}
                redacting={busy === "redact"}
                redactDisabled={busy !== null}
                redaction={call.redaction}
                stale={stale}
                termKeys={termKeys}
                onToggleSuggestion={toggleSuggestion}
                editing={call.editing}
                onToggleEdit={toggleEdit}
                editedText={call.editedText}
                onEditedChange={(v) => setCall((c) => ({ ...c, editedText: v }))}
                error={redactError}
              />
            </div>
          )}

          {call.redaction && (
            <div style={{ borderTop: "1px solid #E2E6EA", paddingTop: 16, marginTop: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={approve}
                  disabled={approveDisabled}
                  aria-describedby={blockReason ? "approve-reason" : undefined}
                  style={disabledStyle(primaryButtonStyle, approveDisabled)}
                >
                  Approve this call
                </button>
              </div>
              {blockReason && (
                <p id="approve-reason" style={{ ...errorTextStyle, marginTop: 8 }}>{blockReason}</p>
              )}
              <p style={{ ...hintStyle, marginTop: 8 }}>
                Approving keeps the text on this page. Nothing is sent yet.
              </p>
            </div>
          )}

          {approved.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <button type="button" onClick={cancelCall} disabled={busy !== null} style={disabledStyle({ ...secondaryButtonStyle, padding: "8px 16px", fontSize: 14 }, busy !== null)}>
                Cancel this call
              </button>
            </div>
          )}
        </section>
      )}

      {approved.length > 0 && (
        <section aria-labelledby="approved-heading" style={{ ...panelStyle, padding: "20px 20px" }}>
          <h2 id="approved-heading" ref={approvedHeadingRef} tabIndex={-1} style={{ ...sectionHeadingStyle, outline: "none" }}>
            Approved calls ({approved.length} of up to {MAX_CALLS})
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
            {approved.map((c, i) => (
              <li
                key={i}
                style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 0", borderBottom: "1px solid #E2E6EA" }}
              >
                <span style={{ fontSize: 15, color: "#102B33" }}>
                  <strong>Call {i + 1}</strong>: {fmt(c.text.length)} characters
                </span>
                <button
                  type="button"
                  onClick={() => removeCall(i)}
                  disabled={busy !== null || confirmOpen}
                  aria-label={`Remove call ${i + 1}`}
                  style={disabledStyle({ ...smallButtonStyle, ...dangerButtonStyle, padding: "6px 12px", fontSize: 13 }, busy !== null || confirmOpen)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {approved.length === 1 && (
            <p style={{ ...bodyStyle, fontWeight: 700 }}>One call is easier to trace back to a client than several.</p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 8 }}>
            {mode === "list" && (
              <button
                type="button"
                onClick={addAnother}
                disabled={approved.length >= MAX_CALLS}
                aria-describedby={approved.length >= MAX_CALLS ? "calls-full" : undefined}
                style={disabledStyle(secondaryButtonStyle, approved.length >= MAX_CALLS)}
              >
                Add another call
              </button>
            )}
            <button
              type="button"
              ref={draftButtonRef}
              onClick={openConfirm}
              disabled={busy !== null}
              aria-haspopup="dialog"
              style={disabledStyle(primaryButtonStyle, busy !== null)}
            >
              Draft persona
            </button>
          </div>
          {approved.length >= MAX_CALLS && (
            <p id="calls-full" style={{ ...hintStyle, marginTop: 8 }}>
              {MAX_CALLS} calls is the most a persona can be drafted from. Remove one to add another.
            </p>
          )}
          <p style={{ ...hintStyle, marginTop: 8 }}>
            Draft persona shows what will be sent and asks you to confirm first.
          </p>
        </section>
      )}

      {confirmOpen && (
        <SendConfirm
          calls={approved.length}
          approvedChars={summary.approved}
          sentChars={summary.sent}
          trimmed={summary.trimmed}
          sending={sending}
          error={sendError}
          onConfirm={() => void send()}
          onCancel={closeConfirm}
        />
      )}
    </Shell>
  );
}
