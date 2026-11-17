item: FQ-108
scope: architecture review of the client session runtime (app/session/, hooks/useVAD.ts, app/hooks/useWebSocket.ts, lib/audioQueue.ts, display helpers); backend and WebSocket protocol are fixed external contracts
kind: architecture review leading to a migration plan (spec skill migration rule applies: name the oracle first)
gate_1_product: not-started
gate_2_architecture: not-started
gate_3_design: not-started
gate_4_slices: not-started
slices_completed: 0 / ?
evidence:
  - evidence/state-inventory.md - state inventory, sync effects, control flows, implicit state machines, defect-to-mechanism map, test coverage (delegated read-only agent, 2026-11-17; spot-checked)
decisions:
  - Scope is the client session runtime only (owner, 2026-11-17)
  - Ship #107 (page-only interim fix for the ordinary-Resume flash) while the review runs (owner, 2026-11-17)
  - #86 (FQ-86) paused at gate 3; its reducer design is input, not an approved plan (owner, 2026-11-17)
candidate_absorbs: "#86, #48, #49, #55"
latent_defects_found_by_inventory:
  - reconnect after the socket already closed leaves deliberateCloseRef true, so the new socket's next clean server close is swallowed silently (confirmed by reading useWebSocket.ts:79-83, 251-266; not browser-verified)
  - reconnect ("Start over") resets only the WebSocket hook; page state, VAD/hearing and the audio queue are not reset [inference]
  - end dialog unmounted by a disconnect leaves confirmingEnd true, so End session does nothing after Start over [inference]
  - no tests for interrupt, turn_timing, AudioQueue, useWebSocket, disconnect/reconnect, session_failed, stt_error, design and try modes
  - CLAUDE.md says Next.js 14; package.json is Next 16 / React 19 (owner to correct; agents do not edit CLAUDE.md)
open_questions: []
