import { describe, expect, it } from "vitest";
import { checkAllowlist, type AllowlistConfig } from "../src/guardrails/allowlist.js";

const config: AllowlistConfig = {
  allowedDomains: ["localhost"],
  allowedActionTypes: ["goto", "click", "fill", "read_text"],
};

describe("checkAllowlist", () => {
  it("allows an in-scope domain and action type", () => {
    const result = checkAllowlist(config, {
      url: "http://localhost:4000/members/10023",
      actionType: "click",
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks a domain outside the allowlist", () => {
    const result = checkAllowlist(config, {
      url: "http://evil.example.com/members/10023",
      actionType: "click",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not on the allowlist/);
  });

  it("blocks an action type outside the allowlist", () => {
    const result = checkAllowlist(config, {
      url: "http://localhost:4000/",
      actionType: "press_key",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Action type/);
  });

  it("allows subdomains of an allowed domain", () => {
    const withSubdomain: AllowlistConfig = {
      allowedDomains: ["example.com"],
      allowedActionTypes: ["goto"],
    };
    const result = checkAllowlist(withSubdomain, {
      url: "http://app.example.com/",
      actionType: "goto",
    });
    expect(result.allowed).toBe(true);
  });

  it("rejects an unparseable url", () => {
    const result = checkAllowlist(config, { url: "not-a-url", actionType: "goto" });
    expect(result.allowed).toBe(false);
  });
});
