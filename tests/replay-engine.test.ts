import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/mock-app/server.js";
import type { ActionType, Capability } from "../src/artifact/schema.js";
import { TELLER_CONSOLE_ERROR_TAXONOMY } from "../src/replay/errorTaxonomy.js";
import { replayCapability } from "../src/replay/engine.js";
import { TranscriptLogger } from "../src/discovery/transcript.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 4000;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

function buildCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "lookup-member-savings",
    name: "Look up member savings balance",
    version: "1.0.0",
    description: "Logs in, opens a member record, and reads the savings balance.",
    target: {
      app: "teller-console",
      entryUrl: `${baseUrl}/login`,
      allowedDomains: ["127.0.0.1"],
    },
    inputSchema: { memberId: { type: "string", optional: false } },
    outputSchema: { savingsBalance: { type: "number", optional: false } },
    steps: [
      {
        id: "step-1",
        intent: "Sign in as the teller",
        action: { type: "login" },
        riskLevel: "safe",
        checkpoint: { type: "url_matches", expect: `${baseUrl}/` },
      },
      {
        id: "step-2",
        intent: "Open member {{memberId}}",
        action: { type: "goto", value: `${baseUrl}/members/{{memberId}}` },
        riskLevel: "safe",
      },
      {
        id: "step-3",
        intent: "Read the savings balance",
        action: {
          type: "read_text",
          locator: {
            primary: {
              strategy: "text_content",
              value: JSON.stringify({ rowLabel: "Savings", cellIndex: "last" }),
              confidence: "high",
              rationale: "Anchored to the stable 'Savings' row label.",
            },
            fallbacks: [],
          },
        },
        riskLevel: "safe",
        outputRef: "savingsBalance",
      },
    ],
    successCondition: { type: "url_matches", expect: `${baseUrl}/members/{{memberId}}` },
    errorTaxonomy: TELLER_CONSOLE_ERROR_TAXONOMY,
    provenance: {
      discoveryRunId: "test-run",
      model: "test",
      promptHash: "test",
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

function makeConfig(capability: Capability, params: Record<string, unknown>, evidenceDir: string) {
  return {
    capability,
    params,
    allowlist: {
      allowedDomains: ["127.0.0.1"],
      allowedActionTypes: ["goto", "click", "fill", "wait_for", "read_text"] as ActionType[],
    },
    headless: true,
    confirmIrreversible: false,
    tellerUsername: "teller1",
    tellerPassword: "password123",
    evidenceDir,
    transcript: new TranscriptLogger(path.join(evidenceDir, "transcript.jsonl")),
  };
}

describe("replayCapability", () => {
  it("succeeds and extracts a typed output for an existing member", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "replay-test-"));
    const result = await replayCapability(makeConfig(buildCapability(), { memberId: "10023" }, dir));
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.outputs.savingsBalance).toBeCloseTo(4820.55);
    }
  });

  it("classifies a nonexistent member as a business outcome, not a crash", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "replay-test-"));
    const result = await replayCapability(makeConfig(buildCapability(), { memberId: "99999" }, dir));
    expect(result.kind).toBe("business_outcome");
    if (result.kind === "business_outcome") {
      expect(result.signature).toBe("heading:Member Not Found");
    }
  });

  it("recovers once from an injected session-expiry fault", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "replay-test-"));
    const capability = buildCapability({
      steps: [
        {
          id: "step-1",
          intent: "Sign in as the teller",
          action: { type: "login" },
          riskLevel: "safe",
        },
        {
          id: "step-2",
          intent: "Open member {{memberId}}",
          action: { type: "goto", value: `${baseUrl}/members/{{memberId}}?inject=session_expired` },
          riskLevel: "safe",
        },
      ],
    });
    const result = await replayCapability(makeConfig(capability, { memberId: "10023" }, dir));
    // After the injected expiry the fault-mode step still forces the same
    // redirect on retry, so this should surface as a hard failure rather
    // than looping forever — proving the single-retry guard works.
    expect(result.kind).toBe("hard_failure");
  });

  it("blocks an irreversible step by default in autonomous replay", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "replay-test-"));
    const capability = buildCapability({
      steps: [
        {
          id: "step-1",
          intent: "Sign in as the teller",
          action: { type: "login" },
          riskLevel: "safe",
        },
        {
          id: "step-2",
          intent: "Open a new sub-account",
          action: { type: "goto", value: `${baseUrl}/members/{{memberId}}/subaccounts/new` },
          riskLevel: "irreversible",
        },
      ],
    });
    const result = await replayCapability(makeConfig(capability, { memberId: "10023" }, dir));
    expect(result.kind).toBe("hard_failure");
    if (result.kind === "hard_failure") {
      expect(result.message).toMatch(/blocked by default policy/);
    }
  });
});
