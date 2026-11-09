"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Nav } from "../components/Nav";
import { UsageLine } from "../components/UsageLine";
import { ReportView } from "../components/ReportView";
import { apiUrl } from "../lib/config";
import { EARLIER_INTERVIEW_LABEL } from "../lib/interviewers";
import { parseReport, parseReportFailure, type ReportView as ReportData } from "../lib/report";

// One row of GET /api/sessions.
interface SessionListItem {
  id: string;
  interviewerId: string;
  /** null for sessions stored before interviewers had names. */
  interviewerName: string | null;
  startedAt: string;
  endedAt?: string;
  turnCount: number;
  hasReport: boolean;
}

function ClipboardIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#566475"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
    </svg>
  );
}

const REPORT_LOAD_FAILED = "Could not load report.";
const REPORT_UNREADABLE = "This report could not be read.";

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        fontWeight: 500,
        color: "#566475",
      }}
    >
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  // A plain message when the selected session's report could not be shown; null otherwise.
  const [reportError, setReportError] = useState<string | null>(null);
  // The selected session's report failed and the server can write it again (on its report page).
  const [canRegenerateSelected, setCanRegenerateSelected] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Fetch session list once on mount
  useEffect(() => {
    fetch(`${apiUrl}/api/sessions`)
      .then((r) => r.json())
      .then((data: { sessions: SessionListItem[] }) => {
        setSessions(data.sessions);
        if (data.sessions.length > 0) {
          setSelectedId(data.sessions[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
  }, []);

  // Fetch report whenever selected session changes
  useEffect(() => {
    if (!selectedId) {
      // An earlier fetch may have been cancelled mid-flight (e.g. by a delete).
      setLoadingReport(false);
      return;
    }
    // A later selection supersedes this one; its late answer must not overwrite the view.
    let cancelled = false;
    setReport(null);
    setReportError(null);
    setCanRegenerateSelected(false);
    setLoadingReport(true);
    (async () => {
      let message: string | null = null;
      let parsed: ReportData | null = null;
      let canRegenerate = false;
      try {
        const r = await fetch(`${apiUrl}/api/session/${encodeURIComponent(selectedId)}/report`);
        if (r.status === 200) {
          parsed = parseReport(await r.json().catch(() => null));
          if (!parsed) message = REPORT_UNREADABLE;
        } else if (r.status >= 500) {
          const failure = parseReportFailure(await r.json().catch(() => null));
          if (failure.kind === "failed") {
            message = "We couldn't write the reflection for this conversation.";
            canRegenerate = failure.canRegenerate;
          } else {
            message = failure.kind === "unreadable" ? REPORT_UNREADABLE : REPORT_LOAD_FAILED;
          }
        } else if (r.status !== 202 && r.status !== 404) {
          message = REPORT_LOAD_FAILED;
        }
      } catch {
        message = REPORT_LOAD_FAILED;
      }
      if (cancelled) return;
      setReport(parsed);
      setReportError(message);
      setCanRegenerateSelected(canRegenerate);
      setLoadingReport(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // A different selection clears any earlier delete error
  useEffect(() => {
    setDeleteError(null);
  }, [selectedId]);

  async function handleDelete() {
    if (!selectedId || deleting) return;
    const id = selectedId;
    if (
      !window.confirm(
        "Delete this session? Its transcript and report will be permanently removed."
      )
    ) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const r = await fetch(`${apiUrl}/api/session/${id}`, { method: "DELETE" });
      if (r.status === 409) {
        setDeleteError("This session is still active and cannot be deleted.");
        return;
      }
      if (!r.ok && r.status !== 404) throw new Error("delete failed");
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setSelectedId(null);
      setReport(null);
    } catch {
      setDeleteError("Could not delete session.");
    } finally {
      setDeleting(false);
    }
  }

  // Footer stats
  const personasUsed = new Set(sessions.map((s) => s.interviewerId)).size;
  const completedWithEnd = sessions.filter((s) => s.endedAt);
  const avgMinutes =
    completedWithEnd.length > 0
      ? Math.round(
          completedWithEnd.reduce((sum, s) => {
            const ms =
              new Date(s.endedAt!).getTime() -
              new Date(s.startedAt).getTime();
            return sum + ms / 60000;
          }, 0) / completedWithEnd.length
        )
      : null;

  const selectedSession = sessions.find((s) => s.id === selectedId);
  const selectedInterviewerName = selectedSession?.interviewerName ?? null;

  const isEmptyDashboard = !loadingSessions && sessions.length === 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        fontFamily: "var(--font-manrope), sans-serif",
        background: "#F4F5F1",
      }}
    >
      <Nav />

      {/* Page header */}
      <header
        style={{
          padding: "18px 28px 14px",
          background: "#FFFFFF",
          borderBottom: "1px solid #E2E6EA",
          flexShrink: 0,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 800,
            color: "#000000",
            letterSpacing: "-0.02em",
          }}
        >
          Dashboard
        </h1>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 13,
            color: "#566475",
            fontWeight: 400,
          }}
        >
          Completed conversations and their reports
        </p>
        <UsageLine />
      </header>

      {/* Body: empty state or two-column layout */}
      {isEmptyDashboard ? (
        <main
          id="main-content"
          tabIndex={-1}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <ClipboardIcon />
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#000000",
                marginBottom: 6,
              }}
            >
              No completed sessions yet
            </div>
            <div
              style={{
                fontSize: 14,
                color: "#566475",
                fontWeight: 400,
                marginBottom: 20,
              }}
            >
              Finish a conversation to see its report here.
            </div>
            <button
              onClick={() => router.push("/")}
              style={{
                padding: "10px 22px",
                borderRadius: 8,
                background: "#087E8B",
                color: "#FFFFFF",
                fontSize: 14,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-manrope), sans-serif",
              }}
            >
              Start a conversation →
            </button>
          </div>
        </main>
      ) : (
        <main id="main-content" tabIndex={-1} style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Left: session list (260px fixed) */}
          <div
            style={{
              width: 260,
              flexShrink: 0,
              borderRight: "1px solid #E2E6EA",
              overflowY: "auto",
              background: "#FFFFFF",
              padding: "8px",
            }}
          >
            {loadingSessions ? (
              <div
                style={{
                  padding: "24px 8px",
                  fontSize: 13,
                  color: "#566475",
                }}
              >
                Loading…
              </div>
            ) : (
              sessions.map((s) => {
                const isSelected = s.id === selectedId;
                const isHovered = hoveredId === s.id && !isSelected;
                const date = new Date(s.startedAt).toLocaleDateString(
                  "en-US",
                  { month: "short", day: "numeric", year: "numeric" }
                );
                const durationMs = s.endedAt
                  ? new Date(s.endedAt).getTime() -
                    new Date(s.startedAt).getTime()
                  : null;
                const durationMin =
                  durationMs !== null
                    ? Math.round(durationMs / 60000)
                    : null;

                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    onMouseEnter={() => setHoveredId(s.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    aria-current={isSelected ? "true" : undefined}
                    style={{
                      display: "block",
                      width: "100%",
                      boxSizing: "border-box",
                      border: "none",
                      textAlign: "left",
                      font: "inherit",
                      padding: "12px 16px",
                      borderBottom: isSelected
                        ? "none"
                        : "0.5px solid #E2E6EA",
                      borderRadius: isSelected ? 8 : 0,
                      background: isSelected
                        ? "#D8F0EC"
                        : isHovered
                        ? "#F4F5F1"
                        : "transparent",
                      cursor: "pointer",
                      transition: "background 0.1s",
                    }}
                  >
                    <span
                      dir="auto"
                      style={{
                        display: "block",
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#000000",
                        marginBottom: 3,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {s.interviewerName ?? EARLIER_INTERVIEW_LABEL}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12,
                        fontWeight: 500,
                        color: "#566475",
                        marginBottom: s.hasReport ? 6 : 0,
                      }}
                    >
                      {date}
                      {durationMin !== null ? ` · ${durationMin}m` : ""}
                      {` · ${s.turnCount} turns`}
                    </span>
                    {s.hasReport && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          background: "#D8F0EC",
                          color: "#06616B",
                          border: "0.5px solid #087E8B",
                          borderRadius: 4,
                          padding: "2px 8px",
                          display: "inline-block",
                        }}
                      >
                        Report ready
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Right: report panel */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {selectedId && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 24px 0",
                }}
              >
                {deleteError && (
                  <span role="alert" style={{ fontSize: 13, color: "#B3261E" }}>
                    {deleteError}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    background: "#FFFFFF",
                    color: "#B3261E",
                    fontSize: 13,
                    fontWeight: 600,
                    border: "1px solid #B3261E",
                    cursor: deleting ? "default" : "pointer",
                    fontFamily: "var(--font-manrope), sans-serif",
                  }}
                >
                  {deleting ? "Deleting…" : "Delete session"}
                </button>
              </div>
            )}
            {loadingReport ? (
              <CenteredMessage>Loading report…</CenteredMessage>
            ) : reportError ? (
              <CenteredMessage>
                <div style={{ textAlign: "center", padding: "0 16px" }}>
                  <p style={{ margin: 0 }}>{reportError}</p>
                  {canRegenerateSelected && selectedId && (
                    <Link
                      href={`/report/${encodeURIComponent(selectedId)}`}
                      style={{ display: "inline-block", marginTop: 10, color: "#087E8B", fontWeight: 600 }}
                    >
                      Open the report page to try again
                    </Link>
                  )}
                </div>
              </CenteredMessage>
            ) : !selectedId ? (
              <CenteredMessage>
                Select a session to view its report
              </CenteredMessage>
            ) : report ? (
              <ReportView
                report={report}
                interviewerName={selectedInterviewerName ?? report.interviewerName}
                sessionId={selectedId}
                onNewSession={() => router.push("/")}
              />
            ) : (
              <CenteredMessage>No report available for this session.</CenteredMessage>
            )}
          </div>
        </main>
      )}

      {/* Footer stats bar */}
      <footer
        style={{
          padding: "12px 20px",
          background: "#FFFFFF",
          borderTop: "0.5px solid #E2E6EA",
          fontSize: 13,
          fontWeight: 500,
          color: "#566475",
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <span>
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </span>
        <span>·</span>
        <span>
          {personasUsed} persona{personasUsed !== 1 ? "s" : ""} used
        </span>
        {avgMinutes !== null && (
          <>
            <span>·</span>
            <span>avg {avgMinutes}m</span>
          </>
        )}
      </footer>
    </div>
  );
}
