// Button styles shared by the interviewer pages and the session overlays.
import type { CSSProperties } from "react";

export const primaryButtonStyle: CSSProperties = {
  padding: "12px 24px",
  borderRadius: 8,
  border: "none",
  background: "#087E8B",
  color: "#FFFFFF",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "var(--font-manrope), sans-serif",
  letterSpacing: "0.01em",
  textDecoration: "none",
};

export const secondaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  background: "#FFFFFF",
  color: "#087E8B",
  border: "1px solid #087E8B",
};
