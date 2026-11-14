item: FQ-40
scope: the session records from the microphone chosen in the mic check; a missing choice is never silent
gate_1_product: pending
gate_2_architecture: not-started
gate_3_design: not-started
gate_4_slices: not-started
slices_completed: 0 / ?
open_questions:
  - How long the choice lasts - this browser until changed (proposed) or this tab only (owner)
  - A missing microphone - fall back with a notice (proposed) or send back to the mic check (owner)
evidence:
  - The mic check opens getUserMedia with deviceId exact; the session's useVAD getStream opens audio with no deviceId; nothing stores the choice (confirmed in code, triage 2026-11-14)
related: "#55 one-time mic check (will rely on the remembered choice), #41/PR #77 (hearing state: a mic that fails to open now shows the can't-hear-you message), #49 mic level indicator"
