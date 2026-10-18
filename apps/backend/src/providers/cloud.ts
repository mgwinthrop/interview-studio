import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config";
import type { ChatMessage, LlmProvider, Providers, SttProvider, TtsProvider, Word } from "./types";

const STT_ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const TTS_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";
const CARTESIA_ENDPOINT = "https://api.cartesia.ai/tts/bytes";
const LLM_MODEL = "claude-sonnet-4-6"; // locked per AGENTS.md

export interface CloudDeps {
  fetch?: typeof fetch;
  anthropic?: Pick<Anthropic, "messages">;
}

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** Release the connection of a response we are not going to read. */
function discardBody(resp: Response): void {
  resp.body?.cancel().catch(() => undefined);
}

/** Map SDK abort errors (APIUserAbortError has no AbortError name) to a real AbortError. */
function normalizeAbort(err: unknown, signal: AbortSignal): unknown {
  return signal.aborted || err instanceof Anthropic.APIUserAbortError ? abortError() : err;
}

function createStt(config: Config, doFetch: typeof fetch): SttProvider {
  return {
    async transcribe(pcm16, signal) {
      throwIfAborted(signal);
      // Plain fetch rather than the SDK: the SDK's multipart upload sends filename "blob",
      // which the API rejects. A named Blob gives ElevenLabs a proper filename.
      const formData = new FormData();
      formData.append("file", new Blob([pcm16], { type: "audio/pcm" }), "audio.pcm");
      formData.append("model_id", "scribe_v2"); // locked per AGENTS.md
      formData.append("file_format", "pcm_s16le_16");
      formData.append("language_code", "en");

      const response = await doFetch(STT_ENDPOINT, {
        method: "POST",
        signal,
        headers: { "xi-api-key": config.elevenlabsApiKey ?? "" },
        body: formData,
      });
      if (!response.ok) {
        discardBody(response);
        throw new Error(`Scribe request failed with status ${response.status}`);
      }
      const result = (await response.json()) as {
        text?: string;
        words?: { text: string; start: number; end: number; type?: string }[];
      };
      const words: Word[] = (result.words ?? [])
        .filter((w) => w.type === "word")
        .map((w) => ({ text: w.text, start: w.start, end: w.end }));
      return { text: (result.text ?? "").trim(), words };
    },
  };
}

function createTts(config: Config, doFetch: typeof fetch): TtsProvider {
  async function* fromResponse(resp: Response, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    if (!resp.body) throw new Error("TTS response had no body");
    for await (const chunk of resp.body as unknown as AsyncIterable<Uint8Array>) {
      throwIfAborted(signal);
      yield chunk;
    }
  }

  async function* cartesia(
    text: string,
    signal: AbortSignal,
    opts: { apiKey: string; voiceId: string },
  ): AsyncGenerator<Uint8Array> {
    const resp = await doFetch(CARTESIA_ENDPOINT, {
      method: "POST",
      signal,
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
      discardBody(resp);
      throw new Error(`Cartesia TTS failed with status ${resp.status}`);
    }
    yield* fromResponse(resp, signal);
  }

  async function* elevenlabs(text: string, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const resp = await doFetch(`${TTS_ENDPOINT}/${config.elevenlabsVoiceId}/stream`, {
      method: "POST",
      signal,
      headers: {
        "xi-api-key": config.elevenlabsApiKey ?? "",
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_flash_v2_5", // locked per AGENTS.md
      }),
    });
    if (!resp.ok) {
      discardBody(resp);
      throw new Error(`ElevenLabs TTS failed with status ${resp.status}`);
    }
    yield* fromResponse(resp, signal);
  }

  return {
    async *synthesize(sentence, signal) {
      throwIfAborted(signal);
      let yielded = false;
      let primaryError: unknown;
      try {
        for await (const chunk of elevenlabs(sentence, signal)) {
          yielded = true;
          yield chunk;
        }
        return;
      } catch (err) {
        // Fall back only before any audio was emitted, so the client never hears duplicated speech.
        if (isAbort(err) || signal.aborted || yielded || !config.cartesia) throw err;
        primaryError = err;
      }
      try {
        yield* cartesia(sentence, signal, config.cartesia);
      } catch (err) {
        if (isAbort(err) || signal.aborted) throw err;
        const first = primaryError instanceof Error ? primaryError.message : "ElevenLabs TTS failed";
        const second = err instanceof Error ? err.message : "Cartesia TTS failed";
        throw new Error(`${first}; ${second}`);
      }
    },
  };
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in model response");
  return JSON.parse(text.slice(start, end + 1));
}

function createLlm(config: Config, client: Pick<Anthropic, "messages">): LlmProvider {
  const toParams = (messages: ChatMessage[]) =>
    messages.map((m) => ({ role: m.role, content: m.content }));

  return {
    async *stream(req, signal) {
      throwIfAborted(signal);
      try {
        const stream = client.messages.stream(
          {
            model: LLM_MODEL,
            max_tokens: req.maxTokens,
            system: req.system,
            messages: toParams(req.messages),
          },
          { signal },
        );
        for await (const event of stream) {
          throwIfAborted(signal);
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield event.delta.text;
          }
        }
      } catch (err) {
        throw normalizeAbort(err, signal);
      }
    },

    async structured(req, signal) {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        throwIfAborted(signal);
        let response;
        try {
          response = await client.messages.create(
            {
              model: LLM_MODEL,
              max_tokens: req.maxTokens,
              system: req.system,
              messages: toParams(req.messages),
            },
            { signal },
          );
        } catch (err) {
          throw normalizeAbort(err, signal);
        }
        const block = response.content[0];
        try {
          if (!block || block.type !== "text") throw new Error("Unexpected model response block");
          return req.schema.parse(extractJson(block.text));
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Structured output failed");
    },
  };
}

export function createCloudProviders(config: Config, deps: CloudDeps = {}): Providers {
  const doFetch = deps.fetch ?? fetch;
  const client = deps.anthropic ?? new Anthropic({ apiKey: config.anthropicApiKey ?? "" });
  return {
    stt: createStt(config, doFetch),
    tts: createTts(config, doFetch),
    llm: createLlm(config, client),
  };
}
