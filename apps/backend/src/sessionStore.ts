import { Session, Phase } from "./types";

const sessions = new Map<string, Session>();

export function createSession(id: string, topicId: string, phase: Phase): Session {
  const session: Session = {
    id,
    topicId,
    status: "active",
    phase,
    startedAt: new Date(),
    turns: [],
  };
  sessions.set(id, session);
  console.log(`Session created: ${id}`);
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function updateSession(
  id: string,
  updates: Partial<Session> | ((s: Session) => Partial<Session>)
): Session | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  const patch = typeof updates === "function" ? updates(session) : updates;
  const updated = { ...session, ...patch };
  sessions.set(id, updated);
  return updated;
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}
