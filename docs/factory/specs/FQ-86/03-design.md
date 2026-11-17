# FQ-86 Gate 3 - Program design

Signatures and contracts only. No implementations.

> **Revision 2, 2026-11-17 (owner).** Rewritten around a single hearing state value managed by
> a pure transition function, replacing three parallel `useState` values and two refs
> (`hearingRef`, `pendingReopenRef`). Gate 2 was amended to match. Revision 1's
> least-confident decisions 1 and 2 no longer apply.

## Files

| Path | New / modified | Load-bearing | Slice | Estimated changed lines |
|---|---|---|---|---|
| `apps/frontend/app/lib/hearingState.ts` | new (A1), extended (B) | no | A1, B | ~40 + ~15 |
| `apps/frontend/hooks/useVAD.ts` | modified | **yes** | A1, B | ~25 + ~3 |
| `apps/frontend/hooks/useHearingDeadline.ts` | new | no | A2 | ~25 |
| `apps/frontend/app/session/page.tsx` | modified | no | A2 | ~15 (12 removed, 3 added) |
| `apps/frontend/tests/unit/hearingState.test.ts` | new | no | A1 | ~80 |
| `apps/frontend/tests/unit/useVADAttemptId.test.ts` | new | no | A1 | ~90 (about 65 of it is the fake-VAD harness copied from `useVADResume.test.ts`) |
| `apps/frontend/tests/unit/useHearingDeadline.test.ts` | new | no | A2 | ~80 |
| `apps/frontend/e2e/resume-flash.spec.ts` | new | no | A2 | ~45 |
| `apps/frontend/tests/unit/hearingStateCancel.test.ts` | new | no | B | ~70 |
| `apps/frontend/tests/unit/useVADPauseReopen.test.ts` | new | no | B | ~125 (the same harness copied again) |
| `apps/frontend/e2e/pause-reopen.spec.ts` | new | no | B | ~110 (about 35 of it is the `getUserMedia` hang harness copied from `resume.spec.ts`) |

Total is about 720 lines, so it ships as three slices, each well under the 400-line STOP_IF:
A1 ~235, A2 ~165, B ~325.

Each slice puts its tests in new files. A later slice may not edit a test file that an
earlier slice created, because by then it is an existing test (`TESTS_ARE_LOAD_BEARING`).
No existing file under `tests/` or `e2e/` is modified. `app/lib/sessionDisplay.ts` and
`app/types.ts` are unchanged.

## Types and contracts

### `apps/frontend/app/lib/hearingState.ts` (new, pure: no React, no I/O)

```ts
import type { Hearing } from "../types";

export type HearingAttempt = "start" | "resume";

export interface HearingState {
  hearing: Hearing;
  /** Which kind of attempt last moved hearing into "starting" (chooses the alert wording). */
  attempt: HearingAttempt;
  /** Increments on, and only on, the transitions into "starting". 0 before any attempt. */
  attemptId: number;
  /** Slice B. The hearing value before the reopen in flight; null when no reopen is in flight. */
  beforeReopen: Hearing | null;
}

export type HearingEvent =
  | { type: "start" }          // startMic begins a load
  | { type: "loaded" }         // the VAD started listening
  | { type: "startFailed" }    // load or first start failed
  | { type: "reopen" }         // resumeMic really reopens a paused, loaded VAD
  | { type: "reopened" }       // that reopen succeeded (only while current)
  | { type: "reopenFailed" }   // that reopen failed (only while current)
  | { type: "stop" }           // stopMic
  | { type: "cancelReopen" };  // slice B: pauseMic

export const INITIAL_HEARING_STATE: HearingState; // { "off", "start", 0, null }

/** Pure. Never mutates `state`. Returns `state` itself (same object) when nothing changes. */
export function hearingTransition(state: HearingState, event: HearingEvent): HearingState;
```

Transition table (B = added in slice B):

| Event | hearing | attempt | attemptId | beforeReopen |
|---|---|---|---|---|
| start | "starting" | "start" | +1 | null |
| loaded | "ready" | = | = | null |
| startFailed | "failed" | = | = | null |
| reopen | "starting" | "resume" | +1 | B: previous `hearing` |
| reopened | "ready" | = | = | null |
| reopenFailed | "failed" | = | = | null |
| stop | "off" | = | = | null |
| B: cancelReopen | `beforeReopen` if set, else = | = | = | null (same object if already null) |

Invariants:
- I1: `attemptId` changes only on start and reopen, and `hearing` is `"starting"` after
  both.
- I2 (slice B): `beforeReopen !== null` only between a reopen and the next event. Every
  other event clears it, so a reopen made stale by Pause ("cancelReopen") or by stop
  ("stop") cannot be restored later.

### `apps/frontend/hooks/useVAD.ts` (modified, load-bearing)

```ts
const [hs, dispatch] = useReducer(hearingTransition, INITIAL_HEARING_STATE);

interface UseVADReturn {
  // ...existing fields unchanged in name, type and meaning...
  /** FQ-86: identifies the current hearing attempt (see HearingState.attemptId). */
  hearingAttemptId: number;
}
// return { ..., hearing: hs.hearing, hearingAttempt: hs.attempt, hearingAttemptId: hs.attemptId }
```

Line-for-line swap map (slice A1). Each swap stays in place, under its existing guard.

| Where | Today | After |
|---|---|---|
| `loadVad`, load failed | `setHearing("failed")` | `dispatch({ type: "startFailed" })` |
| `loadVad`, `vad.start()` failed | `setHearing("failed")` | `dispatch({ type: "startFailed" })` |
| `loadVad`, success | `setHearing("ready")` | `dispatch({ type: "loaded" })` |
| `startMic` | `setHearing("starting"); setHearingAttempt("start")` | `dispatch({ type: "start" })` |
| `stopMic` | `setHearing("off")` | `dispatch({ type: "stop" })` |
| `resumeMic`, reopening | `setHearing("starting"); setHearingAttempt("resume")` | `dispatch({ type: "reopen" })` |
| `resumeMic`, `.then` if current | `setHearing("ready")` | `dispatch({ type: "reopened" })` |
| `resumeMic`, `.catch` if current | `setHearing("failed")` | `dispatch({ type: "reopenFailed" })` |
| `pauseMic` (slice B) | — | `dispatch({ type: "cancelReopen" })` before `resumeSeqRef++` |

The `useState` declarations for `hearing` and `hearingAttempt` are removed.
- `micActive` and `micFallback` stay as their own `useState`, set exactly where they are
  today (see decision 2 below).
- `dispatch` is stable, like a state setter, so the `useCallback` dependency arrays don't
  change.

### `apps/frontend/hooks/useHearingDeadline.ts` (new, slice A2)

```ts
/**
 * Contract:
 * - false in the very render in which `attemptId` takes a new value (derived by comparing a
 *   stored expired id with the current id; never reset by an effect)
 * - true from the first render after `ms` has elapsed since `attemptId` last changed (or
 *   since mount for the first value), until `attemptId` changes again
 * - an earlier attempt's timer never expires a later attempt
 * - the first value's timer runs from mount (FQ-41's no-gesture case)
 * - safe under StrictMode's double effect run
 */
export function useHearingDeadline(attemptId: number, ms?: number /* HEARING_DEADLINE_MS */): boolean;
```

### `apps/frontend/app/session/page.tsx` (modified, slice A2)

- Destructure `hearingAttemptId` from `useVAD`.
- Delete the `hearingDeadlinePassed` and `hearingEpoch` state and their two effects
  (current lines 282-291).
- Add `const hearingDeadlinePassed = useHearingDeadline(hearingAttemptId);`. Keeping the
  name means `cannotHear`, the typing-bar effect and `panelState(...)` are textually
  unchanged.
- Update the FQ-41 and FQ-79 comment.

## Call stack: ordinary Resume (defect 1, after A1 and A2)

```
PausedOverlay "Resume session" onClick
└─ page.handleResume()
   ├─ await audioQueue.resume()
   ├─ useVAD.resumeMic()
   │  ├─ dispatch({ type: "reopen" })   → { "starting", "resume", n+1, before: "ready" }
   │  └─ vad.start() ─▶ resumeStream ─▶ openMic(seq) ─▶ getUserMedia
   └─ setIsPaused(false)
   ── render ──
   page: hearing="starting", hearingAttemptId=n+1
   └─ useHearingDeadline(n+1): expiredId !== n+1 → false → cannotHear=false
      → no alert inserted; typing-bar effect sees false
   ── effect: 10 s timer for n+1
   vad.start() resolves, current() → dispatch({ type: "reopened" }) → "ready", before: null
```

## Call stack: Pause during a pending reopen (defect 2, after B)

```
... resumeMic as above; getUserMedia pending; state { "starting", "resume", n+1, before: "ready" }
"Pause session" onClick
└─ page.handlePause()
   ├─ useVAD.pauseMic()
   │  ├─ pausedRef = true
   │  ├─ dispatch({ type: "cancelReopen" })   → { "ready", "resume", n+1, before: null }
   │  ├─ resumeSeqRef++                       // reopen now stale (existing)
   │  └─ vad.pause()
   ├─ await audioQueue.suspend()              // brief "Listening" (accepted, gate 2)
   └─ setIsPaused(true)
timer for n+1 fires while paused → expiredId = n+1; hearing "ready" → no alert
getUserMedia settles late → openMic's resumeSeq guard stops the stream (existing);
  .then/.catch: current() false → no dispatch (existing guard)
Resume → reopen → attempt n+2 → fresh 10 s
```

## Test list

All tests are in new files. "Fails today" means the test fails on the code before its slice.

### Slice A1: `tests/unit/hearingState.test.ts` (pure, no React)

| # | Test | Proves | Fails today |
|---|---|---|---|
| R1 | start from initial → `{ "starting", "start", 1 }` | I1 for start | yes (module absent) |
| R2 | loaded and startFailed → "ready" and "failed"; attempt and attemptId unchanged | Settling does not start an attempt | yes |
| R3 | reopen from "ready" and from "failed" → `{ "starting", "resume", +1 }` | I1 for reopen | yes |
| R4 | reopened and reopenFailed → "ready" and "failed"; attemptId unchanged | Same as R2 for reopen | yes |
| R5 | stop → "off"; attempt and attemptId unchanged | Reconnect does not consume an attempt until startMic | yes |
| R6 | every event: input object not mutated; same input gives an equal output | Purity (StrictMode double-invokes reducers) | yes |

### Slice A1: `tests/unit/useVADAttemptId.test.ts` (hook, mocked vad-web)

| # | Test | Proves | Fails today |
|---|---|---|---|
| V7 | `hearingAttemptId`: 0 at mount; 1 after startMic; 2 after a real Resume; unchanged after a no-op Resume (not paused), after Pause and after settling; +1 after stopMic → startMic | The hook dispatches at the right places, including the early returns the reducer cannot see | yes (field absent) |

Behaviour preservation for A1 is proven by the existing, unedited `useVADResume`,
`useVADHearing` and `useVADMicDevice` unit tests and the `hearing.spec.ts` and
`resume.spec.ts` e2e suites.

### Slice A2: `tests/unit/useHearingDeadline.test.ts` (jsdom, fake timers, render log)

| # | Test | Proves | Fails today |
|---|---|---|---|
| D1 | id 0: false at mount and at 9.9 s, true at 10 s | FQ-41: the timer runs from mount | yes (hook absent) |
| D2 | id 0 expires; rerender with id 1 → the render log has no render with `(id=1, passed=true)` | Defect 1 mechanism: no stale render on a new attempt | yes |
| D3 | id changes at 9 s → still false at 10 s, true at 19 s | An old timer cannot expire a new attempt | yes |
| D4 | ids 0 → 1 → 2, each after expiry (reconnect or retry) | The stopMic → startMic path is covered | yes |

### Slice A2: `e2e/resume-flash.spec.ts` (Playwright; a MutationObserver records every `.session-hearing-alert` insertion)

| # | Test | Proves | Fails today |
|---|---|---|---|
| E1 | ready → wait 11 s → Pause → Resume (mic ok) → ready; zero alert insertions; the "Type your message" box is not visible | Defect 1 end to end, as reproduced on 2026-11-17 | **yes** (2 insertions, typing bar open) |

### Slice B: `tests/unit/hearingStateCancel.test.ts` (pure)

| # | Test | Proves | Fails today |
|---|---|---|---|
| C1 | ready → reopen → cancelReopen → "ready"; failed → reopen → cancelReopen → "failed" | #86 core rule, and gate 1 decision 1 | yes |
| C2 | cancelReopen with nothing in flight → returns the same object | No spurious render | yes |
| C3 | reopen → stop → start → cancelReopen → `{ "starting", "start" }` | Factory-critic objection 1, now enforced by I2 | yes |
| C4 | reopen → reopened → cancelReopen → "ready", no change; double cancel → no change | A settled or already cancelled reopen is not restored twice | yes |
| C5 | table-driven: after reopen, every other event leaves `beforeReopen === null` | I2 | yes |

### Slice B: `tests/unit/useVADPauseReopen.test.ts` (hook, mocked vad-web)

| # | Test | Proves | Fails today |
|---|---|---|---|
| V1 | ready → Pause → Resume (gUM pending) → Pause → `hearing === "ready"` | `pauseMic` is wired to cancelReopen | yes |
| V2 | V1, then the held gUM resolves (or rejects) → still "ready", the late track is stopped | A stale settle cannot overwrite the restore | yes |
| V4 | Resume (pending) → stopMic → startMic (load pending) → Pause → `"starting"`, attempt "start" | Objection 1 through the real hook | no. This guards against a regression. |

### Slice B: `e2e/pause-reopen.spec.ts`

| # | Test | Proves | Fails today |
|---|---|---|---|
| E2 | ready → Pause → hang → Resume → Pause (within 2 s) → wait 11 s paused → zero insertions, `data-hearing="ready"` → hang → Resume → no insertion within 9 s → alert visible by 12 s | #86 end to end, and a real hang is still reported after a fresh 10 s | **yes** |
| E3 | ready → Pause → hang → Resume → alert by 12 s → Pause → alert count 0, `data-hearing="ready"` | Gate 2 owner decision: a reported hang clears on Pause | **yes** |

All existing suites must stay green with no edits. Slices A1 and B are `deep` (load-bearing);
A2 is `full`.

## The three decisions I am least confident about

1. **Dropping the generation and sequence check in `pauseMic` and relying on invariant
   I2.**
   - The claim: `beforeReopen` is set only while a current reopen is in flight. Every way
     a reopen stops being current also dispatches an event that clears it:
     - Pause: cancelReopen.
     - `stopMic`: stop.
     - Settling: only while `current()` holds.
     - A newer Resume: needs a Pause first, because `resumeMic` returns early unless paused.
     - Unmount bumps the generation without dispatching, but the component is gone.
   - [Likely] It holds today. The risk is a future path that makes a reopen stale without
     dispatching. C3, C5 and V4 would catch the known shapes of that, not new ones.
   - The alternative is keeping a ref check as well: defence in depth, at the cost of the
     second source of truth this revision removed.
2. **`micActive` and `micFallback` stay outside the reducer.** This is a smaller version of
   the split-state concern you raised.
   - Why: they describe the device, not hearing transitions. `micFallback` is set inside
     `openMic`'s device-selection logic, which gate 2 keeps untouched.
   - Cost: `reopenFailed` and `stop` still sit next to separate `setMicFallback(null)` and
     `setMicActive(false)` calls. No rule links them to `hearing`, and nothing in the page
     reads them together with `hearing`.
3. **The existing unit tests as the oracle for the A1 refactor.**
   - A1 swaps eight setter calls in a load-bearing file. The existing `useVAD*` tests and
     e2e suites exercise each transition: load failure, start failure, stale start, resume
     success, resume failure, stale resume, stop. [Likely] They would catch a wrong event
     at any site.
   - Weak spot: a swap placed outside its guard (for example, dispatching before an
     `if (gen !== genRef.current) return`). This is covered only where an existing test
     drives the stale path.
   - Mitigation: the A1 PR body carries the swap map above, and the human read checks
     each row against the diff.

Also noted, not changed from revision 1: the e2e tests wait on real 10 s timers (about 60 s
added to the e2e job), because Playwright's fake clock would also fake vad-web's timers.
