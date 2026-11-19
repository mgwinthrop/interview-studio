# FQ-50 - Gate 1: product

## The problem

You finish a practice interview and open the report. It says your third answer ran to 142
words, took 6 seconds to start, and had a 4-second pause. It also says one of your strengths
was "I'd start by asking who the customer is."

What it does not show you is the question you were answering, or what you actually said.
To see that, you download a text file, open it somewhere else, and count answers by hand to
work out which one was "Answer 3". The numbers and the praise float free of the words they
describe, so the report is hard to learn from. Reading your own answers is the most useful
part of practising.

## What success looks like

1. **No download needed to read your conversation.** The Transcript tab shows the whole
   conversation on the page, question by question, in your words and the interviewer's.
2. **Every answer has its question.** In the report's "Answer by answer", each answer shows
   the question it was answering, with its numbers, and one click takes you to the full
   answer in the transcript.
3. **Praise points at the proof.** A strength quote takes you, in one click, to the answer it
   came from, highlighted. If a quote cannot be traced to an answer, it is shown as today,
   without a link, and never linked to the wrong answer.
4. **Nothing is lost.** The download is still there. Typed answers, which have no delivery
   numbers, and older conversations still show their transcript.

**How we measure it:** with the mock interviewer, a finished session's report shows every
question and answer on the page. Each "Answer N" card shows its question and opens the
matching answer. A strength quote taken from an answer opens that answer. A conversation
from before this change renders without errors.

## Announcement

> **Your answers are now in your report.** The Transcript tab shows the whole conversation,
> question by question, right on the page. Each answer in "Answer by answer" now shows the
> question it answered, and one click takes you to what you said. Click a strength quote and
> the report jumps to the answer it came from. You can still download the transcript.

## Screens

`mockups/report-transcript.html` shows the Transcript tab as a conversation, an "Answer by
answer" card with its question and a link, and a strength quote that links to its answer.

## Decisions for the owner

1. **How each answer is shown in the Transcript tab.** Recommended: the full text, always
   shown. Answers are short by design (the interviewer keeps its own turns brief, and spoken
   answers rarely pass 250 words), and hiding your own words behind "show more" defeats
   the point. The alternative is collapsing answers over about 120 words.
2. **Where a quote's link goes.** Recommended: to the answer in the Transcript tab,
   highlighted, so there is one place where answers are read. The alternative is expanding
   the answer inside the report tab, which duplicates the transcript.

## What we are deliberately not doing

- **No new data leaves the device or the server.** The transcript is already stored and
  downloadable. This shows it on the page; it sends nothing new anywhere.
- **No audio.** Audio is never stored, so there is no playback.
- **No editing, notes or annotations** on answers.
- **No "Redo this answer" or "Practise this".** That is #51, which builds on these answer
  cards once they exist.
- **No changes to how the report is written.** The interviewer's feedback, the delivery
  numbers and the reading stay as they are.
- **No search across conversations** and no new export formats.

## Should this exist?

Yes. The transcript is the raw material of practice, and today it is one download away
from a report that talks about it without showing it. #51, turning feedback into the next
practice rep, cannot be built without these answer cards.
