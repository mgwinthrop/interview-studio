/**
 * Runs `work` bounded by `ms`. An unref'd timer races the work; on timeout the signal is
 * aborted and the result is `{ ok: false, why: "deadline reached" }`. The deadline does not
 * rely on the work honouring the abort: a late result is dropped here. A thrown error becomes
 * `{ ok: false, why: <error class name> }`, never its message.
 */
export async function withDeadline<T>(
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; why: string }> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
    if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
  });
  const run = (async () => work(abort.signal))().then(
    (value) => ({ ok: true as const, value }),
    (err: unknown) => ({ ok: false as const, why: err instanceof Error ? err.name : typeof err }),
  );
  const outcome = await Promise.race([run, deadline]);
  if (timer) clearTimeout(timer);
  if (outcome === "timeout") {
    abort.abort();
    return { ok: false, why: "deadline reached" };
  }
  return outcome;
}
