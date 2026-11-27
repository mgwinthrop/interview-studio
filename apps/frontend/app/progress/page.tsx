"use client";

// Progress (FQ-52): your delivery numbers across sessions, with no scores or targets. Not linked
// until the Dashboard line ships (docs/factory/specs/FQ-52/04-slices.md); cards come later.
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { Shell } from "../interviewers/edit/EditorParts";
import { fetchTrend, MIN_POINTS, type TrendResponse } from "../lib/deliveryTrend";

const LOADING = "Loading your delivery numbers…";
const LOAD_FAILED = "Your delivery numbers could not be loaded.";

const headingStyle: CSSProperties = { fontSize: 22, fontWeight: 800, color: "#000000", margin: "0 0 6px" };
const secondaryStyle: CSSProperties = { fontSize: 14, color: "#566475", lineHeight: 1.6, margin: "0 0 20px" };
const cardStyle: CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E2E6EA",
  borderRadius: 10,
  padding: 18,
  fontSize: 14,
  color: "#566475",
  lineHeight: 1.6,
};
const linkStyle: CSSProperties = { color: "#066C77", textDecoration: "underline" };

type State = { kind: "loading" } | { kind: "failed" } | { kind: "loaded"; trend: TrendResponse };

function sessionsLabel(n: number): string {
  return `${n} ${n === 1 ? "session" : "sessions"}`;
}

export default function ProgressPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchTrend(controller.signal).then((trend) => {
      if (controller.signal.aborted) return;
      setState(trend ? { kind: "loaded", trend } : { kind: "failed" });
    });
    return () => controller.abort();
  }, []);

  return (
    <Shell>
      <h1 style={headingStyle}>Your delivery over time</h1>
      <p style={secondaryStyle}>
        Your pace, pauses, how quickly you start answering and how long your answers run, across your
        sessions with spoken answers.
      </p>
      {state.kind === "loading" && <p style={secondaryStyle}>{LOADING}</p>}
      {state.kind === "failed" && (
        <div role="alert" style={cardStyle}>
          <p style={{ margin: "0 0 8px" }}>{LOAD_FAILED}</p>
          <Link href="/dashboard" style={linkStyle}>
            Back to the Dashboard
          </Link>
        </div>
      )}
      {state.kind === "loaded" && (
        <div data-testid="progress-loaded" style={cardStyle}>
          {state.trend.sessions.length < MIN_POINTS ? (
            <p style={{ margin: 0 }}>
              Not enough yet. Practise with spoken answers at least {MIN_POINTS} times and your delivery
              over time will show here. ({sessionsLabel(state.trend.sessions.length)} so far.)
            </p>
          ) : (
            <p style={{ margin: 0 }}>{sessionsLabel(state.trend.sessions.length)} measured.</p>
          )}
        </div>
      )}
    </Shell>
  );
}
