import type { SessionController } from "./sessionController";

/** Live controllers by session id. One controller per connected session. */
const controllers = new Map<string, SessionController>();

export function attach(controller: SessionController): void {
  if (controllers.has(controller.sessionId)) {
    throw new Error(`Session ${controller.sessionId} already has a controller`);
  }
  controllers.set(controller.sessionId, controller);
}

export function get(sessionId: string): SessionController | undefined {
  return controllers.get(sessionId);
}

export function detach(sessionId: string): void {
  controllers.delete(sessionId);
}

export function countForOwner(ownerId: string): number {
  let n = 0;
  for (const c of controllers.values()) if (c.ownerId === ownerId) n++;
  return n;
}
