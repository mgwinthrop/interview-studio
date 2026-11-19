# FQ-108 Gate 2 - Architecture (revision 2)

Scope: the client session runtime. The backend, the WebSocket protocol
(`docs/websocket-protocol.md`) and the server's behaviour are fixed external contracts.
Evidence: `evidence/state-inventory.md` (cited as "inv §n").

> **Revision 2, 2026-11-17, after factory-critic.** Revision 1's oracle could not exercise the
> paths it claimed. The mock backend sends two 4-byte audio frames per sentence
> (`apps/backend/src/providers/mock.ts:62-66`), and the client drops anything under 512 bytes
> (`apps/frontend/lib/audioQueue.ts:82-85`). So against the mock, nothing plays, `turn_timing`
> is never sent and barge-in can't happen.
>
> This revision:
> - rebuilds the oracle (§0);
> - settles the conflict with the existing hook tests (§0.3);
> - specifies how the interpreter executes (§3.2);
> - completes the list of intended changes (§6);
> - fixes the migration's coupling problem (§10);
> - prices the human-read load against a simpler alternative (§11);
> - asks the owner for one decision (§12).
>
> The critic's full findings are in §13.

## 0. The oracle (answered first, per the migration rule)

### 0.1 Harness (built before any runtime code moves)

| Part | What it does | Precedent |
|---|---|---|
| H1. Protocol proxy | Playwright `routeWebSocket` sits between page and mock backend. It replaces mock audio frames with a short **generated silent MP3 fixture** (≥512 bytes, no speech) so playback really happens, and it can hold or release `tts_end` and other frames on cue. | `e2e/transcript-opacity.spec.ts:11` already holds `tts_end` this way |
| H2. Speech injection | A test-only seam, compiled only when the e2e build sets `NEXT_PUBLIC_TEST_SEAMS=1` and absent from normal builds. It fires the voice detector's `speechStart`/`speechEnd(pcm)` on command, so barge-in, `turn_timing` and utterance flow are deterministic. | none. This adds a few lines to the load-bearing `useVAD.ts` in phase 0, so it is a `deep` slice. |
| H3. Realism check | One smoke test feeds a short spoken-phrase WAV fixture as Chromium's fake microphone (`--use-file-for-fake-audio-capture`) and only checks that a reply round-trip completes. The fixture is a generated test phrase, not a real interview. | none |
| H4. Probes | Live-track counter: a `getUserMedia` wrapper counting live microphone tracks, so "the microphone is never left live" is observable. Focus probe: records `document.activeElement` at each settled state. Alert and overlay insertion counters (MutationObserver). | `e2e/resume.spec.ts:28-39`, `e2e/end-confirm.spec.ts` |

### 0.2 Oracle layers

| Layer | What it pins |
|---|---|
| O1. Existing tests | Hearing, microphone choice, resume, end dialog, debug panel, transcript, smoke (inv §7). Subject to §0.3. |
| O2. New characterization tests (H1-H4) | Reply audio and `turn_timing`; interrupt (local snap, `interrupt` frame, audio flush, queued utterances dropped); disconnect, Start over and End from Connection lost; `session_failed`; `stt_error`; draft rejected; design mode; Try it mode; footer Pause during end-dialog settling. Unit tests for `AudioQueue` (fake AudioContext) and `useWebSocket` (fake WebSocket). |
| O3. Protocol traces | Per scenario, the ordered client→server frame types (`session_start`, `turn_timing`, audio, `interrupt`, `session_end`). Deterministic under H1/H2, because the test drives every step. |
| O4. Visible-state traces | **Per region**, not one global sequence, because independent races such as voice-detection load and the greeting interleave differently from run to run. Each region is recorded separately: panel status, hearing, pause screen, end dialog, warning, typing bar, overlay, focus target, live-track count. Within a region, the order must match and repeated states are collapsed. Transient states that React can legitimately skip between two server frames, such as a 200 ms "interrupted", are asserted only where the test holds the frame (H1). |

**Equivalence rule:**
- Every slice must leave O1 (as amended by §0.3) and O2 green.
- O3 must match exactly.
- O4 must match per region, except entries on the intended-change list (§6). Each of
  those needs owner approval and its own test.
- Known timing races (the gap after `tts_end`, inv §4.2; frames arriving after an
  interrupt, inv §4.3) are pinned by deterministic unit tests on the core, not by O4.
  Exception: the S9 goldens record the `tts_end` gap in O4 today. It is listed in §6 as
  D10 (candidate), so removing it is an allowed O4 difference (owner, 2026-11-19).

**Limits:**
- Real microphones and real providers stay outside automation, as today.
- H2 bypasses Silero itself. H3 covers that path only for "a reply happens".

### 0.3 Existing hook tests (resolves the conflict with "unedited")

`useVADHearing.test.ts` and `useVADResume.test.ts` assert `hearing` and `hearingAttempt` on
the hook directly. Phase 2 moves those decisions into the core, so those assertions would
test an interface that no longer exists. There are two choices:
- **Proposed:** the slice that moves a behaviour first adds an equivalent test at the new
  boundary (core unit test plus O2/O4). Only then does it replace the old hook assertions.
  That slice is draft, flagged for human read, and needs the owner's explicit approval of
  the test change (CLAUDE.md rule 3). Mic-safety assertions (no live track after
  stop/pause, device choice, thresholds) stay on the adapter and are not edited.
- Alternative: keep a compatibility `hearing`/`hearingAttempt` on the hook. That is dead
  code kept only for the tests, and it leaves two sources of truth.

## 1. What is load-bearing in scope today, and why

| Path | Why protected | Verdict |
|---|---|---|
| `apps/frontend/hooks/useVAD.ts` | The only code that opens, pauses and stops the microphone ("never left live"). It holds the locked voice-detection thresholds and the 16 kHz PCM16 conversion. | Correctly protected. Session decisions should leave it, so the protected part shrinks to the hardware boundary. |
| `docs/websocket-protocol.md` | Shared contract | Unchanged |
| `apps/frontend/app/session/page.tsx` | **Not protected** | Where the defects are (inv §6). It makes the session's real decisions with 13 `useState`, 21 `useEffect` and 24 `useRef`. |
| `apps/frontend/app/hooks/useWebSocket.ts` | **Not protected** | Holds the client half of frame encoding and owns close handling (#110). |

Proposed charter changes (the owner decides; agents do not edit the charter):
1. The new session core (§3.1) becomes load-bearing.
2. The session history (§3.4) becomes load-bearing, as a privacy surface.
3. The microphone adapter stays load-bearing (`useVAD.ts`, under its new path if it moves).
4. The socket adapter's frame encoding becomes load-bearing.
5. View, selectors and styles stay unprotected.

**Cost, stated plainly.** After the rebuild, any change to session *behaviour* is a `deep`
slice with a human read. That includes #48 and #49, which add to the core and the mic
adapter. That is the intended trade: fewer, read changes in the place that has broken most
often. The binding constraint is your review time, not gate runtime (§11).

## 2. Root cause, stated once

Session state is split across about 40 values in four modules (inv §1). Fourteen effects
keep them in step after the fact (inv §3), and timers and async handlers write state without
checking what it currently is (inv §5.3). Every defect in inv §6 is one of three things:
1. a render in which two values disagree;
2. async handlers with no shared ordering;
3. a writer that overwrites a real state.

## 3. Target architecture: functional core, imperative shell

```
 UI events ─┐        ┌──────────── session core (pure) ────────────┐
 socket ────┤ event  │ transition(state, event) → {state, commands} │
 mic/VAD ───┼──────▶ │ regions: connection · conversation · mic ·   │
 audio ─────┤        │ pause · end flow · playback · overlays       │
 timers ────┘        └──────────────────┬───────────────────────────┘
                                        ▼ commands
                interpreter: synchronous store, run-to-completion, FIFO
                                        │
        mic adapter · socket adapter · audio adapter · timer adapter
```

### 3.1 Session core (new, pure TypeScript)
- **One state value.** Each region is a discriminated union, so contradictions can't be
  represented. Example: the mic region is `off | starting{attempt} | ready | paused{before} |
  reopening{attempt, before} | failed{kind, attempt}`.
- **Every input is an event, including timer expiry.** Events that answer a request carry
  that request's id: `timer.expired{id}`, `mic.reopened{attempt}`, `mic.reopenFailed{attempt}`,
  `ws.closed{socketId}`, `audio.suspended{op}`. The core decides staleness by comparing ids.
  The mic adapter keeps its own generation guard only as a second safety layer for
  "never left live".
- **Adapters timestamp events.** The core has no clock, and response-gap numbers come from
  those timestamps, so queueing cannot shift them.
- **Output is the next state plus commands.** The core does no I/O.

### 3.2 Interpreter: execution model (new)
- **A synchronous external store**, read by React through `useSyncExternalStore`. It is not
  `useReducer`, because `useReducer` would run commands after render, and the interrupt
  contract needs `ws.send{interrupt}` and `audio.flush` to happen synchronously inside the
  voice detector's callback, as they do today (`useVAD.ts:160`, `page.tsx:156-165`).
- **Run to completion.** `send(event)` runs `transition`, then runs the returned commands in
  order, synchronously.
- **FIFO for re-entrant events.** An event raised while commands are running is queued and
  processed after the current one. For example, `audio.flush` reports `stopped`
  synchronously (`audioQueue.ts:108`). This keeps today's ordering (`page.tsx:161-163`)
  explicit instead of accidental.
- **The only writer of session state.** Effects that remain are view-only: focus, scroll,
  `showModal`.

### 3.3 Adapters (existing code, reduced to I/O)
- **Mic adapter** (from `useVAD.ts`, load-bearing). Holds the VAD lifecycle, device choice,
  thresholds, PCM16 conversion, the generation guard and vad-web's hidden `listening` quirk
  (inv §1b). It emits id-carrying events and takes `start`/`pause`/`resume`/`stop{attempt}`
  commands.
- **Socket adapter** (from `useWebSocket.ts`). Per-socket identity on every event and
  command. Parses messages into events. Transcript merging moves into the core.
- **Audio adapter** (`AudioQueue`). Emits `playing` and `stopped` with timestamps.
- **Timer adapter.** `start(id, ms)` and `cancel(id)`; expiry is an event.

### 3.4 Session history (owner decision gate 1 Q1)
- The interpreter appends `{t, event label, region states}` to an in-memory ring of 500
  entries.
- Labels come from an allow-list per event type. A test pushes sentinel text through every
  event type and asserts the sentinel never appears in the history.
- It is shown, with a copy button, only with `?debug=1`.

### 3.5 View
- Renders from core state through pure selectors. Wording, markup, styles, avatar, reduced
  motion and focus order are unchanged.

## 4. Data shapes (detail at gate 3)

`SessionState` (regions), `SessionEvent` (`ui.*`, `ws.*`, `mic.*`, `audio.*`, `timer.*`, all
id-carrying where they answer a request) and `Command`. No new endpoint, message type, storage
key or backend type. `turn_timing` rules unchanged.

## 5. External dependencies

None required. **Recommended: a hand-written core.** XState v5 is the alternative: native
parallel states and a built-in inspector, against a new runtime dependency and a learning
curve. Dependency choices are the owner's (NEVER_AUTOMATE).

## 6. Intended visible changes (the only allowed O4 differences)

Each needs owner approval at gate 3 and its own test.

| # | Today | After | Source |
|---|---|---|---|
| D1 | Pause during a pending reopen keeps the warning up through the pause | Pause cancels the reopen and restores the prior state | #86 |
| D2 | Resume > 10 s flash | Fixed by #107; kept fixed by construction | #107 |
| D3 | Start over keeps paused, thinking, end-dialog and queued-audio state from the dead session | Start over begins a clean session. **Visible: the microphone goes through "Getting ready…" again, with "didn't start" wording if it fails, not the after-pause wording.** | inv §4.8 |
| D4 | A disconnect while the end dialog is open leaves End session dead after Start over | Resets with the session | inv §5.2 |
| D5 | Footer Pause during end-dialog settling leaves the screen Paused while the voice detector is listening with a live microphone track: the close's `resumeMic` runs after the footer's `pauseMic`. Speech in that state is very probably sent (`onSpeechEnd` does not check pause) | Ordered by the pause region. **Invariant, whatever the end state: screen and mic agree.** Paused means 0 live tracks and no audio frames; Listening means the detector is live. A fix that only changes which state the screen ends in does not close D5. **Known residual after the interim fix (PR #150):** a footer Pause during settling, then Resume on the pause screen before that footer pause's own suspend has finished, still ends Paused with the mic live, because `handlePause` and `handleResume` are not serialised (window: at most one suspend; not tested). Phase 2's pause region must close it and add the test. Also: a failed dialog suspend after a footer Pause shows not-paused with the mic off (fails safe) | inv §5.2; S7 `e2e/end-settling-pause.spec.ts` (PR #144); interim fix #148, PR #150; residual accepted by the owner, 2026-11-19 |
| D6 | The interrupt timer and `stt_error` can overwrite "speaking" or "thinking" with "listening" | Accepted only in the state that started them | inv §5.3 |
| D7 | The microphone keeps listening while "Connection lost" shows | It is **stopped** (not paused) on connection loss, and Start over starts it fresh (D3 wording) | inv §4.8 |
| D9 | #110 | Fixed before migration; per-socket identity keeps it fixed | #110 |
| D10 (candidate) | Each reply's panel trace is `speaking, listening, speaking, listening`: the middle `listening` is the gap after `tts_end` (inv §4.2). The S9 goldens (`e2e/golden/*.json`, PR #142) pin it | Decided at gate 3 after the H1 measurement (see below). If the gap goes, the middle `listening` leaves every golden's `panelStatus` in the slice that removes it, and that golden change is expected, not a regression | PR #142 verifier reservation 2; owner, 2026-11-19 |

Explicitly **not** changing (revision 1 implied changes here):
- **The thinking watchdog** still returns to "Listening" after 10 s with today's wording,
  but only if that same turn is still thinking. No new "timeout" state or wording. The
  tension with the CLAUDE.md avatar contract is recorded here, not changed.
- **Two speaking sources** (revision 1 D8, dropped). The transcript cursor keeps following
  the server's streaming flag and the label keeps following playback, as today, pinned by
  `transcript-opacity.spec.ts`. Both become selectors over one state.
- **Pause timing.** The screen shows "paused" only after audio has actually suspended, as
  today (`page.tsx:226-231`). The core models it as `pausing → paused` on `audio.suspended`.
  `end-confirm-settling.spec.ts` depends on this.
- **The gap of at least 100 ms after `tts_end`** (inv §4.2) is under investigation, not
  changed. It touches the interrupt contract, so gate 3 decides after a measurement under H1.
  Until then it is D10 (candidate) in the table above.

## 7. #48 and #49 fit

- **#49:** `mic.activity` events into the mic region plus one selector. It touches the core
  and the mic adapter, so it is a deep slice.
- **#48:** a turn-taking setting in the conversation region and a `ui.endTurn` event.
  vad-web 0.0.31 exposes `onFrameProcessed`, `setOptions` and `submitUserSpeechOnPause`
  (`node_modules/@ricky0123/vad-web/dist/real-time-vad.d.ts:7`), so the library is not the
  blocker. The real question for #48's own spec: speaker-controlled turns mean audio that
  spans several detected segments is held in the mic adapter until the person ends the turn.
  That is a new in-memory place holding audio. It is never stored, but it needs its own
  privacy review.

## 8. Riskiest flows after the rebuild

- **Interrupt:**
  1. `mic.speechStart{t}` arrives while playback or streaming is on.
  2. Synchronously, in one run: state becomes interrupted, `ws.send{interrupt}`, then
     `audio.flush`, which re-enters `audio.stopped`, queued FIFO.
  3. Queued utterances are dropped.
  4. A settle timer for this interrupt is started. Its expiry is accepted only if the state
     is still that interrupt.
- **Resume:**
  1. `ui.resume` → resuming → `audio.resume{op}`.
  2. `audio.resumed{op}` → `mic.resume{attempt n}` plus a deadline timer for n.
  3. `mic.reopened{n}` → ready, and the timer is cancelled.
  4. `timer.expired{n}` while reopening n → unavailable.
  5. Anything carrying an older id is ignored.
- **Start over:** `ui.startOver` → `ws.connect{new id}`, `mic.stop`, `audio.flush`, timers
  cancelled, regions reset, then `mic.start` (D3 and D7). Events for the old socket id are
  ignored.

## 9. What could break

| Risk | Mitigation |
|---|---|
| Focus and accessibility (FQ-47 took five rounds) | `end-confirm*.spec.ts` stay unedited. H4 adds focus probes to O4. Focus stays a view effect. |
| The interrupt contract | The synchronous interpreter (§3.2). O2 adds the first interrupt e2e under H1/H2. |
| `turn_timing` and delivery metrics | O3 pins frame order. A core unit test covers gap rules with adapter timestamps. |
| The microphone left live | The H4 live-track probe in every O2 scenario. The adapter keeps its guard as a second layer. |
| StrictMode | The core is pure. The store and adapters are created once per mount and keyed by generation. |
| Oracle flakiness | Per-region traces. Tests drive every step through H1/H2. Races are pinned in core unit tests. |
| Review load | Priced in §11. STOP_IF caps the review queue at 3. |

## 10. Migration (revised for coupling)

Revision 1 moved one region at a time. The critic showed that mic, pause and end flow are
coupled (#86 needs both), and so are conversation and playback (interrupt needs both).
Moving them apart would need bridges that sync page state into the core, which is the
mechanism §2 removes. Revised order:

| Phase | Content | Deep slices (est.) | Other slices (est.) |
|---|---|---|---|
| 0. Oracle | H1 proxy and MP3 fixture, H3 smoke, H4 probes, O2 tests, O3/O4 recorder and golden traces; H2 seam in `useVAD` | 1 | 4-5 |
| 1. Cheap structural wins | Remount the session view by key on Start over (D3, D4, D7's reset half, in a few lines); allow-listed history logger called from today's handlers (gate 1 criterion 4 delivered early, later reused by the interpreter) | 1 (history) | 1 |
| 2. Core and interpreter, with mic + pause + end flow together | Pure transitions and tests first, wiring in the next slice (no orphan longer than one slice); `useVAD` becomes the mic adapter; §0.3 test replacement | 3-4 | 0 |
| 3. Connection | Socket adapter with per-socket identity, connection region | 2 | 0 |
| 4. Conversation + playback together | Interrupt, watchdog guards, transcript merge | 2-3 | 0 |
| 5. Cleanup | Remove leftover state effects; `set-state-in-effect` back to error for `app/session/` | 0 | 1 |

Regions not yet moved feed the core through their **existing callbacks**, not effects. For
example, `useWebSocket`'s message handler calls `send({ws.ttsStart})`. That is a callback,
so it adds no render-lag mechanism.

Phases 0 and 1 are worth shipping even if the rebuild stops there.

## 11. Cost against the simpler alternative

The critic proposed, and I agree it must be weighed: remount on Start over + the FQ-86
hearing reducer + a token-checked `serialize()` for Pause, Resume and the end dialog +
"still in the starting state" guards on the three timers + an allow-listed history logger
+ the same oracle.

| | Full core (this spec) | Targeted hardening |
|---|---|---|
| Slices | ~16-19 | ~10-11 (phase 0 plus about 5) |
| Deep slices with a human read | ~9-11 | ~3 |
| At a review queue of 3 and your pace of about 3 reads a week [Guessing] | ~5-7 weeks | ~2-3 weeks |
| Gate 1 criteria 1-5, 7 | met | largely met |
| Criterion 6 (#48 and #49 cheaper) | met: one region plus view each | not met: each adds to today's spread state |
| "One traceable place" (your 2026-11-17 goal) | met | partial: history only sees what handlers log, and effects stay |
| Future changes | deep slice each (behaviour lives in the core) | mostly full gates, but in spread state |

Phases 0 and 1 are **identical in both options**. That makes a decision checkpoint possible
after phase 1. By then the oracle exists, the cheap wins have shipped, the history is
collecting real traces, and #49 can be sketched against both shapes.

## 12. Decision for the owner

1. **Direction (recommended: full core, with a checkpoint after phase 1).** Your stated goal
   was a structure that is easier to extend, debug and trace, accepting bigger changes. Only
   the full core meets criterion 6 and the one-place goal. Phases 0-1 are shared, so the
   commitment can be confirmed with evidence before the expensive, deep part begins.
   Alternative: targeted hardening only.
2. **The §0.3 test policy** (replace hook-internal assertions only after an equivalent test
   exists at the new boundary, as a draft with a human read).
3. **The proposed charter changes in §1** (whether now or at the checkpoint).
4. **A hand-written core versus XState** (§5).

## 13. factory-critic review (2026-11-17), how each objection was handled

1. **The oracle couldn't reach audio, `turn_timing` or interrupt against the mock
   (blocking).** Confirmed by reading `mock.ts:62-66` and `audioQueue.ts:82-85`. Fixed by
   H1/H2/H3 (§0.1).
2. **O4 would flake and missed focus and the live mic (blocking).** Per-region traces, H4
   focus and live-track probes (§0.2).
3. **O1 "unedited" contradicts phase 2 (blocking).** §0.3 policy, decision 2.
4. **Interpreter execution unstated (should-fix).** §3.2 synchronous store,
   run-to-completion, FIFO; id-carrying mic events; adapter timestamps.
5. **§6 missing visible changes (should-fix).** Added the D3/D7 wording. Dropped the
   timeout state and D8. Pinned pause timing.
6. **Phases coupled (should-fix).** Coupled regions move together, unmoved regions feed in
   through callbacks, and the pure core lands one slice before its wiring (§10).
7. **Human-read load not priced (should-fix).** §1 cost, §11 comparison.
8. **#48 not a showstopper (note).** Downgraded. The real question is in-memory audio held
   across segments (§7).
