# AtlasMind — system card

**This is a system card, not a model card, and the distinction is the first
thing worth stating.** AtlasMind trains no model, fine-tunes no model, and ships
no weights. It is an orchestrator: it decides which third-party model should
answer a given request, assembles the context that model sees, and gates what
happens to the answer. So the questions a model card answers — training data,
evaluation benchmarks, bias measurements on a learned artifact — have no subject
here. The questions that *do* apply are about routing, context, and authority,
and those are below.

Under the EU AI Act's vocabulary AtlasMind is a **deployer** of general-purpose
models rather than a provider of one. If you are using AtlasMind inside a
regulated product, your own system is the thing being assessed; this card
describes the component, not your use of it.

- **Version:** see `package.json`. This card is reviewed with each minor release.
- **Owner:** Joel Bondoux.
- **Repository:** https://github.com/JoelBondoux/AtlasMind

---

## What it does

AtlasMind is a VS Code extension that coordinates multiple AI agents against a
software project. Given a request in plain English it selects a specialist
agent, selects a model, retrieves relevant project memory, runs the work, and
reports what changed and what it cost.

**Intended users:** software developers and small teams working on code they own
or are authorised to change.

**Intended use:** assisting with software development tasks — writing and
reviewing code, planning work, maintaining project documentation and records.

**Out of scope.** AtlasMind is not built for, and should not be relied on for,
any decision about a person: hiring, credit, insurance, benefits, medical advice,
legal advice, or anything else where a wrong answer lands on somebody rather than
on a codebase. It has no fairness tooling because it makes no such decisions, and
adding a fairness metric to a code assistant would be a claim rather than a
control.

---

## Which models it uses

AtlasMind holds no models of its own. It routes to whatever the user has
connected — Anthropic, OpenAI, Google, Azure OpenAI, Amazon Bedrock, DeepSeek,
Mistral, z.ai, GitHub Copilot, subscription-backed agents over ACP, or a local
runtime such as Ollama or LM Studio.

The routing decision is documented in [`docs/model-routing.md`](docs/model-routing.md).
Two properties of it are worth stating here:

- **It responds to stated requirements, not to preference.** Budget, speed and
  required capabilities drive the choice. A model that lacks a required
  capability is never selected — the router refuses to route rather than
  substituting something approximate.
- **It is deterministic.** The same request with the same providers available
  produces the same choice, so cost and quality can be reasoned about.

**The model provider sees your prompt.** Which provider, and what that provider
does with it, is recorded per provider in
[`src/core/providerDataGovernance.ts`](src/core/providerDataGovernance.ts) —
retention period, whether the provider trains on API data by default, and where
to send a data-subject request. A provider whose terms are not recorded is
reported as an unassessed sub-processor on the Testing dashboard.

---

## Human oversight

The oversight mechanism is approval, and it is on by default.

- **Tool use is gated.** Writes, terminal commands, network calls and
  destructive actions require approval. The mode is configurable
  (`atlasmind.tools.approvalMode`); every mode gates writes.
- **Outward-facing actions confirm separately.** Filing an issue, posting a
  comment, promoting to production and sending a message each require an
  explicit confirmation naming what will happen and where.
- **Production is deny-by-default.** Promotion is blocked until the backups and
  approvals the project declared are actually present.
- **Autonomous runs are bounded.** Mission Loop runs stop at limits the user
  sets: spend, duration, attempt count, and declared stop conditions.

Nothing in AtlasMind escalates its own permissions. A delegated agent runs with
the *intersection* of the caller's and the target's capabilities, never the
union — otherwise any restricted agent could obtain any capability by asking a
permissive one.

---

## Known limitations

- **Model output is not verified by AtlasMind.** Configured checks run after
  changes and a run cannot report success while its own verification failed, but
  a passing check is not proof the change was correct.
- **Retrieval is heuristic.** Project memory is selected by relevance scoring.
  Relevant context can be missed.
- **Redaction is pattern-based.** The secret redactor catches known shapes; a
  novel credential format can pass it. It does not scan the user's own typed
  prompt, which they wrote deliberately.
- **Cost figures are estimates** for pay-per-token providers, derived from
  reported token counts and a price table that can lag a vendor change.
- **Compliance automation covers fragments.** The Testing dashboard verifies
  parts of some governance controls against the stack. It does not assess a
  regime, and a verified fragment is not a satisfied control.

---

## Reporting a problem

Security issues: see [`SECURITY.md`](SECURITY.md). That route covers AI-specific
failures too — a prompt injection that reached a tool, a redaction that missed, a
guardrail that did not hold.

Everything else: GitHub issues.

---

## Evidence behind the claims here

| Claim | Where it is enforced |
|---|---|
| Untrusted text cannot become an instruction | `tests/guardrail.test.ts` |
| A delegate cannot exceed the caller's authority | `tests/agent-collaboration.test.ts` |
| Secrets are redacted before a model sees them | `tests/ai-data-policy.test.ts` |
| Personal data is classified and gated | `tests/gdpr.privacy.test.ts` |
| The router honours hard capability requirements | `tests/model-routing.test.ts` |
| Prompts do not change without review | `tests/prompt-regression/` |
| Governance controls are checked against the stack | `tests/core/complianceTechnicalControls.test.ts` |
