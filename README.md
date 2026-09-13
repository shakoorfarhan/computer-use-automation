# Computer-Use Automation System

A small end-to-end system built for interface.ai's take-home assignment. An LLM figures out how
to accomplish a goal inside a legacy banking UI. That run is compiled into a versioned, typed
capability artifact. The artifact then replays deterministically afterward, with no model in
the loop.

See [`REPORT.md`](./REPORT.md) for the design write-up (architecture, schema, error handling,
heterogeneity, escalation, safety, cuts).

## What's here

- `src/mock-app/` : a mock "Meridian Credit Union" teller console. Server-rendered, nested
  `<table>` layout, no test IDs, session cookies, an iframe account panel, and built-in fault
  injection (not-found, permission-denied, session-expiry, slow load, server error).
- `src/discovery/` : the Claude tool-calling loop that drives the console via Playwright's
  accessibility tree (not the raw DOM) to accomplish a natural-language goal.
- `src/artifact/` : the `Capability` Zod schema and the compiler that turns a successful
  discovery transcript into one.
- `src/replay/` : the deterministic replay engine. Locator resolution with fallbacks, the
  business-outcome / recoverable / hard-failure result contract, and the error taxonomy.
- `src/guardrails/` : the allowlist, risk classifier, and redaction functions used by both
  discovery and replay.
- `src/escalation/` : the human-in-the-loop handoff. An escalation ticket, a small state
  machine, and a standalone operator CLI that attaches to the same live browser session over
  CDP.
- `evidence/` : saved artifacts and logs from real runs (see below).

## Setup

```bash
npm install
npx playwright install chromium   # one-time browser binary download, about 280MB
```

You need an Anthropic API key for the discovery loop only. Replay never calls an LLM.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

You can optionally override the model (it defaults to `claude-sonnet-5`):

```bash
export ANTHROPIC_MODEL=claude-sonnet-5
```

Teller login credentials for the mock app default to `teller1` / `password123` (also
overridable via `TELLER_USERNAME` / `TELLER_PASSWORD`). These are test-only credentials for a
fake local app. See REPORT.md's Safety section for why they never pass through the model at all.

## Demo path

**1. Start the mock app** and leave it running in its own terminal:

```bash
npm run mock-app
# Meridian Credit Union teller console at http://localhost:4000
```

**2. Run a real, LLM-driven discovery pass** against it:

```bash
npm run discover -- \
  --goal "Log in, look up member 10023, and read their current savings balance" \
  --entry http://localhost:4000/login \
  --id lookup-member-savings \
  --name "Look up member savings balance" \
  --param memberId=10023:string
```

This drives a real browser through Playwright's accessibility tree. Every observe/decide/act
step is logged to `evidence/discovery-<timestamp>/discovery-transcript.jsonl`. On success, it
compiles and saves a versioned capability to `capabilities/lookup-member-savings.v1.0.0.json`.

**3. Replay that capability deterministically** (no LLM involved) for a different member:

```bash
npm run replay -- \
  --capability capabilities/lookup-member-savings.v1.0.0.json \
  --param memberId=10047
```

**4. Replay against an injected fault** to see the error handling in action:

```bash
curl -s -X POST http://localhost:4000/admin/faults -d "mode=not_found"
npm run replay -- \
  --capability capabilities/lookup-member-savings.v1.0.0.json \
  --param memberId=10023
curl -s -X POST http://localhost:4000/admin/faults -d "mode=none"   # reset when done
```

The result comes back as `{"kind": "business_outcome", "signature": "heading:Member Not Found", ...}`.
Not a crash, and not a plain boolean. Every fault mode (`not_found`, `permission_denied`,
`session_expired`, `slow`, `server_error`) can be toggled the same way, or overridden on a single
request with `?inject=<mode>` on any mock-app URL.

**5. Trigger the human-escalation handoff.** Run a discovery goal that requires an irreversible
action, which is blocked by default policy and causes the agent to call `report_stuck`:

```bash
npm run discover -- \
  --goal "Open a new sub-account for member 10023 and reach the confirmation screen" \
  --entry http://localhost:4000/login \
  --id open-subaccount \
  --param memberId=10023:string
```

When it prints `[ESCALATION] ...`, open a second terminal and attach an operator to that same
live browser session:

```bash
npm run operator -- --ticket evidence/discovery-<run-id>/escalation-ticket.json
```

Use `click`, `fill`, `goto`, `extract`, and `done` to finish the flow by hand. The first
terminal resumes on its own and reports `completed_via_escalation` once you type `done`.

## Running the test suite

```bash
npm test
```

This covers the allowlist and redaction functions, plus, against a real instance of the mock
app, the replay engine's success path, business-outcome classification, session-expiry
recovery, and irreversible-action blocking.

## Running without live services

The test suite (`npm test`) and `npm run typecheck` need no network access and no API key. They
spin up the mock app in-process. Only `npm run discover` needs `ANTHROPIC_API_KEY` and a real
browser. `npm run replay` needs a browser but no API key.
