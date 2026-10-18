"use client";

import { useState } from "react";
import { apiUrl } from "../lib/config";
import type { Report } from "../types";
import type { TopicDisplayConfig } from "../lib/topics";

interface ReportViewProps {
  report: Report;
  topicConfig?: TopicDisplayConfig;
  sessionId: string;
  onNewSession: () => void;
}

export function ReportView({ report, topicConfig, sessionId, onNewSession }: ReportViewProps) {
  const [activeTab, setActiveTab] = useState<"report" | "transcript">("report");

  const generatedDate = new Date(report.generatedAt);
  const headerDate = generatedDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const cardDate = generatedDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const topicShort =
    topicConfig?.interviewerTitle?.replace(" Interviewer", "") ?? "Interview";

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
            style={{
              fontSize: 20,
              fontWeight: 800,
              margin: 0,
              color: "#000000",
              letterSpacing: "-0.01em",
            }}
          >
            Assessment report
          </h1>
          <p style={{ margin: "3px 0 0", fontSize: 13, color: "#6B7A8D", fontWeight: 400 }}>
            {topicShort} — {headerDate}
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
              <span style={{ fontSize: 13, fontWeight: 700, color: "#087E8B" }}>
                {topicShort}
              </span>
              <span style={{ fontSize: 11, color: "#6B7A8D", fontWeight: 400, flexShrink: 0, marginLeft: 8 }}>
                {cardDate}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#6B7A8D", marginBottom: 8, fontWeight: 400 }}>
              Report ready
            </div>
            {report.strengths.length > 0 && (
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
          {report.highlights.length > 0 && (
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
                {tab === "report" ? "Assessment report" : "Transcript"}
              </button>
            ))}
          </div>

          {/* ── Assessment report tab ── */}
          {activeTab === "report" && (
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

              <Section title="Overall Assessment">
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

              {report.strengths.length > 0 && (
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
          )}

          {/* ── Transcript tab ── */}
          {activeTab === "transcript" && (
            <div style={{ maxWidth: 680 }}>
              <p style={{ fontSize: 15, color: "#6B7A8D", fontWeight: 400, margin: "0 0 20px" }}>
                Download the full session transcript as a text file.
              </p>
              {apiUrl ? (
                <a
                  href={`${apiUrl}/api/session/${sessionId}/transcript`}
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
