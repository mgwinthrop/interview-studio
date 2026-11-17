# FQ-108 Gate 2 - Architecture

Scope: the client session runtime. The backend, the WebSocket protocol
(`docs/websocket-protocol.md`) and the server's behaviour are fixed external contracts.
Evidence: `evidence/state-inventory.md` (cited below as "inv §n").

## 0. The oracle (answered first, per the migration rule)

The rebuild must keep today's behaviour except for a written list of known defects. Green
does not mean equivalent, so the oracle is built and merged **before** any runtime code
moves. It has four layers:

| Layer | What it pins | Exists today? |
|---|---|---|
| O1. Existing tests, unedited | Hearing, microphone choice, resume, end dialog, debug panel, transcript, smoke (inv §7) | yes: 10 unit files, 9 e2e specs |
| O2. New characterization tests for the paths with no test | Reply audio and `turn_timing`; interrupt (barge-in) incl. audio flush and the interrupted state; disconnect, Start over and End from Connection lost; `session_failed`; `stt_error` toast; draft rejected; design mode; Try it mode; footer Pause during end-dialog settling; `AudioQueue` (unit, fake AudioContext); `useWebSocket` (unit, fake WebSocket) | no (inv §7 gaps) |
| O3. Golden-master protocol traces | For each scripted scenario against the mock backend, the ordered list of **client→server frame types** (`session_start`, `turn_timing`, binary audio, `interrupt`, `session_end`), with no payload contents | no |
| O4. Golden-master visible-state traces | For the same scenarios, the ordered, de-duplicated sequence of visible states read from the DOM (panel `data-hearing`, panel status text, avatar state, paused screen, end dialog, warning, typing bar, overlay shown) via a MutationObserver | no |

**Equivalence rule.**
- Every migration slice must leave O1 and O2 green.
- Every slice must reproduce O3 exactly, and O4 exactly except for entries on the
  intended-change list (§6).
- Each intended change is approved by the owner and has its own test showing the new
  behaviour.
- An O3/O4 difference that is not on the list fails the slice.

**Credibility, and its limits** [Likely]
- The mock backend is deterministic in content, but timing varies between runs. O3 and O4
  therefore record order, not timestamps, and collapse repeated states.
- Two behaviours are timing races by nature: the gap after `tts_end` (inv §4.2) and
  frames arriving after an interrupt (inv §4.3). The oracle cannot pin those, so they are
  covered by deterministic unit tests on the new core instead, and listed in §6.
- Real microphone speech and real providers remain untested (unchanged from today:
  `npm run test:integration` is opt-in).

This answers the gate 1 kill check: the oracle can be named and built, and it ships first.

## 1. What is load-bearing in scope today, and why

| Path | Why protected | Verdict |
|---|---|---|
| `apps/frontend/hooks/useVAD.ts` | It is the only code that opens, pauses and stops the microphone, so it enforces "the microphone is never left live" (generation and sequence guards). It holds the voice-detection thresholds AGENTS.md locks and the 16 kHz PCM16 conversion the server depends on. | Correctly protected. The safety boundary is real. Session *decisions* (attempt, deadline, "is the person heard") should leave it, so that the protected part shrinks to the hardware boundary. |
| `docs/websocket-protocol.md` | Client and server must agree on it | Unchanged. No protocol change. |
| `apps/frontend/app/session/page.tsx` | **Not protected** | This is where the defects are (inv §6: FQ-42, 47, 65, 79, 98, #86, the Resume flash). It holds 13 `useState`, 21 `useEffect` and 24 `useRef`, and it makes the session's real decisions. The code that decides the most has the least protection. |
| `apps/frontend/app/hooks/useWebSocket.ts` | **Not protected** | It encodes frames on the client side (binary audio vs typed JSON) and owns close handling (#110). The frame encoding is part of the protocol contract. |

**Proposed charter changes** (owner decides; agents do not edit the charter):
1. Add the new **session core** (§3): one pure module that decides every session state
   change. A wrong transition here is a wrong session, and it is small and pure, so deep
   gates are cheap to run on it.
2. Add the new **session history** module (§3.4): it must never record words, so it is a
   privacy surface, like redaction on the backend.
3. Keep the **microphone adapter** load-bearing: today's `useVAD.ts`, under its new path
   if it moves.
4. Add the **socket adapter's frame encoding** (the client half of the protocol).
5. Leave the view (components, selectors, styles) unprotected. That is where #48 and #49
   mostly land.

## 2. Root cause, stated once

Session state is split across about 40 independent values in four modules (inv §1).
Fourteen effects keep them in step after the fact (inv §3: E2, E9-E11, V1, W1 and others).
Six timers and async handlers write state without checking what it is now (inv §5.3).
Every defect in inv §6 is one of three things:
- a render in which two values disagree (E9-E11, E2, V1);
- an async handler with no shared ordering (FQ-47, FQ-98);
- a writer that overwrites a real state (inv §5.3).

The design below removes all three mechanisms, not just the instances found so far.

## 3. Target architecture

Functional core, imperative shell.

```
 UI events ─┐        ┌──────────────── session core (pure) ────────────────┐
 socket ────┤ event  │ transition(state, event) → { state, commands[] }    │
 mic/VAD ───┼──────▶ │ one state value; regions: connection · conversation │
 audio ─────┤        │ · mic · pause · end flow · playback · overlays      │
 timers ────┘        └───────────────┬─────────────────────────────────────┘
                                     │ commands (send frame, pause mic, flush audio,
                                     ▼ start/cancel timer, navigate, focus…)
                     interpreter (one React hook): runs commands against adapters,
                     appends to the session history, publishes state to the view
                                     │
        ┌────────────────┬───────────┴───────┬───────────────┐
   mic adapter      socket adapter     audio adapter    timer adapter
 (VAD, devices,   (connect, send,     (AudioQueue,     (setTimeout keyed
  generation      per-socket close    playing/stopped   by id; expiry is
  guards)         identity)           events)           an event)
```

### 3.1 Session core (new, pure TypeScript, no React, no I/O)
- **One state value** made of the regions above. Every region is a discriminated union, so
  contradictory combinations cannot be represented. For example, the mic region is one of
  `off`, `starting{attempt}`, `ready`, `paused{before}`, `reopening{attempt, before}` or
  `failed{kind}`. "Paused with a reopen pending" is a state, not an accident (this absorbs
  #86).
- **Every input is an event.** That includes timer expiry: the hearing deadline is a
  `timer.expired{id}` event for a specific attempt, so a stale timer cannot affect a new
  attempt (this absorbs the Resume flash). The thinking watchdog and the interrupt
  settle-time become timer events that the core accepts only in the state that started
  them (this absorbs inv §5.3).
- **Output is the next state plus a list of commands.** The core never touches the
  microphone, socket, audio or clock. It asks for those things, so every decision is
  unit-testable without mocks.
- **Ordering is explicit.** Pause and Resume, and the end dialog's pause and resume,
  become states with a single in-flight operation. An operation that arrives while another
  is in flight is queued or ignored by rule, not by luck (this absorbs FQ-47, FQ-98 and
  the unguarded footer Pause).

### 3.2 Interpreter (new, one hook)
- Holds the core state.
- Feeds each event through `transition` and runs the commands.
- Records the history.
- Exposes `state` and `send(uiEvent)` to the view.
- The only place where React meets the core. **No other effect may set session state.**
  Effects that remain are view-only (focus, scroll, `showModal`).

### 3.3 Adapters (existing code, reduced to I/O)
- **Mic adapter** (from `useVAD.ts`, load-bearing). Keeps the VAD lifecycle, device choice,
  locked thresholds, PCM16 conversion and generation/sequence guards. It loses `hearing`,
  `hearingAttempt` and the decisions. It reports events (`loaded`, `loadFailed`,
  `speechStart`, `speechEnd{pcm}`, `misfire`, `reopened`, `reopenFailed`) and obeys
  commands (`start`, `pause`, `resume`, `stop`). It also contains vad-web's hidden
  `listening` quirk (inv §1b), which the core never sees.
- **Socket adapter** (from `useWebSocket.ts`). Connect, send and close, with
  **per-socket identity**: a close event names its socket, so a deliberate close of one
  socket can never hide another's close (this is the #110 class). Incoming messages are
  parsed into events. Transcript merging moves into the core.
- **Audio adapter** (`AudioQueue`, largely as is). Reports `playing`/`stopped`, and obeys
  `enqueue`, `flushBuffer`, `flush`, `suspend` and `resume`.
- **Timer adapter.** `start(id, ms)` and `cancel(id)`; expiry is an event.

### 3.4 Session history (new; owner decision gate 1 Q1)
- The interpreter appends `{t, event label, region states after}` to an in-memory ring
  buffer (proposed: the last 500 entries).
- **Labels come from an allow-list function per event type**, so a transcript text,
  draft or audio payload cannot reach the history even by mistake. A test feeds every
  event type with sentinel text and asserts the sentinel never appears.
- It is shown, with a copy button, only when `?debug=1` is set. It is never persisted or
  sent anywhere.

### 3.5 View
- Components render from core state through pure selectors (today's `sessionDisplay.ts`
  functions, extended). The two "is speaking" sources become one selector (inv §5.4).
- Wording, markup, styles, the avatar, reduced motion and focus order are unchanged (gate 1
  success criterion 1).

## 4. Data shapes and contracts (detail at gate 3)

- `SessionState`: the regions above, all discriminated unions. Transcript entries and
  draft live in it. Audio does not; only the adapter's queue holds audio.
- `SessionEvent`: `ui.*` (pause, resume, endClick, endConfirm, endDismiss, startOver,
  sendText, toggleTyping), `ws.*` (open, message variants, closed{socketId, code}),
  `mic.*`, `audio.*`, `timer.expired{id}`.
- `Command`: `ws.connect`, `ws.send`, `ws.close{socketId}`; `mic.start`, `mic.pause`,
  `mic.resume`, `mic.stop`; `audio.*`; `timer.start` and `timer.cancel`; `nav.go`;
  `view.focus`.
- **No new endpoint, message type, storage key or exported backend type.** `turn_timing`
  rules are unchanged: it attaches to the next audio frame only and is never applied to
  typed input (CLAUDE.md contract).

## 5. External dependencies

**None required.** The core is hand-written TypeScript. One option for the owner to decide
(dependency choices are NEVER_AUTOMATE):

| Option | For | Against |
|---|---|---|
| **A. Hand-written core (recommended)** | No dependency. The domain is modest (7 regions). Tests are plain function calls. The history is trivial to build. It fits how the factory verifies work. | Parallel regions and cross-region rules are written by hand. There's no visualizer. |
| B. XState v5 | Native parallel states and guards. Visual statecharts. Its inspection API gives a history almost for free. | A new runtime dependency (bundle size, upgrades, audit surface). The team has to learn statecharts. It's harder for the factory's verifiers to read. |

## 6. Intended behaviour changes (the only allowed O4 differences)

Each needs owner approval at gate 3 and its own test.

| # | Today | After | Source |
|---|---|---|---|
| D1 | Pause during a pending reopen leaves the warning up through the pause | Pause cancels the reopen and restores the earlier state | #86 |
| D2 | Resume > 10 s in flashes the warning and opens typing | Fixed already by #107; the core keeps it fixed by construction | #107 |
| D3 | Start over keeps page state (paused, thinking, end dialog, queued audio) from the dead session | Start over resets every region to the start of a new session | inv §4.8 |
| D4 | A disconnect while the end dialog is open leaves End session dead after Start over | The end flow resets with the session | inv §5.2 |
| D5 | Footer Pause during end-dialog settling can leave the session paused | Ordered by the pause region's single in-flight rule | inv §5.2 |
| D6 | The interrupt timer and `stt_error` can overwrite "speaking" or "thinking" with "listening" | Accepted only in the state that started them | inv §5.3 |
| D7 | The microphone keeps listening while "Connection lost" shows | It is paused while there is no connection | inv §4.8 |
| D8 | Panel and transcript cursor use different "is speaking" sources | One source | inv §5.4 |
| D9 | #110: a clean close after Start over is swallowed | Fixed by #110 before migration; per-socket identity keeps it fixed | #110 |

Under investigation, not yet an intended change: the gap of at least 100 ms after
`tts_end` where speech is not treated as an interrupt (inv §4.2). It touches the interrupt
contract and server timing, so gate 3 decides after a measurement.

## 7. How #48 and #49 fit (gate 1 success criterion 6)

- **#49, show that the microphone is hearing you.** The mic adapter already gets
  `speechStart` and `speechEnd`. Add `mic.activity` events to the core's mic region and
  one selector for the view. No other region changes.
- **#48, let the speaker control turn-taking.** Add a turn-taking setting to the
  conversation region and a `ui.endTurn` event. In speaker-controlled mode the core ignores
  `mic.speechEnd` as the end of a turn and waits for `ui.endTurn` before sending the
  utterance. The adapter would need to hand over audio on request instead of on silence.
  - That is one new adapter command in a load-bearing file.
  - [Guessing] This is the main open risk for #48: vad-web may not support it cleanly.
    Gate 3 should check the library before #48 is specced.

Both are additions in one region plus the view, which meets criterion 6.

## 8. Call flows after the rebuild (the three riskiest)

**Resume:**
1. `ui.resume`.
2. The core goes from paused to resuming and emits `audio.resume` and `mic.resume`. It
   starts a deadline timer for attempt n.
3. `mic.reopened` makes it ready and cancels the timer.
4. If `timer.expired{n}` arrives while still reopening attempt n, the core marks the mic
   unavailable. A timer for an older attempt is ignored.

**Interrupt:**
1. `mic.speechStart` while the interviewer is speaking.
2. The core moves at once to interrupted, which keeps the "snap locally before any server
   round-trip" contract.
3. It emits `ws.send{interrupt}` and `audio.flush`, and drops queued utterances.
4. A settle timer for this interrupt is started. `timer.expired` moves to listening only
   if the state is still that interrupt.

**Start over:**
1. `ui.startOver` makes the core emit `ws.connect` (new socket id), `mic.pause`,
   `audio.flush` and timer cancels.
2. Every region resets to its initial value.
3. A `ws.closed` for the old socket id is ignored by identity.

## 9. What could break

| Risk | Mitigation |
|---|---|
| Focus and accessibility flows (FQ-47 went through five rounds) | O1 `end-confirm*.spec.ts` stay unedited and green. Focus stays a view effect driven by state, not a session decision. |
| `turn_timing` and delivery metrics (server stores response-gap numbers) | O3 pins `turn_timing` before audio. A core unit test covers the gap rules. The backend contract is unchanged. |
| Interrupt contract (flush, abort, drop queued, snap locally) | O2 adds the first interrupt e2e. The core flow above keeps the local snap synchronous. |
| StrictMode double invocation | The core is pure, so double invocation is harmless. The interpreter runs commands outside the reducer and keys adapters by generation (as today). |
| Oracle flakiness from timing | O3 and O4 compare order with repeats collapsed. Known races are covered by core unit tests (§0). |
| Size and duration | Strangler migration, one region per slice, each under 400 lines, each green against the oracle and shippable alone. If it stops part-way, the finished regions still stand. |
| Review load (two load-bearing paths change in several slices) | Slices touching the mic adapter or core are `deep` with a human read. Charter STOP_IF limits the review queue to three items. |
| A contract the current code already breaks: "avatar states reflect real state, not timers" (CLAUDE.md) | The watchdog stays as a timeout *event* the core accepts only in the state that started it, and it marks the state as a timeout instead of pretending it is listening. Gate 3 wording decision. |

## 10. Migration outline (slices at gate 4)

| Phase | Content | Load-bearing |
|---|---|---|
| 0 | #110 merged; O2 characterization tests; O3/O4 golden-master harness and recorded traces | no |
| 1 | Core skeleton, interpreter, history (debug view), with no region moved yet | new core and history |
| 2 | Mic region (absorbs #86 and the FQ-86 reducer design); `useVAD` becomes the mic adapter | yes |
| 3 | Pause and end-flow regions (D5) | core |
| 4 | Connection region and socket adapter (D3, D4, D7, D9) | core, frame encoding |
| 5 | Conversation and playback regions (D6, D8; orb from state, not timers) | core |
| 6 | Remove leftover state effects; the lint rule `set-state-in-effect` back to error for `app/session/` | no |

Then #49 and #48 are specced on the new structure.

## 11. Rollback

Each slice is a normal PR, reverted on its own. Until phase 6 the old path for regions not
yet moved stays in place, so a revert never has to undo more than one region. No data,
storage or protocol migration is involved.
