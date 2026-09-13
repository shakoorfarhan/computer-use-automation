# Computer-Use Automation System — Plan (interface.ai take-home)

Source: `Assignment A — Computer-Use Automation System.pdf`
Submission: public GitHub repo + email to assignments@interface.ai

## 1. What they're evaluating (in weight order)

1. **System design** — artifact schema + replay contract are central.
2. **Correctness of core loop** — real LLM run completes a real goal; artifact replays deterministically.
3. **Robustness & error handling** — clean split of business outcome vs. recoverable vs. hard failure; sound locator/wait/checkpoint strategy.
4. **Human-in-the-loop escalation** — real detect-stuck → intervene → take live-session control → resume, not a TODO.
5. **Generalization story** — heterogeneous surfaces + multi-tenant reuse (design only, not built).
6. **Safety & data handling** — allowlist, risky/irreversible action handling, PII/secret redaction.
7. **Code quality** — readable, typed, tested where it counts.
8. **Communication** — REPORT.md reasoning and cut lines.

They explicitly do **not** reward feature breadth, framework name-dropping, or premature scaling infra (queues, clusters, multi-tenant plumbing). A small, correct, well-argued system is the goal. Cut depth, not whole capabilities — every core requirement needs a thin-but-real version.

## 2. Company context (why these choices)

- Interface.ai builds agentic AI (BankGPT) for credit unions/community banks — voice, chat, and employee-assist, integrated with 25+ core banking systems, rules-engine-constrained for compliant transactions, positioned for regulated environments.
- Engineering stack per job postings: **TypeScript + Python**, distributed/event-driven systems, cloud-native, multi-tenancy as a first-class platform concern.
- Culture: pushing toward "AI-native," Claude Code/Cursor/frontier-models-as-standard, high ownership, weekly release cycles. (Glassdoor reviews on culture/WLB are mixed — treat the "AI-native, high trust" framing as aspirational, not guaranteed.)
- Net: they will read this code as engineers who work on exactly this problem (member lookup, balances, sub-accounts, legacy core banking UIs). Domain-aware choices read as strong signal; generic e-commerce demos read as generic.

## 3. Stack decision

- **TypeScript + Node.js** — matches their actual codebase language, removes "would this person fit" friction.
- **Claude (Anthropic SDK, tool-calling)** for the discovery-time agent loop — on-brand (Claude Code/Cursor-forward org), and the only LLM access we need.
- **Playwright**, driven **accessibility-tree first** (role + accessible name), with ranked fallbacks (text content → structural/CSS), each carrying a confidence tier. This is the concrete proof of "no clean DOM / no test IDs" awareness.
- **Zod** for artifact/input/output schemas — typed contract + runtime validation for free.

## 4. Target application

Build a small **local mock "credit union teller console"** rather than a public demo/e-commerce site:

- Server-rendered, deliberately legacy-styled: nested `<table>` layout, no `data-testid`, one `<iframe>` panel for account detail, session cookie with a timeout.
- Seeded in-memory fake members (no real PII).
- Example goals: *"look up member 12345 and read their savings balance"*, *"open a sub-account and reach the confirmation screen."*
- **Built-in fault injection** (query param / admin toggle) to simulate: record not found, permission denied, session expired, slow/failed load. This guarantees the required "replay hits an error/exceptional state" evidence instead of hoping a public site cooperates, and avoids their ToS/rate-limit warning entirely.

## 5. Architecture

Single process, no premature infra:

```
discovery: Claude (tool-calling) ⇄ Playwright(a11y-tree) → transcript
transcript → Artifact Compiler → versioned Capability (Zod-validated JSON)
Capability + params → Replay Engine (no LLM in the loop) → typed Result
                     ↳ classifies: BusinessOutcome | Recoverable | HardFailure
Guardrail layer sits between "decide" and "act" in BOTH discovery and replay
Escalation: session state machine (RUNNING → AWAITING_HUMAN → RESUMED),
            operator attaches to the SAME live browser context (CDP), not a new one
Evidence: structured JSONL log (step, rationale, action, observation, timestamp)
          + screenshot at least on failure, full transcript for the discovery run
```

## 6. Artifact schema (sketch — over-invest here)

```ts
Capability {
  id, name, version, description
  target: { app, entryUrl, allowedDomains[] }
  inputs: ZodSchema        // e.g. { memberId: string }
  outputs: ZodSchema       // e.g. { savingsBalance: number }
  steps: [{
    id, intent,                       // human-readable "why"
    action: { type, locator: { strategy, primary, fallbacks[], confidence }, value? }
    riskLevel: "safe" | "reversible" | "irreversible"
    checkpoint: { type, expect }      // asserted, not assumed
  }]
  successCondition
  errorTaxonomy: { signature → classification }
  provenance: { discoveryRunId, model, promptHash }
}
```

Do not let a single `success: boolean` leak through anywhere in the result contract — this is called out as the most common design mistake (conflating business outcome with failure).

## 7. Escalation & handoff

- Mock the operator UI (bare CLI or minimal HTML) — allowed per scope note.
- What must be real: pause propagates to an actual paused state; operator acts on the *same* CDP session (not a fresh browser); a lock records who's in control; actions taken during handoff are logged as evidence; resume hands back cleanly.
- Document the full state diagram in REPORT.md even where the console itself is a stub.

## 8. Safety guardrails

- Single choke-point allowlist (domains + permitted action types), checked before every actuation, not just at loop start.
- Risk classifier tagging each planned action safe / reversible / irreversible; irreversible actions blocked by default in autonomous replay, require explicit confirmation.
- Redaction function (with a unit test) stripping credentials/PII from logs and artifacts before they touch disk.

## 9. Heterogeneity & multi-tenant (design only, per Section 3.7 — not implemented)

- Surface abstraction: steps reference semantic targets (role, name, nearby label), resolved differently per adapter (Playwright DOM today; accessibility-tree/OS-level driver for desktop later) — the artifact format doesn't change, only the adapter.
- Multi-tenant reuse: base artifact + per-tenant override layer (locator/config diffs); canonicalize concrete routes/values into parameterized patterns (`/item/12345` → `/item/:id`); detect drift via replay confidence/failure-rate signals rather than re-recording per tenant.

## 10. Deliverables checklist (exact paths — they read many side by side)

- [ ] `/README.md` — setup, keys/config, demo path (exact run-agent command, then exact replay command)
- [ ] `/REPORT.md` (~1–3 pages, these 7 headings exactly): Architecture; Artifact schema; Determinism & error handling; Heterogeneity & multi-tenant; Escalation & handoff; Safety; Cuts
- [ ] `/evidence/` — saved artifact + discovery-run logs + replay-run logs, including one replay hitting an injected error/exceptional state
- [ ] At least one genuine LLM-driven discovery run against the live mock app (non-negotiable — no shortcuts here)

## 11. What makes this a top submission, not just a good one

1. Domain-aware target app (teller console, not generic cart) — proves Section 1 was actually read.
2. Built-in fault injection — turns "nice to have" error evidence into something guaranteed and controlled.
3. Schema + result contract written as real Zod types, versioned, with a one-paragraph justification per field in REPORT.md.
4. A genuinely real escalation state machine, even behind a throwaway operator UI.
5. An honest, sharp "Cuts" section naming exactly what's stubbed (desktop surface, multi-tenant, operator console polish) and why.
6. Exact deliverable paths and a copy-pasteable two-command demo.

## 12. Open decisions to revisit before building

- Exact Claude model + tool-calling shape for the discovery loop.
- Whether the mock app is Express+EJS vs. plain Node http — keep it minimal.
- How much of the multi-tenant override layer to actually stub in code vs. describe only in REPORT.md.
- Test coverage scope: replay engine, locator resolution, allowlist enforcement, redaction — not broad coverage elsewhere.
