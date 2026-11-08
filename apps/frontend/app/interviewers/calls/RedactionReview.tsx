"use client";

// Step 2 of a call: the names to hide, the redaction and its review. Every change is shown with a
// text label as well as a colour and an underline style, so colour is never the only cue.
import { forwardRef } from "react";
import { MAX_CALL_TEXT_CHARS, MAX_TERMS, MAX_TERM_CHARS, type ChangeKind, type Redaction } from "../../lib/calls";
import { FIELD_BORDER, primaryButtonStyle, secondaryButtonStyle } from "../../lib/ui";
import { hintStyle, labelStyle } from "../edit/FieldRow";
import { disabledStyle } from "../edit/PhaseFields";
import { BEST_EFFORT_NOTICE, errorTextStyle, noticeStyle, subHeadingStyle, textAreaStyle } from "./styles";

const KINDS: Record<ChangeKind, { label: string; describe: string; style: React.CSSProperties }> = {
  name: {
    label: "name",
    describe: "A speaker's name, replaced by a role or a placeholder",
    style: { background: "#DDF1F1", borderBottom: "2px solid #066C77" },
  },
  term: {
    label: "term",
    describe: "A name from your list, replaced by a placeholder",
    style: { background: "#ECE6F6", borderBottom: "2px dashed #5B3A99" },
  },
  amount: {
    label: "amount",
    describe: "A price, rate, percentage or large number",
    style: { background: "#FFF1D1", borderBottom: "2px dotted #8A5A00" },
  },
  contact: {
    label: "contact",
    describe: "An email address, phone number or web address",
    style: { background: "#FCE4E4", borderBottom: "3px double #B42318" },
  },
};
const KIND_ORDER: ChangeKind[] = ["name", "term", "amount", "contact"];

const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.2,
  color: "#102B33",
  background: "#FFFFFF",
  border: "1px solid #7A8590",
  borderRadius: 4,
  padding: "0 4px",
  marginLeft: 4,
  verticalAlign: "1px",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

interface RedactionReviewProps {
  termsText: string;
  onTermsChange: (value: string) => void;
  termsError: string | null;
  onRedact: () => void;
  redacting: boolean;
  /** Redact cannot run yet (no buyer chosen) or a request is running. */
  redactDisabled: boolean;
  redaction: Redaction | null;
  /** The names to hide changed since the last redaction. */
  stale: boolean;
  /** Lower-cased terms currently in the list, to tick the suggestions already added. */
  termKeys: Set<string>;
  onToggleSuggestion: (term: string, checked: boolean) => void;
  editing: boolean;
  onToggleEdit: () => void;
  /** The edited text, or null when the redacted text has not been edited. */
  editedText: string | null;
  onEditedChange: (value: string) => void;
  error: string | null;
}

export const RedactionReview = forwardRef<HTMLParagraphElement, RedactionReviewProps>(function RedactionReview(
  {
    termsText,
    onTermsChange,
    termsError,
    onRedact,
    redacting,
    redactDisabled,
    redaction,
    stale,
    termKeys,
    onToggleSuggestion,
    editing,
    onToggleEdit,
    editedText,
    onEditedChange,
    error,
  },
  errorRef,
) {
  const counts: Record<ChangeKind, number> = { name: 0, term: 0, amount: 0, contact: 0 };
  for (const line of redaction?.lines ?? []) {
    for (const s of line.segments) if (s.change) counts[s.change] += 1;
  }
  const edited = editedText !== null && redaction !== null && editedText !== redaction.text;
  const disabled = redactDisabled || redacting;

  return (
    <div>
      <h3 style={subHeadingStyle}>2. Hide names and check the redaction</h3>
      <label htmlFor="call-terms" style={labelStyle}>Names to hide</label>
      <p id="call-terms-hint" style={hintStyle}>
        Client, company and product names to replace, separated by commas or on separate lines. Speakers&apos; names
        are replaced without being listed. Up to {MAX_TERMS} names of up to {MAX_TERM_CHARS} characters each. This list
        is kept on this page only and is gone when you leave it.
      </p>
      <textarea
        id="call-terms"
        value={termsText}
        rows={3}
        dir="auto"
        autoComplete="off"
        spellCheck={false}
        readOnly={redacting}
        aria-describedby={["call-terms-hint", termsError ? "call-terms-error" : ""].filter(Boolean).join(" ")}
        aria-invalid={termsError ? true : undefined}
        onChange={(e) => onTermsChange(e.target.value)}
        style={{ ...textAreaStyle(termsError !== null), marginBottom: 8 }}
      />
      {termsError && (
        <p id="call-terms-error" style={errorTextStyle}>Error: {termsError}</p>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 4 }}>
        <button type="button" onClick={onRedact} disabled={disabled} style={disabledStyle(primaryButtonStyle, disabled)}>
          {redacting ? "Redacting…" : redaction ? "Redact again" : "Redact"}
        </button>
      </div>
      {redaction && edited && (
        <p style={{ ...hintStyle, marginTop: 8 }}>Redacting again replaces your edits to the text.</p>
      )}
      {error && (
        <p id="call-redact-error" ref={errorRef} tabIndex={-1} role="alert" style={{ ...errorTextStyle, marginTop: 8 }}>
          Error: {error}
        </p>
      )}

      {redaction && (
        <div style={{ marginTop: 20 }}>
          <h3 id="review-heading" tabIndex={-1} style={{ ...subHeadingStyle, outline: "none" }}>3. Read the redacted text</h3>
          <p style={noticeStyle}>{BEST_EFFORT_NOTICE}</p>
          {stale && (
            <p style={{ ...errorTextStyle, color: "#8A5A00" }}>
              The names to hide have changed. Select Redact again to apply them before approving.
            </p>
          )}

          {redaction.suggestions.length > 0 && (
            <fieldset style={{ border: `1px solid ${FIELD_BORDER}`, borderRadius: 8, padding: "12px 16px", margin: "0 0 16px", minWidth: 0 }}>
              <legend style={{ ...labelStyle, padding: "0 4px", marginBottom: 0 }}>Possible names to hide</legend>
              <p id="suggestions-hint" style={hintStyle}>
                These look like organisation or product names. Tick one to add it to the list; the text is redacted again.
              </p>
              {redaction.suggestions.map((term, i) => (
                <div key={`${i}-${term}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: "8px 0" }}>
                  <input
                    id={`suggestion-${i}`}
                    type="checkbox"
                    checked={termKeys.has(term.trim().toLocaleLowerCase())}
                    disabled={disabled}
                    aria-describedby="suggestions-hint"
                    onChange={(e) => onToggleSuggestion(term, e.target.checked)}
                    style={{ width: 20, height: 20, margin: "2px 0 0", flexShrink: 0, accentColor: "#087E8B" }}
                  />
                  <label htmlFor={`suggestion-${i}`} dir="auto" style={{ fontSize: 15, color: "#102B33", overflowWrap: "anywhere", minWidth: 0 }}>
                    {term}
                  </label>
                </div>
              ))}
            </fieldset>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", margin: "0 0 12px" }}>
            <button
              type="button"
              onClick={onToggleEdit}
              aria-pressed={editing}
              disabled={redacting}
              style={disabledStyle({ ...secondaryButtonStyle, padding: "8px 16px", fontSize: 14 }, redacting)}
            >
              Edit text
            </button>
            <span style={hintStyle}>
              {editing ? "Editing: highlights are off." : edited ? "Edited: highlights are not shown for edited text." : ""}
            </span>
          </div>

          {editing ? (
            <>
              <label htmlFor="call-edited" style={labelStyle}>Redacted text</label>
              <p id="call-edited-hint" style={hintStyle}>
                Change anything that still identifies a person or a client. Keep each line starting with
                &ldquo;Buyer:&rdquo; or &ldquo;Our side&rdquo; and its number. What is here is what gets approved.
              </p>
              <textarea
                id="call-edited"
                value={editedText ?? redaction.text}
                rows={16}
                dir="auto"
                maxLength={MAX_CALL_TEXT_CHARS}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="call-edited-hint"
                onChange={(e) => onEditedChange(e.target.value)}
                style={textAreaStyle(false)}
              />
            </>
          ) : edited ? (
            <div style={textBoxStyle} dir="auto">{editedText}</div>
          ) : (
            <>
              <ul aria-label="What the highlights mean" style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "flex", flexWrap: "wrap", gap: "8px 16px" }}>
                {KIND_ORDER.map((k) => (
                  <li key={k} style={{ fontSize: 13, color: "#102B33", lineHeight: 1.6 }}>
                    <span style={{ ...KINDS[k].style, padding: "0 4px" }}>
                      <span style={badgeStyle}>{KINDS[k].label}</span>
                    </span>{" "}
                    {KINDS[k].describe} ({counts[k]})
                  </li>
                ))}
              </ul>
              <div style={textBoxStyle}>
                {redaction.lines.map((line, i) => (
                  <p key={i} dir="auto" style={{ margin: "0 0 8px" }}>
                    <strong>{line.role}:</strong>{" "}
                    {line.segments.map((s, j) =>
                      s.change ? (
                        <mark key={j} style={{ ...KINDS[s.change].style, color: "#102B33", padding: "0 2px" }}>
                          {s.text}
                          <span style={srOnly}> (replaced:</span>
                          <span style={badgeStyle}>{KINDS[s.change].label}</span>
                          <span style={srOnly}>)</span>
                        </mark>
                      ) : (
                        <span key={j}>{s.text}</span>
                      ),
                    )}
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
});

const textBoxStyle: React.CSSProperties = {
  background: "#FFFFFF",
  border: `1px solid ${FIELD_BORDER}`,
  borderRadius: 8,
  padding: "12px 14px",
  fontSize: 15,
  lineHeight: 1.7,
  color: "#102B33",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  margin: "0 0 12px",
};
