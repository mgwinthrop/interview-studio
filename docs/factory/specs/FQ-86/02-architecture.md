# FQ-86 Gate 2 - Architecture

Frontend only. No backend, protocol, database, dependency or wording change.

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
| `apps/frontend/hooks/useVAD.ts` | **yes** | (a) Expose an attempt identity that changes in the same state update as every move into `"starting"` (start or reopen). (b) When `pauseMic` makes a pending reopen stale, put `hearing` back to the value it had before that reopen. |
| New `apps/frontend/hooks/useHearingDeadline.ts` | no | Owns the 10 s deadline, keyed to the attempt identity, so "deadline passed" is false in the first render of a new attempt. Pure React state plus one timer. |
| `apps/frontend/app/session/page.tsx` | no | Replaces the epoch and deadline effects (about 12 lines) with one call to the new hook. The alert, typing-bar and panel logic stay as they are. |
| `apps/frontend/app/lib/sessionDisplay.ts` | no | **Unchanged.** `hearingUnavailable` and `panelState` keep their signatures, so `hearingDisplay.test.ts` is untouched. |

## New data shapes

No endpoint, message, storage or exported API type outside the frontend changes.

`useVAD`'s return value gains one field:

```
hearingAttemptId: number   // changes whenever hearing moves into "starting"; 0 before any attempt
```

It is added alongside the existing `hearing` and `hearingAttempt` and set in the same
batched update. Existing fields keep their meaning. `hearingAttempt` ("start" | "resume")
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
1. Resume as above; `vad.start()` stays pending. `useVAD` remembers the pre-reopen
   `hearing` value (normally `"ready"`, `"failed"` if a previous reopen failed).
2. User clicks Pause → `pauseMic()` bumps `resumeSeqRef` (as today) and, because a reopen
   was pending, sets `hearing` back to the remembered value.
3. During the pause the deadline may pass, but `hearing` is `"ready"` → no alert. If it was
   `"failed"`, the alert stays as it does today (gate 1 decision 1).
4. The stale `vad.start()` settles later → the existing `current()` guard ignores it, and
   the existing `resumeSeq` guard in `openMic` stops its stream (unchanged).
5. Resume → new attemptId → a fresh 10 s, as in the ordinary flow.

## External dependencies

None added. `@ricky0123/vad-web` behaviour is relied on as today (no new calls). React 18
batching of `setState` calls inside one event handler is relied on for step 2 of the
ordinary flow. [Likely] This holds for both event handlers and promise callbacks in React
18's automatic batching. Gate 3 will make it independent of batching by holding `hearing`
and the attempt in one state value if that is no larger.

## Load-bearing paths involved

- `apps/frontend/hooks/useVAD.ts`. The charter forces `deep` gates and a human read.
  The change is confined to `pauseMic`, `resumeMic`, `startMic` and the return value.
  `openMic`, `loadVad`, `stopMic`, the generation and sequence guards, the VAD callbacks,
  and anything that opens, pauses or stops a microphone track are not touched.

No backend load-bearing path is involved.

## What could break elsewhere

| Risk | Why | Mitigation |
|---|---|---|
| FQ-41 "no gesture" warning stops firing | The first deadline must still run from mount when no start ever begins | Attempt 0 timer runs from mount; the existing `e2e/hearing.spec.ts` covers it and must stay green |
| FQ-79 hang warning stops firing | A reopen that really hangs must still warn after 10 s | Existing `e2e/resume.spec.ts` "hangs is reported after 10 s" must stay green |
| Restoring `"ready"` during a pause claims a microphone is live when it is not | `"ready"` while paused already means "voice detection loaded, paused" in today's normal pause; the panel shows paused, not listening | No new meaning; the panel's paused state wins over hearing |
| A stale reopen that resolves later overwrites the restored value | Must stay ignored | Existing `current()` guard; new unit test |
| Existing unit tests assert the exact return shape of `useVAD` | Adding a field could break a `toEqual` | Checked: the three `useVAD*.test.ts` files assert individual fields, not the whole object. No existing test file is edited. |
| Typing bar already opened by an earlier real failure | Out of scope: nothing closes it today, and that is intended (the person may want it) | Unchanged |
| Diff size | Charter limit 400 changed lines | Estimate: about 40 production lines and 150 to 250 test lines |

## Verification plan (detail in gate 3)

- New unit test file for `useVAD`: Pause during a pending reopen restores the prior
  `hearing` (`"ready"` and `"failed"` cases); a late resolve after that is ignored; every
  move into `"starting"` changes `hearingAttemptId`.
- New unit test file for `useHearingDeadline`: false on the render where the id changes,
  even after an earlier deadline passed; true after 10 s; attempt 0 runs from mount.
- New e2e spec file: the ordinary Resume more than 10 s in shows no alert at any point (a
  MutationObserver records insertions) and leaves the typing bar closed; the #86 sequence
  shows no alert during the pause and none for 10 s after Resume.
- Existing tests are not modified. Gates: `deep`.

## Rollback

Frontend-only and stateless. Revert the PR. No data or migration.
