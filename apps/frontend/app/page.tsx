"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Nav } from "./components/Nav";
import { FlowStepper } from "./components/FlowStepper";
import { fetchInterviewers, type InterviewerSummary } from "./lib/interviewers";

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; interviewers: InterviewerSummary[] };

export default function HomePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Guard: redirect to mic-check if user hasn't come through it
  useEffect(() => {
    if (sessionStorage.getItem("mic_gesture_granted")) {
      setReady(true);
    } else {
      router.replace("/mic-check");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the interviewers once the page is shown, and again on Retry.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setList({ status: "loading" });
    fetchInterviewers()
      .then((interviewers) => {
        if (!cancelled) setList({ status: "ready", interviewers });
      })
      .catch(() => {
        if (!cancelled) setList({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [ready, loadAttempt]);

  function handleSelect(interviewerId: string) {
    router.push(`/session?interviewerId=${encodeURIComponent(interviewerId)}`);
  }

  if (!ready) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F4F5F1",
        fontFamily: "var(--font-manrope), sans-serif",
      }}
    >
      <Nav />
      <FlowStepper currentStep={2} />

      <main>
      {/* Hero */}
      <div
        className="hero-section"
        style={{
          background: "#102B33",
          padding: "64px 32px 80px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#D8F0EC",
            marginBottom: 16,
          }}
        >
          Find your voice
        </div>
        <h1
          style={{
            fontSize: 40,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            margin: "0 0 16px",
            color: "#FFFFFF",
          }}
        >
          Interview Studio
        </h1>
        <p
          style={{
            fontSize: 18,
            color: "#DCE8EA",
            maxWidth: 480,
            lineHeight: 1.6,
            margin: "0 auto",
            fontWeight: 400,
          }}
        >
          Explore what you want to say through conversation and helpful feedback.
          Choose one of the available interviewers to begin.
        </p>

        {/* Phase flow strip — the preset interviewers' phases; custom ones can differ */}
        <div className="phase-flow-strip" style={{ marginTop: 40 }}>
          <p
            style={{
              fontSize: 13,
              color: "#93C9C4",
              margin: "0 0 16px",
              fontWeight: 500,
            }}
          >
            A typical conversation
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {(["Intro", "Share", "Deep dive", "Wrap up"] as const).map((label, i, arr) => (
              <div key={label} style={{ display: "flex", alignItems: "center" }}>
                {/* Numbered circle */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "#087E8B",
                      color: "#FFFFFF",
                      fontSize: 13,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {i + 1}
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "#D8F0EC",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </span>
                </div>
                {/* Connector line — not after last step */}
                {i < arr.length - 1 && (
                  <div
                    style={{
                      width: 60,
                      height: 2,
                      background: "#D9D9D9",
                      opacity: 0.4,
                      marginBottom: 20, // aligns with circle centre, offset for label
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Persona cards */}
      <div
        className="persona-grid"
        style={{
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: 1080,
          width: "100%",
          margin: "0 auto",
          padding: "48px 32px",
        }}
      >
        {list.status === "loading" && (
          <p role="status" style={listMessageStyle}>
            Loading interviewers…
          </p>
        )}
        {list.status === "error" && (
          <div role="alert" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <p style={listMessageStyle}>Could not load the interviewers.</p>
            <button
              onClick={() => setLoadAttempt((n) => n + 1)}
              style={{
                padding: "12px 28px",
                borderRadius: 8,
                background: "#087E8B",
                color: "#FFFFFF",
                fontSize: 15,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                letterSpacing: "0.02em",
              }}
            >
              Retry
            </button>
          </div>
        )}
        {list.status === "ready" && list.interviewers.length === 0 && (
          <p style={listMessageStyle}>No interviewers are available yet.</p>
        )}
        {list.status === "ready" &&
          list.interviewers.map((interviewer) => (
            <PersonaCard
              key={interviewer.id}
              interviewer={interviewer}
              onSelect={() => handleSelect(interviewer.id)}
              editHref={
                interviewer.source === "custom"
                  ? `/interviewers/edit?id=${encodeURIComponent(interviewer.id)}`
                  : undefined
              }
            />
          ))}
        {list.status === "ready" && (
          <div
            style={{
              flex: "1 1 300px",
              maxWidth: 340,
              background: "#FFFFFF",
              border: "1px dashed #087E8B",
              borderRadius: 14,
              padding: "32px 28px 28px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#000000", margin: 0, lineHeight: 1.3 }}>
              Make your own interviewer
            </h2>
            <p style={{ fontSize: 16, color: "#4B5563", lineHeight: 1.65, margin: 0, flex: 1 }}>
              Describe what you want, talk it through, or fill in a form. You review the draft before it is saved.
            </p>
            <Link
              href="/interviewers"
              style={{
                padding: "12px 0",
                borderRadius: 8,
                border: "1px solid #087E8B",
                color: "#066C77",
                fontSize: 15,
                fontWeight: 600,
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              Make your own interviewer
            </Link>
          </div>
        )}
      </div>
      </main>
    </div>
  );
}

const listMessageStyle: React.CSSProperties = {
  fontSize: 16,
  color: "#4B5563",
  lineHeight: 1.65,
  margin: 0,
  textAlign: "center",
};

interface PersonaCardProps {
  interviewer: Pick<InterviewerSummary, "name" | "purpose">;
  onSelect: () => void;
  /** Set for custom interviewers: where to edit them. */
  editHref?: string;
}

function PersonaCard({ interviewer, onSelect, editHref }: PersonaCardProps) {
  return (
    <div
      style={{
        flex: "1 1 300px",
        maxWidth: 340,
        background: "#FFFFFF",
        border: "1px solid #E2E6EA",
        borderRadius: 14,
        padding: "32px 28px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        transition: "border-color 0.2s, box-shadow 0.2s",
        cursor: "default",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "#087E8B";
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          "0 0 0 4px rgba(68,66,227,0.08)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "#E2E6EA";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
      }}
    >
      {/* Icon block */}
      <div
        style={{
          width: 40,
          height: 40,
          background: "#D8F0EC",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Decorative mic icon — labelled by card button text */}
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#087E8B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="1" width="6" height="10" rx="3" />
          <path d="M3 10a7 7 0 0 0 14 0" />
          <line x1="10" y1="17" x2="10" y2="19" />
          <line x1="7" y1="19" x2="13" y2="19" />
        </svg>
      </div>

      {/* Title */}
      <h2
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: "#000000",
          margin: 0,
          lineHeight: 1.3,
          letterSpacing: "-0.01em",
          overflowWrap: "anywhere",
        }}
        dir="auto"
      >
        {interviewer.name}
      </h2>

      {/* Purpose */}
      <p
        style={{
          fontSize: 16,
          color: "#4B5563",
          lineHeight: 1.65,
          margin: 0,
          flex: 1,
          fontWeight: 400,
        }}
      >
        {interviewer.purpose}
      </p>

      {/* CTA */}
      <button
        onClick={onSelect}
        style={{
          marginTop: 8,
          padding: "12px 0",
          borderRadius: 8,
          background: "#087E8B",
          color: "#FFFFFF",
          fontSize: 15,
          fontWeight: 600,
          border: "none",
          cursor: "pointer",
          letterSpacing: "0.02em",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background = "#06616B")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background = "#087E8B")
        }
      >
        Start conversation →
      </button>
      {editHref && (
        <Link
          href={editHref}
          aria-label={`Edit ${interviewer.name}`}
          style={{ fontSize: 13, fontWeight: 600, color: "#087E8B", textAlign: "center" }}
        >
          Edit
        </Link>
      )}
    </div>
  );
}
