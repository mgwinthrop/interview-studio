"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../components/Nav";
import { ReportView } from "../components/ReportView";
import { apiUrl } from "../lib/config";
import { EARLIER_INTERVIEW_LABEL } from "../lib/interviewers";
import type { Report } from "../types";

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
      stroke="#6B7A8D"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
    </svg>
  );
}

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
        color: "#6B7A8D",
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
  const [report, setReport] = useState<Report | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState(false);
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
    if (!selectedId) return;
    setReport(null);
    setReportError(false);
    setLoadingReport(true);
    fetch(`${apiUrl}/api/session/${selectedId}/report`)
      .then((r) => {
        if (r.status === 202 || r.status === 404) return null;
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then((data: Report | null) => setReport(data))
      .catch(() => setReportError(true))
      .finally(() => setLoadingReport(false));
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
      <div
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
            color: "#6B7A8D",
            fontWeight: 400,
          }}
        >
          Completed assessment sessions
        </p>
      </div>

      {/* Body: empty state or two-column layout */}
      {isEmptyDashboard ? (
        <div
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
                color: "#6B7A8D",
                fontWeight: 400,
                marginBottom: 20,
              }}
            >
              Complete an assessment to see your report here.
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
              Start assessment →
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
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
                  color: "#6B7A8D",
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
                  <div
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    onMouseEnter={() => setHoveredId(s.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
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
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#000000",
                        marginBottom: 3,
                      }}
                    >
                      {s.interviewerName ?? EARLIER_INTERVIEW_LABEL}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: "#6B7A8D",
                        marginBottom: s.hasReport ? 6 : 0,
                      }}
                    >
                      {date}
                      {durationMin !== null ? ` · ${durationMin}m` : ""}
                      {` · ${s.turnCount} turns`}
                    </div>
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
                  </div>
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
              <CenteredMessage>Could not load report.</CenteredMessage>
            ) : !selectedId ? (
              <CenteredMessage>
                Select a session to view its report
              </CenteredMessage>
            ) : report ? (
              <ReportView
                report={report}
                interviewerName={selectedInterviewerName}
                sessionId={selectedId}
                onNewSession={() => router.push("/")}
              />
            ) : (
              <CenteredMessage>No report available for this session.</CenteredMessage>
            )}
          </div>
        </div>
      )}

      {/* Footer stats bar */}
      <div
        style={{
          padding: "12px 20px",
          background: "#FFFFFF",
          borderTop: "0.5px solid #E2E6EA",
          fontSize: 13,
          fontWeight: 500,
          color: "#6B7A8D",
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
      </div>
    </div>
  );
}
