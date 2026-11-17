item: FQ-86
scope: a Pause that cancels a pending microphone reopen leaves no stale "starting" state; every Resume gets a fresh 10 s before the hearing warning
depends_on: PR #83 (FQ-79), merged
gate_1_product: approved 2026-11-17 (owner, interactive)
gate_2_architecture: pending
gate_3_design: not-started
gate_4_slices: not-started
slices_completed: 0 / ?
decisions:
  - Q1 option A - clear only the reopen the pause cancelled; a failure that already happened before the pause stays reported (owner, gate 1)
open_questions: []
