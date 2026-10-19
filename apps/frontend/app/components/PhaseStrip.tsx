"use client";

import React from "react";

/** "deep_dive" -> "Deep dive": underscores become spaces, first letter upper-cased, rest as typed. */
function phaseLabel(name: string): string {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface PhaseStripProps {
  /** The interviewer's phase names, in order. */
  phases: string[];
  /** Current phase name; a name not in `phases` highlights nothing. */
  currentPhase: string;
}

export function PhaseStrip({ phases, currentPhase }: PhaseStripProps) {
  const currentIndex = phases.indexOf(currentPhase);

  return (
    <section
      aria-label="Interview phases"
      className="phase-strip-root"
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        padding: "14px 48px",
        // Interviewers can have many phases: scroll rather than squash when they do not fit.
        overflowX: "auto",
        borderBottom: "1px solid #E2E6EA",
        background: "#FFFFFF",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      <div className="phase-strip-inner" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", minWidth: "max-content" }}>
      {phases.map((name, index) => {
        const isCompleted = index < currentIndex;
        const isActive    = index === currentIndex;
        const isLast      = index === phases.length - 1;

        return (
          <React.Fragment key={`${index}-${name}`}>
            {/* Node + label */}
            <div
              aria-current={isActive ? "step" : undefined}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  backgroundColor: isCompleted || isActive ? "#087E8B" : "#D9D9D9",
                  border: isActive ? "2px solid #087E8B" : "2px solid transparent",
                  boxShadow: isActive ? "0 0 0 3px rgba(68,66,227,0.18)" : "none",
                  transition: "all 0.3s ease",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: isCompleted
                    ? "#087E8B"
                    : isActive
                    ? "#000000"
                    : "#566475",
                  transition: "color 0.3s ease",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-manrope), sans-serif",
                }}
              >
                {phaseLabel(name)}
              </span>
            </div>

            {/* Connector line — skip after last node */}
            {!isLast && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  marginBottom: 18,
                  backgroundColor: isCompleted ? "#087E8B" : "#E2E6EA",
                  transition: "background-color 0.3s ease",
                  minWidth: 32,
                  maxWidth: 140,
                }}
              />
            )}
          </React.Fragment>
        );
      })}
      </div>
    </section>
  );
}
