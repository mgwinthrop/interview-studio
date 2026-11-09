"use client";

// Claude prices: one row per stored price and one "not set" row per selected model without one.
// The table sits in a labelled region that scrolls sideways on narrow screens.
import type { CSSProperties } from "react";
import { SETTINGS_LIMITS } from "../lib/settings";
import { disabledStyle, sectionHeadingStyle } from "../interviewers/edit/PhaseFields";
import { panelStyle } from "../interviewers/edit/EditorParts";
import { smallButtonStyle } from "../interviewers/edit/FieldRow";
import { PRICES_REGION_ID, priceId, type DraftPrice } from "./draft";
import { ErrorText, controlStyle, describedBy, hintStyle, srOnly } from "./fields";

export type PriceInput = "input" | "output" | "asOf";

const NUMBER_HINT_ID = "price-number-hint";
const DATE_HINT_ID = "price-date-hint";

const headStyle: CSSProperties = {
  textAlign: "left",
  fontSize: 13,
  fontWeight: 700,
  color: "#102B33",
  padding: "6px 8px",
  borderBottom: "1px solid #E2E6EA",
  verticalAlign: "bottom",
};
const cellStyle: CSSProperties = { padding: "8px", verticalAlign: "top" };
const rowHeadStyle: CSSProperties = {
  ...cellStyle,
  textAlign: "left",
  fontSize: 14,
  fontWeight: 600,
  color: "#102B33",
  overflowWrap: "anywhere",
  minWidth: 120,
};

interface PricesSectionProps {
  rows: DraftPrice[];
  errors: Record<string, string>;
  locked: boolean;
  onChange: (row: number, field: PriceInput, value: string) => void;
  onClear: (row: number) => void;
}

export function PricesSection({ rows, errors, locked, onChange, onClear }: PricesSectionProps) {
  const tableError = errors.prices;

  return (
    <section aria-labelledby="prices-heading" style={panelStyle}>
      <h2 id="prices-heading" style={sectionHeadingStyle}>
        Prices
      </h2>
      <p style={{ ...hintStyle, marginBottom: 8 }}>
        Prices are for Claude only. Speech services are not billed per token, so Usage does not estimate their cost.
        Old usage keeps the price it had when it was recorded.
      </p>
      <p id={NUMBER_HINT_ID} style={hintStyle}>
        Prices are in USD per million tokens, from 0 to {SETTINGS_LIMITS.priceMax.toLocaleString("en-US")}; decimals are
        allowed. Leave a row empty, or clear it, to have no price for that model.
      </p>
      <p id={DATE_HINT_ID} style={{ ...hintStyle, marginBottom: 12 }}>
        Date the price was read, as YYYY-MM-DD
      </p>
      {tableError && <ErrorText id="prices-error" message={tableError} />}

      {rows.length === 0 ? (
        <p style={hintStyle}>There are no Claude models to price yet.</p>
      ) : (
        <div
          id={PRICES_REGION_ID}
          role="region"
          aria-label="Claude prices, scrolls sideways on narrow screens"
          aria-describedby={tableError ? "prices-error" : undefined}
          tabIndex={0}
          style={{ overflowX: "auto", maxWidth: "100%", marginTop: 8 }}
        >
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 600 }}>
            <caption style={{ textAlign: "left", fontSize: 13, color: "#4B5563", paddingBottom: 6 }}>
              Claude prices per model, in USD per million tokens
            </caption>
            <thead>
              <tr>
                <th scope="col" style={headStyle}>Model</th>
                <th scope="col" style={headStyle}>Input USD per million tokens</th>
                <th scope="col" style={headStyle}>Output USD per million tokens</th>
                <th scope="col" style={headStyle}>As of</th>
                <th scope="col" style={headStyle}>
                  <span style={srOnly}>Clear</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <PriceRowView key={`${r.model}-${i}`} row={r} index={i} errors={errors} locked={locked} onChange={onChange} onClear={onClear} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface PriceRowViewProps {
  row: DraftPrice;
  index: number;
  errors: Record<string, string>;
  locked: boolean;
  onChange: (row: number, field: PriceInput, value: string) => void;
  onClear: (row: number) => void;
}

function PriceRowView({ row, index, errors, locked, onChange, onClear }: PriceRowViewProps) {
  const rowError = errors[`prices.${index}.row`];
  const rowErrorId = `price-${index}-row-error`;
  const empty = row.input === "" && row.output === "" && row.asOf === "";
  const fields: { field: PriceInput; key: "inputPerMtok" | "outputPerMtok" | "asOf"; label: string }[] = [
    { field: "input", key: "inputPerMtok", label: `Input USD per million tokens for ${row.model}` },
    { field: "output", key: "outputPerMtok", label: `Output USD per million tokens for ${row.model}` },
    { field: "asOf", key: "asOf", label: `As of date for ${row.model}` },
  ];
  const fieldErrors = fields
    .map((f) => ({ id: `${priceId(index, f.key)}-error`, message: errors[`prices.${index}.${f.key}`], key: f.key }))
    .filter((e): e is { id: string; message: string; key: typeof e.key } => typeof e.message === "string");
  const hasErrors = rowError !== undefined || fieldErrors.length > 0;

  return (
    <>
      <tr style={{ borderTop: "1px solid #E2E6EA" }}>
        <th scope="row" style={rowHeadStyle}>
          <code style={{ fontSize: 13 }}>{row.model}</code>
          {!row.stored && <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#4B5563" }}>not set</span>}
        </th>
        {fields.map((f) => {
          const id = priceId(index, f.key);
          const error = errors[`prices.${index}.${f.key}`];
          const invalid = Boolean(error) || Boolean(rowError);
          const value = f.field === "input" ? row.input : f.field === "output" ? row.output : row.asOf;
          return (
            <td key={f.field} style={cellStyle}>
              <label htmlFor={id} style={srOnly}>
                {f.label}
              </label>
              {f.field === "asOf" ? (
                <input
                  id={id}
                  type="text"
                  inputMode="numeric"
                  placeholder="YYYY-MM-DD"
                  autoComplete="off"
                  value={value}
                  readOnly={locked}
                  aria-invalid={invalid ? true : undefined}
                  aria-describedby={describedBy(DATE_HINT_ID, error && `${id}-error`, rowError && rowErrorId)}
                  onChange={(e) => onChange(index, f.field, e.target.value)}
                  style={{ ...controlStyle(invalid, locked), width: 130 }}
                />
              ) : (
                <input
                  id={id}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={value}
                  readOnly={locked}
                  aria-invalid={invalid ? true : undefined}
                  aria-describedby={describedBy(NUMBER_HINT_ID, error && `${id}-error`, rowError && rowErrorId)}
                  onChange={(e) => onChange(index, f.field, e.target.value)}
                  style={{ ...controlStyle(invalid, locked), width: 120 }}
                />
              )}
            </td>
          );
        })}
        <td style={cellStyle}>
          <button
            type="button"
            aria-label={`Clear the price for ${row.model}`}
            aria-disabled={locked || empty ? true : undefined}
            onClick={() => {
              if (!locked && !empty) onClear(index);
            }}
            style={disabledStyle(smallButtonStyle, locked || empty)}
          >
            Clear
          </button>
        </td>
      </tr>
      {hasErrors && (
        <tr>
          <td colSpan={5} style={{ ...cellStyle, paddingTop: 0 }}>
            {rowError && <ErrorText id={rowErrorId} message={rowError} />}
            {fieldErrors.map((e) => (
              <ErrorText
                key={e.id}
                id={e.id}
                message={`${e.key === "inputPerMtok" ? "Input price" : e.key === "outputPerMtok" ? "Output price" : "As of date"}: ${e.message}`}
              />
            ))}
          </td>
        </tr>
      )}
    </>
  );
}
