# FQ-52 - Gate 3: program design

Built on the approved gate 2: option B (the median of the per-answer figures) and Q2 (read
each report's stored `delivery.summary`).

## Files

| File | New or modified | Purpose |
|---|---|---|
| `apps/backend/src/persistence.ts` | modified (**load-bearing**) | Adds `listDeliverySummariesFromDb`: numbers only, each checked. No existing function changes |
| `apps/backend/src/deliveryTrend.ts` | new | `median`, `sessionPoint`, `createDeliveryTrendRouter` |
| `apps/backend/src/app.ts` | modified | Mounts the router after auth |
| `apps/backend/src/__tests__/deliveryTrend.test.ts` | new | Pure tests of `median` and `sessionPoint` |
| `apps/backend/src/__tests__/server.deliveryTrend.test.ts` | new | The route over HTTP on the shared harness (`docs/contributing.md`) |
| `apps/frontend/app/lib/deliveryFormat.ts` | new | `formatPace` and `formatSeconds`, moved unchanged out of `DeliverySection.tsx` so the report and the trend format numbers identically |
| `apps/frontend/app/components/report/DeliverySection.tsx` | modified | Imports the two formatters. No change in behaviour |
| `apps/frontend/app/lib/deliveryTrend.ts` | new | Types, `parseTrend`, `fetchTrend`, `filterOptions`, `pointsFor`, `cardsFor`, `MIN_POINTS` |
| `apps/frontend/app/components/progress/sparklineLayout.ts` | new | Pure geometry: values to SVG points |
| `apps/frontend/app/components/progress/Sparkline.tsx` | new | Inline SVG, neutral stroke, `role="img"` with a values label |
| `apps/frontend/app/components/progress/DeliveryProgress.tsx` | new | The section: filter, cards, "Not enough yet", error line |
| `apps/frontend/app/dashboard/page.tsx` | modified | A pinned "Delivery over time" entry at the top of the left list. It shows `DeliveryProgress` in the right pane and refetches after a delete |
| `apps/frontend/tests/unit/deliveryTrend.test.ts` | new | Parse, filter and card helpers |
| `apps/frontend/tests/unit/sparklineLayout.test.ts` | new | Geometry |
| `apps/frontend/tests/unit/deliveryFormat.test.ts` | new | Pins the moved formatters' output |
| `apps/frontend/e2e/delivery-progress.spec.ts` | new | Stubbed with `page.route` (as `report-embedded.spec.ts` does), plus one real mock-backend check |
| `docs/reports.md` | modified | The route, which sessions count, and the median rule |

No existing test file is modified. Load-bearing paths that are only read: `delivery/**`,
`auth.ts`, `providers/**`.

## Contracts (no implementations)

```ts
// backend: persistence.ts
export interface StoredDeliverySummary {
  sessionId: string;
  startedAt: Date;
  interviewerId: string;
  interviewerName: string | null;        // snapshotName(interviewerJson)
  turnsMeasured: number;                 // integer >= 1
  fillerCount: number | null;            // as stored: null when that report hid fillers
  perTurn: {
    wordCount: number | null;
    wordsPerMinute: number | null;
    longestPauseSec: number | null;
    responseGapMs: number | null;
  }[];                                   // length >= 1
}
/**
 * The owner's `complete` sessions whose report is format 2 and carries `delivery`, oldest
 * first by startedAt. Parses reportJson with parseReportV2. Every returned number must be
 * finite (and >= 0); any other value becomes null. A session is dropped if turnsMeasured is
 * not a positive integer or perTurn is empty. Returns no strings except the session id and
 * interviewer id and name. Never throws on bad JSON and never logs report text.
 */
export async function listDeliverySummariesFromDb(ownerId: string): Promise<StoredDeliverySummary[]>;

// backend: deliveryTrend.ts
export interface TrendPoint {
  sessionId: string;
  startedAt: string;                     // ISO
  interviewerId: string;
  interviewerName: string | null;
  answersMeasured: number;
  paceWpm: number | null;
  gapMs: number | null;
  longestPauseSec: number | null;
  answerWords: number | null;
  fillers?: number | null;               // present only when showFillers
}
/**
 * The median of the non-null values: the middle value, or the mean of the two middle values,
 * rounded to `decimals`. Null for no values. With decimals 0 it rounds exactly as
 * summarizeDelivery's median (Math.round).
 */
export function median(values: readonly (number | null)[], decimals: number): number | null;
/** Pure. Pace 1 decimal, pause 2 decimals, gap and words 0. `fillers` only when showFillers. */
export function sessionPoint(s: StoredDeliverySummary, showFillers: boolean): TrendPoint;
export function createDeliveryTrendRouter(deps: {
  config: Pick<Config, "reportFillerCounts">;
  persist: Pick<typeof persistence, "listDeliverySummariesFromDb">;
}): express.Router;
// GET /api/delivery/trend -> 200 { showFillers: boolean; sessions: TrendPoint[] }
// No 404: an owner with nothing gets { sessions: [] }.

// frontend: app/lib/deliveryTrend.ts
export const MIN_POINTS = 2;
export type NumberKey = "paceWpm" | "gapMs" | "longestPauseSec" | "answerWords" | "fillers";
export interface TrendResponse { showFillers: boolean; sessions: TrendPoint[] }
/** Shape-checked. Null for anything malformed; a bad point is not partially kept. */
export function parseTrend(json: unknown): TrendResponse | null;
export function fetchTrend(signal?: AbortSignal): Promise<TrendResponse | null>;
/** One option per interviewerId, labelled with its newest session's name. Every null-name id
 *  folds into a single "Earlier interview" option. "All interviewers" comes first. */
export function filterOptions(points: readonly TrendPoint[]): { value: string; label: string }[];
export function pointsFor(points: readonly TrendPoint[], filter: string): TrendPoint[];
export interface Card {
  key: NumberKey;
  label: string;                         // "Pace", "Typical gap before answering", ...
  values: { sessionId: string; startedAt: string; value: number }[];  // nulls skipped
  first: string | null;                  // formatted
  latest: string | null;                 // formatted
}
/** Four cards in a fixed order, plus fillers only when showFillers. A card with fewer than
 *  MIN_POINTS values shows its values and no line. */
export function cardsFor(points: readonly TrendPoint[], showFillers: boolean): Card[];

// frontend: app/components/progress/sparklineLayout.ts
/** Evenly spaced x by session order (not by date). y is scaled to this card's own min and
 *  max. A constant series gives a flat middle line. No axis, no reference line. */
export function sparklinePoints(values: readonly number[], width: number, height: number): string;
```

**Wording rules** (constants in `deliveryTrend.ts`, used by a DOM test):
- Each card's label carries "typical per answer", because these are per-answer medians
  (gate 2, Q1).
- The section says nowhere better, worse, improved, good, bad, target, ideal, goal or score.

## Call stack: opening the progress view

1. `DashboardPage` mounts. It fetches `/api/sessions` (unchanged) and selects the first
   session (unchanged).
2. The user clicks the pinned **Delivery over time** entry. `selectedView` becomes
   `"progress"` and the right pane renders `<DeliveryProgress refreshKey={n} />`.
3. `DeliveryProgress` calls `fetchTrend(signal)`, which does a `fetch(apiUrl +
   "/api/delivery/trend")` and then `parseTrend`.
4. Server side:
   1. auth middleware sets `ownerId`.
   2. The router handler calls `persist.listDeliverySummariesFromDb(ownerOf(res))`.
   3. `prisma.session.findMany` (where `ownerId` and `status: "complete"`; include the report's
      `reportJson`; order by `startedAt` ascending).
   4. Each row goes through `parseReportV2`, then a numeric check and strip, giving a
      `StoredDeliverySummary`.
   5. `sessionPoint(s, config.reportFillerCounts)` runs per session.
   6. `res.json({ showFillers, sessions })`.
5. Client side:
   1. `filterOptions` builds the filter, which defaults to `"all"` (D3).
   2. `pointsFor`, then `cardsFor`.
   3. With fewer than `MIN_POINTS` points the section shows "Not enough yet (N session)".
      Otherwise it shows the cards, each with a `<Sparkline>`.
6. A delete elsewhere on the page: on a 204, `refreshKey` is incremented, which refetches
   the trend.

## Tests and what each proves

**Backend, pure (`deliveryTrend.test.ts`)**
1. `median`:
   - odd count gives the middle value
   - even count gives the mean of the two middle values, rounded to `decimals`
   - nulls are skipped
   - all nulls gives `null`, never 0
2. Gap equality: for 20 generated per-turn sets, `median(gaps, 0)` equals
   `summarizeDelivery(...).medianResponseGapMs`. This proves the one figure shared with the
   report's headline cannot drift. It calls the real `summarizeDelivery` and does not edit it.
3. `sessionPoint` with known per-turn values gives the expected four medians. `fillers` is
   absent when `showFillers` is false, and the stored value (including `null`) is used when
   it is true.

**Backend, route (`server.deliveryTrend.test.ts`)**

Sessions are seeded with `seedStored` and `persistReport` holding known `delivery.summary`
values.

4. Points come back oldest first, one per qualifying session, each equal to the median of
   that report's `perTurn` values. This is the gate 1 oracle.
5. Left out: failed, abandoned and active sessions, format 1 reports (no `reportJson`), and
   reports without `delivery`.
6. Owner scope: another owner's sessions never appear.
7. Numbers only: the response JSON keys are exactly the `TrendPoint` keys. No report text,
   quotes or snapshot text appear, checked by seeding unique marker strings and asserting
   they are absent.
8. Corrupted stored numbers (a string, a negative number, a non-integer `turnsMeasured`, a missing or empty `perTurn`):
   the field becomes `null` or the session is dropped. Never a 500 and never a guessed
   number.
9. The filler switch: config off gives no `fillers` key. On, it gives each report's own
   `fillerCount`, including `null` for a report that hid fillers.

**Frontend, unit**

10. `parseTrend` rejects malformed bodies whole and accepts the route's exact shape.
11. `filterOptions`:
    - all first
    - labelled by the newest name
    - two null-name ids give a single "Earlier interview" option
    - `pointsFor` narrows correctly, including for the folded option
12. `cardsFor`:
    - the fixed order
    - nulls skipped per card
    - the fillers card only when `showFillers`
    - first and latest formatted with the shared formatters
13. `sparklinePoints`: n values give n points across the width. A constant series is flat.
    A single value gives no line.
14. `deliveryFormat`: pins today's output of `formatPace` and `formatSeconds` (including
    "1.0 second"), so the move changes nothing.
15. The wording guard: the rendered `DeliveryProgress` (stubbed data) contains none of the
    banned words.

**Frontend, e2e (`delivery-progress.spec.ts`)**

16. Stubbed `/api/sessions` and `/api/delivery/trend` with varied values:
    - the pinned entry opens the section
    - four cards with lines
    - each card's accessible label lists the stubbed values in order
    - choosing an interviewer narrows them
    - a one-session filter shows "Not enough yet"
17. Stubbed failure (500): one plain line, and the session list still works.
18. Real mock backend: complete one mock session, open the pinned entry, and see "Not enough
    yet (1 session)". This proves the route is mounted and owner-scoped end to end without
    changing the mock (pace is null in mock, see gate 2).

Existing e2e specs (`report-embedded`, `report-*`, `navigation*`) must pass unchanged. The
first session is still selected on load, so they never see the new view.

## The three decisions I am least confident about

1. **Placement: a pinned list entry, not a header block.**
   - The Dashboard is a fixed `100vh` master-detail layout. A block in the header would
     squeeze the report pane on small screens. A pinned "Delivery over time" entry reuses
     the pane and its scroll, and leaves the default view (first session selected) and every
     existing e2e untouched.
   - Risk: it is less discoverable, because users must click to see it. The alternative is
     to open on the progress view when there are 2 or more points. That changes the default
     view and would touch existing e2e expectations.
2. **Fillers are a session total while the other four are per-answer medians.**
   - The report has no per-answer filler count, so a median is not available without
     editing `delivery/**` (load-bearing). A total also grows with the number of answers,
     so the line partly tracks session length.
   - Alternatives:
     - divide by `turnsMeasured`, which gives a figure the report does not show
     - drop fillers from the trend
   - I kept the total, labelled "filler words in the session", because it is the report's
     own figure. This is the one place option B's "median per answer" does not hold.
3. **Rounding of an even-count median against what the report shows.**
   - Report cards display rounded numbers: pace to whole words per minute, seconds to 1
     decimal.
   - The trend takes the median of the stored (unrounded) values and then formats it. With
     two middle values, the displayed median can be a value that appears on no answer card
     (for example cards showing 140 and 141, and a trend showing 141 from 140.9).
   - It is still "the median of the per-answer figures", but a user checking by eye can see
     a half-step difference. The alternative, taking the median of display-rounded values,
     would make the trend depend on display formatting. I prefer the stored values.

## Slices (preview for gate 4)

- **S0, tracer:**
  - the route returns `{ showFillers, sessions: [] }` from a stub, mounted behind auth
  - the pinned entry and section render "Not enough yet"
  - e2e test 18 passes

  Not load-bearing.
- **S1:** `listDeliverySummariesFromDb` and real `sessionPoint`. Backend tests 1-9.
  **Load-bearing: deep gates and your read.**
- **S2:** cards, sparklines, filter, error line, refetch after delete, formatter move.
  Frontend tests 10-17 and `docs/reports.md`.

Each should stay under the charter's 400-line limit. S2 is the closest, at an estimated
300-350 lines with tests.
