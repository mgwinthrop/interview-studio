"use client";

// Range and measure choices for the Usage page. Each is a labelled group of toggle buttons
// (aria-pressed). A choice that is not available stays focusable: it is aria-disabled and its
// handler does nothing. The buttons are never remounted, so focus stays on the pressed one.
import Link from "next/link";
import type { CSSProperties } from "react";
import { FIELD_BORDER } from "../lib/ui";
import type { Measure } from "../lib/usageChart";

export const RANGES = [7, 14, 30, 90] as const;
export type Range = (typeof RANGES)[number];

const COST_HINT_ID = "usage-cost-hint";

const groupLabelStyle: CSSProperties = {
  display: "block",
  fontSize: 14,
  fontWeight: 700,
  color: "#102B33",
  marginBottom: 6,
};

const rowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };

/** A toggle button: selected is teal with white text, unselected white with the field border. */
export function toggleStyle(pressed: boolean, unavailable = false): CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 8,
    border: pressed ? "1px solid #087E8B" : `1px solid ${FIELD_BORDER}`,
    background: pressed ? "#087E8B" : "#FFFFFF",
    color: pressed ? "#FFFFFF" : "#102B33",
    fontSize: 15,
    fontWeight: 600,
    fontFamily: "var(--font-manrope), sans-serif",
    lineHeight: 1.4,
    cursor: unavailable ? "not-allowed" : "pointer",
    opacity: unavailable ? 0.55 : 1,
  };
}

interface ControlsProps {
  days: Range;
  measure: Measure;
  costAvailable: boolean;
  /** Show why Cost is unavailable (only once a range has loaded without a cost). */
  explainCost: boolean;
  onDays: (days: Range) => void;
  onMeasure: (measure: Measure) => void;
}

export function Controls({ days, measure, costAvailable, explainCost, onDays, onMeasure }: ControlsProps) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 32px", margin: "0 0 20px" }}>
      <div role="group" aria-labelledby="usage-range-label">
        <span id="usage-range-label" style={groupLabelStyle}>
          Range
        </span>
        <div style={rowStyle}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={days === r}
              onClick={() => {
                if (days !== r) onDays(r);
              }}
              style={toggleStyle(days === r)}
            >
              {r} days
            </button>
          ))}
        </div>
      </div>

      <div role="group" aria-labelledby="usage-measure-label">
        <span id="usage-measure-label" style={groupLabelStyle}>
          Show
        </span>
        <div style={rowStyle}>
          <button
            key="tokens"
            type="button"
            aria-pressed={measure === "tokens"}
            onClick={() => {
              if (measure !== "tokens") onMeasure("tokens");
            }}
            style={toggleStyle(measure === "tokens")}
          >
            Tokens
          </button>
          <button
            key="cost"
            type="button"
            aria-pressed={measure === "cost"}
            aria-disabled={costAvailable ? undefined : true}
            aria-describedby={explainCost ? COST_HINT_ID : undefined}
            onClick={() => {
              if (costAvailable && measure !== "cost") onMeasure("cost");
            }}
            style={toggleStyle(measure === "cost", !costAvailable)}
          >
            Cost
          </button>
        </div>
        {explainCost && (
          <p id={COST_HINT_ID} style={{ fontSize: 13, color: "#566475", lineHeight: 1.5, margin: "6px 0 0" }}>
            <Link href="/settings" style={{ color: "#066C77", textDecoration: "underline" }}>
              Set prices in Settings to see costs
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
