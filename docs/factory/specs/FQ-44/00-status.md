item: FQ-44
scope: per-interviewer display name; session panel shows it; transcript "speaking" label follows real playback
supersedes: PR #64 (closed unmerged 2026-11-14 at owner's direction)
gate_1_product: approved 2026-11-14 (owner, interactive)
gate_2_architecture: approved 2026-11-14 (owner, interactive; revision 2 after factory-critic)
gate_3_design: approved 2026-11-14 (owner, interactive)
gate_4_slices: approved 2026-11-14 (owner); queued as #65 #66 #67 #68
slices_completed: 4 / 4 (PRs #70, #71, #72, #73 merged 2026-11-14)
decisions:
  - Presets use role names - Curious newcomer, Practice interviewer, Story listener, Thinking partner (owner, gate 1)
  - Fallback for a missing display name is "Interviewer" (owner, gate 1)
  - PR #64 closed unmerged and superseded (owner, gate 1)
  - User turns become "You" / "Y" (owner, gate 2 A)
  - Hidden designer preset gets display name "Design partner" (owner, gate 2 B)
  - Approved: one edit to the INTERVIEWER_LIMITS assertion in apps/backend/src/__tests__/interviewerSchema.test.ts; that slice is a draft PR with a human read (owner, gate 2 C)
  - Rollback is roll-forward only (owner, gate 2 D)
  - Panel tagline is the interviewer's purpose, clamped to 3 lines (owner, gate 3)
  - Transcript speaking badge and label follow the panel's displayed state, including buffered playback (owner, gate 3)
open_questions: []
related: "#58 avatar and voice per interviewer (builds on display name), #45 vocabulary (panel heading absorbed here), #43 transcript dimming (untouched)"
