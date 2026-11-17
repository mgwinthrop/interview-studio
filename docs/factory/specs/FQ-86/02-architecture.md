# FQ-86 Gate 2 - Architecture

Frontend only. No backend, protocol, database, dependency or wording change.

> **Amended 2026-11-17 during gate 3 (owner).** The hearing state moves into one value
> managed by a pure transition function (`useReducer`) instead of three parallel
> `useState` values and two refs. Reason: with the state split, the rules about which
> combinations are allowed are spread across about eight call sites and a ref mirror, so a
> bad combination shows up as a hard-to-trace symptom. Consequences:
> - `loadVad` and `stopMic` get mechanical setter-to-dispatch swaps, which this document
>   first promised to leave alone.
> - The pending-reopen ref and the `hearing` mirror ref are no longer needed. The
>   pre-reopen value lives in the state, and the reducer's invariant replaces the
>   generation and sequence check in `pauseMic`.
> - How a microphone is opened, paused or stopped is still not changed.
> Changed sections: modules, data shapes, the defect 2 flow, external dependencies and
> load-bearing paths.

## Root cause (two defects, one shared mechanism)

The session page decides "we can't hear you" from two values that are updated in
different renders:

- `hearing` (from `useVAD`) becomes `"starting"` in the event handler for Resume.
- `hearingDeadlinePassed` (page state) is reset only after an effect sees `"starting"`,
  bumps `hearingEpoch`, and a second effect restarts the 10 s timer.

The timer is never cancelled when hearing becomes `"ready"`, so 10 s after the last
attempt `hearingDeadlinePassed` is `true` and stays `true`. That has no visible effect
while hearing is `"ready"`.

**Defect 1, ordinary Resume (reproduced in a browser, 2026-11-17).** Resume more than
10 s after the last attempt → one committed render with `hearing="starting"` and
`hearingDeadlinePassed=true` → `cannotHear` is true → the `role="alert"` element is
inserted, and the effect `if (cannotHear) setShowTextInput(true)` opens the typing bar.
The next render resets the deadline and removes the alert. The typing bar stays open,
because nothing closes it.

**Defect 2, #86.** Resume (reopen pending) → Pause. `pauseMic` makes the reopen stale but
leaves `hearing` at `"starting"`, so the deadline fires during the pause. The next Resume
calls `setHearing("starting")` with no change in value, so no epoch bump, no fresh
deadline, and the alert is already up.

Both defects come from deriving "a new attempt started" from a value change observed in
an effect. The fix makes the attempt an explicit value that changes in the same update as
`hearing`.

## Systems and modules touched

| Module | Load-bearing | Change |
|---|---|---|
| New `apps/frontend/app/lib/hearingState.ts` | no | Pure transition function for the hearing state: `hearing`, `attempt`, `attemptId` and `beforeReopen`, with events for start, loaded, start failed, reopen, reopened, reopen failed, cancel reopen and stop. No React, no I/O. |
| `apps/frontend/hooks/useVAD.ts` | **yes** | Holds the hearing state with `useReducer(hearingTransition)`. Each existing `setHearing`/`setHearingAttempt` call becomes one `dispatch`, in place and under the same guards. `pauseMic` dispatches "cancel reopen". The return value gains `hearingAttemptId`; existing fields are read from the state. |
| New `apps/frontend/hooks/useHearingDeadline.ts` | no | Owns the 10 s deadline, keyed to the attempt identity, so "deadline passed" is false in the first render of a new attempt. Pure React state plus one timer. |
| `apps/frontend/app/session/page.tsx` | no | Replaces the epoch and deadline effects (about 12 lines) with one call to the new hook. The alert, typing-bar and panel logic stay as they are. |
| `apps/frontend/app/lib/sessionDisplay.ts` | no | **Unchanged.** `hearingUnavailable` and `panelState` keep their signatures, so `hearingDisplay.test.ts` is untouched. |

## New data shapes

No endpoint, message, storage or exported API type outside the frontend changes.

`useVAD`'s return value gains one field:

```
hearingAttemptId: number   // changes whenever hearing moves into "starting"; 0 before any attempt
```

All three come from one state value, so they always change together. Existing fields keep
their meaning.

Hearing state (internal to the frontend; signatures are gate 3):

```
{ hearing: Hearing, attempt: "start" | "resume", attemptId: number, beforeReopen: Hearing | null }
invariant: beforeReopen !== null  ⇔  a reopen is in flight and still current
invariant: attemptId changes only on the transitions into "starting" (start, reopen)
``` `hearingAttempt` ("start" | "resume")
is unchanged, so the alert wording logic does not move.

New hook contract (shape only; signatures are gate 3):

```
useHearingDeadline(attemptId: number) -> deadlinePassed: boolean
  - false in the very render where attemptId changes (derived, not reset by an effect)
  - true once HEARING_DEADLINE_MS has elapsed since attemptId last changed
  - the timer for attempt 0 runs from mount, preserving FQ-41's "no gesture" case
```

## End-to-end call flow

**Ordinary Resume (defect 1):**
1. User clicks Resume → page `handleResume` → `useVAD.resumeMic()`.
2. `resumeMic` sets `hearing="starting"`, `hearingAttempt="resume"` and
   `hearingAttemptId+1` in one batch.
3. Render: `useHearingDeadline` sees a new attemptId → `deadlinePassed=false` in this same
   render → `cannotHear=false` → no alert and no typing-bar effect.
4. The new attempt's 10 s timer starts. `vad.start()` resolves → `hearing="ready"`.

**Pause during a pending reopen (defect 2):**
1. Resume as above; `vad.start()` stays pending. The "reopen" transition stores the
   current `hearing` in `beforeReopen` (normally `"ready"`, `"failed"` if a previous reopen
   failed). It is read inside the transition from the current state, so no ref is needed.
2. User clicks Pause → `pauseMic()` dispatches "cancel reopen". If `beforeReopen` is set,
   `hearing` goes back to it and `beforeReopen` is cleared. Otherwise nothing changes. It
   then bumps `resumeSeqRef` as today.
   - Why no generation or sequence check is needed: every path that makes a reopen stale
     also clears `beforeReopen`.
     - Pause dispatches "cancel reopen".
     - `stopMic` dispatches "stop".
     - Settling dispatches "reopened" or "reopen failed", and only while `current()` holds.
     - A newer Resume needs a Pause first.
   - So after `stopMic` → `startMic`, a Pause finds nothing to restore. That is factory-critic
     objection 1, now enforced by the state instead of by a check at the call site.
3. During the pause the deadline may pass, but `hearing` is `"ready"` → no alert. If it was
   `"failed"`, the alert stays as it does today (gate 1 decision 1).
4. The stale `vad.start()` settles later → the existing `current()` guard ignores it, and
   the existing `resumeSeq` guard in `openMic` stops its stream (unchanged).
5. Resume → new attemptId → a fresh 10 s, as in the ordinary flow.

## External dependencies

None added. `@ricky0123/vad-web` behaviour is relied on as today (no new calls). Nothing
relies on React batching: each transition is one `dispatch` of one state value.

## Load-bearing paths involved

- `apps/frontend/hooks/useVAD.ts`. The charter forces `deep` gates and a human read.
  - Changed: the hearing state declaration, `startMic`, `resumeMic`, `pauseMic` and the
    return value. Also the one-line setter-to-dispatch swaps in `loadVad` (three calls) and
    `stopMic` (one call), each in place and under its existing guard.
  - Not touched: `openMic`, the generation and sequence guards, the VAD callbacks,
    `micActive`, `micFallback`, and anything that opens, pauses or stops a microphone
    track.
  - The existing `useVAD*` unit tests and the FQ-41 and FQ-79 e2e suites are the oracle
    that the swaps preserve behaviour. None of them is edited.

No backend load-bearing path is involved.

## What could break elsewhere

| Risk | Why | Mitigation |
|---|---|---|
| FQ-41 "no gesture" warning stops firing | The first deadline must still run from mount when no start ever begins | Attempt 0 timer runs from mount; the existing `e2e/hearing.spec.ts` covers it and must stay green |
| FQ-79 hang warning stops firing | A reopen that really hangs must still warn after 10 s | Existing `e2e/resume.spec.ts` "hangs is reported after 10 s" must stay green |
| Restoring `"ready"` during a pause claims a microphone is live when it is not | `"ready"` while paused already means "voice detection loaded, paused" in today's normal pause; the panel shows paused, not listening | No new meaning; the panel's paused state wins over hearing |
| A stale reopen that resolves later overwrites the restored value | Must stay ignored | Existing `current()` guard; new unit test |
| A restore after `stopMic` → `startMic` brings back a stale `"ready"` over a first start that is still loading, hiding FQ-41's warning (found by factory-critic) | The pre-reopen value could outlive the reopen | `beforeReopen` is cleared by every transition that ends or abandons a reopen ("stop" included), so after `stopMic` there is nothing to restore. Reducer unit test, plus hook test: hanging reopen → `stopMic` → `startMic` → Pause → `hearing` stays `"starting"` |
| Brief "Listening" while pausing a pending reopen | `handlePause` calls `pauseMic()` and awaits `suspend()` before `setIsPaused(true)` (page.tsx:226-232). The panel shows "Listening" for that window instead of "Getting ready…". | Accepted. This is what an ordinary pause already shows today in the same window. Fixing the order in `handlePause` is out of scope. |
| Reconnect and design retry (`stopMic` then `startMic`) get the same fix (found by factory-critic) | `off` → `"starting"` had the same stale-deadline flash after 10 s | Intended side effect of the attempt id. Covered by a `useHearingDeadline` unit test (a new id after an expired deadline is not passed), so a later change cannot quietly undo it. |
| Existing unit tests assert the exact return shape of `useVAD` | Adding a field could break a `toEqual` | Checked: the three `useVAD*.test.ts` files assert individual fields, not the whole object. No existing test file is edited. |
| Typing bar already opened by an earlier real failure | Out of scope: nothing closes it today, and that is intended (the person may want it) | Unchanged |
| Diff size | Charter limit 400 changed lines | Revised at gate 3: about 720 lines in total, so it ships as three slices, each under 400 (see 03-design.md) |

## Alternatives considered

| Option | Fixes defect 1 | Fixes defect 2 | Touches useVAD | Why not chosen |
|---|---|---|---|---|
| Cancel the deadline timer when hearing becomes `"ready"` (page only) | yes | **no**: hearing stays `"starting"` through the pause and the Resume timer is never restarted | no | Leaves #86 itself unfixed |
| Page only: bump the epoch in `handleResume`, derive "passed" from it, and hide `cannotHear` while paused with a resume pending | yes | yes | no | The page would have to copy `useVAD`'s rule for when `resumeMic` really reopens (`useVAD.ts:276`: only a loaded, paused VAD). If the copy drifts, a still-loading first start gets an extra 10 s or a no-op Resume restarts the deadline. Two places would own one fact. |
| **Chosen:** explicit attempt id from `useVAD`, deadline derived from it; `pauseMic` restores a still-current cancelled reopen | yes | yes | yes (small, guarded) | The knowledge of what counts as an attempt stays in the one module that makes attempts |

The load-bearing file is worth touching because only it knows when an attempt starts and
when one was cancelled. The change moves the hearing state into one reducer value and adds one restore transition. It does not touch
how a microphone is opened, paused or stopped.

## Open question for the owner

**A reopen that hangs, is reported after 10 s, and is then paused.** The existing
`e2e/resume.spec.ts` (lines 88-107) does this sequence and does not check the screen during
the pause. Under this design the Pause cancels the hung reopen and restores `"ready"`, so
the warning goes away during the pause. A reopen that *rejected* (`"failed"`) keeps its
warning through the pause (gate 1 decision 1).

- **Proposed: restore (the warning clears on Pause).** The hung reopen is really cancelled
  (its late stream is stopped), so "can't hear" no longer describes anything. A rejection
  is a definite answer from the browser. A hang is not. The person is doing what the
  warning told them to do ("pause and resume to try again"), and the next Resume gets a
  fresh 10 s and reports again if it hangs again.
- Alternative: keep the warning through the pause once it has been shown. That needs
  `useVAD` to know about the page's 10 s deadline, or the page to override the restore,
  which splits one rule across two modules.

## Verification plan (detail in gate 3)

- New unit test file for `useVAD`: Pause during a pending reopen restores the prior
  `hearing` (`"ready"` and `"failed"` cases); a late resolve or reject after that is
  ignored; a hanging reopen → `stopMic` → `startMic` → Pause leaves `"starting"` (no stale
  restore); a double Pause is harmless; every move into `"starting"` changes
  `hearingAttemptId`.
- New unit test file for `useHearingDeadline`: false on the render where the id changes,
  even after an earlier deadline passed (this also covers reconnect and retry); true after
  10 s; attempt 0 runs from mount.
- New e2e spec file: the ordinary Resume more than 10 s in shows no alert at any point (a
  MutationObserver records insertions) and leaves the typing bar closed; the #86 sequence
  shows no alert during the pause and none for 10 s after Resume. The new file copies the
  `getUserMedia` hang harness from `resume.spec.ts`, because that file cannot be edited.
- Existing tests are not modified. Gates: `deep`.

## Factory-critic review (2026-11-17)

Verdict: the root cause is confirmed (the intermediate render commits, and the typing-bar
effect fires in the same flush). The direction is sound. Not ready as first written. All
five objections are addressed above:

1. Stale restore after `stopMic` → `beforeReopen` cleared by "stop" (amendment; data flow
   step 2, risk table).
2. Hung-then-reported reopen → raised as the open question above.
3. Alternatives not weighed → "Alternatives considered".
4. Brief "Listening" while pausing → risk table, accepted.
5. Reconnect and retry also fixed → risk table and test plan.

Gate 3 was asked to merge `hearing`, `hearingAttempt` and the attempt id into one state
value. Done: see the amendment at the top (reducer).

## Rollback

Frontend-only and stateless. Revert the PR. No data or migration.
