import { RuntimeState } from "./types";

const runtimeStates = new Map<string, RuntimeState>();

export function getRuntimeState(sessionId: string): RuntimeState | undefined {
  return runtimeStates.get(sessionId);
}

export function setRuntimeState(sessionId: string, state: Partial<RuntimeState>): void {
  const existing = runtimeStates.get(sessionId) ?? { turnInFlight: false, activeTTSAborts: [] };
  runtimeStates.set(sessionId, { ...existing, ...state });
}

export function deleteRuntimeState(sessionId: string): void {
  runtimeStates.delete(sessionId);
}
