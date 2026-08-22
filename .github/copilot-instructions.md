# AtlasMind — Copilot Instructions

You are working on **AtlasMind**, a VS Code extension that provides a multi-agent orchestrator with model routing, long-term memory (SSOT), and a skills registry.

## Critical Rules

### Safety-First Principle
- AtlasMind defaults to the safest reasonable behavior, not the most permissive one.
- Treat every boundary as untrusted: chat input, webview messages, workspace files, model output, and tool parameters.
- Validate before executing, redact before sending, confirm before destructive changes, and deny by default when behavior is ambiguous.
- Security-sensitive regressions are treated as correctness bugs, not polish items.

### Documentation Maintenance
When you make **any** of the following changes, you **MUST** update the corresponding documentation:

| Change | Files to update |
|---|---|
| Add/remove/rename a source file | `README.md` (Project Structure), `docs/architecture.md` (Dependency Graph), `docs/development.md` (Project Structure), `wiki/Architecture.md` |
| Add/modify a command | `README.md` (Extension Commands), `package.json`, `wiki/Chat-Commands.md` |
| Add/modify a chat slash command | `README.md` (Slash Commands), `package.json`, `wiki/Chat-Commands.md` |
| Add/modify a configuration setting | `README.md` (Configuration), `package.json`, `docs/configuration.md`, `wiki/Configuration.md` |
| Add/modify a type in `types.ts` | `docs/architecture.md` (Key Interfaces), `wiki/Architecture.md` |
| Add/modify an agent-related feature | `docs/agents-and-skills.md`, `wiki/Agents.md` |
| Add/modify a skill | `docs/agents-and-skills.md`, `wiki/Skills.md` |
| Add/modify the model router | `docs/model-routing.md`, `wiki/Model-Routing.md` |
| Add/modify a provider adapter | `docs/model-routing.md`, `CONTRIBUTING.md`, `wiki/Model-Routing.md` |
| Add/modify the SSOT/memory system | `docs/ssot-memory.md`, `wiki/Memory-System.md` |
| Add/modify webview panels | `docs/development.md` (Webview Development), `wiki/Architecture.md` |
| Add/modify tree views | `README.md`, `docs/architecture.md`, `wiki/Architecture.md` |
| Change build config or dependencies | `docs/development.md`, `README.md` (Quick Start), `wiki/Contributing.md` |
| Ship a new version | `CHANGELOG.md`, `package.json` (version), `README.md` (version banner), `wiki/Changelog.md` |
| Add/modify tool approval or safety | `wiki/Tool-Execution.md`, `wiki/Security.md` |
| Add/modify project planner or scheduler | `wiki/Project-Planner.md` |

### Version Tracking
- Version is in `package.json` → `"version"`.
- Current version: see `package.json` → `"version"`.
- Every commit (not just PRs) must include a version bump in `package.json` using SemVer.
- Every version bump must include a matching `CHANGELOG.md` entry in the same commit.
- The README version banner must always match `package.json`.
- When release notes or user-facing docs change, update `README.md` and the matching wiki pages in the same commit.
- This applies to all code, doc, and config changes. The version bump and changelog update must be in the same commit as the change.
- Never remove the `# Changelog` title or its Keep a Changelog preamble; new release notes must be appended beneath that header.
- Use [Semantic Versioning](https://semver.org/):
  - **PATCH** (0.0.x): bug fixes, docs, refactors.
  - **MINOR** (0.x.0): new features, new commands, new UI.
  - **MAJOR** (x.0.0): breaking changes to config, agent definitions, or memory format.

## Architecture Awareness

### Entry Point
- `src/extension.ts` — `activate()` creates all core services and registers commands/views.
- Services are bundled into `AtlasMindContext` and passed to all registrations.

### Core Services
| Service | File | Purpose |
|---|---|---|
| `Orchestrator` | `src/core/orchestrator.ts` | Task routing: select agent → gather memory → pick model → execute → record cost |
| `AgentRegistry` | `src/core/agentRegistry.ts` | CRUD for `AgentDefinition` objects |
| `SkillsRegistry` | `src/core/skillsRegistry.ts` | CRUD for `SkillDefinition` objects + agent-skill resolution |
| `ModelRouter` | `src/core/modelRouter.ts` | Budget/speed-aware model selection |
| `CostTracker` | `src/core/costTracker.ts` | Per-session cost accumulation |
| `MemoryManager` | `src/memory/memoryManager.ts` | SSOT folder read/write/search |
| `CurrencyFormatter` | `src/core/currencyFormatter.ts` | Locale-aware cost formatting with live exchange rates |
| `CopilotMultiplierSync` | `src/providers/copilotMultiplierSync.ts` | Syncs Copilot premium-request multipliers from GitHub docs |
| `LocalModelSync` | `src/providers/localModelSync.ts` | Queries Ollama/LM Studio for live local model metadata |
| `TaskProfiler` | `src/core/taskProfiler.ts` | Infers task complexity profile for routing |
| `CheckpointManager` | `src/core/checkpointManager.ts` | Conversation checkpoint save/restore |
| `ProjectRunHistory` | `src/core/projectRunHistory.ts` | Persists per-project task run records |
| `SkillScanner` | `src/core/skillScanner.ts` | Auto-discovers workspace tool definitions |
| `ProviderRegistry` | `src/providers/index.ts` | Maps provider IDs to adapter instances |
| `McpServerRegistry` | `src/mcp/mcpServerRegistry.ts` | Manages MCP server connections and tool dispatch |

### UI Surfaces
| Surface | File | Description |
|---|---|---|
| `@atlas` chat participant | `src/chat/participant.ts` | Chat bar with slash commands |
| Sidebar tree views | `src/views/treeViews.ts` | Agents, Skills, Memory, Models trees |
| Model Provider panel | `src/views/modelProviderPanel.ts` | API key management and quota display webview |
| Settings panel | `src/views/settingsPanel.ts` | Budget/speed sliders webview |
| Cost Dashboard panel | `src/views/costDashboardPanel.ts` | Per-session and per-model cost breakdown |
| Project Run Center panel | `src/views/projectRunCenterPanel.ts` | Task run history and checkpoint browser |
| Agent Editor panel | `src/views/agentEditorPanel.ts` | Create/edit agent definitions |
| Skill Editor panel | `src/views/skillEditorPanel.ts` | Create/edit skill definitions |
| Memory Browser panel | `src/views/memoryBrowserPanel.ts` | Browse and edit SSOT memory entries |
| Personality Profile panel | `src/views/personalityProfilePanel.ts` | Agent personality configuration |
| Project Planner panel | `src/views/projectPlannerPanel.ts` | Multi-step project planning UI |
| Status bar items | `src/extension.ts` | Provider health, cost, and model indicators |

### Type System
- All shared interfaces live in `src/types.ts`.
- Provider adapters are defined in `src/providers/adapter.ts`.
- Never duplicate type definitions across files.

## Coding Standards

### TypeScript
- **Strict mode** is enabled — no implicit `any`.
- Use `.js` extension on **all** relative imports (Node16 module resolution).
- Prefer `type` imports for types only used in type positions.
- One class per file for core services.

### Security
- API keys go in VS Code `SecretStorage`, never in settings or source.
- Webview HTML must use `escapeHtml()` from `webviewUtils.ts`.
- Webview scripts must be nonce-protected; do not use inline event handlers like `onclick`.
- All webview messages must be validated before mutating configuration, touching secrets, or invoking commands.
- File-system features must reject path traversal and default to non-destructive behavior.
- Memory retrieval and model execution must preserve a redaction boundary for secrets and sensitive project data.

### Branching
- **`develop`** is the default branch for all implementation work and the normal push target.
- **`main`** is protected — updated only by intentional Marketplace release promotion from `develop`.
- Never push directly to `main`. Always push to `origin/develop`.
- Feature PRs target `develop`. `develop` → `main` is the release promotion, not a feature PR.
- The workflow is specified in `docs/guided-github-workflow.md`; this repository's values are in `docs/github-workflow.md`.

### Publishing Routine
The release is **Actions-driven**. When asked to publish or ship a release, follow these steps in order:

1. **Commit** all changes to the current working branch with a conventional commit message and version bump.
2. **Merge to `develop`**: `git checkout develop && git pull origin develop && git merge <branch> --no-ff && git push origin develop`
3. **Compile**: `npm run compile` — must produce zero TypeScript errors.
4. **Package**: `npm run package` — produces `atlasmind-<version>.vsix`.
5. **Open the release PR**: trigger the `Release — promote develop to main` workflow from the Actions tab; it creates the `develop` → `main` PR and enables squash auto-merge. Never force-push.
6. **Wait for the PR to merge** into `main` with CI green.
7. **Tag**: `npm run tag:release` — pushes `v<version>`, which triggers CI to publish to the Marketplace and create the GitHub Release.

**Do not run `npm run publish:release` for a normal release** — it publishes *and* pushes the tag, and the tag push makes CI publish again, failing on "version already exists". Reserve it for an emergency local publish.

### Commits
- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- Include doc updates in the same commit as the code change.
- Include an appropriate SemVer version bump in `package.json` and a matching `CHANGELOG.md` entry in every commit.

## SSOT Memory Folders
```
project_memory/
  project_soul.md, architecture/, roadmap/, decisions/, misadventures/,
  ideas/, domain/, operations/, agents/, skills/, index/
```
Defined as `SSOT_FOLDERS` in `src/types.ts`.

## Documentation Files
| File | Contents |
|---|---|
| `README.md` | User-facing overview, commands, config, structure |
| `CHANGELOG.md` | Version history in Keep a Changelog format |
| `CONTRIBUTING.md` | Dev setup, conventions, how to add providers/agents/skills |
| `docs/architecture.md` | System diagram, activation flow, data flow, dependency graph |
| `docs/model-routing.md` | Routing algorithm, budget/speed modes, provider list |
| `docs/ssot-memory.md` | SSOT folder details, retrieval, bootstrapping, security |
| `docs/agents-and-skills.md` | Agent and skill definitions, selection, context bundles |
| `docs/development.md` | Build, lint, run, test, package, TypeScript conventions |

## Wiki Pages (`wiki/`)

The GitHub Wiki is published from the `wiki/` directory. When any docs-level change is made, the corresponding wiki page **must** also be updated and pushed to the wiki repo.

| Wiki Page | Mirrors |
|---|---|
| `wiki/Home.md` | Project overview, navigation |
| `wiki/Getting-Started.md` | Installation, first steps |
| `wiki/Architecture.md` | `docs/architecture.md` |
| `wiki/Chat-Commands.md` | Slash commands and extension commands from `README.md` / `package.json` |
| `wiki/Agents.md` | Agent features from `docs/agents-and-skills.md` |
| `wiki/Skills.md` | Skill features from `docs/agents-and-skills.md` |
| `wiki/Model-Routing.md` | `docs/model-routing.md` |
| `wiki/Memory-System.md` | `docs/ssot-memory.md` |
| `wiki/Project-Planner.md` | Planner, scheduler, run history |
| `wiki/Tool-Execution.md` | Approval, safety, webhooks |
| `wiki/Configuration.md` | All `atlasmind.*` settings from `package.json` |
| `wiki/Security.md` | Security boundaries, threat model |
| `wiki/Contributing.md` | `CONTRIBUTING.md` |
| `wiki/FAQ.md` | Troubleshooting, common questions |
| `wiki/Changelog.md` | `CHANGELOG.md` highlights |
| `wiki/_Sidebar.md` | Wiki navigation sidebar |

<!-- atlasmind:testing-protocols:start -->
## Testing Protocols (managed by AtlasMind)

> Auto-generated from `project_memory/index/testing-config.json`. Do not edit by hand —
> changes are overwritten on the next sync. Update the matrix in the AtlasMind Settings → Testing page instead.

This project enforces **29** testing methodologies. When writing or verifying tests, follow the applicable protocols below and report the checks, assertions, or verification artifacts you produced before concluding.

### TDD

- **What:** Test-Driven Development — red-green-refactor loop
- **When to apply:** Any project where correctness matters and requirements can be expressed as assertions before the code is written. Especially valuable for greenfield features and critical business logic.
- **Key tools:** Jest, Vitest, Mocha, pytest, JUnit, RSpec, Go testing
- **Primary owner:** Test Developer

### BDD

- **What:** Behavior-Driven Development — Gherkin / Given-When-Then specs
- **When to apply:** Projects with a non-technical product owner or QA team who needs to co-author acceptance criteria. Works best when requirements arrive as user stories.
- **Key tools:** Cucumber, SpecFlow, Behave, Gherkin, Codecept, Playwright BDD plugin
- **Primary owner:** Test Developer

### Unit Testing

- **What:** Isolated function and class-level tests
- **When to apply:** All projects. Start here. Fast, cheap, and gives precise regression signals. Should be the largest layer of your test pyramid.
- **Key tools:** Jest, Vitest, Mocha, pytest, JUnit, NUnit, xUnit, Go testing, Minitest
- **Primary owner:** Test Developer

### Mutation Testing

- **What:** Fault injection to measure suite kill-rate (Stryker, Pitest)
- **When to apply:** Mature suites where you want to measure test quality, not just quantity. Excellent for libraries and shared utilities where coverage alone is misleading.
- **Key tools:** Stryker Mutator (JS/TS/C#), Pitest (Java/Kotlin), mutmut (Python), Infection (PHP)
- **Primary owner:** Test Developer

### Property-Based

- **What:** Generative input testing (fast-check, Hypothesis)
- **When to apply:** Pure functions, parsers, data transformers, and algorithmic code. Generates hundreds of random inputs to find edge cases no human would enumerate.
- **Key tools:** fast-check (JS/TS), Hypothesis (Python), QuickCheck (Haskell/Erlang), jqwik (Java), gopter (Go)
- **Primary owner:** Test Developer

### Continuous / Shift-Left

- **What:** Automated testing embedded throughout CI/CD — tests run on every commit, earliest possible feedback
- **When to apply:** Any project with a CI/CD pipeline. Essential for teams delivering frequent releases or practising trunk-based development. Shift-left means pushing tests earlier: linting, type checks, and unit tests on pre-commit; integration and E2E on PR; performance and security on merge.
- **Key tools:** GitHub Actions, GitLab CI, Jenkins, CircleCI, Azure DevOps, Buildkite, Husky / pre-commit hooks, Test Impact Analysis (Vitest, Jest)
- **Primary owner:** Test Developer

### Security

- **What:** SAST / DAST and dependency vulnerability scanning
- **When to apply:** Any application handling authentication, payments, PII, or sensitive data. Should be part of CI for all production software.
- **Key tools:** Snyk, OWASP ZAP, Semgrep, Trivy, CodeQL, Dependabot, npm audit, OWASP Dependency-Check
- **Primary owner:** Test Developer

### Exploratory

- **What:** Session-based manual discovery and charter testing
- **When to apply:** New features, usability-sensitive workflows, and any area where automation has not yet caught up. Pairs well with a formal charter to keep sessions focused.
- **Key tools:** Session-based testing charters, TestRail, Zephyr, Xray, Notion test logs, PractiTest
- **Primary owner:** Test Developer

### Dead-Field / Dead-Prop Detection

- **What:** Finds declared fields, props and config keys that nothing ever reads
- **When to apply:** Codebases where types, props or configuration have accumulated over several refactors. A field that is written but never read is a bug wearing a feature's clothes — the code that was supposed to consume it was renamed, moved, or never written.
- **Key tools:** ts-prune, knip, ts-unused-exports, eslint no-unused-vars, Vulture (Python), deadcode (Go), cargo-udeps (Rust)
- **Primary owner:** Test Developer

### Type Drift Detection

- **What:** Checks that static types still describe what actually arrives at runtime
- **When to apply:** Any TypeScript or typed-Python project consuming external JSON — an API response, a config file, a database row. The compiler checks the *assertion*, not the data, so a backend that renamed a field keeps compiling and fails in production.
- **Key tools:** Zod, Valibot, io-ts, ArkType, typia, Pydantic, attrs + cattrs, quicktype (schema → type generation)
- **Primary owner:** Test Developer

### Cross-Surface Property Parity

- **What:** Asserts the same rule produces the same answer on every surface that states it
- **When to apply:** Products where one fact is displayed in several places — a CLI and a web UI, a dashboard card and the detail page it links to, an API and the SDK wrapping it. The failure this catches is two surfaces disagreeing about the same number, which reads as a data bug and is really a duplicated rule.
- **Key tools:** Shared fixture suites, Vitest/Jest table-driven tests, golden files, contract-style shared assertions, Playwright + API cross-checks
- **Primary owner:** Test Developer

### Cross-Representation Consistency

- **What:** Asserts a value survives every round trip between its representations
- **When to apply:** Anywhere one value has several forms — JSON and a database row, a domain object and its DTO, markdown and its parsed AST, a display string and the number behind it. Serialization asymmetry is the classic silent corruption: it writes fine, reads back subtly different, and nothing fails until much later.
- **Key tools:** fast-check / Hypothesis round-trip properties, snapshot fixtures, JSON Schema validation, protobuf/Avro conformance suites
- **Primary owner:** Test Developer

### Semantic Constraint Testing

- **What:** Asserts domain invariants that types allow but the domain forbids
- **When to apply:** Domains with rules the type system cannot express — an end date after its start, a total matching the sum of its parts, a state machine that never reaches a terminal state twice. The type says `Date`; the domain says "not before the other one".
- **Key tools:** Zod refinements, class-validator, Pydantic validators, database CHECK constraints, fast-check preconditions, invariant assertions in domain models
- **Primary owner:** Test Developer

### Output Schema Drift Detection

- **What:** Detects when produced output stops matching its own published schema
- **When to apply:** Any producer with consumers it cannot see — a public API, an event stream, a webhook, a structured LLM response, an exported report. The producer's tests pass because they were updated alongside it; the consumer breaks because it was not.
- **Key tools:** JSON Schema / Ajv, OpenAPI response validation, oasdiff, Avro/protobuf schema registry compatibility checks, Zod parse on output, Great Expectations for tabular output
- **Primary owner:** Test Developer

### Hallucination Detection

- **What:** Checks that model-stated facts are grounded in the sources actually provided
- **When to apply:** Any feature where a model states facts a user will act on — RAG answers, summarisation, extraction, citations. A fluent, specific, entirely invented answer is indistinguishable from a correct one to every assertion except one that checks it against the source.
- **Key tools:** RAGAS (faithfulness/groundedness), DeepEval, TruLens, Promptfoo assertions, LLM-as-judge with a citation requirement, entity overlap against source, Anthropic/OpenAI evals
- **Primary owner:** Test Developer

### Accessibility (a11y)

- **What:** Automated and manual checks against WCAG success criteria
- **When to apply:** Every product with a user interface, and a legal requirement for public sector, education, and increasingly commercial software (EAA, ADA, Section 508). Automated tooling reliably catches roughly a third of WCAG issues, which makes it necessary and not sufficient.
- **Key tools:** axe-core, @axe-core/playwright, jest-axe, Pa11y, Lighthouse, WAVE, eslint-plugin-jsx-a11y, screen readers (NVDA, VoiceOver, JAWS) for the manual half
- **Primary owner:** Test Developer

### Memory / State Drift Detection

- **What:** Detects when persisted state stops matching what the code believes it holds
- **When to apply:** Long-lived stores written by successive versions — agent memory, user preferences, caches, session documents, event-sourced aggregates. The document on disk was written by a build that no longer exists, and the reader assumes a shape nobody re-checked.
- **Key tools:** Versioned document schemas with migration ladders, Zod/Pydantic parse-on-read, snapshot corpora of historical documents, replay tests over an event log
- **Primary owner:** Test Developer

### Prompt Regression

- **What:** Replays a graded case set so a prompt edit cannot silently degrade quality
- **When to apply:** Any product with a prompt in it. Prompts are edited like prose and deployed like code, with no equivalent of a failing build — a wording change that fixes one case and breaks nine is invisible without a replay set.
- **Key tools:** Promptfoo, Braintrust, LangSmith, DeepEval, OpenAI Evals, Anthropic evals, Vitest + recorded fixtures with an LLM judge

### Model Routing Correctness

- **What:** Asserts the router picks the model the policy says it should, and fails over correctly
- **When to apply:** Any system choosing between models on cost, capability, latency or availability. A router silently sending every request to the most expensive model still returns correct answers — the bug is only visible on the invoice, and only weeks later.
- **Key tools:** Table-driven tests over the routing function, fake provider adapters, budget-ceiling assertions, failover simulation with injected provider errors, cost-per-route snapshot tests

### Guardrail Enforcement

- **What:** Tests that safety policies actually refuse, including under adversarial input
- **When to apply:** Any model-backed feature reachable by untrusted input. A guardrail is written once, believed permanently, and bypassed by the first prompt injection nobody tried — a policy without a test is a comment.
- **Key tools:** Promptfoo red-team plugins, Garak, PyRIT, NeMo Guardrails test suites, Llama Guard, Rebuff, adversarial case corpora, refusal assertions
- **Primary owner:** Test Developer

### Agent Collaboration Correctness

- **What:** Tests hand-offs, delegation limits, and that agents share no authority they should not
- **When to apply:** Multi-agent systems with delegation, sub-tasks, or tool sharing. The failure mode is authority accumulating across a hand-off — a restricted agent obtaining a capability by asking a permissive one — which every individual agent test passes.
- **Key tools:** Deterministic fake agents, hand-off depth/cycle assertions, permission-intersection property tests, transcript replay, LangGraph/CrewAI test harnesses, trace assertions
- **Primary owner:** Test Developer

### ISO/IEC 27001 Controls

- **What:** Maps Annex A controls to the evidence that demonstrates each one
- **When to apply:** Organisations certified or seeking certification, and any vendor whose enterprise customers ask for it in procurement. The certification is organisational, but a meaningful share of Annex A lands on the codebase — access control, cryptography, logging, secure development.
- **Key tools:** Control-mapping registers, Vanta, Drata, Secureframe, evidence-collection automation, internal audit checklists, Statement of Applicability

### SOC 2 Type I/II

- **What:** Checks Trust Services Criteria are met and, for Type II, evidenced over time
- **When to apply:** SaaS vendors selling to enterprises. Type I asks whether controls are designed correctly at a point in time; Type II asks whether they operated continuously over a period — which makes *evidence continuity* the thing to test, not just control existence.
- **Key tools:** Vanta, Drata, Secureframe, Tugboat Logic, CI evidence exports, access-review automation, change-management logs

### GDPR Data Handling

- **What:** Tests lawful basis, minimisation, subject rights, and deletion actually work
- **When to apply:** Any product processing personal data of people in the EU or UK, regardless of where the company is. Several obligations are genuinely executable — a deletion request that leaves rows in a backup index, or an export missing a data category, is a testable defect.
- **Key tools:** Data-flow mapping / RoPA, deletion-completeness tests across every store, export-completeness assertions, consent-state tests, retention-window checks, pseudonymisation verification

### Change-Management Compliance

- **What:** Tests that changes reached production through the approvals the policy requires
- **When to apply:** Regulated environments and any organisation asserting a change process to an auditor. Almost entirely checkable from repository and CI metadata — protected branches, required reviews, linked tickets, deployment approvals — which makes it the cheapest compliance policy to automate.
- **Key tools:** Branch-protection API assertions, required-review checks, CODEOWNERS verification, deployment-approval gates, commit-to-ticket traceability, git history analysis
- **Primary owner:** Test Developer

### AI Safety & Guardrail Compliance

- **What:** Evidences that declared AI safety commitments are implemented and enforced
- **When to apply:** Products making public safety claims, and anything in scope of the EU AI Act's obligations for high-risk or general-purpose systems. Distinct from guardrail *testing*: this asks whether the declared policy, the implementation, and the evidence agree.
- **Key tools:** EU AI Act conformity checklists, NIST AI RMF mapping, model cards, system cards, guardrail-policy registers, incident-reporting procedures, red-team evidence retention
- **Primary owner:** Test Developer

### Model-Output Risk Classification

- **What:** Tests that outputs are classified by risk and that the classification drives handling
- **When to apply:** Products where some model outputs need different treatment — human review, a disclaimer, a refusal, or a log. A classifier that is never tested tends toward one class, which silently removes the review step it exists to trigger.
- **Key tools:** Labelled risk corpora, confusion-matrix assertions, threshold calibration tests, Llama Guard / moderation-endpoint evaluation, escalation-path tests, anti-uniformity checks on classifier output
- **Primary owner:** Test Developer

### Explainability & Transparency

- **What:** Tests that a decision can be explained to the person it affects
- **When to apply:** Automated decisions with legal or significant effect — GDPR Article 22, the EU AI Act, and sector rules like ECOA adverse-action notices all require a meaningful explanation. The test is that the explanation is faithful to the decision, not merely that one is produced.
- **Key tools:** SHAP, LIME, captum, counterfactual explanation generators, faithfulness/consistency assertions, model cards, decision-log inspection, reason-code verification
- **Primary owner:** Test Developer

### AI Memory & Data-Use Policy

- **What:** Tests that what the system remembers and sends matches what was promised
- **When to apply:** Any AI product with memory, retrieval, or training feedback loops. Two commitments are routinely stated and rarely tested: that customer data does not train a model, and that a secret or another tenant's data never reaches a prompt.
- **Key tools:** Redaction-boundary tests, prompt-payload inspection, tenant-isolation tests over retrieval, training-opt-out verification, memory-retention window tests, provider zero-retention configuration checks
- **Primary owner:** Test Developer

<!-- atlasmind:source-digest:37ef1eb421aeb50d -->
<!-- atlasmind:testing-protocols:end -->

<!-- atlasmind:debt-markers:start -->
## Technical debt markers

When you leave temporary code, a shortcut, or a deferred decision behind, mark it with a
comment beginning with one of these. AtlasMind scans for them and records each one with its
file, its line, and the rule that graded it — anything marked another way is invisible, and an
empty register then reads as "no debt" rather than "not detected".

- `TODO:` — something absent. Graded low.
- `FIXME:` — something wrong. Graded medium.
- `HACK:` / `XXX:` — works, but not the way it should. Graded medium.

The marker must be the first word of the comment: `// TODO: replace this` is recorded,
`// a TODO for later` is not. A marker mentioning a credential, a token or sanitising is
graded high whichever word you used.

<!-- atlasmind:debt-markers:end -->

<!-- atlasmind:workflow:start -->
## GitHub workflow (managed by AtlasMind)

> Auto-generated from `project_memory/operations/workflow.json`. Do not edit by hand —
> changes are overwritten on the next sync. Edit the workflow file, or the Workflow page.

This repository follows a declared GitHub workflow. It is recorded in
`project_memory/operations/workflow.json` and is the authority for the rules below —
if this block and that file disagree, the file wins and this block is stale.

These rules apply to **you**, whichever tool you are. AtlasMind cannot gate a process it
does not run, so nothing here is enforced by machinery on your side: it is enforced by you
reading it. Where a rule and convenience conflict, follow the rule and say that you did.

### Branches

- Integration branch (normal push target): `develop`
- Release branch: `main`
- **Protected — never push directly:** `main`, `master`, `production`, `prod`, `release`, `stable`, `development`. Reach these through a reviewed pull request only.
- New branches: `<type>/<issue>-<slug>`, at most 60 characters, type from `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`.

### How far you may go, by stage

The operator's ceiling is `propose`. A stage asking for more than that gets the ceiling, and the levels below already have it applied — they are what is actually permitted.

| Stage | Permitted | What that means for you |
|---|---|---|
| Planning & issue intake | `observe` | Report what you find. Do not create, modify or close anything. |
| Branch creation & naming | `propose` | Open it for review and wait for a human decision before it lands. |
| Local development | `propose` | Open it for review and wait for a human decision before it lands. |
| Pull requests & review | `observe` | Report what you find. Do not create, modify or close anything. |
| CI & failure analysis | `observe` | Report what you find. Do not create, modify or close anything. |
| Release | `observe` | Report what you find. Do not create, modify or close anything. |
| Maintenance & tech debt | `observe` | Report what you find. Do not create, modify or close anything. |
| Automation policy | `observe` | Report what you find. Do not create, modify or close anything. |

### Evidence a stage requires

Two different things, which must not stand in for each other: a **check** is a person saying
"I looked", and a **status check** is a machine saying "it passed". Do not report one as the other.

- **Planning & issue intake**
  - Human checks: _Acceptance criteria written_
- **Pull requests & review**
  - Human checks: _Self-reviewed the diff_, _Linked to an issue_, _Version bumped and changelog written_
  - CI that must be green: `CI`
- **CI & failure analysis**
  - CI that must be green: `CI`
- **Release**
  - Human checks: _Changelog entry written_, _Version bumped_, _README banner matches package.json_
  - CI that must be green: `CI`

### Labels

Use **only** these. A label that does not exist is *created* on the repository as a side
effect of applying it, so inventing one changes the project's taxonomy without asking.
Pick at most one from each category.

- **type:** `bug`, `enhancement`, `documentation`, `security`, `dependencies`, `workflow`

### Testing

Testing requirements are **not** duplicated here. They live in
`project_memory/index/testing-config.json` and are described in the testing-protocols block
of this same file. Follow those.


<!-- atlasmind:source-digest:c560b753ccbb3939 -->
<!-- atlasmind:workflow:end -->

<!-- atlasmind:shared-instructions:start -->
## Core Directives

- Safety-first by default for all generated outputs and tool use.
- Treat chat input, webview messages, workspace files, model output, and tool parameters as untrusted.
- Validate before execution; redact before sending anything externally.
- Confirm before destructive actions; deny by default if behavior is ambiguous.
- Treat security-sensitive regressions as correctness defects.

## Architecture and Coding Ground Rules
- Anchor service orchestration in `src/extension.ts` (`activate()` builds services and registers commands/views on `AtlasMindContext`).
- Keep shared interfaces in `src/types.ts`; do not duplicate type definitions elsewhere.
- Keep provider adapters in `src/providers/adapter.ts`.
- Keep architectural references aligned when services, surfaces, or bindings change.
- TypeScript must be strict; avoid implicit `any`.
- Use `.js` extension on all relative imports (Node16).
- Prefer type-only imports for type-only usage.
- Keep one class per core service file.
- Maintain API keys only in VS Code SecretStorage.
- Webview HTML must use `escapeHtml()`, nonce-protected scripts, and no inline event handlers.
- Validate webview messages before mutating config, touching secrets, or invoking commands.
- Filesystem operations must reject path traversal and remain non-destructive by default.
- Maintain redaction boundaries for memory retrieval and model execution.
- Technical debt markers must be comment-first-word only: `TODO:`, `FIXME:`, `HACK:`, `XXX:`.

## Release, Versioning, and Branching
- `package.json` is the version source of truth.
- Every commit must include a SemVer bump in `package.json` and a matching entry in `CHANGELOG.md` in the same commit.
- Keep `# Changelog` Keep-a-Changelog format and never remove its preamble.
- `README.md` version banner must match `package.json`.
- Use conventional commit prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- Routine implementation targets `develop`; never push directly to protected `main`.
- Release is Actions-driven: commit, merge to `develop`, run `npm run compile` and `npm run package`, open/execute promote `develop -> main` PR, wait for merge + CI, then run `npm run tag:release`.
- Normal publishing is tag-triggered after merge; `npm run publish:release` is emergency/local only.
- Release PR to `main` must use merge commit (never squash).
- CI publishing uses Entra + `marketplace` environment context and requires the existing identity verification path.

## Documentation Maintenance Contract
- If release notes or user-facing docs change, update `README.md` and the corresponding wiki pages in the same commit.
- If any listed change applies, update the mapped files in the same pass (or explicitly confirm unchanged):
  - Add/remove/rename source file: `README.md` (project structure), `docs/architecture.md`, `docs/development.md`, `wiki/Architecture.md`
  - VS Code command change: `README.md` (extension commands), `package.json`, `wiki/Chat-Commands.md`
  - Chat slash command change: `README.md` (slash commands), `package.json`, `wiki/Chat-Commands.md`
  - Config setting change: `README.md` (configuration), `package.json`, `docs/configuration.md`, `wiki/Configuration.md`
  - `types.ts` change: `docs/architecture.md`, `wiki/Architecture.md`
  - Core service change: `docs/architecture.md`, `wiki/Architecture.md`
  - Planner/task scheduler change: `docs/agents-and-skills.md`, `wiki/Project-Planner.md`, `wiki/Architecture.md`
  - Agent definition/routing logic change: `docs/agents-and-skills.md`, `wiki/Agents.md`
  - Skill or `builtinWorkspaceTools.ts` change: `docs/agents-and-skills.md`, `wiki/Skills.md`, plus `wiki/Project-Planner.md` where applicable
  - Model router change: `docs/model-routing.md`, `wiki/Model-Routing.md`
  - Provider adapter change: `docs/model-routing.md`, `CONTRIBUTING.md`, `wiki/Model-Routing.md`
  - SSOT/memory change: `docs/ssot-memory.md`, `wiki/Memory-System.md`
  - MCP registry/tools change: `docs/agents-and-skills.md`, `wiki/Skills.md`, `wiki/Architecture.md`
  - Tool approval / safety boundary change: `wiki/Tool-Execution.md`, `wiki/Security.md`, and `docs/agents-and-skills.md` when behavior changes
  - Webview panel change: `docs/development.md`, `wiki/Architecture.md`
  - Tree view change: `README.md`, `docs/architecture.md`, `wiki/Architecture.md`
  - Project routines or `/ship` change: `wiki/Project-Planner.md`, `wiki/Chat-Commands.md`
  - Build config/scripts/dependency change: `docs/development.md`, `README.md`, `wiki/Contributing.md`
  - Shipping a new version: `CHANGELOG.md`, `package.json`, `README.md`, `wiki/Changelog.md`
- Before reporting completion, verify every applicable documentation row was updated or explicitly confirmed unchanged.

## Workflow and Process
- Respect staged workflow ceilings (observe/auto/auto etc.); planning, PR/review, CI, release, maintenance, and automation policy must be `observe`.
- Use only repository labels: `bug`, `enhancement`, `documentation`, `security`, `dependencies`, `workflow` with at most one per category.
- Keep human checks separate from machine checks (`CI`).
- When workflow guidance exists in-repo, use that managed file as authoritative over copied mirrors.

## Testing and Communication
- Follow testing requirements from the repository workflow/protocol sources (testing config/protocol files), not ad-hoc assumptions.
- When addressing the User, include the phrase "The User".
<!-- atlasmind:shared-instructions:end -->
