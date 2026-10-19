import { afterEach, describe, expect, it, vi } from "vitest";
import { withDeadline } from "../deadline";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withDeadline", () => {
  it("resolves with the value when the work finishes in time", async () => {
    const r = await withDeadline(1000, async () => 42);
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it("times out, aborts the signal and reports the deadline", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const p = withDeadline(500, (signal) => {
      seen = signal;
      return new Promise<never>(() => {});
    });
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(await p).toEqual({ ok: false, why: "deadline reached" });
    expect(seen?.aborted).toBe(true);
  });

  it("turns a rejection into the error class name only", async () => {
    class WeirdError extends Error {
      constructor() {
        super("secret message text");
        this.name = "WeirdError";
      }
    }
    const r = await withDeadline(1000, async () => {
      throw new WeirdError();
    });
    expect(r).toEqual({ ok: false, why: "WeirdError" });
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("drops a late result from work that ignores the abort", async () => {
    vi.useFakeTimers();
    let finish: (v: string) => void = () => {};
    const p = withDeadline(100, () => new Promise<string>((res) => (finish = res)));
    await vi.advanceTimersByTimeAsync(100);
    const r = await p;
    finish("late");
    await vi.advanceTimersByTimeAsync(10);
    expect(r).toEqual({ ok: false, why: "deadline reached" });
  });

  it("uses an unref'd timer and clears it when the work finishes", async () => {
    const real = globalThis.setTimeout;
    const timers: ReturnType<typeof setTimeout>[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      const t = real(fn, ms);
      timers.push(t);
      return t;
    }) as typeof setTimeout);
    const r = await withDeadline(60_000, async () => "x");
    expect(r.ok).toBe(true);
    expect(timers).toHaveLength(1);
    expect(timers[0].hasRef()).toBe(false);
  });
});
