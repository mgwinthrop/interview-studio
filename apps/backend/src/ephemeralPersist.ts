import type { ControllerDeps } from "./sessionController";

/**
 * The `persist` dependency for ephemeral sessions (designer and trial): nothing is ever
 * written. persistSessionStatus resolves true, so the controller's first-status-wins rule
 * treats every status as recorded and its end/abandon logic runs unchanged.
 */
export const EPHEMERAL_PERSIST: ControllerDeps["persist"] = {
  persistTurn: async () => {},
  persistPhaseTransition: async () => {},
  persistSessionStatus: async () => true,
  persistReport: async () => {},
};
