import type { EscalationTicket } from "./ticket.js";

// RUNNING (implicit, pre-ticket) -> AWAITING_HUMAN -> IN_PROGRESS -> RESUMED
// An operator must claim before acting, and only a claimed ticket can resume.
// Claiming an already-IN_PROGRESS ticket is allowed: an operator reconnecting
// after a dropped session picks up where they left off, not a fresh claim.
export function claim(ticket: EscalationTicket): EscalationTicket {
  if (ticket.status !== "AWAITING_HUMAN" && ticket.status !== "IN_PROGRESS") {
    throw new Error(`Cannot claim a ticket in status ${ticket.status}.`);
  }
  return { ...ticket, status: "IN_PROGRESS", controlledBy: "operator" };
}

export function recordOperatorAction(
  ticket: EscalationTicket,
  command: string,
  detail?: string
): EscalationTicket {
  if (ticket.status !== "IN_PROGRESS") {
    throw new Error(`Cannot act on a ticket in status ${ticket.status}.`);
  }
  return {
    ...ticket,
    operatorActions: [
      ...ticket.operatorActions,
      { timestamp: new Date().toISOString(), command, detail },
    ],
  };
}

export function resume(
  ticket: EscalationTicket,
  outputs: Record<string, unknown>,
  summary: string
): EscalationTicket {
  if (ticket.status !== "IN_PROGRESS") {
    throw new Error(`Cannot resume a ticket in status ${ticket.status}.`);
  }
  return {
    ...ticket,
    status: "RESUMED",
    controlledBy: "system",
    resumeOutputs: outputs,
    resumeSummary: summary,
  };
}
