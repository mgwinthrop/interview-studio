item: FQ-108
scope: architecture review of the client session runtime (app/session/, hooks/useVAD.ts, app/hooks/useWebSocket.ts, lib/audioQueue.ts, display helpers); backend and WebSocket protocol are fixed external contracts
kind: architecture review leading to a migration plan (spec skill migration rule applies: name the oracle first)
gate_1_product: pending
gate_2_architecture: not-started
gate_3_design: not-started
gate_4_slices: not-started
slices_completed: 0 / ?
evidence:
  - evidence/state-inventory.md - state inventory, sync effects, control flows, implicit state machines, defect-to-mechanism map, test coverage (delegated read-only agent, 2026-11-17; spot-checked)
decisions:
  - Scope is the client session runtime only (owner, 2026-11-17)
  - Ship #107 (page-only interim fix for the ordinary-Resume flash) while the review runs (owner, 2026-11-17); PR #109
  - #86 (FQ-86) paused at gate 3; its reducer design is input, not an approved plan (owner, 2026-11-17)
  - File the reconnect defect now as a standalone fix (owner, 2026-11-17); #110, ready-to-implement
  - Design for #48 and #49; success = one traceable place for session state changes, no state kept in step by effects, every runtime path tested before migration (owner, 2026-11-17; expressed in product terms in 01-product.md)
candidate_absorbs: "#86, #48, #49"
latent_defects_found_by_inventory:
  - "#110: after Start over, the next clean server close is swallowed (confirmed by reading useWebSocket.ts and page.tsx; every Start over is affected)"
  - reconnect ("Start over") resets only the WebSocket hook; page state, VAD/hearing and the audio queue are not reset [inference]
  - end dialog unmounted by a disconnect leaves confirmingEnd true, so End session does nothing after Start over [inference]
  - no tests for interrupt, turn_timing, AudioQueue, useWebSocket, disconnect/reconnect, session_failed, stt_error, design and try modes
  - CLAUDE.md says Next.js 14; package.json is Next 16 / React 19 (owner to correct; agents do not edit CLAUDE.md)
open_questions:
  - Q1 who sees the session history - operator mode only with copy, in memory, never sent (proposed) vs console only vs always visible (owner)
  - Q2 what waits for the rebuild - #48 and #49 wait; #55 and #110 proceed; #86 folded in (proposed) (owner)
