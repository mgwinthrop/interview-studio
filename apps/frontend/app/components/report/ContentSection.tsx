import type { ReportV2View } from "../../lib/report";
import { MainSection, SubSection } from "./reportParts";
import { cardStyle, itemTextStyle, itemTitleStyle, panelStyle, plainListStyle } from "./reportStyles";

export function ContentSection({ content }: { content: NonNullable<ReportV2View["content"]> }) {
  return (
    <MainSection title="Content">
      <p dir="auto" style={{ ...panelStyle, margin: "0 0 24px" }}>
        {content.summary}
      </p>

      {content.strengths.length > 0 && (
        <SubSection title="What came through">
          <ul role="list" style={plainListStyle}>
            {content.strengths.map((s, i) => (
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
                </blockquote>
                <p dir="auto" style={itemTextStyle}>
                  {s.note}
                </p>
              </li>
            ))}
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
