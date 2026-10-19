// Presentational parts of the interviewer editor: the page shell, the failure message (with
// the error summary of a 422), the feedback switches and the action bar.
import Link from "next/link";
import { Nav } from "../../components/Nav";
import type { FieldError } from "../../lib/interviewers";
import {
  dangerButtonStyle,
  hintStyle,
  labelStyle,
} from "./FieldRow";
import { primaryButtonStyle, secondaryButtonStyle } from "../../lib/ui";
import { disabledStyle, sectionHeadingStyle } from "./PhaseFields";
import { labelForPath, targetIdForPath, type FormState } from "./formState";

export const LIST_PATH = "/interviewers";
export const CONFLICT_MESSAGE =
  "This interviewer was changed somewhere else. Reload to get the latest version; your edits here will be lost.";
export const NOT_FOUND_MESSAGE = "That interviewer no longer exists.";

export type Failure =
  | { kind: "conflict" }
  | { kind: "not_found" }
  | { kind: "message"; text: string }
  | { kind: "invalid"; title: string; errors: FieldError[] };

export type Busy = "save" | "duplicate" | "delete" | "reload" | null;

export function FailureMessage({ failure, form }: { failure: Failure; form: FormState }) {
  if (failure.kind === "conflict") return <p style={bodyStyle}>{CONFLICT_MESSAGE}</p>;
  if (failure.kind === "not_found") {
    return (
      <p style={bodyStyle}>
        {NOT_FOUND_MESSAGE} <Link href={LIST_PATH} style={{ color: "#087E8B", fontWeight: 700 }}>All interviewers</Link>
      </p>
    );
  }
  if (failure.kind === "message") return <p style={bodyStyle}>{failure.text}</p>;
  return (
    <>
      <h2 style={{ ...sectionHeadingStyle, fontSize: 16 }}>{failure.title}</h2>
      <p style={bodyStyle}>Nothing you typed was cleared. Fix these and try again:</p>
      <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
        {failure.errors.map((e, i) => {
          const label = labelForPath(e.path);
          const target = targetIdForPath(e.path, form);
          const text = label ? `${label}: ${e.message}` : e.message;
          return (
            <li key={i} style={{ ...bodyStyle, marginBottom: 4 }}>
              {target ? <a href={`#${target}`} style={{ color: "#087E8B", fontWeight: 600 }}>{text}</a> : text}
            </li>
          );
        })}
      </ul>
    </>
  );
}

interface SwitchProps {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  describedBy?: string;
  onChange: (checked: boolean) => void;
}

export function Switch({ id, label, checked, disabled, describedBy, onChange }: SwitchProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 20, height: 20, accentColor: "#087E8B" }}
      />
      <label htmlFor={id} style={{ ...labelStyle, marginBottom: 0 }}>
        {label} <span style={{ fontWeight: 500, color: "#4B5563" }}>({checked ? "on" : "off"})</span>
      </label>
    </div>
  );
}

interface ActionBarProps {
  existing: boolean;
  busy: Busy;
  confirmDelete: boolean;
  onTry: () => void;
  onDuplicate: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}

export function ActionBar({ existing, busy, confirmDelete, onTry, onDuplicate, onAskDelete, onCancelDelete, onDelete }: ActionBarProps) {
  const disabled = busy !== null;
  return (
    <div style={{ borderTop: "1px solid #E2E6EA", paddingTop: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <button type="submit" disabled={disabled} style={disabledStyle(primaryButtonStyle, disabled)}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onTry} disabled={disabled} aria-describedby="try-hint" style={disabledStyle(secondaryButtonStyle, disabled)}>
          Try it
        </button>
        {existing && (
          <>
            <button type="button" onClick={onDuplicate} disabled={disabled} style={disabledStyle(secondaryButtonStyle, disabled)}>
              {busy === "duplicate" ? "Duplicating…" : "Duplicate"}
            </button>
            <button type="button" onClick={onAskDelete} disabled={disabled || confirmDelete} style={disabledStyle(dangerButtonStyle, disabled || confirmDelete)}>
              Delete
            </button>
          </>
        )}
      </div>
      <p id="try-hint" style={{ ...hintStyle, marginTop: 10 }}>
        Try it starts a practice conversation with the form as it is now. Nothing is saved, and nothing
        here is lost: your edits are back when you finish the trial.
      </p>
      {existing && confirmDelete && (
        <div role="group" aria-labelledby="delete-question" style={{ ...panelStyle, marginTop: 16 }}>
          <p id="delete-question" style={{ ...bodyStyle, fontWeight: 700 }}>Delete this interviewer?</p>
          <p style={bodyStyle}>It can&apos;t be undone. Past sessions with it keep their reports.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
            <button type="button" onClick={onDelete} disabled={disabled} style={disabledStyle(dangerButtonStyle, disabled)}>
              {busy === "delete" ? "Deleting…" : "Delete interviewer"}
            </button>
            <button type="button" onClick={onCancelDelete} disabled={disabled} style={disabledStyle(secondaryButtonStyle, disabled)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const bodyStyle: React.CSSProperties = { fontSize: 15, color: "#102B33", lineHeight: 1.6, margin: "0 0 8px" };

export const panelStyle: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E2E6EA",
  borderRadius: 12,
  padding: "16px 20px",
  margin: "0 0 20px",
};

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#F4F5F1", fontFamily: "var(--font-manrope), sans-serif" }}>
      <Nav />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 64px" }}>{children}</main>
    </div>
  );
}
