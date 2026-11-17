item: FQ-86
scope: a Pause that cancels a pending microphone reopen leaves no stale "starting" state; every Resume gets a fresh 10 s before the hearing warning
depends_on: PR #83 (FQ-79), merged
gate_1_product: pending
gate_2_architecture: not-started
gate_3_design: not-started
gate_4_slices: not-started
slices_completed: 0 / ?
open_questions:
  - Q1 scope of the pause rule - clear only a reopen the pause cancelled (proposed) vs. no hearing warning at all while paused (owner)
