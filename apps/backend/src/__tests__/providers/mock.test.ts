import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createMockProviders } from "../../providers/mock";
import { runProviderContract } from "./contract";

runProviderContract("mock", () => createMockProviders());

describe("mock providers scripting", () => {
  const live = new AbortController().signal;
  const req = { system: "s", messages: [], maxTokens: 10 };

  async function collect(iter: AsyncIterable<string>): Promise<string[]> {
    const out: string[] = [];
    for await (const p of iter) out.push(p);
    return out;
  }

  it("cycles llm replies and streams 5-character pieces", async () => {
    const { llm } = createMockProviders({ llmReplies: ["abcdefghij", "xy"] });
    expect(await collect(llm.stream(req, live))).toEqual(["abcde", "fghij"]);
    expect(await collect(llm.stream(req, live))).toEqual(["xy"]);
    expect(await collect(llm.stream(req, live))).toEqual(["abcde", "fghij"]);
  });

  it("cycles stt texts", async () => {
    const { stt } = createMockProviders({ sttTexts: ["one", "two"] });
    expect((await stt.transcribe(Buffer.alloc(2), live)).text).toBe("one");
    expect((await stt.transcribe(Buffer.alloc(2), live)).text).toBe("two");
    expect((await stt.transcribe(Buffer.alloc(2), live)).text).toBe("one");
  });

  it("fails the llm on the configured call number", async () => {
    const { llm } = createMockProviders({ failLlmOnCall: 2 });
    await collect(llm.stream(req, live));
    await expect(collect(llm.stream(req, live))).rejects.toThrow();
  });

  it("aborts mid-stream", async () => {
    const { llm } = createMockProviders({ llmReplies: ["abcdefghijklmnop"] });
    const controller = new AbortController();
    const iter = llm.stream(req, controller.signal)[Symbol.asyncIterator]();
    await iter.next();
    controller.abort();
    await expect(iter.next()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns scripted structured value", async () => {
    const { llm } = createMockProviders({ structured: { a: 1 } });
    const out = await llm.structured({ ...req, schema: z.object({ a: z.number() }) }, live);
    expect(out).toEqual({ a: 1 });
  });

  it("accepts and ignores the per-call model options", async () => {
    const { llm, stt, tts } = createMockProviders({ llmReplies: ["abc"], sttTexts: ["hi"] });
    expect(await collect(llm.stream({ ...req, model: "m" }, live))).toEqual(["abc"]);
    expect((await stt.transcribe(Buffer.alloc(2), live, { modelId: "x" })).text).toBe("hi");
    const out: Uint8Array[] = [];
    for await (const c of tts.synthesize("Hi.", live, { modelId: "x", outputFormat: "y" })) out.push(c);
    expect(out).toHaveLength(2);
  });
});
