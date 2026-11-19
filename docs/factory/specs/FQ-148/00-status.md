item: FQ-148
scope: interim page-only fix for FQ-108 D5 (footer Pause during end-dialog settling leaves the screen Paused over a listening microphone), ahead of the FQ-108 phase 2 fix
gate_1_product: approved 2026-11-19 (owner, interactive): option A, honour the Pause
gate_2_architecture: pending
gate_3_design: not-started
gate_4_slices: not-started
slices_completed: 0 / ?
depends_on:
  - "PR #144 (FQ-108 S7) merged 2026-11-19: e2e/end-settling-pause.spec.ts is the test this fix flips"
decisions:
  - "Gate 1: honour the Pause. The last press wins and Paused means the microphone is off; not B (ignore) or C (disable) (owner, 2026-11-19)"
open_questions:
  - "Gate 2: approve 02-architecture.md; owner"
