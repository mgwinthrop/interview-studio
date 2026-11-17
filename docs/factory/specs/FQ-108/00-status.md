item: FQ-108
scope: architecture review of the client session runtime (app/session/, hooks/useVAD.ts, app/hooks/useWebSocket.ts, lib/audioQueue.ts, display helpers); backend and WebSocket protocol are fixed external contracts
kind: architecture review leading to a migration plan (spec skill migration rule applies: name the oracle first)
gate_1_product: approved 2026-11-17 (owner, interactive)
gate_2_architecture: approved 2026-11-17 (owner, interactive; revision 2 after factory-critic)
gate_3_design: pending (phases 0-1 file level; phases 2-5 contract level)
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
  - Q1 session history is operator mode only (?debug=1), with copy, in memory for the session, never sent (owner, gate 1)
  - Q2 #48 and #49 wait for the rebuild; #55 and #110 proceed; #86 is folded in (owner, gate 1)
  - Direction - full rebuild (functional core), with a checkpoint after phase 1 (owner, gate 2)
  - Test policy - replace hook-internal assertions only after an equivalent test exists at the new boundary; draft + human read (owner, gate 2)
  - Charter - make the session core and session history load-bearing (owner, gate 2); the CHARTER.md edit itself waits for an explicit owner instruction with exact paths (gate 3)
  - Hand-written core, no XState (owner, gate 2)
candidate_absorbs: "#86, #48, #49"
latent_defects_found_by_inventory:
  - "#110: after Start over, the next clean server close is swallowed (confirmed by reading useWebSocket.ts and page.tsx; every Start over is affected)"
  - reconnect ("Start over") resets only the WebSocket hook; page state, VAD/hearing and the audio queue are not reset [inference]
  - end dialog unmounted by a disconnect leaves confirmingEnd true, so End session does nothing after Start over [inference]
  - no tests for interrupt, turn_timing, AudioQueue, useWebSocket, disconnect/reconnect, session_failed, stt_error, design and try modes
  - CLAUDE.md says Next.js 14; package.json is Next 16 / React 19 (owner to correct; agents do not edit CLAUDE.md)
  - Apply the charter change now (owner, 2026-11-17); the agent's edit was refused by session permission settings, so the owner applies charter-change.md by hand
open_questions:
  - Owner to apply charter-change.md to CHARTER.md (and the DECISIONS.md entry)
  - Add app/session/runtime/** to the charter change as well? (gate 3 §8 Q3; agent leans yes)
