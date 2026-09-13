import type { ActionType } from "../artifact/schema.js";

export interface AllowlistConfig {
  allowedDomains: string[];
  allowedActionTypes: ActionType[];
}

export interface AllowlistCheck {
  url: string;
  actionType: ActionType;
}

export interface AllowlistResult {
  allowed: boolean;
  reason?: string;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

// Single choke-point: call this before every actuation, in discovery and replay alike.
export function checkAllowlist(
  config: AllowlistConfig,
  check: AllowlistCheck
): AllowlistResult {
  if (!config.allowedActionTypes.includes(check.actionType)) {
    return {
      allowed: false,
      reason: `Action type "${check.actionType}" is not on the allowlist.`,
    };
  }
  const host = hostOf(check.url);
  if (!host) {
    return { allowed: false, reason: `Could not parse a hostname from "${check.url}".` };
  }
  const domainAllowed = config.allowedDomains.some(
    (d) => host === d || host.endsWith(`.${d}`)
  );
  if (!domainAllowed) {
    return { allowed: false, reason: `Domain "${host}" is not on the allowlist.` };
  }
  return { allowed: true };
}
