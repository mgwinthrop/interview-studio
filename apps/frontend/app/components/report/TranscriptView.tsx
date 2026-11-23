import type { DeliverySummaryView } from "../../lib/report";
import type { TranscriptTurn } from "../../lib/transcript";
import { AnswerNumbers } from "./DeliverySection";
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
 * full (owner decision, gate 1). The download stays beside it in ReportView. With the report's
 * delivery numbers (`perTurn`, absent when delivery was off), each answer shows its own. The
 * answer `target` is highlighted and marked aria-current; ReportView scrolls to and focuses it.
 */
export function TranscriptView({
  turns,
  perTurn,
  target,
}: {
  turns: readonly TranscriptTurn[];
  perTurn?: DeliverySummaryView["perTurn"];
  target?: number | null;
}) {
  return (
    <ol role="list" aria-label="Conversation" style={{ ...plainListStyle, marginBottom: 24 }}>
      {turns.map((t, i) => {
        const isTarget = t.answer !== undefined && t.answer === target;
        const numbers = t.answer !== undefined ? perTurn?.find((p) => p.turn === t.answer) : undefined;
        return (
          <li
            key={i}
            id={t.answer !== undefined ? `answer-${t.answer}` : undefined}
            tabIndex={t.answer !== undefined ? -1 : undefined}
            aria-current={isTarget ? "true" : undefined}
            style={{
              ...cardStyle,
              background: t.role === "user" ? (isTarget ? "#E6F4F5" : "#FFFFFF") : "#F4F5F1",
              ...(isTarget ? { boxShadow: "inset 0 0 0 2px #087E8B" } : {}),
            }}
          >
            <div style={whoStyle}>{t.role === "user" ? `You · Answer ${t.answer}` : "Interviewer"}</div>
            <p dir="auto" style={{ ...itemTextStyle, whiteSpace: "pre-wrap" }}>
              {t.content}
            </p>
            {t.answer !== undefined && perTurn && (
              <p style={{ ...itemTextStyle, fontSize: 13, color: "#566475", marginTop: 6 }}>
                {/* Every stored spoken turn is measured (sessionController), so a missing entry is a typed answer. */}
                {numbers ? <AnswerNumbers t={numbers} /> : "Typed answer: no delivery numbers"}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
