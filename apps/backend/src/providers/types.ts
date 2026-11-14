import type { ZodType } from "zod";
import type { UsageMeta } from "../usage";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Word-level timing, in seconds. */
export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface SttProvider {
  transcribe(
    pcm16: Buffer,
    signal: AbortSignal,
    opts?: { modelId?: string },
  ): Promise<{ text: string; words: Word[] }>;
}

export interface TtsProvider {
  synthesize(
    sentence: string,
    signal: AbortSignal,
    opts?: { modelId?: string; outputFormat?: string },
  ): AsyncIterable<Uint8Array>;
}

/**
 * `usage` (numbers-only accounting meta) and `model` are optional; the mock provider ignores them.
 * `constrainOutput` asks the provider to hold the model to the schema while it writes (the cloud
 * provider sends it as a JSON schema), so the reply cannot be unbalanced or off-shape. The reply
 * is still validated against `schema`, which also enforces the length limits.
 */
export interface LlmProvider {
  stream(
    req: { system: string; messages: ChatMessage[]; maxTokens: number; usage?: UsageMeta; model?: string },
    signal: AbortSignal,
  ): AsyncIterable<string>;
  structured<T>(
    req: {
      system: string;
      messages: ChatMessage[];
      schema: ZodType<T>;
      maxTokens: number;
      usage?: UsageMeta;
      model?: string;
      constrainOutput?: boolean;
    },
    signal: AbortSignal,
  ): Promise<T>;
}

export interface Providers {
  stt: SttProvider;
  tts: TtsProvider;
  llm: LlmProvider;
}
