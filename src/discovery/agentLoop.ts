import Anthropic from "@anthropic-ai/sdk";
import { checkAllowlist, type AllowlistConfig } from "../guardrails/allowlist.js";
import { classifyIntent, evaluateRiskGate } from "../guardrails/riskClassifier.js";
import type { ActionType, RiskLevel } from "../artifact/schema.js";
import { readRowValue } from "../replay/rowExtraction.js";
import { BrowserDriver, type Observation } from "./browserDriver.js";
import { DISCOVERY_TOOLS } from "./tools.js";
import { TranscriptLogger } from "./transcript.js";

export interface DiscoveryConfig {
  goal: string;
  entryUrl: string;
  allowlist: AllowlistConfig;
  headless: boolean;
  maxSteps: number;
  maxWallClockMs: number;
  maxConsecutiveErrors: number;
  model: string;
  allowIrreversible: boolean;
  tellerUsername: string;
  tellerPassword: string;
  evidenceDir: string;
  transcript: TranscriptLogger;
}

export interface RecordedStep {
  stepNumber: number;
  toolName: string;
  input: Record<string, unknown>;
  intent: string;
  riskLevel: RiskLevel;
  observationAfter: Observation;
}

export type DiscoveryStatus = "completed" | "stuck" | "max_steps" | "timeout";

export interface DiscoveryResult {
  status: DiscoveryStatus;
  steps: RecordedStep[];
  extracted: Record<string, string>;
  outputs?: Record<string, unknown>;
  summary?: string;
  reason?: string;
}

const TOOL_TO_ACTION_TYPE: Record<string, ActionType | undefined> = {
  navigate: "goto",
  click: "click",
  fill: "fill",
  wait_for: "wait_for",
  extract: "read_text",
};

function systemPrompt(goal: string): string {
  return [
    "You are an automation agent operating a legacy credit union teller console web application.",
    "You perceive the page only through its accessibility tree (role + accessible name), because this app has no clean DOM, no test IDs, and non-semantic markup.",
    "Ground every action strictly in elements you can see in the current observation. Never guess a role/name that isn't shown.",
    "Call exactly one tool per turn. After each action you will receive a fresh observation.",
    "If the app requires sign-in, use the login tool (credentials are managed by the harness, not by you).",
    "To report a numeric or text result, first call extract with a stable row label, then reference that exact value in finish_goal outputs.",
    "If you are blocked, uncertain, or an action is refused by policy, call report_stuck with a clear reason instead of guessing.",
    `Goal: ${goal}`,
  ].join("\n");
}

function formatObservation(obs: Observation): string {
  return `URL: ${obs.url}\nTitle: ${obs.title}\nAccessibility tree:\n${obs.accessibilityTree}`;
}

export async function runDiscovery(config: DiscoveryConfig): Promise<DiscoveryResult> {
  const client = new Anthropic();
  const driver = new BrowserDriver();
  await driver.launch(config.headless);

  const extracted: Record<string, string> = {};
  const steps: RecordedStep[] = [];
  const startedAt = Date.now();
  let consecutiveErrors = 0;
  let stepNumber = 0;

  try {
    await driver.goto(config.entryUrl);
    let observation = await driver.observe();
    config.transcript.log({
      step: 0,
      timestamp: new Date().toISOString(),
      observation: { url: observation.url, title: observation.title },
      outcome: "ok",
    });

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `Goal: ${config.goal}\n\nInitial observation:\n${formatObservation(observation)}`,
      },
    ];

    while (true) {
      if (stepNumber >= config.maxSteps) {
        await driver.screenshot(`${config.evidenceDir}/stop-max-steps.png`);
        return { status: "max_steps", steps, extracted, reason: "Max step budget exceeded." };
      }
      if (Date.now() - startedAt > config.maxWallClockMs) {
        await driver.screenshot(`${config.evidenceDir}/stop-timeout.png`);
        return { status: "timeout", steps, extracted, reason: "Wall-clock timeout exceeded." };
      }

      const response = await client.messages.create({
        model: config.model,
        max_tokens: 1024,
        system: systemPrompt(config.goal),
        tools: DISCOVERY_TOOLS,
        messages,
      });

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      messages.push({ role: "assistant", content: response.content });

      if (!toolUse) {
        messages.push({
          role: "user",
          content: "You must call exactly one tool per turn. Please choose a tool now.",
        });
        continue;
      }

      stepNumber += 1;
      const input = (toolUse.input ?? {}) as Record<string, unknown>;
      const intent = typeof input.intent === "string" ? input.intent : "";

      if (toolUse.name === "finish_goal") {
        const outputs = (input.outputs ?? {}) as Record<string, unknown>;
        config.transcript.log({
          step: stepNumber,
          timestamp: new Date().toISOString(),
          action: { type: "finish_goal", params: input },
          outcome: "ok",
        });
        return {
          status: "completed",
          steps,
          extracted,
          outputs,
          summary: typeof input.summary === "string" ? input.summary : undefined,
        };
      }

      if (toolUse.name === "report_stuck") {
        const reason = typeof input.reason === "string" ? input.reason : "unspecified";
        await driver.screenshot(`${config.evidenceDir}/stop-stuck.png`);
        config.transcript.log({
          step: stepNumber,
          timestamp: new Date().toISOString(),
          action: { type: "report_stuck", params: input },
          outcome: "ok",
        });
        return { status: "stuck", steps, extracted, reason };
      }

      const riskLevel = classifyIntent(intent || toolUse.name);
      const actionType = TOOL_TO_ACTION_TYPE[toolUse.name];

      if (actionType) {
        const urlForCheck =
          toolUse.name === "navigate" ? String(input.url ?? "") : observation.url;
        const allowlistResult = checkAllowlist(config.allowlist, {
          url: urlForCheck,
          actionType,
        });
        const riskGate = evaluateRiskGate({
          riskLevel,
          mode: "discovery",
          confirmed: config.allowIrreversible,
        });

        if (!allowlistResult.allowed || !riskGate.allowed) {
          const reason = allowlistResult.reason ?? riskGate.reason ?? "Blocked by policy.";
          config.transcript.log({
            step: stepNumber,
            timestamp: new Date().toISOString(),
            rationale: intent,
            action: { type: toolUse.name, params: input },
            guardrail: { allowed: false, reason },
            outcome: "blocked",
          });
          messages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `Action blocked by policy: ${reason}`,
                is_error: true,
              },
            ],
          });
          continue;
        }
      }

      try {
        await executeTool(driver, toolUse.name, input, extracted);
        observation = await driver.observe();
        consecutiveErrors = 0;
        const recorded: RecordedStep = {
          stepNumber,
          toolName: toolUse.name,
          input,
          intent,
          riskLevel,
          observationAfter: observation,
        };
        steps.push(recorded);
        config.transcript.log({
          step: stepNumber,
          timestamp: new Date().toISOString(),
          rationale: intent,
          action: { type: toolUse.name, params: input },
          observation: { url: observation.url, title: observation.title },
          guardrail: { allowed: true },
          outcome: "ok",
        });
        const extractNote =
          toolUse.name === "extract"
            ? `Extracted "${String(input.key)}" = ${JSON.stringify(extracted[String(input.key)])}\n\n`
            : "";
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: `${extractNote}${formatObservation(observation)}`,
            },
          ],
        });
      } catch (err) {
        consecutiveErrors += 1;
        const message = err instanceof Error ? err.message : String(err);
        config.transcript.log({
          step: stepNumber,
          timestamp: new Date().toISOString(),
          rationale: intent,
          action: { type: toolUse.name, params: input },
          outcome: "tool_error",
          detail: message,
        });
        if (consecutiveErrors >= config.maxConsecutiveErrors) {
          await driver.screenshot(`${config.evidenceDir}/stop-dead-end.png`);
          return {
            status: "stuck",
            steps,
            extracted,
            reason: `Dead end: ${consecutiveErrors} consecutive tool errors. Last error: ${message}`,
          };
        }
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: `Tool error: ${message}`,
              is_error: true,
            },
          ],
        });
      }
    }
  } finally {
    await driver.close();
  }
}

async function executeTool(
  driver: BrowserDriver,
  name: string,
  input: Record<string, unknown>,
  extracted: Record<string, string>
): Promise<void> {
  switch (name) {
    case "login": {
      const username = process.env.TELLER_USERNAME ?? "teller1";
      const password = process.env.TELLER_PASSWORD ?? "password123";
      await driver.login(username, password);
      return;
    }
    case "navigate":
      await driver.goto(String(input.url));
      return;
    case "click":
      await driver.clickByRole(String(input.role), String(input.name));
      return;
    case "fill":
      await driver.fillByRole(String(input.role), String(input.name), String(input.value));
      return;
    case "wait_for":
      await driver.waitForRole(String(input.role), String(input.name), 8000);
      return;
    case "extract": {
      const page = driver.getPage();
      const rowLabel = String(input.rowLabel);
      const key = String(input.key);
      extracted[key] = await readRowValue(page, rowLabel);
      return;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
