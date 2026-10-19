# Architecture

## Voice pipeline

STT is **not streaming**. The client VAD decides when a turn ends and sends one whole finished utterance as a single binary frame. The server transcribes it with one Scribe v2 request (`POST https://api.elevenlabs.io/v1/speech-to-text`) and only then calls the LLM. The LLM and TTS stages are streamed.

```
[Browser Mic — getUserMedia]
     │  PCM16, 16kHz mono, 100ms frames
     ▼
[AudioWorkletProcessor — off main thread]
     │  encodes raw PCM
     ▼
[VAD — @ricky0123/vad-web (Silero WASM)]
     │  onSpeechEnd fires → sends the whole finished utterance
     ▼
[WebSocket binary frame → Backend]   (one frame = one complete utterance)
     │
     ▼
[STT — ElevenLabs Scribe v2, one REST request per utterance]
     │  final transcript string (not streaming)
     ▼
[LLM — Claude Sonnet 4.6, max_tokens: 300]
     │  token stream
     ▼
[SentenceChunker — splits on . ? ! boundaries]
     │  complete sentences
     ▼
[TTS — ElevenLabs eleven_flash_v2_5]
     │  MP3 audio chunks (Cartesia sonic-english if ElevenLabs fails before any audio)
     ▼
[WebSocket binary frames → Browser]
     │
     ▼
[AudioQueue — decodeAudioData + Web Audio API scheduling]
     │  serialised, in-order playback
     ▼
[Speaker]
```

## Latency budget

Target: **< 1.5 seconds** from end of user speech to first AI audio.

| Stage | Estimate |
|---|---|
| VAD end-of-turn | 200–400ms |
| Audio transmission | ~50ms |
| Scribe v2 transcript (one request for the whole utterance; grows with utterance length) | ~300–800ms |
| LLM first token | 300–500ms |
| Sentence chunker | ~50ms |
| ElevenLabs first audio | ~75ms |
| Network to client | ~50ms |
| **Total** | **~1000–1900ms** |

These are estimates, not measurements. Because transcription starts only after the whole utterance has been uploaded, the total can exceed the 1.5 second target on long utterances. The `latency_metric` message reports the measured time from the server receiving an utterance to the first audio chunk, so the budget can be checked against real runs. The mock profile has no provider latency and says nothing about these figures.

## Interviewers

An interviewer is a record that defines one kind of conversation: who the interviewer is, how it speaks, the phases the conversation moves through and what the report should notice. The record, its field caps and its validation are in `apps/backend/src/interviewer/schema.ts`. The server code is in `interviewer/` (schema, presets, prompt), `interviewerStore.ts` and `interviewerRoutes.ts`.

- **Fields.** `name`, `purpose`, `persona`, `style`, `opening`, `closing`, 1 to 8 `phases` (each with a `name`, an `instruction` and, on every phase except the last, `minTurns` and `maxTurns`), up to 6 `focus` items, `contentFeedback`, `deliveryFeedback` and an optional `voice`. The server adds `id`, `source` (`preset` or `custom`), `ownerId`, `version`, `createdAt` and `updatedAt`. Text is trimmed, control characters are rejected, and unknown fields are refused. Phase names must be unique within an interviewer.
- **Presets.** Four presets live in the repository under `interviewer/presets/`: `tell-a-story`, `explain-an-idea`, `rehearse-an-interview` and `work-out-a-point-of-view`. Each has the phases `intro`, `share`, `deep_dive` and `wrap_up`. Presets are owned by `system`, visible to everyone and read-only through the API.
- **Preset sync.** After migrations, `index.ts` calls `syncPresets`, which validates every preset and then inserts new ones, updates changed ones and removes preset rows whose file is gone, in one transaction. A preset that fails validation stops startup. Custom interviewers and sessions are never touched by the sync.
- **Custom interviewers.** Created through the API and visible only to their owner (another owner's interviewer is a 404). Each owner may hold up to 50. Every update must send the `version` it was based on; a stale `version` is answered 409 and a successful update raises the version by one.
- **Snapshot.** When a session starts, the server copies the full interviewer record into `Session.interviewerJson`, in the same write that creates the session and before `session_started` is sent. The live session, its phase list, its prompts and its report read only that copy. Editing or deleting an interviewer, or changing a preset file, never changes a past or running session or its report. `Session.interviewerId` records which interviewer was used.
- **Earlier sessions.** Sessions stored before interviewers existed have their old topic id in `interviewerId` and no snapshot. The API reports their `interviewerName` as `null`, and the frontend labels them "Earlier interview".
- **Phase names on the wire.** `phase_change` carries the phase name from the snapshot, so clients must not assume a fixed set. Stored turns and `Session.phase` hold the same names.

### Prompt layout

`buildSystemPrompt` in `interviewer/prompt.ts` builds the system prompt for each turn in this order: the fixed voice-rules wrapper (code, not editable), the interviewer's `persona`, its `style`, the current phase's `instruction`, the `opening` guidance on the first turn only, the `closing` guidance in the last phase only, and a final voice-rules reminder. The reminder comes last so interviewer text never follows the rules. The report prompt is separate and is described under "Delivery metrics and the report". `voice` is stored and validated but not yet read by the speech providers.

### Phase advancement

Transitions are **orchestrator-driven**: the LLM never decides when to move on. `advancePhase()` in `orchestrator.ts` compares the user turns counted in the current phase with that phase's `maxTurns` (its `minTurns` in demo mode) and moves forward one phase at a time. The last phase has no limits and never ends by count. The session controller sends `phase_change`. The check runs after the reply to a user turn ends, so `phase_change` follows that turn's `tts_end` (or comes after the cut-off if the reply was interrupted).

Counts are per phase. The presets use `minTurns` 1 and `maxTurns` 2 (`intro`), 3 (`share`) and 5 (`deep_dive`), which gives the cumulative thresholds 2, 5 and 10 user turns.

### Interviewer API

All routes are behind the authenticator and scoped to the caller's owner. Bodies are JSON, at most 64 KB. A route id that is not 1 to 64 letters, digits, `_` or `-` is a 404. Errors never echo submitted text.

| Route | Result |
|---|---|
| `GET /api/interviewers` | 200: summaries (`id`, `name`, `purpose`, `source`, `version`) of the presets, then the owner's custom interviewers, each ordered by name. |
| `GET /api/interviewers/:id` | 200: the full record without `ownerId`. 404 for an unknown id or another owner's interviewer. |
| `POST /api/interviewers` | 201: the new record, with a server-issued UUID at version 1. 422 `{ errors: [{ path, message }] }` for invalid input or at the 50 cap. |
| `PUT /api/interviewers/:id` | Body is the full input plus `version`. 200: the updated record. 403 for a preset, 404, 409 `version conflict`, 422 for invalid input. |
| `POST /api/interviewers/:id/duplicate` | 201: a custom copy named `<name> (copy)` of any interviewer the caller can see. 404, or 422 at the cap. |
| `DELETE /api/interviewers/:id` | 204. 403 for a preset, 404 otherwise. |
| `POST /api/interviewers/draft` | Body `{ description }`, 20 to 4000 characters. 200: `{ draft }`, an unsaved interviewer input. 422 for a missing, too short, too long or control-character description; 429 while the same owner has a draft in flight; 502 when the draft call fails or passes the deadline. |

Malformed JSON is 400 and a body over 64 KB is 413. The designer preset is hidden from the list and readable by id; like any preset it cannot be changed or deleted (403), and it cannot be duplicated (404).

### Creating an interviewer

A person can create an interviewer by talking to the designer, by typing one description, or by filling in the form. The first two produce a **draft**: an interviewer input that is shown for review and is saved only when the person saves it through `POST`/`PUT /api/interviewers`. Nothing saves a draft on its own.

- **Designer preset.** `interviewer/presets/designer.ts` holds the designer (`interviewer-designer`), a preset with no tools that talks through the interviewer the person wants and says it cannot save or change anything. It is synced with the other presets.
- **Ephemeral sessions.** A `session_start` with `interviewerId: "interviewer-designer"` runs a designer session, and one with an inline `draft` runs a trial ("Try it"). `app.ts` gives both `EPHEMERAL_PERSIST` (`ephemeralPersist.ts`) and never calls `persistSessionCreate`, so no session, turn, phase or report row is written and they never appear in `/api/sessions` or the report routes. They share the start path of a stored session: the same concurrent-session cap, turn cap and idle timeout, a server-issued session id, and abandon on close. A trial's draft is validated with `parseInterviewerInput` before the session counter is touched and becomes an in-memory interviewer (`id: "draft"`). A trial ends `complete` with no report, also when no user turn was taken.
- **Draft generator.** `generateDraft` in `interviewer/designer.ts` makes one structured LLM call, over the designer conversation (at `session_end`, sent as a `draft` message before `session_complete`) or over a one-box description (`POST /api/interviewers/draft`). Its output keeps only the known input fields (an `id`, `ownerId` or `voice` the model adds is dropped) and must pass `parseInterviewerInput`, like a save; the provider retries an invalid reply once. Less than 20 characters of the person's own text is refused without a call. A designer session that cannot make a valid draft ends `session_failed`.
- **Prompt and budget.** The draft prompt is fixed text only; the conversation or description is data in the user message, one line per turn with newlines collapsed so a turn cannot forge a speaker line. The conversation keeps its last turns up to 24,000 characters. The call has its own output budget (`DRAFT_MAX_TOKENS` 6144), a deliberate exception to the 300-token conversational limit like the report call, and is bounded by `limits.reportTimeoutMs`.
- **One-box route.** `POST /api/interviewers/draft` allows one draft in flight per owner (429 otherwise) and answers 502 for any failure; see the table above.
- **Logging.** Logs carry ids, phase counts, statuses and error class names only: `started designer`, `started draft interviewer (N phases) (trial)`, `drafted interviewer (200)`. Never the description, the draft, the interviewer's name or text, or the conversation (unless `DEBUG_LOG_TEXT` is on, as for any turn).
- **Frontend.** `/interviewers` (`app/interviewers/page.tsx`) lists the presets and the owner's interviewers and offers Talk it through (the session page with `mode=design`), Describe it (`POST /api/interviewers/draft`) and a blank form. `/interviewers/edit` is the editor: `?id=` loads a stored interviewer (a preset is read-only with Duplicate), `?from=design` or `?from=draft` opens a stored draft, and no parameter opens a blank form. A draft reaches the editor, and Try it (`/session?mode=try`), through `sessionStorage` key `interviewer_draft`, written and read by `app/lib/interviewerForm.ts`. The value is shape-checked on read; a missing, corrupt or oversized one opens a blank form, and Try it without a valid one redirects to the editor. Try it on a stored interviewer carries the version the edits started from, so the Save afterwards still gets 409 if it was saved elsewhere meanwhile. Only Save writes, through `POST` or `PUT /api/interviewers`.
- **Form caps.** The editor uses the field caps as `maxLength` hints from a copy of `INTERVIEWER_LIMITS` (`apps/backend/src/interviewer/schema.ts`) in `apps/frontend/app/lib/interviewerForm.ts`. A backend test (`interviewerSchema.test.ts`) pins the numbers, so changing a cap means updating both files and the test. The server remains the authority; its field errors are shown next to the fields.

## Delivery metrics and the report

The report has three parts: **Content** (what was said), **Delivery** (how it was said) and **Next steps**. The text is reflective: no scores, ratings or grades. Delivery numbers are computed in code from the speech-to-text word timings (`apps/backend/src/delivery/metrics.ts`); the model never produces them.

### Metric definitions

Per spoken (audio) user turn, `computeTurnMetrics` gives these numbers. A value is `null` when it is unknown; `null` is never a stand-in for zero.

| Metric | Definition |
|---|---|
| Pause | A gap of at least 0.7 s (`PAUSE_THRESHOLD_SEC`) between consecutive timed words. Reported as `pauseCount` and `longestPauseSec`. |
| Pace | Timed words per minute over the span from the first word's start to the last word's end (`wordsPerMinute`). `null` when the span is under 2 s or there are under 5 timed words. |
| Answer length | `wordCount` and `durationSec` (the same first-start to last-end span). |
| Fillers | `fillerCount`: the number of words that are one of `um, uh, uhm, er, erm, ah, hmm, mm, mmm` (`FILLER_WORDS`). Whole-token matching, case-insensitive, surrounding punctuation ignored, so "umbrella" and "errand" do not count. |
| Response gap | `responseGapMs`: the time from the end of the interviewer's audio playback to the start of the user's speech. The server cannot measure it (TTS streams faster than it plays) and the STT timings cannot (an utterance starts when speech starts), so the client measures it and sends it as `turn_timing` just before the audio frame. It is `null` for a first answer with no earlier playback, for text input, when the user spoke over the interviewer, and when the value is invalid. |

Words without finite timestamps are left out of the timing numbers (`timedWordCount` counts those used). With fewer than two timed words, duration, pace and pauses are `null`. A turn with no word list still gets a `wordCount` from the text.

### What is stored

Per audio turn, `ConversationTurn.metricsJson` holds the numbers above and nothing else: no audio and no word list. Text-input turns, assistant turns and sessions from before this feature have `metricsJson = null` and so no delivery data. The client's `turn_timing` value is stored only as the `responseGapMs` number and is never logged. Filler counts are stored always; whether reports show them is controlled by `REPORT_FILLER_COUNTS` (see the filler caveat below).

### Session summary

`summarizeDelivery` rolls the measured turns into one `DeliverySummary`, or returns `null` when no turn has metrics. Total words and speaking time are sums. Average pace is total-based: the timed words of the turns with a duration divided by their total time, not the mean of per-turn paces; it is `null` when that total time is under 2 s. Pauses are summed and the longest pause is the maximum. Speaking time, pause count and longest pause are `null` when no measured turn has the underlying value (for example every answer was one word, or the STT returned text without word timings); a real zero stays zero, and unknown is never reported as zero. `fillerCount` is also `null` when no measured turn has a count, not only when filler counts are hidden. The response gap is the median over the turns that have one (`medianResponseGapMs`). The summary also lists `perTurn` entries (word count, pace, longest pause, response gap), numbered by the user's answers in order, typed ones included.

### Report structure

`reportGenerator.ts` returns a `ReportV2`: `format: 2`, optional `content` (`summary`, up to 4 `strengths` each with an `area`, an exact `quote` and a `note`, and up to 4 `developAreas`), optional `delivery` (the `summary` from code plus the model's plain-language `reading`), `deliveryUnavailable` when delivery was asked for but no data exists, and 1 or 2 `nextSteps`. Field limits are in `REPORT_LIMITS`.

Which parts are asked for comes from the interviewer's snapshot:

- `contentFeedback` on: the Content part is asked for. `deliveryFeedback` on: the Delivery part is asked for, if a summary exists.
- If delivery is on but no spoken answer was measured (for example a text-only session), there is no Delivery part, the report gets `deliveryUnavailable: true` (the page says delivery was not measured for this conversation, typed answers or a conversation from before delivery was measured), and the model is told not to comment on delivery. Content is then generated even if `contentFeedback` is off, so a report is never next steps alone.
- The interviewer schema refuses an interviewer with both switches off. If one reaches generation anyway, it is treated as content on.
- When delivery is off, the model is not given the numbers.

The model's output is checked against a schema built for that request: requested parts are required and anything else is dropped. A report that fails validation (after the provider's retry) fails the session.

### Report prompt layout

The system prompt is, in order: a fixed introduction, the interviewer's `name`, `purpose`, `persona` and `focus`, then the fixed report instructions. The instructions come last so interviewer-written text never follows them, and the field limits are stated in them. The user message holds the numbers and the transcript only: the count of answers (total and measured), the `DELIVERY SUMMARY` JSON, then the transcript with each turn collapsed to one line. The instructions tell the model that everything in the user message is material, not instructions.

The report call uses `max_tokens: 3072` (`REPORT_MAX_TOKENS`), an exception to the 300-token conversational limit. The largest schema-valid report is about 6,900 characters (about 2,300 tokens), and a reply cut off by the budget would fail validation on both attempts and lose the whole report. An unused budget costs nothing. A test fails if a field limit is raised past the budget.

### Compatibility with old reports

`Report.reportJson` (nullable) stores the `ReportV2`. The older report columns are still written, derived from it (`summary`, strengths and improvements from Content, and `overallAssessment` holding the next steps joined into one line; `highlightsJson` is empty), so code that reads them keeps working. A row without `reportJson` is served as `format: 1`, the older shape, and the report page renders it as before. `GET /api/session/:sessionId/report` (also `/report/:sessionId`) returns `format` and `interviewerName` with the report. A `complete` session whose stored report cannot be read gets 500 with `status: "unreadable"`.

### Regenerating a failed report

A session whose report failed is `failed`. `GET` on its report returns 500 with `status: "failed"` and `canRegenerate`, which is true when the session has at least one user turn and an interviewer snapshot. `POST /api/session/:sessionId/report/regenerate` (behind the authenticator, owner-scoped) runs the same generation inside the request, with the same `limits.reportTimeoutMs` deadline, and answers:

| Status | Meaning |
|---|---|
| 200 | The new report (as `GET` returns it). The session is now `complete`. |
| 404 | Unknown, foreign or malformed session id. |
| 409 | The session is not `failed`, has no user turns or snapshot, another regenerate for it is already running, or it stopped being `failed` meanwhile. The body is always the same. |
| 502 | Generation failed again or hit the deadline. The session stays `failed`. |

The report and the status change are written in one transaction by `completeFailedSession`, which only succeeds for a `failed` session of the right owner. It is the one exception to "a session leaves `active` exactly once"; the normal status writer is unchanged.

### Filler caveat and how to verify it

Whether Scribe v2 keeps filler words such as "um" in its transcript could not be confirmed from its public documentation. If it drops them, a count of zero would be misleading, so reports leave filler counts out by default: the model is not given the number and the report's summary has `fillerCount: null`. To check, run a conversation in which you say "um" and "uh" deliberately several times, inspect the stored `metricsJson` of those turns (`fillerCount` should be above zero and match roughly what you said), then set `REPORT_FILLER_COUNTS=1` (or `true`) and restart the backend.

## Providers and profiles

All speech and language calls sit behind three interfaces in `apps/backend/src/providers/types.ts`:

| Interface | Method | Cloud implementation |
|---|---|---|
| `SttProvider` | `transcribe(pcm16, signal)` returns text and word timings | ElevenLabs Scribe v2 (REST) |
| `TtsProvider` | `synthesize(sentence, signal)` yields MP3 chunks | ElevenLabs `eleven_flash_v2_5`; Cartesia `sonic-english` fallback when configured and ElevenLabs fails before any audio |
| `LlmProvider` | `stream(...)` yields text pieces; `structured(...)` returns a schema-checked object | Claude Sonnet, used for replies and the report |

`PROFILE` selects the implementation set (`providers/index.ts`):

- `cloud` (default): the real providers. Requires `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY`; startup fails with a clear message if either is missing.
- `mock`: scripted in-process providers, no keys and no network. `PROFILE=mock npm run dev` runs a complete conversation, and the keyless conversation test (`src/__tests__/conversation.test.ts`) uses it.

A `hybrid` profile (a local speech sidecar for STT and TTS with a cloud LLM) is a planned later step. It is not built; `PROFILE` accepts only `cloud` and `mock`.

## Session controller

`sessionController.ts` owns one live session: its turn history, its phase and a single state.

State transitions:

- `idle` → `thinking`: `start()` begins the greeting.
- `listening` → `thinking`: a user utterance arrives (or the next queued one is taken).
- `thinking` → `speaking`: the first TTS audio chunk of the reply is sent.
- `thinking` or `speaking` → `listening`: the item finishes (reply done, STT empty or failed, provider error) or `interrupt()` cancels it. If another utterance is queued, it starts at once (`listening` → `thinking`).
- any state → `idle`: the session ends (`end()` finishes, or `abandon()`).

- `idle`: not started, or ended. `listening`: waiting for the user. `thinking`: STT and LLM running, no audio sent yet. `speaking`: TTS audio is being sent.
- One item runs at a time (the greeting, then user utterances). Utterances that arrive meanwhile wait in a FIFO queue of up to 5; beyond that the server sends `stt_error` with reason `busy`.
- Each item has one `AbortController` shared by STT, LLM and TTS. `interrupt()` clears the queue and aborts it, so nothing further is sent for that turn: no final transcript and no `tts_end`, and the interrupted assistant reply is not stored (the user turn is).
- `end()` (from `session_end`) first cancels the in-flight reply exactly as `interrupt()` does (nothing more is synthesised or sent for it, and it is not stored), waits for that turn to settle, then generates the report from the committed turns (including their delivery metrics), stores it and sets the status. `abandon()` (socket closed, or idle timeout) aborts everything. `onEnded` fires exactly once with the status reached.
- A session ends itself after `limits.maxTurnsPerSession` user turns (200).

## Session statuses and the end-of-session deadline

A stored session is `active`, `complete`, `failed` or `abandoned`, and leaves `active` exactly once. The one other transition is `failed` to `complete`, used only by report regeneration.

| Status | Meaning |
|---|---|
| `complete` | `session_end` was received and the report was stored. Only these are listed in `/api/sessions`. |
| `failed` | The session ended but the report could not be generated or stored (provider error, invalid report, or the deadline). Its report can be regenerated; success makes it `complete`. |
| `abandoned` | The socket closed before `session_end`, or the session idled out. |

Ending is bounded by `limits.reportTimeoutMs` (90 seconds). If the in-flight turn plus report generation have not finished by then, everything is aborted, the status becomes `failed` and the client gets `session_failed`. The deadline does not rely on providers honouring the abort, and a report that arrives late cannot change the outcome. A session is never reported `complete` unless its report was stored.

## Sessions, ownership and safe defaults

- **Server-issued ids.** The server generates the session UUID and sends it first as `session_started`. Any client-supplied `sessionId` or `phase` is ignored.
- **Authenticator seam.** Every HTTP route and every WebSocket upgrade goes through one authenticator (`auth.ts`) that returns an `ownerId`. Sessions are stored with their owner, and reads, lists and deletes are scoped to it, so another owner's session is a 404. Local mode (no `AUTH_TOKEN`) uses the owner `local`; token mode (`AUTH_TOKEN` set) uses the owner `token`. Real accounts would replace the authenticator and nothing else.
- **Origin check.** An `Origin` header must be in `ALLOWED_ORIGIN`; a request without one must come from a loopback peer.
- **Safe by default.** `HOST` defaults to `127.0.0.1`. Configuring a non-loopback `HOST` without `AUTH_TOKEN` fails at startup (fail closed). Local mode accepts loopback peers only.
- **Limits.** 10 MiB maximum frame, which bounds one spoken utterance to about 5.5 minutes of 16 kHz PCM16 (close 1009), 64 KiB maximum JSON text frame (close 1009, `message too large`), 8 KB maximum `text_input` (ignored with `stt_error` `too_long`), 2 concurrent sessions per owner (close 1013), 15 minute idle timeout (close 1001), 200 user turns per session. All close codes are in `websocket-protocol.md`.

## Logging rules

- Logs carry session ids, event names, byte counts and error class names only. They never contain transcript text, model output, audio, API keys or tokens.
- Request URLs are never logged, because `?token=` can appear in them.
- `DEBUG_LOG_TEXT=true` is an explicit opt-in that also logs conversation text. It is off by default and meant for local debugging only.

## Data lifecycle

- Audio is never stored: only transcript text and per-turn delivery numbers are. Active session state lives in memory. SQLite (Prisma) is written when a session is created (with its interviewer snapshot), on each completed turn, on phase changes, and when the session ends (status and report). `DATABASE_URL` selects the file; never hardcode or commit it.
- `DELETE /api/session/:sessionId` removes a session with its turns and report. The dashboard offers it with a confirmation. A live session cannot be deleted (409).
- Deleting a custom interviewer (`DELETE /api/interviewers/:id`) removes only its row in the `Interviewer` table. Sessions keep their own snapshot, so their reports, transcripts and names are unchanged. Deleting a session never touches an interviewer.
- Preset rows are rebuilt from the repository files at every startup. Removing a preset file removes its row, while sessions that used it keep their snapshot.
- `RETENTION_DAYS` is off by default. When set, sessions that ended more than that many days ago are deleted once at startup (`retention.ts`).
- Migrations are applied at startup (`migrate.ts`). If they fail, the server prints the last lines of Prisma's error output with the `DATABASE_URL` value and any `user:pass@` credentials redacted, and exits 1.
- At startup, after migrations, any session still `active` is marked `abandoned` with `endedAt` set (a crash or restart left it; the server is single-instance, so nothing is live at boot). Only the count is logged. This lets the report route answer and retention purge those rows.

## Operating notes

- Local mode also requires the `Host` header to name a loopback host (`localhost`, `127.0.0.0/8` or `[::1]`, any port), so a DNS-rebinding page cannot reach the server; anything else is 403 `host not allowed`. Token mode does not check `Host`.
- Behind a reverse proxy on the same host, every forwarded client appears as loopback and passes the local-mode check. Set `AUTH_TOKEN`, or keep the proxy unreachable from other machines (see `websocket-protocol.md`).
- `?token=` is for the browser WebSocket only, because browsers cannot set headers on a WebSocket. Use `Authorization: Bearer` everywhere else, and make sure no proxy or platform logs full request URLs.
- `GET /health` returns `{ status, database, providers: { profile } }` and is behind the authenticator like every other route.

## Locked decisions

These are not up for debate. Change requires an explicit instruction and a spec update.

| Decision | Value | Why locked |
|---|---|---|
| LLM model | `claude-sonnet-4-6` | Latency + quality balance confirmed in testing |
| LLM max_tokens | `300` (conversation replies) | Enforces short voice-appropriate responses. The report call is separate and uses 3072. |
| STT | ElevenLabs Scribe v2 | Best accuracy for voice; Scribe v2 is the current API (used as one request per utterance) |
| TTS model | `eleven_flash_v2_5` | Lowest latency ElevenLabs model |
| TTS fallback | Cartesia `sonic-english` | Independent provider — covers ElevenLabs outages |
| VAD | `@ricky0123/vad-web` (Silero) | Client-side WASM; no round-trip for end-of-turn |
| Sample rate | 16kHz mono PCM16 | Scribe v2 optimal input format |

Phase thresholds are not locked. They are per-interviewer settings; the presets default to 2/5/10 cumulative user turns (intro 2, share 3 more, deep dive 5 more), and demo mode ends each phase at its `minTurns`.

## Interrupt handling

This is the highest-risk component. The full 9-step flow:

1. VAD `onSpeechStart` fires while `aiSpeaking === true`
2. Client **immediately** snaps orb to interrupt state (orange flash, 200ms) — no server round-trip
3. Client sends `{ type: "interrupt" }` over WebSocket
4. Client calls `audioQueue.flush()` — stops playback, increments `flushGeneration` to discard in-flight decodes
5. Server receives interrupt signal
6. Server cancels in-flight TTS stream (via abort signal)
7. Server cancels in-flight LLM stream (same abort signal)
8. Server drops queued utterances and any in-flight STT request (same abort signal)
9. Server returns the controller to `listening`, ready for new user input

## Deployment

The backend is a single long-lived Node process (WebSocket plus HTTP) with a SQLite file on persistent storage, so it needs a host with a persistent disk. The frontend is a standard Next.js app. This is a single-user prototype; the repository contains no deployment configuration or identifiers.
