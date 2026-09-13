import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ActionType } from "../artifact/schema.js";
import { compileCapability, type DeclaredParam } from "../artifact/compiler.js";
import { redactValue } from "../guardrails/redaction.js";
import { TELLER_CONSOLE_ERROR_TAXONOMY } from "../replay/errorTaxonomy.js";
import { runDiscovery } from "./agentLoop.js";
import { TranscriptLogger } from "./transcript.js";

interface CliArgs {
  goal: string;
  entryUrl: string;
  id: string;
  name: string;
  version: string;
  description: string;
  app: string;
  params: DeclaredParam[];
  headless: boolean;
  allowIrreversible: boolean;
  model: string;
  runId: string;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const has = (flag: string): boolean => argv.includes(flag);

  const goal = get("--goal");
  if (!goal) throw new Error("--goal \"<natural language goal>\" is required");
  const id = get("--id") ?? "capability";

  const params: DeclaredParam[] = [];
  argv.forEach((arg, i) => {
    if (arg !== "--param") return;
    const raw = argv[i + 1];
    if (!raw) return;
    const [nameAndType, value] = raw.split("=");
    const [name, type] = (nameAndType ?? "").split(":");
    params.push({
      name: name ?? "param",
      type: (type as DeclaredParam["type"]) ?? "string",
      concreteValue: value ?? "",
    });
  });

  return {
    goal,
    entryUrl: get("--entry") ?? "http://localhost:4000/login",
    id,
    name: get("--name") ?? id,
    version: get("--version") ?? "1.0.0",
    description: get("--description") ?? goal,
    app: get("--app") ?? "teller-console",
    params,
    headless: !has("--headed"),
    allowIrreversible: has("--allow-irreversible"),
    model: get("--model") ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    runId: get("--run-id") ?? `discovery-${Date.now()}`,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const evidenceDir = path.join("evidence", args.runId);
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync("capabilities", { recursive: true });

  const transcript = new TranscriptLogger(path.join(evidenceDir, "discovery-transcript.jsonl"));
  const escalationTicketPath = path.join(evidenceDir, "escalation-ticket.json");

  const allowlist = {
    allowedDomains: [new URL(args.entryUrl).hostname],
    allowedActionTypes: ["goto", "click", "fill", "wait_for", "read_text", "login"] as ActionType[],
  };

  console.log(`Starting discovery run ${args.runId}`);
  console.log(`Goal: ${args.goal}`);
  console.log(`Entry: ${args.entryUrl}\n`);

  const result = await runDiscovery({
    goal: args.goal,
    entryUrl: args.entryUrl,
    allowlist,
    headless: args.headless,
    maxSteps: 30,
    maxWallClockMs: 5 * 60 * 1000,
    maxConsecutiveErrors: 3,
    model: args.model,
    allowIrreversible: args.allowIrreversible,
    tellerUsername: process.env.TELLER_USERNAME ?? "teller1",
    tellerPassword: process.env.TELLER_PASSWORD ?? "password123",
    evidenceDir,
    transcript,
    escalationTicketPath,
    maxEscalationWaitMs: 5 * 60 * 1000,
  });

  console.log(`\nDiscovery finished with status: ${result.status}`);
  if (result.summary) console.log(`Summary: ${result.summary}`);
  if (result.reason) console.log(`Reason: ${result.reason}`);
  console.log(`Outputs: ${JSON.stringify(result.outputs ?? {})}`);

  writeFileSync(
    path.join(evidenceDir, "discovery-summary.json"),
    JSON.stringify(
      redactValue({
        runId: args.runId,
        goal: args.goal,
        status: result.status,
        summary: result.summary,
        reason: result.reason,
        outputs: result.outputs,
        stepCount: result.steps.length,
      }),
      null,
      2
    )
  );

  if (result.status !== "completed") {
    console.log(
      "\nNo capability compiled: the flow only fully automates when discovery status is " +
        `"completed" (got "${result.status}"). A run finished via human escalation is not ` +
        "a clean, deterministically replayable recording — see evidence/ for what happened."
    );
    if (result.status === "stuck" || result.status === "max_steps" || result.status === "timeout") {
      process.exitCode = 1;
    }
    return;
  }

  const capability = compileCapability({
    id: args.id,
    name: args.name,
    version: args.version,
    description: args.description,
    app: args.app,
    entryUrl: args.entryUrl,
    allowedDomains: allowlist.allowedDomains,
    steps: result.steps,
    outputs: result.outputs ?? {},
    params: args.params,
    errorTaxonomy: TELLER_CONSOLE_ERROR_TAXONOMY,
    discoveryRunId: args.runId,
    model: args.model,
    promptHash: "n/a",
  });

  const capabilityPath = path.join("capabilities", `${capability.id}.v${capability.version}.json`);
  writeFileSync(capabilityPath, JSON.stringify(capability, null, 2));
  copyFileSync(capabilityPath, path.join(evidenceDir, "capability.json"));

  console.log(`\nCapability compiled and saved to ${capabilityPath}`);
  console.log(`Evidence written to ${evidenceDir}/`);
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
