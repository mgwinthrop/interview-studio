# Architecture

## Voice pipeline

```
[Browser Mic — getUserMedia]
     │  PCM16, 16kHz mono, 100ms frames
     ▼
[AudioWorkletProcessor — off main thread]
     │  encodes raw PCM
     ▼
[VAD — @ricky0123/vad-web (Silero WASM)]
     │  onSpeechEnd fires → sends buffered PCM frames
     ▼
[WebSocket binary frame → Backend]
     │
     ▼
[STT — ElevenLabs Scribe v2 streaming]
     │  final transcript string
     ▼
[LLM — Claude Sonnet 4.6, max_tokens: 300]
     │  token stream
     ▼
[SentenceChunker — splits on . ? ! boundaries]
     │  complete sentences
     ▼
[TTS — ElevenLabs eleven_flash_v2_5]
     │  MP3 audio chunks (Cartesia sonic-english if ElevenLabs fails)
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

| Stage | Target |
|---|---|
| VAD end-of-turn | 200–400ms |
| Audio transmission | ~50ms |
| Scribe v2 transcript | ~150ms |
| LLM first token | 300–500ms |
| Sentence chunker | ~50ms |
| ElevenLabs first audio | ~75ms |
| Network to client | ~50ms |
| **Total** | **~750–1200ms** |

## Phase system

The interview progresses through four phases. Transitions are **orchestrator-driven** — the LLM never decides when to transition; `shouldTransition()` in `llm.ts` counts user turns and fires `phase_change` events.

| Phase | Trigger | Turn threshold |
|---|---|---|
| `intro` | Session start | — |
| `share_work` | After 2 user turns (1 in demo mode) | `turnCount >= 2` |
| `deep_dive` | After 5 user turns | `turnCount >= 5` |
| `wrap_up` | After 10 user turns | `turnCount >= 10` |

Each phase injects a different instruction block via `buildSystemPrompt(phase, topic)` in `llm.ts`.

## Locked decisions

These are not up for debate. Change requires an explicit instruction and a spec update.

| Decision | Value | Why locked |
|---|---|---|
| LLM model | `claude-sonnet-4-6` | Latency + quality balance confirmed in testing |
| LLM max_tokens | `300` | Enforces short voice-appropriate responses |
| STT | ElevenLabs Scribe v2 | Best streaming accuracy for voice; Scribe v2 is the current API |
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
7. Server cancels in-flight LLM stream (via `AbortController`)
8. Server resets Scribe v2 connection
9. Server marks state ready for new user input

## Persistence

Active session state (`SessionState`) is in-memory only. SQLite is written on:
- Each completed turn (after `tts_end`)
- Phase transitions
- Session end

The SQLite file lives at `/data/interview.db` on a Fly.io persistent volume. `DATABASE_URL` is a Fly.io secret — never hardcode it.

## Infrastructure

- **Backend:** Fly.io, region `iad`, `min_machines_running = 1` (no cold starts)
- **Frontend:** Vercel, auto-deploys from `main` branch
- **DB volume:** `fly volume create interview_data --size 1 --region iad` (one-time setup)
