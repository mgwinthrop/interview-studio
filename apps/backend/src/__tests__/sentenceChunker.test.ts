import { describe, it, expect, vi } from "vitest";
import { SentenceChunker } from "../sentenceChunker";

function collect(chunker: SentenceChunker): string[] {
  const sentences: string[] = [];
  chunker.on("sentence", (s: string) => sentences.push(s));
  return sentences;
}

describe("SentenceChunker", () => {
  describe("push — sentence boundary detection", () => {
    it("emits when period boundary found and buffer exceeds 20 chars", () => {
      const c = new SentenceChunker();
      const out = collect(c);
      c.push("This is a long sentence. Remainder.");
      expect(out).toEqual(["This is a long sentence."]);
    });

    it("emits on question mark boundary", () => {
      const c = new SentenceChunker();
      const out = collect(c);
      c.push("Is this working correctly? Yes it is here.");
      expect(out).toEqual(["Is this working correctly?"]);
    });

    it("emits on exclamation mark boundary", () => {
      const c = new SentenceChunker();
      const out = collect(c);
      c.push("This is exciting news! More follows here.");
      expect(out).toEqual(["This is exciting news!"]);
    });

    it("does not emit when buffer is at or below 20 chars at boundary", () => {
      const c = new SentenceChunker();
      const out = collect(c);
      c.push("Short. More here.");   // "Short." is only 6 chars at boundary
      expect(out).toHaveLength(0);
    });

    it("buffers remainder after emitting", () => {
      const c = new SentenceChunker();
      const out = collect(c);
      c.push("First long sentence here. Second");
      expect(out).toHaveLength(1);
      // Second fragment stays buffered — flush emits it
      c.flush();
      expect(out).toHaveLength(2);
      expect(out[1]).toBe("Second");
    });

    it("does not emit without a boundary even on long input", () => {
      const c = new SentenceChunker();
      const out = collect(c);
      c.push("This is a very long sentence without any punctuation boundary at all");
      expect(out).toHaveLength(0);
    });
  });

  describe("flush", () => {
    it("emits remaining buffer content", () => {
      const c = new SentenceChunker();
      const out = collect(c);
      c.push("No boundary here");
      c.flush();
      expect(out).toEqual(["No boundary here"]);
    });

    it("no-ops on empty buffer", () => {
      const c = new SentenceChunker();
      const out = collect(c);
      c.flush();
      expect(out).toHaveLength(0);
    });

    it("no-ops on whitespace-only buffer", () => {
      const c = new SentenceChunker();
      const out = collect(c);
      c.push("   ");
      c.flush();
      expect(out).toHaveLength(0);
    });
  });

  describe("reset", () => {
    it("clears buffer so subsequent flush emits nothing", () => {
      const c = new SentenceChunker();
      const out = collect(c);
      c.push("Some content here");
      c.reset();
      c.flush();
      expect(out).toHaveLength(0);
    });

    it("removes all sentence listeners", () => {
      const c = new SentenceChunker();
      const handler = vi.fn();
      c.on("sentence", handler);
      c.reset();
      c.push("This is a long enough sentence. And more text here.");
      expect(handler).not.toHaveBeenCalled();
    });

    it("allows re-registration of listeners after reset", () => {
      const c = new SentenceChunker();
      c.push("Pre-reset content");
      c.reset();
      const out = collect(c);
      c.push("Post-reset sentence is long enough. Remainder.");
      expect(out).toEqual(["Post-reset sentence is long enough."]);
    });
  });
});
