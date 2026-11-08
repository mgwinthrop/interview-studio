"use client";

// Step 1 of a call: paste the Teams transcript, find its speakers, choose the buyer.
import { forwardRef } from "react";
import { MAX_TRANSCRIPT_CHARS, type Speaker } from "../../lib/calls";
import { FIELD_BORDER, primaryButtonStyle } from "../../lib/ui";
import { hintStyle, labelStyle } from "../edit/FieldRow";
import { disabledStyle } from "../edit/PhaseFields";
import { errorTextStyle, subHeadingStyle, textAreaStyle } from "./styles";

interface CallPasteProps {
  transcript: string;
  onTranscriptChange: (value: string) => void;
  onFindSpeakers: () => void;
  finding: boolean;
  /** Every control is read-only (a request for this call is running). */
  locked: boolean;
  speakers: Speaker[] | null;
  buyer: string | null;
  onBuyerChange: (name: string) => void;
  error: string | null;
}

const fmt = (n: number) => n.toLocaleString("en-GB");

export const CallPaste = forwardRef<HTMLParagraphElement, CallPasteProps>(function CallPaste(
  { transcript, onTranscriptChange, onFindSpeakers, finding, locked, speakers, buyer, onBuyerChange, error },
  errorRef,
) {
  const length = transcript.length;
  const over = length > MAX_TRANSCRIPT_CHARS;
  const empty = transcript.trim().length === 0;
  const findDisabled = locked || finding || over || empty;

  return (
    <div>
      <h3 style={subHeadingStyle}>1. Paste the transcript</h3>
      <label htmlFor="call-transcript" style={labelStyle}>Teams transcript</label>
      <p id="call-transcript-hint" style={hintStyle}>
        Copy the transcript from Teams and paste it here, with each speaker&apos;s name and time on a line above
        what they said. This app&apos;s server reads it to find the speakers. Nothing is sent to Claude at this step.
      </p>
      <textarea
        id="call-transcript"
        value={transcript}
        rows={10}
        dir="auto"
        autoComplete="off"
        spellCheck={false}
        readOnly={locked || finding}
        aria-describedby={["call-transcript-hint", "call-transcript-count", over ? "call-transcript-over" : "", error ? "call-paste-error" : ""].filter(Boolean).join(" ")}
        aria-invalid={over || error ? true : undefined}
        onChange={(e) => onTranscriptChange(e.target.value)}
        style={textAreaStyle(over || error !== null)}
      />
      <p id="call-transcript-count" style={{ fontSize: 12, color: "#4B5563", margin: "4px 0 12px", textAlign: "right" }}>
        {fmt(length)} of {fmt(MAX_TRANSCRIPT_CHARS)} characters
      </p>
      {over && (
        <p id="call-transcript-over" style={errorTextStyle}>
          Error: the transcript is {fmt(length - MAX_TRANSCRIPT_CHARS)} characters over the limit. Shorten it, or split
          the call into two.
        </p>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <button type="button" onClick={onFindSpeakers} disabled={findDisabled} style={disabledStyle(primaryButtonStyle, findDisabled)}>
          {finding ? "Finding speakers…" : "Find speakers"}
        </button>
      </div>
      {error && (
        <p id="call-paste-error" ref={errorRef} tabIndex={-1} role="alert" style={{ ...errorTextStyle, marginTop: 8 }}>
          Error: {error}
        </p>
      )}

      {speakers && (
        <fieldset style={{ border: `1px solid ${FIELD_BORDER}`, borderRadius: 8, padding: "12px 16px", margin: "20px 0 0", minWidth: 0 }}>
          <legend style={{ ...labelStyle, padding: "0 4px", marginBottom: 0 }}>Who is the buyer?</legend>
          <p id="buyer-hint" style={hintStyle}>
            The buyer is the person the persona is based on. Everyone else becomes &ldquo;Our side&rdquo;.
          </p>
          {speakers.map((s, i) => (
            <div key={`${i}-${s.name}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: "8px 0" }}>
              <input
                id={`buyer-${i}`}
                type="radio"
                name="buyer"
                value={s.name}
                checked={buyer === s.name}
                disabled={locked}
                aria-describedby="buyer-hint"
                onChange={() => onBuyerChange(s.name)}
                style={{ width: 20, height: 20, margin: "2px 0 0", flexShrink: 0, accentColor: "#087E8B" }}
              />
              <label htmlFor={`buyer-${i}`} dir="auto" style={{ fontSize: 15, color: "#102B33", overflowWrap: "anywhere", minWidth: 0 }}>
                {s.name} <span style={{ color: "#4B5563" }}>({s.lines === 1 ? "1 line" : `${fmt(s.lines)} lines`})</span>
              </label>
            </div>
          ))}
        </fieldset>
      )}
    </div>
  );
});
