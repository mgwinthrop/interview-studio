item: FQ-40
scope: the session records from the microphone chosen in the mic check; a missing choice is never silent
gate_1_product: approved 2026-11-14 (owner)
gate_2_architecture: approved 2026-11-14 (owner; revision 2 after factory-critic)
gate_3_design: waived by owner 2026-11-14 (one interactive PR)
gate_4_slices: waived by owner 2026-11-14 (single slice, issue #40)
slices_completed: 1 / 1 (PR #81 merged 2026-11-14T19:56:46Z); owner exception for 583 changed lines recorded on #40; #80 filed for factory-tune
decisions:
  - Choice remembered in this browser until changed (owner, gate 1)
  - Missing mic - use the default and show a one-line notice (owner, gate 1)
  - A - resumeStream reopens the same device with the first-open settings (owner, gate 2; re-confirmed on corrected facts - only the device changes)
  - B - store the microphone's label so the notice can name it (owner, gate 2)
  - C - revised by owner during implementation: match by id, then by name, then fall back with a notice (device ids rotated on every page load in the test browser)
  - D - silent failed resume: out of scope, filed as #79 (owner, gate 2)
open_questions: []
evidence:
  - The mic check opens getUserMedia with deviceId exact; the session's useVAD getStream opens audio with no deviceId; nothing stores the choice (confirmed in code, triage 2026-11-14)
related: "#55 one-time mic check (will rely on the remembered choice), #41/PR #77 (hearing state: a mic that fails to open now shows the can't-hear-you message), #49 mic level indicator"
