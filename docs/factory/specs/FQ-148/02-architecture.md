# FQ-148 - Gate 2: architecture

## What this touches

| Module | Role here | Load-bearing? |
|---|---|---|
| `apps/frontend/app/session/page.tsx` | The end-confirm flow (`handleEndClick`, `handleEndDialogClose`) and the Pause/Resume handlers (`handlePause`, `handleResume`). The whole fix is here. | No ("Not protected" in FQ-108 `02-architecture.md` §1) |
| `apps/frontend/e2e/end-settling-pause.spec.ts` | Its D5 block records today's defect; the fix flips it. | No, but it is an **existing test file**: interactive session, owner approval, draft PR, human read |
| `hooks/useVAD.ts` (`pauseMic`, `resumeMic`) | Called as today, in a different order. **Not edited.** | Yes, so editing it is out of scope |

No new endpoints, data structures, WebSocket messages or dependencies. Nothing on the
server changes.

## Today's call flow (the defect)

1. End Session → `handleEndClick`: `pausedByEndDialogRef = true`; the dialog's pause starts
   (`handlePause`: `pauseMic()`, then `await suspend`).
2. Escape → `handleEndDialogClose`: `await` the dialog's pause …
3. … meanwhile the footer Pause → second `handlePause`: `pauseMic()`, then `await suspend`.
4. The dialog's pause settles → the close continues: `handleResume` → `resumeMic()`
   (**the mic is back on**) → `setIsPaused(false)` → `setConfirmingEnd(false)`.
5. The footer's pause settles → `setIsPaused(true)`. The screen says Paused, but nothing
   pauses the mic again.

## Proposed flow (honour the Pause)

The footer Pause, pressed while the end flow is settling, becomes a **request that the close
must not resume**:

1. As today.
2. As today.
3. The footer Pause, while `confirmingEnd` is true, records that the person asked to pause
   (a page-level ref), then runs `handlePause` as today.
4. The close checks that request after its `await`. If set, it **skips the resume** and
   clears the request. The session stays paused: `pauseMic` has run and nothing calls
   `resumeMic`.
5. The footer's pause settles → `setIsPaused(true)`. The screen and the mic agree: Paused,
   mic off.

The rule generalises the existing one: the close resumes only a pause the dialog made
**and** nobody asked to keep. "Last press wins" holds, because a Pause after Escape is
later than the Escape.

## Why not the alternatives

- **Re-assert `pauseMic()` at the end of `handlePause` when `isPaused` is about to become
  true.** It would close the mic, but the close would still have run `resumeMic` and
  `audioQueue.resume()`. The audio and mic would flip on and back off, and the order still
  depends on timing. Kept as an optional second safeguard for gate 3 to decide, not as the
  fix.
- **Gate the audio send on `isPaused`** (drop frames in `sendMessageWithFlush` while
  paused). Strong second safeguard for the privacy promise, but it changes what a "paused"
  session does with frames in every path. That belongs in FQ-108 phase 2's pause region,
  not an interim fix.

## What could break

| Risk | Guarded by |
|---|---|
| The ordinary Escape and Keep talking resume stops working | `end-confirm.spec.ts` (Escape and Keep talking resume and focus), the `end-confirm-dismiss` golden |
| End Session during settling (FQ-98) | `end-confirm-settling.spec.ts`, unchanged |
| The slow-suspend Escape race (FQ-47 fix) | `end-confirm.spec.ts` "slow suspend Escape race" |
| Focus after the flow settles: it should land on the pause screen's Resume, as for any paused session | The D5 block already asserts Resume is focused; it must stay |
| An ordinary footer Pause outside the end flow | The baseline test in `end-settling-pause.spec.ts`, the `pause-resume` golden |
| FQ-108 phase 2 later drops the guarantee | The D5 row in FQ-108 `02-architecture.md` §6 now states the invariant; the flipped D5 test pins it |

## Oracle

Not a migration, but the oracle already exists: PR #144's spec (D5 block plus baseline), the
FQ-98 and FQ-47 e2e specs, and the five goldens. The fix passes when the D5 block,
flipped to **Paused with 0 live tracks**, passes and every other test and golden is
unchanged.

## Load-bearing paths

None edited. `useVAD.ts` is called in a different order but not changed. No
`factory-critic` run is required; it can be run on request.
