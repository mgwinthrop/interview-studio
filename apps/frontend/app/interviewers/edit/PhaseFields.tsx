// The editor's list sections: phases (add, remove, move, 1 to 8) and focus items (up to 6).
import { INTERVIEWER_LIMITS } from "../../lib/interviewerForm";
import { ErrorText, TextField, TurnsField, hintStyle, smallButtonStyle } from "./FieldRow";
import { fieldId, fixTurnFields, newKey, type FormFocus, type FormPhase } from "./formState";

export const sectionHeadingStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: "#102B33",
  margin: "0 0 8px",
  letterSpacing: "-0.01em",
};

export function disabledStyle(style: React.CSSProperties, disabled: boolean): React.CSSProperties {
  return disabled ? { ...style, opacity: 0.55, cursor: "not-allowed" } : style;
}

const rowStyle: React.CSSProperties = {
  border: "1px solid #E2E6EA",
  borderRadius: 10,
  padding: "16px 16px 4px",
  margin: "0 0 16px",
  background: "#FFFFFF",
};

interface PhaseFieldsProps {
  phases: FormPhase[];
  errors: Record<string, string>;
  readOnly: boolean;
  /** `structural` is true when phases were added, removed or moved (their indexes changed). */
  onChange: (phases: FormPhase[], structural: boolean) => void;
}

export function PhaseFields({ phases, errors, readOnly, onChange }: PhaseFieldsProps) {
  const last = phases.length - 1;
  const max = INTERVIEWER_LIMITS.phases;

  function edit(i: number, patch: Partial<FormPhase>) {
    onChange(phases.map((p, j) => (j === i ? { ...p, ...patch } : p)), false);
  }
  function move(i: number, by: -1 | 1) {
    const next = [...phases];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(fixTurnFields(next), true);
  }
  function remove(i: number) {
    onChange(fixTurnFields(phases.filter((_, j) => j !== i)), true);
  }
  function add() {
    const added: FormPhase = { key: newKey(), name: "", instruction: "", minTurns: "", maxTurns: "" };
    onChange(fixTurnFields([...phases, added]), true);
  }

  return (
    <section aria-labelledby={fieldId("phases")} style={{ marginBottom: 28 }}>
      <h2 id={fieldId("phases")} tabIndex={-1} style={sectionHeadingStyle}>
        Phases
      </h2>
      <p style={hintStyle}>
        The interview moves through these phases in order. Each phase except the last ends after a
        number of answers from the person; the last phase runs until the interview ends.
      </p>
      {errors.phases && <ErrorText id={`${fieldId("phases")}-error`} message={errors.phases} />}
      <ol style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
        {phases.map((p, i) => (
          <li key={p.key}>
            <fieldset style={rowStyle}>
              <legend style={{ fontSize: 15, fontWeight: 700, color: "#102B33", padding: "0 6px" }}>
                Phase {i + 1} of {phases.length}
                {i === last ? " (last)" : ""}
              </legend>
              {errors[`phases.${i}`] && (
                <ErrorText id={`${fieldId(`phases.${i}`)}-error`} message={errors[`phases.${i}`]} />
              )}
              <TextField
                path={`phases.${i}.name`}
                label="Phase name"
                value={p.name}
                maxLength={INTERVIEWER_LIMITS.phaseName}
                onChange={(v) => edit(i, { name: v })}
                error={errors[`phases.${i}.name`]}
                readOnly={readOnly}
              />
              <TextField
                path={`phases.${i}.instruction`}
                label="What the interviewer does in this phase"
                value={p.instruction}
                maxLength={INTERVIEWER_LIMITS.phaseInstruction}
                onChange={(v) => edit(i, { instruction: v })}
                error={errors[`phases.${i}.instruction`]}
                rows={4}
                readOnly={readOnly}
              />
              {i !== last ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 20 }}>
                  <TurnsField
                    path={`phases.${i}.minTurns`}
                    label="Minimum user turns"
                    value={p.minTurns}
                    onChange={(v) => edit(i, { minTurns: v })}
                    error={errors[`phases.${i}.minTurns`]}
                    max={INTERVIEWER_LIMITS.turns}
                    readOnly={readOnly}
                  />
                  <TurnsField
                    path={`phases.${i}.maxTurns`}
                    label="Maximum user turns"
                    value={p.maxTurns}
                    onChange={(v) => edit(i, { maxTurns: v })}
                    error={errors[`phases.${i}.maxTurns`]}
                    max={INTERVIEWER_LIMITS.turns}
                    readOnly={readOnly}
                  />
                </div>
              ) : (
                <p style={{ ...hintStyle, marginBottom: 16 }}>
                  The last phase has no turn counts: it lasts until the interview ends.
                </p>
              )}
              {!readOnly && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move phase ${i + 1} up`}
                    style={disabledStyle(smallButtonStyle, i === 0)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === last}
                    aria-label={`Move phase ${i + 1} down`}
                    style={disabledStyle(smallButtonStyle, i === last)}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    disabled={phases.length <= 1}
                    aria-label={`Remove phase ${i + 1}`}
                    style={disabledStyle(smallButtonStyle, phases.length <= 1)}
                  >
                    Remove
                  </button>
                </div>
              )}
            </fieldset>
          </li>
        ))}
      </ol>
      {!readOnly && (
        <div>
          <button
            type="button"
            onClick={add}
            disabled={phases.length >= max}
            style={disabledStyle(smallButtonStyle, phases.length >= max)}
          >
            Add a phase at the end
          </button>
          <p style={{ ...hintStyle, marginTop: 6 }}>
            {phases.length} of {max} phases.
          </p>
        </div>
      )}
    </section>
  );
}

interface FocusFieldsProps {
  focus: FormFocus[];
  errors: Record<string, string>;
  readOnly: boolean;
  onChange: (focus: FormFocus[], structural: boolean) => void;
}

export function FocusFields({ focus, errors, readOnly, onChange }: FocusFieldsProps) {
  const max = INTERVIEWER_LIMITS.focusItems;
  return (
    <section aria-labelledby={fieldId("focus")} style={{ marginBottom: 28 }}>
      <h2 id={fieldId("focus")} tabIndex={-1} style={sectionHeadingStyle}>
        Focus
      </h2>
      <p style={hintStyle}>
        Up to {max} things the written reflection should pay attention to. Optional.
      </p>
      {errors.focus && <ErrorText id={`${fieldId("focus")}-error`} message={errors.focus} />}
      {readOnly && focus.length === 0 && <p style={hintStyle}>No focus items.</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
        {focus.map((f, i) => (
          <li key={f.key} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <TextField
                path={`focus.${i}`}
                label={`Focus item ${i + 1}`}
                value={f.text}
                maxLength={INTERVIEWER_LIMITS.focusItem}
                onChange={(v) => onChange(focus.map((x, j) => (j === i ? { ...x, text: v } : x)), false)}
                error={errors[`focus.${i}`]}
                readOnly={readOnly}
              />
            </div>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange(focus.filter((_, j) => j !== i), true)}
                aria-label={`Remove focus item ${i + 1}`}
                style={{ ...smallButtonStyle, marginTop: 28 }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div>
          <button
            type="button"
            onClick={() => onChange([...focus, { key: newKey(), text: "" }], true)}
            disabled={focus.length >= max}
            style={disabledStyle(smallButtonStyle, focus.length >= max)}
          >
            Add a focus item
          </button>
          <p style={{ ...hintStyle, marginTop: 6 }}>
            {focus.length} of {max} focus items.
          </p>
        </div>
      )}
    </section>
  );
}
