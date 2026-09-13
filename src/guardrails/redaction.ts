const SENSITIVE_KEY_PATTERN = /password|passwd|secret|token|api[_-]?key|ssn|pin\b/i;
const ACCOUNT_NUMBER_PATTERN = /\b([A-Z]{2,3}-\d{4,6}-\d{2,4})\b/g;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

function maskAccountNumber(acct: string): string {
  const parts = acct.split("-");
  return parts
    .map((part, i) => (i === parts.length - 1 ? part : "*".repeat(part.length)))
    .join("-");
}

export function redactText(input: string): string {
  return input
    .replace(ACCOUNT_NUMBER_PATTERN, (m) => maskAccountNumber(m))
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]");
}

// Recursively redacts sensitive object keys and scrubs known PII patterns from
// string values. Call this on every payload before it touches disk (logs, artifacts).
export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(val);
    }
    return out;
  }
  return value;
}
