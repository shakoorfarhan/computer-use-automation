import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ActionType, Capability } from "../artifact/schema.js";
import { redactValue } from "../guardrails/redaction.js";
import { TranscriptLogger } from "../discovery/transcript.js";
import { replayCapability } from "./engine.js";

interface CliArgs {
  capabilityPath: string;
  params: Record<string, unknown>;
  headless: boolean;
  confirmIrreversible: boolean;
  runId: string;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const has = (flag: string): boolean => argv.includes(flag);

  const capabilityPath = get("--capability");
  if (!capabilityPath) throw new Error("--capability <path-to-capability.json> is required");

  const params: Record<string, unknown> = {};
  argv.forEach((arg, i) => {
    if (arg !== "--param") return;
    const raw = argv[i + 1];
    if (!raw) return;
    const eq = raw.indexOf("=");
    if (eq === -1) return;
    params[raw.slice(0, eq)] = raw.slice(eq + 1);
  });

  return {
    capabilityPath,
    params,
    headless: !has("--headed"),
    confirmIrreversible: has("--confirm-irreversible"),
    runId: get("--run-id") ?? `replay-${Date.now()}`,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const capability: Capability = JSON.parse(readFileSync(args.capabilityPath, "utf-8"));

  const evidenceDir = path.join("evidence", args.runId);
  mkdirSync(evidenceDir, { recursive: true });
  const transcript = new TranscriptLogger(path.join(evidenceDir, "replay-transcript.jsonl"));

  console.log(`Replaying capability ${capability.id}@${capability.version}`);
  console.log(`Params: ${JSON.stringify(args.params)}\n`);

  const result = await replayCapability({
    capability,
    params: args.params,
    allowlist: {
      allowedDomains: capability.target.allowedDomains,
      allowedActionTypes: ["goto", "click", "fill", "wait_for", "read_text"] as ActionType[],
    },
    headless: args.headless,
    confirmIrreversible: args.confirmIrreversible,
    tellerUsername: process.env.TELLER_USERNAME ?? "teller1",
    tellerPassword: process.env.TELLER_PASSWORD ?? "password123",
    evidenceDir,
    transcript,
  });

  writeFileSync(
    path.join(evidenceDir, "replay-result.json"),
    JSON.stringify(redactValue(result), null, 2)
  );

  console.log(`Replay result: ${result.kind}`);
  console.log(JSON.stringify(redactValue(result), null, 2));
  console.log(`\nEvidence written to ${evidenceDir}/`);

  if (result.kind === "hard_failure") process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
