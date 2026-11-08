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
  transcribe(pcm16: Buffer, signal: AbortSignal): Promise<{ text: string; words: Word[] }>;
}

export interface TtsProvider {
  synthesize(sentence: string, signal: AbortSignal): AsyncIterable<Uint8Array>;
}

/** `usage` (numbers-only accounting meta) is optional; the mock provider ignores it. */
export interface LlmProvider {
  stream(
    req: { system: string; messages: ChatMessage[]; maxTokens: number; usage?: UsageMeta },
    signal: AbortSignal,
  ): AsyncIterable<string>;
  structured<T>(
    req: { system: string; messages: ChatMessage[]; schema: ZodType<T>; maxTokens: number; usage?: UsageMeta },
    signal: AbortSignal,
  ): Promise<T>;
}

export interface Providers {
  stt: SttProvider;
  tts: TtsProvider;
  llm: LlmProvider;
}
