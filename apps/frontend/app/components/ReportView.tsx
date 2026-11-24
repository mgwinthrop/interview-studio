"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { apiUrl } from "../lib/config";
import type { ReportView as ReportData } from "../lib/report";
import { EARLIER_INTERVIEW_LABEL } from "../lib/interviewers";
import { fetchTurns, type TranscriptTurn } from "../lib/transcript";
import { ReportV1Body } from "./report/ReportV1Body";
import { ReportV2Body } from "./report/ReportV2Body";
import { TranscriptView } from "./report/TranscriptView";

type Tab = "report" | "transcript";
const TABS: readonly Tab[] = ["report", "transcript"];

interface ReportViewProps {
  report: ReportData;
  /** null for sessions stored before interviewers had names. */
  interviewerName: string | null;
  sessionId: string;
  onNewSession: () => void;
  /** Moves focus to the report heading on mount, e.g. after the report was regenerated. */
  focusHeading?: boolean;
  /**
   * FQ-59: set when shown inside the Dashboard, which already lists the sessions. The
   * "Sessions" sidebar is left out, and a format-1 report's highlights (otherwise only in the
   * sidebar) appear at the end of the report instead.
   */
  embedded?: boolean;
}

export function ReportView({ report, interviewerName, sessionId, onNewSession, focusHeading, embedded = false }: ReportViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>("report");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ report: null, transcript: null });

  // Arrow keys, Home and End move between the tabs (WAI-ARIA tabs pattern, automatic activation).
  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.indexOf(activeTab);
    const next =
      e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length]
      : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length]
      : e.key === "Home" ? TABS[0]
      : e.key === "End" ? TABS[TABS.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  }

  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
  }, [focusHeading]);

  // FQ-50: the conversation for the Transcript tab. Keyed on the session and aborted on change,
  // so the Dashboard never shows the previous session's turns. Null (not loaded, or failed)
  // leaves the tab with the download only.
  const [loaded, setLoaded] = useState<{ sessionId: string; turns: TranscriptTurn[] | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchTurns(sessionId, controller.signal).then((t) => {
      if (!controller.signal.aborted) setLoaded({ sessionId, turns: t });
    });
    return () => controller.abort();
  }, [sessionId]);
  const turns = loaded?.sessionId === sessionId ? loaded.turns : null;

  // FQ-50 S1: "Read answer" opens the Transcript tab on that answer, scrolled to, highlighted
  // and focused. No smooth scroll under reduced motion or the app's own "pause animations".
  // Kept with its session, so switching sessions in the Dashboard never carries a target over.
  // Scroll and focus happen once per request (`seq`): coming back to the tab later keeps the
  // highlight but leaves focus on the tab, as the tabs keyboard pattern expects.
  const [target, setTarget] = useState<{ sessionId: string; answer: number; seq: number } | null>(null);
  const handledSeq = useRef(0);
  const current = target?.sessionId === sessionId ? target : null;
  const targetAnswer = current?.answer ?? null;
  function showAnswer(n: number) {
    setActiveTab("transcript");
    setTarget({ sessionId, answer: n, seq: (target?.seq ?? 0) + 1 });
  }
  useEffect(() => {
    if (activeTab !== "transcript" || !current || current.seq === handledSeq.current || !turns) return;
    const el = document.getElementById(`answer-${current.answer}`);
    if (!el) return;
    handledSeq.current = current.seq;
    const still =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "paused";
    el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
    el.focus({ preventScroll: true });
  }, [activeTab, current, turns]);
  const perTurn = report.format === 2 ? report.delivery?.summary.perTurn : undefined;

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

  // Format-1 highlights ("Identified outcomes"): in the sidebar, or at the end of the report when
  // embedded in the Dashboard, where the sidebar is left out (FQ-59).
  const highlights = report.format === 1 && report.highlights.length > 0 && (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#566475",
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
              color: "#066C77",
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
  );

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
          <p dir="auto" style={{ margin: "3px 0 0", fontSize: 13, color: "#566475", fontWeight: 400, overflowWrap: "anywhere" }}>
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
        {/* Left sidebar (not when embedded in the Dashboard, which lists the sessions itself) */}
        {!embedded && (
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
              color: "#566475",
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
              <span style={{ fontSize: 11, color: "#566475", fontWeight: 400, flexShrink: 0, marginLeft: 8 }}>
                {cardDate}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#566475", marginBottom: 8, fontWeight: 400 }}>
              Report ready
            </div>
            {report.format === 1 && report.strengths.length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  background: "#D8F0EC",
                  color: "#066C77",
                  padding: "2px 8px",
                  borderRadius: 999,
                }}
              >
                {report.strengths.length} area{report.strengths.length !== 1 ? "s" : ""} of depth
              </span>
            )}
          </div>

          {highlights}
        </div>
        )}

        {/* Right panel */}
        <div className="report-content-panel" style={{ flex: 1, padding: "24px 32px", overflowY: "auto" }}>
          {/* Tabs */}
          <div
            role="tablist"
            aria-label="Report sections"
            style={{
              display: "inline-flex",
              background: "#E8EAF0",
              borderRadius: 8,
              padding: 4,
              marginBottom: 28,
            }}
          >
            {TABS.map((tab) => (
              <button
                key={tab}
                ref={(el) => {
                  tabRefs.current[tab] = el;
                }}
                role="tab"
                id={`report-tab-${tab}`}
                aria-selected={activeTab === tab}
                aria-controls="report-tabpanel"
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab)}
                onKeyDown={onTabKeyDown}
                style={{
                  padding: "7px 18px",
                  borderRadius: 6,
                  border: "none",
                  background: activeTab === tab ? "#102B33" : "transparent",
                  color: activeTab === tab ? "#FFFFFF" : "#566475",
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

          <div role="tabpanel" id="report-tabpanel" aria-labelledby={`report-tab-${activeTab}`} tabIndex={0}>
            {/* ── Report tab ── */}
            {activeTab === "report" && report.format === 2 && <ReportV2Body report={report} turns={turns} onShowAnswer={showAnswer} />}
            {activeTab === "report" && report.format === 1 && <ReportV1Body report={report} />}
            {activeTab === "report" && embedded && highlights}

            {/* ── Transcript tab ── */}
            {activeTab === "transcript" && (
              <div style={{ maxWidth: 680 }}>
                {turns && turns.length > 0 && <TranscriptView turns={turns} perTurn={perTurn} target={targetAnswer} />}
                <p style={{ fontSize: 15, color: "#566475", fontWeight: 400, margin: "0 0 20px" }}>
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
                  <p style={{ fontSize: 14, color: "#B03E14", margin: 0 }}>
                    Transcript download unavailable — API URL not configured.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
