// The table twin of the trend chart: one row per day, one column per series, then the day's total.
import { FEATURE_LABELS, type ChartData, type Measure } from "../../lib/usageChart";
import { tableCell, tableTotalCell } from "./chartLayout";
import { cellStyle, headStyle, rowHeadStyle } from "./tableStyles";


export function TrendTable({ data, measure, captionId }: { data: ChartData; measure: Measure; captionId: string }) {
  return (
    <div role="region" aria-labelledby={captionId} tabIndex={0} style={{ overflowX: "auto", maxWidth: "100%" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, color: "#000000" }}>
        <caption id={captionId} style={{ textAlign: "left", color: "#566475", paddingBottom: 6 }}>
          {measure === "cost" ? "Estimated cost" : "Tokens"} per day (UTC)
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ ...headStyle, textAlign: "left" }}>
              Day
            </th>
            {data.seriesKeys.map((key) => (
              <th key={key} scope="col" style={headStyle}>
                {FEATURE_LABELS[key]}
              </th>
            ))}
            <th scope="col" style={headStyle}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {data.days.map((day) => (
            <tr key={day.date}>
              <th scope="row" style={rowHeadStyle}>
                {day.label}
              </th>
              {data.seriesKeys.map((key) => (
                <td key={key} style={cellStyle}>
                  {tableCell(measure, day.parts.find((p) => p.key === key))}
                </td>
              ))}
              <td style={{ ...cellStyle, fontWeight: 700 }}>{tableTotalCell(measure, day)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
