import type { RecordedStep } from "../discovery/agentLoop.js";
import type {
  Action,
  Capability,
  Checkpoint,
  ErrorTaxonomyEntry,
  FieldSpec,
  Locator,
  Step,
} from "./schema.js";

export interface DeclaredParam {
  name: string;
  type: FieldSpec["type"];
  concreteValue: string;
  description?: string;
}

export interface CompileInput {
  id: string;
  name: string;
  version: string;
  description: string;
  app: string;
  entryUrl: string;
  allowedDomains: string[];
  steps: RecordedStep[];
  outputs: Record<string, unknown>;
  params: DeclaredParam[];
  errorTaxonomy: ErrorTaxonomyEntry[];
  discoveryRunId: string;
  model: string;
  promptHash: string;
}

function templatize(raw: string, params: DeclaredParam[]): string {
  let out = raw;
  for (const p of params) {
    if (p.concreteValue && out.includes(p.concreteValue)) {
      out = out.split(p.concreteValue).join(`{{${p.name}}}`);
    }
  }
  return out;
}

function inferFieldType(value: unknown): FieldSpec["type"] {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

function buildRoleLocator(role: string, name: string): Locator {
  return {
    primary: {
      strategy: "role_and_name",
      value: `${role}:${name}`,
      confidence: "high",
      rationale: `Accessible role+name stays stable in server-rendered legacy markup even without test IDs; this app exposes "${name}" as the accessible name of a ${role}.`,
    },
    fallbacks: [
      {
        strategy: "text_content",
        value: name,
        confidence: "medium",
        rationale: "Falls back to visible text if the role changes but the label persists.",
      },
    ],
  };
}

function buildExtractLocator(rowLabel: string): Locator {
  return {
    primary: {
      strategy: "text_content",
      value: JSON.stringify({ rowLabel, cellIndex: "last" }),
      confidence: "high",
      rationale:
        "Anchored to a stable row-label cell rather than the dynamic value itself, so the locator survives across different member records.",
    },
    fallbacks: [],
  };
}

export function compileCapability(input: CompileInput): Capability {
  const compiledSteps: Step[] = [];
  let prevUrl: string | undefined;

  input.steps.forEach((recorded, index) => {
    let action: Action;
    switch (recorded.toolName) {
      case "login":
        action = { type: "login" };
        break;
      case "navigate":
        action = { type: "goto", value: templatize(String(recorded.input.url), input.params) };
        break;
      case "click":
        action = {
          type: "click",
          locator: buildRoleLocator(String(recorded.input.role), String(recorded.input.name)),
        };
        break;
      case "fill":
        action = {
          type: "fill",
          locator: buildRoleLocator(String(recorded.input.role), String(recorded.input.name)),
          value: templatize(String(recorded.input.value), input.params),
        };
        break;
      case "wait_for":
        action = {
          type: "wait_for",
          locator: buildRoleLocator(String(recorded.input.role), String(recorded.input.name)),
        };
        break;
      case "extract":
        action = { type: "read_text", locator: buildExtractLocator(String(recorded.input.rowLabel)) };
        break;
      default:
        throw new Error(`Cannot compile unknown discovery tool: ${recorded.toolName}`);
    }

    const url = recorded.observationAfter.url;
    const checkpoint: Checkpoint | undefined =
      url !== prevUrl ? { type: "url_matches", expect: templatize(url, input.params) } : undefined;
    prevUrl = url;

    compiledSteps.push({
      id: `step-${index + 1}`,
      intent: recorded.intent || recorded.toolName,
      action,
      riskLevel: recorded.riskLevel,
      checkpoint,
      outputRef: recorded.toolName === "extract" ? String(recorded.input.key) : undefined,
    });
  });

  const lastStep = compiledSteps[compiledSteps.length - 1];
  const lastUrl = input.steps[input.steps.length - 1]?.observationAfter.url ?? input.entryUrl;
  const successCondition: Checkpoint = lastStep?.checkpoint ?? {
    type: "url_matches",
    expect: templatize(lastUrl, input.params),
  };

  const inputSchema: Record<string, FieldSpec> = {};
  for (const p of input.params) {
    inputSchema[p.name] = { type: p.type, description: p.description, optional: false };
  }

  const outputSchema: Record<string, FieldSpec> = {};
  for (const [key, value] of Object.entries(input.outputs)) {
    outputSchema[key] = { type: inferFieldType(value), optional: false };
  }

  return {
    id: input.id,
    name: input.name,
    version: input.version,
    description: input.description,
    target: {
      app: input.app,
      entryUrl: input.entryUrl,
      allowedDomains: input.allowedDomains,
    },
    inputSchema,
    outputSchema,
    steps: compiledSteps,
    successCondition,
    errorTaxonomy: input.errorTaxonomy,
    provenance: {
      discoveryRunId: input.discoveryRunId,
      model: input.model,
      promptHash: input.promptHash,
      createdAt: new Date().toISOString(),
    },
  };
}
