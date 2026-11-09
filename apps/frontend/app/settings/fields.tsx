// Shared parts of the Settings page: styles, a labelled select and a labelled text input.
// A control that cannot be changed right now (a request is running, or its list could not be
// loaded) keeps its focus: it is marked aria-disabled and its change handler does nothing.
import type { CSSProperties, ReactNode } from "react";
import { FIELD_BORDER, secondaryButtonStyle } from "../lib/ui";
import { ERROR_COLOR, ErrorText, hintStyle, labelStyle } from "../interviewers/edit/FieldRow";

export { ERROR_COLOR, ErrorText, hintStyle, labelStyle };

export const srOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function controlStyle(invalid: boolean, unavailable: boolean): CSSProperties {
  return {
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 8,
    border: invalid ? `2px solid ${ERROR_COLOR}` : `1px solid ${FIELD_BORDER}`,
    background: unavailable ? "#F4F5F1" : "#FFFFFF",
    color: "#102B33",
    fontSize: 15,
    lineHeight: 1.5,
    fontFamily: "var(--font-manrope), sans-serif",
    cursor: unavailable ? "not-allowed" : undefined,
  };
}

export const smallSecondaryStyle: CSSProperties = { ...secondaryButtonStyle, padding: "8px 16px", fontSize: 14 };

export const fieldBlockStyle: CSSProperties = { marginBottom: 20 };

export const subHeadingStyle: CSSProperties = { fontSize: 16, fontWeight: 700, color: "#102B33", margin: "0 0 8px" };

export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter((x): x is string => typeof x === "string" && x.length > 0);
  return list.length > 0 ? list.join(" ") : undefined;
}

export interface Option {
  value: string;
  label: string;
}

interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  /** The control cannot be changed (aria-disabled). */
  unavailable: boolean;
  /** Ids of the hint lines, rendered by the caller as children. */
  hintIds: string[];
  error?: string;
  children?: ReactNode;
}

export function SelectField({ id, label, value, options, onChange, unavailable, hintIds, error, children }: SelectFieldProps) {
  return (
    <div style={fieldBlockStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        aria-disabled={unavailable ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(...hintIds, error && `${id}-error`)}
        onChange={(e) => {
          if (!unavailable) onChange(e.target.value);
        }}
        style={controlStyle(Boolean(error), unavailable)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {children}
      {error && <ErrorText id={`${id}-error`} message={error} />}
    </div>
  );
}

/**
 * Adds the saved value and the current choice to a list's options when the list lacks them, so
 * the saved value can always be chosen again. Each is added once.
 */
export function withKept(options: Option[], saved: string, current: string): Option[] {
  const out = [...options];
  for (const v of saved === current ? [saved] : [current, saved]) {
    if (!out.some((o) => o.value === v)) out.unshift({ value: v, label: `${v} (not in the current list)` });
  }
  return out;
}

/** One hint line under a field. */
export function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} style={{ ...hintStyle, margin: "6px 0 0" }}>
      {children}
    </p>
  );
}
