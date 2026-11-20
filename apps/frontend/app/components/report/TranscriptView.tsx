import type { TranscriptTurn } from "../../lib/transcript";
import { cardStyle, itemTextStyle, plainListStyle } from "./reportStyles";

const whoStyle = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase" as const,
  color: "#566475",
  marginBottom: 4,
};

/**
 * FQ-50: the conversation on the report's Transcript tab, in order. Every answer is shown in
 * full (owner decision, gate 1). The download stays beside it in ReportView.
 */
export function TranscriptView({ turns }: { turns: readonly TranscriptTurn[] }) {
  return (
    <ol role="list" aria-label="Conversation" style={{ ...plainListStyle, marginBottom: 24 }}>
      {turns.map((t, i) => (
        <li
          key={i}
          style={{
            ...cardStyle,
            background: t.role === "user" ? "#FFFFFF" : "#F4F5F1",
          }}
        >
          <div style={whoStyle}>{t.role === "user" ? `You · Answer ${t.answer}` : "Interviewer"}</div>
          <p dir="auto" style={{ ...itemTextStyle, whiteSpace: "pre-wrap" }}>
            {t.content}
          </p>
        </li>
      ))}
    </ol>
  );
}
