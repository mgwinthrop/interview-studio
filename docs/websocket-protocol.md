# WebSocket Protocol

The backend exposes a single WebSocket endpoint at the root path (`ws://host/`). All JSON messages are typed — never send untyped blobs. Binary frames carry audio data only.

## Connection

```
ws://localhost:3001               # local dev
wss://YOUR_PERSONAL_BACKEND  # optional personal deployment
```

The client opens the connection, then sends `session_start` as the first message. The server rejects any other message type before `session_start`.

## Client → Server

All client messages are JSON strings except `audio` frames which are **raw binary** (ArrayBuffer).

| Type | Payload | Notes |
|---|---|---|
| `audio` | Raw PCM16 binary frame | Sent as binary WebSocket frame, not JSON. 16kHz mono, 100ms chunks. |
| `session_start` | `{ type, topicId, demo? }` | **Must include `topicId`** — one of `"ai-se-delivery"`, `"experience-design"`, `"product-design-strategy"`. `demo` shortens intro to 1 turn. |
| `session_end` | `{ type }` | Triggers report generation and `session_complete` response. |
| `interrupt` | `{ type }` | Cancels in-flight LLM + TTS streams. Server resets for next user turn. |
| `text_input` | `{ type, content: string }` | Text fallback — bypasses STT. Treated identically to a completed voice turn. |

## Server → Client

All server messages are JSON strings except `tts_chunk` which is a **raw binary frame**.

| Type | Payload | When sent |
|---|---|---|
| `tts_chunk` | Raw MP3 binary frame | Each audio chunk during TTS streaming. Sent as binary WebSocket frame. |
| `tts_start` | `{ type }` | Before the first `tts_chunk` of a turn. Signals AI is now speaking. |
| `tts_end` | `{ type }` | After the last `tts_chunk` of a turn. Signals AI has finished speaking. Suppressed if TTS is aborted. |
| `transcript` | `{ type, text, role, partial? }` | User transcript after STT (`role: "user"`). AI transcript per sentence chunk (`role: "assistant"`, `partial: true` mid-turn, `partial: false` on final). |
| `phase_change` | `{ type, phase }` | When the orchestrator transitions to the next phase. `phase` is one of `"intro"`, `"share_work"`, `"deep_dive"`, `"wrap_up"`. |
| `session_complete` | `{ type, reportId }` | After report generation finishes. `reportId` is the SQLite session ID. |
| `stt_error` | `{ type, reason }` | Non-fatal STT failure. Client should show a toast; session continues. |
| `latency_metric` | `{ type, ms }` | Emitted on first `tts_chunk` send. `ms` = elapsed time since `vadT0` (when `onSpeechEnd` fired). |

## Binary frame detection

The server uses the `isBinary` flag from the `ws` library to distinguish audio frames from JSON messages:

```typescript
ws.on('message', (data, isBinary) => {
  if (isBinary) {
    // PCM16 audio frame — forward to STT
  } else {
    // JSON message — parse and route by type
  }
});
```

The client sets `ws.binaryType = "arraybuffer"` so binary frames arrive as `ArrayBuffer`, not `Blob`.

## Typical session flow

```
Client                          Server
  │── session_start ──────────────▶│
  │◀─ transcript (assistant, partial: false, intro greeting) ──│
  │◀─ tts_start ────────────────────│
  │◀─ tts_chunk (binary) ──────────│  (repeated)
  │◀─ tts_end ──────────────────────│
  │
  │── audio (binary, PCM) ─────────▶│  (repeated during speech)
  │◀─ transcript (user) ────────────│
  │◀─ transcript (assistant, partial: true) ──│  (per sentence)
  │◀─ tts_start ────────────────────│
  │◀─ tts_chunk (binary) ──────────│
  │◀─ latency_metric ───────────────│
  │◀─ tts_end ──────────────────────│
  │
  │── session_end ─────────────────▶│
  │◀─ session_complete ─────────────│
```
