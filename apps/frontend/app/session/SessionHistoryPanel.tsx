"use client";

import { useState } from "react";
import type { SessionHistory } from "./history/history";

// FQ-108 S12: the session history for operators (?debug=1 only; the page creates the history
// only then). It shows and copies the history's own text: fixed event labels and screen state
// names, never anything said or written (app/session/history/). Nothing is stored or sent; the
// copy goes to the clipboard of the person who presses it.
export function SessionHistoryPanel({ history }: { history: SessionHistory }) {
  const [shown, setShown] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(history.toText());
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section aria-label="Session history" style={panelStyle}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setShown(history.toText())} style={buttonStyle}>
          Show history
        </button>
        <button type="button" onClick={copy} style={buttonStyle}>
          Copy history
        </button>
      </div>
      <p role="status" style={statusStyle}>
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : ""}
      </p>
      {shown !== null && <pre style={preStyle}>{shown || "(nothing recorded yet)"}</pre>}
    </section>
  );
}

const panelStyle = { padding: "8px 12px", borderBottom: "1px solid #23464D", color: "#C9D6DA", fontSize: 11 } as const;
const buttonStyle = { fontSize: 11, padding: "3px 8px", background: "transparent", color: "#C9D6DA", border: "1px solid #3E6670", borderRadius: 4, cursor: "pointer" } as const;
const statusStyle = { margin: "4px 0 0", minHeight: 14 } as const;
const preStyle = { margin: "6px 0 0", maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 10 } as const;
