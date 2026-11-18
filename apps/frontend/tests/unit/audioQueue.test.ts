import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioQueue } from "../../lib/audioQueue";

// FQ-108 S2 (#123): pins today's AudioQueue before the session rebuild moves it behind an audio
// adapter. A fake AudioContext records what is decoded and when each buffer is scheduled, and
// lets each test resolve decodes in any order. Characterization tests: they pass on main by
// design; each assertion is meant to fail if the behaviour it names changes.

interface Deferred<T> { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class FakeSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  connected = false;
  connect() { this.connected = true; }
  disconnect() { this.connected = false; }
  start(at: number) { this.startedAt = at; }
  stop() { this.stopped = true; }
  /** Test helper: the buffer finished playing. */
  end() { this.onended?.(); }
}

class FakeContext {
  static last: FakeContext;
  state: "running" | "suspended" | "closed" = "running";
  currentTime = 0;
  destination = {};
  decodes: { bytes: Uint8Array; done: Deferred<{ duration: number }> }[] = [];
  sources: FakeSource[] = [];
  closed = false;
  constructor() { FakeContext.last = this; }
  decodeAudioData(data: ArrayBuffer) {
    const done = deferred<{ duration: number }>();
    this.decodes.push({ bytes: new Uint8Array(data.slice(0)), done });
    return done.promise;
  }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
  async resume() { this.state = "running"; }
  async suspend() { this.state = "suspended"; }
  async close() { this.state = "closed"; this.closed = true; }
}

/** n bytes, each set to `fill`, as an ArrayBuffer chunk. */
function chunk(n: number, fill = 1): ArrayBuffer {
  return new Uint8Array(n).fill(fill).buffer;
}

/** Lets the queue's decode chain run (microtasks) without moving the clock. */
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

let ctx: FakeContext;
let changes: boolean[];
let queue: AudioQueue;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", FakeContext);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  changes = [];
  queue = new AudioQueue((playing) => changes.push(playing));
  ctx = FakeContext.last;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AudioQueue buffering (enqueue / flushBuffer)", () => {
  it("decodes nothing until flushBuffer, then the chunks once, joined in arrival order", async () => {
    queue.enqueue(chunk(300, 1));
    queue.enqueue(chunk(300, 2));
    await settle();
    expect(ctx.decodes).toHaveLength(0);

    queue.flushBuffer();
    await settle();
    expect(ctx.decodes).toHaveLength(1);
    const bytes = ctx.decodes[0].bytes;
    expect(bytes.byteLength).toBe(600);
    expect(bytes[0]).toBe(1);
    expect(bytes[299]).toBe(1);
    expect(bytes[300]).toBe(2);
    expect(bytes[599]).toBe(2);
  });

  it("drops a buffer under 512 bytes without decoding it, and warns", async () => {
    queue.enqueue(chunk(4));
    queue.enqueue(chunk(4));
    queue.flushBuffer();
    await settle();
    expect(ctx.decodes).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("dropping 8-byte buffer"));

    // The dropped bytes are gone: a later flush does not include them.
    queue.enqueue(chunk(512, 3));
    queue.flushBuffer();
    await settle();
    expect(ctx.decodes).toHaveLength(1);
    expect(ctx.decodes[0].bytes.byteLength).toBe(512);
  });

  it("decodes a buffer of exactly 512 bytes", async () => {
    queue.enqueue(chunk(512));
    queue.flushBuffer();
    await settle();
    expect(ctx.decodes).toHaveLength(1);
  });

  it("does nothing on flushBuffer with nothing buffered", async () => {
    queue.flushBuffer();
    await settle();
    expect(ctx.decodes).toHaveLength(0);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("AudioQueue scheduling and playback state", () => {
  it("starts the first buffer 0.1 s ahead and reports playing when it starts", async () => {
    ctx.currentTime = 5;
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    await settle();
    ctx.decodes[0].done.resolve({ duration: 1 });
    await settle();

    const [source] = ctx.sources;
    expect(source.connected).toBe(true);
    expect(source.startedAt).toBeCloseTo(5.1);
    expect(changes).toEqual([]); // not yet: the start is 100 ms away

    await vi.advanceTimersByTimeAsync(100);
    expect(changes).toEqual([true]);
  });

  it("schedules a second buffer right after the first, gaplessly", async () => {
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    await settle();
    ctx.decodes[0].done.resolve({ duration: 1.5 });
    await settle();
    ctx.decodes[1].done.resolve({ duration: 1 });
    await settle();

    expect(ctx.sources.map((s) => s.startedAt)).toEqual([0.1, 1.6]);
  });

  it("schedules in arrival order even when a later decode resolves first", async () => {
    queue.enqueue(chunk(600, 1));
    queue.flushBuffer();
    queue.enqueue(chunk(600, 2));
    queue.flushBuffer();
    await settle();
    // The chain decodes one at a time: the second decode has not even started yet.
    expect(ctx.decodes).toHaveLength(1);
    ctx.decodes[0].done.resolve({ duration: 1 });
    await settle();
    expect(ctx.decodes).toHaveLength(2);
    expect(ctx.decodes[1].bytes[0]).toBe(2);
    ctx.decodes[1].done.resolve({ duration: 1 });
    await settle();
    expect(ctx.sources.map((s) => s.startedAt)).toEqual([0.1, 1.1]);
  });

  it("reports stopped only when the last playing buffer ends", async () => {
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    await settle();
    ctx.decodes[0].done.resolve({ duration: 1 });
    await settle();
    ctx.decodes[1].done.resolve({ duration: 1 });
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    expect(changes).toEqual([true]);

    ctx.sources[0].end();
    expect(changes).toEqual([true]);
    ctx.sources[1].end();
    expect(changes).toEqual([true, false]);
  });

  it("skips a buffer that fails to decode and keeps going", async () => {
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    await settle();
    ctx.decodes[0].done.reject(new Error("bad mp3"));
    await settle();
    ctx.decodes[1].done.resolve({ duration: 1 });
    await settle();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].startedAt).toBeCloseTo(0.1);
  });

  it("does not report playing while the context is suspended", async () => {
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    await settle();
    ctx.decodes[0].done.resolve({ duration: 1 });
    await settle();
    ctx.state = "suspended";
    await vi.advanceTimersByTimeAsync(100);
    expect(changes).toEqual([]);
  });
});

describe("AudioQueue flush (interrupt)", () => {
  it("stops and disconnects every source, reports stopped, and clears buffered chunks", async () => {
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    await settle();
    ctx.decodes[0].done.resolve({ duration: 1 });
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    queue.enqueue(chunk(600)); // buffered, not yet flushed

    queue.flush();
    const [source] = ctx.sources;
    expect(source.stopped).toBe(true);
    expect(source.connected).toBe(false);
    expect(changes).toEqual([true, false]);

    // The stopped source's own end event no longer reports anything.
    source.end();
    expect(changes).toEqual([true, false]);
    // The chunk buffered before the flush is gone.
    queue.flushBuffer();
    await settle();
    expect(ctx.decodes).toHaveLength(1);
  });

  it("discards a decode that was in flight when flush ran (generation bump)", async () => {
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    await settle();
    expect(ctx.decodes).toHaveLength(1);

    queue.flush();
    ctx.decodes[0].done.resolve({ duration: 1 });
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.sources).toHaveLength(0);
    expect(changes).toEqual([false]); // only flush's own report
  });

  it("discards a decode queued behind the chain when flush ran", async () => {
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    await settle();
    queue.flush();
    ctx.decodes[0].done.resolve({ duration: 1 });
    await settle();
    expect(ctx.decodes).toHaveLength(1); // the second never started decoding
    expect(ctx.sources).toHaveLength(0);
  });

  it("cancels a pending 'playing' report", async () => {
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    await settle();
    ctx.decodes[0].done.resolve({ duration: 1 });
    await settle();
    queue.flush(); // before the 100 ms start
    await vi.advanceTimersByTimeAsync(1000);
    expect(changes).toEqual([false]);
  });

  it("plays new audio after a flush, starting from the current time", async () => {
    queue.flush();
    ctx.currentTime = 3;
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    await settle();
    ctx.decodes[0].done.resolve({ duration: 1 });
    await settle();
    expect(ctx.sources[0].startedAt).toBeCloseTo(3.1);
  });
});

describe("AudioQueue suspend / resume (pause)", () => {
  it("suspend on a running context suspends it and reports stopped", async () => {
    await queue.suspend();
    expect(ctx.state).toBe("suspended");
    expect(changes).toEqual([false]);
  });

  it("suspend on an already suspended context does nothing", async () => {
    ctx.state = "suspended";
    await queue.suspend();
    expect(changes).toEqual([]);
  });

  it("resume on a suspended context reports whether audio is still scheduled", async () => {
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    await settle();
    ctx.decodes[0].done.resolve({ duration: 1 });
    await settle();
    await queue.suspend();
    await queue.resume();
    expect(ctx.state).toBe("running");
    expect(changes).toEqual([false, true]);
  });

  it("resume with nothing scheduled reports stopped", async () => {
    await queue.suspend();
    await queue.resume();
    expect(changes).toEqual([false, false]);
  });

  it("resume on a running context does nothing", async () => {
    await queue.resume();
    expect(changes).toEqual([]);
  });
});

describe("AudioQueue dispose", () => {
  it("stops playback, closes the context, and ignores decodes that finish later", async () => {
    queue.enqueue(chunk(600));
    queue.flushBuffer();
    await settle();
    queue.dispose();
    expect(ctx.closed).toBe(true);
    expect(changes).toEqual([false]);

    ctx.decodes[0].done.resolve({ duration: 1 });
    await settle();
    expect(ctx.sources).toHaveLength(0);
  });
});
