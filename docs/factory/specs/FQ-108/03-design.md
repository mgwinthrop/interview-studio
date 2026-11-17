# FQ-108 Gate 3 - Program design

Signatures and contracts only. No implementations. All paths are under `apps/frontend/`
unless stated.

**Depth of detail per phase**
- **Phases 0 and 1** (before the checkpoint) are specified to the file and test level.
- **Phases 2-5** are specified to the type and module level. Their test lists are rules plus
  named cases. The checkpoint after phase 1 re-opens gate 3 for them with real traces in
  hand.

## 1. Module layout (target)

| Path | Role | Load-bearing (per approved charter change) | Phase |
|---|---|---|---|
| `app/session/core/types.ts` | `SessionState`, region unions, `SessionEvent`, `Command`, ids | yes | 2 |
| `app/session/core/initial.ts` | `initialState(config)` | yes | 2 |
| `app/session/core/transition.ts` | `transition(state, event): Step`, combining the regions | yes | 2 |
| `app/session/core/regions/{mic,pause,endFlow,connection,conversation,playback,overlays}.ts` | One pure reducer per region | yes | 2-4 |
| `app/session/history/labels.ts` | `eventLabel(event)`: allow-listed, word-free labels | yes | 1 |
| `app/session/history/history.ts` | `SessionHistory` ring buffer, `toText()` | yes | 1 |
| `app/session/runtime/store.ts` | `createSessionStore(adapters, config)`: synchronous, run-to-completion, FIFO | yes (charter `runtime/**`; §8 Q3 resolved) | 2 |
| `app/session/runtime/useSession.ts` | `useSyncExternalStore` binding | yes (charter `runtime/**`) | 2 |
| `app/session/adapters/micAdapter.ts` | Today's `useVAD.ts` I/O: VAD, devices, PCM16, generation guard | yes | 2 |
| `app/session/adapters/socketAdapter.ts` | Connect, send, close, per-socket id, parse | yes | 3 |
| `app/session/adapters/audioAdapter.ts` | Wraps `lib/audioQueue.ts`; timestamps events | no | 4 |
| `app/session/adapters/timerAdapter.ts` | `start(id, ms)`, `cancel(id)` | no | 2 |
| `app/session/selectors.ts` | View selectors: today's `sessionDisplay.ts` functions move or re-export here | no | 2-4 |
| `app/session/SessionHistoryPanel.tsx` | Debug-only history view and copy button | no | 1 |
| `app/session/testSeams.ts` | Test-build-only speech seam registry | no | 0 |
| `hooks/useVAD.ts` | Gains the seam call (phase 0), then becomes a re-export or is removed (phase 2) | yes (existing) | 0, 2 |

## 2. Phase 0: the oracle

### 2.1 Speech seam (H2), the only runtime change in phase 0

```ts
// app/session/testSeams.ts
/** True only when the build set NEXT_PUBLIC_TEST_SEAMS=1. Next inlines this at build time,
 *  so in every other build the seam code is dead and removed. */
export const TEST_SEAMS_ENABLED: boolean;

export interface VadSeam { speechStart(): void; speechEnd(samples?: Float32Array): void; misfire(): void }
/** Registers the live VAD's callbacks as window.__testSeams.vad. No-op unless enabled. */
export function registerVadSeam(seam: VadSeam | null): void;
```

- **`hooks/useVAD.ts`** (load-bearing, deep): inside `loadVad`, after `MicVAD.new` and only
  when `TEST_SEAMS_ENABLED`, register the seam with the same `onSpeechStart`,
  `onSpeechEnd` and `onVADMisfire` functions passed to vad-web. The seam is unregistered on
  stop or unmount, keyed by generation. Default `samples` is 0.5 s of silence at 16 kHz.
  No other change.
- **`playwright.config.ts`**: the frontend web server's `env` gains
  `NEXT_PUBLIC_TEST_SEAMS: "1"` and `NEXT_DIST_DIR: ".next-e2e"`.
- **Separate e2e build output (gate 3 amendment A2).** Today the e2e web server runs
  `npm run build && npm run start` into the same `.next` as the normal build, so a seam
  build would overwrite it.
  - `next.config.mjs` sets `distDir` from `NEXT_DIST_DIR`, defaulting to `.next`.
  - The e2e build and `next start` both use `.next-e2e`, which is added to `.gitignore`.
  - A seam build therefore never lands in `.next`, whatever order the gates run in.
- **Production guard:** a new frontend script `check:no-test-seams` scans `.next/static`
  after a normal build (flag unset) and fails if the string `__testSeams` appears.
  - The string may appear only inside the `TEST_SEAMS_ENABLED` branch, so dead-code removal
    drops it.
  - **Enforcement: a CI step** in `.github/workflows/ci.yml`, after the frontend build (owner,
    gate 3, 2026-11-17). It is added in the same phase 0 slice that creates the script, not
    before, because a step pointing at a missing script would fail every PR. That slice
    touches a load-bearing path (`.github/workflows/**`), so it gets deep gates and a human read.

### 2.2 E2E support module (new, shared by the new specs)

```ts
// e2e/support/session.ts
export interface ProxyControl {
  /** Holds the next server frame of this type until release() is called. */
  hold(type: "tts_end" | "tts_start" | "session_complete" | "session_failed"): void;
  release(): void;
  /** Sends a server frame the mock never produces (stt_error, session_failed, close codes). */
  inject(frame: object | { close: number; reason?: string }): void;
  /** Ordered client→server frame types seen so far (O3). "audio" for binary frames. */
  clientFrames(): string[];
}
/** routeWebSocket proxy. Replaces each mock tts_chunk with fixtures/silence-250ms.mp3 so playback
 *  really happens, and forwards everything else. */
export function proxySession(page: Page): Promise<ProxyControl>;

export interface Probes {
  liveTracks(): Promise<number>;                 // getUserMedia wrapper (as resume.spec.ts)
  focusTarget(): Promise<string>;                // role + accessible name of activeElement
  insertions(selector: string): Promise<number>; // MutationObserver counter
}
export function installProbes(page: Page): Promise<Probes>;

export const speech: { start(page: Page): Promise<void>; end(page: Page): Promise<void> };

/** Per-region visible-state recorder (O4). Regions: panelStatus, hearing, paused, endDialog,
 *  warning, typing, overlay, focus. Collapses repeats; records order only. */
export function recordRegions(page: Page): Promise<{ stop(): Promise<RegionTrace> }>;
export type RegionTrace = Record<RegionName, string[]>;
/** Compares with e2e/golden/<name>.json. With UPDATE_GOLDEN=1 it writes the file instead. */
export function expectGolden(name: string, trace: { frames: string[]; regions: RegionTrace }): Promise<void>;
```

### 2.3 Fixtures (new, generated, committed)

| File | Made with | Content |
|---|---|---|
| `e2e/fixtures/silence-250ms.mp3` | `ffmpeg -f lavfi -i anullsrc=r=24000:cl=mono -t 0.25 -c:a libmp3lame` | Silence, ≥512 bytes. A README line records the exact command. |
| `e2e/fixtures/phrase.wav` | `ffmpeg -f lavfi -i "flite=text='I would like to talk about my first job'"`, resampled to 16 kHz | Synthetic speech for the H3 realism check. Not a real person or interview. |

### 2.4 Phase 0 test list (all new files)

| # | File | Test | Proves |
|---|---|---|---|
| T1 | `tests/unit/audioQueue.test.ts` | enqueue/flushBuffer below and above 512 bytes; flush bumps the generation and discards in-flight decodes; suspend/resume report playing; dispose | Pins `AudioQueue` (fake AudioContext) |
| T2 | `tests/unit/useWebSocket.test.ts` | Partial/final transcript merge; out-of-order final; `interrupt` resets streaming and refs; close codes → reasons; binary vs JSON send | Pins the socket hook (fake WebSocket). **No reconnect or close-suppression cases**: those shipped with #110 in `tests/unit/useWebSocketReconnect.test.ts` (PR #118). T2 may import that file's `FakeSocket` pattern but must not repeat its cases (amendment A4). |
| T3 | `e2e/reply-audio.spec.ts` | Greeting plays (proxy MP3); answer via seam after playback ends → `turn_timing` then `audio`; answer with no playback before it → no `turn_timing` | O2 and O3 for 4.2 |
| T4 | `e2e/interrupt.spec.ts` | Hold `tts_end`; seam speech while playing → panel "interrupted" immediately, `interrupt` frame before any later audio frame, playback stopped, no `turn_timing` for that answer | O2 for 4.3 and the CLAUDE.md interrupt contract |
| T5 | `e2e/connection.spec.ts` | Inject close 1001 → Connection lost with timeout wording; Start over → new `session_start`; End from Connection lost → report route; live tracks recorded | O2 for 4.8. It records today's carried-over state as golden, which D3/D7 later change on purpose. |
| T6 | `e2e/server-events.spec.ts` | Inject `stt_error` → toast for 3 s; inject `session_failed` → failed overlay, live tracks 0 | O2 |
| T7 | `e2e/design-try.spec.ts` | `mode=design`: end → making draft → editor route (mock draft); `mode=try`: draft rejected 1008 → rejected overlay; try end → return route | O2 for both modes |
| T8 | `e2e/end-settling-pause.spec.ts` | Footer Pause during end-dialog settling: records today's end state | O2. Records current behaviour, including the defect, which D5 changes on purpose. |
| T9 | `e2e/realism.spec.ts` | `phrase.wav` as fake capture → a user transcript entry and a reply arrive | H3 |
| T10 | `e2e/golden-traces.spec.ts` | Scenarios: start-to-first-reply, pause-resume, end-confirm-dismiss, interrupt, connection-lost-start-over; each records O3 + O4 and compares with `e2e/golden/*.json` | O3/O4 baseline |

Every phase 0 e2e test also asserts `liveTracks()` where the scenario ends with the
microphone supposed to be closed.

## 3. Phase 1: cheap structural wins

### 3.1 Remount on Start over (D3, D4, D7's reset half; supersedes #110's symptom path)

```ts
// app/session/SessionLoader.tsx
const [sessionKey, setSessionKey] = useState(0);
const [restart, setRestart] = useState<{ startMic: boolean } | null>(null);
<View key={sessionKey} ... restart={restart} onStartOver={(micUsed) => { setRestart({ startMic: micUsed }); setSessionKey(k => k + 1); }} />

// app/session/page.tsx, SessionViewProps gains:
restart?: { startMic: boolean } | null;   // set when this mount replaces a session the person left with Start over
onStartOver: (micUsed: boolean) => void;   // replaces calls to reconnect() for normal and design modes
```

- Contract: Start over unmounts the whole view, so every piece of page, VAD, socket and
  audio state is dropped by React, not reset by hand.
- The new mount opens a new socket.
- It starts the microphone on mount when `restart.startMic` is true, as a "start" attempt
  (D3 wording), in addition to today's gesture-flag path.
- The design retry uses the same path. `reconnect()` stays in `useWebSocket` for now
  (removed in phase 3).

### 3.2 Session history (gate 1 criterion 4; load-bearing)

```ts
// app/session/history/labels.ts
export type HistoryEventInput =
  | { kind: "ws"; type: ServerMessage["type"] | "open" | "close"; code?: number }
  | { kind: "send"; type: ClientMessage["type"] }
  | { kind: "mic"; type: "start" | "ready" | "failed" | "pause" | "resume" | "reopened" | "reopenFailed" | "stop" | "speechStart" | "speechEnd" | "misfire" }
  | { kind: "ui"; type: "pause" | "resume" | "endClick" | "endConfirm" | "endDismiss" | "startOver" | "sendText" | "toggleTyping" }
  | { kind: "audio"; type: "playing" | "stopped" | "flush" | "suspend" | "resume" }
  | { kind: "timer"; type: "hearingDeadline" | "thinkingWatchdog" | "interruptSettle" };
/** Returns a fixed label built only from the kind, type and numeric code. Never reads strings
 *  from payloads: the input type carries none. */
export function eventLabel(e: HistoryEventInput): string;

// app/session/history/history.ts
export interface HistoryEntry { t: number; label: string; screen: ScreenSnapshot }
export interface ScreenSnapshot { connection: string; turn: string; mic: string; paused: boolean; end: string }
export class SessionHistory {
  constructor(capacity?: number); // default 500
  record(e: HistoryEventInput, screen: ScreenSnapshot, t: number): void;
  entries(): readonly HistoryEntry[];
  toText(): string;               // the copy format
}
```

- In phase 1 the page's existing handlers call `history.record(...)`. In phase 2 the
  interpreter becomes the only caller.
- `SessionHistoryPanel` renders only when `isDebug()` is true.

### 3.3 Phase 1 test list

| # | File | Test | Proves |
|---|---|---|---|
| P1 | `tests/unit/sessionHistory.test.ts` | Ring capacity; order; `toText` format; **sentinel test**: every `HistoryEventInput` variant, built inside a session that carries sentinel transcript, draft and reason strings, never yields the sentinel in `entries()` or `toText()` | Privacy of the history |
| P2 | `e2e/start-over-clean.spec.ts` | After Connection lost while paused, thinking, or with the end dialog open, Start over gives a clean session: not paused, not thinking, End works, mic goes "Getting ready…" then ready, live tracks 1 | D3, D4, D7 (reset) |
| P3 | `e2e/debug-history.spec.ts` | `?debug=1` shows the history and copy; without it, nothing; the history text contains no transcript words from the session | Gate 1 criterion 4 |

T5's and T8's golden entries for D3/D4/D7 are updated **in the same slice as the change**,
flagged for human read (§7).

## 4. Phases 2-5: core types (contract level)

```ts
// app/session/core/types.ts
export type Attempt = number; export type SocketId = number; export type OpId = number; export type TurnId = number;
export interface SessionConfig { mode: "normal" | "design" | "try"; start: string | InterviewerInput; demo: boolean; startMicOnMount: boolean }

export type MicRegion =
  | { s: "off" }
  | { s: "starting"; attempt: Attempt; overdue: boolean }
  | { s: "ready" }
  | { s: "reopening"; attempt: Attempt; before: "ready" | "failed"; overdue: boolean }
  | { s: "failed"; attempt: Attempt; kind: "start" | "resume" };
// While paused, mic is "ready" or "failed" as today; the pause region says paused.
export type PauseRegion =
  | { s: "running" } | { s: "pausing"; op: OpId } | { s: "paused" } | { s: "resuming"; op: OpId };
export type EndFlowRegion =
  | { s: "none" } | { s: "confirming"; pausedByDialog: boolean } | { s: "settling"; resume: boolean } | { s: "ending" };
export type ConnectionRegion =
  | { s: "connecting"; socket: SocketId } | { s: "open"; socket: SocketId; sessionId: string | null }
  | { s: "lost"; socket: SocketId; code: number } | { s: "ended"; how: "complete" | "failed"; reportId: string | null };
export interface ConversationRegion {
  turn: "listening" | "thinking" | "speaking" | "interrupted"; turnId: TurnId;
  serverStreaming: boolean; transcript: TranscriptEntry[]; pendingAssistantId: string | null; lastAiEntryId: string | null;
  phase: string; lastPlaybackEndedAt: number | null;
}
export interface PlaybackRegion { playing: boolean }
export interface OverlaysRegion { sttToast: boolean; typingOpen: boolean; draft: InterviewerInput | null; makingDraft: boolean; draftStoreFailed: boolean; draftRejected: boolean }
export interface SessionState { mic: MicRegion; pause: PauseRegion; end: EndFlowRegion; connection: ConnectionRegion; conversation: ConversationRegion; playback: PlaybackRegion; overlays: OverlaysRegion; nextId: number }

export type SessionEvent = /* ui.*, ws.* (each with socket), mic.* (each with attempt), audio.* (with t and op), timer.expired{id, t} */;
export type Command =
  | { c: "ws.connect"; socket: SocketId } | { c: "ws.send"; socket: SocketId; msg: ClientMessage } | { c: "ws.close"; socket: SocketId }
  | { c: "mic.start"; attempt: Attempt } | { c: "mic.pause" } | { c: "mic.resume"; attempt: Attempt } | { c: "mic.stop" }
  | { c: "audio.enqueue"; data: ArrayBuffer } | { c: "audio.flushBuffer" } | { c: "audio.flush" } | { c: "audio.suspend"; op: OpId } | { c: "audio.resume"; op: OpId }
  | { c: "timer.start"; id: string; ms: number } | { c: "timer.cancel"; id: string }
  | { c: "nav.go"; to: string } | { c: "draft.store"; draft: InterviewerInput };
export interface Step { state: SessionState; commands: Command[] }

// app/session/core/transition.ts
/** Pure, total, never throws, never mutates. Unknown or stale events return the same state
 *  object and no commands. */
export function transition(state: SessionState, event: SessionEvent): Step;

// app/session/runtime/store.ts
export interface SessionStore { getState(): SessionState; subscribe(fn: () => void): () => void; send(e: SessionEvent): void; history: SessionHistory; dispose(): void }
/** send() runs transition, then runs the commands in order, synchronously. Events raised by
 *  adapters while commands run are queued FIFO and processed before send() returns.
 *  A chain longer than 100 events per send() is a bug: it throws in tests and logs once in
 *  production. */
export function createSessionStore(adapters: Adapters, config: SessionConfig): SessionStore;
```

**Rules for each region slice (phases 2-5)**
1. An exhaustive table test of `transition` for that region: every (state, event) pair.
   Stale-id events must return the same object.
2. Golden traces: O3 unchanged; O4 unchanged except the D items that region owns.
3. The hook-test policy from gate 2 §0.3 applies.

Named cases that must exist:
- the #86 sequence;
- a timer for an older attempt ignored;
- interrupt synchronous, FIFO ordering of `audio.stopped`;
- the watchdog only in the same `turnId`;
- `stt_error` does not leave speaking;
- pause shows paused only after `audio.suspended{op}`;
- Start over ignores old-socket events.

## 5. Call stacks (after phase 2, main flow)

```
vad-web onSpeechStart (callback)
└─ micAdapter → store.send({ e: "mic.speechStart", t })
   └─ transition: conversation speaking → interrupted(turnId), commands:
        ws.send{interrupt}, audio.flush, timer.start{interruptSettle:turnId, 200}
      ├─ socketAdapter.send(interrupt)            (synchronous, as today)
      ├─ audioAdapter.flush() → raises audio.stopped{t}  → queued (FIFO)
      └─ timerAdapter.start(...)
   └─ queued audio.stopped processed → playback.playing=false, lastPlaybackEndedAt=null
   └─ notify subscribers once → React re-renders from one consistent state
```

## 6. Selectors keep today's DOM contracts

The view must produce byte-identical attributes and text where tests read them:
- `data-hearing` (`off | starting | ready | failed`, mapped from mic and pause regions as
  today, including "ready" while paused);
- the panel status text and avatar state (`AgentPanel` input unchanged);
- the alert wording chosen by attempt kind.

A unit test per selector compares against the current `sessionDisplay.ts` behaviour.

## 7. Golden-file policy

Golden traces (`e2e/golden/*.json`) are treated as existing test files
(`TESTS_ARE_LOAD_BEARING`):
- Created in phase 0.
- Changed only in a slice that implements an owner-approved D item. The changed entries are
  listed in the PR body, and the PR is draft with a human read.
- `UPDATE_GOLDEN=1` is never used in CI.
- **Flake bar (amendment A3).**
  - A new golden trace, or a new e2e spec that records one, is committed only after it
    passes `npx playwright test <spec> --repeat-each=10` with no failures. The run's summary
    line goes in the PR body.
  - The same bar applies when a golden file is changed.
  - Reason: e2e is a required gate, so one flaky golden test turns every factory run RED.

**Existing hook tests replaced in phase 3 (amendment A4).** When the socket adapter replaces
`app/hooks/useWebSocket.ts`, `tests/unit/useWebSocketReconnect.test.ts` (#110) and T2 fall
under the gate 2 hook-test policy. An equivalent test must exist at the adapter or core
boundary first, including the cases "Start over ignores old-socket events" and "a later
socket's close is never suppressed". Only then are the hook tests removed, in a draft PR
with a human read.

## 8. The three decisions I am least confident about

1. **The test seam ships inside a load-bearing file, and the e2e build differs from
   production.**
   - E2E runs a build with `NEXT_PUBLIC_TEST_SEAMS=1`, so the oracle tests a build that
     has the seam compiled in.
   - [Likely] Next inlines the constant and drops the dead branch. The `check:no-test-seams`
     CI step catches a leak, and the separate `.next-e2e` output (A2) keeps the seam build
     out of `.next`.
   - Residual risk: a behaviour difference caused by the seam itself. It is mitigated by H3,
     which uses no seam, though H3 only covers the reply path.
   - The alternative is driving speech only through `phrase.wav`. That gives realism but
     loses determinism, since Silero's timing would decide test outcomes.
2. **Remount-on-Start-over in phase 1 changes what restarts the microphone.**
   - Today the old VAD survives Start over. After remount the microphone starts fresh, as a
     "start" attempt, when the person had used it, under the transient user activation of
     the Start over click.
   - [Likely] The activation window covers it, because the mount's effects run within
     milliseconds of the click.
   - If a browser rejects it, the person sees "didn't start" and can type, which is no worse
     than today's carried-over state, but it is new.
   - P2 checks it in Chromium only.
3. **Resolved (owner, gate 2/3): the store is load-bearing.** `app/session/runtime/**` is in
   CHARTER.md and DECISIONS.md (2026-11-17). The original reasoning is kept below for the record.
   **The store is not load-bearing, though it executes every command.**
   - My reasoning: all decisions are in the core, and the store is a thin loop.
   - Against: the ordering guarantees (synchronous run, FIFO) are exactly what fixed FQ-47
     and FQ-98, and they live in the store.
   - If you want it protected, add `apps/frontend/app/session/runtime/**` to the charter
     change. I lean towards adding it. The cost is about two more deep slices.

## 9. Open for the checkpoint after phase 1

- Phase 2-5 test lists re-cut from real phase 0 traces.
- The gap after `tts_end` (gate 2 §6): measure under the proxy before deciding.
- Re-estimate the deep-slice count against your actual review pace.
