import type { RiskLevel } from "../artifact/schema.js";

const IRREVERSIBLE_KEYWORDS = [
  "confirm",
  "submit",
  "open",
  "transfer",
  "withdraw",
  "deposit",
  "close",
  "delete",
  "approve",
];

const SAFE_KEYWORDS = ["search", "view", "look up", "read", "navigate", "sign in"];

// Heuristic classification of a planned action from its human-readable intent,
// used as a cross-check against whatever risk level the discovery agent declared.
export function classifyIntent(intent: string): RiskLevel {
  const lower = intent.toLowerCase();
  if (IRREVERSIBLE_KEYWORDS.some((kw) => lower.includes(kw))) return "irreversible";
  if (SAFE_KEYWORDS.some((kw) => lower.includes(kw))) return "safe";
  return "reversible";
}

export interface RiskGateInput {
  riskLevel: RiskLevel;
  mode: "discovery" | "autonomous_replay";
  confirmed: boolean;
}

export interface RiskGateResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
}

// Irreversible actions are blocked by default in autonomous replay and require
// an explicit, out-of-band confirmation flag to proceed.
export function evaluateRiskGate(input: RiskGateInput): RiskGateResult {
  if (input.riskLevel !== "irreversible") {
    return { allowed: true, requiresConfirmation: false };
  }
  if (input.confirmed) {
    return { allowed: true, requiresConfirmation: true };
  }
  if (input.mode === "discovery") {
    return {
      allowed: false,
      requiresConfirmation: true,
      reason: "Irreversible action during discovery requires explicit confirmation.",
    };
  }
  return {
    allowed: false,
    requiresConfirmation: true,
    reason: "Irreversible action blocked by default in autonomous replay.",
  };
}
