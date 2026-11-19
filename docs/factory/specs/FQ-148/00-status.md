item: FQ-148
scope: interim page-only fix for FQ-108 D5 (footer Pause during end-dialog settling leaves the screen Paused over a listening microphone), ahead of the FQ-108 phase 2 fix
gate_1_product: approved 2026-11-19 (owner, interactive): option A, honour the Pause
gate_2_architecture: approved 2026-11-19 (owner, interactive)
gate_3_design: approved 2026-11-19 (owner, interactive), including modifying e2e/end-settling-pause.spec.ts
gate_4_slices: approved 2026-11-19 (owner: "approve gate 3 and implement the slice", referring to the one-slice preview in 03-design.md); one slice on #148
slices_completed: 1 / 1 (S0: draft PR #150; owner decided to ship it, awaiting merge)
depends_on:
  - "PR #144 (FQ-108 S7) merged 2026-11-19: e2e/end-settling-pause.spec.ts is the test this fix flips"
decisions:
  - "Gate 1: honour the Pause. The last press wins and Paused means the microphone is off; not B (ignore) or C (disable) (owner, 2026-11-19)"
  - "Gate 2: the close skips its resume when the footer Pause was pressed during settling. page.tsx only; no second safeguard in this item (owner, 2026-11-19)"
  - "Ship PR #150 with the verifier's residual: a footer Pause during settling, then a Resume before that pause's own suspend finishes, still ends Paused with the mic live (window at most one suspend). Left to FQ-108 phase 2 and recorded in its §6 D5 row (owner, 2026-11-19)"
open_questions: []
