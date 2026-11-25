item: FQ-52
scope: delivery numbers across sessions on the History page, filterable by interviewer, with no scores, targets or AI commentary
kind: user-facing
gate_1_product: approved 2026-11-25
gate_2_architecture: pending
gate_3_design: not-started
gate_4_slices: not-started
slices_completed: 0 / ?
decisions:
  - "Gate 1 D1 (owner, 2026-11-25): four numbers - pace, typical gap before answering, longest pause, typical answer length. Filler counts appear only when REPORT_FILLER_COUNTS is on, as in reports."
  - "Gate 1 D2 (owner, 2026-11-25): one point per session, using that session's median."
  - "Gate 1 D3 (owner, 2026-11-25): the view opens on all interviewers, with a filter to narrow to one."
open_questions:
  - "Gate 2 Q1 (revisits D1/D2): per-session point for pace and longest pause - B median of per-answer figures (recommended), A report headline figure, or C B without longest pause; owner"
  - "Gate 2 Q2: source the trend from each report's stored delivery.summary rather than recomputing from turns (recommended); owner"
  - "Gate 1 wording: success measure to be aligned with Q1 and with mock pace being unmeasurable; owner"
