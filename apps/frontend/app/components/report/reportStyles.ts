import type { CSSProperties } from "react";

export const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export const panelStyle: CSSProperties = {
  padding: "18px 22px",
  borderRadius: 10,
  background: "#F8F9FB",
  border: "1px solid #E2E6EA",
  fontSize: 15,
  lineHeight: 1.75,
  color: "#000000",
  fontWeight: 400,
  overflowWrap: "anywhere",
};

export const plainListStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

export const cardStyle: CSSProperties = {
  padding: "14px 18px",
  borderRadius: 8,
  background: "#FFFFFF",
  border: "1px solid #E2E6EA",
  minWidth: 0,
};

export const itemTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#000000",
  marginBottom: 6,
  overflowWrap: "anywhere",
};

export const itemTextStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.65,
  color: "#000000",
  fontWeight: 400,
  overflowWrap: "anywhere",
};
