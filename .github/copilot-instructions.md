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
| `wiki/Comparison.md` | Feature comparison table |
| `wiki/Changelog.md` | `CHANGELOG.md` highlights |
| `wiki/_Sidebar.md` | Wiki navigation sidebar |

<!-- atlasmind:testing-protocols:start -->
## Testing Protocols (managed by AtlasMind)

> Auto-generated from `project_memory/index/testing-config.json`. Do not edit by hand —
> changes are overwritten on the next sync. Update the matrix in the AtlasMind Settings → Testing page instead.

This project enforces **13** testing methodologies. When writing or verifying tests, follow the applicable protocols below and report the checks, assertions, or verification artifacts you produced before concluding.

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

### ATDD

- **What:** Acceptance Test-Driven Development — customer-facing criteria first
- **When to apply:** When the delivery team works directly from customer acceptance criteria. Bridges the gap between BDD storytelling and executable acceptance tests.
- **Key tools:** Robot Framework, FitNesse, Cucumber, SpecFlow, Gauge
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

### White-Box

- **What:** Structure-aware testing — code paths, branches, and conditions guided by internal knowledge
- **When to apply:** Security-sensitive modules, complex algorithms, and codebases where path or branch coverage is a compliance requirement (DO-178C, IEC 61508). Augments unit tests with precise coverage metrics to identify dead code and untested logic.
- **Key tools:** Istanbul / nyc (JS/TS), coverage.py, JaCoCo (Java/Kotlin), gcov / lcov (C/C++), LLVM coverage, SonarQube, Codecov, Coveralls
- **Primary owner:** Test Developer

### End-to-End

- **What:** Full user-flow simulation (Playwright, Cypress, etc.)
- **When to apply:** Web and mobile applications with critical user journeys (checkout, login, onboarding). High confidence at the cost of speed.
- **Key tools:** Playwright, Cypress, Puppeteer, WebdriverIO, Detox (mobile), Appium
- **Primary owner:** Test Developer

### Contract

- **What:** Consumer-driven API contract verification (Pact)
- **When to apply:** Microservice architectures where multiple teams own their own services. Consumers write the contract; providers verify it — eliminating integration environment dependency.
- **Key tools:** Pact (JS, Java, Go, .NET, Ruby, Python), Spring Cloud Contract, Dredd
- **Primary owner:** Test Developer

### Model-Based (MBT)

- **What:** Derive test cases from formal system models — state machines, UML diagrams, decision tables
- **When to apply:** Complex systems with many state transitions: embedded software, protocol implementations, workflow engines, and telecom or automotive stacks. MBT generates optimised test suites that cover the model more completely than hand-authored cases.
- **Key tools:** GraphWalker, TestOptimal, Conformiq, MBTsuite, Selenium + custom state model wrappers
- **Primary owner:** Test Developer

### Performance

- **What:** Load, stress, and latency benchmarks (k6, Artillery, JMeter)
- **When to apply:** APIs, real-time systems, or any application with SLA targets. Run before a major release or infrastructure change to validate throughput and latency under load.
- **Key tools:** k6, Artillery, Apache JMeter, Gatling, Locust, autocannon, wrk
- **Primary owner:** Test Developer

### Security

- **What:** SAST / DAST and dependency vulnerability scanning
- **When to apply:** Any application handling authentication, payments, PII, or sensitive data. Should be part of CI for all production software.
- **Key tools:** Snyk, OWASP ZAP, Semgrep, Trivy, CodeQL, Dependabot, npm audit, OWASP Dependency-Check
- **Primary owner:** Test Developer

<!-- atlasmind:source-digest:47711aebd82c3099 -->
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

The operator's ceiling is `auto`. A stage asking for more than that gets the ceiling, and the levels below already have it applied — they are what is actually permitted.

| Stage | Permitted | What that means for you |
|---|---|---|
| Planning & issue intake | `observe` | Report what you find. Do not create, modify or close anything. |
| Branch creation & naming | `observe` | Report what you find. Do not create, modify or close anything. |
| Local development | `observe` | Report what you find. Do not create, modify or close anything. |
| Pull requests & review | `observe` | Report what you find. Do not create, modify or close anything. |
| CI & failure analysis | `observe` | Report what you find. Do not create, modify or close anything. |
| Release | `observe` | Report what you find. Do not create, modify or close anything. |

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


<!-- atlasmind:source-digest:22fb7e16dd0950ff -->
<!-- atlasmind:workflow:end -->
