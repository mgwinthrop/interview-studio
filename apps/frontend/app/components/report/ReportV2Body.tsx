import type { ReportV2View } from "../../lib/report";
import { ContentSection } from "./ContentSection";
import { DeliverySection } from "./DeliverySection";
import { NextStepsSection } from "./NextStepsSection";

/** Format 2: three parts. Parts the server left out are simply absent. */
export function ReportV2Body({ report }: { report: ReportV2View }) {
  const { content, delivery, deliveryUnavailable, nextSteps } = report;
  return (
    <div style={{ maxWidth: 680 }}>
      {content && <ContentSection content={content} />}
      <DeliverySection delivery={delivery} unavailable={deliveryUnavailable} />
      {nextSteps.length > 0 && <NextStepsSection steps={nextSteps} />}
    </div>
  );
}
