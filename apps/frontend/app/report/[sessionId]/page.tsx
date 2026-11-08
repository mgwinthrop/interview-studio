"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiUrl } from "../../lib/config";
import { Nav } from "../../components/Nav";
import { FlowStepper } from "../../components/FlowStepper";
import { ReportView } from "../../components/ReportView";
import {
  parseReport,
  parseReportFailure,
  regenerateReport,
  type ReportView as ReportData,
} from "../../lib/report";

type Status = "loading" | "ready" | "abandoned" | "failed" | "unreadable" | "error";

// Inner component, rendered inside <Suspense> by the page wrapper.
function ReportPageInner() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const [status, setStatus] = useState<Status>("loading");
  const [report, setReport] = useState<ReportData | null>(null);
  // From a failed report's 500 body: whether the server can write the report again.
  const [canRegenerate, setCanRegenerate] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  // True once a regenerated report replaces the failed state, so focus moves to its heading.
  const [regenerated, setRegenerated] = useState(false);
  const regenerateButtonRef = useRef<HTMLButtonElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  // Set on the first terminal result so overlapping in-flight polls change nothing after it.
  const stoppedRef = useRef(false);
  // 60 × 2s = 120s ceiling: the server's end-of-session deadline is 90s (it includes
  // finishing the in-flight turn), plus margin. Only 202 "generating" keeps polling.
  const MAX_POLLS = 60;

  function clearPoll() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function stop(next: Status) {
    stoppedRef.current = true;
    clearPoll();
    setStatus(next);
  }

  async function fetchReport() {
    if (stoppedRef.current) return;
    if (!apiUrl) {
      stop("error");
      return;
    }

    pollCountRef.current += 1;
    if (pollCountRef.current > MAX_POLLS) {
      stop("error");
      return;
    }

    let res: Response;
    try {
      res = await fetch(`${apiUrl}/report/${encodeURIComponent(sessionId)}`);
    } catch {
      if (!stoppedRef.current) stop("error");
      return;
    }
    if (stoppedRef.current) return;

    if (res.status === 200) {
      stoppedRef.current = true;
      clearPoll();
      const parsed = parseReport(await readJson(res));
      if (parsed) {
        setReport(parsed);
        setStatus("ready");
      } else {
        setStatus("error");
      }
    } else if (res.status === 202) {
      // Still generating — keep polling (ceiling enforced above)
    } else if (res.status === 404) {
      // No report for this session. Terminal: stop polling at once.
      stop("abandoned");
    } else if (res.status >= 500) {
      // Failed, abandoned or unreadable (no usable report). Terminal: stop polling at once,
      // before reading the body, so overlapping polls change nothing after it.
      stoppedRef.current = true;
      clearPoll();
      const failure = parseReportFailure(await readJson(res));
      if (failure.kind === "failed") {
        setCanRegenerate(failure.canRegenerate);
        setStatus("failed");
      } else if (failure.kind === "unreadable") {
        setStatus("unreadable");
      } else {
        setStatus("abandoned");
      }
    } else {
      stop("error");
    }
  }

  useEffect(() => {
    pollCountRef.current = 0; // reset on sessionId change
    stoppedRef.current = false;
    fetchReport(); // immediate first attempt
    intervalRef.current = setInterval(fetchReport, 2000);

    return () => clearPoll(); // critical: stop polling on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // After a failed regenerate the button is enabled again; put focus back on it so keyboard
  // and screen-reader users stay where they were (the alert announces the message).
  useEffect(() => {
    if (!regenerating && regenerateError) regenerateButtonRef.current?.focus();
  }, [regenerating, regenerateError]);

  async function handleRegenerate() {
    if (regenerating) return;
    setRegenerating(true);
    setRegenerateError(null);
    const outcome = await regenerateReport(sessionId);
    if (outcome.ok) {
      setReport(outcome.report);
      setRegenerated(true);
      setStatus("ready");
    } else {
      setRegenerateError(outcome.message);
    }
    setRegenerating(false);
  }

  // ── Layouts ───────────────────────────────────────────────────────────────

  if (status === "loading") {
    return (
      <Shell>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <p style={{ fontSize: 18, color: "#566475", margin: 0, fontWeight: 500 }}>
            Generating your report…
          </p>
          <p style={{ fontSize: 14, color: "#566475", margin: 0, fontWeight: 400 }}>
            This usually takes a few seconds.
          </p>
        </div>
      </Shell>
    );
  }

  if (status === "abandoned") {
    return (
      <Shell>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <p style={{ fontSize: 20, fontWeight: 700, color: "#E8BB61", margin: 0 }}>
            Session Ended Without a Report
          </p>
          <p style={{ fontSize: 16, color: "#566475", margin: 0, textAlign: "center", maxWidth: 400 }}>
            The session was too short to generate a report, or it ended unexpectedly.
          </p>
          <button onClick={() => router.push("/")} style={backButtonStyle}>
            Back to Home
          </button>
        </div>
      </Shell>
    );
  }

  if (status === "failed") {
    return (
      <Shell>
        <div style={centeredColumnStyle}>
          <h1 style={messageHeadingStyle}>We couldn&apos;t write the reflection for this conversation.</h1>
          {canRegenerate && (
            <>
              <p style={messageTextStyle}>
                Your conversation was saved. Generating the report again can take up to a minute and a half.
              </p>
              <button
                ref={regenerateButtonRef}
                type="button"
                onClick={handleRegenerate}
                disabled={regenerating}
                aria-busy={regenerating ? "true" : undefined}
                style={{
                  marginTop: 8,
                  padding: "10px 24px",
                  borderRadius: 8,
                  border: "none",
                  background: regenerating ? "#4F8F96" : "#087E8B",
                  color: "#FFFFFF",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: regenerating ? "default" : "pointer",
                  fontFamily: "var(--font-manrope), sans-serif",
                }}
              >
                {regenerating ? "Generating…" : "Try generating it again"}
              </button>
              {regenerateError && (
                <p role="alert" style={{ ...messageTextStyle, fontSize: 14, color: "#B3261E" }}>
                  {regenerateError}
                </p>
              )}
            </>
          )}
          <button onClick={() => router.push("/")} style={backButtonStyle}>
            Back to Home
          </button>
        </div>
      </Shell>
    );
  }

  if (status === "unreadable") {
    return (
      <Shell>
        <div style={centeredColumnStyle}>
          <h1 style={messageHeadingStyle}>This report could not be read.</h1>
          <button onClick={() => router.push("/")} style={backButtonStyle}>
            Back to Home
          </button>
        </div>
      </Shell>
    );
  }

  if (status === "error") {
    return (
      <Shell>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <p style={{ fontSize: 20, fontWeight: 700, color: "#B03E14", margin: 0 }}>
            Report Not Found
          </p>
          <p style={{ fontSize: 16, color: "#566475", margin: 0 }}>
            Could not retrieve the session report.
          </p>
          <button onClick={() => router.push("/")} style={backButtonStyle}>
            Back to Home
          </button>
        </div>
      </Shell>
    );
  }

  // status === "ready"
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F4F5F1",
        color: "#000000",
        fontFamily: "var(--font-manrope), sans-serif",
      }}
    >
      <Nav />
      <FlowStepper currentStep={4} />
      <main id="main-content" tabIndex={-1}>
        <ReportView
          report={report!}
          interviewerName={report!.interviewerName}
          sessionId={sessionId}
          onNewSession={() => router.push("/mic-check")}
          focusHeading={regenerated}
        />
      </main>
    </div>
  );
}

// Page wrapper — keeps the Suspense boundary and loading fallback
export default function ReportPage() {
  return (
    <Suspense fallback={
      <Shell>
        <p style={{ fontSize: 18, color: "#566475", margin: 0, fontWeight: 500 }}>
          Loading…
        </p>
      </Shell>
    }>
      <ReportPageInner />
    </Suspense>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

/** The response body as JSON, or null when it is not JSON. Never throws. */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: "#F4F5F1",
        color: "#000000",
        fontFamily: "var(--font-manrope), sans-serif",
      }}
    >
      <Nav />
      <FlowStepper currentStep={4} />
      {/* Centering wrapper — takes remaining height after nav + stepper */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const centeredColumnStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 16,
  padding: "24px 16px",
  maxWidth: 480,
};

const messageHeadingStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: "#000000",
  margin: 0,
  textAlign: "center",
  lineHeight: 1.35,
};

const messageTextStyle: React.CSSProperties = {
  fontSize: 16,
  color: "#566475",
  margin: 0,
  textAlign: "center",
  lineHeight: 1.5,
};

const backButtonStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "10px 24px",
  borderRadius: 8,
  border: "1px solid #E2E6EA",
  background: "transparent",
  color: "#566475",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
