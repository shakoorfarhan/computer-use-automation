import { describe, expect, it } from "vitest";
import { redactText, redactValue } from "../src/guardrails/redaction.js";

describe("redactText", () => {
  it("masks account numbers but keeps the last segment visible", () => {
    expect(redactText("balance for SV-10023-01 is $50")).toBe(
      "balance for **-*****-01 is $50"
    );
  });

  it("redacts emails", () => {
    expect(redactText("contact alice@example.com now")).toBe(
      "contact [REDACTED_EMAIL] now"
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(redactText("member 10023 looked up their balance")).toBe(
      "member 10023 looked up their balance"
    );
  });
});

describe("redactValue", () => {
  it("redacts sensitive keys regardless of nesting depth", () => {
    const input = {
      username: "teller1",
      password: "hunter2",
      session: { token: "abc123", note: "fine" },
    };
    expect(redactValue(input)).toEqual({
      username: "teller1",
      password: "[REDACTED]",
      session: { token: "[REDACTED]", note: "fine" },
    });
  });

  it("redacts sensitive keys inside arrays of objects", () => {
    const input = [{ apiKey: "xyz" }, { note: "ok" }];
    expect(redactValue(input)).toEqual([
      { apiKey: "[REDACTED]" },
      { note: "ok" },
    ]);
  });

  it("scrubs PII patterns inside plain string values", () => {
    expect(redactValue("email me at bob@bank.com")).toBe(
      "email me at [REDACTED_EMAIL]"
    );
  });
});
