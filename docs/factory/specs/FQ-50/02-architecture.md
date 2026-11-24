# FQ-50 - Gate 2: architecture

## What this touches

| Module | Change | Load-bearing? |
|---|---|---|
| `apps/backend/src/reportRoutes.ts` | New read-only route `GET /api/session/:sessionId/turns` beside the existing text download | No |
| `apps/backend/src/persistence.ts` | **Read only:** the route calls the existing `readTurnsFromDb(sessionId, ownerId)`. Not edited | Yes, so it is not edited |
| `apps/backend/src/auth.ts` | **Unchanged.** The route sits behind the same middleware, and `ownerOf(res)` scopes the query exactly as the download does | Yes, not edited |
| `apps/frontend/app/lib/` | New `transcript.ts`: the type, the fetch, and pure helpers (answer numbering, question for an answer, quote matching) | No |
| `apps/frontend/app/components/ReportView.tsx` | Fetches the turns with the report. The Transcript tab renders the conversation. Holds "which answer to show", switches tabs and highlights | No |
| `apps/frontend/app/components/report/` | New `TranscriptView.tsx`. `ContentSection.tsx`: quote link. `DeliverySection.tsx`: question line and "Read answer" | No |
| `docs/reports.md` | Documents the route and the matching rule | No |

No database schema change, WebSocket change, LLM or prompt change, or new dependency.

## Data shapes

```
GET /api/session/:sessionId/turns          (same auth and owner scope as /transcript)
200 { turns: Turn[] }
404 { error }                               unknown, foreign, or no turns (same as /transcript)

Turn = {
  role: "user" | "assistant",
  content: string,
  phase: string,
  answer?: number      // user turns only: 1-based position among user turns, in stored order
}
```

- **`answer` is computed on the server** with the same rule as `summarizeDelivery`'s
  `perTurn.turn`: every user turn counts, measured or not, in the order `readTurnsFromDb`
  returns them. So report card "Answer 3" and transcript `answer: 3` are the same turn by
  construction, not by a second implementation in the browser.
- **No delivery numbers in this route.** Numbers shown beside an answer come from the
  report's existing `delivery.summary.perTurn`, joined on `answer`. There is one source for
  delivery numbers: the report, which is computed in code (CLAUDE.md contract). Typed
  answers and old rows have no `perTurn` entry and show "no delivery numbers".
- **No ids, timestamps or metrics JSON are exposed.** The route returns only what the page
  shows.

## Call flow

1. The report page loads. `ReportView` fetches the report (as today) and the turns in
   parallel.
2. **The Report tab:**
   - Each "Answer N" card shows `questionFor(N)`: the interviewer's turns between answer
     N−1 and answer N, joined, so a greeting plus question stays together. It also has a
     "Read answer" button.
   - Each strength quote passes through `matchQuote(quote, turns)`. That returns an answer
     number only when the normalised quote occurs in **exactly one** user turn; otherwise it
     returns null, and the quote is shown without a link.
3. **"Read answer" or a quote link** sets the target answer, switches to the Transcript tab,
   scrolls to the answer and highlights it (focus moves to it for keyboard and screen-reader
   users).
4. **The Transcript tab** renders the turns in order: the interviewer, then you with
   "Answer N". Each answer shows its numbers from `perTurn` or "Typed answer: no delivery
   numbers". The download link stays.
5. **If the turns fetch fails or returns 404,** the report renders exactly as today: no
   questions, no links, and the Transcript tab falls back to the download only. The feature
   degrades; it never blocks the report.

## Quote matching rule

Text is split into lower-cased words, with curly quotes and apostrophes made plain and
punctuation dropped. A quote is linked to answer N only if it has at least 2 words, and its
words appear in order, as a contiguous run of whole words, in exactly one user turn. Two
matches or none means no link: **never the wrong answer** (gate 1, criterion 3).

> Corrected 2026-11-24 (owner). This section first said "at least 3 words" and a substring
> match. Gate 3 (`03-design.md`) and the S2 `done_when` set 2 words and whole-word runs, and
> that is what shipped in `matchQuote` (`apps/frontend/app/lib/transcript.ts`). Numbers stay
> whole ("1.5", "10,000") and combining marks stay with their letter (PR #172).

The prompt already requires quotes "copied word for word from the participant's own lines"
(`reportGenerator.ts` `CONTENT_INSTRUCTIONS`), so exact matching after normalisation is the
expected case, not a hope. Format 1 reports have `evidence`, not quotes, and are not linked.

## External dependencies

None.

## Load-bearing paths

None edited. `persistence.ts` and `auth.ts` are used as they are.

## What could break

| Risk | Mitigation |
|---|---|
| Stored turn order differs from the order the report was built from, so "Answer 3" points at the wrong turn | Both come from the same stored order on regenerate. At session end the report is built from in-memory turns in arrival order, which is also insert order. Gate 3 adds a test that the route's `answer` numbering equals `summarizeDelivery`'s `perTurn.turn` for the same turns |
| Ownership leak: another owner's transcript | Same `ownerOf(res)` and `readTurnsFromDb(..., ownerId)` as the existing download. A route test for 404 on a foreign session |
| The embedded report (History page) breaks or double-fetches | `ReportView` is shared; the fetch lives in it once. The e2e covers both the report page and the embedded view |
| Long conversations | 50 turns of short text: trivial to render. No virtualisation |
| A highlighted answer that is off-screen or unreachable by keyboard | The target gets focus (`tabIndex=-1`) and `scrollIntoView`; reduced-motion users get no smooth scroll |
| The e2e cannot test quote links: the mock's report has no strength quotes | Gate 3 decides: unit tests for `matchQuote` and the components, plus whether to give the mock profile a quote |

## Oracle

Not a migration. The existing report e2e specs and `report-embedded.spec.ts` must pass
unchanged. The download route's output is unchanged and pinned by its existing test.
