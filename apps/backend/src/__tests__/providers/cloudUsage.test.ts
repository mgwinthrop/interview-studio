import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { createCloudProviders } from "../../providers/cloud";
import { createProviders } from "../../providers";
import type { Config } from "../../config";
import type { UsageRecord } from "../../usage";

const config: Config = {
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

const live = new AbortController().signal;
const USAGE = { input_tokens: 120, output_tokens: 40 };
const META = { feature: "report" as const, ownerId: "owner-1", sessionId: "sess-1" };
const PROMPT = "okapi-secret-prompt";

function client(opts: { create?: (n: number) => unknown; events?: unknown[] }) {
  let n = 0;
  const create = vi.fn(async () => opts.create?.(++n) ?? { content: [{ type: "text", text: '{"ok":true}' }], usage: USAGE });
  const stream = vi.fn(() =>
    (async function* () {
      for (const e of opts.events ?? []) yield e;
    })(),
  );
  return { messages: { create, stream } } as unknown as Pick<Anthropic, "messages">;
}

const structuredReq = {
  system: PROMPT,
  messages: [{ role: "user" as const, content: PROMPT }],
  schema: z.object({ ok: z.boolean() }),
  maxTokens: 50,
  usage: META,
};

async function drain(it: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const s of it) out += s;
  return out;
}

describe("cloud llm usage reporting", () => {
  it("structured reports one record with the response's token counts and the request meta", async () => {
    const onUsage = vi.fn<(r: UsageRecord) => void>();
    const { llm } = createCloudProviders(config, { anthropic: client({}), onUsage });
    await llm.structured(structuredReq, live);
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage.mock.calls[0][0]).toEqual({
      ...META,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 120,
      outputTokens: 40,
    });
    expect(JSON.stringify(onUsage.mock.calls)).not.toContain(PROMPT);
  });

  it("structured reports once per attempt: a retry reports twice", async () => {
    const onUsage = vi.fn<(r: UsageRecord) => void>();
    const anthropic = client({
      create: (n) => ({ content: [{ type: "text", text: n === 1 ? "no json" : '{"ok":true}' }], usage: USAGE }),
    });
    const { llm } = createCloudProviders(config, { anthropic, onUsage });
    await llm.structured(structuredReq, live);
    expect(onUsage).toHaveBeenCalledTimes(2);
    for (const [r] of onUsage.mock.calls) expect(r).toMatchObject({ ...META, inputTokens: 120, outputTokens: 40 });
  });

  it("reports the model actually used, for structured attempts and stream", async () => {
    const onUsage = vi.fn<(r: UsageRecord) => void>();
    const anthropic = client({
      create: (n) => ({ content: [{ type: "text", text: n === 1 ? "no json" : '{"ok":true}' }], usage: USAGE }),
      events: [{ type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } }],
    });
    const { llm } = createCloudProviders(config, { anthropic, onUsage });
    await llm.structured({ ...structuredReq, model: "m-x" }, live);
    await drain(llm.stream({ system: "s", messages: [], maxTokens: 5, usage: META, model: "m-y" }, live));
    await drain(llm.stream({ system: "s", messages: [], maxTokens: 5, usage: META }, live));
    expect(onUsage.mock.calls.map(([r]) => r.model)).toEqual(["m-x", "m-x", "m-y", "claude-sonnet-4-6"]);
  });

  it("missing usage gives null tokens", async () => {
    const onUsage = vi.fn<(r: UsageRecord) => void>();
    const anthropic = client({ create: () => ({ content: [{ type: "text", text: '{"ok":true}' }] }) });
    const { llm } = createCloudProviders(config, { anthropic, onUsage });
    await llm.structured(structuredReq, live);
    expect(onUsage.mock.calls[0][0]).toMatchObject({ inputTokens: null, outputTokens: null });
  });

  it("a throwing onUsage never fails the call", async () => {
    const onUsage = vi.fn(() => {
      throw new Error("boom");
    });
    const { llm } = createCloudProviders(config, { anthropic: client({}), onUsage });
    await expect(llm.structured(structuredReq, live)).resolves.toEqual({ ok: true });
  });

  it("stream reports the final message usage after the stream completes", async () => {
    const onUsage = vi.fn<(r: UsageRecord) => void>();
    const anthropic = client({
      events: [
        { type: "message_start", message: { usage: { input_tokens: 120, output_tokens: 1 } } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
        { type: "message_delta", delta: {}, usage: { output_tokens: 40 } },
        { type: "message_stop" },
      ],
    });
    const { llm } = createCloudProviders(config, { anthropic, onUsage });
    const meta = { feature: "conversation" as const, ownerId: "o", sessionId: "s" };
    expect(await drain(llm.stream({ system: PROMPT, messages: [], maxTokens: 300, usage: meta }, live))).toBe("Hi");
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage.mock.calls[0][0]).toEqual({
      ...meta,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 120,
      outputTokens: 40,
    });
  });

  it("stream without usage events reports null tokens", async () => {
    const onUsage = vi.fn<(r: UsageRecord) => void>();
    const anthropic = client({ events: [{ type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } }] });
    const { llm } = createCloudProviders(config, { anthropic, onUsage });
    await drain(llm.stream({ system: "s", messages: [], maxTokens: 300, usage: { feature: "conversation" } }, live));
    expect(onUsage.mock.calls[0][0]).toMatchObject({ feature: "conversation", inputTokens: null, outputTokens: null });
  });

  it("an aborted stream reports nothing", async () => {
    const onUsage = vi.fn<(r: UsageRecord) => void>();
    const controller = new AbortController();
    const anthropic = client({
      events: [
        { type: "message_start", message: { usage: { input_tokens: 120, output_tokens: 1 } } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
        { type: "content_block_delta", delta: { type: "text_delta", text: " there" } },
        { type: "message_delta", delta: {}, usage: { output_tokens: 40 } },
      ],
    });
    const { llm } = createCloudProviders(config, { anthropic, onUsage });
    const err = await (async () => {
      for await (const _ of llm.stream({ system: "s", messages: [], maxTokens: 300, usage: META }, controller.signal)) {
        controller.abort();
      }
    })().catch((e: Error) => e);
    expect((err as Error).name).toBe("AbortError");
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("a stream the consumer stops early reports nothing", async () => {
    const onUsage = vi.fn<(r: UsageRecord) => void>();
    const anthropic = client({
      events: [
        { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
        { type: "message_delta", delta: {}, usage: { output_tokens: 40 } },
      ],
    });
    const { llm } = createCloudProviders(config, { anthropic, onUsage });
    for await (const _ of llm.stream({ system: "s", messages: [], maxTokens: 300, usage: META }, live)) break;
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("an aborted structured call reports nothing", async () => {
    const onUsage = vi.fn<(r: UsageRecord) => void>();
    const controller = new AbortController();
    controller.abort();
    const { llm } = createCloudProviders(config, { anthropic: client({}), onUsage });
    await expect(llm.structured(structuredReq, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("the mock profile never reports usage, even with onUsage given", async () => {
    const onUsage = vi.fn<(r: UsageRecord) => void>();
    const { llm } = createProviders({ ...config, profile: "mock" }, { onUsage });
    await drain(llm.stream({ system: "s", messages: [], maxTokens: 300, usage: META }, live));
    await llm.structured({ ...structuredReq, schema: z.object({}).passthrough() }, live);
    expect(onUsage).not.toHaveBeenCalled();
  });
});
