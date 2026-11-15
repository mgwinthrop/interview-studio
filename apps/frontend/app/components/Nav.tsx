"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { DemoBadge } from "./DemoBadge";

interface NavProps {
  demo?: boolean;
}

export function Nav({ demo }: NavProps) {
  return (
    <nav
      aria-label="Main"
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

      {/* Right: nav links + demo badge */}
      <div className="nav-links-group" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {demo && (
          <DemoBadge style={{ marginRight: 8 }}>Demo Mode</DemoBadge>
        )}

        <Link href="/" style={navLinkStyle}>
          Home
        </Link>
        <Link href="/interviewers" style={navLinkStyle}>
          Interviewers
        </Link>
        <Link href="/dashboard" style={navLinkStyle}>
          Dashboard
        </Link>
        <AdminMenu />
      </div>
    </nav>
  );
}

/**
 * Usage and Settings are operator tools, so they sit behind a gear rather than in the main
 * links. A disclosure (button + list of links), not an ARIA menu: Tab moves through the links,
 * Escape closes it and returns focus to the gear, and a click outside closes it.
 */
function AdminMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="nav-admin">
      <button
        ref={buttonRef}
        type="button"
        className="nav-admin-button"
        aria-label="Usage and settings"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <ul id={panelId} className="nav-admin-panel" hidden={!open}>
        <li>
          <Link href="/usage" className="nav-admin-link" onClick={() => setOpen(false)}>
            Usage
          </Link>
        </li>
        <li>
          <Link href="/settings" className="nav-admin-link" onClick={() => setOpen(false)}>
            Settings
          </Link>
        </li>
      </ul>
    </div>
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
