item: FQ-50
scope: render the conversation inside the report; question text on each "Answer by answer" card; strength quotes link to their answer; keep the download
kind: user-facing
gate_1_product: approved 2026-11-19 (owner, interactive)
gate_2_architecture: approved 2026-11-19 (owner, interactive), with the mock-quote test recommendation (revisited at gate 3 D1)
gate_3_design: pending
gate_4_slices: not-started
slices_completed: 0 / ?
unblocks:
  - "#51 (practise this / redo this answer) builds on these answer cards"
decisions:
  - "Gate 1 D1: answers are always shown in full in the Transcript tab (owner, 2026-11-19)"
  - "Gate 1 D2: quote links and 'Read answer' open the answer in the Transcript tab, highlighted (owner, 2026-11-19)"
  - "Gate 2: new GET /api/session/:id/turns with server-side answer numbers; delivery numbers joined from the report; strict quote matching (owner, 2026-11-19)"
open_questions:
  - "Gate 3 D1: test quote links with a stubbed report (recommended) instead of changing the mock profile, which is load-bearing (providers/**) and would tie on 'hello there'; reverses the gate 2 recommendation; owner"
  - "Gate 3: approve 03-design.md; owner"
