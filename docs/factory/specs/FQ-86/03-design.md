# FQ-86 Gate 3 - Program design

Signatures and contracts only. No implementations.

## Files

| Path | New / modified | Load-bearing | Estimated changed lines |
|---|---|---|---|
| `apps/frontend/hooks/useHearingDeadline.ts` | new | no | ~25 |
| `apps/frontend/app/session/page.tsx` | modified | no | ~15 (12 removed, 3 added) |
| `apps/frontend/hooks/useVAD.ts` | modified | **yes** | ~25 |
| `apps/frontend/tests/unit/useHearingDeadline.test.ts` | new | no | ~80 |
| `apps/frontend/tests/unit/useVADAttemptId.test.ts` | new | no | ~90 (V7; ~65 is the mount and fake-VAD harness copied from `useVADResume.test.ts`) |
| `apps/frontend/tests/unit/useVADPauseReopen.test.ts` | new | no | ~190 (V1-V6; the same harness copied again) |
| `apps/frontend/e2e/resume-flash.spec.ts` | new | no | ~45 (E1) |
| `apps/frontend/e2e/pause-reopen.spec.ts` | new | no | ~110 (E2, E3; ~35 is the `getUserMedia` hang harness copied from `resume.spec.ts`) |

Total is about 555 lines, which is **over the charter's 400-line STOP_IF as one change**.
Gate 4 must split it along the two defects (see "Slicing constraint" at the end). Tests are
split into one new file per slice on purpose: a later slice may not edit a test file an
earlier slice created, because by then it is an existing test (`TESTS_ARE_LOAD_BEARING`).
The cost is copying the harness twice. A shared test helper module would avoid that, but
it would also be a new non-test file that both slices depend on. Not worth it at this size.

No existing file under `tests/` or `e2e/` is modified. `app/lib/sessionDisplay.ts` and
`app/types.ts` are unchanged.

## Types and contracts

### `apps/frontend/hooks/useHearingDeadline.ts` (new)

```ts
import { HEARING_DEADLINE_MS } from "../app/lib/sessionDisplay";

/**
 * Whether the hearing deadline has passed for the current attempt.
 *
 * Contract:
 * - Returns false in the very render in which `attemptId` takes a new value, whatever an
 *   earlier attempt's deadline did. "Passed" is derived by comparing a stored expired id
 *   with the current `attemptId`, never reset by an effect.
 * - Returns true from the first render after `ms` has elapsed since `attemptId` last
 *   changed (or since mount, for the first value), and stays true until `attemptId`
 *   changes again.
 * - A timer for an earlier attempt never marks a later attempt as passed.
 * - The first value's timer runs from mount, so a start that never begins (FQ-41, no
 *   gesture) is still reported.
 * - Safe under StrictMode's double effect run (the timer is cleared and restarted).
 */
export function useHearingDeadline(attemptId: number, ms?: number /* default HEARING_DEADLINE_MS */): boolean;
```

Internal state: one `useState<number | null>` for "the attempt id whose deadline expired",
and one effect keyed on `[attemptId, ms]` that sets a timeout and clears it on cleanup.

### `apps/frontend/hooks/useVAD.ts` (modified, load-bearing)

Return type gains one field. Every existing field keeps its name, type and meaning.

```ts
interface UseVADReturn {
  // ...existing fields unchanged...
  /**
   * FQ-86: identifies the current hearing attempt. Increments in the same update as every
   * move of `hearing` into "starting" (startMic, and a resumeMic that really reopens).
   * 0 before any attempt. Unchanged by pauseMic, stopMic, a no-op resumeMic, or settling.
   */
  hearingAttemptId: number;
}
```

New internal state (not exported):

```ts
const [hearingAttemptId, setHearingAttemptId] = useState(0);

// Mirror of `hearing` for stable callbacks (same pattern as aiSpeakingRef in this file).
const hearingRef: MutableRefObject<Hearing>;

// The reopen in flight, if any: what to put back if a Pause cancels it while it is current.
const pendingReopenRef: MutableRefObject<{ gen: number; seq: number; before: Hearing } | null>;
```

Function contracts. Only these three callbacks change. `loadVad`, `openMic`, `stopMic`,
the VAD callbacks and the unmount effect are not edited.

- **`startMic()`**: unchanged, except it also increments `hearingAttemptId` next to the
  existing `setHearing("starting")` and `setHearingAttempt("start")` calls.
- **`resumeMic()`**: unchanged early returns (no VAD, or not paused: nothing changes,
  including `hearingAttemptId`). When it reopens, it:
  - records `{ gen, seq, before: hearingRef.current }` in `pendingReopenRef`
  - sets `"starting"`, `"resume"` and `hearingAttemptId + 1` in one synchronous block
  - clears `pendingReopenRef` from the `.then` and `.catch` callbacks, only when
    `current()` is still true.
- **`pauseMic()`**: before bumping `resumeSeqRef`, takes `pendingReopenRef` and clears it.
  If the record's `gen === genRef.current && seq === resumeSeqRef.current`, it calls
  `setHearing(record.before)`. The rest is as today: `pausedRef = true`, then
  `resumeSeqRef++`, then `vad.pause()`.
  - Invariant: after `pauseMic`, `hearing` is never `"starting"` because of a reopen.
  - It can still be `"starting"` because of a first start that is still loading
    (unchanged, gate 1 non-goal).

### `apps/frontend/app/session/page.tsx` (modified)

- Destructure `hearingAttemptId` from `useVAD`.
- Delete the `hearingDeadlinePassed`/`hearingEpoch` state and their two effects (current
  lines 282-291).
- Add `const hearingDeadlinePassed = useHearingDeadline(hearingAttemptId);`. Keeping the
  name means `cannotHear`, the typing-bar effect and `panelState(...)` at line 581 are
  textually unchanged.
- Update the FQ-41 and FQ-79 comment above it to describe the attempt id.

## Call stack: ordinary Resume (defect 1)

```
PausedOverlay "Resume session" onClick
└─ page.handleResume()
   ├─ await audioQueue.resume()
   ├─ useVAD.resumeMic()
   │  ├─ pendingReopenRef = { gen, seq, before: "ready" }
   │  ├─ setHearing("starting"); setHearingAttempt("resume"); setHearingAttemptId(n+1)
   │  └─ vad.start() ─▶ resumeStream ─▶ openMic(seq) ─▶ getUserMedia
   └─ setIsPaused(false)
   ── one batched render ──
   page: hearing="starting", hearingAttemptId=n+1
   └─ useHearingDeadline(n+1) → expiredId (n or null) !== n+1 → false
      → cannotHear=false → no alert, typing-bar effect sees false
   ── effect: start 10 s timer for n+1
   vad.start() resolves → current() → pendingReopenRef=null; setHearing("ready")
```

## Call stack: Pause during a pending reopen (defect 2)

```
... resumeMic as above; getUserMedia pending
"Pause session" onClick
└─ page.handlePause()
   ├─ useVAD.pauseMic()
   │  ├─ rec = pendingReopenRef; pendingReopenRef = null
   │  ├─ rec current (gen, seq match) → setHearing(rec.before)   // "ready" or "failed"
   │  ├─ pausedRef = true; resumeSeqRef++   // reopen now stale (existing)
   │  └─ vad.pause()
   ├─ await audioQueue.suspend()   // panel briefly "Listening" (accepted, gate 2)
   └─ setIsPaused(true)
10 s timer for n+1 fires during pause → expiredId=n+1; hearing="ready" → no alert
getUserMedia settles late → openMic's resumeSeq guard stops the stream (existing);
  .then/.catch: current() false → nothing (existing)
Resume → attempt n+2 → fresh 10 s
```

## Test list

Every test is in a new file. "Fails today" means the test fails on current `main`.

### `tests/unit/useHearingDeadline.test.ts` (jsdom, fake timers, render log)

| # | Test | Proves | Fails today |
|---|---|---|---|
| D1 | id 0: false at mount, false at 9.9 s, true at 10 s | FQ-41 timer from mount is kept | n/a (new hook) |
| D2 | id 0 passes; rerender with id 1 → the render log has no render where `(id=1, passed=true)` | Defect 1 mechanism: no stale render on a new attempt | n/a, but D2 against the old two-effect logic would fail (see E1) |
| D3 | id changes at 9 s → at 10 s still false; true at 19 s | The old attempt's timer cannot expire the new one | n/a |
| D4 | id goes 0 → 1 → 2 after each expired, as in reconnect or retry | The `stopMic`/`startMic` path is covered too (gate 2 risk table) | n/a |

### `tests/unit/useVADAttemptId.test.ts` (slice A) and `tests/unit/useVADPauseReopen.test.ts` (slice B) (jsdom, mocked vad-web, harness copied from `useVADResume.test.ts`)

V7 goes in `useVADAttemptId.test.ts`; V1-V6 in `useVADPauseReopen.test.ts`.

| # | Test | Proves | Fails today |
|---|---|---|---|
| V1 | ready → Pause → Resume (gUM pending) → Pause → `hearing === "ready"` | #86 core: pause clears a cancelled reopen | yes (stays "starting") |
| V2 | as V1, then the held gUM resolves → still "ready", track stopped; or it rejects → still "ready", not "failed" | A stale settle cannot overwrite the restore | yes (V1 precondition) |
| V3 | reopen rejects → "failed" → Pause → Resume (pending) → Pause → `"failed"` | Gate 1 decision 1: a failure from before the pause is kept | yes (stays "starting") |
| V4 | Resume (pending) → `stopMic` → `startMic` (load pending) → Pause → `"starting"`, `hearingAttempt === "start"` | Factory-critic objection 1: no stale restore over a first start | no. This is a guard against a naive fix, and it fails if the restore ignores gen/seq. |
| V5 | V1, then Pause again → still "ready", no error | Double Pause is harmless | yes (V1 precondition) |
| V6 | ready → Pause (nothing pending) → `"ready"`; and Resume (reopen resolves) → Pause → `"ready"` | No change when nothing is pending | no (regression guard) |
| V7 | `hearingAttemptId`: 0 at mount; 1 after startMic; 2 after a real Resume; unchanged after a no-op Resume (not paused), after Pause, and after settle; +1 after stopMic → startMic | The attempt id contract | yes (field absent) |

### `e2e/resume-flash.spec.ts` (E1, slice A) and `e2e/pause-reopen.spec.ts` (E2, E3, slice B) (Playwright, mock backend, fake mic; MutationObserver records every `.session-hearing-alert` insertion)

| # | Test | Proves | Fails today |
|---|---|---|---|
| E1 | ready → wait 11 s → Pause → Resume (mic ok) → ready; zero alert insertions; the "Type your message" box is not visible | Defect 1 end to end, as reproduced on 2026-11-17 | **yes** (2 insertions, typing bar open) |
| E2 | ready → Pause → gUM hang → Resume → Pause (within 2 s) → wait 11 s paused → zero alert insertions, `data-hearing="ready"` → hang again → Resume → no insertion within 9 s → alert visible by 12 s | #86 end to end, and a real hang is still reported after a fresh 10 s | **yes** |
| E3 | ready → Pause → hang → Resume → alert by 12 s → Pause → alert element count 0 and `data-hearing="ready"` | Gate 2 owner decision: a reported hang clears on Pause | **yes** (alert stays) |

Existing suites that must stay green with no edits: `useVADResume`, `useVADHearing`,
`useVADMicDevice`, `hearingDisplay` unit tests; `hearing.spec.ts` (FQ-41) and
`resume.spec.ts` (FQ-79) e2e. Gate level `deep`.

## The three decisions I am least confident about

1. **Three parallel `useState` values and React 18 batching, rather than one combined
   state object.** The critic suggested combining `hearing`, `hearingAttempt` and the
   attempt id so they cannot drift. Combining them means rewriting every `setHearing`
   call, including four inside `loadVad`, which gate 2 promised not to touch. That
   enlarges the load-bearing diff for no behaviour change. I chose separate setters
   called in one synchronous block, which React 18 batches into one render in event
   handlers and promise callbacks alike. [Likely] This is sound: nothing in this code
   uses `flushSync`, and E1 would catch a split render. The risk is a future edit
   inserting an `await` between the setters. Mitigation: one comment at each site.
2. **`hearingRef` mirrored by an effect, used for `before`.** Callbacks cannot read
   state, so `resumeMic` reads a ref that an effect updates after each commit. If a
   Resume ran after a `setHearing` was queued but before it committed, `before` would be
   stale.
   - [Likely] This can't happen. A reopen settles only while it is current, and it
     stops being current the moment the session is paused, so no settle can be queued
     at the moment a Resume runs. `loadVad`'s `setHearing("ready")` commits long before
     any user click.
   - The worst case is restoring `"starting"`, which is today's behaviour, not a new
     failure.
   - Alternative: write `hearingRef` next to every `setHearing`. That again edits
     `loadVad`.
3. **E2E cost and timing.** E1 to E3 wait on real 10 s timers, adding roughly 60 s to the
   e2e job. Playwright's fake clock would make them fast, but it would also fake the
   timers inside vad-web and the audio pipeline, which [Guessing] could make the tests
   flaky or meaningless. I chose real time, matching how `resume.spec.ts` already waits
   10 to 12 s.

## Slicing constraint for gate 4

The estimated total (~555 lines) exceeds the 400-line STOP_IF, so this cannot ship as one
PR. Proposed seam (to be detailed in gate 4):

- **Slice A, defect 1:** `useHearingDeadline` plus `hearingAttemptId` plus the page wiring,
  with D1-D4 (`useHearingDeadline.test.ts`), V7 (`useVADAttemptId.test.ts`) and E1
  (`resume-flash.spec.ts`). About 255 lines. Touches `useVAD.ts` only to add the id.
- **Slice B, defect 2 (#86 proper):** the `pauseMic` restore and `pendingReopenRef` and
  `hearingRef`, with V1-V6 (`useVADPauseReopen.test.ts`) and E2-E3
  (`pause-reopen.spec.ts`). About 300 lines. Depends on slice A, because E2 needs the
  fresh deadline on Resume.

That gives two `deep`, human-read PRs on the load-bearing file instead of one oversized
one.
