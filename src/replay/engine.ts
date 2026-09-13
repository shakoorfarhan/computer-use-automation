import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Capability, Checkpoint, FieldSpec, Step } from "../artifact/schema.js";
import { checkAllowlist, type AllowlistConfig } from "../guardrails/allowlist.js";
import { evaluateRiskGate } from "../guardrails/riskClassifier.js";
import { detectKnownFault } from "./errorTaxonomy.js";
import { resolveLocator } from "./locatorResolution.js";
import { buildZodObject } from "./paramSchema.js";
import { renderTemplate } from "./renderTemplate.js";
import { readRowValue } from "./rowExtraction.js";
import type { ReplayResult } from "./result.js";
import { TranscriptLogger } from "../discovery/transcript.js";

export interface ReplayConfig {
  capability: Capability;
  params: Record<string, unknown>;
  allowlist: AllowlistConfig;
  headless: boolean;
  confirmIrreversible: boolean;
  tellerUsername: string;
  tellerPassword: string;
  evidenceDir: string;
  transcript: TranscriptLogger;
}

function coerceOutput(raw: string, spec: FieldSpec): unknown {
  if (spec.type === "number") return Number(raw.replace(/[^0-9.-]/g, ""));
  if (spec.type === "boolean") return raw.trim().toLowerCase() === "true";
  return raw;
}

async function verifyCheckpoint(
  page: Page,
  checkpoint: Checkpoint | undefined,
  params: Record<string, unknown>
): Promise<{ ok: boolean; observed: string }> {
  if (!checkpoint) return { ok: true, observed: "" };
  if (checkpoint.type === "url_matches") {
    const expected = renderTemplate(checkpoint.expect, params);
    return { ok: page.url() === expected, observed: page.url() };
  }
  if (checkpoint.type === "text_contains") {
    const bodyText = await page.locator("body").innerText();
    const expected = renderTemplate(checkpoint.expect, params);
    return { ok: bodyText.includes(expected), observed: bodyText.slice(0, 200) };
  }
  const [role, ...rest] = checkpoint.expect.split(":");
  const name = rest.join(":");
  const visible = await page
    .getByRole(role as Parameters<Page["getByRole"]>[0], { name })
    .first()
    .isVisible()
    .catch(() => false);
  return { ok: visible, observed: visible ? "visible" : "not visible" };
}

async function executeStep(
  page: Page,
  step: Step,
  params: Record<string, unknown>,
  extracted: Record<string, string>
): Promise<void> {
  switch (step.action.type) {
    case "login": {
      const username = String(params.__tellerUsername);
      const password = String(params.__tellerPassword);
      await page.getByLabel("Teller ID").fill(username);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign In" }).click();
      await page.waitForLoadState("domcontentloaded");
      return;
    }
    case "goto":
      await page.goto(renderTemplate(step.action.value!, params), { waitUntil: "domcontentloaded" });
      return;
    case "click": {
      const { locator } = await resolveLocator(page, step.action.locator!);
      await locator.click({ timeout: 5000 });
      return;
    }
    case "fill": {
      const { locator } = await resolveLocator(page, step.action.locator!);
      await locator.fill(renderTemplate(step.action.value!, params), { timeout: 5000 });
      return;
    }
    case "wait_for": {
      const { locator } = await resolveLocator(page, step.action.locator!);
      await locator.waitFor({ state: "visible", timeout: 8000 });
      return;
    }
    case "read_text": {
      const spec = JSON.parse(step.action.locator!.primary.value) as { rowLabel: string };
      const text = await readRowValue(page, spec.rowLabel);
      if (step.outputRef) extracted[step.outputRef] = text;
      return;
    }
    default:
      throw new Error(`Replay does not support action type: ${step.action.type}`);
  }
}

export async function replayCapability(
  config: ReplayConfig
): Promise<ReplayResult<Record<string, unknown>>> {
  const { capability } = config;

  const inputValidator = buildZodObject(capability.inputSchema);
  const paramCheck = inputValidator.safeParse(config.params);
  if (!paramCheck.success) {
    return {
      kind: "hard_failure",
      stepId: "input_validation",
      expected: "params matching capability.inputSchema",
      observed: JSON.stringify(paramCheck.error.flatten()),
      message: "Input parameters failed schema validation.",
    };
  }

  const runtimeParams: Record<string, unknown> = {
    ...config.params,
    __tellerUsername: config.tellerUsername,
    __tellerPassword: config.tellerPassword,
  };

  const browser: Browser = await chromium.launch({ headless: config.headless });
  const context: BrowserContext = await browser.newContext();
  const page: Page = await context.newPage();
  const extracted: Record<string, string> = {};
  let recoveredFromSessionExpiry = false;

  try {
    await page.goto(capability.target.entryUrl, { waitUntil: "domcontentloaded" });

    let stepIndex = 0;
    while (stepIndex < capability.steps.length) {
      const step = capability.steps[stepIndex]!;

      if (step.riskLevel === "irreversible" && !config.confirmIrreversible) {
        config.transcript.log({
          step: stepIndex + 1,
          timestamp: new Date().toISOString(),
          action: { type: step.action.type, params: {} },
          outcome: "blocked",
          detail: "Irreversible step blocked by default in autonomous replay.",
        });
        return {
          kind: "hard_failure",
          stepId: step.id,
          expected: "explicit confirmIrreversible=true to proceed",
          observed: "confirmIrreversible=false",
          message: `Irreversible action "${step.intent}" blocked by default policy.`,
        };
      }

      const allowlistUrl =
        step.action.type === "goto" ? renderTemplate(step.action.value!, runtimeParams) : page.url();
      const allowlistCheck = checkAllowlist(config.allowlist, {
        url: allowlistUrl,
        actionType: step.action.type === "login" ? "goto" : step.action.type,
      });
      const riskGate = evaluateRiskGate({
        riskLevel: step.riskLevel,
        mode: "autonomous_replay",
        confirmed: config.confirmIrreversible,
      });
      if (!allowlistCheck.allowed || !riskGate.allowed) {
        const reason = allowlistCheck.reason ?? riskGate.reason ?? "blocked by policy";
        config.transcript.log({
          step: stepIndex + 1,
          timestamp: new Date().toISOString(),
          outcome: "blocked",
          detail: reason,
        });
        return {
          kind: "hard_failure",
          stepId: step.id,
          expected: "action permitted by allowlist/risk policy",
          observed: reason,
          message: `Step "${step.intent}" was blocked: ${reason}`,
        };
      }

      try {
        await executeStep(page, step, runtimeParams, extracted);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await page.screenshot({ path: `${config.evidenceDir}/failure-${step.id}.png` }).catch(() => {});
        config.transcript.log({
          step: stepIndex + 1,
          timestamp: new Date().toISOString(),
          action: { type: step.action.type, params: {} },
          outcome: "tool_error",
          detail: message,
        });
        return {
          kind: "hard_failure",
          stepId: step.id,
          expected: `action "${step.action.type}" to succeed`,
          observed: message,
          message: `Step "${step.intent}" failed: ${message}`,
        };
      }

      const fault = await detectKnownFault(page);
      if (fault) {
        if (fault.signature === "redirect:session_expired" && !recoveredFromSessionExpiry) {
          recoveredFromSessionExpiry = true;
          config.transcript.log({
            step: stepIndex + 1,
            timestamp: new Date().toISOString(),
            outcome: "ok",
            detail: "Session expired; re-authenticating and retrying from the start.",
          });
          await page.goto(capability.target.entryUrl, { waitUntil: "domcontentloaded" });
          stepIndex = 0;
          continue;
        }
        const taxonomyEntry = capability.errorTaxonomy.find((e) => e.signature === fault.signature);
        const classification = taxonomyEntry?.classification ?? "hard_failure";
        await page.screenshot({ path: `${config.evidenceDir}/fault-${fault.signature.replace(/[:/]/g, "_")}.png` }).catch(() => {});
        config.transcript.log({
          step: stepIndex + 1,
          timestamp: new Date().toISOString(),
          outcome: classification === "hard_failure" ? "tool_error" : "ok",
          detail: `Detected fault signature "${fault.signature}" classified as ${classification}.`,
        });
        if (classification === "business_outcome") {
          return {
            kind: "business_outcome",
            signature: fault.signature,
            description: taxonomyEntry?.description ?? fault.signature,
          };
        }
        return {
          kind: "hard_failure",
          stepId: step.id,
          expected: "no known fault signature after this step",
          observed: fault.signature,
          message: taxonomyEntry?.description ?? `Unclassified fault: ${fault.signature}`,
        };
      }

      const checkResult = await verifyCheckpoint(page, step.checkpoint, runtimeParams);
      if (!checkResult.ok) {
        await page.screenshot({ path: `${config.evidenceDir}/failure-${step.id}.png` }).catch(() => {});
        config.transcript.log({
          step: stepIndex + 1,
          timestamp: new Date().toISOString(),
          outcome: "tool_error",
          detail: `Checkpoint failed: expected ${step.checkpoint?.expect}, observed ${checkResult.observed}`,
        });
        return {
          kind: "hard_failure",
          stepId: step.id,
          expected: step.checkpoint?.expect ?? "",
          observed: checkResult.observed,
          message: `Checkpoint failed after step "${step.intent}".`,
        };
      }

      config.transcript.log({
        step: stepIndex + 1,
        timestamp: new Date().toISOString(),
        action: { type: step.action.type, params: {} },
        observation: { url: page.url(), title: await page.title() },
        outcome: "ok",
      });

      stepIndex += 1;
    }

    const outputValidator = buildZodObject(capability.outputSchema);
    const outputs: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(capability.outputSchema)) {
      if (extracted[key] !== undefined) outputs[key] = coerceOutput(extracted[key], spec);
    }
    const outputCheck = outputValidator.safeParse(outputs);
    if (!outputCheck.success) {
      return {
        kind: "hard_failure",
        stepId: "output_validation",
        expected: "outputs matching capability.outputSchema",
        observed: JSON.stringify({ outputs, errors: outputCheck.error.flatten() }),
        message: "Extracted outputs failed schema validation.",
      };
    }
    return { kind: "success", outputs };
  } finally {
    await context.close();
    await browser.close();
  }
}
