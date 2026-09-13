export type FaultMode =
  | "none"
  | "not_found"
  | "permission_denied"
  | "session_expired"
  | "slow"
  | "server_error";

export const FAULT_MODES: FaultMode[] = [
  "none",
  "not_found",
  "permission_denied",
  "session_expired",
  "slow",
  "server_error",
];

// Global sticky fault, settable via the admin toggle page. Per-request
// `?inject=` query params override this for a single request.
let globalFault: FaultMode = "none";

export function getGlobalFault(): FaultMode {
  return globalFault;
}

export function setGlobalFault(mode: FaultMode): void {
  globalFault = mode;
}

export function resolveFault(queryInject: unknown): FaultMode {
  if (typeof queryInject === "string" && FAULT_MODES.includes(queryInject as FaultMode)) {
    return queryInject as FaultMode;
  }
  return globalFault;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
