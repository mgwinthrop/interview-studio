"use client";

import React from "react";
import type { Phase } from "../types";

const PHASES: { id: Phase; label: string }[] = [
  { id: "intro",      label: "Intro" },
  { id: "share_work", label: "Share work" },
  { id: "deep_dive",  label: "Deep dive" },
  { id: "wrap_up",    label: "Wrap up" },
];

interface PhaseStripProps {
  currentPhase: Phase;
}

export function PhaseStrip({ currentPhase }: PhaseStripProps) {
  const currentIndex = PHASES.findIndex((p) => p.id === currentPhase);

  return (
    <div
      className="phase-strip-root"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        padding: "14px 48px",
        borderBottom: "1px solid #E2E6EA",
        background: "#FFFFFF",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      <div className="phase-strip-inner" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
      {PHASES.map((phase, index) => {
        const isCompleted = index < currentIndex;
        const isActive    = index === currentIndex;
        const isLast      = index === PHASES.length - 1;

        return (
          <React.Fragment key={phase.id}>
            {/* Node + label */}
            <div
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
                    : "#9BA5B4",
                  transition: "color 0.3s ease",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-manrope), sans-serif",
                }}
              >
                {phase.label}
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
    </div>
  );
}
