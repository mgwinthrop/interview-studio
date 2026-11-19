# FQ-50 - Gate 3: program design

## Files

| File | New or modified | Purpose |
|---|---|---|
| `apps/backend/src/transcriptTurns.ts` | new | `toTranscriptTurns`: stored turns to the route's shape, with answer numbers |
| `apps/backend/src/reportRoutes.ts` | modified | `GET /api/session/:sessionId/turns` |
| `apps/backend/src/__tests__/transcriptTurns.test.ts` | new | Numbering rule, including its equality with `summarizeDelivery` |
| `apps/backend/src/__tests__/server.turns.test.ts` | new | The route over HTTP: shape, owner scope, 404s, no extra fields (shared server harness, `docs/contributing.md`) |
| `apps/frontend/app/lib/transcript.ts` | new | Types, `parseTurns`, `fetchTurns`, `questionFor`, `matchQuote` |
| `apps/frontend/tests/unit/transcript.test.ts` | new | The pure helpers |
| `apps/frontend/app/components/report/TranscriptView.tsx` | new | The conversation in the Transcript tab, with the download kept |
| `apps/frontend/app/components/ReportView.tsx` | modified | Fetches turns. Holds `targetAnswer`; switches tab, scrolls and focuses |
| `apps/frontend/app/components/report/ReportV2Body.tsx` | modified | Passes `turns` and `onShowAnswer` through |
| `apps/frontend/app/components/report/ContentSection.tsx` | modified | Strength quote gets a "See answer N" link when matched |
| `apps/frontend/app/components/report/DeliverySection.tsx` | modified | Each "Answer N" card shows its question and "Read answer" |
| `apps/frontend/e2e/report-transcript.spec.ts` | new | End-to-end checks, both stubbed and real mock (see Tests) |
| `docs/reports.md` | modified | The route and the matching rule |

No load-bearing file is edited (`persistence.ts`, `auth.ts`, `delivery/**` and `providers/**`
are only read).

## Contracts (no implementations)

```ts
// backend: transcriptTurns.ts
export interface TranscriptTurn {
  role: "user" | "assistant";
  content: string;
  phase: string;
  /** User turns only: 1-based position among user turns, in the given order.
   *  Same rule as summarizeDelivery's perTurn.turn (every user turn counts). */
  answer?: number;
}
/** Pure. Keeps only role, content, phase and answer: no id, sessionId, timestamp or metrics. */
export function toTranscriptTurns(turns: readonly ConversationTurn[]): TranscriptTurn[];

// backend: reportRoutes.ts (inside createSessionRouter)
// GET /api/session/:sessionId/turns -> 200 { turns: TranscriptTurn[] } | 404 { error }
// Uses persist.readTurnsFromDb(sessionId, ownerOf(res)), as /transcript does.

// frontend: app/lib/transcript.ts
export interface TranscriptTurn { role: "user" | "assistant"; content: string; phase: string; answer?: number }
/** Shape-checks the JSON; null on any malformed entry (the report then renders as today). */
export function parseTurns(json: unknown): TranscriptTurn[] | null;
/** Fetches /api/session/:id/turns. Resolves null on network error, 404 or a bad shape; never throws. */
export function fetchTurns(sessionId: string, signal?: AbortSignal): Promise<TranscriptTurn[] | null>;
/** The interviewer's turns after answer n−1 and before answer n, joined with a blank line; null if none. */
export function questionFor(turns: readonly TranscriptTurn[], answer: number): string | null;
/** The answer whose content contains the quote's word sequence, if exactly one does and the
 *  quote has at least 2 words after normalising; otherwise null. Never guesses. */
export function matchQuote(quote: string, turns: readonly TranscriptTurn[]): number | null;

// frontend: components
// TranscriptView({ turns, perTurn, targetAnswer, downloadHref }): renders the conversation.
//   The element for targetAnswer gets id="answer-N", tabIndex -1 and the highlight style.
// ReportView: const [turns, setTurns]; const [targetAnswer, setTargetAnswer].
//   showAnswer(n): setActiveTab("transcript"); setTargetAnswer(n). An effect on
//   [activeTab, targetAnswer] scrolls (smooth unless prefers-reduced-motion) and focuses.
//   The turns fetch is keyed on sessionId and aborted on change, so the embedded dashboard
//   view never shows the previous session's turns.
```

**Normalising for `matchQuote`:**
- Lower-case.
- Map curly quotes, apostrophes and dashes to plain characters.
- Split on anything that is not a letter, a digit or an apostrophe.
- Drop empty tokens.

A match is the quote's token sequence appearing contiguously in an answer's token sequence.
That is a word-boundary match, so "yes" does not match inside "yesterday".

## Call stack: a strength-quote click

```
ReportView mounts (sessionId)
  fetchTurns(sessionId) → setTurns(turns | null)
ReportV2Body → ContentSection
  for each strength: n = turns ? matchQuote(s.quote, turns) : null
  n !== null → render "See answer n" button → onShowAnswer(n)
ReportView.showAnswer(n)
  setActiveTab("transcript"); setTargetAnswer(n)
  effect: document.getElementById(`answer-${n}`)?.scrollIntoView(...); .focus()
TranscriptView renders turns; answer n highlighted
```

## Tests and what each proves

**Backend:**
- `transcriptTurns.test.ts`:
  - Numbering skips assistant turns, and counts typed (unmeasured) user turns.
  - For a fixed mixed list, the answers `toTranscriptTurns` gives the measured turns equal
    `summarizeDelivery(...).perTurn.map(t => t.turn)`. This proves "Answer N" is the same
    turn in both places.
  - The output has no keys beyond role, content, phase and answer.
- `server.turns.test.ts`:
  - 200 with the shape for an owned session.
  - 404 for an unknown session.
  - 404 for another owner's session.
  - The existing text download still returns `text/plain` and is unchanged.

**Frontend unit (`transcript.test.ts`):**
- `matchQuote`:
  - exact match;
  - a match with differing case and punctuation;
  - curly quotes;
  - a word boundary ("yes" does not match "yesterday");
  - two answers containing the quote, which gives null;
  - no match, which gives null;
  - a 1-word quote, which gives null.
- `questionFor`:
  - a greeting plus a question merged;
  - an answer with no preceding interviewer turn, which gives null;
  - the closing turn after the last answer, which is not attached to any answer.
- `parseTurns` rejects malformed input.

**End to end (`report-transcript.spec.ts`):**
1. **Real mock backend.** Complete a short mock session (one spoken answer through the
   seam), then open its report.
   - The Transcript tab shows the interviewer's text and "hello there" on the page.
   - "Answer 1" in "Answer by answer" shows its question.
   - "Read answer" opens the Transcript tab with answer 1 highlighted and focused.
   - The download link is still there.
2. **Stubbed with `page.route`,** as `report-embedded.spec.ts` already does.
   - The report and turns are fixed, with one quote copied from answer 2 and one quote that
     matches nothing.
   - The first quote links to answer 2 and lands on it.
   - The second shows no link.
3. **Stubbed failure.** The turns route returns 404, and the report renders exactly as
   today: no questions, no links, and the Transcript tab offers the download.
4. **The embedded view.** In the Dashboard, switching sessions shows the new session's
   turns, never the previous one's.

Existing specs must pass unchanged: `report-embedded.spec.ts`, `smoke.spec.ts`, the report
unit tests and `server.report.test.ts`.

## The three decisions I am least confident about

1. **Testing quote links with a stubbed report, not by changing the mock profile.** At gate
   2 I recommended teaching the mock profile to produce a matching quote, and you approved
   that. I now recommend against it:
   - The canned mock report lives in `apps/backend/src/providers/index.ts`, and the charter
     lists `providers/**` as load-bearing. Changing it would force `deep` gates and a human
     read for a test convenience.
   - Even with that change, every mock answer is "hello there". Any session with 2 or more
     answers would tie, so `matchQuote` would correctly refuse to link, and the e2e would
     test nothing.
   - The stubbed approach is the repo's existing pattern (`report-embedded.spec.ts`). It
     tests exactly the client behaviour, while the real-backend e2e (test 1) covers the
     route and the transcript.

   This reverses an approved recommendation, so it needs your explicit call.
2. **What counts as "the question" for an answer:** all interviewer turns since the
   previous answer, joined. [Guessing] I have not checked what is stored when a reply is
   interrupted: a partial reply, the full text, or nothing. If partial replies are stored,
   an answer's "question" may include a cut-off reply. Acceptable, because it is what was
   said, but the slice must look at a real interrupted session before calling it done.
3. **A 2-word minimum and the "exactly one answer" rule may leave many quotes unlinked** if
   people repeat themselves. That is the price of "never the wrong answer". Gate 1's
   criterion 3 chose it, but the real link rate is unknown until real sessions run. A
   follow-up could measure it from stored reports. No change now.

## Slices (preview for gate 4)

| Slice | What a user gets | Size (estimate, incl. tests) |
|---|---|---|
| S0 tracer | The route plus the conversation on the Transcript tab (no numbers, no links). Real-mock e2e test 1, transcript part only | about 250 lines |
| S1 | Answer cards: the question on each "Answer N", "Read answer" with tab switch and highlight, numbers beside answers in the transcript | about 200 lines |
| S2 | Quote links: `matchQuote`, the "See answer N" link, stubbed e2e tests 2 and 4 | about 200 lines |

The turns-404 fallback (test 3) lands in S0. Each slice ships something a user can see, so
each is `kind:user-facing`, at `full` gates, and can run unattended: no load-bearing path,
and no existing test modified.
