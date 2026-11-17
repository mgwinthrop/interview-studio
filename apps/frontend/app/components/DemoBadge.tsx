import type { CSSProperties, ReactNode } from "react";

const badgeStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  background: "#FDF1D0",
  color: "#8B6200",
  padding: "3px 10px",
  borderRadius: 999,
};

/** The "demo mode" pill shown in the session header. `style` adds to the base look. */
export function DemoBadge({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={style ? { ...badgeStyle, ...style } : badgeStyle}>{children}</span>;
}
