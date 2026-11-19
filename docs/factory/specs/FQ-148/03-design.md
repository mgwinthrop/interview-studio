# FQ-148 - Gate 3: program design

## Files

| File | Change |
|---|---|
| `apps/frontend/app/session/page.tsx` | Modified: one ref, one footer handler, one branch in `handleEndDialogClose`, one reset in `handleEndClick` |
| `apps/frontend/e2e/end-settling-pause.spec.ts` | **Existing test, modified with owner approval**: the D5 block flips, and one recovery test is added to it |

No other file. `hooks/useVAD.ts` (load-bearing) is not edited.

## Contracts (no implementations)

```ts
// page.tsx, beside pausedByEndDialogRef
/** Set when the person presses the footer Pause while the end flow is settling (FQ-148).
 *  The close then keeps the session paused instead of resuming it. Cleared by the close
 *  and by handleEndClick. */
const keepPausedAfterEndFlowRef: React.MutableRefObject<boolean>;

/** The footer's Pause. Outside the end flow it is exactly handlePause. While the end flow
 *  is settling (confirmingEnd true, dialog closed) it also asks the close not to resume.
 *  Never rejects differently from handlePause. */
function handleFooterPause(): Promise<void>;

/** Unchanged signature. New rule: after awaiting the dialog's pause, it resumes only if
 *  keepPausedAfterEndFlowRef is false; it clears the ref either way. confirmingEnd still
 *  becomes false in finally. */
async function handleEndDialogClose(): Promise<void>;
```

The footer's `onPause` prop changes from `handlePause` to `handleFooterPause`.
The pause screen's Resume, the footer's Resume and the dialog's own pause keep using
`handlePause` and `handleResume` unchanged. Session-history events are unchanged: the
footer press still records `ui:pause` through `handlePause`.

## Call stack: the D5 sequence after the fix

```
End Session click
  handleEndClick: keepPausedAfterEndFlowRef = false; pausedByEndDialogRef = true;
                  endDialogPauseRef = handlePause()    // pauseMic, await suspend
Escape
  handleEndDialogClose: await endDialogPauseRef …
Footer Pause (still settling: isPaused false, confirmingEnd true)
  handleFooterPause: keepPausedAfterEndFlowRef = true; handlePause()  // pauseMic no-op, await suspend
… dialog pause settles: setIsPaused(true)
  handleEndDialogClose continues: keepPaused → skip handleResume; clear ref
  finally: setConfirmingEnd(false)
… footer pause settles: setIsPaused(true) (already true)
Render: Paused, pause screen shown; end-focus effect focuses its Resume.
Mic: paused since step 1, never resumed → 0 live tracks.
```

## Tests and what each proves

All in `e2e/end-settling-pause.spec.ts`. The modification needs owner approval, a draft PR and
a human read.

| Test | Change | Proves |
|---|---|---|
| Baseline: an ordinary footer Pause leaves 0 live tracks | Unchanged | The footer handler is still a plain Pause outside the end flow |
| D5 block: footer Pause during settling | **Flipped.** Renamed to say D5 is fixed by FQ-148. It asserts Paused, pause screen, Resume focused, **0 live tracks**, frames `["session_start"]` | The product rule: Paused means the mic is off; the last press wins |
| New, same block: Resume after the D5 sequence | Added | The kept pause is an ordinary pause: Resume gives Listening, 1 live track and no warning. Nothing is left stuck in the end flow (End Session opens the dialog again) |

Unchanged, and must stay green: `end-confirm.spec.ts` (Escape and Keep talking resume,
the slow-suspend Escape race, a pre-paused session staying paused),
`end-confirm-settling.spec.ts` (FQ-98), and all five goldens with no re-record.

**Negative proof:** reverting only the `page.tsx` hunk makes the flipped D5 test fail (1 live
track and not 0). The verifier runs this with `prove-test.sh`.

## The three decisions I am least confident about

1. **Asking the close not to resume, rather than ordering the two pauses.** The fix relies on
   the close reading the ref after its `await`. That is safe because the footer Pause can
   only be pressed while `isPaused` is false, which is before the dialog's pause settles,
   so before the close reads the ref. If a future change lets `isPaused` flip earlier (FQ-108
   phase 2 models `pausing → paused`), the window moves. Mitigation: the D5 invariant in
   FQ-108 §6 and the flipped test pin the outcome, not the mechanism.
2. **No second safeguard.** Re-asserting `pauseMic()` at the end of `handlePause`, or
   dropping audio frames while paused, would also protect against orderings this spec has
   not thought of. Both are left out: the first flickers the mic, and the second changes
   every paused path. If the owner wants one for the privacy promise, the frame drop
   belongs in FQ-108 phase 2's pause region.
3. **Modifying the existing D5 test instead of adding a new spec.** FQ-108 policy says a D
   item's recorded block flips in the slice that changes it, so the record and the fix
   stay together. The cost is that this slice cannot run unattended (charter test rule).
   That cost is accepted.

## Slices (preview for gate 4)

One slice. A tracer is unnecessary for a one-function change whose oracle already exists.
It is interactive (an existing test is modified) at `full` gates, about 40 lines.
