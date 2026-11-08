import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { createCloudProviders } from "../../providers/cloud";
import { createProviders } from "../../providers";
import type { Config } from "../../config";
import { runProviderContract } from "./contract";

const baseConfig: Config = {
  host: "127.0.0.1",
  port: 3001,
  allowedOrigins: [],
  profile: "cloud",
  databaseUrl: "file:./test.db",
  anthropicApiKey: "anthropic-key",
  elevenlabsApiKey: "eleven-key",
  elevenlabsVoiceId: "voice123",
  auth: { mode: "local" },
  limits: {
    maxPayloadBytes: 1,
    maxTextFrameBytes: 1,
    maxConcurrentSessionsPerOwner: 1,
    maxTurnsPerSession: 1,
    idleTimeoutMs: 1,
    reportTimeoutMs: 1,
  },
  debugLogText: false,
  reportFillerCounts: false,
  cloudSend: false,
};

const cartesiaConfig: Config = { ...baseConfig, cartesia: { apiKey: "c-key", voiceId: "c-voice" } };

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

function streamOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new Uint8Array(c));
      controller.close();
    },
  });
}

type Handler = (url: string, init: RequestInit) => Response;

function fakeFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    if (init?.signal?.aborted) throw abortError();
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function fakeAnthropic(replyText: string) {
  const stream = vi.fn((_params: unknown, _opts?: unknown) =>
    (async function* () {
      yield { type: "message_start" };
      for (const piece of replyText.match(/.{1,4}/g) ?? []) {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: piece } };
      }
    })(),
  );
  const create = vi.fn(async (_params: unknown, _opts?: unknown) => ({
    content: [{ type: "text", text: replyText }],
  }));
  const client = { messages: { stream, create } } as unknown as Pick<Anthropic, "messages">;
  return { client, stream, create };
}

const sttOk = () =>
  new Response(
    JSON.stringify({
      text: " hello world ",
      words: [
        { text: "hello", start: 0, end: 0.4, type: "word" },
        { text: " ", start: 0.4, end: 0.5, type: "spacing" },
        { text: "world", start: 0.5, end: 0.9, type: "word" },
      ],
    }),
    { status: 200 },
  );

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

const live = new AbortController().signal;

describe("cloud stt", () => {
  it("posts multipart to Scribe and maps words", async () => {
    const { fn, calls } = fakeFetch(sttOk);
    const { stt } = createCloudProviders(baseConfig, { fetch: fn });
    const result = await stt.transcribe(Buffer.alloc(3200), live);
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["xi-api-key"]).toBe("eleven-key");
    const form = calls[0].init.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("file_format")).toBe("pcm_s16le_16");
    expect(form.get("language_code")).toBe("en");
    expect(result.text).toBe("hello world");
    expect(result.words).toEqual([
      { text: "hello", start: 0, end: 0.4 },
      { text: "world", start: 0.5, end: 0.9 },
    ]);
  });

  it("sends a given model_id", async () => {
    const { fn, calls } = fakeFetch(sttOk);
    await createCloudProviders(baseConfig, { fetch: fn }).stt.transcribe(Buffer.alloc(10), live, {
      modelId: "scribe_v9",
    });
    const form = calls[0].init.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v9");
    expect(form.get("file_format")).toBe("pcm_s16le_16");
    expect(form.get("language_code")).toBe("en");
  });

  it("returns empty words when the response has none", async () => {
    const { fn } = fakeFetch(() => new Response(JSON.stringify({ text: "hi" }), { status: 200 }));
    const result = await createCloudProviders(baseConfig, { fetch: fn }).stt.transcribe(
      Buffer.alloc(10),
      live,
    );
    expect(result).toEqual({ text: "hi", words: [] });
  });

  it("rejects with the status but not the body on a non-OK response", async () => {
    const { fn } = fakeFetch(() => new Response("secret-body-detail", { status: 503 }));
    const err = await createCloudProviders(baseConfig, { fetch: fn })
      .stt.transcribe(Buffer.alloc(10), live)
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("503");
    expect((err as Error).message).not.toContain("secret-body-detail");
  });
});

describe("cloud tts", () => {
  it("posts to the ElevenLabs stream endpoint and yields body chunks", async () => {
    const { fn, calls } = fakeFetch(() => new Response(streamOf([1, 2], [3]), { status: 200 }));
    const chunks = await collect(
      createCloudProviders(baseConfig, { fetch: fn }).tts.synthesize("Hi there.", live),
    );
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice123/stream");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toEqual({ text: "Hi there.", model_id: "eleven_flash_v2_5" });
    expect(chunks.map((c) => Array.from(c))).toEqual([[1, 2], [3]]);
  });

  it("sends a given model_id and output_format query parameter", async () => {
    const { fn, calls } = fakeFetch(() => new Response(streamOf([1]), { status: 200 }));
    await collect(
      createCloudProviders(baseConfig, { fetch: fn }).tts.synthesize("Hi.", live, {
        modelId: "eleven_x",
        outputFormat: "mp3_44100_64",
      }),
    );
    expect(calls[0].url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice123/stream?output_format=mp3_44100_64",
    );
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ text: "Hi.", model_id: "eleven_x" });
  });

  it("encodes the output_format value and adds no query without it", async () => {
    const { fn, calls } = fakeFetch(() => new Response(streamOf([1]), { status: 200 }));
    const { tts } = createCloudProviders(baseConfig, { fetch: fn });
    await collect(tts.synthesize("Hi.", live, { outputFormat: "a/b&c=d" }));
    await collect(tts.synthesize("Hi.", live, { modelId: "m" }));
    expect(calls[0].url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice123/stream?output_format=a%2Fb%26c%3Dd",
    );
    expect(calls[1].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice123/stream");
  });

  it("keeps the Cartesia fallback request unchanged when options are given", async () => {
    const { fn, calls } = fakeFetch((url) =>
      url.includes("elevenlabs")
        ? new Response("boom", { status: 500 })
        : new Response(streamOf([9]), { status: 200 }),
    );
    await collect(
      createCloudProviders(cartesiaConfig, { fetch: fn }).tts.synthesize("Hi.", live, {
        modelId: "eleven_x",
        outputFormat: "mp3_44100_64",
      }),
    );
    expect(calls[1].url).toBe("https://api.cartesia.ai/tts/bytes");
    expect(calls[1].init.headers).toEqual({
      "Cartesia-Version": "2024-06-10",
      "X-API-Key": "c-key",
      "Content-Type": "application/json",
    });
    expect(calls[1].init.body).toBe(
      JSON.stringify({
        model_id: "sonic-english",
        transcript: "Hi.",
        voice: { mode: "id", id: "c-voice" },
        output_format: { container: "mp3", encoding: "mp3", sample_rate: 44100 },
      }),
    );
  });

  it("falls back to Cartesia when ElevenLabs returns 500", async () => {
    const { fn, calls } = fakeFetch((url) =>
      url.includes("elevenlabs")
        ? new Response("boom", { status: 500 })
        : new Response(streamOf([9, 9]), { status: 200 }),
    );
    const chunks = await collect(
      createCloudProviders(cartesiaConfig, { fetch: fn }).tts.synthesize("Hi.", live),
    );
    expect(calls[1].url).toBe("https://api.cartesia.ai/tts/bytes");
    const body = JSON.parse(calls[1].init.body as string);
    expect(body.voice).toEqual({ mode: "id", id: "c-voice" });
    expect(chunks.map((c) => Array.from(c))).toEqual([[9, 9]]);
  });

  it("rejects on a 500 when no Cartesia is configured", async () => {
    const { fn } = fakeFetch(() => new Response("boom", { status: 500 }));
    await expect(
      collect(createCloudProviders(baseConfig, { fetch: fn }).tts.synthesize("Hi.", live)),
    ).rejects.toThrow("500");
  });

  it("rejects when both ElevenLabs and Cartesia fail", async () => {
    const { fn } = fakeFetch(() => new Response("boom", { status: 500 }));
    await expect(
      collect(createCloudProviders(cartesiaConfig, { fetch: fn }).tts.synthesize("Hi.", live)),
    ).rejects.toThrow("500");
  });

  it("mentions both statuses when ElevenLabs and Cartesia both fail", async () => {
    const { fn } = fakeFetch((url) =>
      url.includes("elevenlabs")
        ? new Response("eleven-body", { status: 500 })
        : new Response("cartesia-body", { status: 429 }),
    );
    const err = await collect(
      createCloudProviders(cartesiaConfig, { fetch: fn }).tts.synthesize("Hi.", live),
    ).catch((e: Error) => e);
    expect((err as Error).message).toContain("500");
    expect((err as Error).message).toContain("429");
    expect((err as Error).message).not.toContain("body");
  });
});

describe("cloud llm", () => {
  it("stream passes model and maxTokens and yields text deltas", async () => {
    const { client, stream } = fakeAnthropic("Hello there");
    const { llm } = createCloudProviders(baseConfig, { anthropic: client });
    const pieces = await collect(
      llm.stream({ system: "sys", messages: [{ role: "user", content: "hi" }], maxTokens: 300 }, live),
    );
    expect(pieces.join("")).toBe("Hello there");
    const params = stream.mock.calls[0][0] as Record<string, unknown>;
    expect(params.model).toBe("claude-sonnet-4-6");
    expect(params.max_tokens).toBe(300);
    expect(params.system).toBe("sys");
  });

  it("structured retries once on a parse failure then succeeds", async () => {
    const { client, create } = fakeAnthropic("");
    create
      .mockResolvedValueOnce({ content: [{ type: "text", text: "no json here" }] })
      .mockResolvedValueOnce({ content: [{ type: "text", text: 'Sure: {"ok": true}' }] });
    const value = await createCloudProviders(baseConfig, { anthropic: client }).llm.structured(
      {
        system: "s",
        messages: [{ role: "user", content: "x" }],
        schema: z.object({ ok: z.boolean() }),
        maxTokens: 50,
      },
      live,
    );
    expect(value).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("structured rejects after the retry also fails", async () => {
    const { client, create } = fakeAnthropic("not json");
    await expect(
      createCloudProviders(baseConfig, { anthropic: client }).llm.structured(
        {
          system: "s",
          messages: [{ role: "user", content: "x" }],
          schema: z.object({ ok: z.boolean() }),
          maxTokens: 50,
        },
        live,
      ),
    ).rejects.toBeDefined();
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe("cloud llm model", () => {
  const req = { system: "s", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 10 };

  it("stream and structured send a given model and the fallback otherwise", async () => {
    const { client, stream, create } = fakeAnthropic('{"ok":true}');
    const { llm } = createCloudProviders(baseConfig, { anthropic: client });
    await collect(llm.stream({ ...req, model: "m-1" }, live));
    await collect(llm.stream(req, live));
    const schema = z.object({ ok: z.boolean() });
    await llm.structured({ ...req, schema, model: "m-2" }, live);
    await llm.structured({ ...req, schema }, live);
    expect((stream.mock.calls[0][0] as { model: string }).model).toBe("m-1");
    expect((stream.mock.calls[1][0] as { model: string }).model).toBe("claude-sonnet-4-6");
    expect((create.mock.calls[0][0] as { model: string }).model).toBe("m-2");
    expect((create.mock.calls[1][0] as { model: string }).model).toBe("claude-sonnet-4-6");
  });
});

describe("cloud llm abort", () => {
  const req = {
    system: "s",
    messages: [{ role: "user" as const, content: "x" }],
    maxTokens: 50,
  };

  async function expectAbortName(run: () => Promise<unknown>): Promise<void> {
    const err = await run().catch((e: Error) => e);
    expect((err as Error).name).toBe("AbortError");
  }

  it("stream maps APIUserAbortError while awaiting the stream start", async () => {
    const { client, stream } = fakeAnthropic("x");
    stream.mockImplementation(() => {
      throw new Anthropic.APIUserAbortError();
    });
    const controller = new AbortController();
    const iter = createCloudProviders(baseConfig, { anthropic: client }).llm.stream(
      req,
      controller.signal,
    );
    await expectAbortName(() => collect(iter));
  });

  it("stream maps APIUserAbortError raised mid-iteration", async () => {
    const { client, stream } = fakeAnthropic("x");
    const controller = new AbortController();
    stream.mockImplementation(() =>
      (async function* () {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: "a" } };
        throw new Anthropic.APIUserAbortError();
      })(),
    );
    const iter = createCloudProviders(baseConfig, { anthropic: client }).llm.stream(
      req,
      controller.signal,
    );
    await expectAbortName(() => collect(iter));
  });

  it("stream maps any error to AbortError once the signal has aborted mid-flight", async () => {
    const { client, stream } = fakeAnthropic("x");
    const controller = new AbortController();
    stream.mockImplementation(() =>
      (async function* () {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: "a" } };
        controller.abort();
        throw new Error("socket closed");
      })(),
    );
    const iter = createCloudProviders(baseConfig, { anthropic: client }).llm.stream(
      req,
      controller.signal,
    );
    await expectAbortName(() => collect(iter));
  });

  it("structured maps APIUserAbortError to AbortError without retrying", async () => {
    const { client, create } = fakeAnthropic("x");
    const controller = new AbortController();
    create.mockImplementation(async () => {
      controller.abort();
      throw new Anthropic.APIUserAbortError();
    });
    await expectAbortName(() =>
      createCloudProviders(baseConfig, { anthropic: client }).llm.structured(
        { ...req, schema: z.object({ ok: z.boolean() }) },
        controller.signal,
      ),
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("createProviders", () => {
  it("returns mock providers for the mock profile", async () => {
    const providers = createProviders({ ...baseConfig, profile: "mock" });
    const result = await providers.stt.transcribe(Buffer.alloc(10), live);
    expect(typeof result.text).toBe("string");
  });
});

function contractProviders() {
  const { fn } = fakeFetch((url) => {
    if (url.includes("speech-to-text")) return sttOk();
    return new Response(streamOf([1, 2, 3]), { status: 200 });
  });
  const { client } = fakeAnthropic('{"ok": true}');
  return createCloudProviders(baseConfig, { fetch: fn, anthropic: client });
}

runProviderContract("cloud", contractProviders);
