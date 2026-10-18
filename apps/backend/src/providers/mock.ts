import type { Providers } from "./types";

export interface MockScript {
  sttTexts?: string[];
  llmReplies?: string[];
  /** 1-based LLM call number that throws. Counts `stream` and `structured` calls together; calls aborted before starting are not counted. */
  failLlmOnCall?: number;
  ttsDelayMs?: number;
  structured?: unknown;
}

const PIECE_SIZE = 5;

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/** Resolves after ms, or rejects with AbortError if the signal aborts first. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createMockProviders(script: MockScript = {}): Providers {
  const sttTexts = script.sttTexts?.length ? script.sttTexts : ["hello there"];
  const llmReplies = script.llmReplies?.length ? script.llmReplies : ["This is a mock reply."];
  const structuredValue = script.structured !== undefined ? script.structured : { ok: true };
  const ttsDelayMs = script.ttsDelayMs ?? 0;
  let sttCalls = 0;
  let llmCalls = 0;

  return {
    stt: {
      async transcribe(_pcm16, signal) {
        throwIfAborted(signal);
        const text = sttTexts[sttCalls++ % sttTexts.length];
        const words = text
          .split(/\s+/)
          .filter(Boolean)
          .map((w, i) => ({ text: w, start: i * 0.3, end: i * 0.3 + 0.25 }));
        return { text, words };
      },
    },
    tts: {
      async *synthesize(_sentence, signal) {
        throwIfAborted(signal);
        for (let i = 0; i < 2; i++) {
          if (ttsDelayMs > 0) await delay(ttsDelayMs, signal);
          throwIfAborted(signal);
          yield new Uint8Array([0xff, 0xfb, i, 0]);
        }
      },
    },
    llm: {
      async *stream(_req, signal) {
        throwIfAborted(signal);
        const call = ++llmCalls;
        if (script.failLlmOnCall === call) throw new Error("Mock LLM failure");
        const reply = llmReplies[(call - 1) % llmReplies.length];
        for (let i = 0; i < reply.length; i += PIECE_SIZE) {
          throwIfAborted(signal);
          yield reply.slice(i, i + PIECE_SIZE);
          // Yield to the event loop so mid-stream aborts can land between pieces.
          await Promise.resolve();
        }
        throwIfAborted(signal);
      },
      async structured(req, signal) {
        throwIfAborted(signal);
        const call = ++llmCalls;
        if (script.failLlmOnCall === call) throw new Error("Mock LLM failure");
        return req.schema.parse(structuredValue);
      },
    },
  };
}
