"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "./components/Nav";
import { FlowStepper } from "./components/FlowStepper";
import { TOPICS } from "./lib/topics";

export default function HomePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  // Guard: redirect to mic-check if user hasn't come through it
  useEffect(() => {
    if (sessionStorage.getItem("mic_gesture_granted")) {
      setReady(true);
    } else {
      router.replace("/mic-check");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelect(topicId: string) {
    router.push(`/session?topicId=${topicId}`);
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
          Michael Gray / Experiments in AI
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
          MG Interview Studio
        </h1>
        <p
          style={{
            fontSize: 18,
            color: "#6B7A8D",
            maxWidth: 480,
            lineHeight: 1.6,
            margin: "0 auto",
            fontWeight: 400,
          }}
        >
          Choose your interview focus to begin. Each session is voice-first and takes
          8–12 minutes.
        </p>

        {/* Phase flow strip */}
        <div
          className="phase-flow-strip"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 40,
          }}
        >
          {(["Intro", "Share work", "Deep dive", "Wrap up"] as const).map((label, i, arr) => (
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
        {TOPICS.map((topic) => (
          <PersonaCard
            key={topic.id}
            topic={topic}
            onSelect={() => handleSelect(topic.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface PersonaCardProps {
  topic: { id: string; interviewerTitle: string; sessionGoal: string };
  onSelect: () => void;
}

function PersonaCard({ topic, onSelect }: PersonaCardProps) {
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
        }}
      >
        {topic.interviewerTitle}
      </h2>

      {/* Session goal */}
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
        {topic.sessionGoal}
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
        Start assessment →
      </button>
    </div>
  );
}
