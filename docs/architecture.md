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

`buildSystemPrompt` in `interviewer/prompt.ts` builds the system prompt for each turn in this order: the fixed voice-rules wrapper (code, not editable), the interviewer's `persona`, its `style`, the current phase's `instruction`, the `opening` guidance on the first turn only, the `closing` guidance in the last phase only, and a final voice-rules reminder. The reminder comes last so interviewer text never follows the rules. The report prompt (`reportGenerator.ts`) is built from the snapshot's name, purpose, persona and focus items. `contentFeedback`, `deliveryFeedback` and `voice` are stored and validated but not yet read by the report or the speech providers.

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

Malformed JSON is 400 and a body over 64 KB is 413.

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
- `end()` (from `session_end`) first cancels the in-flight reply exactly as `interrupt()` does (nothing more is synthesised or sent for it, and it is not stored), waits for that turn to settle, then generates the report from the committed turns, stores it and sets the status. `abandon()` (socket closed, or idle timeout) aborts everything. `onEnded` fires exactly once with the status reached.
- A session ends itself after `limits.maxTurnsPerSession` user turns (200).

## Session statuses and the end-of-session deadline

A stored session is `active`, `complete`, `failed` or `abandoned`, and leaves `active` exactly once.

| Status | Meaning |
|---|---|
| `complete` | `session_end` was received and the report was stored. Only these are listed in `/api/sessions`. |
| `failed` | The session ended but the report could not be generated or stored (provider error, invalid report, or the deadline). |
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

- Active session state lives in memory. SQLite (Prisma) is written when a session is created (with its interviewer snapshot), on each completed turn, on phase changes, and when the session ends (status and report). `DATABASE_URL` selects the file; never hardcode or commit it.
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
| LLM max_tokens | `300` | Enforces short voice-appropriate responses |
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
