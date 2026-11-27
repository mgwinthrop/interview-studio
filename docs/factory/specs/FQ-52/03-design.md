# FQ-52 - Gate 3: program design

Built on the approved gate 2: option B (the median of the per-answer figures) and Q2 (read
each report's stored `delivery.summary`).

> Revised 2026-11-27 with the owner's gate 3 decisions:
> 1. The trend is its own `/progress` page, linked from a one-line summary on the
>    Dashboard. This follows the `UsageLine` → `/usage` pattern and replaces the pinned list
>    entry.
> 2. Fillers are shown per 100 words spoken.
> 3. Even-count medians stay on the stored values, with an explanatory line under the cards.

## Files

| File | New or modified | Purpose |
|---|---|---|
| `apps/backend/src/persistence.ts` | modified (**load-bearing**) | Adds `listDeliverySummariesFromDb`: numbers only, each checked. No existing function changes |
| `apps/backend/src/deliveryTrend.ts` | new | `median`, `fillersPer100Words`, `sessionPoint`, `createDeliveryTrendRouter` |
| `apps/backend/src/app.ts` | modified | Mounts the router after auth |
| `apps/backend/src/__tests__/deliveryTrend.test.ts` | new | Pure tests of `median`, `fillersPer100Words` and `sessionPoint` |
| `apps/backend/src/__tests__/server.deliveryTrend.test.ts` | new | The route over HTTP on the shared harness (`docs/contributing.md`) |
| `apps/frontend/app/lib/deliveryFormat.ts` | new | `formatPace` and `formatSeconds`, moved unchanged out of `DeliverySection.tsx` so the report and the trend format numbers identically |
| `apps/frontend/app/components/report/DeliverySection.tsx` | modified | Imports the two formatters. No change in behaviour |
| `apps/frontend/app/lib/deliveryTrend.ts` | new | Types, `parseTrend`, `fetchTrend`, `filterOptions`, `pointsFor`, `cardsFor`, `MIN_POINTS` |
| `apps/frontend/app/components/ProgressLine.tsx` | new | One line under the Dashboard heading: the measured-session count and "See your delivery over time →". Mirrors `UsageLine` |
| `apps/frontend/app/progress/page.tsx` | new | The page: `Nav`, heading, filter, cards, explanatory line, "Not enough yet", error line |
| `apps/frontend/app/components/progress/ProgressCard.tsx` | new | One number: label, latest, first and latest, sparkline |
| `apps/frontend/app/components/progress/Sparkline.tsx` | new | Inline SVG, neutral stroke, `role="img"` with a values label |
| `apps/frontend/app/components/progress/sparklineLayout.ts` | new | Pure geometry: values to SVG points |
| `apps/frontend/app/dashboard/page.tsx` | modified | Renders `<ProgressLine refreshKey={n} />` under `<UsageLine />`, and bumps `n` after a successful delete. Nothing else changes |
| `apps/frontend/tests/unit/deliveryTrend.test.ts` | new | Parse, filter and card helpers |
| `apps/frontend/tests/unit/progressLine.test.ts` | new | `progressLineText` |
| `apps/frontend/tests/unit/sparklineLayout.test.ts` | new | Geometry |
| `apps/frontend/tests/unit/deliveryFormat.test.ts` | new | Pins the moved formatters' output |
| `apps/frontend/e2e/delivery-progress.spec.ts` | new | Stubbed with `page.route` (as `report-embedded.spec.ts` does), plus one real mock-backend check |
| `docs/reports.md` | modified | The route, which sessions count, the median rule and the filler rate |

No existing test file is modified. Load-bearing paths that are only read: `delivery/**`,
`auth.ts`, `providers/**`. `Nav.tsx` is not changed: the Dashboard line is the way in.

## Contracts (no implementations)

```ts
// backend: persistence.ts
export interface StoredDeliverySummary {
  sessionId: string;
  startedAt: Date;
  interviewerId: string;
  interviewerName: string | null;        // snapshotName(interviewerJson)
  turnsMeasured: number;                 // integer >= 1
  totalWords: number | null;             // as stored
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
 * finite and >= 0; any other value becomes null. A session is dropped if turnsMeasured is
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
  fillersPer100Words?: number | null;    // present only when showFillers
}
/**
 * The median of the non-null values: the middle value, or the mean of the two middle values,
 * rounded to `decimals`. Null for no values. With decimals 0 it rounds exactly as
 * summarizeDelivery's median (Math.round).
 */
export function median(values: readonly (number | null)[], decimals: number): number | null;
/** fillerCount / totalWords * 100, rounded to 1 decimal. Null when either is null or
 *  totalWords is 0. Unknown is never 0. */
export function fillersPer100Words(fillerCount: number | null, totalWords: number | null): number | null;
/** Pure. Pace 1 decimal, pause 2 decimals, gap and words 0. Fillers only when showFillers. */
export function sessionPoint(s: StoredDeliverySummary, showFillers: boolean): TrendPoint;
export function createDeliveryTrendRouter(deps: {
  config: Pick<Config, "reportFillerCounts">;
  persist: Pick<typeof persistence, "listDeliverySummariesFromDb">;
}): express.Router;
// GET /api/delivery/trend -> 200 { showFillers: boolean; sessions: TrendPoint[] }
// No 404: an owner with nothing gets { sessions: [] }.

// frontend: app/lib/deliveryTrend.ts
export const MIN_POINTS = 2;
export type NumberKey = "paceWpm" | "gapMs" | "longestPauseSec" | "answerWords" | "fillersPer100Words";
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
  label: string;                         // e.g. "Pace, typical per answer"
  values: { sessionId: string; startedAt: string; value: number }[];  // nulls skipped
  first: string | null;                  // formatted
  latest: string | null;                 // formatted
}
/** Four cards in a fixed order, plus "Filler words per 100 words" only when showFillers.
 *  A card with fewer than MIN_POINTS values shows its values and no line. */
export function cardsFor(points: readonly TrendPoint[], showFillers: boolean): Card[];

// frontend: app/components/ProgressLine.tsx
/** "" when there are no measured sessions; otherwise "N session(s) measured". */
export function progressLineText(resp: TrendResponse): string;
/** While loading, or if the fetch fails, only the link shows (as UsageLine does).
 *  refreshKey changes after a delete, which refetches. */
export function ProgressLine(props: { refreshKey: number }): JSX.Element;

// frontend: app/components/progress/sparklineLayout.ts
/** Evenly spaced x by session order (not by date). y is scaled to this card's own min and
 *  max. A constant series gives a flat middle line. No axis, no reference line. */
export function sparklinePoints(values: readonly number[], width: number, height: number): string;
```

**Wording rules** (constants in `deliveryTrend.ts`, used by a DOM test):
- Card labels say "typical per answer". The filler card says "per 100 words".
- An explanatory line sits under the cards: "Each point is one session: the typical value
  across its spoken answers. Typed answers have no delivery numbers."
- The page says nowhere better, worse, improved, good, bad, target, ideal, goal or score.

## Call stacks

**Dashboard line**
1. `DashboardPage` renders `<UsageLine />`, then `<ProgressLine refreshKey={n} />`.
2. `ProgressLine` calls `fetchTrend` → `GET /api/delivery/trend` (server below) →
   `progressLineText`, and renders "Delivery: N sessions measured · See your delivery over
   time →" (`/progress`).
3. A successful delete returns 204. `n` is incremented, and `ProgressLine` refetches.

**Progress page**
1. `/progress` mounts. It shows `Nav` and the heading, and calls `fetchTrend(signal)`.
2. Server side:
   1. Auth middleware sets `ownerId`.
   2. The router handler calls `persist.listDeliverySummariesFromDb(ownerOf(res))`.
   3. `prisma.session.findMany` (where `ownerId` and `status: "complete"`; include the
      report's `reportJson`; order by `startedAt` ascending).
   4. Each row goes through `parseReportV2`, then a numeric check and strip, giving a
      `StoredDeliverySummary`.
   5. `sessionPoint(s, config.reportFillerCounts)` runs per session.
   6. `res.json({ showFillers, sessions })`.
3. Client side:
   1. `filterOptions` builds the filter, which defaults to `"all"` (D3).
   2. `pointsFor`, then `cardsFor`.
   3. With fewer than `MIN_POINTS` points the page shows "Not enough yet (N session)".
      Otherwise it shows the `ProgressCard`s with `Sparkline`s and the explanatory line.
4. If the fetch fails or the body is malformed, the page shows one plain line and a link back
   to the Dashboard.

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
3. `fillersPer100Words`:
   - 3 fillers in 120 words gives 2.5
   - a `null` count gives `null`
   - 0 words gives `null`
   - 0 fillers in 100 words gives 0
4. `sessionPoint`: known per-turn values give the expected four medians. With `showFillers`
   false there is no fillers key. With it true, the rate comes from that report's own
   `fillerCount` and `totalWords`.

**Backend, route (`server.deliveryTrend.test.ts`)**

Sessions are seeded with `seedStored` and `persistReport` holding known `delivery.summary`
values.

5. Points come back oldest first, one per qualifying session. Each equals the median of that
   report's `perTurn` values, and fillers equal its `fillerCount / totalWords * 100`. This is
   the gate 1 oracle.
6. Left out: failed, abandoned and active sessions, format 1 reports (no `reportJson`), and
   reports without `delivery`.
7. Owner scope: another owner's sessions never appear.
8. Numbers only: the response JSON keys are exactly the `TrendPoint` keys. No report text,
   quotes or snapshot text appear, checked by seeding unique marker strings and asserting
   they are absent.
9. Corrupted stored numbers (a string, a negative number, a non-integer `turnsMeasured`, a
   missing or empty `perTurn`): the field becomes `null` or the session is dropped. Never a
   500 and never a guessed number.
10. The filler switch: config off gives no fillers key. On, a report that hid fillers
    (stored `fillerCount: null`) gives `null`, never 0.

**Frontend, unit**

11. `parseTrend` rejects malformed bodies whole and accepts the route's exact shape.
12. `filterOptions`:
    - all first
    - labelled by the newest name
    - two null-name ids give a single "Earlier interview" option
    - `pointsFor` narrows correctly, including for the folded option
13. `cardsFor`:
    - the fixed order
    - nulls skipped per card
    - the filler card only when `showFillers`
    - first and latest formatted with the shared formatters
14. `progressLineText`: 0 sessions gives "". 1 gives "1 session measured". 6 gives "6
    sessions measured".
15. `sparklinePoints`: n values give n points across the width. A constant series is flat.
    A single value gives no line.
16. `deliveryFormat`: pins today's output of `formatPace` and `formatSeconds` (including
    "1.0 second"), so the move changes nothing.
17. The wording guard: the rendered progress page (stubbed data) contains none of the banned
    words, and does contain the explanatory line.

**Frontend, e2e (`delivery-progress.spec.ts`)**

18. Stubbed `/api/sessions` and `/api/delivery/trend` with varied values:
    - the Dashboard line shows the count, and its link opens `/progress`
    - four cards with lines
    - each card's accessible label lists the stubbed values in order
    - choosing an interviewer narrows them
    - a one-session filter shows "Not enough yet"
19. Stubbed failure (500): the Dashboard line shows only the link, and `/progress` shows
    its plain error line.
20. Real mock backend: complete one mock session. The Dashboard line reads "1 session
    measured" and `/progress` shows "Not enough yet". This proves the route is mounted and
    owner-scoped end to end without changing the mock (pace is null in mock, see gate 2).

Existing e2e specs (`smoke`, `navigation*`, `report-embedded`, `report-*`) must pass
unchanged. The Dashboard only gains one header line, and its default view and session
selection are untouched.

## The three decisions I am least confident about

1. **The Dashboard line adds a fetch to every Dashboard load, including specs that do not
   stub it.**
   - Stubbed specs such as `report-embedded` will send `/api/delivery/trend` to the real
     mock backend, or fail to reach it.
   - Either way the line degrades to the link alone, exactly as `UsageLine` does today, so
     no assertion should change. But it is one more live request in specs written to be
     fully stubbed.
   - Alternative: fetch only on `/progress`, and make the Dashboard line a static link. That
     is simpler and has no count, but is less informative. I kept the count because it is
     what makes the line worth reading.
2. **The filler rate is the one figure on the page that does not appear in the report.**
   - It is checkable with one division of two numbers the report does show (filler words
     and words spoken), and gate 1 now says so.
   - Risk: a user compares it with the report's "Filler words" count and sees a different
     number. The card label ("per 100 words") is the only guard.
3. **Rounding of an even-count median against what the report shows.**
   - Report cards display rounded numbers: pace to whole words per minute, seconds to 1
     decimal.
   - The trend takes the median of the stored values and then formats it, so it can show a
     value that appears on no answer card (for example 141 from cards showing 140 and 141).
   - This was kept by the owner on 2026-11-27, with the explanatory line as the guard. It
     stays on this list because it is the most likely source of a "this number is wrong"
     report.

## Slices (preview for gate 4)

- **S0, tracer:**
  - the route returns `{ showFillers, sessions: [] }` from a stub, mounted behind auth
  - `ProgressLine` on the Dashboard and the `/progress` page render "Not enough yet"
  - the `/progress` half of e2e test 20 passes ("Not enough yet" from the stub). The
    Dashboard count half waits for S1

  Not load-bearing.
- **S1:** `listDeliverySummariesFromDb` and real `sessionPoint`. Backend tests 1-10.
  **Load-bearing: deep gates and your read.**
- **S2:** cards, sparklines, filter, explanatory line, error states, refetch after delete,
  formatter move. Frontend tests 11-19 and `docs/reports.md`.

Each should stay under the charter's 400-line limit. S2 is the closest, at an estimated
300-350 lines with tests.
