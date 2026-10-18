import type { ZodType } from "zod";

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

export interface LlmProvider {
  stream(
    req: { system: string; messages: ChatMessage[]; maxTokens: number },
    signal: AbortSignal,
  ): AsyncIterable<string>;
  structured<T>(
    req: { system: string; messages: ChatMessage[]; schema: ZodType<T>; maxTokens: number },
    signal: AbortSignal,
  ): Promise<T>;
}

export interface Providers {
  stt: SttProvider;
  tts: TtsProvider;
  llm: LlmProvider;
}
