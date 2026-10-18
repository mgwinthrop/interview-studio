export const UPGRADE_HINT = 'If you just upgraded, run "npx prisma generate" in apps/backend and start again.';

/**
 * The lines to print when preset sync fails. A preset validation error carries a safe message
 * (preset id and field paths); anything else is named by class only (its message may contain
 * paths or content) and gets the upgrade hint, since a stale Prisma client is the usual cause.
 */
export function describeStartupFailure(err: unknown, isValidationError: boolean): string[] {
  const name = err instanceof Error ? err.name : typeof err;
  if (isValidationError && err instanceof Error) return [`Preset sync failed: ${name}: ${err.message}`];
  return [`Preset sync failed: ${name}`, UPGRADE_HINT];
}
