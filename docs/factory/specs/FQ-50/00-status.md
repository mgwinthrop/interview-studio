item: FQ-50
scope: render the conversation inside the report; question text on each "Answer by answer" card; strength quotes link to their answer; keep the download
kind: user-facing
gate_1_product: approved 2026-11-19 (owner, interactive)
gate_2_architecture: approved 2026-11-19 (owner, interactive), with the mock-quote test recommendation (revisited at gate 3 D1)
gate_3_design: approved 2026-11-19 (owner, interactive)
gate_4_slices: approved 2026-11-19 (owner, interactive): S0 #151 (ready-to-implement), S1 #152 (waits on #151), S2 #153 (waits on #152)
slices_completed: 0 / 3
unblocks:
  - "#51 (practise this / redo this answer) builds on these answer cards"
decisions:
  - "Gate 1 D1: answers are always shown in full in the Transcript tab (owner, 2026-11-19)"
  - "Gate 1 D2: quote links and 'Read answer' open the answer in the Transcript tab, highlighted (owner, 2026-11-19)"
  - "Gate 2: new GET /api/session/:id/turns with server-side answer numbers; delivery numbers joined from the report; strict quote matching (owner, 2026-11-19)"
  - "Gate 3 D1: quote links are tested end to end with a stubbed report (page.route), not by changing the mock profile (providers/** is load-bearing, and every mock answer is 'hello there', so matches would tie). This reverses the gate 2 recommendation (owner, 2026-11-19)"
  - "Gate 4: each slice adds its own new test files, so later slices never modify an earlier slice's tests and can run unattended (owner, 2026-11-19)"
open_questions: []
