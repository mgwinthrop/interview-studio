item: FQ-108
scope: architecture review of the client session runtime (app/session/, hooks/useVAD.ts, app/hooks/useWebSocket.ts, lib/audioQueue.ts, display helpers); backend and WebSocket protocol are fixed external contracts
kind: architecture review leading to a migration plan (spec skill migration rule applies: name the oracle first)
gate_1_product: approved 2026-11-17 (owner, interactive)
gate_2_architecture: approved 2026-11-17 (owner, interactive; revision 2 after factory-critic)
gate_3_design: approved 2026-11-17 (owner, interactive, with amendments A1-A4); phases 0-1 at file level, phases 2-5 at contract level only and reopened at the checkpoint after phase 1
gate_4_slices: not-started
slices_completed: 0 / ?
evidence:
  - evidence/state-inventory.md - state inventory, sync effects, control flows, implicit state machines, defect-to-mechanism map, test coverage (delegated read-only agent, 2026-11-17; spot-checked)
decisions:
  - Scope is the client session runtime only (owner, 2026-11-17)
  - Ship #107 (page-only interim fix for the ordinary-Resume flash) while the review runs (owner, 2026-11-17); PR #109, merged; issue closed
  - #86 (FQ-86) paused at gate 3; its reducer design is input, not an approved plan (owner, 2026-11-17)
  - File the reconnect defect now as a standalone fix (owner, 2026-11-17); #110, PR #118, merged
  - Design for #48 and #49; success = one traceable place for session state changes, no state kept in step by effects, every runtime path tested before migration (owner, 2026-11-17; expressed in product terms in 01-product.md)
  - Q1 session history is operator mode only (?debug=1), with copy, in memory for the session, never sent (owner, gate 1)
  - Q2 #48 and #49 wait for the rebuild; #55 and #110 proceed; #86 is folded in (owner, gate 1)
  - Direction - full rebuild (functional core), with a checkpoint after phase 1 (owner, gate 2)
  - Test policy - replace hook-internal assertions only after an equivalent test exists at the new boundary; draft + human read (owner, gate 2)
  - Charter - session core, history, mic/socket adapters and runtime are load-bearing (owner, gates 2-3); applied to CHARTER.md and DECISIONS.md on 2026-11-17
  - Hand-written core, no XState (owner, gate 2)
  - "Gate 3 A1: runtime/store.ts and useSession.ts are load-bearing in the design table, matching the charter (owner, gate 3)"
  - "Gate 3 A2: the e2e build writes to its own distDir (.next-e2e) so a seam build never overwrites .next (owner, gate 3)"
  - "Gate 3 A3: a golden trace or the spec that records one is committed only after --repeat-each=10 passes (owner, gate 3)"
  - "Gate 3 A4: T2 does not repeat #110's reconnect cases; useWebSocketReconnect.test.ts falls under the hook-test policy in phase 3 (owner, gate 3)"
  - "Seam guard enforcement: a check:no-test-seams step in .github/workflows/ci.yml, added in the phase 0 slice that creates the script (deep, human read). Owner authorized this protected-file edit for that slice (gate 3, 2026-11-17)"
candidate_absorbs: "#86, #48, #49"
latent_defects_found_by_inventory:
  - "#110: after Start over, the next clean server close is swallowed - fixed by PR #118"
  - reconnect ("Start over") resets only the WebSocket hook; page state, VAD/hearing and the audio queue are not reset [inference]; phase 1 remount (D3/D4/D7)
  - end dialog unmounted by a disconnect leaves confirmingEnd true, so End session does nothing after Start over [inference]; phase 1 remount
  - no tests for interrupt, turn_timing, AudioQueue, useWebSocket (beyond #110's reconnect cases), session_failed, stt_error, design and try modes; phase 0
open_questions:
  - "Gate 4 sizing: phase 0 is about 10 new test files plus the proxy harness. Under the 400-line STOP_IF, which counts tests (#80), it is several slices. Decide #80 before or during gate 4 (owner)"
