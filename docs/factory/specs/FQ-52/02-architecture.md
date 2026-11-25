# FQ-52 - Gate 2: architecture

## Decisions at this gate

> Decided 2026-11-25 (owner): **Q1 option B** (the median of the per-answer figures for
> all four numbers), **Q2 yes** (read the stored report summary). The gate 1 success
> measure was reworded to match (`01-product.md`).

### Q1. What one session's point means for pace and longest pause (revisits gate 1 D2)

Gate 1 approved two things that cannot both hold for two of the four numbers:

- **D2:** one point per session, using its **median**, "so one rambling answer does not
  swamp the line".
- **Success measure:** "Every number equals the matching figure in that session's own
  report."

What each session's report holds (`summarizeDelivery`, stored in `Report.reportJson` as
`delivery.summary`):

| Number | Report headline figure | Also in the report, per answer |
|---|---|---|
| Pace | `averageWordsPerMinute`: weighted by speaking time, so the longest answer dominates | `perTurn[].wordsPerMinute` |
| Gap before answering | `medianResponseGapMs` | `perTurn[].responseGapMs` |
| Longest pause | `longestPauseSec`: the **maximum** across answers, so one answer decides it | `perTurn[].longestPauseSec` |
| Answer length | None | `perTurn[].wordCount` |

- **Option B (recommended): the median of the per-answer figures, for all four.**
  - D2 holds as written, and so does its purpose.
  - Every point can still be checked against the report: it is the median of the numbers
    on that report's answer cards.
  - The gap point equals the report's headline figure exactly.
  - Cost: for pace and longest pause, the trend number differs from the report's headline
    figure. The cards must say "typical per answer". The gate 1 success measure becomes:
    "every number equals the median of the matching per-answer figures in that session's
    report."
- **Option A: the report's headline figure where one exists.**
  - Pace and longest pause then equal the report exactly.
  - Cost: it reverses D2's purpose. The session maximum and the time-weighted average are
    exactly the figures one long answer swamps.
- **Option C: option B, but drop longest pause from the trend.** This is for you if a
  "typical longest pause" reads as too abstract.

I recommended A in the first draft. I changed it after the critic pointed out that A
defeats the reason you gave for D2.

### Q2. The source: the stored report summary, not a recomputation (recommended)

The trend reads each session's **stored** `delivery.summary` and does not recompute from
the turn rows. This is the critic's alternative, adopted because recomputing can disagree
with the report in real cases:

- **A failed turn write.** The report is built from the turns held in memory
  (`sessionController.ts:527`). Turn writes are fire-and-forget, and a failure is only
  logged (`sessionController.ts:701-708`). The report then counts an answer that the turn
  rows do not have.
- **A later change to `delivery/metrics.ts`.** Every old report keeps its frozen figures,
  but a recomputation would follow the new code, so the two would split for every past
  session.
- **The filler switch flipped since the report.** Each report stored `fillerCount: null`
  when fillers were hidden at the time.

Reading the stored summary makes "checkable against the report" hold by construction. It
also settles which sessions count, with no special rules: those whose report carries
`delivery`. That leaves out interviewers with `deliveryFeedback: false`, format 1 reports,
sessions with no readable snapshot, and sessions with no spoken answers.

## What this touches

| Module | Change | Load-bearing? |
|---|---|---|
| `apps/backend/src/persistence.ts` | **One new read-only function**, `listDeliverySummariesFromDb(ownerId)`. For the owner's `complete` sessions, it parses `reportJson` with the existing private `parseReportV2`. It returns **numbers only**: session id, `startedAt`, `interviewerId`, `interviewerName` (via the existing `snapshotName`), and the summary's numeric fields and `perTurn` numbers. It never returns report text, quotes, the snapshot or turn content, and no existing function changes | **Yes** |
| `apps/backend/src/deliveryTrend.ts` (new) | A pure `sessionPoint(summary)` that computes the medians under Q1, plus the route handler | No |
| `apps/backend/src/app.ts` | Mounts the router after the existing auth middleware (`app.ts:130-138`) | No |
| `apps/backend/src/delivery/**`, `auth.ts`, `providers/**` | **Not touched.** `summarizeDelivery` is not even called | Yes, not edited |
| `apps/frontend/app/lib/deliveryTrend.ts` (new) | Types, fetch, shape-checked parse, filter options, a series per number, the "not enough yet" rule. Pure and unit-tested | No |
| `apps/frontend/app/components/progress/` (new) | `DeliveryProgress.tsx` (section, filter, empty state) and a sparkline card | No |
| `apps/frontend/app/dashboard/page.tsx` | Places the section, and refetches it after a delete | No |
| `docs/reports.md` | The route, which sessions count, and how each number is derived | No |

There are no schema changes, migrations, WebSocket changes, LLM calls or new dependencies.

## Data shapes

```
GET /api/delivery/trend                    (same auth and owner scope as /api/sessions)
200 { showFillers: boolean, sessions: TrendPoint[] }     // oldest first, by startedAt

TrendPoint = {
  sessionId: string,
  startedAt: string,                       // ISO
  interviewerId: string,
  interviewerName: string | null,
  answersMeasured: number,                 // summary.turnsMeasured, >= 1
  paceWpm: number | null,
  gapMs: number | null,
  longestPauseSec: number | null,
  answerWords: number | null,
  fillers?: number | null                  // only when showFillers; the report's own fillerCount
}
```

**Medians (option B)**
- Each median is taken over the non-null per-answer values, so a value that was not
  measured is never counted as zero.
- With no non-null values the result is `null`, and the card skips that session.
- For an even count, the median is the mean of the two middle values, rounded the way the
  source field is:
  - pace: 1 decimal
  - pause: 2 decimals
  - gap and word count: `Math.round`, which is the rule `medianResponseGapMs` uses
- The gap point therefore equals `medianResponseGapMs`, and a test pins that.

**Fillers**
- `showFillers` is `config.reportFillerCounts`. It is read once at startup, not per
  request.
- The value shown is each report's own `fillerCount`. That is a session total, because the
  report has no per-answer filler count. It is already `null` when that report hid fillers.
- So turning the switch on later never invents fillers for old sessions.

**Interviewer labels**
- Filter options key on `interviewerId` and are labelled with the newest session's name.
- Any null names are grouped under one "Earlier interview" option rather than repeated.
  Under Q2 this should be rare.

**What never leaves the server:** turn text, report text, quotes, the snapshot, word lists
and raw JSON. Only numbers, ids, dates and the interviewer name.

## Call flow

1. The Dashboard mounts. Beside the existing `/api/sessions` fetch, `DeliveryProgress`
   fetches `/api/delivery/trend`.
2. **Server:**
   1. auth → `ownerOf(res)`.
   2. `listDeliverySummariesFromDb(ownerId)` runs one query: `complete` sessions with their
      report, filtered by `ownerId`. Each row's `reportJson` is parsed inside
      `persistence.ts` and only the numbers are returned. Rows with no `delivery` are
      dropped.
   3. `sessionPoint` computes each point.
   4. The response is sorted by `startedAt`.
3. **Client:**
   1. Parse the body (shape-checked). A bad body shows the section's error line.
   2. Build the filter options. The view opens on **All interviewers** (D3).
4. **Render:**
   - Fewer than 2 points in the current filter: show "Not enough yet" with the count.
   - Otherwise, one card per number with the latest value, the first and latest values, and
     a sparkline whose accessible label lists the values.
   - Neutral colour only. No thresholds, bands, targets or words like "better" or "worse".
5. **Delete:** after a successful delete, the section refetches.
6. **Failure:** the section shows one plain line, and the rest of the page is unaffected.

## External dependencies

None. No provider is called, and nothing new is sent anywhere.

## Load-bearing paths

**`apps/backend/src/persistence.ts`: one added read function.** The critic agreed the edit
is justified. The alternatives:

- **A query in a new module** would need second copies of `parseReportV2` and
  `snapshotName`. Two parsers for the same stored JSON can drift.
- **Per-session `readReportFromDb` calls** mean N+1 queries, and they pull whole reports
  (text included) out of the persistence layer.

Parsing inside `persistence.ts` keeps report text from ever reaching the new module.
Consequence: that slice runs `deep` gates and needs your read (charter §2 and §6).

**Not touched:** `delivery/**` and `providers/**`. Making the mock produce varied numbers
would be a second load-bearing edit (`providers/**`), so it is ruled out here. See testing
below.

## Testing consequences decided now

- **`PROFILE=mock` cannot show a pace line.** Every mock answer is "hello there": 2 words
  in 0.55 s, under the 5-word and 2-second floor (`providers/mock.ts:41`,
  `providers/index.ts:48`, `delivery/metrics.ts:64-66`). Pace is `null`, and every other
  number is constant.
- **The numbers oracle** is therefore a new backend route test. It seeds sessions with
  `reportJson` holding known `delivery.summary` values directly into the temp SQLite DB, and
  asserts:
  - each point equals the median of the matching per-answer values
  - the gap point equals `medianResponseGapMs`
  - another owner's sessions never appear
  - no text field is in the response
- **The e2e** (mock, no provider change) proves the section renders points, the filter
  narrows them, and "Not enough yet" shows with one session. In mock, the pace card shows
  "not measured".
- **Gate 1 wording to align.** The measure "a line per number across three mock sessions"
  is not reachable for pace in mock. It should read "a point per session for every number
  the sessions measured".

## What could break

| Risk | Mitigation |
|---|---|
| Owner leak | The query filters by `ownerId`, as every read in `persistence.ts` does. A route test covers it |
| Report text leaks through the new function | Parsing and stripping happen inside `persistence.ts`. The function's return type has no string fields except id, name and date. A route test asserts no other keys |
| A malformed stored summary | `parseReportV2` checks only that `delivery.summary` is an object and `perTurn` is an array (`persistence.ts:78-85`), not their numbers. The new function must check each numeric field it returns: a finite number or `null`. Any other value becomes `null`, never a guess. Gate 3 lists a test with corrupted values |
| A number becomes a verdict | No thresholds, colours or comparative words. Gate 3 lists a DOM check for them |
| Many sessions | One query that parses each `reportJson`. That is a few KB per session, fine at prototype scale. No pagination; revisit if `RETENTION_DAYS` stays unset for years |
| Regenerated reports | Regenerate writes a fresh summary from the stored turns. The trend follows whatever report is stored now, as the report page does |
| Dashboard layout | The page is a fixed `100vh` two-column layout with `overflow: hidden` (`dashboard/page.tsx:197-203`), with no obvious slot. Gate 3 decides placement. Existing Dashboard and report e2e specs must pass unchanged |
| Naming | The gate 1 text says "History page"; the nav and route say "Dashboard". Gate 3 and the announcement use the name the UI shows |

## Oracle

This is not a migration. The oracle has two parts:

- Every trend number is derivable from that session's stored report summary, by the rule
  in Q1.
- The existing report, report-embedded and Dashboard tests pass unchanged.

## factory-critic review (2026-11-25, against the first draft)

Position: **concerns**. Every finding is addressed above:

- **Blocking.** Recomputation could disagree with the stored report. Fixed by the switch to
  reading the stored summary (Q2).
- **Blocking.** Mock pace is always null, and varying the mock would touch `providers/**`.
  Decided under "Testing consequences".
- **Should-fix.**
  - Option A defeats D2's purpose: now stated, and the recommendation changed to B.
  - Filler switch drift: resolved by Q2.
  - Null snapshots: resolved by Q2.
  - Duplicate "Earlier interview" options: grouped.
  - Even-count median rounding: fixed above.
  - The persistence function returned the snapshot: it now returns numbers only.
- **Notes.**
  - The `persistence.ts` edit is justified.
  - Order-independence of the figures: no action.
  - Typed turns have no metrics: no action.
  - Dashboard naming and layout: in "What could break".
