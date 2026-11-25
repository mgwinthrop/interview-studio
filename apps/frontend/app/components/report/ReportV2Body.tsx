import type { ReportV2View } from "../../lib/report";
import { matchQuote, questionFor, type TranscriptTurn } from "../../lib/transcript";
import { ContentSection } from "./ContentSection";
import { DeliverySection } from "./DeliverySection";
import { NextStepsSection } from "./NextStepsSection";

/**
 * Format 2: three parts. Parts the server left out are simply absent. With the transcript
 * loaded (FQ-50), each "Answer N" shows its question and can open the answer.
 */
export function ReportV2Body({
  report,
  turns,
  onShowAnswer,
}: {
  report: ReportV2View;
  turns?: readonly TranscriptTurn[] | null;
  onShowAnswer?: (answer: number) => void;
}) {
  const { content, delivery, deliveryUnavailable, nextSteps } = report;
  const questionOf = turns ? (n: number) => questionFor(turns, n) : undefined;
  const answerFor = turns ? (quote: string) => matchQuote(quote, turns) : undefined;
  return (
    <div style={{ maxWidth: 680 }}>
      {content && <ContentSection content={content} answerFor={answerFor} onShowAnswer={onShowAnswer} />}
      <DeliverySection delivery={delivery} unavailable={deliveryUnavailable} questionOf={questionOf} onShowAnswer={onShowAnswer} />
      {nextSteps.length > 0 && <NextStepsSection steps={nextSteps} />}
    </div>
  );
}
