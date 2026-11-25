import type { ReportV2View } from "../../lib/report";
import { MainSection, SubSection } from "./reportParts";
import { cardStyle, itemTextStyle, itemTitleStyle, panelStyle, plainListStyle } from "./reportStyles";

export function ContentSection({
  content,
  answerFor,
  onShowAnswer,
}: {
  content: NonNullable<ReportV2View["content"]>;
  /** FQ-50: the answer a quote came from, once the transcript has loaded; null when it can't be traced. */
  answerFor?: (quote: string) => number | null;
  onShowAnswer?: (answer: number) => void;
}) {
  return (
    <MainSection title="Content">
      <p dir="auto" style={{ ...panelStyle, margin: "0 0 24px" }}>
        {content.summary}
      </p>

      {content.strengths.length > 0 && (
        <SubSection title="What came through">
          <ul role="list" style={plainListStyle}>
            {content.strengths.map((s, i) => {
              const answer = answerFor?.(s.quote) ?? null;
              return (
              <li key={i} style={cardStyle}>
                <div dir="auto" style={itemTitleStyle}>
                  {s.area}
                </div>
                <blockquote
                  dir="auto"
                  style={{
                    margin: "0 0 8px",
                    padding: "2px 0 2px 14px",
                    borderLeft: "3px solid #087E8B",
                    fontSize: 14,
                    lineHeight: 1.65,
                    fontStyle: "italic",
                    color: "#000000",
                    overflowWrap: "anywhere",
                  }}
                >
                  “{s.quote}”
                  {answer !== null && onShowAnswer && (
                    <>
                      {" "}
                      <button
                        type="button"
                        aria-label={`See answer ${answer}`}
                        onClick={() => onShowAnswer(answer)}
                        style={{ border: "none", background: "none", padding: 0, color: "#087E8B", fontSize: 13, fontWeight: 600, fontStyle: "normal", cursor: "pointer" }}
                      >
                        See answer {answer} →
                      </button>
                    </>
                  )}
                </blockquote>
                <p dir="auto" style={itemTextStyle}>
                  {s.note}
                </p>
              </li>
              );
            })}
          </ul>
        </SubSection>
      )}

      {content.developAreas.length > 0 && (
        <SubSection title="Worth developing">
          <ul role="list" style={plainListStyle}>
            {content.developAreas.map((d, i) => (
              <li key={i} style={cardStyle}>
                <div dir="auto" style={itemTitleStyle}>
                  {d.area}
                </div>
                <p dir="auto" style={itemTextStyle}>
                  {d.suggestion}
                </p>
              </li>
            ))}
          </ul>
        </SubSection>
      )}
    </MainSection>
  );
}
