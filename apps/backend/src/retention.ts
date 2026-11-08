import type { Config } from "./config";

/**
 * Deletes sessions that ended more than `retentionDays` days ago, and LLM usage rows older than
 * the same cutoff (see purgeOlderThan). Does nothing (and never touches the database) when
 * retention is not configured. Returns the number of sessions purged.
 * Logs only the count.
 */
export async function runRetention(
  config: Pick<Config, "retentionDays">,
  purge?: (days: number) => Promise<number>,
): Promise<number> {
  if (config.retentionDays === undefined) return 0;
  const doPurge = purge ?? (await import("./persistence")).purgeOlderThan;
  const count = await doPurge(config.retentionDays);
  console.log(`[retention] purged ${count} session(s) older than ${config.retentionDays} day(s)`);
  return count;
}
