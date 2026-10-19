import type { ReportV1View } from "../../lib/report";
import { Section } from "./reportParts";

/** Format 1: older reports, rendered exactly as before. */
export function ReportV1Body({ report }: { report: ReportV1View }) {
  return (
    <div style={{ maxWidth: 680 }}>
      <Section title="Summary">
        <div
          style={{
            padding: "18px 22px",
            borderRadius: 10,
            background: "#F8F9FB",
            border: "1px solid #E2E6EA",
            fontSize: 15,
            lineHeight: 1.75,
            color: "#000000",
            fontWeight: 400,
          }}
        >
          {report.summary}
        </div>
      </Section>

      <Section title="Overall reflection">
        <div
          style={{
            padding: "18px 22px",
            borderRadius: 10,
            background: "#F8F9FB",
            borderLeft: "4px solid #087E8B",
            fontSize: 15,
            lineHeight: 1.75,
            color: "#000000",
            fontWeight: 400,
          }}
        >
          {report.overallAssessment}
        </div>
      </Section>

      {report.format === 1 && report.strengths.length > 0 && (
        <Section title="Areas of depth">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {report.strengths.map((s, i) => (
              <div
                key={i}
                style={{
                  padding: "14px 18px",
                  borderRadius: 8,
                  background: "#FFFFFF",
                  border: "1px solid #E2E6EA",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#087E8B",
                    flexShrink: 0,
                    marginTop: 7,
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#000000",
                      marginBottom: 4,
                    }}
                  >
                    {s.area}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      lineHeight: 1.65,
                      color: "#000000",
                      fontWeight: 400,
                    }}
                  >
                    {s.evidence}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {report.improvements.length > 0 && (
        <Section title="Gaps identified">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {report.improvements.map((imp, i) => (
              <div
                key={i}
                style={{
                  padding: "14px 18px",
                  borderRadius: 8,
                  background: "#FFFFFF",
                  border: "1px solid #E2E6EA",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#E9784A",
                    flexShrink: 0,
                    marginTop: 7,
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#000000",
                      marginBottom: 4,
                    }}
                  >
                    {imp.area}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      lineHeight: 1.65,
                      color: "#000000",
                      fontWeight: 400,
                    }}
                  >
                    {imp.suggestion}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
