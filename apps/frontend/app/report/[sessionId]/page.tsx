"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { apiUrl } from "../../lib/config";
import { getTopicConfig } from "../../lib/topics";
import { Nav } from "../../components/Nav";
import { FlowStepper } from "../../components/FlowStepper";
import { ReportView } from "../../components/ReportView";
import type { Report } from "../../types";
import type { TopicDisplayConfig } from "../../lib/topics";

type Status = "loading" | "ready" | "abandoned" | "error";

// Inner component — must be inside <Suspense> because it calls useSearchParams()
function ReportPageInner() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const topicConfig: TopicDisplayConfig | undefined = getTopicConfig(
    searchParams.get("topicId") ?? ""
  );

  const [status, setStatus] = useState<Status>("loading");
  const [report, setReport] = useState<Report | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const MAX_POLLS = 15; // 15 × 2s = 30s ceiling before forcing error state

  function clearPoll() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  async function fetchReport() {
    if (!apiUrl) {
      setStatus("error");
      return;
    }

    pollCountRef.current += 1;
    if (pollCountRef.current > MAX_POLLS) {
      setStatus("error");
      clearPoll();
      return;
    }

    let res: Response;
    try {
      res = await fetch(`${apiUrl}/report/${sessionId}`);
    } catch {
      setStatus("error");
      clearPoll();
      return;
    }

    if (res.status === 200) {
      const data = (await res.json()) as Report;
      setReport(data);
      setStatus("ready");
      clearPoll();
    } else if (res.status === 202) {
      // Still generating — keep polling (ceiling enforced above)
    } else if (res.status === 404 || res.status >= 500) {
      // 404 = no report for this session; 5xx = backend couldn't generate report
      // Both mean the session ended without a usable report
      setStatus("abandoned");
      clearPoll();
    } else {
      setStatus("error");
      clearPoll();
    }
  }

  useEffect(() => {
    pollCountRef.current = 0; // reset on sessionId change
    fetchReport(); // immediate first attempt
    intervalRef.current = setInterval(fetchReport, 2000);

    return () => clearPoll(); // critical: stop polling on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Layouts ───────────────────────────────────────────────────────────────

  if (status === "loading") {
    return (
      <Shell>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <p style={{ fontSize: 18, color: "#6B7A8D", margin: 0, fontWeight: 500 }}>
            Generating your report…
          </p>
          <p style={{ fontSize: 14, color: "#6B7A8D", margin: 0, fontWeight: 400 }}>
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
          <p style={{ fontSize: 16, color: "#6B7A8D", margin: 0, textAlign: "center", maxWidth: 400 }}>
            The session was too short to generate a report, or it ended unexpectedly.
          </p>
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
          <p style={{ fontSize: 20, fontWeight: 700, color: "#E9784A", margin: 0 }}>
            Report Not Found
          </p>
          <p style={{ fontSize: 16, color: "#6B7A8D", margin: 0 }}>
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
      <ReportView
        report={report!}
        topicConfig={topicConfig}
        sessionId={sessionId}
        onNewSession={() => router.push("/mic-check")}
      />
    </div>
  );
}

// Page wrapper — Suspense required for useSearchParams() in App Router
export default function ReportPage() {
  return (
    <Suspense fallback={
      <Shell>
        <p style={{ fontSize: 18, color: "#6B7A8D", margin: 0, fontWeight: 500 }}>
          Loading…
        </p>
      </Shell>
    }>
      <ReportPageInner />
    </Suspense>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

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

const backButtonStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "10px 24px",
  borderRadius: 8,
  border: "1px solid #E2E6EA",
  background: "transparent",
  color: "#6B7A8D",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
