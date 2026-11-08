"use client";

// The send confirmation: a modal dialog shown before anything goes to Claude. Focus moves to its
// heading on open, stays inside while it is open, and Escape or Cancel closes it (the page returns
// focus to the button that opened it). Nothing is sent until Confirm and send.
import { useEffect, useRef } from "react";
import { MAX_SENT_CHARS } from "../../lib/calls";
import { primaryButtonStyle, secondaryButtonStyle } from "../../lib/ui";
import { disabledStyle } from "../edit/PhaseFields";
import { BEST_EFFORT_NOTICE, errorTextStyle, noticeStyle } from "./styles";

interface SendConfirmProps {
  calls: number;
  approvedChars: number;
  sentChars: number;
  trimmed: boolean;
  sending: boolean;
  /** Fixed error text from the page, or null. */
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const fmt = (n: number) => n.toLocaleString("en-GB");

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SendConfirm({ calls, approvedChars, sentChars, trimmed, sending, error, onConfirm, onCancel }: SendConfirmProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    // Focus that lands outside the dialog (a click on the backdrop, say) comes back to the heading.
    function keepInside(e: FocusEvent) {
      const dialog = dialogRef.current;
      if (dialog && e.target instanceof Node && !dialog.contains(e.target)) headingRef.current?.focus();
    }
    document.addEventListener("focusin", keepInside);
    return () => document.removeEventListener("focusin", keepInside);
  }, []);

  // The buttons are disabled while sending; keep the focus on something inside the dialog.
  useEffect(() => {
    if (sending) headingRef.current?.focus();
  }, [sending]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!sending) onCancel();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      headingRef.current?.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = active instanceof Node && dialogRef.current.contains(active);
    if (e.shiftKey && (active === first || active === headingRef.current || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div style={overlayStyle}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-heading"
        aria-describedby="send-summary"
        onKeyDown={onKeyDown}
        style={dialogStyle}
      >
        <h2 id="send-heading" ref={headingRef} tabIndex={-1} style={{ fontSize: 20, fontWeight: 800, color: "#102B33", margin: "0 0 12px", outline: "none" }}>
          Send to draft the persona?
        </h2>
        <div id="send-summary">
          <ul style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 15, color: "#102B33", lineHeight: 1.6 }}>
            <li>{calls === 1 ? "1 approved call" : `${calls} approved calls`}</li>
            <li>{fmt(approvedChars)} characters approved in total</li>
            <li>About {fmt(sentChars)} characters will be sent</li>
          </ul>
          <p style={{ fontSize: 14, color: "#102B33", lineHeight: 1.5, margin: "0 0 12px" }}>
            Only the buyer&apos;s lines and the line just before each are sent, up to {fmt(MAX_SENT_CHARS)} characters in
            total, newest first.
            {trimmed && " Earlier material from your calls will be left out because of the size limit."}
          </p>
          <p style={noticeStyle}>{BEST_EFFORT_NOTICE}</p>
          <p style={{ fontSize: 15, color: "#102B33", lineHeight: 1.5, fontWeight: 700, margin: "0 0 16px" }}>
            This text will be sent to Claude&apos;s API to draft the persona. Check your client agreements allow this.
          </p>
        </div>

        {error && (
          <p ref={errorRef} tabIndex={-1} role="alert" style={errorTextStyle}>
            Error: {error}
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <button type="button" onClick={onConfirm} disabled={sending} style={disabledStyle(primaryButtonStyle, sending)}>
            {sending ? "Sending…" : "Confirm and send"}
          </button>
          <button type="button" onClick={onCancel} disabled={sending} style={disabledStyle(secondaryButtonStyle, sending)}>
            Cancel
          </button>
        </div>
        <div role="status" style={{ marginTop: 8 }}>
          {sending && <p style={{ fontSize: 13, color: "#4B5563", margin: 0 }}>Making a draft. This can take a little while.</p>}
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  background: "rgba(16, 43, 51, 0.55)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  overflowY: "auto",
  padding: "32px 16px",
};

const dialogStyle: React.CSSProperties = {
  background: "#FFFFFF",
  borderRadius: 12,
  border: "1px solid #E2E6EA",
  padding: "20px 20px",
  width: "100%",
  maxWidth: 560,
  boxSizing: "border-box",
  overflowWrap: "anywhere",
  fontFamily: "var(--font-manrope), sans-serif",
};
