// Helpers used only by server.report.test.ts: stored-session seeding and the regenerate call.
import { LLM_REPLY, PRESET, USER_TEXT, type Running, type ServerEnv } from "./server";
import type { InterviewerDefinition } from "../../interviewer/schema";

export const MEASURED: import("../../delivery/metrics").TurnMetrics = {
  wordCount: 14,
  timedWordCount: 14,
  durationSec: 6,
  wordsPerMinute: 140,
  pauseCount: 1,
  longestPauseSec: 0.9,
  responseGapMs: 800,
  fillerCount: 0,
};

/**
 * A stored session for `owner` in `status`. By default it has the preset snapshot, one user
 * turn and one interviewer turn.
 */
export async function seedStored(
  env: ServerEnv,
  id: string,
  owner: string,
  status: "failed" | "complete" | "abandoned" | "active",
  opts: {
    userTurns?: number;
    snapshot?: InterviewerDefinition | null;
    metrics?: import("../../delivery/metrics").TurnMetrics;
    userText?: string;
  } = {},
): Promise<void> {
  await env.persistence.persistSessionCreate(id, owner, opts.snapshot ?? PRESET);
  if (opts.snapshot === null) await env.prisma.session.update({ where: { id }, data: { interviewerJson: null } });
  const t0 = Date.now() - 60_000;
  await env.persistence.persistTurn({
    id: `${id}-a0`,
    sessionId: id,
    role: "assistant",
    content: LLM_REPLY,
    phase: "intro",
    timestamp: new Date(t0),
  });
  for (let i = 0; i < (opts.userTurns ?? 1); i++) {
    await env.persistence.persistTurn({
      id: `${id}-u${i}`,
      sessionId: id,
      role: "user",
      content: opts.userText ?? USER_TEXT,
      phase: "intro",
      timestamp: new Date(t0 + 1000 * (i + 1)),
      ...(opts.metrics ? { metrics: opts.metrics } : {}),
    });
  }
  if (status !== "active") await env.persistence.persistSessionStatus(id, status);
}

export function regenerate(r: Running, id: string): Promise<Response> {
  return fetch(`${r.base}/api/session/${id}/report/regenerate`, { method: "POST" });
}

export async function statusOf(env: ServerEnv, id: string): Promise<string | undefined> {
  return (await env.prisma.session.findUnique({ where: { id } }))?.status;
}
