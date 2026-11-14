import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { createCloudProviders } from "../../providers/cloud";
import type { Config } from "../../config";

const config = { profile: "cloud", anthropicApiKey: "k", elevenlabsApiKey: "k", elevenlabsVoiceId: "v" } as Config;
const live = new AbortController().signal;
const USAGE = { input_tokens: 10, output_tokens: 10 };

// What the report model really returned twice for one session: the closing brace of
// "content" is missing, so "nextSteps" sits inside "content" and the outer object never closes.
const MISSING_BRACE =
  '{"content":{"summary":"A short talk.","strengths":[{"area":"Stakes","quote":"the first time I gave a talk","note":"Clear."}],' +
  '"developAreas":[{"area":"Depth","suggestion":"Add a detail."}],"nextSteps":["Open with the room."]}';
const FIXED =
  '{"content":{"summary":"A short talk.","strengths":[{"area":"Stakes","quote":"the first time I gave a talk","note":"Clear."}],' +
  '"developAreas":[{"area":"Depth","suggestion":"Add a detail."}]},"nextSteps":["Open with the room."]}';

const schema = z.object({
  content: z.object({
    summary: z.string(),
    strengths: z.array(z.object({ area: z.string(), quote: z.string(), note: z.string() })),
    developAreas: z.array(z.object({ area: z.string(), suggestion: z.string() })),
  }),
  nextSteps: z.array(z.string()).min(1),
});

function llmWith(replies: string[]) {
  let n = 0;
  const create = vi.fn(async () => ({ content: [{ type: "text", text: replies[n++] ?? "" }], usage: USAGE }));
  const anthropic = { messages: { create, stream: vi.fn() } } as unknown as Pick<Anthropic, "messages">;
  return { llm: createCloudProviders(config, { anthropic }).llm, create };
}

const req = (messages: { role: "user" | "assistant"; content: string }[]) => ({
  system: "Return JSON.",
  messages,
  schema,
  maxTokens: 100,
});

describe("cloud llm structured retry", () => {
  it("recovers when the first reply is missing a closing brace", async () => {
    const { llm, create } = llmWith([MISSING_BRACE, FIXED]);
    const out = await llm.structured(req([{ role: "user", content: "transcript" }]), live);
    expect(out.nextSteps).toEqual(["Open with the room."]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("sends the invalid reply and the problem back on the retry", async () => {
    const { llm, create } = llmWith([MISSING_BRACE, FIXED]);
    await llm.structured(req([{ role: "user", content: "transcript" }]), live);
    const calls = create.mock.calls as unknown as [{ messages: { role: string; content: string }[] }][];
    expect(calls[0][0].messages).toEqual([{ role: "user", content: "transcript" }]);
    const retry = calls[1][0].messages;
    expect(retry.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(retry[0].content).toBe("transcript");
    expect(retry[1].content).toBe(MISSING_BRACE);
    expect(retry[2].content).toMatch(/could not be used/);
    expect(retry[2].content).toMatch(/Expected ',' or '}'/);
  });

  it("names the failing field when the JSON parses but does not match the schema", async () => {
    const wrongShape = '{"content":{"summary":"x","strengths":[],"developAreas":[]}}';
    const { llm, create } = llmWith([wrongShape, FIXED]);
    await llm.structured(req([{ role: "user", content: "t" }]), live);
    const calls = create.mock.calls as unknown as [{ messages: { content: string }[] }][];
    expect(calls[1][0].messages[2].content).toMatch(/nextSteps/);
  });

  it("does not change the caller's messages", async () => {
    const messages = [{ role: "user" as const, content: "transcript" }];
    const { llm } = llmWith([MISSING_BRACE, FIXED]);
    await llm.structured(req(messages), live);
    expect(messages).toEqual([{ role: "user", content: "transcript" }]);
  });

  it("recovers on the third attempt, and each retry carries only the latest bad reply", async () => {
    const { llm, create } = llmWith([MISSING_BRACE, "no json at all", FIXED]);
    const out = await llm.structured(req([{ role: "user", content: "transcript" }]), live);
    expect(out.nextSteps).toEqual(["Open with the room."]);
    expect(create).toHaveBeenCalledTimes(3);
    const calls = create.mock.calls as unknown as [{ messages: { role: string; content: string }[] }][];
    const third = calls[2][0].messages;
    expect(third.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(third[1].content).toBe("no json at all");
  });

  it("still rejects after three bad replies, with the original error type", async () => {
    const { llm, create } = llmWith([MISSING_BRACE, MISSING_BRACE, MISSING_BRACE]);
    await expect(llm.structured(req([{ role: "user", content: "t" }]), live)).rejects.toBeInstanceOf(SyntaxError);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("retries without feedback when the reply was empty", async () => {
    const { llm, create } = llmWith(["", FIXED]);
    await llm.structured(req([{ role: "user", content: "t" }]), live);
    const calls = create.mock.calls as unknown as [{ messages: unknown[] }][];
    expect(calls[1][0].messages).toHaveLength(1);
  });

  it("reads the JSON from the text block when the reply opens with a thinking block", async () => {
    const create = vi.fn(async () => ({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: FIXED },
      ],
      usage: USAGE,
    }));
    const anthropic = { messages: { create, stream: vi.fn() } } as unknown as Pick<Anthropic, "messages">;
    const llm = createCloudProviders(config, { anthropic }).llm;
    const out = await llm.structured(req([{ role: "user", content: "t" }]), live);
    expect(out.nextSteps).toEqual(["Open with the room."]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects when the reply has no text block at all", async () => {
    const create = vi.fn(async () => ({ content: [{ type: "thinking", thinking: "", signature: "s" }], usage: USAGE }));
    const anthropic = { messages: { create, stream: vi.fn() } } as unknown as Pick<Anthropic, "messages">;
    const llm = createCloudProviders(config, { anthropic }).llm;
    await expect(llm.structured(req([{ role: "user", content: "t" }]), live)).rejects.toThrow(/Unexpected model response block/);
  });

  describe("constrainOutput", () => {
    type Call = [{ output_config?: { format?: { type?: string; schema?: { properties?: Record<string, unknown> } } } }];
    const calls = (create: { mock: { calls: unknown } }) => create.mock.calls as unknown as Call[];

    it("sends the schema as a JSON-schema output format", async () => {
      const { llm, create } = llmWith([FIXED]);
      await llm.structured({ ...req([{ role: "user", content: "t" }]), constrainOutput: true }, live);
      const format = calls(create)[0][0].output_config?.format;
      expect(format?.type).toBe("json_schema");
      expect(Object.keys(format?.schema?.properties ?? {})).toEqual(["content", "nextSteps"]);
    });

    it("sends no output format unless asked", async () => {
      const { llm, create } = llmWith([FIXED]);
      await llm.structured(req([{ role: "user", content: "t" }]), live);
      expect(calls(create)[0][0].output_config).toBeUndefined();
    });

    it("carries on without the format when the model rejects it, and stays without it", async () => {
      let n = 0;
      const create = vi.fn(async (params: { output_config?: unknown }) => {
        n++;
        if (params.output_config) throw Anthropic.APIError.generate(400, {}, "format not supported", new Headers());
        return { content: [{ type: "text", text: n <= 2 ? MISSING_BRACE : FIXED }], usage: USAGE };
      });
      const anthropic = { messages: { create, stream: vi.fn() } } as unknown as Pick<Anthropic, "messages">;
      const llm = createCloudProviders(config, { anthropic }).llm;
      const out = await llm.structured({ ...req([{ role: "user", content: "t" }]), constrainOutput: true }, live);
      expect(out.nextSteps).toEqual(["Open with the room."]);
      const sent = create.mock.calls.map((c) => Boolean(c[0].output_config));
      expect(sent).toEqual([true, false, false]);
    });

    it("does not hide other errors behind the fallback", async () => {
      const create = vi.fn(async () => {
        throw Anthropic.APIError.generate(500, {}, "server error", new Headers());
      });
      const anthropic = { messages: { create, stream: vi.fn() } } as unknown as Pick<Anthropic, "messages">;
      const llm = createCloudProviders(config, { anthropic }).llm;
      await expect(
        llm.structured({ ...req([{ role: "user", content: "t" }]), constrainOutput: true }, live),
      ).rejects.toBeInstanceOf(Anthropic.InternalServerError);
      expect(create).toHaveBeenCalledTimes(1);
    });
  });
});
