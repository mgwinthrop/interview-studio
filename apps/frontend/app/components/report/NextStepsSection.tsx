import { MainSection } from "./reportParts";

export function NextStepsSection({ steps }: { steps: string[] }) {
  return (
    <MainSection title="Next steps">
      <ol
        style={{
          listStyle: "decimal",
          margin: 0,
          paddingLeft: 22,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {steps.map((step, i) => (
          <li
            key={i}
            dir="auto"
            style={{ fontSize: 15, lineHeight: 1.65, color: "#000000", overflowWrap: "anywhere" }}
          >
            {step}
          </li>
        ))}
      </ol>
    </MainSection>
  );
}
