item: FQ-50
scope: render the conversation inside the report; question text on each "Answer by answer" card; strength quotes link to their answer; keep the download
kind: user-facing
gate_1_product: approved 2026-11-19 (owner, interactive)
gate_2_architecture: pending
gate_3_design: not-started
gate_4_slices: not-started
slices_completed: 0 / ?
unblocks:
  - "#51 (practise this / redo this answer) builds on these answer cards"
decisions:
  - "Gate 1 D1: answers are always shown in full in the Transcript tab (owner, 2026-11-19)"
  - "Gate 1 D2: quote links and 'Read answer' open the answer in the Transcript tab, highlighted (owner, 2026-11-19)"
open_questions:
  - "Gate 2: approve 02-architecture.md (new GET /api/session/:id/turns with server-side answer numbers; numbers joined from the report; exact-after-normalising quote matching); owner"
