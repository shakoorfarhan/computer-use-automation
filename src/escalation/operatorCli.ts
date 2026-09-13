import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";
import readline from "node:readline/promises";
import { readRowValue } from "../replay/rowExtraction.js";
import { claim, recordOperatorAction, resume } from "./stateMachine.js";
import { readTicket, writeTicket, type EscalationTicket } from "./ticket.js";

// Quote-aware so multi-word accessible names (e.g. "View member 10023") can be
// passed as one argument: fill textbox "Sub-account name" "Vacation Fund 2"
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    tokens.push(match[1] !== undefined ? match[1] : match[2]!);
  }
  return tokens;
}

function parseArgs(argv: string[]): { ticketPath: string } {
  const idx = argv.indexOf("--ticket");
  if (idx === -1 || !argv[idx + 1]) {
    throw new Error("Usage: operatorCli --ticket <path-to-ticket.json>");
  }
  return { ticketPath: argv[idx + 1]! };
}

interface Session {
  ticketPath: string;
  ticket: EscalationTicket;
  page: Page;
  outputs: Record<string, unknown>;
}

// Returns false once "done" has been processed, ending the loop.
async function processLine(session: Session, line: string): Promise<boolean> {
  const trimmed = line.trim();
  if (!trimmed) return true;
  const [cmd, ...rest] = tokenize(trimmed);

  try {
    if (cmd === "done") {
      const summary = rest.join(" ") || "Operator completed the flow manually.";
      session.ticket = resume(session.ticket, session.outputs, summary);
      writeTicket(session.ticketPath, session.ticket);
      console.log("Marked resumed. Handing control back to automation.");
      return false;
    } else if (cmd === "click") {
      const [role, ...nameParts] = rest;
      await session.page
        .getByRole(role as never, { name: nameParts.join(" "), exact: false })
        .first()
        .click();
      session.ticket = recordOperatorAction(session.ticket, trimmed);
      writeTicket(session.ticketPath, session.ticket);
      console.log(`OK: ${trimmed}`);
    } else if (cmd === "fill") {
      const [role, name, ...valueParts] = rest;
      await session.page
        .getByRole(role as never, { name, exact: false })
        .first()
        .fill(valueParts.join(" "));
      session.ticket = recordOperatorAction(session.ticket, trimmed);
      writeTicket(session.ticketPath, session.ticket);
      console.log(`OK: ${trimmed}`);
    } else if (cmd === "goto") {
      await session.page.goto(rest.join(" "));
      session.ticket = recordOperatorAction(session.ticket, trimmed);
      writeTicket(session.ticketPath, session.ticket);
      console.log(`OK: ${trimmed}`);
    } else if (cmd === "extract") {
      const [rowLabel, key] = rest;
      if (!rowLabel || !key) throw new Error('Usage: extract "<rowLabel>" <key>');
      session.outputs[key] = await readRowValue(session.page, rowLabel);
      session.ticket = recordOperatorAction(
        session.ticket,
        trimmed,
        `extracted ${key}=${session.outputs[key]}`
      );
      writeTicket(session.ticketPath, session.ticket);
      console.log(`OK: ${trimmed} -> ${session.outputs[key]}`);
    } else if (cmd === "screenshot") {
      const path = session.ticketPath.replace(/\.json$/, `-operator-${Date.now()}.png`);
      await session.page.screenshot({ path });
      session.ticket = recordOperatorAction(session.ticket, trimmed, `saved ${path}`);
      writeTicket(session.ticketPath, session.ticket);
      console.log(`Saved ${path}`);
    } else {
      console.log(`Unknown command: ${cmd}`);
    }
  } catch (err) {
    console.log(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
  return true;
}

async function main(): Promise<void> {
  const { ticketPath } = parseArgs(process.argv.slice(2));
  let ticket: EscalationTicket = readTicket(ticketPath);

  console.log(`Escalation ticket: ${ticket.id}`);
  console.log(`Goal: ${ticket.goal}`);
  console.log(`Reason: ${ticket.reason}`);
  console.log(`Current step: ${ticket.currentStepDescription}`);
  console.log(`Attaching to the live session at ${ticket.wsEndpoint} ...`);

  const browser = await chromium.connectOverCDP(ticket.wsEndpoint);
  const context = browser.contexts()[0];
  const page = context?.pages()[0];
  if (!page) throw new Error("Could not find the live page to attach to.");
  console.log(`Attached. Current page: ${page.url()}`);

  ticket = claim(ticket);
  writeTicket(ticketPath, ticket);
  console.log("Ticket claimed. You are now in control of the live session.\n");
  console.log('Commands: click <role> "<name>" | fill <role> "<name>" "<value>" | goto <url>');
  console.log('          extract "<rowLabel>" <key> | screenshot | done [summary]');
  console.log("          (quote any argument containing spaces)\n");

  const session: Session = { ticketPath, ticket, page, outputs: {} };

  try {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        while (true) {
          const line = await rl.question("operator> ");
          const keepGoing = await processLine(session, line);
          if (!keepGoing) break;
        }
      } finally {
        rl.close();
      }
    } else {
      // Piped, non-interactive input (e.g. scripted demo runs). readline's
      // question()-per-line loop drops buffered lines here because Node
      // flushes all piped input as 'line' events well before slow async
      // Playwright actions let us call question() again, so read and
      // process every line directly instead of depending on that timing.
      const raw = readFileSync(0, "utf-8");
      for (const line of raw.split("\n")) {
        const keepGoing = await processLine(session, line);
        if (!keepGoing) break;
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
