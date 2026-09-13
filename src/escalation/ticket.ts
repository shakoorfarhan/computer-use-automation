import { readFileSync, writeFileSync } from "node:fs";

export type EscalationStatus = "AWAITING_HUMAN" | "IN_PROGRESS" | "RESUMED" | "ABANDONED";

export interface OperatorAction {
  timestamp: string;
  command: string;
  detail?: string;
}

export interface EscalationTicket {
  id: string;
  createdAt: string;
  goal: string;
  currentStepDescription: string;
  reason: string;
  screenshotPath?: string;
  wsEndpoint: string;
  targetUrl: string;
  status: EscalationStatus;
  controlledBy: "system" | "operator";
  operatorActions: OperatorAction[];
  resumeOutputs?: Record<string, unknown>;
  resumeSummary?: string;
}

export function writeTicket(path: string, ticket: EscalationTicket): void {
  writeFileSync(path, JSON.stringify(ticket, null, 2), "utf-8");
}

export function readTicket(path: string): EscalationTicket {
  return JSON.parse(readFileSync(path, "utf-8")) as EscalationTicket;
}
