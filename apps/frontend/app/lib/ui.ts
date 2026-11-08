// Button styles shared by the interviewer pages and the session overlays.
import type { CSSProperties } from "react";

// Border for text fields and selects. 3.4:1 or better against white and the page grey, so the edge of a
// field is visible without relying on the text inside it (WCAG 1.4.11 Non-text Contrast).
export const FIELD_BORDER = "#7A8590";

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
  color: "#066C77",
  border: "1px solid #087E8B",
};
