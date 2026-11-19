# FQ-50 - Gate 4: slices

Three slices. Each ships something a user sees (`kind:user-facing`), runs at `full` gates,
touches no load-bearing path, and can run unattended.

**Test files are per slice.** Once a slice merges, its test files are existing tests, which
an unattended run may not modify (charter §3). So S1 and S2 add their own new spec and unit
files rather than extending S0's.

Order: S0, then S1, then S2. S2 uses S1's "show answer" path.

### S0 - The conversation on the Transcript tab (tracer)
- **Files:**
  - Backend: new `apps/backend/src/transcriptTurns.ts`, modified `reportRoutes.ts`.
  - Backend tests: new `__tests__/transcriptTurns.test.ts` and `__tests__/server.turns.test.ts`.
  - Frontend: new `app/lib/transcript.ts` and `app/components/report/TranscriptView.tsx`,
    modified `app/components/ReportView.tsx`.
  - Frontend tests: new `tests/unit/transcript.test.ts` and `e2e/report-transcript.spec.ts`.
  - Docs: modified `docs/reports.md`.
- **Estimate:** about 250 lines.
- **done_when:**
  - **Route.** `GET /api/session/:sessionId/turns` returns `{ turns }`. Each turn has only
    role, content, phase, plus `answer` on user turns.
    - `transcriptTurns.test.ts` proves the answers of measured turns equal
      `summarizeDelivery(...).perTurn.map(t => t.turn)`, including when a typed turn sits in
      between, and that no other keys are present.
    - `server.turns.test.ts` proves 200 for an owned session, 404 for an unknown one and 404
      for another owner's, and that `/transcript` still returns `text/plain`, unchanged.
  - **Client parsing.** `parseTurns` rejects malformed input (unit tests). `fetchTurns`
    resolves null on network error, 404 or a bad shape, and never throws.
  - **Transcript tab.** It renders the conversation in order: the interviewer's turns, then
    "You · Answer N" with the full answer text. The download link stays.
  - **Fallback.** If the turns are unavailable, the Transcript tab shows the download only
    and the Report tab is unchanged.
  - **e2e** `report-transcript.spec.ts`:
    1. A real mock session with one spoken answer, through the seam. Its report's
       Transcript tab shows the interviewer's text and "hello there", plus the download link.
    2. With the turns route stubbed to 404, the report renders and the Transcript tab offers
       only the download.
    3. In the Dashboard, switching between two stubbed sessions shows each session's own
       turns, never the previous one's.
  - **Stability.** `--repeat-each=10` passes, and its summary line is in the PR body.
  - **Scope.** No existing test file is modified, no load-bearing file is edited, and full
    gates are GREEN.
- **Confidence:** medium-high.

### S1 - Answer cards: the question, "Read answer", and numbers in the transcript
- **Files:**
  - Frontend: modified `app/lib/transcript.ts` (adds `questionFor`), `ReportView.tsx`
    (`targetAnswer`, `showAnswer`, scroll and focus), `report/ReportV2Body.tsx`,
    `report/DeliverySection.tsx` and `report/TranscriptView.tsx` (numbers, highlight target).
  - Tests: new `tests/unit/transcriptQuestion.test.ts` and `e2e/report-answer-cards.spec.ts`.
- **Estimate:** about 200 lines.
- **Depends on:** S0.
- **done_when:**
  - **Questions.** `questionFor` passes its unit tests: a greeting plus a question merged;
    no preceding interviewer turn gives null; the closing turn is attached to no answer.
  - **Answer cards.** Each "Answer N" card in "Answer by answer" shows its question and a
    "Read answer" button.
  - **Read answer.** The button switches to the Transcript tab, scrolls answer N into view
    (no smooth scroll under `prefers-reduced-motion`), highlights it and moves focus to it.
  - **Numbers in the transcript.** Answers with numbers show them from the report's
    `perTurn`. Typed answers show "Typed answer: no delivery numbers".
  - **e2e** `report-answer-cards.spec.ts`:
    - On a real mock session, card 1 shows its question.
    - "Read answer" lands on answer 1, highlighted and focused.
  - **Interrupted replies.** The run record states what is stored for an interviewer reply
    that was interrupted, checked on a real mock session with a barge-in, and how
    `questionFor` shows it.
  - **Stability.** `--repeat-each=10` passes.
  - **Scope.** No existing test file is modified. Full gates are GREEN.
- **Confidence:** medium.

### S2 - Strength quotes link to their answer
- **Files:**
  - Frontend: modified `app/lib/transcript.ts` (adds `matchQuote`), `report/ContentSection.tsx`
    and `report/ReportV2Body.tsx`.
  - Tests: new `tests/unit/transcriptQuote.test.ts` and `e2e/report-quote-links.spec.ts`.
- **Estimate:** about 200 lines.
- **Depends on:** S1.
- **done_when:**
  - **Matching.** `matchQuote` passes its unit tests:
    - an exact match;
    - differing case and punctuation;
    - curly quotes;
    - the word boundary ("yes" does not match "yesterday");
    - two answers containing the quote gives null;
    - no match gives null;
    - a 1-word quote gives null.
  - **Links.** A matched quote shows "See answer N", which lands on answer N, highlighted
    and focused. An unmatched quote shows no link. Format-1 reports show no links.
  - **e2e** `report-quote-links.spec.ts`: a stubbed report and turns (the
    `report-embedded.spec.ts` pattern, an owner decision at gate 3 D1), with one quote copied
    from answer 2 and one that matches nothing. Both behave as above.
  - **Stability.** `--repeat-each=10` passes.
  - **Scope.** No existing test file is modified. No change to `providers/**`. Full gates
    are GREEN.
- **Confidence:** high.
