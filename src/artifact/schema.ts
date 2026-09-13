import { z } from "zod";

export const LocatorStrategy = z.enum([
  "role_and_name",
  "text_content",
  "css",
]);
export type LocatorStrategy = z.infer<typeof LocatorStrategy>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const LocatorCandidate = z.object({
  strategy: LocatorStrategy,
  value: z.string(),
  confidence: Confidence,
  rationale: z.string(),
});
export type LocatorCandidate = z.infer<typeof LocatorCandidate>;

export const Locator = z.object({
  primary: LocatorCandidate,
  fallbacks: z.array(LocatorCandidate).default([]),
  frame: z.string().optional(),
});
export type Locator = z.infer<typeof Locator>;

export const RiskLevel = z.enum(["safe", "reversible", "irreversible"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const ActionType = z.enum([
  "goto",
  "click",
  "fill",
  "select",
  "wait_for",
  "read_text",
  "press_key",
]);
export type ActionType = z.infer<typeof ActionType>;

export const Action = z.object({
  type: ActionType,
  locator: Locator.optional(),
  value: z.string().optional(),
  paramRef: z.string().optional(),
});
export type Action = z.infer<typeof Action>;

export const Checkpoint = z.object({
  type: z.enum(["url_matches", "element_visible", "text_contains"]),
  expect: z.string(),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

export const Step = z.object({
  id: z.string(),
  intent: z.string(),
  action: Action,
  riskLevel: RiskLevel,
  checkpoint: Checkpoint.optional(),
  outputRef: z.string().optional(),
});
export type Step = z.infer<typeof Step>;

export const ErrorClassification = z.enum([
  "recoverable",
  "hard_failure",
  "business_outcome",
]);
export type ErrorClassification = z.infer<typeof ErrorClassification>;

export const ErrorTaxonomyEntry = z.object({
  signature: z.string(),
  classification: ErrorClassification,
  description: z.string(),
});
export type ErrorTaxonomyEntry = z.infer<typeof ErrorTaxonomyEntry>;

export const Provenance = z.object({
  discoveryRunId: z.string(),
  model: z.string(),
  promptHash: z.string(),
  createdAt: z.string(),
});
export type Provenance = z.infer<typeof Provenance>;

// A serializable field spec, turned into a real Zod validator at replay time
// (see replay/paramSchema.ts) since Zod schemas themselves aren't JSON-safe.
export const FieldSpec = z.object({
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().optional(),
  optional: z.boolean().default(false),
});
export type FieldSpec = z.infer<typeof FieldSpec>;

export const Capability = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  target: z.object({
    app: z.string(),
    entryUrl: z.string(),
    allowedDomains: z.array(z.string()),
  }),
  inputSchema: z.record(z.string(), FieldSpec),
  outputSchema: z.record(z.string(), FieldSpec),
  steps: z.array(Step),
  successCondition: Checkpoint,
  errorTaxonomy: z.array(ErrorTaxonomyEntry),
  provenance: Provenance,
});
export type Capability = z.infer<typeof Capability>;
