// The three headline numbers for the chosen range: estimated cost, tokens, model calls.
import type { CSSProperties } from "react";
import { panelStyle } from "../interviewers/edit/EditorParts";
import { formatCount, formatUsd, type UsageTotals } from "../lib/usage";
import { formatTokens } from "../lib/usageChart";

const NOT_AVAILABLE = "not available";

const tileStyle: CSSProperties = { ...panelStyle, margin: 0, flex: "1 1 180px", minWidth: 0 };
const labelStyle: CSSProperties = { fontSize: 14, fontWeight: 700, color: "#102B33", margin: 0 };
const valueStyle: CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  color: "#102B33",
  margin: "6px 0 2px",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.01em",
};
const subStyle: CSSProperties = { fontSize: 13, color: "#566475", lineHeight: 1.5, margin: 0 };

interface UsageTilesProps {
  days: number;
  totals: UsageTotals;
  priceTableAsOf: string | null;
}

export function UsageTiles({ days, totals, priceTableAsOf }: UsageTilesProps) {
  const cost = totals.calls > 0 ? totals.estimatedCostUsd : null;
  const costSub = priceTableAsOf ? `estimate, Claude only · prices as of ${priceTableAsOf}` : "estimate, Claude only";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, margin: "0 0 20px" }}>
      <Tile label={`Estimated cost, last ${days} days`} value={cost === null ? NOT_AVAILABLE : formatUsd(cost)} sub={costSub} />
      <Tile
        label="Tokens"
        value={formatTokens(totals.inputTokens + totals.outputTokens)}
        sub={`${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out`}
      />
      <Tile label="Model calls" value={formatCount(totals.calls)} sub={`last ${days} days`} />
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={tileStyle}>
      <p style={labelStyle}>{label}</p>
      <p style={valueStyle}>{value}</p>
      <p style={subStyle}>{sub}</p>
    </div>
  );
}
