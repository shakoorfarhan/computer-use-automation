# Design Report

## 1. Architecture

One process, no queues, no clusters. A discovery loop, an artifact compiler, and a replay
engine all share one language and one schema:

```
discovery: Claude (tool-calling) <-> Playwright (accessibility tree) -> transcript
transcript -> Artifact Compiler -> versioned Capability (Zod-validated JSON, on disk)
Capability + params -> Replay Engine (no LLM) -> typed Result (success | business_outcome | hard_failure)
Guardrail layer (allowlist + risk gate) sits between "decide" and "act" in BOTH paths
Escalation: an on-disk ticket plus a CDP wsEndpoint, so a separate operator process can attach
            to the SAME live browser session, not a fresh one
Evidence: a redacted, structured JSONL log per run, plus screenshots on failure/fault/escalation
```

Key decisions:

- **TypeScript and Node**, matching interface.ai's stated stack, so both the discovery agent
  and the deterministic executor share one runtime with no cross-language schema drift.
- **Anthropic SDK tool-calling** directly, not MCP, not an agent framework. The tool surface is
  seven small functions: `login`, `navigate`, `click`, `fill`, `wait_for`, `extract`, and
  `finish_goal` / `report_stuck`. Anything bigger would be the framework name-dropping the brief
  says isn't rewarded.
- **Playwright, accessibility-tree first.** Observation is `page.ariaSnapshot({mode:"ai"})`:
  role and accessible name, including same-origin iframe content, never raw HTML. That's the
  concrete answer to "no clean DOM, no test IDs": the mock app's nested `<table>` layout still
  produces a fully legible tree (`- cell "Savings"`, `- textbox "Teller ID"`) with zero test
  hooks. Replay locators are the same role/name pairs, with a text-content fallback behind them.
- **No database.** Members are seeded in memory in the mock app; capabilities are plain files on
  disk. Multi-tenant plumbing, queues, and clusters are explicitly out of scope (brief §7, §9).
  Designing so they *could* exist later (see §4) is the actual ask, not building them now.
- **Credentials never reach the model.** `login` is a zero-argument tool; the harness fills in
  `TELLER_USERNAME` / `TELLER_PASSWORD` from the environment. The agent never sees, types, or
  logs a password, so it can't leak what it never received.

## 2. Artifact schema

`src/artifact/schema.ts` defines `Capability`, shaped around the brief's five required elements,
each its own top-level field rather than a generic step list:

- **`steps[]`.** Each step carries an `intent` (why, in plain English, for a human reviewer), a
  `riskLevel` fixed at discovery time rather than recomputed at replay time (see §6), and an
  optional `checkpoint` asserting it actually landed where expected.
- **Locator identification, with the robustness reasoning built into the schema, not left to
  prose.** Every `Locator` has a `primary` candidate plus `fallbacks[]`, and every candidate
  carries both a `confidence` tier and a `rationale` string, e.g. "accessible role and name stay
  stable in server-rendered legacy markup even without test IDs." A reviewer sees why a locator
  was chosen, not just what it is.
- **`inputSchema` / `outputSchema`.** Stored as a serializable `FieldSpec` map
  (`{type, optional, description}`) rather than an actual `ZodSchema` instance, since Zod schemas
  aren't JSON-safe. `replay/paramSchema.ts` rebuilds a real runtime Zod validator from the spec at
  replay time, so validation stays fully typed and enforced.
- **`successCondition`**, a `Checkpoint`, the same type used per step, so "the capability
  succeeded" and "this one step succeeded" share one vocabulary.
- **`errorTaxonomy[]`**, an explicit signature-to-classification table
  (`business_outcome | recoverable | hard_failure`), attached to the capability rather than
  hardcoded into the engine, so a different target app can carry its own fault vocabulary against
  the same replay code (`src/replay/errorTaxonomy.ts`).
- **`provenance`**: `discoveryRunId`, `model`, `promptHash`, `createdAt`, so an artifact traces
  back to the transcript that produced it without embedding that transcript, matching the
  brief's own phrase, an artifact "decoupled from the raw model transcript."

Parameterization uses `{{paramName}}` templates inside `action.value` and `checkpoint.expect`,
rendered against the caller's params at replay time (`replay/renderTemplate.ts`). Simpler and
more transparent than a separate `paramRef` field for the one case that needs it: a param
embedded inside a longer literal string, like a URL path segment.

The one thing this schema refuses to do is collapse a result into `success: boolean`. That's
enforced one level up, in the result contract (§3), because the brief calls it "the most common
design mistake."

## 3. Determinism & error handling

**Determinism.** Replay never calls the LLM. Every locator, value, and checkpoint was fixed at
compile time; only the caller's typed params vary, rendered through the same template function
used to compile the capability. `replay/locatorResolution.ts` tries the primary locator, then
each fallback in order, the same chain every time, so deterministic doesn't mean brittle.

**The result contract** (`src/replay/result.ts`) is a literal three-way union:

```ts
type ReplayResult<T> =
  | { kind: "success"; outputs: T }
  | { kind: "business_outcome"; signature: string; description: string }
  | { kind: "hard_failure"; stepId: string; expected: string; observed: string; message: string }
```

No boolean anywhere. "No such member" comes back as `business_outcome`, not a crash: the engine
matches the page against `errorTaxonomy` (`detectKnownFault` in `errorTaxonomy.ts`, checking
heading text and URL patterns after every step) and returns the taxonomy's description directly.

**Recoverable conditions get one real retry, not a crash and not a silent loop.** Session
expiry mid-replay is detected by URL pattern; the engine re-authenticates and restarts the step
sequence once. A second expiry in the same replay surfaces as `hard_failure` instead of retrying
forever (the `recoveredFromSessionExpiry` guard in `replay/engine.ts`, tested in
`tests/replay-engine.test.ts`).

**Hard failures carry debuggable detail:** `stepId`, `expected`, `observed`. A checkpoint
mismatch, a locator with zero resolved candidates, an unclassified fault signature, and a
failed input/output Zod validation all return through this same shape.

**Irreversible actions are a separate axis, not folded into the error taxonomy.** A step tagged
`riskLevel: "irreversible"` is blocked by default in autonomous replay
(`riskClassifier.ts`'s `evaluateRiskGate`), returned as `hard_failure` with an explicit policy
message, unless the caller passes `--confirm-irreversible`. "Replay was correctly refused by
policy" is a different fact than "the target app errored," and mixing the two would hide a
safety decision inside ordinary error handling.

## 4. Heterogeneity & multi-tenant

**Surface abstraction.** The seam is the `Locator`/`Action` schema, not the Playwright code
underneath. A step says "click the thing with this role and this accessible name," never "click
the third `<button>` in the DOM." Extending to a desktop app would only need a new adapter in
`replay/locatorResolution.ts` and `discovery/browserDriver.ts` that resolves `role_and_name` /
`text_content` against a platform accessibility API (UIAutomation, AXUIElement) instead of
Playwright. The `Capability` JSON, the compiler, and the result contract wouldn't change; the
artifact describes *what* to do, the adapter knows *how*.

**Multi-tenant reuse.** Two tenants on the same vendor product differ in two ways this design
already keeps separate. **Config** (base URL, allowed domains, credentials) already lives in
`Capability.target`, not scattered through `steps[]`; a per-tenant override would be a shallow
merge over `target` plus a locator-override map keyed by step `id`, not a re-record. **Routes
and values** already use the `{{paramName}}` templating from §2, the same mechanism that would
canonicalize `/members/12345` into `/members/{{memberId}}` for cross-tenant reuse.

**Drift detection** would reuse signals replay already produces: locator fallback usage (a
capability increasingly resolving via its medium-confidence fallback is drifting even while it
still "succeeds"), and checkpoint / business-outcome rates over repeated replays. None of this
is built, matching the brief's "design, not necessarily build" scope for §3.7, but the schema
doesn't block it: confidence tiers and fallback chains exist for exactly this reason.

## 5. Escalation & handoff

**Detect.** The agent calls `report_stuck`, a first-class tool, not an exception, when it
genuinely can't proceed or a guardrail refused an action. `discovery/agentLoop.ts` treats this as
its own branch, separate from tool errors and the step/timeout budget, so "stuck" evidence
always carries a screenshot and a reason string.

**Route.** An `EscalationTicket` (`src/escalation/ticket.ts`) is written to
`evidence/<run>/escalation-ticket.json`, with the goal, the current step, the reason, a
screenshot path, and the live browser's CDP `wsEndpoint`.

**Take control of the live session, for real.** `BrowserDriver` launches Chromium with
`chromium.launchServer()` instead of `chromium.launch()`, so a second, independent Playwright
process can call `chromium.connect(wsEndpoint)` and find the exact same browser context and page
(`src/escalation/operatorCli.ts`). Two OS-level client connections, one browser process, one
live page, not a simulation of one. The automation process blocks, polling the ticket file,
rather than exiting, which is what keeps the session alive and pauseable.

**Control-transfer model.** A small state machine (`src/escalation/stateMachine.ts`) moves the
ticket through `AWAITING_HUMAN -> IN_PROGRESS -> RESUMED`, and the ticket always carries a
`controlledBy` field, so who's in control is a fact on disk. Only a claimed ticket accepts
operator actions or a resume. Every operator command (`click`, `fill`, `goto`, `extract`) is
appended to `operatorActions[]` before it runs: "record what the human did" as durable evidence.

**Resume.** The operator's `done [summary]` command sets the ticket to `RESUMED`. The waiting
discovery process polls this (about once a second), logs the operator's actions into its own
transcript, and returns a distinct `completed_via_escalation` status, deliberately not merged
into plain `completed`, because compiling a capability from a partly manual run would produce an
artifact that can't replay the human's part of it (see §7).

**What's mocked, on purpose:** the operator UI is a line-oriented CLI, not a co-browsing console
with a live rendered view, matching the scope note's allowance exactly. The mechanism underneath
it (the real CDP session, the real ticket, the real state machine) is not mocked.

## 6. Safety

- **Allowlist** (`guardrails/allowlist.ts`) is one function, called before every actuation in
  both discovery and replay: domain (with subdomain matching) and action type, both explicit and
  configurable. One choke point, not one per call site, so a new action type is safe by default.
- **Risk classification is heuristic and keyword-based** (`riskClassifier.ts`), applied to the
  agent's own stated `intent`. This is a real limitation: it can misclassify an intent that
  doesn't use an expected verb. The mitigation is that classification happens once, at discovery
  time, then freezes into the artifact's `riskLevel`, where a human reviewer can see and correct
  it before production, rather than trusting a fresh classification on every replay.
- **Irreversible actions are blocked by default in autonomous replay**, not just flagged, and
  blocked during discovery too unless the operator passes `--allow-irreversible`. The guardrail
  sits between decide and act in both loops, as the brief asks, not just one.
- **Redaction** (`guardrails/redaction.ts`, tested in `tests/redaction.test.ts`) runs on every
  object before it's written to a transcript line. Sensitive key names (`password`, `token`,
  `apiKey`, `ssn`, `pin`, ...) are replaced regardless of nesting depth, and account-number-shaped
  strings are masked to their last segment even inside free-text values. Combined with the
  credential design in §1, there's no code path where a raw credential is even available to
  redact; redaction is a second layer, not the only one.
- **Limits, stated plainly:** the risk classifier is a heuristic, not a policy engine, and there
  is no approval workflow (draft to approved) gating a capability before its first unattended
  replay (see §7).

## 7. Cuts

Left out, on purpose:

- **Multi-tenant plumbing and a desktop-surface adapter.** Not built, per the brief's explicit
  instruction not to build scaling infrastructure prematurely. Designed for in §4 instead.
- **A real-time co-browsing operator console.** Out of scope per the brief's scope note. Built a
  line-oriented CLI instead; the handoff mechanism underneath (CDP, ticket, state machine) is real.
- **Automatic capability compilation from an escalated run.** Refused on purpose. A run finished
  through human intervention produces evidence but not a `Capability`, because the manual portion
  isn't a clean, replayable locator sequence, and compiling one anyway would quietly produce an
  artifact that can't replay itself.
- **Confidence scoring and draft/approved gating for capabilities**, an optional stretch goal.
  The schema carries the ingredients (`confidence` per locator, fallback usage as a signal), but
  the scoring and approval machinery on top isn't there yet.
- **Assisted fallback** (bounded LLM recovery on a single replay step). Skipped in favor of
  making human escalation the one recovery mechanism that's genuinely real.
- **Multi-run stability reporting.** Not built; a fairly direct addition given the fallback-usage
  data the engine already produces per run.

What I'd build next: the multi-run stability signal first, since it's cheap and feeds directly
into the drift-detection story in §4, then a real approval gate so an unattended replay in
"production" requires a capability explicitly marked approved rather than merely present on disk.
