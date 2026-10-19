import type express from "express";
import { errName } from "./errors";

/** The authenticated owner for this request (set by the authenticator). */
export function ownerOf(res: express.Response): string {
  return res.locals.ownerId as string;
}

/** Express 4 does not catch rejected handlers: log the error class and answer 500. */
export function route<P = Record<string, string>>(
  name: string,
  fn: (req: express.Request<P>, res: express.Response) => Promise<void>,
): (req: express.Request<P>, res: express.Response) => Promise<void> {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`[http] ${name} error: ${errName(err)}`);
      if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    }
  };
}
