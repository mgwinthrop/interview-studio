item: FQ-52
scope: delivery numbers across sessions on the History page, filterable by interviewer, with no scores, targets or AI commentary
kind: user-facing
gate_1_product: approved 2026-11-25
gate_2_architecture: approved 2026-11-25
gate_3_design: pending
gate_4_slices: not-started
slices_completed: 0 / ?
decisions:
  - "Gate 1 D1 (owner, 2026-11-25): four numbers - pace, typical gap before answering, longest pause, typical answer length. Filler counts appear only when REPORT_FILLER_COUNTS is on, as in reports."
  - "Gate 1 D2 (owner, 2026-11-25): one point per session, using that session's median."
  - "Gate 1 D3 (owner, 2026-11-25): the view opens on all interviewers, with a filter to narrow to one."
  - "Gate 2 Q1 (owner, 2026-11-25): option B - each session's point is the median of its per-answer figures, for all four numbers"
  - "Gate 2 Q2 (owner, 2026-11-25): source the trend from each report's stored delivery.summary, not a recomputation from turns"
  - "Gate 1 success measure reworded (owner, 2026-11-25) to match Q1 and the mock's unmeasurable pace"
open_questions:
  - "Gate 2 approval of 02-architecture.md as revised; owner"
