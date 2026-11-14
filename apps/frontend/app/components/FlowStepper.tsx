"use client";

export type FlowStep = 1 | 2 | 3 | 4;

export const FLOW_STEPS: readonly { n: FlowStep; label: string }[] = [
  { n: 1, label: "Mic check" },
  { n: 2, label: "Choose an interviewer" },
  { n: 3, label: "Live session" },
  { n: 4, label: "Report" },
];

interface FlowStepperProps {
  currentStep: FlowStep;
}

export function FlowStepper({ currentStep }: FlowStepperProps) {
  return (
    <nav
      aria-label="Progress"
      style={{
        background: "#102B33",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        // Wrap so the steps never force sideways scrolling on narrow screens (WCAG 1.4.10 Reflow).
        flexWrap: "wrap",
        alignItems: "center",
        gap: 4,
        padding: "6px 24px",
        minHeight: 44,
        flexShrink: 0,
      }}
    >
      {FLOW_STEPS.map(({ n, label }) => {
        const isActive = n === currentStep;
        return (
          <div
            key={n}
            aria-current={isActive ? "step" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "5px 14px",
              borderRadius: 6,
              background: isActive ? "rgba(255,255,255,0.10)" : "transparent",
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "#FFFFFF" : "#B4C0CB",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-manrope), sans-serif",
            }}
          >
            {n} — {label}
          </div>
        );
      })}
    </nav>
  );
}
