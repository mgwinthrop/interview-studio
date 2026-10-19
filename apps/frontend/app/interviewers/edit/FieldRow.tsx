// Small labelled fields for the interviewer editor: a visible label tied to the input, a live
// character count, and the field's error as text (never colour alone).
import { secondaryButtonStyle } from "../../lib/ui";
import { fieldId } from "./formState";

export const ERROR_COLOR = "#B42318";

export const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 14,
  fontWeight: 700,
  color: "#102B33",
  marginBottom: 6,
};

export const hintStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#4B5563",
  lineHeight: 1.5,
  margin: "0 0 6px",
};

function inputStyle(invalid: boolean, readOnly: boolean): React.CSSProperties {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 8,
    border: invalid ? `2px solid ${ERROR_COLOR}` : "1px solid #C9D0D6",
    background: readOnly ? "#F4F5F1" : "#FFFFFF",
    color: "#102B33",
    fontSize: 15,
    lineHeight: 1.5,
    fontFamily: "var(--font-manrope), sans-serif",
  };
}

export function ErrorText({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} style={{ fontSize: 14, color: ERROR_COLOR, fontWeight: 600, margin: "6px 0 0" }}>
      Error: {message}
    </p>
  );
}

interface TextFieldProps {
  /** The error path this field answers to, e.g. "name" or "phases.0.instruction". */
  path: string;
  label: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  rows?: number;
  readOnly?: boolean;
}

export function TextField({ path, label, value, maxLength, onChange, error, hint, rows, readOnly = false }: TextFieldProps) {
  const id = fieldId(path);
  const describedBy = [hint ? `${id}-hint` : "", readOnly ? "" : `${id}-count`, error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  const common = {
    id,
    value,
    maxLength,
    readOnly,
    dir: "auto" as const,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
    style: inputStyle(Boolean(error), readOnly),
  };
  return (
    <div style={{ marginBottom: 20 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} style={hintStyle}>
          {hint}
        </p>
      )}
      {rows ? (
        <textarea {...common} rows={rows} onChange={(e) => onChange(e.target.value)} style={{ ...common.style, resize: "vertical" }} />
      ) : (
        <input {...common} type="text" onChange={(e) => onChange(e.target.value)} />
      )}
      {!readOnly && (
        <p id={`${id}-count`} style={{ fontSize: 12, color: "#4B5563", margin: "4px 0 0", textAlign: "right" }}>
          {value.length} of {maxLength} characters
        </p>
      )}
      {error && <ErrorText id={`${id}-error`} message={error} />}
    </div>
  );
}

interface TurnsFieldProps {
  path: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  max: number;
  readOnly?: boolean;
}

/** A whole number of user turns, kept as the typed text. */
export function TurnsField({ path, label, value, onChange, error, max, readOnly = false }: TurnsFieldProps) {
  const id = fieldId(path);
  return (
    <div style={{ flex: "1 1 180px" }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        step={1}
        value={value}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle(Boolean(error), readOnly), maxWidth: 140 }}
      />
      {error && <ErrorText id={`${id}-error`} message={error} />}
    </div>
  );
}

export const smallButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  padding: "6px 12px",
  fontSize: 13,
};

export const dangerButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  color: ERROR_COLOR,
  border: `1px solid ${ERROR_COLOR}`,
};
