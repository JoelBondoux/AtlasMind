# Agents

AtlasMind uses an agent-based architecture where specialised agents are selected by the orchestrator based on task relevance.

## How Agent Selection Works

Agent selection uses a multi-signal scoring pass over all enabled agents:

1. **Primary routing needs (dominant signal)**: If an agent declares `primaryRoutingNeeds` and the classifier detects a matching routing need, the agent receives +25 pts per match (LLM-classified) or +15 pts (regex fallback). This structural declaration reliably outweighs all other signals so the right specialist always wins when the domain is clear.
2. **Token overlap** across `id`, `name`, `role`, `description`, and skill metadata (system prompt is excluded to prevent verbose agents from false-matching through sheer token volume).
3. **Corpus routing need boost** (+6 per need): pattern-matches the agent's narrow header corpus (role, description, skills — no system prompt) against detected routing need heuristics.
4. **Workspace investigation boost**: investigation-ready agents score +5 when the request looks like a repo bug report.
5. **Tool boost**: agents with explicit skills score +2 when routing needs are detected.
6. **Generalist boost**: the default catch-all agent scores +1 when no routing needs were detected.
7. **Performance boost**: agents with a positive track record receive a small fractional bonus (success rate × 2).
8. The **highest-scoring agent** is selected; ties break alphabetically by name.
9. If no registered agent matches at all, AtlasMind synthesizes a specialist agent on the fly.
10. If synthesis is not appropriate, the **Default** agent handles the request.

## Built-in Agents

AtlasMind now ships a compact developer-focused built-in set for freeform routing:

| **ID** | **Name** | **Focus** |
|-------|-------|-------|
| `default` | Default Assistant | Catch-all fallback for general development tasks |
| `workspace-debugger` | Workspace Debugger | Repo-local bugs, regressions, root-cause analysis |
| `frontend-engineer` | Frontend Engineer | UI, layout, webview, and interaction work |
| `backend-engineer` | Backend Engineer | APIs, orchestration logic, data flow, and integrations |
| `code-reviewer` | Code Reviewer | Review, verification, regression risk, and test gaps |
| `security-reviewer` | Security Reviewer | Security gaps, runtime boundaries, auth, secret handling, and test-backed security coverage |
| `ethics-oversight` | Ethics Oversight | User harm, fairness and bias, consent, dark patterns, transparency, accessibility as an ethical duty. Read-only, advisory — never an ethics approval |
| `legal-oversight` | Legal Oversight | Dependency and third-party licence compatibility, IP, GDPR/CCPA, liability, terms of service, regulated data. Read-only, advisory — not a lawyer and not legal advice |
| `commercial-oversight` | Commercial Oversight | Monetisation and business viability, vendor cost and lock-in, contractual and customer obligations, competitor positioning, go-to-market impact. Read-only, advisory |
| `github-operator` | GitHub Operator | Evidence-backed pull requests, issues, CI diagnosis, branch/commit operations, and project-policy-aware releases |
| `ci-analyst` | CI Analyst | Explains a *classified* pipeline failure from its evidence lines and proposes the smallest fix. Never re-classifies (the rule table decided), never re-runs a job, never edits a pipeline definition |
| `release-manager` | Release Manager | Confirms the derived version matches the compatibility impact and that release notes stay the changelog verbatim. Never pushes, tags, or publishes |
| `refactorer` | Refactorer | Records deferred work with a file and line as evidence, severity from the declared rule rather than an impression. Records first, proposes second — never applies unrequested |
| `test-developer` | Test Developer | Unit, integration, E2E, and regression tests; coverage analysis; test-first delivery |
| `docs-writer` | Documentation Writer | README, API docs, JSDoc/TSDoc, wiki pages, guides, changelogs, and inline documentation |
| `performance-analyst` | Performance Analyst | CPU hot paths, memory leaks, slow queries, latency, throughput, and optimization |
| `devops-engineer` | DevOps Engineer | CI/CD pipelines, Dockerfiles, Compose, Kubernetes, Terraform/Bicep, and deployment configs |
| `dependency-manager` | Dependency Manager | npm/pip/cargo/yarn updates, vulnerability fixes, peer conflicts, and lockfile hygiene |
| `seo-specialist` | SEO Specialist | Evidence-backed technical SEO, structured data, content/AI discoverability, performance, and marketplace/repository/package listings |
| `ux-consultant` | UX Consultant | Accessible UX critique and implementation using the project's own design stack, content-driven responsive behavior, and complete interaction states; does not create graphic assets |
| `memory-agent` | Memory Agent | Background only — maintains session `context.md` and refreshes SSOT snippets. Configure `allowedModels` to use a local LLM. |

## Built-in Default Agent

| Field | Value |
|-------|-------|
| **ID** | `default` |
| **Name** | Default Assistant |
| **Role** | General assistant |
| **Description** | Fallback assistant for general development tasks |
| **System Prompt** | Action-oriented AtlasMind prompt that treats repo bug reports and fix requests as workspace tasks, prefers repository investigation over support-style triage, and still preserves safe behavior |
| **Skills** | `[]` (all enabled skills are available to the default agent) |

The default agent has no `allowedModels` constraint and no cost limit, making it the universal fallback. It works directly in the current workspace when tools would help rather than answering like a passive support bot. Concrete bug and behavior-regression prompts receive an investigation hint; explicit fix, verification, troubleshooting, and reproduction prompts receive an execution-bias hint. If the model still answers without tools while those hints are active, AtlasMind rejects that first pass once and re-prompts for a tool-backed turn. The prompt is portable: it discovers each workspace's own instruction files, documentation matrix, branching policy, and release routine instead of shipping AtlasMind's conventions into unrelated repositories. Once project policy establishes companion work such as version, changelog, generated-file, or documentation updates, those remain part of completion. AtlasMind also injects an always-on workspace identity block built from the saved Atlas Personality Profile and a compact `project_soul.md` summary. Provider timeouts are hard failures rather than repeated retries.

AtlasMind now also carries an immutable legality-and-human-respect baseline in routed agent prompts. The baseline requires compliance with applicable law, treats legally ambiguous or territory-specific requests as restricted unless only safe high-level guidance is possible, and forbids any help intended to harm, discredit, disparage, or lie about a person. This rule cannot be overridden by user prompts, workspace memory, or other lower-priority instructions.

The stock built-in specialists intentionally keep `skills: []`, which means they can use the same enabled skill pool as the default agent. Their specialization comes from routing metadata and system prompt differences rather than from narrower tool access.

For freeform code work, the built-in agents now also carry a shared tests-first delivery policy:
- The default agent applies a light TDD preference so general code changes favor the smallest relevant automated test first when the task is meaningfully testable, and it should create that minimal spec when the repo does not already have one.
- Workspace Debugger prefers reproducing testable regressions with a failing automated signal before implementation, creating the smallest missing regression test first when needed, and then reporting the failing-to-passing evidence.
- Frontend Engineer prefers the smallest relevant UI or interaction regression test before implementation when practical, but explicitly falls back to strong manual verification for primarily visual work.
- Backend Engineer prefers a red-green-refactor loop for testable behavior, contract, and regression changes, including creating the smallest missing contract or regression spec when coverage is absent.
- Code Reviewer treats missing regression coverage, missing failing-to-passing evidence, and weak verification as primary findings unless direct TDD was not practical, and it should frame the concrete follow-up as adding the smallest missing test or spec.
- Security Reviewer treats code, config, runtime boundaries, and security tests as the authoritative evidence layer, uses docs as context rather than sole proof, and treats mismatches between documentation and implementation as first-class findings.
- GitHub Operator skips TDD formalities for purely mechanical git/GitHub operations (commit, push, PR creation, status checks) but still expects a regression test or health-check signal when a workflow or config change touches behavior.
- Test Developer applies a hard test-first rule: the smallest failing spec comes before any implementation touch, and every task closes with a run report showing the failing-to-passing transition and coverage delta.
- Documentation Writer verifies code snippets and function signatures match the current implementation before finalizing, and runs any configured docs-linting or link-checking step.
- Performance Analyst requires observable evidence (profiling data, benchmark output, or timing logs) before proposing a fix, and verifies the improvement is measurable after the change.
- DevOps Engineer prefers a health-check, dry-run, or validation step before marking infrastructure or pipeline changes complete, and reviews trigger conditions and environment assumptions for CI workflow changes.
- Dependency Manager runs the test suite after each update to surface regressions, and flags packages with known vulnerabilities or abandoned maintenance status.
- SEO Specialist identifies the real public discovery surfaces, inspects repository/page/listing evidence, and loads only the relevant `specialist-guidance` topic for technical SEO, structured data, content discoverability, or platform listings. Search features, crawler behavior, supported markup, limits, and performance thresholds are verified from current primary sources rather than frozen into the permanent prompt.
- UX Consultant detects and reuses the project's framework, component primitives, and design tokens, then loads only the relevant `specialist-guidance` topic for accessibility, responsive layout, interaction design, or implementation. Accessibility remains a baseline, while specific conformance rules are retrieved only when relevant and checked against current primary standards. Responsive decisions follow project tokens and content failure points rather than a hard-coded device taxonomy. It does not create graphic assets.
- Ethics Oversight, Legal Oversight, and Commercial Oversight carry an evidence-and-restraint policy in place of a tests-first one, since they review decisions rather than change behaviour. Each must ground a concern in something observable in the workspace and quote it, separate what it observed here from general principle, say "I could not determine this" rather than assuming, rank concerns by likelihood and impact, and state explicitly when something looks sound — an advisor that flags everything is indistinguishable from one that flags nothing. Each closes by naming the human review a consequential finding needs: qualified counsel in the relevant jurisdiction for legal exposure, an ethics or DPO review for human impact, and finance or commercial sign-off for business commitments. None of them certifies anything; their output is a prompt for human judgement, never clearance to proceed. They are also the only built-ins with a **restricted, read-only skill allowlist** and with `autoUpdateExcluded: true`, so neither their tool access nor their advisory framing can drift.
- The default and security-focused built-in prompts now also treat URLs and endpoints as untrusted input: AtlasMind validates scheme and host intent, prefers HTTPS for external services, and pushes for a live health or reachability check before a link is presented as working.

When AtlasMind observes TDD state for a freeform task, the chat Thinking summary now shows a red-to-green status cue. Verified runs surface observed red-to-green evidence directly in chat, while blocked or missing states are called out visibly instead of being buried in verification prose.

### Testing Methodology System

AtlasMind ships a 23-methodology testing strategy registry, replacing the earlier single-policy TDD default. Every methodology carries a label, description, category, *When to use*, *Key tools*, *Trade-offs*, and an **AI token impact** level (Low / Medium / High) with a plain-English explanation of what drives usage.

#### Methodology registry

| Category | Methodologies |
|---|---|
| **Design-time** | TDD, BDD, ATDD, Spec-Driven (SDD), V-Model |
| **Structural** | Unit, Integration, Mutation, Property-Based, Continuous/Shift-Left, White-Box |
| **Behavioral** | End-to-End, Snapshot, Contract, Model-Based (MBT), Test Design Techniques, Black-Box, Gray-Box |
| **Non-functional** | Performance, Security, Visual Regression |
| **Exploratory** | Exploratory, Agile Testing |

#### Configuration — Settings Panel → Testing

Open **AtlasMind: Open Settings Panel** and navigate to the **Testing** tab. The methodology matrix shows all 23 rows grouped by category. Each row provides:

- **Enable/disable toggle** — controls whether the methodology is active for this project.
- **ⓘ info button** — expands a detail row showing *When to use*, *Key tools*, *Trade-offs*, and the colour-coded **AI token impact** badge (green = Low, amber = Medium, red = High).
- **Primary Agent dropdown** — assigns a specific agent as the handler for this methodology.
- **Model override** — pins a model ID for tasks running under this methodology; blank follows global model routing.
- **Notes** — free-form per-methodology notes saved to `project_memory/index/testing-config.json`.

The **Auto-assess project** button scans the workspace — package.json dependencies and scripts, test framework config files, CI pipeline configs (`.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, etc.), UI source files, OpenAPI/Swagger specs, `SECURITY.md`, git contributor count, and the first 3 kB of `README.md` — and uses signal matching against each methodology's `autoDetectSignals` to generate a pre-selected recommendation set. An Auto / Manual / Skip picker controls how the result is applied.

#### Project Dashboard — Testing page

The **Project Dashboard → Testing** page includes a methodology toggle matrix with immediate save. Toggling a methodology writes directly to `project_memory/index/testing-config.json`. An **Open Testing Strategy →** link navigates to the Settings Panel for agent assignment and model overrides.

Above the matrix, the **Policy coverage** board reports what each *enabled* methodology has to show for itself:

- **Tested** — test files matching that policy exist, with their file, case, skipped, and failing counts.
- **No tests yet** — the policy's tooling is installed (dependency, script, or config detected) but nothing in the tree tests with it.
- **Nothing found** — enabled with no tooling and no tests. A **Write tests with Atlas** action proposes the smallest useful set.
- **Practice — not file-evident** — exploratory, black-box, gray-box, white-box, V-model, test-design, and agile testing leave no artifact to detect, so they are labelled rather than counted as gaps.

Failing tests are read from the newest JUnit-style report the project has written (`test-results/junit.xml`, `junit.xml`, `target/surefire-reports/*.xml`, and similar) and attributed to the policy that owns the file, with a per-policy **Fix with Atlas** action. AtlasMind never runs a test command to populate this: if the project has produced no report, the page states that pass/fail is *unknown* and shows the command for the detected framework, because "0 failing" from a run that never happened is worse than no number. A report that predates your newest test file is marked **May be out of date**. Skipped-test counts are derived from the test files themselves, so that signal is available with or without a report.

#### Agent Testing Roles

The **Agent Editor** shows a **Testing Roles** section below Skills. When a methodology is assigned to the agent in `testing-config.json`, the section renders read-only chips for each methodology plus per-methodology model override inputs. When no methodologies are assigned, a **Configure in Testing Strategy →** link opens the Settings Panel Testing page.

#### Bootstrap and import

During `@atlas /bootstrap` (new project) and `@atlas /import` (existing project), AtlasMind presents an **Auto / Manual / Skip** picker before the methodology list. In Auto mode the inferred methodology set is pre-selected in a customisable QuickPick; Manual lets you choose freely; Skip defaults to TDD + Unit. After confirming, if a test-focused agent exists, an offer is made to assign it as the primary agent for all enabled methodologies.

Choosing **Website / Marketing Site** during guided bootstrap also seeds Website Studio from the captured brief without overwriting an existing `project_memory/domain/website.json`. Website Studio is planning/review state, not tool authorization: platform selection cannot deploy, n8n status cannot trigger a workflow, and imported dashboard data is sanitized/redacted before SSOT persistence. See [[Website Studio]].

#### Scaffolding & external-agent sync

Two actions on the Settings → Testing page operationalise the matrix:

- **Scaffold framework** (`AtlasMind: Scaffold Testing Framework`) detects the project language (Node/Python/Rust/Go/.NET/Java) and a coarse archetype (web/api/cli/game/mobile/library), then generates idiomatic starter files for each enabled methodology — e.g. Vitest/Jest/Playwright/fast-check/k6 (Node), pytest/Hypothesis/Locust (Python), `cargo test`/proptest/criterion (Rust), `go test`/benchmarks (Go), xUnit (.NET), JUnit 5 (Java) — plus a managed `project_memory/operations/testing-strategy.md` playbook. Non-destructive: files are created only when absent, no manifest is mutated, and the run is modal-confirmed.
- **Sync to AI agents** (`AtlasMind: Sync Testing Protocols to AI Agents`) writes the enabled protocols into detected external instruction files (`CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, Cursor, Cline, Gemini, Windsurf, Aider) as a delimited AtlasMind-managed block, so agents outside AtlasMind enact the same strategy. Saving the matrix auto-syncs. See [[Security]] for the managed-block safety model.

Freeform execution also now emits lightweight live progress updates while a response is still running. In the dedicated chat surface, AtlasMind shows interim thinking-style notes such as agent selection, tool rounds, workspace-investigation retries, and escalation or anti-churn nudges before the final answer replaces those transient updates.

AtlasMind also reflects part of the routing trace back in the assistant footer. The Thinking summary now includes the selected agent, any detected routing hints, whether workspace-investigation bias was applied before execution, the completed turn's token and cost usage, and any observed red-to-green TDD status.

## Agent Definition

```typescript
interface AgentDefinition {
  id: string;                   // Unique identifier
  name: string;                 // Display name (used in selection scoring)
  role: string;                 // Short role description (used in selection scoring)
  description: string;          // Longer description (used in selection scoring)
  systemPrompt: string;         // Injected as system message for every LLM call
  allowedModels?: string[];     // Whitelist of model IDs (empty = any model)
  costLimitUsd?: number;        // Per-task cost ceiling
  skills: string[];             // Skill IDs this agent can use (empty = all)
  builtIn?: boolean;            // true for extension-provided agents
  lastAutoUpdated?: string;     // ISO 8601 timestamp of last successful auto-update
  autoUpdateExcluded?: boolean; // true to opt this agent out of the global auto-update cadence
  completionCriteria?: {
    rubric?: string[];           // observable specialist definition-of-done rows
    incompletePatterns?: string[]; // bounded retry-trigger regexes
  };
}
```

## Creating Custom Agents

### Via the Agent Manager Panel

1. Open **AtlasMind Settings → Agents**, use **Manage Agents** on the Settings overview, or run **AtlasMind: Manage Agents** from the command palette
2. Click **New agent** in the compact workspace header
3. Fill in the fields:
   - **Name** — e.g. "Security Reviewer"
   - **Role** — e.g. "security-reviewer"
   - **Description** — what the agent specialises in
   - **System Prompt** — stable role, scope, evidence, and safety instructions
   - **Completion rubric** — up to 12 observable definition-of-done requirements
   - **Incomplete-result patterns** — optional bounded patterns that trigger one finish-or-declare-blockers retry
   - **Allowed Models** — optionally restrict to specific models
   - **Cost Limit** — maximum USD per task
   - **Skills** — which skills this agent can invoke
4. Save — the agent is persisted across sessions in VS Code globalState

The Settings Agents landing page shows the exact global immutable guardrails applied to every routed agent. The block is selectable and read-only, comes directly from the runtime source constant rather than a copied summary, and explains that agents, workspace content, and lower-priority instructions cannot weaken it.

The manager is a master/detail workspace: search and filters remain beside the selected agent, rather than sending you through separate Overview, Directory, and empty Editor pages. Agent fields are grouped into Identity, Instructions & completion, Skills, Models & budget, Testing, and Maintenance; advanced groups start collapsed. Built-in identity and completion criteria are shown but remain factory-defined.

### Via the Models Sidebar

- Provider rows expose an assign action that adds that provider's discovered models to selected agents.
- Model rows expose an assign action that adds or removes a specific model from selected agents' explicit `allowedModels` whitelist.
- Built-in agent assignments made from the Models tree are persisted separately so they survive restarts while the built-in agents remain read-only in the Agent Manager panel.

### Via the Sidebar

Right-click in the **Agents** tree view to create, edit, enable/disable, or delete agents.

## Enable / Disable Agents

- Toggle an agent's enabled state via the sidebar tree view or the Agent Manager Panel
- Disabled agents are excluded from selection but remain registered
- The `default` agent cannot be disabled

Disabled agent IDs are persisted in globalState as `atlasmind.disabledAgentIds`.

## Shared Operating Contract and Rubric

Every user-facing invocation is composed at runtime with the same portable operating contract and six-part execution rubric. The model must act when execution was requested, use workspace/tool evidence for concrete claims, recover from tool failures in the same turn, treat external context and URLs as untrusted, finish wiring and companion work, verify proportionately, preserve approval/safety gates, and report the outcome or exact blocker. Runtime composition means hand-written specialists, custom agents, ephemeral project agents, synthesized agents, and older persisted built-in overrides all receive it without duplicating text across definitions. All 16 user-facing built-in specialists append three or four observable role-specific criteria, while custom agents may supply their own bounded rubric rows.

An agent may append observable requirements through `completionCriteria.rubric`. Its `incompletePatterns` are also live: a safe bounded match triggers one retry requiring the agent either to finish the work or expose a clearly labelled blocker. Unsafe regex constructs are ignored rather than evaluated against model output.

## Agent Auto-Update

AtlasMind can automatically refresh user-defined agent system prompts and descriptions to keep them modern, accurate, and legally compliant. When a refresh is due, the agent's definition is reviewed by an AI model before the task runs.

**Setting:** `atlasmind.agentAutoUpdateCadence`

Change this once in the Manage Agents sidebar under **Defaults & automation**. The control is global, so it is not repeated inside each agent editor.

| Value | Behaviour |
|---|---|
| `never` (default) | No automatic updates |
| `every-use` | Refresh every time the agent is selected |
| `daily` | Refresh if the last update was > 24 hours ago |
| `weekly` | Refresh if the last update was > 7 days ago |
| `monthly` | Refresh if the last update was > 30 days ago |

**Exclusions:**
- Built-in agents are never auto-updated.
- Check **Exclude from auto-updates** in the Agent Manager panel to protect a hand-crafted agent from the global cadence.

The built-in exclusion is enforced before any provider call and is shown as a locked control in Agent Manager. **Safety:** If an update call for a user-created agent fails, the original definition is used and `lastAutoUpdated` is not advanced.

## Operational Boundaries

- `AgentRegistry` manages agent definitions, enablement, and success or failure history.
- `SkillsRegistry` manages which skills are available to those agents.
- `Orchestrator` owns routing, execution, retries, and final task outcomes.
- `ProjectRunHistory` and tool webhooks provide reviewable runtime telemetry for autonomous runs.

That split is what lets AtlasMind grow the number of agents without collapsing agent management, execution, and logging into one service.

## Ephemeral Sub-Agents

When `/project` executes subtasks, the planner assigns a **role** to each subtask. The orchestrator creates a temporary agent with a specialised system prompt:

| Role | System Prompt Focus |
|------|-------------------|
| `architect` | System design, scalable structure, design patterns |
| `backend-engineer` | Server-side APIs, data layers, performance |
| `frontend-engineer` | Responsive UIs, components, accessibility |
| `tester` | Test authoring, edge cases, coverage |
| `documentation-writer` | User and developer documentation, clarity |
| `devops` | CI/CD, deployment, infrastructure as code |
| `data-engineer` | Data models, pipelines, transformations |
| `security-reviewer` | OWASP issues, threat modelling, mitigations |
| `general-assistant` | Fallback for unrecognised roles |

For code-changing `/project` work, AtlasMind appends a shared delivery policy to every ephemeral sub-agent prompt:
- Prefer tests first when the subtask changes behavior, fixes a bug, or introduces a new contract.
- Add or update the smallest relevant automated test before implementation when the task is meaningfully testable, creating the smallest missing regression test or spec if the repo does not already have one.
- Block non-test implementation writes until a failing relevant test signal has been observed, either from dependency context or in the current subtask.
- Aim for a red-green-refactor loop and report the verification evidence, tests touched, and remaining coverage gaps.
- If the work is not realistically testable, explain why and use the strongest direct verification available instead.

Ephemeral agents exist only for the duration of their subtask and are not persisted.

## Agent Context Bundle

When an agent handles a task, it receives:

1. **System prompt** — the agent's configured prompt
2. **Memory context** — relevant SSOT entries from `queryRelevant()`
3. **Available skills** — resolved from the agent's skill list
4. **User message** — the original request
5. **Session history** — bounded carry-forward from previous turns

## Best Practices

- **Be specific in the role field** — the orchestrator uses it for selection scoring
- **Use system prompts for behaviour** — e.g. "Always suggest tests" or "Prefer functional patterns"
- **Restrict skills when appropriate** — a "read-only reviewer" agent shouldn't have `file-write`
- **Set cost limits for expensive agents** — prevent runaway costs on premium models
- **Use `allowedModels`** — force a reasoning model for an architect agent, or a cheap model for a formatter
- **Use the Models tree for fast assignment** — provider rows are the quickest way to seed an agent with all models from one provider; model rows are the quickest way to pin a single model.
