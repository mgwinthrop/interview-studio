// Styles shared by the "Build from calls" page and its parts.
import type { CSSProperties } from "react";
import { FIELD_BORDER } from "../../lib/ui";
import { ERROR_COLOR } from "../edit/FieldRow";

export const subHeadingStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: "#102B33",
  margin: "0 0 8px",
};

export const errorTextStyle: CSSProperties = {
  fontSize: 14,
  color: ERROR_COLOR,
  fontWeight: 600,
  margin: "0 0 8px",
  overflowWrap: "anywhere",
};

export function textAreaStyle(invalid: boolean): CSSProperties {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 8,
    border: invalid ? `2px solid ${ERROR_COLOR}` : `1px solid ${FIELD_BORDER}`,
    background: "#FFFFFF",
    color: "#102B33",
    fontSize: 15,
    lineHeight: 1.5,
    fontFamily: "var(--font-manrope), sans-serif",
    resize: "vertical",
    overflowWrap: "anywhere",
  };
}

/** The fixed best-effort notice, shown on the review step and in the send confirmation. */
export const BEST_EFFORT_NOTICE =
  "Redaction is best-effort. It can miss nicknames, spelled-out amounts and details specific to a client. Read the whole text before approving.";

export const noticeStyle: CSSProperties = {
  fontSize: 14,
  color: "#102B33",
  lineHeight: 1.5,
  background: "#FFF8E6",
  borderLeft: "4px solid #8A5A00",
  borderRadius: 4,
  padding: "10px 12px",
  margin: "0 0 12px",
};
