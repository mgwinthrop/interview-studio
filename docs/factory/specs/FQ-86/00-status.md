item: FQ-86
scope: a Pause that cancels a pending microphone reopen leaves no stale "starting" state; every Resume gets a fresh 10 s before the hearing warning
depends_on: PR #83 (FQ-79), merged
gate_1_product: approved 2026-11-17 (owner, interactive); amended 2026-11-17 to cover every Resume (owner, option A)
gate_2_architecture: approved 2026-11-17 (owner, interactive; revision 2 after factory-critic); amended 2026-11-17 for the reducer (owner)
gate_3_design: pending (revision 2, reducer)
gate_4_slices: not-started
slices_completed: 0 / ?
decisions:
  - Q1 option A - clear only the reopen the pause cancelled; a failure that already happened before the pause stays reported (owner, gate 1)
  - Gate 1 amendment option A - widen scope to the ordinary Pause/Resume flash (reproduced in a browser), not a separate issue (owner)
  - Hung reopen already reported, then Pause - restore and clear the warning; a rejected reopen keeps its warning (owner, gate 2)
  - Hearing state is one reducer value (app/lib/hearingState.ts), not three parallel useState values; amends gate 2 to swap setters in loadVad and stopMic (owner, gate 3)
open_questions: []
