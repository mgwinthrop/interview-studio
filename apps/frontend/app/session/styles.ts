// Inline styles for the session page and its parts. Values only; nothing here reads state.
import type { CSSProperties } from "react";
import { primaryButtonStyle } from "../lib/ui";

// Full-screen error state shared by "connection lost", "session failed" and the other overlays.
export const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  background: "#102B33",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  fontFamily: "var(--font-manrope), sans-serif",
};
export const overlayTitleStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: "#FFFFFF",
  margin: 0,
  letterSpacing: "-0.01em",
};
export const overlayBodyStyle: CSSProperties = {
  fontSize: 16,
  color: "#A9B7C4",
  margin: 0,
  textAlign: "center",
  maxWidth: 400,
  lineHeight: 1.6,
};
export const overlayPrimaryStyle: CSSProperties = { ...primaryButtonStyle, padding: "12px 28px" };
export const overlaySecondaryStyle: CSSProperties = {
  ...overlayPrimaryStyle,
  border: "1px solid rgba(255,255,255,0.3)",
  background: "transparent",
};
export const overlayActionsStyle: CSSProperties = { display: "flex", gap: 12, marginTop: 8 };

export const loadingStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  background: "#F4F5F1",
  color: "#566475",
  fontSize: 16,
};

export const sessionRootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  background: "#F4F5F1",
  color: "#000000",
  fontFamily: "var(--font-manrope), sans-serif",
  overflow: "hidden",
};

export const headerBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 24px",
  background: "#FFFFFF",
  borderBottom: "1px solid #E2E6EA",
  flexShrink: 0,
};
export const interviewerNameStyle: CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 700,
  color: "#000000",
  overflowWrap: "anywhere",
};
export const sessionIdStyle: CSSProperties = { fontSize: 11, color: "#566475", fontFamily: "monospace" };
export const timerStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  color: "#000000",
  letterSpacing: "0.05em",
  fontVariantNumeric: "tabular-nums",
  fontFamily: "var(--font-manrope), monospace",
};

export const trialBannerStyle: CSSProperties = {
  padding: "8px 24px",
  background: "#FDF1D0",
  color: "#8B6200",
  fontSize: 14,
  fontWeight: 600,
  borderBottom: "1px solid #E2E6EA",
  flexShrink: 0,
};

export const pausedBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 40,
  background: "rgba(11, 22, 59, 0.82)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  backdropFilter: "blur(2px)",
};
export const pausedTitleStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: "#FFFFFF",
  margin: 0,
  letterSpacing: "-0.01em",
  fontFamily: "var(--font-manrope), sans-serif",
};
export const pausedResumeStyle: CSSProperties = {
  marginTop: 8,
  padding: "12px 32px",
  borderRadius: 8,
  border: "none",
  background: "#087E8B",
  color: "#FFFFFF",
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "var(--font-manrope), sans-serif",
  letterSpacing: "0.01em",
};

export const sttToastStyle: CSSProperties = {
  position: "fixed",
  bottom: 72,
  left: "50%",
  transform: "translateX(-50%)",
  background: "#FFCEB9",
  border: "1px solid #E9784A",
  borderRadius: 8,
  padding: "10px 20px",
  fontSize: 14,
  color: "#A8380F",
  fontWeight: 500,
  pointerEvents: "none",
  zIndex: 10,
  whiteSpace: "nowrap",
};

export const textInputBarStyle: CSSProperties = {
  position: "fixed",
  bottom: 53, // footer height
  left: 0,
  right: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 32px",
  borderTop: "1px solid #E2E6EA",
  background: "#FFFFFF",
  zIndex: 5,
};
export const textInputFieldStyle: CSSProperties = {
  flex: 1,
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px solid #E2E6EA",
  background: "#F4F5F1",
  color: "#000000",
  fontSize: 16,
  fontFamily: "var(--font-manrope), sans-serif",
};
export const textSendStyle: CSSProperties = {
  padding: "10px 20px",
  borderRadius: 8,
  border: "none",
  background: "#087E8B",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

export const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 12,
  padding: "12px 24px",
  borderTop: "1px solid #E2E6EA",
  background: "#FFFFFF",
  flexShrink: 0,
};
export function typeToggleStyle(on: boolean): CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 8,
    border: `1px solid ${on ? "#087E8B" : "#E2E6EA"}`,
    background: on ? "#D8F0EC" : "transparent",
    color: on ? "#066C77" : "#566475",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    lineHeight: 1,
    transition: "background 0.2s, color 0.2s, border-color 0.2s",
    fontFamily: "var(--font-manrope), sans-serif",
  };
}
export function pauseButtonStyle(paused: boolean): CSSProperties {
  return {
    padding: "10px 24px",
    borderRadius: 8,
    border: `1px solid ${paused ? "#087E8B" : "#566475"}`,
    background: paused ? "#087E8B" : "transparent",
    color: paused ? "#FFFFFF" : "#566475",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.03em",
    transition: "background 0.2s, color 0.2s, border-color 0.2s",
    fontFamily: "var(--font-manrope), sans-serif",
    display: "flex",
    alignItems: "center",
    gap: 6,
  };
}
export function endButtonStyle(disabled: boolean): CSSProperties {
  return {
    padding: "10px 24px",
    borderRadius: 8,
    border: "1px solid #B03E14",
    background: "transparent",
    color: "#B03E14",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.03em",
    transition: "background 0.2s, color 0.2s",
    fontFamily: "var(--font-manrope), sans-serif",
    ...(disabled ? { cursor: "not-allowed", opacity: 0.5 } : {}),
  };
}
