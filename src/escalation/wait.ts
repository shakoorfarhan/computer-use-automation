import { readTicket, type EscalationTicket } from "./ticket.js";

// Polls the ticket file on disk since the operator runs as a separate
// process/terminal and communicates status purely by writing to it.
export async function waitForResume(
  path: string,
  timeoutMs: number,
  pollIntervalMs = 1000
): Promise<EscalationTicket> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ticket = readTicket(path);
    if (ticket.status === "RESUMED" || ticket.status === "ABANDONED") {
      return ticket;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return readTicket(path);
}
