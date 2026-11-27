# FQ-52 - Gate 4: slices

Four slices, in strict order: S0 → S1 → S2 → S3. Each is a separate GitHub issue, a
sub-issue of #52.

**Why four, not the three previewed at gate 3:**
- The gate 3 S2 (cards plus Dashboard line) was estimated at 300-350 lines, too close to the
  charter's 400-line limit. It is split into S2 (the page) and S3 (the Dashboard line).
- **No user can reach the feature until S3.** S0-S2 build `/progress` but nothing links to
  it. A merged S0 or S2 on its own would otherwise send users to a page that says "Not enough
  yet" with ten sessions stored. S3 is the release switch.

**Kinds.** S0-S2 change nothing a user can reach, so they are `kind:enabling`. S3 is
`kind:user-facing`. The charter's mix rule (at most 2 enabling items in review) is met
because the slices run one at a time.

**Test files are per slice.** Once a slice merges, its tests are existing test files, which
an unattended run may not modify (charter §3). Each slice adds its own new files, and every
assertion must stay true after the later slices land. That rules out exact session counts
against the shared mock backend. Counts are asserted on stubbed data only.

**Deviation from issue #52:** the issue proposed reusing `components/usage/TrendChart.tsx`.
Gate 3 uses a new `Sparkline`, because `TrendChart` is a daily bar chart with axes and
tooltips. The issue text is untrusted input, and the approved spec is what binds.

### S0 - Route and page skeleton, unlinked (tracer)
- **Files:**
  - Backend: new `apps/backend/src/deliveryTrend.ts` (router only, returning
    `{ showFillers, sessions: [] }`), modified `apps/backend/src/app.ts`.
  - Backend test: new `apps/backend/src/__tests__/server.deliveryTrend.test.ts`.
  - Frontend: new `apps/frontend/app/lib/deliveryTrend.ts` (types, `parseTrend`,
    `fetchTrend`, `MIN_POINTS`) and `apps/frontend/app/progress/page.tsx` (`Nav`, heading,
    "Not enough yet", error line).
  - Frontend tests: new `apps/frontend/tests/unit/deliveryTrendParse.test.ts` and
    `apps/frontend/e2e/progress-page.spec.ts`.
- **Estimate:** about 150 lines.
- **done_when:**
  - **Route.** `GET /api/delivery/trend` returns 200 with `showFillers` equal to
    `config.reportFillerCounts` and `sessions` an array. It sits behind the existing auth: a
    request without the token in `AUTH_TOKEN` mode is refused exactly as `/api/sessions` is.
    `server.deliveryTrend.test.ts` proves both, with no assertion on the array's length.
  - **Parsing.** `parseTrend` accepts the route's exact shape and rejects malformed bodies
    whole (unit tests). `fetchTrend` resolves null on a network error or bad shape, and never
    throws.
  - **Page.** `/progress` with a stubbed `{ sessions: [] }` shows "Not enough yet". With a
    stubbed 500 it shows the plain error line and a link to the Dashboard. A real-backend
    request to the route returns 200 and parses.
  - **Unlinked.** No link to `/progress` exists anywhere in the app.
  - **Scope.** No existing test file is modified, no load-bearing file is edited, and full
    gates are GREEN.
- **Gate level:** full. **Load-bearing:** false. **Confidence:** high.

### S1 - Real numbers from stored reports (load-bearing)
- **Files:**
  - Backend: modified `apps/backend/src/persistence.ts` (adds
    `listDeliverySummariesFromDb`, **load-bearing**) and `apps/backend/src/deliveryTrend.ts`
    (adds `median`, `fillersPer100Words`, `sessionPoint`; the router uses them).
  - Backend tests: new `apps/backend/src/__tests__/deliveryTrend.test.ts` and
    `apps/backend/src/__tests__/server.deliveryTrendData.test.ts`.
  - Docs: modified `docs/reports.md` (the route, which sessions count, the median rule, the
    filler rate).
- **Estimate:** about 300 lines, most of them tests.
- **Depends on:** S0.
- **done_when:** gate 3 tests 1-10 pass, specifically:
  - `median`: odd and even counts, nulls skipped, all nulls gives null.
  - **Gap equality.** `median(gaps, 0)` equals `summarizeDelivery(...).medianResponseGapMs`
    over 20 generated sets.
  - `fillersPer100Words`: 3 in 120 gives 2.5, null count gives null, 0 words gives null,
    0 in 100 gives 0.
  - `sessionPoint`: the four medians, with fillers only when `showFillers` is true.
  - **The route over seeded reports.** It proves:
    - points come oldest first, each equal to the median of that report's `perTurn` values
    - fillers equal `fillerCount / totalWords * 100`
    - failed, abandoned and active sessions, format 1 reports and reports without
      `delivery` are left out
    - another owner's sessions never appear
    - the response keys are exactly the `TrendPoint` keys, and seeded marker strings from
      report text and the snapshot are absent
    - corrupted stored numbers become null or drop the session, never a 500
    - with the filler switch on, a report that hid fillers gives null, never 0
  - `persistence.ts`: the only change is the added function. `git diff` shows no edit to any
    existing function, and existing persistence tests pass unchanged.
  - `delivery/**`, `auth.ts` and `providers/**` are not edited.
  - **Scope.** No existing test file is modified, and **deep** gates are GREEN.
- **Gate level:** deep. **Load-bearing:** true. **Run mode:** an interactive session with
  your read of the diff, never an unattended run (charter §2). **Confidence:** medium.

### S2 - Cards, lines and the filter on `/progress`
- **Files:**
  - Frontend: modified `apps/frontend/app/lib/deliveryTrend.ts` (adds `filterOptions`,
    `pointsFor`, `cardsFor`) and `apps/frontend/app/progress/page.tsx`.
  - New: `apps/frontend/app/components/progress/ProgressCard.tsx`, `Sparkline.tsx`,
    `sparklineLayout.ts`, and `apps/frontend/app/lib/deliveryFormat.ts`.
  - Modified: `apps/frontend/app/components/report/DeliverySection.tsx` (imports the moved
    formatters; no change in behaviour).
  - Tests: new `apps/frontend/tests/unit/deliveryTrendCards.test.ts`,
    `tests/unit/sparklineLayout.test.ts`, `tests/unit/deliveryFormat.test.ts` and
    `e2e/progress-cards.spec.ts`.
- **Estimate:** about 300 lines.
- **Depends on:** S1.
- **done_when:** gate 3 tests 11-13 and 15-17 pass, specifically:
  - `filterOptions`: all first, newest name, null-name ids folded into one "Earlier
    interview" option. `pointsFor` narrows, including for the folded option.
  - `cardsFor`: fixed order, nulls skipped, filler card only with `showFillers`, first and
    latest formatted.
  - `sparklinePoints`: n values give n points, a constant series is flat, one value gives
    no line.
  - `deliveryFormat`: pins `formatPace` and `formatSeconds` output, including "1.0 second".
  - **Wording guard.** The page contains none of: better, worse, improved, good, bad,
    target, ideal, goal, score. It does contain the explanatory line.
  - **e2e** `progress-cards.spec.ts` (stubbed):
    - four cards with lines
    - each card's accessible label lists the stubbed values in order
    - choosing an interviewer narrows them
    - a one-session filter shows "Not enough yet"
    - with `showFillers` true, a fifth card shows "per 100 words"
  - The existing report specs pass unchanged (the formatter move changes nothing).
  - Still unlinked: no link to `/progress`.
  - `--repeat-each=10` passes on the new spec, and its summary line is in the PR body.
  - **Scope.** No existing test file is modified, and full gates are GREEN.
- **Gate level:** full. **Load-bearing:** false. **Confidence:** medium.

### S3 - The Dashboard line (release)
- **Files:**
  - Frontend: new `apps/frontend/app/components/ProgressLine.tsx`, modified
    `apps/frontend/app/dashboard/page.tsx` (renders the line under `UsageLine`, and bumps
    `refreshKey` after a successful delete).
  - Tests: new `apps/frontend/tests/unit/progressLine.test.ts` and
    `apps/frontend/e2e/progress-line.spec.ts`.
- **Estimate:** about 120 lines.
- **Depends on:** S2.
- **done_when:**
  - `progressLineText`: 0 gives "", 1 gives "1 session measured", 6 gives "6 sessions
    measured".
  - **e2e** `progress-line.spec.ts`:
    1. Stubbed: the line shows the stubbed count, and its link opens `/progress` with the
       cards.
    2. Stubbed 500: only the link shows.
    3. Stubbed delete: after a 204, the line refetches. The stub's second answer has one
       session fewer, and the line shows it.
    4. Real mock backend: after completing one mock session, the line reads "N session(s)
       measured" with N ≥ 1, and the link opens `/progress`. No exact count is asserted,
       because the e2e backend is shared.
  - Existing `smoke`, `navigation*`, `report-embedded` and `report-*` specs pass unchanged.
    The default Dashboard view and session selection are untouched.
  - The PR body has before and after screenshots of the Dashboard header and `/progress`
    with stubbed data (charter §5).
  - `--repeat-each=10` passes on the new spec.
  - **Scope.** No existing test file is modified, and full gates are GREEN.
- **Gate level:** full. **Load-bearing:** false. **Confidence:** medium-high.

## Queue plan (written only after your approval)

| Slice | Issue | Labels | Handoff |
|---|---|---|---|
| S0 | new sub-issue of #52 | `factory:ready-to-implement`, `kind:enabling` | `done_when` as above, `load_bearing: false`, `gate_level: full`, `confidence: high` |
| S1 | new sub-issue of #52 | `factory:wait-to-implement` (blocked on S0 merging), `kind:enabling` | `load_bearing: true`, `gate_level: deep`, `confidence: medium`, interactive only |
| S2 | new sub-issue of #52 | `factory:wait-to-implement` (blocked on S1), `kind:enabling` | `gate_level: full`, `confidence: medium` |
| S3 | new sub-issue of #52 | `factory:wait-to-implement` (blocked on S2), `kind:user-facing` | `gate_level: full`, `confidence: medium-high` |
| #52 | existing | `factory:ready-to-spec` replaced by `factory:wait-to-implement` (blocked on S0-S3). It is closed when S3 merges | none |

Each handoff comment carries the slice's `done_when`, `files_expected` and the fields above,
in the contract's `factory-handoff:v1` format. The slices are also written into the
`QUEUE.md` snapshot, and a `spec` run record goes under `docs/factory/runs/`.

**Queue load today (checked 2026-11-27):**
- `factory:awaiting-review`: 0
- `factory:in-progress`: 0
- `factory:ready-to-implement`: 2, both FQ-108 (#127, #129), which are `enabling`

S0 is also `enabling`. Under the charter's mix rule, an implementation run takes a ready
user-facing item first, and none is ready. So S0 competes with #127 and #129 in the normal
order.
