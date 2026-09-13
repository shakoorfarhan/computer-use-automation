import { appendFileSync } from "node:fs";
import { redactValue } from "../guardrails/redaction.js";

export interface TranscriptEvent {
  step: number;
  timestamp: string;
  rationale?: string;
  action?: { type: string; params: Record<string, unknown> };
  observation?: { url: string; title: string };
  guardrail?: { allowed: boolean; reason?: string };
  outcome?: "ok" | "tool_error" | "blocked";
  detail?: string;
}

export class TranscriptLogger {
  constructor(private readonly filePath: string) {}

  log(event: TranscriptEvent): void {
    const redacted = redactValue(event);
    appendFileSync(this.filePath, JSON.stringify(redacted) + "\n", "utf-8");
  }
}
