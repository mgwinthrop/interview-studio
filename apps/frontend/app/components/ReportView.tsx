"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../lib/config";
import type { DeliverySummaryView, ReportV1View, ReportV2View, ReportView as ReportData } from "../lib/report";
import { EARLIER_INTERVIEW_LABEL } from "../lib/interviewers";

interface ReportViewProps {
  report: ReportData;
  /** null for sessions stored before interviewers had names. */
  interviewerName: string | null;
  sessionId: string;
  onNewSession: () => void;
  /** Moves focus to the report heading on mount, e.g. after the report was regenerated. */
  focusHeading?: boolean;
}

export function ReportView({ report, interviewerName, sessionId, onNewSession, focusHeading }: ReportViewProps) {
  const [activeTab, setActiveTab] = useState<"report" | "transcript">("report");
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
  }, [focusHeading]);

  const generatedDate = new Date(report.generatedAt);
  const hasDate = !Number.isNaN(generatedDate.getTime());
  const headerDate = hasDate
    ? generatedDate.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const cardDate = hasDate
    ? generatedDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : null;

  const interviewerLabel = interviewerName ?? EARLIER_INTERVIEW_LABEL;

  return (
    <div style={{ fontFamily: "var(--font-manrope), sans-serif", background: "#F4F5F1", minHeight: "calc(100vh - 94px)" }}>
      {/* ── Page header bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 32px",
          background: "#FFFFFF",
          borderBottom: "1px solid #E2E6EA",
        }}
      >
        <div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            style={{
              fontSize: 20,
              fontWeight: 800,
              margin: 0,
              color: "#000000",
              letterSpacing: "-0.01em",
            }}
          >
            Report
          </h1>
          <p dir="auto" style={{ margin: "3px 0 0", fontSize: 13, color: "#6B7A8D", fontWeight: 400, overflowWrap: "anywhere" }}>
            {interviewerLabel}
            {headerDate ? ` — ${headerDate}` : ""}
          </p>
        </div>
        <button
          onClick={onNewSession}
          style={{
            padding: "9px 20px",
            borderRadius: 8,
            border: "1.5px solid #000000",
            background: "transparent",
            color: "#000000",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "var(--font-manrope), sans-serif",
          }}
        >
          New session
        </button>
      </div>

      {/* ── Two-column layout ── */}
      <div className="report-layout" style={{ display: "flex", minHeight: "calc(100vh - 150px)" }}>
        {/* Left sidebar */}
        <div
          className="report-sidebar"
          style={{
            width: 240,
            borderRight: "1px solid #E2E6EA",
            padding: "20px 14px",
            background: "#FFFFFF",
            flexShrink: 0,
          }}
        >
          {/* Sessions label */}
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#6B7A8D",
              marginBottom: 10,
            }}
          >
            Sessions
          </div>

          {/* Current session card */}
          <div
            style={{
              borderRadius: 10,
              border: "1px solid #E2E6EA",
              borderLeft: "3px solid #087E8B",
              padding: "12px 12px",
              background: "#FAFBFF",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 3,
              }}
            >
              <span dir="auto" style={{ fontSize: 13, fontWeight: 700, color: "#087E8B", overflowWrap: "anywhere" }}>
                {interviewerLabel}
              </span>
              <span style={{ fontSize: 11, color: "#6B7A8D", fontWeight: 400, flexShrink: 0, marginLeft: 8 }}>
                {cardDate}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#6B7A8D", marginBottom: 8, fontWeight: 400 }}>
              Report ready
            </div>
            {report.format === 1 && report.strengths.length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  background: "#D8F0EC",
                  color: "#087E8B",
                  padding: "2px 8px",
                  borderRadius: 999,
                }}
              >
                {report.strengths.length} area{report.strengths.length !== 1 ? "s" : ""} of depth
              </span>
            )}
          </div>

          {/* Identified outcomes */}
          {report.format === 1 && report.highlights.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "#6B7A8D",
                  marginBottom: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span>☆</span> Identified outcomes
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {report.highlights.map((h, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      background: "#D8F0EC",
                      color: "#087E8B",
                      padding: "4px 10px",
                      borderRadius: 999,
                      display: "inline-block",
                    }}
                  >
                    {h}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="report-content-panel" style={{ flex: 1, padding: "24px 32px", overflowY: "auto" }}>
          {/* Tabs */}
          <div
            style={{
              display: "inline-flex",
              background: "#E8EAF0",
              borderRadius: 8,
              padding: 4,
              marginBottom: 28,
            }}
          >
            {(["report", "transcript"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "7px 18px",
                  borderRadius: 6,
                  border: "none",
                  background: activeTab === tab ? "#102B33" : "transparent",
                  color: activeTab === tab ? "#FFFFFF" : "#6B7A8D",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "var(--font-manrope), sans-serif",
                  transition: "background 0.15s, color 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                {tab === "report" ? "Report" : "Transcript"}
              </button>
            ))}
          </div>

          {/* ── Report tab ── */}
          {activeTab === "report" && report.format === 2 && <ReportV2Body report={report} />}
          {activeTab === "report" && report.format === 1 && <ReportV1Body report={report} />}

          {/* ── Transcript tab ── */}
          {activeTab === "transcript" && (
            <div style={{ maxWidth: 680 }}>
              <p style={{ fontSize: 15, color: "#6B7A8D", fontWeight: 400, margin: "0 0 20px" }}>
                Download the full session transcript as a text file.
              </p>
              {apiUrl ? (
                <a
                  href={`${apiUrl}/api/session/${encodeURIComponent(sessionId)}/transcript`}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block",
                    padding: "12px 24px",
                    borderRadius: 8,
                    background: "#087E8B",
                    color: "#FFFFFF",
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Download Transcript
                </a>
              ) : (
                <p style={{ fontSize: 14, color: "#E9784A", margin: 0 }}>
                  Transcript download unavailable — API URL not configured.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Format 1: older reports, rendered exactly as before. */
function ReportV1Body({ report }: { report: ReportV1View }) {
  return (
    <div style={{ maxWidth: 680 }}>
      <Section title="Summary">
        <div
          style={{
            padding: "18px 22px",
            borderRadius: 10,
            background: "#F8F9FB",
            border: "1px solid #E2E6EA",
            fontSize: 15,
            lineHeight: 1.75,
            color: "#000000",
            fontWeight: 400,
          }}
        >
          {report.summary}
        </div>
      </Section>

      <Section title="Overall reflection">
        <div
          style={{
            padding: "18px 22px",
            borderRadius: 10,
            background: "#F8F9FB",
            borderLeft: "4px solid #087E8B",
            fontSize: 15,
            lineHeight: 1.75,
            color: "#000000",
            fontWeight: 400,
          }}
        >
          {report.overallAssessment}
        </div>
      </Section>

      {report.format === 1 && report.strengths.length > 0 && (
        <Section title="Areas of depth">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {report.strengths.map((s, i) => (
              <div
                key={i}
                style={{
                  padding: "14px 18px",
                  borderRadius: 8,
                  background: "#FFFFFF",
                  border: "1px solid #E2E6EA",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#087E8B",
                    flexShrink: 0,
                    marginTop: 7,
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#000000",
                      marginBottom: 4,
                    }}
                  >
                    {s.area}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      lineHeight: 1.65,
                      color: "#000000",
                      fontWeight: 400,
                    }}
                  >
                    {s.evidence}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {report.improvements.length > 0 && (
        <Section title="Gaps identified">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {report.improvements.map((imp, i) => (
              <div
                key={i}
                style={{
                  padding: "14px 18px",
                  borderRadius: 8,
                  background: "#FFFFFF",
                  border: "1px solid #E2E6EA",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#E9784A",
                    flexShrink: 0,
                    marginTop: 7,
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#000000",
                      marginBottom: 4,
                    }}
                  >
                    {imp.area}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      lineHeight: 1.65,
                      color: "#000000",
                      fontWeight: 400,
                    }}
                  >
                    {imp.suggestion}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Format 2: content, delivery and next steps ───────────────────────────────

/** Format 2: three parts. Parts the server left out are simply absent. */
function ReportV2Body({ report }: { report: ReportV2View }) {
  const { content, delivery, deliveryUnavailable, nextSteps } = report;
  return (
    <div style={{ maxWidth: 680 }}>
      {content && (
        <MainSection title="Content">
          <p dir="auto" style={{ ...panelStyle, margin: "0 0 24px" }}>
            {content.summary}
          </p>

          {content.strengths.length > 0 && (
            <SubSection title="What came through">
              <ul role="list" style={plainListStyle}>
                {content.strengths.map((s, i) => (
                  <li key={i} style={cardStyle}>
                    <div dir="auto" style={itemTitleStyle}>
                      {s.area}
                    </div>
                    <blockquote
                      dir="auto"
                      style={{
                        margin: "0 0 8px",
                        padding: "2px 0 2px 14px",
                        borderLeft: "3px solid #087E8B",
                        fontSize: 14,
                        lineHeight: 1.65,
                        fontStyle: "italic",
                        color: "#000000",
                        overflowWrap: "anywhere",
                      }}
                    >
                      “{s.quote}”
                    </blockquote>
                    <p dir="auto" style={itemTextStyle}>
                      {s.note}
                    </p>
                  </li>
                ))}
              </ul>
            </SubSection>
          )}

          {content.developAreas.length > 0 && (
            <SubSection title="Worth developing">
              <ul role="list" style={plainListStyle}>
                {content.developAreas.map((d, i) => (
                  <li key={i} style={cardStyle}>
                    <div dir="auto" style={itemTitleStyle}>
                      {d.area}
                    </div>
                    <p dir="auto" style={itemTextStyle}>
                      {d.suggestion}
                    </p>
                  </li>
                ))}
              </ul>
            </SubSection>
          )}
        </MainSection>
      )}

      {delivery ? (
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
              <p style={{ margin: "0 0 8px", fontSize: 13, color: "#6B7A8D", lineHeight: 1.5 }}>
                A written reading of the numbers above. It is an interpretation, not a measurement.
              </p>
              <p dir="auto" style={{ ...panelStyle, margin: 0, borderLeft: "4px solid #087E8B" }}>
                {delivery.reading}
              </p>
            </SubSection>
          )}
        </MainSection>
      ) : deliveryUnavailable ? (
        <MainSection title="Delivery">
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "#33424F" }}>
            Delivery wasn&apos;t measured for this conversation (typed answers, or a conversation from before delivery was measured).
          </p>
        </MainSection>
      ) : null}

      {nextSteps.length > 0 && (
        <MainSection title="Next steps">
          <ol
            style={{
              listStyle: "decimal",
              margin: 0,
              paddingLeft: 22,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {nextSteps.map((step, i) => (
              <li
                key={i}
                dir="auto"
                style={{ fontSize: 15, lineHeight: 1.65, color: "#000000", overflowWrap: "anywhere" }}
              >
                {step}
              </li>
            ))}
          </ol>
        </MainSection>
      )}
    </div>
  );
}

/** The measured numbers. Nothing here is a score: each row is a plain count or duration. */
function DeliveryNumbers({ summary }: { summary: DeliverySummaryView }) {
  const rows: { label: string; value: React.ReactNode }[] = [
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
        <caption style={{ textAlign: "left", fontSize: 13, color: "#6B7A8D", padding: "0 0 8px", lineHeight: 1.5 }}>
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
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6B7A8D", lineHeight: 1.5 }}>
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

function MainSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: "#000000", margin: "0 0 14px", letterSpacing: "-0.01em" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#6B7A8D",
          margin: "0 0 12px",
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

const visuallyHidden: React.CSSProperties = {
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

const panelStyle: React.CSSProperties = {
  padding: "18px 22px",
  borderRadius: 10,
  background: "#F8F9FB",
  border: "1px solid #E2E6EA",
  fontSize: 15,
  lineHeight: 1.75,
  color: "#000000",
  fontWeight: 400,
  overflowWrap: "anywhere",
};

const plainListStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const cardStyle: React.CSSProperties = {
  padding: "14px 18px",
  borderRadius: 8,
  background: "#FFFFFF",
  border: "1px solid #E2E6EA",
  minWidth: 0,
};

const itemTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#000000",
  marginBottom: 6,
  overflowWrap: "anywhere",
};

const itemTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.65,
  color: "#000000",
  fontWeight: 400,
  overflowWrap: "anywhere",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#6B7A8D",
          margin: "0 0 12px",
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}
