"use client";

import Link from "next/link";
import { useState } from "react";
import {
  fetchUsageSummary,
  formatCount,
  formatUsd,
  type UsageSummary as Summary,
} from "../lib/usage";

const DAYS = 30;

const FEATURE_LABELS: Record<string, string> = {
  conversation: "Conversation replies",
  report: "Reports",
  "designer-draft": "Interviewer drafts",
  "persona-draft": "Persona drafts from calls",
};

const NOT_AVAILABLE = "not available";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "error" } | { kind: "ok"; summary: Summary };

const cellStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #E2E6EA",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};
const headStyle: React.CSSProperties = { ...cellStyle, fontWeight: 700, color: "#000000" };
const rowHeadStyle: React.CSSProperties = {
  ...cellStyle,
  textAlign: "left",
  whiteSpace: "normal",
  fontWeight: 600,
};
const noteStyle: React.CSSProperties = { margin: "8px 0 0", fontSize: 13, color: "#566475", lineHeight: 1.5 };

function cost(n: number | null): string {
  return n === null ? NOT_AVAILABLE : `${formatUsd(n)} USD`;
}

export function UsageSummary() {
  const [state, setState] = useState<State>({ kind: "idle" });

  function onToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    // Fetch the first time the section is opened; later opens reuse the result.
    if (!e.currentTarget.open || state.kind !== "idle") return;
    setState({ kind: "loading" });
    fetchUsageSummary(DAYS).then((r) =>
      setState(r.kind === "ok" ? { kind: "ok", summary: r.value } : { kind: "error" })
    );
  }

  return (
    <details
      onToggle={onToggle}
      style={{
        background: "#FFFFFF",
        borderTop: "0.5px solid #E2E6EA",
        padding: "10px 20px",
        fontSize: 13,
        color: "#566475",
        fontFamily: "var(--font-manrope), sans-serif",
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 700, color: "#000000", fontSize: 14 }}>Usage</summary>
      <div style={{ marginTop: 10 }}>
        {state.kind === "loading" && (
          <p role="status" style={noteStyle}>
            Loading usage…
          </p>
        )}
        {state.kind === "error" && (
          <p role="alert" style={{ ...noteStyle, color: "#B3261E" }}>
            Usage could not be loaded.
          </p>
        )}
        {state.kind === "ok" && <Body summary={state.summary} />}
      </div>
    </details>
  );
}

function Body({ summary }: { summary: Summary }) {
  const rows = summary.byFeature;
  const total = rows.reduce(
    (t, r) => ({
      calls: t.calls + r.calls,
      inputTokens: t.inputTokens + r.inputTokens,
      outputTokens: t.outputTokens + r.outputTokens,
      // A total cost only if every row has one; otherwise it would understate.
      cost: t.cost === null || r.estimatedCostUsd === null ? null : t.cost + r.estimatedCostUsd,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 as number | null }
  );

  return (
    <>
      {rows.length === 0 ? (
        <p style={noteStyle}>No usage recorded yet.</p>
      ) : (
        <div
          role="region"
          aria-label="Usage by feature, scrolls sideways on narrow screens"
          tabIndex={0}
          style={{ overflowX: "auto", maxWidth: "100%" }}
        >
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, color: "#000000" }}>
            <caption style={{ textAlign: "left", color: "#566475", paddingBottom: 6 }}>
              Model usage by feature, last {DAYS} days
            </caption>
            <thead>
              <tr>
                <th scope="col" style={{ ...headStyle, textAlign: "left" }}>Feature</th>
                <th scope="col" style={headStyle}>Calls</th>
                <th scope="col" style={headStyle}>Input tokens</th>
                <th scope="col" style={headStyle}>Output tokens</th>
                <th scope="col" style={headStyle}>Estimated cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.feature}>
                  <th scope="row" style={rowHeadStyle}>{FEATURE_LABELS[r.feature] ?? r.feature}</th>
                  <td style={cellStyle}>{formatCount(r.calls)}</td>
                  <td style={cellStyle}>{formatCount(r.inputTokens)}</td>
                  <td style={cellStyle}>{formatCount(r.outputTokens)}</td>
                  <td style={cellStyle}>{cost(r.estimatedCostUsd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" style={{ ...rowHeadStyle, fontWeight: 700 }}>Total</th>
                <td style={{ ...cellStyle, fontWeight: 700 }}>{formatCount(total.calls)}</td>
                <td style={{ ...cellStyle, fontWeight: 700 }}>{formatCount(total.inputTokens)}</td>
                <td style={{ ...cellStyle, fontWeight: 700 }}>{formatCount(total.outputTokens)}</td>
                <td style={{ ...cellStyle, fontWeight: 700 }}>{cost(total.cost)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p style={noteStyle}>
        {summary.priceTableAsOf !== null
          ? `Cost is an estimate using prices as of ${summary.priceTableAsOf}.`
          : (
              <>
                No prices are set, so costs are not available. Add prices in{" "}
                <Link href="/settings" style={{ color: "#066C77", textDecoration: "underline" }}>
                  Settings
                </Link>
                .
              </>
            )}
      </p>
      <ul style={{ ...noteStyle, paddingLeft: 20 }}>
        <li>Replies that were interrupted (aborted) are not counted.</li>
        <li>Designer chat is counted under &ldquo;Conversation replies&rdquo;.</li>
        <li>Cost is an estimate using the prices in place when each call was recorded.</li>
      </ul>
    </>
  );
}
