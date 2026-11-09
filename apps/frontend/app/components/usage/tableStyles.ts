// Cell styles shared by the Usage page's tables (the day-by-day table and the two breakdown tables).
import type { CSSProperties } from "react";

export const cellStyle: CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #E2E6EA",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};
export const headStyle: CSSProperties = { ...cellStyle, fontWeight: 700, color: "#000000" };
export const rowHeadStyle: CSSProperties = { ...cellStyle, textAlign: "left", fontWeight: 600 };
