"use client";

import Link from "next/link";

interface NavProps {
  demo?: boolean;
}

export function Nav({ demo }: NavProps) {
  return (
    <nav
      className="nav-root"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 50,
        padding: "0 24px",
        background: "#102B33",
        flexShrink: 0,
      }}
    >
      {/* Left: Conversation icon + product name */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Link href="/" aria-label="Interview Studio home" style={{width: 32, height: 32, borderRadius: 10, background: "#087E8B", color: "white", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12, textDecoration: "none"}}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-6 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M7 9h10M7 13h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></Link>

        <span
          style={{
            fontFamily: "var(--font-manrope), sans-serif",
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: "0.06em",
            color: "#FFFFFF",
            textTransform: "uppercase",
          }}
        >
          Interview Studio
        </span>
      </div>

      {/* Right: nav links + demo badge + more */}
      <div className="nav-links-group" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {demo && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              background: "#FDF1D0",
              color: "#8B6200",
              padding: "3px 10px",
              borderRadius: 999,
              marginRight: 8,
            }}
          >
            Demo Mode
          </span>
        )}

        <Link href="/" style={navLinkStyle}>
          Home
        </Link>
        <Link href="/dashboard" style={navLinkStyle}>
          Dashboard
        </Link>
        <button
          aria-label="More options"
          style={{
            background: "transparent",
            border: "none",
            color: "#8896A8",
            fontSize: 18,
            cursor: "pointer",
            padding: "4px 8px",
            lineHeight: 1,
            letterSpacing: "0.05em",
          }}
        >
          ···
        </button>
      </div>
    </nav>
  );
}

const navLinkStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "#8896A8",
  textDecoration: "none",
  padding: "4px 10px",
  borderRadius: 6,
  transition: "color 0.15s",
};
