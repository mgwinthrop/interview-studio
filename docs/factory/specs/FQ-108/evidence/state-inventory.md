<!-- Generated 2026-11-17 by a delegated read-only agent from code and git history (shallow clone). Not browser-verified. Spot-checked by the spec author: framework versions (package.json), the lint downgrade (eslint.config.mjs), the hearing-deadline mechanism (reproduced in a browser for #107), and the deliberateCloseRef reconnect flag (confirmed by reading useWebSocket.ts). Items marked [inference] or [uncertain] are unverified. -->

# FQ-108 groundwork: client session runtime inventory

All paths below are relative to `apps/frontend/` unless they start with `docs/`.
Line numbers are for the working tree as read on 2026-11-17 (HEAD includes `1be68b4`).

Conventions: `file:line`. **[inference]** = not directly visible in code (reasoned from code, not run). **[uncertain]** = depends on browser/React scheduling not verified here.

Runtime versions (relevant to section 3): `package.json:16-19` pins **Next ^16.4.6, React ^19.3.1** (upgraded in `bdce1b1`, 2026-11-13). CLAUDE.md still says Next 14. React 19 keeps React 18's automatic batching and passive-effect timing rules, so the analysis below uses those rules. `eslint.config.mjs:8-13` downgrades `react-hooks/set-state-in-effect` and related React Compiler rules to warnings "until those effects are reworked".

Files in scope and what they hold:

| File | Holds state? |
|---|---|
| `app/session/page.tsx` (663 lines) | `SessionView`: almost all page state, all sync effects, all handlers |
| `app/session/SessionLoader.tsx` | mode parsing, interviewer/draft loading |
| `app/session/ModeParts.tsx` | presentational only (comment at :1-2); no state |
| `app/session/styles.ts` | values only (:1) |
| `app/session/timing.ts` | `THINKING_WATCHDOG_MS = 10_000` (:4) |
| `hooks/useVAD.ts` | mic/VAD lifecycle, `hearing` |
| `app/hooks/useWebSocket.ts` | socket lifecycle, server-driven state |
| `lib/audioQueue.ts` | `AudioQueue` class, playback state |
| `app/lib/sessionDisplay.ts` | pure derivations (no state) |
| `app/components/AgentPanel.tsx` | derives `AvatarState` (no state) |
| `app/components/InterviewerAvatar.tsx` | pure render by `state`; reduced motion in CSS `app/globals.css:381-386` |
| `app/components/LiveTranscript.tsx` | one scroll effect, no state |
| `app/components/MotionToggle.tsx` + `app/lib/motion.ts` | module-level store + localStorage |
| `app/lib/voiceSession.ts` | reads sessionStorage key |
| `app/lib/micDevice.ts` | localStorage key (mic choice) |
| `app/lib/interviewerForm.ts` | sessionStorage key (draft hand-off) |
| `app/lib/debug.ts` | reads `?debug=1` from URL; no state |

---

## 1. State inventory

### 1a. `app/session/page.tsx` (`SessionView`)

| name | kind | writers | readers | represents | values |
|---|---|---|---|---|---|
| `audioPlaying` | useState :47 | `handlePlaybackChange` :58 (called by AudioQueue) | `displayedOrbState` :520; `useVAD` arg `aiSpeaking: aiSpeaking \|\| audioPlaying` :182 | local audio is audibly playing (AudioQueue view) | bool |
| `audioQueueRef` | useRef :48 | effect :60-64 (create/dispose) | `handleAudioChunk` :72, `handleTtsEnd` :76, `sendMessageWithFlush` :160, mic effect :195, `handlePause` :228, `handleResume` :235, sessionFailed effect :309, `handleEndSession` :391,396, `handleDesignRetry` :448 | the one AudioQueue instance | AudioQueue \| null |
| `lastPlaybackEndedAtRef` | useRef :51 | `handlePlaybackChange` :55 (stamp on playing→not), aiSpeaking effect :120 (null), `sendMessageWithFlush` :163 (null on interrupt), `getResponseGapMs` :176 (consume), `handlePause` :230 (null) | `getResponseGapMs` :172 | time playback last finished, for `turn_timing` | number(ms) \| null |
| `audioPlayingRef` | useRef :52 | `handlePlaybackChange` :57 | `handlePlaybackChange` :54, `getResponseGapMs` :174 | sync mirror of `audioPlaying` | bool |
| `makingDraftRef` | useRef :68 | `handleEndSession` :392 (true), `handleDesignRetry` :444 (false) | `handleAudioChunk` :71 (drop audio) | design: draft being made, ignore speech | bool |
| `sttError` | useState :80 | `handleSttError` :82 (true), its `setTimeout` :84 (false, never cleared) | render :618 | show STT toast | bool |
| `orbState` | useState :108 | aiSpeaking effect :126,128; `handleSpeechSent` :133; watchdog :137; `handleInterrupt` :147; interrupt timer :149; `handleSttError` :83 | `displayedOrbState` :520 | conversational turn state | `"listening"\|"thinking"\|"speaking"\|"interrupted"` (`app/types.ts:7`) |
| `interruptTimerRef` | useRef :110 | `handleInterrupt` :145-150 | `handleInterrupt` :144 | 200 ms interrupted→listening timer | timeout id \| null |
| `watchdogRef` | useRef :112 | `handleSpeechSent` :135-138, watchdog cb :138, aiSpeaking effect :122-124 | same | thinking watchdog (10 s) | timeout id \| null |
| `isPaused` | useState :207 | `handlePause` :231 (true), `handleResume` :237 (false) | focus effect :216-224, end-focus effect :259-264, `handleEndClick` :412,414, `interviewerSpeaking` :521, AgentPanel `paused` :585, PausedOverlay gate :613, SessionFooter :636 | presenter pause shown | bool |
| `pauseOverlayButtonRef` | useRef :210 (DOM) | React | focus effects :220,262 | Resume button | element |
| `prePauseFocusRef` | useRef :211 | focus effect :219 | focus effect :222 | element to refocus after pause | HTMLElement \| null |
| `endFlowOwnsFocusRef` | useRef :215 | `handleEndClick` :411 (true), end-focus effect :261 (false) | focus effect :217, end-focus effect :260 | end dialog flow owns focus | bool |
| `endDialogRef`, `endButtonRef` | useRef :247-248 (DOM) | React | showModal effect :256, `handleEndConfirmed` :438, Keep talking :647, end-focus :263 | dialog / End button | element |
| `confirmingEnd` | useState :249 | `handleEndClick` :415 (true), `handleEndDialogClose` finally :432 (false) | showModal effect :257, end-focus effect :260, `handleEndClick` guard :409 (FQ-98), PausedOverlay gate :613 | end flow active (open or settling; permanently true after confirm) | bool |
| `pausedByEndDialogRef` | useRef :250 | `handleEndClick` :412, `handleEndDialogClose` :423 | `handleEndDialogClose` :422 | the dialog made the pause | bool |
| `endDialogPauseRef` | useRef :253 | `handleEndClick` :414, `handleEndDialogClose` :425 | `handleEndDialogClose` :424 | the dialog's pending pause promise | Promise \| null |
| `endConfirmedRef` | useRef :254 | `handleEndClick` :410 (false), `handleEndConfirmed` :437 (true) | `handleEndDialogClose` :420 | user confirmed end | bool |
| `elapsed` | useState :267 | interval :269 | render :476-477 | seconds since mount (not since session start; survives reconnect) | int ≥0 |
| `showTextInput` | useState :274 | cannotHear effect :294 (true only), footer toggle :635 | render :630, footer :634 | text bar open | bool (sticky true from effect) |
| `hearingDeadlinePassed` | useState :282 | deadline effect :288 (false), its timer :289 (true) | `hearingUnavailable` :292, `panelState` :581 | 10 s since last epoch | bool |
| `hearingEpoch` | useState :283 | epoch effect :285 | deadline effect deps :291 | count of observed transitions into `"starting"` | int |
| `textInput` | useState :296 | `TextInputBar` onChange :630, `handleTextSend` :302 | `handleTextSend` :299 | typed text | string |
| `leftTrialRef` | useRef :333 | try effect :338, `goToReportOrHome` :373 | :337, :372 | try: navigation already started | bool |
| `draftStoreFailed` | useState :345 | `handOffDraft` :349,352 | early return :483, focus effect :469 | design: sessionStorage refused draft | bool |
| `makingDraft` | useState :360 | `handleEndSession` :393, `handleDesignRetry` :445 | early return :515, focus :462 | design: "Making your draft…" | bool |
| `micUsedRef` | useRef :363 | effect :365 | `handleDesignRetry` :447 | mic ever active | bool |
| focus-target refs | useRef :459,460,467,471 (DOM) | React | focus effects :461-474 | overlay buttons/heading | element |

Constants/props read as state: `debug` :41 (URL each render), `mode`, `start`, `returnTo`, `demo`, `interviewer` (props, fixed per mount).

### 1b. `hooks/useVAD.ts`

| name | kind | writers | readers | represents | values |
|---|---|---|---|---|---|
| `micActive` | useState :45 | `loadVad` :230 (true), `stopMic` :258 (false) | returned; page `micUsedRef` effect :365 | a VAD has started once in this generation (not reset by pause or resume failure) | bool |
| `hearing` | useState :46 | `startMic` :239 starting; `loadVad` :198,218 failed, :231 ready; `resumeMic` :280 starting, :283 ready, :288 failed; `stopMic` :259 off. **`pauseMic` never writes it** | page :285,292,581,582 | voice detection listening | `"off"\|"starting"\|"ready"\|"failed"` (`app/types.ts:11`) |
| `micFallback` | useState :47 | `openMic` :119, `startMic` :241, `stopMic` :260, `resumeMic` failure :287 | page :601-602 | remembered mic missing, default used | `{label, using}` \| null |
| `hearingAttempt` | useState :48 | `startMic` :240 "start", `resumeMic` :281 "resume" | page :623 (alert wording) | which kind of attempt was last | `"start"\|"resume"` |
| `resumeSeqRef` | useRef :51 | `pauseMic` :265 (++), `resumeMic` :278 (++) | `openMic` :115 via `resumeStream` :143, `resumeMic` `current()` :279 | reopen staleness token | int |
| `vadRef` | useRef :52 | `loadVad` :227, `stopMic` :256, unmount :303 | `startMic` :236, `pauseMic` :266, `resumeMic` :275 | live MicVAD | MicVAD \| null |
| `genRef` | useRef :56 | `startMic` :238, `stopMic` :253, unmount :300 | all VAD callbacks :153,165,187; `openMic` :115; `loadVad` :196,207,215,222; `resumeMic` :277,279 | start generation | int |
| `startingRef` | useRef :58 | `startMic` :243,248, `stopMic` :254, unmount :301 | `startMic` :237 | in-flight start promise | Promise \| null |
| `unmountedRef` | useRef :61 | mount effect :297 (false), cleanup :299 (true) | `loadVad` :88,207, `startMic` :235 | between unmount and remount | bool |
| `pausedRef` | useRef :64 | `pauseMic` :264 (true), `resumeMic` :274 (false), `stopMic` :257 (false) | `loadVad` :229, `resumeMic` :273 | a pause is requested (applies to a loading start) | bool |
| `aiSpeakingRef` | useRef :67 | effect :68 | `onSpeechStart` :155,159 | mirror of arg `aiSpeaking` (= page `aiSpeaking \|\| audioPlaying`) | bool |
| `sendMessageRef`, `onSpeechSentRef`, `onInterruptRef`, `getResponseGapMsRef` | useRef :71-78 | effects :72,74,76,78 | VAD callbacks :160,161,177,179,182,183 | latest callbacks | fn |
| `speechStartedAtRef` | useRef :81 | `onSpeechStart` :154, `onSpeechEnd` :174, `onVADMisfire` :189 | `onSpeechEnd` :172 | current utterance start time | number \| null |
| `startedDuringAiSpeechRef` | useRef :83 | `onSpeechStart` :155, `onSpeechEnd` :175, `onVADMisfire` :190 | `onSpeechEnd` :173 | current utterance is a barge-in | bool |
| `opened` (closure local in `loadVad`) | let :89 | `getStream` :137 | `stopOpened` :90 | first stream of this start | MediaStream \| null |

Hidden library state that matters: vad-web `MicVAD.listening` / `initializationState` (`node_modules/@ricky0123/vad-web/dist/real-time-vad.js:267-299`). On resume (`initialized` case) it sets `listening = true` **before** awaiting `resumeStream` (:271-274), so a rejected reopen leaves vad-web believing it is listening; `pause()` returns early unless `listening` (:295-297).

### 1c. `app/hooks/useWebSocket.ts`

| name | kind | writers | readers | represents | values |
|---|---|---|---|---|---|
| `sessionId` | useState :52 | effect reset :114, `session_started` :219 | page :378,383,540,588 | server-issued id | string ("" before) — **not cleared on close** |
| `connectionState` | useState :53 | `reconnect` :81, effect :109 error, :130 connecting, `onopen` :133 connected, `onerror` :248 error, `onclose` :257 disconnected | page :317,383,501,521,586 | socket state | `"connecting"\|"connected"\|"disconnected"\|"error"` |
| `phase` | useState :54 | reset :115, `phase_change` :215 | page :105 | current phase name | string |
| `transcript` | useState :55 | reset :116, `transcript` :181,187,195,203,207 | page → LiveTranscript :605 | entries | array |
| `aiSpeaking` | useState :56 | reset :117, `tts_start` :162, `tts_end` :167, `session_failed` :228, `sendMessage` on interrupt :99 (only if socket OPEN, guard :86) | page :116-130, :182, LiveTranscript :606 | server says a reply is streaming | bool |
| `sessionComplete` | useState :57 | reset :118, `session_complete` :223 | page :327,337,456,502 | ended complete | `{reportId}` \| null |
| `sessionFailed` | useState :58 | reset :119, `session_failed` :229 | page :307,456,491,493 | ended failed | bool |
| `lastLatencyMs` | useState :59 | reset :120, `latency_metric` :238 | page :587 (debug only) | ms | number \| null |
| `closeReason` | useState :60 | reset :121, `onclose` :255 | ConnectionLostOverlay :507 | text for close code | string \| null |
| `closeInfo` | useState :61 | reset :122, `onclose` :256 | page `draftRejected` :318-319 | last unexpected close | `{code, reason}` \| null |
| `draft` | useState :62 | reset :123, `draft` :234 | page :347,356,456,502 | designer's draft | InterviewerInput \| null |
| `wsRef` | useRef :64 | effect :129, cleanup :265 | `sendMessage` :86-93 | live socket | WebSocket \| null |
| `pendingAssistantIdRef` | useRef :67 | reset :124, transcript handler :176,179,194, interrupt :100 | transcript handler | entry receiving partials | id \| null |
| `lastAiEntryIdRef` | useRef :71 | reset :125, handler :180,202,206, interrupt :101 | handler :173 | last assistant entry (out-of-order final) | id \| null |
| `reconnectTrigger` | useState :74 | `reconnect` :82 | effect deps :270 | socket generation | int |
| `deliberateCloseRef` | useRef :77 | `reconnect` :80 (true), cleanup :263 (true), `onclose` :259 (false) | `onclose` :254 | suppress next onclose | bool |
| `onAudioChunkRef`/`onTtsEndRef`/`onSttErrorRef` | plain objects per effect run :142-144 | never updated after creation | onmessage | callbacks captured at socket open (comment says "latest version"; they are not refreshed) | fn |

### 1d. `lib/audioQueue.ts` (class `AudioQueue`, one per page mount)

| field | writers | readers | represents | values |
|---|---|---|---|---|
| `context` :7 | ctor :22 | everywhere; `dispose` closes :118 | AudioContext | state `suspended\|running\|closed` |
| `nextStartTime` :8 | `scheduleDecoded` :65, `flush` :112 | `scheduleDecoded` :50 | scheduling cursor | seconds |
| `chunkBuffer` :9 | `enqueue` :74, `flushBuffer` :84,94, `flush` :109 | `flushBuffer` | MP3 bytes since last `tts_end` | Uint8Array[] |
| `decodeChain` :13 | `scheduleDecoded` :35, `flush` :111 | `scheduleDecoded` | serial decode chain | Promise |
| `flushGeneration` :15 | `flush` :110 | `scheduleDecoded` :34,36,45,61 | discards stale decodes | int |
| `sources` :17 | `scheduleDecoded` :53, `onended` :55, `flush` :107 | `resume` :29, `onended` :56, timer :61 | scheduled/playing nodes | Set |
| `playbackTimer` :18 | `scheduleDecoded` :59-60, `flush` :100-101 | `scheduleDecoded` :58 | delayed "playing=true" report at `startAt` | id \| null |
| `disposed` :19 | `dispose` :116 | :36,45,61 | disposed | bool |
| `onPlaybackChange` (ctor arg) :21 | — | calls: `resume` :29 (`sources.size>0`), `onended` :56 (false when empty), timer :61 (true, only if running), `flush` :108 (false), `suspend` :125 (false) | page `handlePlaybackChange` | — |

### 1e. `app/session/SessionLoader.tsx` (`SessionPageInner`)

| name | kind | writers | readers | represents | values |
|---|---|---|---|---|---|
| `mode` | derived each render :58-59 | URL | render | session mode | `"design"\|"try"\|null` |
| `interviewer` | useState :65 | try effect :82, fetch effect :98 | render :112-131 | loaded interviewer | detail \| null |
| `loadFailed` | useState :66 | fetch effect :94,102 | :110 | fetch failed | bool |
| `loadAttempt` | useState :67 | Retry :110 | fetch effect deps :108 | retry counter | int |
| `tryDraft` | useState :69 | try effect :81 | :115,121-122 | try: stored draft | `{input, returnTo}` \| null |
| `tryDraftReadRef` | useRef :70 | :75 | :74 | read once | bool |

### 1f. Module-level and browser storage

| name | kind | owner | writers | readers | represents | values |
|---|---|---|---|---|---|---|
| `paused`, `started`, `listeners` | module vars `app/lib/motion.ts:28-30` | motion.ts | `start` :47-48, `toggle` :63 | `useSyncExternalStore` :61 | animation pause preference | bool |
| `studio_motion_paused` | localStorage `motion.ts:26` | motion.ts | `toggle` :65 | `readStored` :34 | same, persisted | "1"/"0" |
| `mic_gesture_granted` | sessionStorage | mic-check | `app/mic-check/page.tsx:203` (set "1") | `app/session/page.tsx:193-194` (read **and remove**, no try/catch), `app/lib/voiceSession.ts:5-9` (read, guarded), `app/page.tsx:23` (read) | a mic check just passed; doubles as the user-gesture token that starts the mic | "1" \| absent |
| `interview-studio:mic` | localStorage `app/lib/micDevice.ts:19` | micDevice | `saveMicChoice` :42 (also from `useVAD.openMic` :109), `clearMicChoice` :50 | `readMicChoice` :27 (each `openMic` :96) | chosen microphone | `{deviceId,label}` JSON |
| `interviewer_draft` | sessionStorage `app/lib/interviewerForm.ts:78` | interviewerForm | `storeDraft` :230 (page `handOffDraft` :348) | `peekDraft` (SessionLoader :76) | draft hand-off | JSON |

---

## 2. Derived values (computed each render, never stored)

| value | where | inputs | notes |
|---|---|---|---|
| `currentPhase` | page :105 | `phase`, `interviewer.phases` | |
| `useVAD` arg `aiSpeaking` | page :182 | `aiSpeaking`, `audioPlaying` | mirrored into `aiSpeakingRef` by effect `useVAD.ts:68` |
| `cannotHear` | page :292 → `hearingUnavailable` `sessionDisplay.ts:42-44` | `hearing`, `hearingDeadlinePassed` | `failed` or (`!= ready` and deadline passed) |
| `draftRejected` | page :315-319 | `mode`, `connectionState`, `closeInfo` | try + 1008 `"invalid draft"` |
| `designNotReady` | page :383 | `mode`, `connectionState`, `sessionId` | |
| `designFailed` | page :456 | `mode`, `sessionFailed`, `sessionComplete`, `draft` | |
| `leaveTo` | page :44 | `mode`, `returnTo` | |
| `connectionError` | page :501-502 | `connectionState`, `sessionComplete`, `draft` | |
| `shownOrbState` | page :520 → `displayedOrbState` `sessionDisplay.ts:30-32` | `orbState`, `audioPlaying` | playing and not interrupted → `"speaking"` |
| `interviewerSpeaking` | page :521 | `isPaused`, `connectionState`, `shownOrbState` | transcript badge/label |
| panel `orbState` | page :581 → `panelState` `sessionDisplay.ts:49-52` | `shownOrbState`, `hearing`, `hearingDeadlinePassed` | `listening` replaced by `starting`/`unavailable` unless hearing ready |
| `AvatarState` | `AgentPanel.tsx:25` | `paused`, `connectionState`, panel `orbState` | paused > connection state > orb; values `InterviewerAvatar.tsx:6` |
| caption text | `AgentPanel.tsx:31` | `AvatarState` | |
| alert wording | page :623 | `hearingAttempt` | |
| `lastEntryIsAi`, `currentQuestionIndex`, `exchangeCount` | `LiveTranscript.tsx:66-70` | `entries` | |
| cursor blink | `LiveTranscript.tsx:235` | `aiSpeaking` (server state, not `interviewerSpeaking`) | two "speaking" sources on one screen |
| `debug` | page :41 | URL | |
| `minutes`/`seconds` | page :476-477 | `elapsed` | |

---

## 3. Effects that synchronise state

Scheduling facts used here: React 18/19 batch all setState calls in one task. Passive effects (`useEffect`) of a render caused by a **discrete** event (click, keydown) are flushed synchronously at the end of that commit, before paint. Renders caused by anything else (WebSocket message, timer, promise continuation such as code after `await` in a click handler) get a default lane; their passive effects run after commit and the browser may paint the committed frame first **[uncertain whether a paint actually happens in each case]**. A setState inside an effect causes a further render.

| # | effect | deps | writes | intermediate render with inputs changed, output stale? |
|---|---|---|---|---|
| E1 | page :60-64 | `[handlePlaybackChange]` (stable) | `audioQueueRef` | First render has `audioQueueRef=null`; callbacks use `?.` |
| E2 | page :116-130 | `[aiSpeaking]` | `orbState` (speaking / speaking→listening), `lastPlaybackEndedAtRef`, `watchdogRef` | **Yes.** `tts_start` (WS message, default lane) commits `aiSpeaking=true` with `orbState` still `"thinking"`: the panel shows Thinking while the transcript cursor blinks; next render shows Speaking. `tts_end` commits `aiSpeaking=false` with orb `"speaking"` (shown as speaking anyway). Paint of that frame [uncertain] |
| E3 | page :192-201 | `[]` | removes `mic_gesture_granted`, calls `resume().then(startMic)` | n/a. Under StrictMode double-invoke, the first run removes the key and the second finds nothing; the first run's `startMic` still lands after remount because it is async [inference, uncertain] |
| E4 | page :204 | `[stopMic]` (stable) | unmount `stopMic` | n/a |
| E5 | page :216-224 | `[isPaused]` | DOM focus, `prePauseFocusRef` | Skipped while `endFlowOwnsFocusRef` |
| E6 | page :255-258 | `[confirmingEnd]` | `dialog.showModal()` | Render with `confirmingEnd=true` and dialog not yet open; from a click → effects flushed before paint (no visible gap) |
| E7 | page :259-264 | `[confirmingEnd, isPaused]` | focus, `endFlowOwnsFocusRef=false` | Runs when `confirmingEnd` falls; final focus decided here |
| E8 | page :268-271 | `[]` | `elapsed` (interval) | n/a |
| E9 | page :284-286 | `[hearing]` | `hearingEpoch++` when `hearing === "starting"` | **Yes, chained with E10.** Bumps only on a *change into* `"starting"`; `setHearing("starting")` when already `"starting"` bails out and E9 does not run (#86 defect 2) |
| E10 | page :287-291 | `[hearingEpoch]` | `hearingDeadlinePassed=false`, new 10 s timer → true | **Yes.** Render 1: `hearing="starting"`, old `hearingDeadlinePassed` (true if >10 s since last epoch, because the timer is never cancelled on `"ready"`). Render 2 (after E9): epoch new, deadline still old. Render 3 (after E10): deadline false. Renders 1 and 2 have `cannotHear=true`. After Resume the `setHearing` runs after `await` → default lane → frames can paint. FQ-86 `02-architecture.md:32-37` says this was reproduced in a browser |
| E11 | page :293-295 | `[cannotHear]` | `showTextInput=true` | Runs in the same effect pass as E9 for render 1 above, so a one-render `cannotHear` flash opens the text bar **for good** (nothing sets it back, only the user toggle) |
| E12 | page :306-311 | `[sessionFailed, stopMic]` | `stopMic()`, `flush()` | Render with failed overlay while mic still live until effect |
| E13 | page :320-322 | `[draftRejected, stopMic]` | `stopMic()` | same |
| E14 | page :326-330 | `[sessionComplete, router, mode]` | navigation | |
| E15 | page :336-341 | `[sessionComplete, router, mode, leaveTo]` | `leftTrialRef`, navigation | |
| E16 | page :355-357 | `[mode, draft, handOffDraft]` | `storeDraft`, nav or `draftStoreFailed` | Render with `draft` set and `makingDraft` true shows MakingDraftOverlay for one frame |
| E17 | page :364-366 | `[micActive]` | `micUsedRef` | |
| E18-21 | page :461-474 | `[makingDraft]`, `[designFailed]`, `[draftStoreFailed]`, `[draftRejected]` | focus only | |
| V1 | `useVAD.ts:68` | `[aiSpeaking]` | `aiSpeakingRef` | **Yes, for an external reader.** Between the commit of a new `aiSpeaking \|\| audioPlaying` and this passive effect, a VAD `onSpeechStart` reads the old value: a barge-in at that moment is not sent as `interrupt` (or a non-barge-in is) [inference, narrow window] |
| V2-5 | `useVAD.ts:72,74,76,78` | callback identity | callback refs | Callbacks are effectively stable (`useCallback` with stable deps) |
| V6 | `useVAD.ts:296-305` | `[]` | `unmountedRef`, `genRef`, `startingRef`, `vadRef`; destroys VAD | |
| W1 | `useWebSocket.ts:105-270` | `[reconnectTrigger]` | resets 10 state values, refs; opens socket | `reconnect()` sets `connectionState="connecting"` in the click; the render has old `transcript`/`sessionId`/`sessionFailed`/etc. until W1 runs. From a click → flushed before paint. Callbacks captured at :142-144 are those of the render that ran W1 |
| L1 | `SessionLoader.tsx:73-84` | `[]` | `tryDraft`, `interviewer` | both set together (batched) |
| L2 | `SessionLoader.tsx:87-108` | `[loadAttempt]` | `interviewer`, `loadFailed` | |
| T1 | `LiveTranscript.tsx:62-64` | `[entries]` | scroll only | |

---

## 4. Cross-module control flow

### 4.1 Session start
1. `SessionPageInner` parses mode (`SessionLoader.tsx:58-63`); try: `peekDraft` → `tryDraft`, `interviewer` (:73-84); else `fetchInterviewer` → `interviewer` (:87-108). `View` mounts only with an interviewer (:112).
2. `SessionView` first render: `orbState="listening"`, `hearing="off"`, `connectionState="connecting"`.
3. Effects in declaration order: E1 creates `AudioQueue` (new `AudioContext`, not in a gesture) → W1 resets WS state, `new WebSocket`, `connectionState="connecting"` → V-effects → E3 reads/removes `mic_gesture_granted`; if present `audioQueue.resume()` then `startMic()` → E8 timer → E10 epoch-0 deadline timer.
4. `ws.onopen` → `connectionState="connected"`, sends `session_start {interviewerId|draft, demo}` (`useWebSocket.ts:132-139`).
5. `startMic` → `hearing="starting"`, `hearingAttempt="start"`, `micFallback=null`, `genRef++` (:238-241) → E9 epoch++ → E10 restart deadline.
6. `loadVad`: `MicVAD.new` (fail → `hearing="failed"` :198) → `vad.start()` → `getStream` → `openMic` (localStorage choice, fallbacks, `micFallback`) (fail → `"failed"` :218) → `vadRef`, apply pending pause, `micActive=true`, `hearing="ready"` (:227-231).
7. Server: `session_started` → `sessionId`; greeting arrives as in 4.2 steps 7-11.

### 4.2 User utterance → reply audio
1. vad-web `onSpeechStart` (`useVAD.ts:152`): `speechStartedAtRef`, `startedDuringAiSpeechRef = aiSpeakingRef`. If AI not speaking: return.
2. `onSpeechEnd` (:164): PCM16 conversion inline; if not barge-in, `getResponseGapMs` (page :171-178: consumes `lastPlaybackEndedAtRef`) → `turn_timing` sent.
3. `sendMessage({type:"audio"})` → binary frame (`useWebSocket.ts:88-90`; dropped silently if socket not OPEN :86).
4. `onSpeechSent` → page `handleSpeechSent`: `orbState="thinking"`, watchdog 10 s (`:132-140`). Runs even if step 3 was dropped.
5. Server `transcript role:user` → appended, `lastAiEntryIdRef=null` (:204-211).
6. `latency_metric` → `lastLatencyMs`.
7. `tts_start` → `aiSpeaking=true` → E2: clear watchdog, `lastPlaybackEndedAtRef=null`, `orbState="speaking"`; V1 updates `aiSpeakingRef`.
8. Binary frames → `handleAudioChunk` → `AudioQueue.enqueue` (buffer only; dropped if `makingDraftRef`).
9. `transcript role:assistant partial` → create/update pending entry (:171-190); final → confirm (:191-197).
10. `tts_end` → `handleTtsEnd` → `flushBuffer()` (decode whole buffer; <512 bytes dropped :82-86) then `aiSpeaking=false` → E2 `"speaking"`→`"listening"`.
11. Decode resolves → `source.start(startAt)` with `startAt ≥ currentTime+0.1` → `playbackTimer` at `startAt` → `onPlaybackChange(true)` (only if context running) → `audioPlaying=true` → `shownOrbState="speaking"`.
12. Last `source.onended` → `onPlaybackChange(false)` → `lastPlaybackEndedAtRef=now`, `audioPlaying=false`.
- Gap between 10 and 11 (decode time + ≥100 ms): `aiSpeaking=false`, `audioPlaying=false` → orb Listening, `aiSpeakingRef=false`; speech starting then is not treated as barge-in and audio then plays over it [inference]. Whether tts_start/tts_end bracket a turn or a sentence is a server matter; the protocol doc says turn (`docs/websocket-protocol.md:87-88`), `audioQueue.ts:69-72` comments say sentence.

### 4.3 Interrupt (barge-in)
1. `onSpeechStart` with `aiSpeakingRef=true` (`useVAD.ts:159`).
2. `sendMessageRef({type:"interrupt"})` = page `sendMessageWithFlush` (:156-167) → `useWebSocket.sendMessage`: JSON sent; `aiSpeaking=false`, partial-entry refs cleared (:98-102) — **only if socket OPEN** (:86 returns first).
3. `audioQueue.flush()`: stops sources, `onPlaybackChange(false)` (→ stamps then `audioPlaying=false`), clears buffer, `flushGeneration++`, resets chain.
4. `lastPlaybackEndedAtRef=null` (:163).
5. `onInterruptRef` → `handleInterrupt`: `orbState="interrupted"`; 200 ms timer → `"listening"` **unconditionally** (:148-151).
6. E2 sees `aiSpeaking=false`: keeps `"interrupted"`.
7. `onSpeechEnd`: barge-in → no `turn_timing`; audio sent; `orbState="thinking"`.
- Binary frames and partial transcripts already in flight from the aborted reply are not filtered after the flush: chunks go to `chunkBuffer` and would be prepended at the next `flushBuffer`; a partial creates a new entry because the pending refs were cleared [inference; depends on server ordering, which is out of scope].

### 4.4 Pause (`handlePause` :226-232)
1. `pauseMic` (sync): `pausedRef=true`, `resumeSeqRef++`, `vad.pause()` (async). `hearing` unchanged.
2. `await audioQueue.suspend()` → `onPlaybackChange(false)` → `audioPlaying=false`.
3. `lastPlaybackEndedAtRef=null`; `isPaused=true` → E5 focus to Resume. PausedOverlay (`!confirmingEnd`).
- Between 1 and 3 the UI is not paused while the mic is (FQ-86 `02-architecture.md:148` notes it). No message to server; server may keep streaming; audio is decoded into the suspended context and `playbackTimer` skips the `true` report (`audioQueue.ts:61`). Thinking watchdog keeps running.

### 4.5 Resume (`handleResume` :234-238)
1. `await audioQueue.resume()` → `onPlaybackChange(sources.size>0)`.
2. `resumeMic`: if `!vadRef || !pausedRef` → nothing (hearing unchanged). Else `resumeSeqRef++`, `hearing="starting"`, `hearingAttempt="resume"`, `vad.start()` → `resumeStream` → `openMic(seq)` → `"ready"` or `"failed"` (+`micFallback=null`) if still current.
3. `isPaused=false` (same batch as step 2's setState).
4. Effects: E5 restores focus; E9/E10/E11 as in section 3 (flash + sticky text bar if >10 s since last epoch).

### 4.6 End-confirm dialog (normal mode only; `mode !== null` ends at once :403-406)
Open (`handleEndClick` :402-416): return if `confirmingEnd` (FQ-98) → `endConfirmedRef=false`, `endFlowOwnsFocusRef=true`, `pausedByEndDialogRef=!isPaused`, `endDialogPauseRef = isPaused ? null : handlePause().catch(()=>undefined)` → `confirmingEnd=true` → E6 `showModal()` → PausedOverlay hidden; E5 suppressed.
Close without ending (Escape / Keep talking → `dialog.close()` → `close` event → `handleEndDialogClose` :418-434): if confirmed return; if dialog paused: await its pause, `handleResume()`; finally `confirmingEnd=false` → E7 focus (Resume if still paused, else End Session), `endFlowOwnsFocusRef=false`.
Confirm (`handleEndConfirmed` :436-440): `endConfirmedRef=true`, `close()` (handler returns early, `confirmingEnd` stays true), `handleEndSession`.

### 4.7 End session
- Normal/try (:396-398): `flush()`, `session_end`, `goToReportOrHome` → `/report/<sessionId>` or `/` (normal), `leaveTo` once (try). Navigates immediately; does not wait for `session_complete`; VAD stays paused (dialog) until unmount E4/V6; W1 cleanup closes socket deliberately.
- Design (:386-394): ignored if `designNotReady`; `session_end`, `stopMic`, `flush`, `makingDraftRef=true`, `makingDraft=true` → server `draft` → E16 `storeDraft` → `/interviewers/edit?from=design` (or `draftStoreFailed`) ; `session_complete` without draft or `session_failed` → `designFailed` overlay → `handleDesignRetry` (:443-453): clear makingDraft, `reconnect()`, restart mic if ever used.
- Server-initiated: `session_complete` → E14 (normal) / E15 (try); `session_failed` → `aiSpeaking=false`, `sessionFailed` → E12 stop mic + flush; overlay.

### 4.8 WebSocket disconnect / reconnect
1. `onerror` → `"error"`; `onclose` (not deliberate) → `closeReason`, `closeInfo`, `"disconnected"`; `deliberateCloseRef=false` (:247-260).
2. Page early-returns `ConnectionLostOverlay` (:501-513) unless `sessionComplete`/`draft`. **Mic is not stopped** (no effect on `connectionState`); VAD keeps firing; `sendMessage` drops frames; `handleSpeechSent` still sets `"thinking"` [code-visible]. The early return unmounts the PausedOverlay and the `<dialog>`.
3. "Start over" → `reconnect()` (or `handleDesignRetry` in design): `deliberateCloseRef=true`, `"connecting"`, `reconnectTrigger++` → W1 cleanup (`close()` on an already closed socket: no `close` event) → reset WS state → new socket.
4. Page state **not** reset by reconnect: `orbState`, watchdog/interrupt timers, `isPaused`, `confirmingEnd` and end-flow refs, `elapsed`, `showTextInput`, `textInput`, `sttError`, `hearing`/VAD, `micFallback`, AudioQueue contents (`chunkBuffer`, scheduled sources), `lastPlaybackEndedAtRef`, `leftTrialRef`, `draftStoreFailed`.
5. "End session" on the overlay → `goToReportOrHome` with the old `sessionId` (not cleared on close).
- `deliberateCloseRef` after a reconnect from a socket that had already closed stays `true` (step 3: set by `reconnect`, set again by cleanup, and no `onclose` arrives to reset it). The **next** unexpected close of the new socket is then suppressed: no `"disconnected"`, no overlay; only an `error` event (abnormal close) would surface as `"error"` [inference from `useWebSocket.ts:79-83,251-266`; not run]. Same after `handleDesignRetry` following a server close.

### 4.9 Mic failure
- At start: `MicVAD.new` rejects → `"failed"` (:193-200); `vad.start()` rejects (permission, worklet, `getUserMedia`) → stop opened tracks, `"failed"` (:211-220). Page: `cannotHear` immediately → alert "can't hear you in this browser", E11 opens typing, panel `"unavailable"`. No retry path except design retry (`stopMic`/`startMic` not called elsewhere); Pause/Resume does nothing (`resumeMic` needs `vadRef`).
- No gesture (no `mic_gesture_granted`, e.g. reload): `hearing` stays `"off"`; after 10 s from mount `cannotHear` (E10 epoch 0).
- Hang: stays `"starting"`; deadline → `cannotHear`; late success → `"ready"` clears it.
- On reopen after pause: `"failed"` + `micFallback=null`; `micActive` stays true; Pause then Resume retries (vad-web `listening` stays true after a failed resume, so `pause()` proceeds; `real-time-vad.js:271-297`).
- Mid-session track loss (unplug while not paused): no `ended`/`devicechange` listener anywhere in scope (grep), so `hearing` stays `"ready"` [code-visible absence].
- `sessionStorage` access at page :193-194 is not wrapped in try/catch (voiceSession.ts:8-12 is); blocked storage would throw inside E3 [code-visible; impact uncertain].

---

## 5. Implicit state machines

### 5.1 Hearing (useVAD): `hearing × vadRef × pausedRef × startingRef × resumeSeq-in-flight × micActive` (+ page `hearingDeadlinePassed`, `hearingEpoch`, `isPaused`)

| combination | reachable via | consistent? |
|---|---|---|
| off, no VAD, not paused | mount; after `stopMic` | yes |
| starting, start in flight | `startMic` | yes |
| starting, start in flight, `pausedRef` | Pause during load | yes; load ends `"ready"` with VAD paused (:229-231) |
| ready, VAD listening | normal | yes |
| **ready, VAD paused, `isPaused`** | Pause | `"ready"` means "loaded", not "listening now"; page masks it with `paused` (AgentPanel :25) |
| starting, reopen in flight | Resume | yes |
| **starting, reopen stale, `pausedRef`, `isPaused`** | Resume → Pause before reopen settles | **#86**: nothing will ever move it off `"starting"`; deadline fires during the pause → alert + typing open under/next to the pause screen |
| **starting (same value) on next Resume** | #86 then Resume | E9 does not fire → no fresh deadline; alert already up |
| failed, no VAD | start failure | terminal unless design retry |
| failed, VAD present, `micActive=true` | reopen failure | recoverable via Pause/Resume |
| **`hearing="starting"` + `hearingDeadlinePassed=true` for 1-2 renders** | any transition into starting >10 s after the last one (ordinary Resume, reconnect+design retry `stopMic`/`startMic`) | **ordinary-Resume flash**; deadline timer is never cleared on `"ready"` (E10) |
| ready + `hearingDeadlinePassed=true` | 10 s after any successful attempt | harmless alone (`hearingUnavailable` false) but primes the flash above |
| off + deadline passed | `stopMic` after 10 s (sessionFailed, draftRejected, design end) | `cannotHear` true, but those states early-return an overlay |

### 5.2 Page mode: `connectionState × isPaused × confirmingEnd × endFlowOwnsFocusRef × pausedByEndDialogRef × endConfirmedRef × (sessionFailed, sessionComplete, draft, makingDraft, draftStoreFailed, draftRejected)`

Render priority is fixed by early returns (page :483-515): draftStoreFailed(design) > designFailed > sessionFailed(try) > sessionFailed > draftRejected > connectionError > makingDraft > live view.

| combination | how | note |
|---|---|---|
| live, !paused, !confirming | normal | |
| live, !paused, confirming, dialog open | End clicked; dialog's pause not finished | footer behind modal |
| live, paused, confirming, dialog open | pause finished | PausedOverlay hidden |
| **live, paused (or pause pending), confirming, dialog closed** | settling window after Escape (awaiting the dialog's pause) | End Session guarded (FQ-98, :409). **Footer Pause/Resume is not guarded**: while the pause is still pending `isPaused` is false so the footer offers "Pause"; clicking it starts a second `handlePause` that can finish after the close's resume — same shape as FQ-98 [inference] |
| live, paused/!paused, confirming forever | after confirm | intended; page is navigating |
| **connectionError while confirming** | socket drops with the dialog open or settling | early return unmounts `<dialog>`; `close` is not delivered to the React handler [inference: an unmounted element's handler cannot run]; `confirmingEnd` and `endFlowOwnsFocusRef` stay true. After Start over: PausedOverlay hidden, End Session returns at :409, E6 does not re-run (deps unchanged) → End Session unusable for the rest of the page [inference, not run] |
| connectionError while paused | idle timeout (1001) during a long pause | after Start over the page is still paused and the new greeting sits in a suspended context until Resume |
| connectionError + `orbState="thinking"` | utterance during the drop | state carried into the new session after Start over |
| connected + `sessionComplete` (normal) | server end | E14 navigates; `onclose(1000)` may set `"disconnected"` first, masked by `!sessionComplete` |
| `sessionFailed` + mic live for one render | E12 | |
| `confirmingEnd=false`, `endFlowOwnsFocusRef=true` | only between E7's guard and write, same tick | |

### 5.3 Orb: `orbState` writers that ignore the current value

| writer | sets | can clobber |
|---|---|---|
| E2 aiSpeaking true | speaking | interrupted, thinking (intended) |
| interrupt timer :149 | listening (unconditional) | `speaking` set by a `tts_start` within 200 ms; `thinking` if speech ends within 200 ms [inference] |
| `handleSttError` :83 | listening (unconditional) | `speaking` if an `stt_error` (e.g. `busy`) arrives during a reply [inference]; `thinking` with watchdog still armed (harmless, guarded :137) |
| `handleSpeechSent` :133 | thinking | anything, including while disconnected/connecting (audio was dropped) |

### 5.4 Audio: `aiSpeaking × audioPlaying × context.state × chunkBuffer × sources`

| combination | note |
|---|---|
| aiSpeaking ∧ ¬audioPlaying | streaming; audio buffered until `tts_end` |
| ¬aiSpeaking ∧ audioPlaying | buffered playback after `tts_end` (FQ-65 made this show as speaking) |
| **¬aiSpeaking ∧ ¬audioPlaying ∧ decode/start pending** | after `tts_end`, ≥100 ms + decode: orb Listening, VAD not in barge-in mode [inference] |
| context suspended ∧ sources scheduled | paused; `audioPlaying` false; reported on resume |
| chunkBuffer non-empty after flush/reconnect | late frames; combined with next turn's audio [inference] |
| two "speaking" truths on screen | panel/badge from `interviewerSpeaking`; transcript cursor from `aiSpeaking` (`LiveTranscript.tsx:235`) |

---

## 6. Defect history

`git rev-parse --is-shallow-repository` = **true** (246 commits visible; oldest `d3dd32f`, 2026-10-19). History before that is not available.

`git log --no-merges --format='%h %ad %s' --date=short -- <in-scope files>`:

```
917ec1e 2026-11-15 Ignore End Session while the end dialog is still closing (FQ-98)
0d55ff1 2026-11-15 FQ-47: closing the end dialog always finishes, even if pause or resume fails
564d43c 2026-11-15 FQ-47: closing the end dialog waits for its pause before resuming
3e9b9f7 2026-11-15 FQ-47: no pause-screen flash around the end dialog; explicit focus ownership
8d027f4 2026-11-15 FQ-47: End session on the pause screen; focus Resume when dismissing while paused
06ffa18 2026-11-15 Confirm before ending an interview (FQ-47)
d6b923b 2026-11-15 Stop dimming the live transcript while the interviewer speaks (FQ-43)
982ebd5 2026-11-15 Show response time and session id on the live session only with ?debug=1 (FQ-46)
bad3b52 2026-11-14 Never fail silently when the microphone doesn't reopen after Pause (FQ-79)
8310188 2026-11-14 Record from the microphone chosen on the mic check (FQ-40)
a3fcad1 2026-11-14 Serve voice detection's runtime from the app and never fail silently (FQ-41)
22465f8 2026-11-14 Show who is speaking, and only while they are (FQ-65)
ba18009 2026-11-14 Align the thinking watchdog with its 10-second intent (FQ-42)
bdce1b1 2026-11-13 fix(deps): upgrade Next to 16 and React to 19 (frontend audit clean)
43ee639 2026-11-08 feat(frontend): add skip link, pause-animations control and visible field borders
9972708 2026-10-19 fix(frontend): accessibility pass: contrast, landmarks, session heading, report tabs
d8b874c 2026-10-19 refactor(frontend): split the report view into section components
```

| item | commit(s) | what broke | mechanism (sections 1-5) |
|---|---|---|---|
| FQ-42 | `ba18009` | Watchdog reset Thinking→Listening after 6 s although comments said 10 s; slow healthy replies showed Listening | Orb state is a timer-driven guess (`watchdogRef`, 5.3) rather than derived from protocol state; constant was inline |
| FQ-65 | `22465f8` | Transcript "Speaking" followed `aiSpeaking` (server) while the panel followed `orbState`+`audioPlaying`; they disagreed during buffered playback | Two independent "is speaking" sources (`aiSpeaking` in useWebSocket vs `audioPlaying` in AudioQueue, 5.4); fixed by derived `displayedOrbState`/`interviewerSpeaking`. The cursor blink still reads `aiSpeaking` |
| FQ-41 | `a3fcad1` | ONNX runtime from a blocked/mismatched CDN; `MicVAD.new` unguarded; panel said Listening while nothing listened | No hearing state existed: the orb's `"listening"` was a default, not a fact. Added `hearing` (useVAD) + page deadline (`hearingDeadlinePassed`, mount timer) + `panelState` derivation |
| FQ-40 | `8310188` | Session and every Resume opened the browser default mic, not the chosen one | Stream opening owned by vad-web defaults (`getStream` + default `resumeStream`); added `openMic`, `micFallback` state, localStorage key |
| FQ-79 | `bad3b52` | `resumeMic` swallowed `vad.start()` failures; Listening shown after a failed reopen; a reopen landing after Pause left the mic live | `hearing` only covered first start; resume had no generation token. Added `resumeSeqRef`, `hearingAttempt`, and the effect pair E9/E10 that derives "new attempt" from observing `hearing` change into `"starting"` — the mechanism behind #86 and the flash |
| FQ-46 | `982ebd5` | Latency and session id shown to every user | Not a state defect: display gating; adds `debug` read per render |
| FQ-47 | `06ffa18`, `8d027f4`, `3e9b9f7`, `564d43c`, `0d55ff1` | (1) pause screen flashed 10-30 ms around Escape/confirm; focus recorded/restored from the wrong place; (2) Escape before the dialog's async pause finished → resume ran first, late pause left session Paused with mic live; (3) rejected pause/resume left `confirmingEnd` stuck true | End flow layered on the async Pause/Resume handlers with no shared sequencing: visibility of PausedOverlay derived from `isPaused` while `confirmingEnd` was cleared before resume settled (E7 / 5.2); un-awaited `handlePause` promise; `confirmingEnd` cleared only on success path. Fixes added `endFlowOwnsFocusRef`, `endDialogPauseRef`, try/finally |
| FQ-98 | `917ec1e` | End Session clicked during the settling window started a second `handlePause` that finished after the close's resume → session Paused | Settling window (5.2 row "dialog closed, confirming") with pause/resume as un-sequenced async handlers; guard added only to `handleEndClick` (footer Pause still unguarded, 5.2) |
| FQ-43 (in scope, not in the expected list) | `d6b923b` | transcript dimmed while interviewer spoke | Display only (`LiveTranscript` style) |
| #86 (open; FQ-86 parked at gate 3, `docs/factory/specs/FQ-86/00-status.md`) | — | Resume → reopen pending → Pause: `hearing` stays `"starting"`; deadline fires during the pause (alert + typing); next Resume's `setHearing("starting")` is a no-op so no fresh deadline | `pauseMic` (`useVAD.ts:263-267`) stales the reopen via `resumeSeqRef` but writes no `hearing`; stale `.then` handlers return (:283-285). Page E9 keys "new attempt" on a value *change* (5.1) |
| Ordinary-Resume flash (in FQ-86 scope per gate-1 amendment) | — | Any Resume >10 s after the last attempt: 1-2 committed renders with `hearing="starting"`, `hearingDeadlinePassed=true` → `role="alert"` inserted and E11 opens the typing bar permanently | E10's timer is never cleared when `hearing` becomes `"ready"`, and the reset of `hearingDeadlinePassed` lags `hearing` by two effect passes (section 3 E9-E11). The setState runs after `await` (default lane), so frames can paint. FQ-86 `02-architecture.md:32-37` records a browser reproduction. The "page-only interim fix" in `00-status.md:14` is not in the working tree |

---

## 7. Tests that pin behaviour today

Unit (`tests/unit`, vitest; hooks tested with jsdom + mocked vad-web):

| file | pins |
|---|---|
| `hearingDisplay.test.ts` | `HEARING_DEADLINE_MS=10_000`; `hearingUnavailable` truth table; `panelState` replaces only `listening` |
| `sessionDisplay.test.ts` | speaker labels/badges; `displayedOrbState` (playing → speaking, interrupt stays visible) |
| `sessionTiming.test.ts` | `THINKING_WATCHDOG_MS=10_000` |
| `useVADHearing.test.ts` | `hearing` off/starting/ready/failed for start; stop during load never opens mic; ONNX paths `/`; locked thresholds |
| `useVADMicDevice.test.ts` | `openMic` device choice on start and resume; fallback + notice; rename by label; no retry on other errors; notice cleared; late stream after stop is stopped |
| `useVADResume.test.ts` | resume starting→ready / failed (+ notice drop); hang stays starting; Resume without Pause or without VAD does nothing; Resume during load; stale reopen cannot overwrite; reopen after Pause stopped; stop during reopen not a failure |
| `voiceSession.test.ts` | `safeSessionNext`; `startVoiceSession` routing on `mic_gesture_granted`, storage blocked |
| `debug.test.ts` | `isDebug` values |
| `micDevice.test.ts` | localStorage choice round-trip, constraints, `findByLabel`, `isMissingDevice`, wording |
| `pcmEncoder.test.ts` | `app/lib/pcmEncoder.ts` only; **useVAD's inline PCM16 conversion (`useVAD.ts:167-170`) is not that module and is untested** |

E2E (`e2e`, Playwright against mock backend, production build):

| spec | pins |
|---|---|
| `smoke.spec.ts` | pages render; COOP/COEP on `/session`; VAD assets served; mock session connects, greeting streams, panel not "Listening" without VAD, never stuck "Speaking"; unknown interviewer no crash |
| `hearing.spec.ts` | VAD loads with third-party hosts blocked; load failure → message + typing; hang → message after 10 s then recovery; no gesture → never "Listening" |
| `microphone.spec.ts` | chosen mic used on start and resume; missing mic fallback notice; "System default"; no deviceId when none chosen |
| `resume.spec.ts` | failed reopen reported + typing + Pause/Resume recovers; hung reopen reported after 10 s; late stream after Pause stopped, exactly one live track; ordinary Pause/Resume shows no message — **runs well under 10 s and checks only the end state, so it does not catch the ordinary-Resume flash** |
| `end-confirm.spec.ts` | dialog name/wording/focus; pause and no audio frames while open; Escape/Keep talking resume + focus; pre-paused stays paused; confirm → session_end + report; MutationObserver: no pause-screen flash; slow suspend Escape race; failing suspend does not stick; confirm while paused |
| `end-confirm-settling.spec.ts` | End Session during settling does nothing (FQ-98) |
| `debug-panel.spec.ts` | latency/session id hidden without `?debug=1`, shown with it (uses typed input) |
| `transcript-opacity.spec.ts` | transcript not dimmed while speaking (FQ-43) |
| `navigation*.spec.ts`, `report-embedded.spec.ts` | outside this runtime |

Gaps (paths in section 4 with no test found by grep of `e2e/` and `tests/unit/`):

| path | status |
|---|---|
| 4.2 reply audio, `turn_timing` emission, `getResponseGapMs` | no test (no `turn_timing` in tests) |
| 4.3 interrupt / barge-in, `audioQueue.flush`, orb `"interrupted"` timer | no test (no `interrupt` in e2e/unit hook tests) |
| `AudioQueue` class | no unit test |
| `useWebSocket` (transcript partial/final merge, reconnect, `deliberateCloseRef`, close codes) | no unit test; only smoke observes frames |
| 4.8 disconnect / Start over / End from Connection lost; state carried across reconnect | no test |
| `session_failed`, `stt_error` toast, `draftRejected` | no test |
| design mode (`mode=design`) and try mode (`mode=try`) flows | no e2e (grep for `mode=` finds none) |
| #86 sequence; ordinary-Resume flash >10 s; sticky `showTextInput` | no test |
| footer Pause during end-dialog settling; disconnect while dialog open | no test |
| page orchestration (E2, E9-E11) | only via e2e; no component-level test |
| `prefers-reduced-motion` / motion toggle on the avatar | no test found |
