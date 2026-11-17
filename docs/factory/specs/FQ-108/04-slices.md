# FQ-108 Gate 4 - Slices (phases 0 and 1, up to the checkpoint)

Phases 2-5 are sliced after the checkpoint, when gate 3 is re-opened for them (`03-design.md`
§9). Every slice below is under the 400-line STOP_IF, ships on its own and is tested on its
own.

**Rules for every slice**
1. **New test files only.** Test files and golden files that an earlier slice created are
   "existing" by the time a later slice runs (`TESTS_ARE_LOAD_BEARING`), so no slice edits
   another slice's test or golden file. The one exception is S9, which carries owner-approved
   D-item golden changes and is flagged for a human read.
2. **The DoD "test that fails without the change" for characterization slices** (S2-S7). These
   slices add tests of existing behaviour, so the test cannot fail before the slice exists.
   Their proof is a **mutation check** instead: the handoff names one deliberate fault that
   the new tests must catch. The verifier applies it on a clean checkout and confirms the
   suite goes red. (Charter class: "Test coverage added to existing untested functions".)
3. **Stability.** Every new e2e spec must pass 3 consecutive runs (`--repeat-each=3`) before
   the PR is opened.

## Order and dependencies

```
#110 (already queued) ─────────────────────────────────────────────┐
S0 tracer ─┬─ S1 speech seam (deep) ─┬─ S3 reply audio + interrupt  │
           │                         └─ S7 golden traces (rest)     │
           ├─ S4 connection + server events                         ├─ S9 remount on Start over
           ├─ S5 design + try + end-settling                        │
           └─ S6 realism                                            │
S2 unit characterization (independent) ────────────────────────────┘
S8 session history (deep) after S0-S7 ──────────────────────────────── checkpoint
```

Two slices are `deep` (S1, S8) and one is a human read for golden changes (S9). With
#107/#109 already awaiting review (1 of 3), at most two of these should be open for review
at once.

## Slices

### S0 - Tracer: proxy, recorder and the first golden trace

- **What:**
  - `e2e/support/session.ts`: the `proxySession` (MP3 substitution, `clientFrames`,
    `hold`/`release`/`inject`), `installProbes`, `recordRegions` and `expectGolden` from
    gate 3 §2.2. The `speech` helper is not in this file; S1 adds it.
  - `e2e/fixtures/silence-250ms.mp3` with a README line giving the exact ffmpeg command.
  - `e2e/golden-start.spec.ts`: **one** scenario, from start to the first reply played and
    the panel back on "Listening".
  - `e2e/golden/start-to-first-reply.json`.
- **done_when:**
  - The scenario records client frames and per-region states and matches the committed
    golden file in 3 consecutive runs.
  - The panel reports "Speaking" while the MP3 plays, which proves that substitution works.
  - The verifier changes one entry of the golden file on a scratch checkout and the spec
    fails.
- **files_expected:** `apps/frontend/e2e/support/session.ts`,
  `apps/frontend/e2e/fixtures/silence-250ms.mp3`, `apps/frontend/e2e/fixtures/README.md`,
  `apps/frontend/e2e/golden-start.spec.ts`,
  `apps/frontend/e2e/golden/start-to-first-reply.json`
- **load_bearing:** false · **gate_level:** full · **confidence:** medium (first use of the MP3
  substitution) · **est.** ~250 lines

### S1 - Speech seam and the production guard (deep)

- **What:**
  - `app/session/testSeams.ts`.
  - Seam registration in `hooks/useVAD.ts` (gate 3 §2.1).
  - `scripts/check-no-test-seams.mjs`.
  - `apps/frontend/package.json`: `build` runs the check; `build:e2e` is new.
  - `playwright.config.ts`: the e2e command and the env flag.
  - `e2e/support/speech.ts`.
  - `e2e/speech-seam.spec.ts`: seam speech start/end after the greeting sends exactly one
    binary audio frame and the panel shows "Thinking".
- **done_when:**
  - The seam spec passes 3 runs.
  - `npm --prefix apps/frontend run build` (flag unset) passes, and fails if
    `NEXT_PUBLIC_TEST_SEAMS=1` is set for it (the verifier runs both).
  - The existing `useVAD*` unit tests and the hearing, resume and microphone e2e suites pass
    unedited.
  - `useVAD.ts` changes only inside `loadVad`, the stop path and the unmount cleanup.
- **files_expected:** `apps/frontend/app/session/testSeams.ts`,
  `apps/frontend/hooks/useVAD.ts`, `apps/frontend/scripts/check-no-test-seams.mjs`,
  `apps/frontend/package.json`, `apps/frontend/playwright.config.ts`,
  `apps/frontend/e2e/support/speech.ts`, `apps/frontend/e2e/speech-seam.spec.ts`
- **load_bearing:** true (`useVAD.ts`, and the check script once the owner applies
  charter-change §3) · **gate_level:** deep · **confidence:** medium · **est.** ~180 lines
- **Human read required.**

### S2 - Unit characterization: AudioQueue and useWebSocket

- **What:** T1 `tests/unit/audioQueue.test.ts` (fake AudioContext) and T2
  `tests/unit/useWebSocket.test.ts` (fake WebSocket; transcript merge, interrupt reset,
  close-code reasons, binary vs JSON). It excludes reconnect, which #110 pins.
- **done_when:** both files pass. Mutation check: changing the 512-byte floor in
  `audioQueue.ts` to 0 fails T1, and swapping `partial` handling in the transcript merge fails
  T2.
- **files_expected:** `apps/frontend/tests/unit/audioQueue.test.ts`,
  `apps/frontend/tests/unit/useWebSocket.test.ts`
- **load_bearing:** false · **gate_level:** full · **confidence:** high · **est.** ~300 lines

### S3 - Reply audio, turn_timing and interrupt (needs S0, S1)

- **What:** T3 `e2e/reply-audio.spec.ts` and T4 `e2e/interrupt.spec.ts` (gate 3 §2.4).
- **done_when:**
  - `turn_timing` is sent immediately before audio only after real playback, and is absent
    for a barge-in.
  - Interrupt snaps the panel to "interrupted" before any server frame, sends `interrupt`,
    stops playback and drops the pending reply.
  - All of it passes 3 runs. Mutation check: removing `audioQueue.flush()` from the interrupt
    path fails T4.
- **files_expected:** `apps/frontend/e2e/reply-audio.spec.ts`,
  `apps/frontend/e2e/interrupt.spec.ts`
- **load_bearing:** false · **gate_level:** full · **confidence:** medium · **est.** ~220 lines

### S4 - Connection loss and server events (needs S0)

- **What:** T5 `e2e/connection.spec.ts` (inject 1001, Connection lost wording, Start over, End
  from the overlay, live tracks) and T6 `e2e/server-events.spec.ts` (`stt_error` toast for
  3 s; `session_failed` → overlay with live tracks 0).
- **done_when:** both pass 3 runs. They record **today's** behaviour after Start over,
  including carried-over state; S9 changes that on purpose. Mutation check: removing the
  `stopMic` call on `sessionFailed` fails T6's live-track assertion.
- **files_expected:** `apps/frontend/e2e/connection.spec.ts`,
  `apps/frontend/e2e/server-events.spec.ts`
- **load_bearing:** false · **gate_level:** full · **confidence:** medium · **est.** ~220 lines
- **Ordering:** after #110 merges, so T5 records fixed close handling.

### S5 - Design mode, Try it mode and end-dialog settling (needs S0)

- **What:** T7 `e2e/design-try.spec.ts` and T8 `e2e/end-settling-pause.spec.ts`. T8 records
  today's result for footer Pause during settling, defect included (D5 changes it later).
- **done_when:** both pass 3 runs. Mutation check: breaking the `draftRejected` close-reason
  match fails T7.
- **files_expected:** `apps/frontend/e2e/design-try.spec.ts`,
  `apps/frontend/e2e/end-settling-pause.spec.ts`
- **load_bearing:** false · **gate_level:** full · **confidence:** medium · **est.** ~230 lines

### S6 - Realism check with synthetic speech (needs S0)

- **What:**
  - `e2e/fixtures/phrase.wav`: flite speech through ffmpeg, 16 kHz, with the command in the
    fixtures README. The README is S0's file, so the command is recorded in this slice's PR
    body instead.
  - T9 `e2e/realism.spec.ts`, which uses `--use-file-for-fake-audio-capture`.
- **done_when:** a user transcript entry and a reply arrive with no seam involved, in 3 runs.
  If Silero does not detect the synthetic phrase reliably, **stop** and report back: do not
  loosen the test.
- **files_expected:** `apps/frontend/e2e/fixtures/phrase.wav`,
  `apps/frontend/e2e/realism.spec.ts`
- **load_bearing:** false · **gate_level:** full · **confidence:** low (synthetic speech against
  Silero is untested) · **est.** ~70 lines plus the fixture

### S7 - Remaining golden traces (needs S0, S1)

- **What:** `e2e/golden-scenarios.spec.ts` and golden files for pause-resume,
  end-confirm-dismiss, interrupt and connection-lost-start-over.
- **done_when:** all four match their golden files in 3 runs. The verifier alters one entry
  per file and each fails.
- **files_expected:** `apps/frontend/e2e/golden-scenarios.spec.ts`,
  `apps/frontend/e2e/golden/{pause-resume,end-confirm-dismiss,interrupt,connection-lost-start-over}.json`
- **load_bearing:** false · **gate_level:** full · **confidence:** medium · **est.** ~200 lines

### S8 - Session history in operator mode (deep; after S0-S7)

- **What:**
  - `app/session/history/labels.ts` and `history.ts` (gate 3 §3.2).
  - `app/session/SessionHistoryPanel.tsx`.
  - `history.record(...)` calls in the page's existing handlers.
  - Tests: P1 `tests/unit/sessionHistory.test.ts` (including the sentinel test) and P3
    `e2e/debug-history.spec.ts`.
- **done_when:**
  - The sentinel never appears.
  - With `?debug=1` the history and copy are shown; without it, nothing.
  - All golden traces from S0 and S7 match unchanged (the history must not alter behaviour).
- **files_expected:** `apps/frontend/app/session/history/labels.ts`,
  `apps/frontend/app/session/history/history.ts`,
  `apps/frontend/app/session/SessionHistoryPanel.tsx`, `apps/frontend/app/session/page.tsx`,
  `apps/frontend/tests/unit/sessionHistory.test.ts`,
  `apps/frontend/e2e/debug-history.spec.ts`
- **load_bearing:** true (`history/**`) · **gate_level:** deep · **confidence:** medium · **est.**
  ~320 lines
- **Human read required.**

### S9 - Remount on Start over (after S4, S7, #110)

- **What:** Gate 3 §3.1 in `SessionLoader.tsx` and `page.tsx`, P2
  `e2e/start-over-clean.spec.ts`, and golden updates for D3, D4 and D7 in
  `connection-lost-start-over.json` (S7) and T5's (`connection.spec.ts`) post-Start-over
  expectations. Those are the only golden or test edits in phases 0-1, approved as D items
  at gate 2. T8 (D5) is not touched; D5 belongs to phase 3.
- **done_when:**
  - P2 passes 3 runs.
  - The changed golden entries are exactly the D3/D4/D7 rows and are listed in the PR body.
  - All other golden traces and existing suites pass unedited.
- **files_expected:** `apps/frontend/app/session/SessionLoader.tsx`,
  `apps/frontend/app/session/page.tsx`, `apps/frontend/e2e/start-over-clean.spec.ts`,
  `apps/frontend/e2e/golden/connection-lost-start-over.json`,
  `apps/frontend/e2e/connection.spec.ts`
- **load_bearing:** false · **gate_level:** full · **confidence:** medium · **est.** ~200 lines
- **Human read required** (existing test and golden files edited, with owner pre-approval
  from gate 2 D3/D4/D7). The PR is draft.

## After S9: checkpoint

Owner review:
- the history from real sessions;
- the phase 0 traces;
- the gap after `tts_end` (measured under the proxy);
- the deep-slice estimate against actual review pace.

Then gate 3 is re-opened for phases 2-5.

## Queue entries (written only after approval)

One GitHub issue per slice, titled `FQ-108 S<n>: <title>`, labelled
`factory:ready-to-implement` once its dependencies are merged and
`factory:wait-to-implement` before that. Each has a `factory-handoff:v1` comment with the
`done_when`, `files_expected`, `load_bearing`, `gate_level` and `confidence` above.
`QUEUE.md` gets a snapshot entry per slice.
