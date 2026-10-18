"use client";

export type FlowStep = 1 | 2 | 3 | 4;

const STEPS: { n: FlowStep; label: string }[] = [
  { n: 1, label: "Mic check" },
  { n: 2, label: "Persona selection" },
  { n: 3, label: "Live session" },
  { n: 4, label: "Report" },
];

interface FlowStepperProps {
  currentStep: FlowStep;
}

export function FlowStepper({ currentStep }: FlowStepperProps) {
  return (
    <div
      style={{
        background: "#102B33",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 24px",
        height: 44,
        flexShrink: 0,
      }}
    >
      {STEPS.map(({ n, label }) => {
        const isActive = n === currentStep;
        return (
          <div
            key={n}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "5px 14px",
              borderRadius: 6,
              background: isActive ? "rgba(255,255,255,0.10)" : "transparent",
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "#FFFFFF" : "#4A5568",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-manrope), sans-serif",
            }}
          >
            {n} — {label}
          </div>
        );
      })}
    </div>
  );
}
