# FQ-108 Gate 4 - Slices (phases 0 and 1)

> **Approved by the owner on 2026-11-17.** The owner also decided that the STOP_IF limit
> keeps counting test lines (#80), so the plan stays at 14 slices. The live issues:
>
> | Slice | Issue | Label at creation |
> |---|---|---|
> | S0 | #121 | wait-to-implement (interactive, deep) |
> | S1 | #122 | wait-to-implement (#121) |
> | S2 | #123 | ready-to-implement |
> | S3 | #124 | ready-to-implement |
> | S4 | #125 | wait-to-implement (#122) |
> | S5 | #126 | wait-to-implement (#122) |
> | S6 | #127 | wait-to-implement (#122) |
> | S7 | #128 | wait-to-implement (#122) |
> | S8 | #129 | wait-to-implement (#121) |
> | S9 | #130 | wait-to-implement (#122) |
> | S10 | #131 | wait-to-implement (#125, #126, #130) |
> | S11 | #132 | wait-to-implement (interactive, deep) |
> | S12 | #133 | wait-to-implement (#132, #122) |
> | S13 | #134 | wait-to-implement (#126, #131; interactive) |

Scope: phases 0 and 1 only, as approved at gate 3 (file level). Phases 2-5 are sliced after
the checkpoint that follows phase 1, when gate 3 reopens for them.

All paths are under `apps/frontend/` unless stated. Line estimates include tests, because
the 400-line STOP_IF counts them today (#80). Every slice is sized to fit under that limit,
so this plan does not depend on how #80 is decided.

## Rules that apply to every slice

- One slice is one GitHub issue and one PR. Each has its own `factory-handoff:v1`.
- A slice that adds an e2e spec passes `npx playwright test <spec> --repeat-each=10` before
  it is committed, with the summary line in the PR body (gate 3 A3).
- Every e2e scenario in phase 0 that ends with the microphone meant to be closed asserts
  `liveTracks() === 0`.
- Phase 0 slices change **no runtime behaviour**. S0 is the only exception: it adds the
  test seam, compiled only into the e2e build.
- No slice modifies an existing test file, except S13. S13 is interactive-only (see there).

## Order and dependencies

```
S0 seam ──▶ S1 tracer (proxy + reply audio) ──┬─▶ S4 interrupt
                                              ├─▶ S5 connection + server events ─┐
                                              ├─▶ S6 design + try                │
                                              ├─▶ S7 end-settling pause ─────────┤
                                              └─▶ S9 recorder + 3 goldens ─▶ S10 ┤
S0 ──▶ S8 realism (phrase.wav)                                                  ▼
S2 audioQueue unit   (independent)                                  S13 remount on Start over
S3 useWebSocket unit (independent)                                  (phase 1, interactive)
S11 history core ──▶ S12 history wiring + panel
```

No dependencies: **S0, S2, S3, S11**.

**Labels (decided at approval).**
- S2 and S3: `factory:ready-to-implement`.
- S0 and S11: `factory:wait-to-implement`, blocked on "interactive session with the owner".
  They are load-bearing, and the implement skill bounces load-bearing work in unattended
  runs. This follows the FQ-40 and FQ-41 precedent.
- S13: also `wait-to-implement`, interactive only, because it changes existing tests.
- All others: `factory:wait-to-implement`, naming the slices they depend on.
- When a dependency merges, the next triage moves the dependent slice to ready.

## Phase 0: the oracle

### S0 - Speech seam, separate e2e build, seam guard in CI (deep)
- **Files:**
  - new: `app/session/testSeams.ts`, `scripts/check-no-test-seams.mjs`, `e2e/seam.spec.ts`
  - changed: `hooks/useVAD.ts`, `playwright.config.ts`, `next.config.mjs`, `.gitignore`,
    `package.json` (frontend, one script line), and `.github/workflows/ci.yml` (repo root)
- **Load-bearing:** yes (`useVAD.ts`, `.github/workflows/**`). Deep gates, human read.
- **Estimate:** ~150 lines.
- **done_when:**
  - `e2e/seam.spec.ts` starts a session and calls `window.__testSeams.vad.speechStart()`
    then `speechEnd()`. A user transcript entry appears (the mock STT transcribes any
    audio). This fails on main, because no seam exists there.
  - With the e2e build, `.next-e2e` exists and `.next` is not written.
  - `npm run check:no-test-seams` passes after a normal `npm run build` and fails if it is
    pointed at `.next-e2e`.
  - The CI workflow runs that check after the frontend build.
  - The only change to `useVAD.ts` is the guarded `registerVadSeam` call and its
    unregistration.
- **Confidence:** medium. This is the riskiest slice: the seam lives in a load-bearing file,
  and dead-code removal has to be verified by the check script, not assumed.

### S1 - Tracer bullet: protocol proxy, silent MP3, probes, reply audio (full)
- **Files (all new):** `e2e/support/session.ts` (proxy, `installProbes`, `speech`),
  `e2e/fixtures/silence-250ms.mp3`, `e2e/fixtures/README.md`, `e2e/reply-audio.spec.ts` (T3)
- **Estimate:** ~300 lines.
- **Depends on:** S0.
- **done_when:**
  - T3 passes. The greeting really plays, through the proxy's MP3.
  - An answer given through the seam after playback ends sends `turn_timing` and then
    `audio` (`clientFrames()`).
  - An answer with no playback before it sends no `turn_timing`.
  - This scenario cannot pass against main's mock-only audio. That is the critic's blocking
    finding from gate 2, now proven closed.
- **Confidence:** medium. This is the first use of `routeWebSocket` frame replacement, and
  the fake AudioContext path in headless Chromium is unproven.

### S2 - AudioQueue unit tests, T1 (full)
- **Files:** new `tests/unit/audioQueue.test.ts`.
- **Estimate:** ~200 lines.
- **done_when:** these behaviours are pinned with a fake AudioContext:
  - enqueue and `flushBuffer` below and above 512 bytes;
  - `flush` bumps the generation and discards in-flight decodes;
  - suspend and resume report the playing state;
  - dispose.

  No runtime file changes.
- **Confidence:** high. It falls under the charter's AUTOMATABLE "test coverage for
  existing untested functions".

### S3 - useWebSocket unit tests, T2 (full)
- **Files:** new `tests/unit/useWebSocket.test.ts`.
- **Estimate:** ~250 lines.
- **done_when:** these behaviours are pinned:
  - partial and final transcript merge;
  - a final that arrives before its partials;
  - `interrupt` resets streaming state and refs;
  - each close code maps to its reason;
  - binary frames versus JSON sends.

  It contains no reconnect or close-suppression cases; those are already covered by
  `useWebSocketReconnect.test.ts` (A4). No runtime file changes.
- **Confidence:** high.

### S4 - Interrupt e2e, T4 (full)
- **Files:** new `e2e/interrupt.spec.ts`.
- **Estimate:** ~120 lines.
- **Depends on:** S1.
- **done_when:**
  - With `tts_end` held, seam speech during playback makes the panel show "interrupted" at
    once.
  - `interrupt` precedes any later `audio` frame.
  - Playback stops.
  - No `turn_timing` is sent for that answer.
  - This pins the CLAUDE.md interrupt contract.
- **Confidence:** medium. Its timing depends on the proxy's hold/release.

### S5 - Connection and server-event e2e, T5 + T6 (full)
- **Files:** new `e2e/connection.spec.ts`, `e2e/server-events.spec.ts`.
- **Estimate:** ~250 lines.
- **Depends on:** S1.
- **done_when:**
  - An injected close 1001 shows Connection lost with the timeout wording.
  - Start over sends a new `session_start`.
  - End from Connection lost goes to the report route.
  - An injected `stt_error` shows the toast for about 3 s.
  - An injected `session_failed` shows the failed overlay with `liveTracks() === 0`.
  - The carried-over state after Start over (D3/D4/D7) is asserted as today's behaviour, in
    a clearly named `describe("today, changed by phase 1 D3/D4/D7")` block.
- **Confidence:** medium.

### S6 - Design and Try it e2e, T7 (full)
- **Files:** new `e2e/design-try.spec.ts`.
- **Estimate:** ~150 lines.
- **Depends on:** S1.
- **done_when:**
  - `mode=design`: ending the session shows "making draft", then the editor route, with
    the mock draft.
  - `mode=try`: a draft rejected with 1008 shows the rejected overlay.
  - Ending a Try it session returns to the editor route.
- **Confidence:** medium.

### S7 - Footer Pause during end-dialog settling, T8 (full)
- **Files:** new `e2e/end-settling-pause.spec.ts`.
- **Estimate:** ~100 lines.
- **Depends on:** S1.
- **done_when:** it records today's end state, including the D5 defect, in a block named
  for D5. D5 changes in phase 2, not in this plan.
- **Confidence:** medium.

### S8 - Realism smoke, T9 (full)
- **Files:**
  - new: `e2e/realism.spec.ts`, `e2e/fixtures/phrase.wav`
  - changed: `playwright.config.ts` (a second Chromium project with
    `--use-file-for-fake-audio-capture`, limited to this spec), `e2e/fixtures/README.md`
- **Estimate:** ~80 lines plus the fixture.
- **Depends on:** S0, which also edits `playwright.config.ts`.
- **done_when:**
  - Real Silero voice detection on the synthetic phrase gives a user transcript entry and an
    assistant reply. No seam is used.
  - The fixture is made with the ffmpeg/flite command recorded in the README.
- **Confidence:** medium-low. Silero's timing on a synthetic voice is the unknown. If it
  passes fewer than 10 of 10 repeats, the slice stops and returns to the owner rather than
  loosening the bar.

### S9 - Region recorder and the first three golden traces, part of T10 (full)
- **Files:**
  - new: `e2e/support/regions.ts` (`recordRegions`, `expectGolden`),
    `e2e/golden-traces.spec.ts`, and three goldens in `e2e/golden/`:
    `start-to-first-reply.json`, `pause-resume.json` and `end-confirm-dismiss.json`
- **Estimate:** ~350 lines.
- **Depends on:** S1.
- **done_when:**
  - The three scenarios record O3 (frames) and O4 (per-region states) and match their
    goldens.
  - `--repeat-each=10` passes.
  - Without `UPDATE_GOLDEN=1`, a changed trace fails with a readable diff.
  - CI never sets `UPDATE_GOLDEN`.
- **Confidence:** medium. Flake risk is the main threat, and A3 is the guard.

### S10 - Golden traces for interrupt and connection-lost-start-over, rest of T10 (full)
- **Files (all new):** `e2e/golden-traces-connection.spec.ts`, with goldens
  `e2e/golden/interrupt.json` and `e2e/golden/connection-lost-start-over.json`. This is a
  separate file, not added to S9's spec, so that S10 edits no existing test and can run
  unattended.
- **Estimate:** ~150 lines.
- **Depends on:** S4, S5, S9.
- **done_when:** both scenarios match their goldens and `--repeat-each=10` passes.
  connection-lost-start-over records today's D3/D4/D7 state.
- **Confidence:** medium.

## Phase 1: cheap structural wins

### S11 - Session history core, P1 (deep)
- **Files:** new `app/session/history/labels.ts`, `app/session/history/history.ts`,
  `tests/unit/sessionHistory.test.ts`.
- **Load-bearing:** yes (`app/session/history/**`). Deep gates, human read.
- **Estimate:** ~250 lines.
- **Depends on:** nothing. It is pure and not wired to anything yet.
- **done_when:**
  - Ring capacity, ordering and the `toText` format are tested.
  - The sentinel test: every `HistoryEventInput` variant, recorded in a session that
    carries sentinel transcript, draft and reason strings, never yields a sentinel in
    `entries()` or `toText()`.
  - The input type has no string payload fields; the test checks this at compile time with
    a `@ts-expect-error`.
  - No runtime file imports it yet.
- **Confidence:** high.

### S12 - History wiring and debug panel, P3 (full)
- **Files:**
  - new: `app/session/SessionHistoryPanel.tsx`, `e2e/debug-history.spec.ts`
  - changed: `app/session/page.tsx` (calls to `history.record` from existing handlers)
- **Estimate:** ~250 lines.
- **Depends on:** S11, and S1 for scenario driving.
- **done_when:**
  - With `?debug=1` the history and its copy button show. Without it, nothing shows.
  - After a session with transcript text, the copied history contains none of those words.
  - No change in O1 or O2.
- **Confidence:** medium. It touches `page.tsx`, the busiest file in the defect history,
  but adds only calls.

### S13 - Remount on Start over: D3, D4 and the reset half of D7, P2 (full, interactive only)
- **Files:**
  - changed: `app/session/SessionLoader.tsx`, `app/session/page.tsx`
  - new: `e2e/start-over-clean.spec.ts`
  - changed tests: S5's `connection.spec.ts` (the D3/D4/D7 block) and S10's
    connection-lost-start-over golden
- **Estimate:** ~250 lines.
- **Depends on:** S5 and S10.
- **Existing tests modified:** yes, intentionally. The change implements owner-approved D
  items (gate 3 §7), so it is **interactive only**, draft, with a human read. The changed
  golden entries are listed in the PR body.
- **done_when:**
  - After Connection lost while paused, while thinking, or with the end dialog open, Start
    over gives a clean session: not paused, not thinking, and End works.
  - The mic shows "Getting ready…" and then becomes ready, with `liveTracks() === 1`.
  - Design-mode retry takes the same path.
  - Every O2/O4 difference is one of D3, D4 or D7.
- **Confidence:** medium. This is §8 Q2 from gate 3: mic start under the Start over click's
  activation, checked only in Chromium.

## Totals and review load

| | Slices | Deep (human read) | Interactive-only | Ready immediately |
|---|---|---|---|---|
| Phase 0 | 11 (S0-S10) | 1 (S0) | 0 | S0, S2, S3 |
| Phase 1 | 3 (S11-S13) | 1 (S11) | 1 (S13) | S11 |

Gate 2 estimated 6-8 slices for phases 0-1. This plan has 14, because each slice is held
under 400 lines including tests. If #80 is decided as "count non-test code only", the
following pairs can merge, giving 11 slices:
- S2 + S3;
- S5 + S7;
- S9 + S10.

Every slice is a PR you merge. At a review queue of 3, the next slice waits on your merges,
not on agent time.
