// The two breakdown tables of the Usage page: by what the calls were used for, and by model.
// Only rows with calls are listed. A cost is "not available" when none of the row's calls had a price.
import type { CSSProperties } from "react";
import { panelStyle } from "../interviewers/edit/EditorParts";
import { formatCount, formatUsd, type UsageTotals, type UsageTrend } from "../lib/usage";
import { NOT_AVAILABLE, FEATURE_LABELS, FEATURE_ORDER, addCost, seriesKeyOf, type SeriesKey } from "../lib/usageChart";
import { cellStyle, headStyle, rowHeadStyle as baseRowHeadStyle } from "../components/usage/tableStyles";

const headingStyle: CSSProperties = { fontSize: 18, fontWeight: 700, color: "#102B33", margin: "0 0 8px" };
const rowHeadStyle: CSSProperties = { ...baseRowHeadStyle, whiteSpace: "normal", overflowWrap: "anywhere" };
const totalStyle: CSSProperties = { ...cellStyle, fontWeight: 700 };

interface Row extends UsageTotals {
  key: string;
  label: string;
}

function cost(n: number | null): string {
  return n === null ? NOT_AVAILABLE : formatUsd(n);
}

/** Feature rows in the fixed order; unknown feature ids are grouped as "Other", last. */
export function featureRows(trend: UsageTrend): Row[] {
  const acc = new Map<SeriesKey, UsageTotals>();
  for (const r of trend.byFeature) {
    if (r.calls <= 0) continue;
    const key = seriesKeyOf(r.feature);
    const cur = acc.get(key) ?? { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: null };
    acc.set(key, {
      calls: cur.calls + r.calls,
      inputTokens: cur.inputTokens + r.inputTokens,
      outputTokens: cur.outputTokens + r.outputTokens,
      estimatedCostUsd: addCost(cur.estimatedCostUsd, r.estimatedCostUsd),
    });
  }
  const rows: Row[] = [];
  for (const key of [...FEATURE_ORDER, "other" as const]) {
    const t = acc.get(key);
    if (t) rows.push({ key, label: FEATURE_LABELS[key], ...t });
  }
  return rows;
}

/** Model rows sorted by model id. */
export function modelRows(trend: UsageTrend): Row[] {
  return trend.byModel
    .filter((r) => r.calls > 0)
    .map((r) => ({ key: r.model, label: r.model, calls: r.calls, inputTokens: r.inputTokens, outputTokens: r.outputTokens, estimatedCostUsd: r.estimatedCostUsd }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

export function UsageTables({ trend, days }: { trend: UsageTrend; days: number }) {
  return (
    <>
      <UsageTable
        id="usage-by-feature"
        heading="By what they were used for"
        caption={`Model calls by what they were used for, last ${days} days (UTC)`}
        firstColumn="Used for"
        rows={featureRows(trend)}
        totals={trend.totals}
      />
      <UsageTable
        id="usage-by-model"
        heading="By model"
        caption={`Model calls by model, last ${days} days (UTC)`}
        firstColumn="Model"
        rows={modelRows(trend)}
      />
    </>
  );
}

interface UsageTableProps {
  id: string;
  heading: string;
  caption: string;
  firstColumn: string;
  rows: Row[];
  totals?: UsageTotals;
}

function UsageTable({ id, heading, caption, firstColumn, rows, totals }: UsageTableProps) {
  const headingId = `${id}-heading`;
  const captionId = `${id}-caption`;
  return (
    <section aria-labelledby={headingId} style={panelStyle}>
      <h2 id={headingId} style={headingStyle}>
        {heading}
      </h2>
      <div role="region" aria-labelledby={captionId} tabIndex={0} style={{ overflowX: "auto", maxWidth: "100%" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, color: "#000000" }}>
          <caption id={captionId} style={{ textAlign: "left", color: "#566475", paddingBottom: 6 }}>
            {caption}
          </caption>
          <thead>
            <tr>
              <th scope="col" style={{ ...headStyle, textAlign: "left" }}>
                {firstColumn}
              </th>
              <th scope="col" style={headStyle}>
                Calls
              </th>
              <th scope="col" style={headStyle}>
                Input tokens
              </th>
              <th scope="col" style={headStyle}>
                Output tokens
              </th>
              <th scope="col" style={headStyle}>
                Estimated cost
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" style={rowHeadStyle}>
                  {r.label}
                </th>
                <td style={cellStyle}>{formatCount(r.calls)}</td>
                <td style={cellStyle}>{formatCount(r.inputTokens)}</td>
                <td style={cellStyle}>{formatCount(r.outputTokens)}</td>
                <td style={cellStyle}>{cost(r.estimatedCostUsd)}</td>
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot>
              <tr>
                <th scope="row" style={{ ...rowHeadStyle, fontWeight: 700 }}>
                  Total
                </th>
                <td style={totalStyle}>{formatCount(totals.calls)}</td>
                <td style={totalStyle}>{formatCount(totals.inputTokens)}</td>
                <td style={totalStyle}>{formatCount(totals.outputTokens)}</td>
                <td style={totalStyle}>{cost(totals.estimatedCostUsd)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
