import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { Providers } from "../../providers/types";

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

async function expectAbort(run: () => Promise<unknown>): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (err) {
    error = err;
  }
  expect(error).toBeDefined();
  expect((error as Error).name).toBe("AbortError");
}

const messages = [{ role: "user" as const, content: "Hello" }];

export function runProviderContract(name: string, make: () => Providers): void {
  describe(`provider contract: ${name}`, () => {
    const live = new AbortController().signal;

    it("stt.transcribe resolves text and words", async () => {
      const result = await make().stt.transcribe(Buffer.alloc(3200), live);
      expect(typeof result.text).toBe("string");
      expect(Array.isArray(result.words)).toBe(true);
      for (const w of result.words) {
        expect(typeof w.text).toBe("string");
        expect(typeof w.start).toBe("number");
        expect(typeof w.end).toBe("number");
      }
    });

    it("llm.stream yields strings with non-empty join", async () => {
      const pieces = await collect(
        make().llm.stream({ system: "s", messages, maxTokens: 50 }, live),
      );
      expect(pieces.every((p) => typeof p === "string")).toBe(true);
      expect(pieces.join("").length).toBeGreaterThan(0);
    });

    it("llm.structured returns a value matching the schema", async () => {
      const schema = z.object({ ok: z.boolean() });
      const value = await make().llm.structured(
        { system: "s", messages, schema, maxTokens: 50 },
        live,
      );
      expect(schema.safeParse(value).success).toBe(true);
    });

    it("llm.structured rejects when the value does not match the schema", async () => {
      const schema = z.object({ definitelyMissing: z.string() });
      await expect(
        make().llm.structured({ system: "s", messages, schema, maxTokens: 50 }, live),
      ).rejects.toBeDefined();
    });

    it("tts.synthesize yields at least one non-empty chunk", async () => {
      const chunks = await collect(make().tts.synthesize("Hello there.", live));
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some((c) => c.length > 0)).toBe(true);
    });

    describe("already-aborted signal", () => {
      it("stt.transcribe rejects with AbortError", async () => {
        await expectAbort(() => make().stt.transcribe(Buffer.alloc(3200), abortedSignal()));
      });

      it("llm.stream rejects with AbortError", async () => {
        await expectAbort(() =>
          collect(make().llm.stream({ system: "s", messages, maxTokens: 50 }, abortedSignal())),
        );
      });

      it("llm.structured rejects with AbortError", async () => {
        await expectAbort(() =>
          make().llm.structured(
            { system: "s", messages, schema: z.object({ ok: z.boolean() }), maxTokens: 50 },
            abortedSignal(),
          ),
        );
      });

      it("tts.synthesize rejects with AbortError", async () => {
        await expectAbort(() => collect(make().tts.synthesize("Hello.", abortedSignal())));
      });
    });
  });
}
