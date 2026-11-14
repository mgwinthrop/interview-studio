item: FQ-40
scope: the session records from the microphone chosen in the mic check; a missing choice is never silent
gate_1_product: approved 2026-11-14 (owner)
gate_2_architecture: pending (revision 2 after factory-critic 'needs changes first')
gate_3_design: not-started
gate_4_slices: not-started
slices_completed: 0 / ?
decisions:
  - Choice remembered in this browser until changed (owner, gate 1)
  - Missing mic - use the default and show a one-line notice (owner, gate 1)
  - A - resumeStream reopens the same device with the first-open settings (owner, gate 2; given on revision 1's wrong framing of automatic gain, re-confirmation requested)
  - B - store the microphone's label so the notice can name it (owner, gate 2)
open_questions:
  - Re-confirm A on corrected facts; decide C (unstable ids) and D (silent failed resume); approve gate 2 revision 2 (owner)
evidence:
  - The mic check opens getUserMedia with deviceId exact; the session's useVAD getStream opens audio with no deviceId; nothing stores the choice (confirmed in code, triage 2026-11-14)
related: "#55 one-time mic check (will rely on the remembered choice), #41/PR #77 (hearing state: a mic that fails to open now shows the can't-hear-you message), #49 mic level indicator"
