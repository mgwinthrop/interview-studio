item: FQ-148
scope: interim page-only fix for FQ-108 D5 (footer Pause during end-dialog settling leaves the screen Paused over a listening microphone), ahead of the FQ-108 phase 2 fix
gate_1_product: pending
gate_2_architecture: not-started
gate_3_design: not-started
gate_4_slices: not-started
slices_completed: 0 / ?
depends_on:
  - "PR #144 (FQ-108 S7) merged: e2e/end-settling-pause.spec.ts is the test this fix flips"
decisions: []
open_questions:
  - "Gate 1: option A (honour the Pause), B (ignore it, as End Session does) or C (disable it during the moment); owner"
