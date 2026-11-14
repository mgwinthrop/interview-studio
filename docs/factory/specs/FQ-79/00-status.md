item: FQ-79
scope: a microphone that fails to reopen after Pause is never silent; the person is told, can type, and can retry with Pause/Resume
gate_1_product: approved 2026-11-14 (owner)
gate_2_architecture: approved 2026-11-14 (owner, before the factory-critic review returned; its findings are folded in before the PR)
gate_3_design: waived by owner 2026-11-14 (one interactive PR)
gate_4_slices: waived by owner 2026-11-14 (single slice, issue #79)
slices_completed: 0 / 1
decisions:
  - Message wording as proposed (owner, gate 1)
  - The person lands in the running session with typing open (owner, gate 1)
  - A - a no-op resume after a failed reopen keeps 'failed' (tracked with a ref) (owner, gate 2)
open_questions: []
evidence:
  - Reproduced 2026-11-14 on main after PR #81 - getUserMedia made to fail with NotReadableError during a pause; 12 s after Resume the panel said Listening, data-hearing was ready, no message. A second Pause/Resume after the microphone came back appeared to recover.
  - Filed from the FQ-40 spec (decision D, owner chose to keep it out of FQ-40)
related: "FQ-41/PR #77 (hearing state and can't-hear-you message), FQ-40/PR #81 (openMic used for resume)"
