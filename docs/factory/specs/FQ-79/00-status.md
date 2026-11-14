item: FQ-79
scope: a microphone that fails to reopen after Pause is never silent; the person is told, can type, and can retry with Pause/Resume
gate_1_product: pending
gate_2_architecture: not-started
gate_3_design: not-started
gate_4_slices: not-started
slices_completed: 0 / ?
open_questions:
  - Message wording (owner)
  - Where the person lands - running with typing open (proposed) or back on the paused screen (owner)
evidence:
  - Reproduced 2026-11-14 on main after PR #81 - getUserMedia made to fail with NotReadableError during a pause; 12 s after Resume the panel said Listening, data-hearing was ready, no message. A second Pause/Resume after the microphone came back appeared to recover.
  - Filed from the FQ-40 spec (decision D, owner chose to keep it out of FQ-40)
related: "FQ-41/PR #77 (hearing state and can't-hear-you message), FQ-40/PR #81 (openMic used for resume)"
