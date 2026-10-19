/** The error class name, never the message: safe to log. */
export function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}
