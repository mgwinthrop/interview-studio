import { WebSocket } from "ws";
import { send } from "./wsUtils";

const TTS_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";
const CARTESIA_ENDPOINT = "https://api.cartesia.ai/tts/bytes";

/**
 * Cartesia TTS fallback (spec §5.7 fallback clause).
 *
 * Guard: tts_start must be emitted exactly once — ElevenLabs may have sent it already.
 * `alreadyStarted` is true when ElevenLabs began streaming before failing mid-stream.
 * Returns true if tts_start is now guaranteed to have been sent (caller updates `started`).
 */
async function streamFromCartesia(
  text: string,
  ws: WebSocket,
  opts: CartesiaOptions,
  controller: AbortController,
  alreadyStarted: boolean
): Promise<boolean> {
  try {
    const resp = await fetch(CARTESIA_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Cartesia-Version": "2024-06-10",
        "X-API-Key": opts.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: "sonic-english",
        transcript: text,
        voice: { mode: "id", id: opts.voiceId },
        output_format: { container: "mp3", encoding: "mp3", sample_rate: 44100 },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`Cartesia TTS error ${resp.status}:`, body);
      return alreadyStarted;
    }

    if (!resp.body) return alreadyStarted;

    if (!alreadyStarted) {
      send(ws, { type: "tts_start" });
    }

    for await (const chunk of resp.body as unknown as AsyncIterable<Uint8Array>) {
      if (controller.signal.aborted) break;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.from(chunk));
      }
    }
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return alreadyStarted;
    console.error("Cartesia TTS stream error:", err);
    return alreadyStarted;
  }
}

/**
 * Stream TTS audio to the client over WebSocket.
 *
 * Protocol (§5.3):
 *   → { type: "tts_start" }        (JSON text frame)
 *   → <binary MP3 chunk>           (binary frame per chunk, approved format)
 *   → { type: "tts_end" }          (JSON text frame)
 *
 * tts_end is guaranteed to be sent whenever tts_start was sent, including on
 * error mid-stream, so the client audio queue never hangs.
 *
 * Returns an AbortController so the caller can cancel in-flight streams
 * for interrupt handling (§5.9).
 */
export interface CartesiaOptions {
  apiKey: string;
  voiceId: string;
}

export function streamTTS(
  text: string,
  ws: WebSocket,
  voiceId: string,
  apiKey: string,
  vadT0?: number,              // When set, emit latency_metric on the first tts_chunk (spec §5.5)
  cartesiaOptions?: CartesiaOptions  // If set, retry via Cartesia on ElevenLabs failure
): { promise: Promise<void>; abort: AbortController } {
  const controller = new AbortController();

  const promise = (async () => {
    let started = false;
    let firstChunkSent = false;
    try {
      const resp = await fetch(`${TTS_ENDPOINT}/${voiceId}/stream`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_flash_v2_5", // locked per AGENTS.md
        }),
      });

      if (!resp.ok) {
        const body = await resp.text();
        console.error(`TTS error ${resp.status}:`, body);
        if (cartesiaOptions) {
          console.log(`TTS: ElevenLabs failed (status ${resp.status}), trying Cartesia fallback`);
          started = await streamFromCartesia(text, ws, cartesiaOptions, controller, started);
        }
        return;
      }

      if (!resp.body) return;

      send(ws, { type: "tts_start" });
      started = true;

      for await (const chunk of resp.body as unknown as AsyncIterable<Uint8Array>) {
        if (controller.signal.aborted) break;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(Buffer.from(chunk));
          // Emit latency_metric on first chunk only (spec §5.5 + AGENTS.md latency rules)
          if (!firstChunkSent && vadT0 !== undefined) {
            send(ws, { type: "latency_metric", ms: Date.now() - vadT0 });
            firstChunkSent = true;
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("TTS stream error:", err);
      if (cartesiaOptions) {
        console.log("TTS: ElevenLabs stream error, trying Cartesia fallback");
        started = await streamFromCartesia(text, ws, cartesiaOptions, controller, started);
      }
    } finally {
      // Always close the bracket if tts_start was sent and this wasn't an interrupt
      if (started && !controller.signal.aborted) {
        send(ws, { type: "tts_end" });
      }
    }
  })();

  return { promise, abort: controller };
}
