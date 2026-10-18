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

## Phase system

The interview progresses through four phases. Transitions are **orchestrator-driven** — the LLM never decides when to transition; `advancePhase()` in `orchestrator.ts` counts user turns and the session controller sends the `phase_change` event.

| Phase | Trigger | Turn threshold |
|---|---|---|
| `intro` | Session start | — |
| `share_work` | After 2 user turns (1 in demo mode) | `turnCount >= 2` |
| `deep_dive` | After 5 user turns | `turnCount >= 5` |
| `wrap_up` | After 10 user turns | `turnCount >= 10` |

Each phase injects a different instruction block via `buildSystemPrompt(phase, topic)` in `llm.ts`. The check runs after the reply to a user turn ends, so `phase_change` follows that turn's `tts_end` (or comes after the cut-off if the reply was interrupted).

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

```
          start()                    item finishes
idle ─────────────▶ thinking ◀──────────────────────── listening
                      │  ▲                                  ▲
         first audio  │  └──── next queued item ────────────┤
                      ▼                                     │
                   speaking ────── item finishes ───────────┘
```

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

- Active session state lives in memory. SQLite (Prisma) is written when a session is created, on each completed turn, on phase changes, and when the session ends (status and report). `DATABASE_URL` selects the file; never hardcode or commit it.
- `DELETE /api/session/:sessionId` removes a session with its turns and report. The dashboard offers it with a confirmation. A live session cannot be deleted (409).
- `RETENTION_DAYS` is off by default. When set, sessions that ended more than that many days ago are deleted once at startup (`retention.ts`).
- Migrations are applied at startup (`migrate.ts`).

## Operating notes

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
| Phase thresholds | 2 / 5 / 10 | Tuned against real interview run-throughs |

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
