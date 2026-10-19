import type { ReactNode } from "react";
import type { DeliverySummaryView, ReportV2View } from "../../lib/report";
import { MainSection, SubSection } from "./reportParts";
import { cardStyle, itemTextStyle, itemTitleStyle, panelStyle, plainListStyle, visuallyHidden } from "./reportStyles";

export function DeliverySection({
  delivery,
  unavailable,
}: {
  delivery?: ReportV2View["delivery"];
  unavailable?: boolean;
}) {
  return (
    delivery ? (
      <MainSection title="Delivery">
        <DeliveryNumbers summary={delivery.summary} />
        {delivery.summary.perTurn.length > 0 && (
          <SubSection title="Answer by answer">
            <ol role="list" style={plainListStyle}>
              {delivery.summary.perTurn.map((t) => (
                <li key={t.turn} style={{ ...cardStyle, padding: "10px 14px" }}>
                  <div style={{ ...itemTitleStyle, fontSize: 13, marginBottom: 2 }}>Answer {t.turn}</div>
                  <p style={{ ...itemTextStyle, fontSize: 13, color: "#33424F" }}>
                    <Value value={t.wordCount} format={(n) => `${n} ${n === 1 ? "word" : "words"}`} />
                    {" · pace "}
                    <Value value={t.wordsPerMinute} format={formatPace} />
                    {" · longest pause "}
                    <Value value={t.longestPauseSec} format={formatSeconds} />
                    {" · gap before answering "}
                    <Value
                      value={t.responseGapMs}
                      format={(ms) => formatSeconds(ms / 1000)}
                    />
                  </p>
                </li>
              ))}
            </ol>
          </SubSection>
        )}
        {/* Omitted (no empty frame) when the server dropped a reading that failed its number check. */}
        {delivery.reading !== undefined && (
          <SubSection title="In plain words">
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "#566475", lineHeight: 1.5 }}>
              A written reading of the numbers above. It is an interpretation, not a measurement.
            </p>
            <p dir="auto" style={{ ...panelStyle, margin: 0, borderLeft: "4px solid #087E8B" }}>
              {delivery.reading}
            </p>
          </SubSection>
        )}
      </MainSection>
    ) : unavailable ? (
      <MainSection title="Delivery">
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "#33424F" }}>
          Delivery wasn&apos;t measured for this conversation (typed answers, or a conversation from before delivery was measured).
        </p>
      </MainSection>
    ) : null
  );
}

/** The measured numbers. Nothing here is a score: each row is a plain count or duration. */
function DeliveryNumbers({ summary }: { summary: DeliverySummaryView }) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: "Answers measured", value: <Value value={summary.turnsMeasured} format={String} /> },
    { label: "Words spoken", value: <Value value={summary.totalWords} format={String} /> },
    {
      label: "Speaking time (m:ss)",
      value: <Value value={summary.speakingTimeSec} format={formatMinSec} />,
    },
    {
      label: "Average pace",
      value: <Value value={summary.averageWordsPerMinute} format={formatPace} />,
    },
    { label: "Pauses", value: <Value value={summary.pauseCount} format={String} /> },
    {
      label: "Longest pause",
      value: <Value value={summary.longestPauseSec} format={formatSeconds} />,
    },
    {
      label: "Typical gap before answering",
      value: (
        <Value
          value={summary.medianResponseGapMs}
          format={(ms) => formatSeconds(ms / 1000)}
        />
      ),
    },
  ];
  // Filler words are shown only when they were counted; otherwise the row is left out.
  if (summary.fillerCount !== null) {
    rows.push({ label: "Filler words", value: String(summary.fillerCount) });
  }
  const anyNotMeasured = [
    summary.turnsMeasured,
    summary.totalWords,
    summary.speakingTimeSec,
    summary.averageWordsPerMinute,
    summary.pauseCount,
    summary.longestPauseSec,
    summary.medianResponseGapMs,
    ...summary.perTurn.flatMap((t) => [t.wordCount, t.wordsPerMinute, t.longestPauseSec, t.responseGapMs]),
  ].some((v) => v === null);

  return (
    <div style={{ marginBottom: 24 }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          background: "#FFFFFF",
          border: "1px solid #E2E6EA",
          fontSize: 14,
        }}
      >
        <caption style={{ textAlign: "left", fontSize: 13, color: "#566475", padding: "0 0 8px", lineHeight: 1.5 }}>
          Measured from your spoken answers
        </caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} style={{ borderTop: "1px solid #E2E6EA" }}>
              <th
                scope="row"
                style={{ textAlign: "left", fontWeight: 600, color: "#33424F", padding: "10px 14px", verticalAlign: "top" }}
              >
                {r.label}
              </th>
              <td
                style={{
                  textAlign: "right",
                  color: "#000000",
                  padding: "10px 14px",
                  fontVariantNumeric: "tabular-nums",
                  verticalAlign: "top",
                }}
              >
                {r.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {anyNotMeasured && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#566475", lineHeight: 1.5 }}>
          <span aria-hidden="true">—</span> means not measured, for example when an answer was too short to time.
        </p>
      )}
    </div>
  );
}

/** A measured number, or an em dash read out as "not measured" when it is null. */
function Value({ value, format }: { value: number | null; format: (n: number) => string }) {
  if (value === null) {
    return (
      <span>
        <span aria-hidden="true">—</span>
        <span style={visuallyHidden}>not measured</span>
      </span>
    );
  }
  return <>{format(value)}</>;
}

function formatPace(wpm: number): string {
  return `${Math.round(wpm)} words per minute`;
}

function formatSeconds(sec: number): string {
  const s = Math.round(sec * 10) / 10;
  return `${s.toFixed(1)} ${s === 1 ? "second" : "seconds"}`;
}

function formatMinSec(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
