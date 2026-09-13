import { chromium } from "playwright";
import readline from "node:readline/promises";
import { readRowValue } from "../replay/rowExtraction.js";
import { claim, recordOperatorAction, resume } from "./stateMachine.js";
import { readTicket, writeTicket, type EscalationTicket } from "./ticket.js";

function parseArgs(argv: string[]): { ticketPath: string } {
  const idx = argv.indexOf("--ticket");
  if (idx === -1 || !argv[idx + 1]) {
    throw new Error("Usage: operatorCli --ticket <path-to-ticket.json>");
  }
  return { ticketPath: argv[idx + 1]! };
}

async function main(): Promise<void> {
  const { ticketPath } = parseArgs(process.argv.slice(2));
  let ticket: EscalationTicket = readTicket(ticketPath);

  console.log(`Escalation ticket: ${ticket.id}`);
  console.log(`Goal: ${ticket.goal}`);
  console.log(`Reason: ${ticket.reason}`);
  console.log(`Current step: ${ticket.currentStepDescription}`);
  console.log(`Attaching to the live session at ${ticket.wsEndpoint} ...`);

  const browser = await chromium.connect(ticket.wsEndpoint);
  const context = browser.contexts()[0];
  const page = context?.pages()[0];
  if (!page) throw new Error("Could not find the live page to attach to.");
  console.log(`Attached. Current page: ${page.url()}`);

  ticket = claim(ticket);
  writeTicket(ticketPath, ticket);
  console.log("Ticket claimed — you are now in control of the live session.\n");
  console.log("Commands: click <role> <name> | fill <role> <name> <value> | goto <url>");
  console.log("          extract <rowLabel> <key> | screenshot | done [summary]\n");

  const outputs: Record<string, unknown> = {};
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      const line = (await rl.question("operator> ")).trim();
      if (!line) continue;
      const [cmd, ...rest] = line.split(/\s+/);

      try {
        if (cmd === "done") {
          const summary = rest.join(" ") || "Operator completed the flow manually.";
          ticket = resume(ticket, outputs, summary);
          writeTicket(ticketPath, ticket);
          console.log("Marked resumed. Handing control back to automation.");
          break;
        } else if (cmd === "click") {
          const [role, ...nameParts] = rest;
          await page.getByRole(role as never, { name: nameParts.join(" "), exact: false }).first().click();
          ticket = recordOperatorAction(ticket, line);
          writeTicket(ticketPath, ticket);
        } else if (cmd === "fill") {
          const [role, name, ...valueParts] = rest;
          await page
            .getByRole(role as never, { name, exact: false })
            .first()
            .fill(valueParts.join(" "));
          ticket = recordOperatorAction(ticket, line);
          writeTicket(ticketPath, ticket);
        } else if (cmd === "goto") {
          await page.goto(rest.join(" "));
          ticket = recordOperatorAction(ticket, line);
          writeTicket(ticketPath, ticket);
        } else if (cmd === "extract") {
          const [rowLabel, key] = rest;
          if (!rowLabel || !key) throw new Error("Usage: extract <rowLabel> <key>");
          outputs[key] = await readRowValue(page, rowLabel);
          ticket = recordOperatorAction(ticket, line, `extracted ${key}=${outputs[key]}`);
          writeTicket(ticketPath, ticket);
        } else if (cmd === "screenshot") {
          const path = ticketPath.replace(/\.json$/, `-operator-${Date.now()}.png`);
          await page.screenshot({ path });
          ticket = recordOperatorAction(ticket, line, `saved ${path}`);
          writeTicket(ticketPath, ticket);
          console.log(`Saved ${path}`);
        } else {
          console.log(`Unknown command: ${cmd}`);
        }
      } catch (err) {
        console.log(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    rl.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
