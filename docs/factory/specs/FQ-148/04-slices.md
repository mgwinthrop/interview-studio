# FQ-148 - Gate 4: slices

One slice, tracked on #148 itself. A tracer is unnecessary: the change is one function in one
file, and its oracle (PR #144's spec, the FQ-47 and FQ-98 specs, the goldens) already exists.

### S0 - Honour a footer Pause during end-dialog settling (full, interactive)
- **Issue:** #148 (`kind:user-facing`)
- **Files:** modified `apps/frontend/app/session/page.tsx`. Modified, with owner approval,
  `apps/frontend/e2e/end-settling-pause.spec.ts` (existing test).
- **Load-bearing:** no. Not unattended: it modifies an existing test, so it is a draft PR
  with a human read.
- **Estimate:** about 40 lines.
- **done_when:**
  - The D5 block of `e2e/end-settling-pause.spec.ts` asserts the fixed state (Paused, pause
    screen shown, its Resume focused, 0 live tracks, client frames `["session_start"]`). It
    fails on main and passes with the change.
  - A new recovery test in that block passes: after the D5 sequence, Resume gives Listening
    with 1 live track and no warning, and End Session opens the dialog again.
  - The baseline test, `end-confirm.spec.ts`, `end-confirm-settling.spec.ts` and all five
    goldens pass unchanged, with no golden re-recorded.
  - `useVAD.ts` is not edited.
  - `--repeat-each=10` on the modified spec passes.
  - Full gates are GREEN.
- **Confidence:** high.
