# Agents & Skills

## Agents

### What is an Agent?

An agent is a specialised AI persona with a defined role, behaviour rules, model preferences, and skill set. The orchestrator selects the best agent for each task and builds a tailored context bundle.

### Agent Definition

```typescript
interface AgentDefinition {
  id: string;                     // Unique identifier
  name: string;                   // Display name
  role: string;                   // Short role description
  description: string;            // Detailed description
  systemPrompt: string;           // System prompt injected into every request
  allowedModels?: string[];       // Model whitelist (empty = any)
  costLimitUsd?: number;          // Per-request cost cap
  skills: string[];               // Eligibility IDs; interpreted by skillPolicy
  skillPolicy?: 'task-scoped' | 'allowlist' | 'all';
  primaryRoutingNeeds?: string[]; // Routing need IDs this agent is the primary handler for (dominant selection signal)
  builtIn?: boolean;              // True for agents shipped with the extension (not deletable via UI)
  lastAutoUpdated?: string;       // ISO 8601 timestamp of the last successful auto-update
  autoUpdateExcluded?: boolean;   // When true, this agent is excluded from the global auto-update cadence
  skillsAutoManaged?: boolean;    // When true, skill assignments are managed automatically
  completionCriteria?: {
    rubric?: string[];             // Observable agent-specific definition-of-done rows
    incompletePatterns?: string[]; // Bounded regex signals that trigger one completion retry
  };
}
```

### Built-in Agents

AtlasMind now ships a small developer-focused built-in set for freeform routing:

| id | Name | Focus |
|---|---|---|
| `default` | Default Assistant | Catch-all fallback for general development tasks |
| `workspace-debugger` | Workspace Debugger | Repo-local bugs, regressions, root-cause analysis |
| `frontend-engineer` | Frontend Engineer | UI, layout, webview, and interaction work |
| `backend-engineer` | Backend Engineer | APIs, orchestration logic, data flow, and integrations |
| `code-reviewer` | Code Reviewer | Review, verification, regression risk, and test gaps |
| `security-reviewer` | Security Reviewer | Security gaps, runtime boundaries, auth, secret handling, and test-backed security coverage |
| `ethics-oversight` | Ethics Oversight | User harm, fairness and bias, consent, dark patterns, transparency, accessibility as an ethical duty. Read-only, advisory — never an ethics approval |
| `legal-oversight` | Legal Oversight | Dependency and third-party licence compatibility, IP, GDPR/CCPA, liability, terms of service, regulated data. Read-only, advisory — not a lawyer and not legal advice |
| `commercial-oversight` | Commercial Oversight | Monetisation and business viability, vendor cost and lock-in, contractual and customer obligations, competitor positioning, go-to-market impact. Read-only, advisory |
| `competitive-analyst` | Competitive Analyst | Who else solves this, how they are positioned and priced, what they shipped recently, and which capabilities this project lacks. Read-only, cited, advisory |
| `customer-researcher` | Customer Researcher | What people publicly ask for and complain about in products of this shape. Quotes sources, names no individuals. Read-only, cited, advisory |
| `technology-analyst` | Technology Analyst | Deprecations, end-of-life dates and breaking changes in the platforms and dependencies this project stands on. Read-only, cited, advisory |
| `market-analyst` | Market Analyst | Category size and direction, segments, adjacent categories. Every figure cited with its date; an unavailable figure is reported as unavailable. Read-only, advisory |
| `funding-analyst` | Funding Analyst | Grants, accelerators, sponsorship and open-source funding schemes, with eligibility and deadlines cited from the programme's own page. Read-only, advisory |
| `regulatory-analyst` | Regulatory Analyst | Obligations that apply to a product of this shape, by jurisdiction, with the dates they take effect. Not legal advice. Read-only, cited, advisory |
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
| `memory-agent` | Memory Agent | Background only — maintains session `context.md` and refreshes SSOT snippets. Not invoked via the orchestrator task loop; configure `allowedModels` to pin to a local LLM. |

When no more specialised built-in or registered agent wins the ranking pass, the orchestrator falls back to:

| Field | Value |
|---|---|
| id | `default` |
| name | `Default Assistant` |
| role | `general assistant` |
| systemPrompt | Action-oriented AtlasMind prompt that treats repo bug reports and fix requests as workspace tasks, prefers repository investigation over support-style triage, and still preserves safe behavior |
| skills / policy | `[]` / `task-scoped` (enabled built-ins are eligible; at most 12 relevant tools are selected per turn) |

The built-in default agent is intentionally execution-capable. In freeform chat, when no more specialized agent is a better fit, AtlasMind should still inspect the current workspace and work the problem instead of replying as if it were only filing feedback for a future product update. AtlasMind adds an extra workspace-investigation hint when a freeform prompt looks like a concrete bug report or behavior regression, and an execution-bias hint for explicit fix, verification, troubleshooting, and reproduction requests. When those hints are present and tools are available, AtlasMind rejects one no-tool response and re-prompts for a tool-backed turn. The default prompt is portable: it discovers each workspace's own instruction files, documentation matrix, branching policy, and release routine instead of shipping AtlasMind's release conventions into unrelated repositories. Required companion work is still part of completion once project policy establishes it. An always-on workspace identity block combines the saved personality profile with a compact `project_soul.md` summary. Provider timeouts are hard failures rather than repeated retries.

AtlasMind now also injects an immutable legality-and-human-respect baseline into routed agent prompts. That baseline requires the model to stay within applicable law, treat jurisdiction-specific or legally ambiguous requests as restricted unless a safe high-level answer is possible, and refuse any effort to harm, discredit, disparage, or lie about a person. This rule sits above workspace memory, retrieved text, and ordinary task instructions, so it cannot be overridden by lower-priority prompt content.

Every user-facing invocation is also composed with `AGENT_OPERATING_CONTRACT` and `AGENT_EXECUTION_RUBRIC` in `Orchestrator.buildMessages()`. This is runtime composition rather than text copied into each definition, so specialist, custom, ephemeral, synthesized, and older persisted built-in overrides cannot miss the contract. The contract covers direct action, evidence gathering, same-turn tool-failure recovery, untrusted context/URL handling, and policy-document lookup. The rubric independently assesses task fit, evidence, completeness, verification, safety, and handoff before the model settles. All 16 user-facing built-in specialists append three or four independently observable role criteria; custom agents may append up to 12 bounded rows through `completionCriteria.rubric`. `incompletePatterns` are evaluated through a restricted regex subset (no lookarounds, backreferences, quantified groups, or repeated wildcards) and trigger one finish-or-declare-blockers retry.

For a chat request that names a governed Git action, the host may also add a `WorkflowChatExecutionPolicy`. Under the default `follow` mode this tells the selected agent to pursue the outcome through the enabled declared route in the **same turn**, without asking the operator to repeat “follow the workflow.” The object is structural and revalidated before it becomes fixed system guidance; repository-authored check text, blockers, and commands are never injected at system priority. The policy cannot add a skill or bypass an approval. It preserves unrelated dirty files and prefers an isolated Git worktree when branch-changing promotion work would disturb the active checkout.

The stock built-in **engineering** specialists use `task-scoped`. Most keep `skills: []`, which makes enabled built-ins eligible without admitting custom/MCP tools; the Orchestrator then selects only the request-relevant subset. They differ by routing metadata and system prompt while sharing that safe eligibility model.

The three **oversight advisors** are the deliberate exception. `ethics-oversight`, `legal-oversight`, and `commercial-oversight` pin an explicit read-only allowlist (`file-read`, `directory-list`, `file-search`, `text-search`, `git-status`, `git-diff`, `git-log`, `git-blame`, `diff-preview`, `diagnostics`, `code-symbols`, `framework-detect`, `memory-query`, `web-fetch`, plus `exa-search` for Commercial). They hold no `file-write`, `file-edit`, `file-delete`, `git-commit`, `git-push`, `git-apply-patch`, `terminal-run`, `memory-write`, or `http-request`. An advisor inspects and reports; it is not also the thing that edits. Where their findings need to be recorded, the Project Dashboard → Risk page owns that write path and sanitises the model's output at the boundary before anything reaches disk. They also set `autoUpdateExcluded: true` so the agent auto-updater cannot paraphrase away the "advisory, not authoritative" framing on its cadence.

**Test Developer is focused rather than universal.** Its explicit 17-skill eligibility list covers repository reads/search, Git inspection, diagnostics/symbols/framework detection, test and terminal execution, file edit/write, workspace observability, and memory query. Task-scoped selection narrows that list again per request, so an ordinary ATDD/TDD explanation can remain tool-less while implementation work retains the actions it needs.

Agent assignment is only the outer ceiling. For each task, the Orchestrator also derives a deterministic turn capability envelope from explicit user wording. A read-only/no-edit request removes write-capable schemas; an explicit no-command/no-install request removes terminal, package, and process execution too. The same rule runs again immediately before tool execution, so a hallucinated tool name cannot regain an omitted capability. Restricted turns do not delegate native tools to ACP because that external tool set cannot accept AtlasMind's per-turn schema filter.

The six **research analysts** — `competitive-analyst`, `customer-researcher`, `technology-analyst`, `market-analyst`, `funding-analyst`, `regulatory-analyst` — hold the same read-only allowlist plus `exa-search`, and are excluded from auto-update for the same reason. They add one discipline the oversight advisors do not need: **every claim must carry a retrievable `https` URL the analyst actually visited**. This is not politeness. `sanitizeIncomingFindings` in `src/core/researchRegister.ts` demotes an uncited claim to a *question* rather than recording it as evidence, so an analyst answering from memory produces a run in which nothing was recorded — and the surest way to get that wrong is for the model not to know the rule exists. Their prompts also fence fetched pages as REPORTED CONTENT: a competitor's marketing page is exactly as untrusted as a GitHub issue body, and "ignore your previous instructions" printed on one must read as something we found rather than as something we were told.

The Security Reviewer's future durable output path is prepared separately by `SecurityReviewManager`. It stores bounded findings for secrets, runtime boundaries, dependencies, and permissions, but it does not invoke the agent or expand its tool access. Any future caller remains responsible for deliberate invocation and must pass the model response through the manager's defensive parser and sanitizers before persistence; the register itself does not certify the project or gate delivery.

Note that `getSkillsForAgent` silently drops unrecognised skill ids, so a typo in a pinned list degrades an agent's capability rather than failing loudly; `tests/runtime/core.test.ts` asserts that every pinned id resolves.

For freeform code work, the built-in agents now also carry a shared tests-first delivery policy:
- The default agent applies a light TDD preference so general code changes favor the smallest relevant automated test first when the task is meaningfully testable, and it should create that minimal spec when the repo does not already have one.
- Workspace Debugger prefers reproducing testable regressions with a failing automated signal before implementation, creating the smallest missing regression test first when needed, and then reporting the failing-to-passing evidence.
- Frontend Engineer prefers the smallest relevant UI or interaction regression test before implementation when practical, but explicitly falls back to strong manual verification for primarily visual work.
- Backend Engineer prefers a red-green-refactor loop for testable behavior, contract, and regression changes, including creating the smallest missing contract or regression spec when coverage is absent.
- Code Reviewer treats missing regression coverage, missing failing-to-passing evidence, and weak verification as primary findings unless direct TDD was not practical, and it should frame the concrete follow-up as adding the smallest missing test or spec.
- Security Reviewer treats code, config, runtime boundaries, and security tests as the authoritative evidence layer, uses docs as context rather than sole proof, and treats mismatches between documentation and implementation as first-class findings.
- GitHub Operator skips TDD formalities for purely mechanical git/GitHub operations (commit, push, PR creation, status checks) but still expects a regression test or health-check signal when a workflow change touches behavior or configuration.
- Test Developer applies a hard test-first rule: the smallest failing spec comes before any implementation touch, and every task closes with a run report that shows the failing-to-passing transition and coverage delta.
- Documentation Writer verifies code snippets and function signatures against the current implementation before finalizing, and runs any configured docs-linting or link-checking step.
- Performance Analyst requires observable evidence (profiling data, benchmark, or timing logs) before proposing a fix, and verifies the improvement is measurable after the change.
- DevOps Engineer prefers a health-check, dry-run, or validation step before marking infrastructure or pipeline changes complete, and states the blast radius of each change.
- Dependency Manager runs the test suite after each update to surface regressions, and flags packages with known vulnerabilities or abandoned maintenance status.
- SEO Specialist identifies the real public discovery surfaces, inspects repository/page/listing evidence, and loads only the relevant `specialist-guidance` topic for technical SEO, structured data, content discoverability, or platform listings. Search features, crawler behavior, supported markup, limits, and performance thresholds are treated as time-sensitive and must be verified from current primary sources rather than frozen into the system prompt.
- UX Consultant detects and reuses the project's framework, component primitives, and design tokens, then loads only the relevant `specialist-guidance` topic for accessibility, responsive layout, interaction design, or implementation. Accessibility remains a baseline, but specific conformance rules live in focused guidance and current primary standards rather than an encyclopedic permanent prompt. Responsive decisions follow the project's tokens and content failure points instead of a hard-coded device taxonomy. It does not create graphic assets.
- Ethics Oversight, Legal Oversight, and Commercial Oversight carry an evidence-and-restraint policy in place of a tests-first one, since they review decisions rather than change behaviour. Each must ground a concern in something observable in the workspace and quote it, separate what it observed here from general principle, say "I could not determine this" rather than assuming, rank concerns by likelihood and impact, and state explicitly when something looks sound — an advisor that flags everything is indistinguishable from one that flags nothing. Each closes by naming the human review a consequential finding needs: qualified counsel in the relevant jurisdiction for legal exposure, an ethics or DPO review for human impact, and finance or commercial sign-off for business commitments. None of them certifies anything; their output is a prompt for human judgement, never clearance to proceed.
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

#### What an enabled methodology actually does

Enabling a methodology has three effects, and until v0.221.0 only the first two existed — which is why a project could carry fourteen enabled methodologies and have tests for none of them.

1. **It is stated to every agent that writes code.** On any turn whose task profile is `code` or `mixed`, the orchestrator injects `buildTestingObligationGuidance` — the *whole* enabled set, phrased as an obligation: a change that alters behaviour is not finished until it carries the evidence its policy names, and an agent that cannot produce that evidence must say so and say why. Previously, policy reached a prompt only when the task was **already** classified as testing or its text already contained a testing word, so the turns implementing features were precisely the ones told nothing.
2. **It can select a model.** A methodology assigned to an agent, with a model override, prepends that model for a matching testing task.
3. **It is expected to leave evidence.** The Testing page reports each enabled methodology as *Tested*, *No tests yet*, *Nothing found*, or *Practice*, and an unevidenced one becomes a tech-debt entry graded by the published rule table.

Practices — V-Model, White-Box, Test Design Techniques, Black-Box, Gray-Box, Exploratory, Agile Testing — are ways of working that leave no artifact. They are named to the agent as context but never requested as files, and the Testing page never counts them as gaps.

**A methodology can also hold work back — if you ask it to.** Each entry carries an optional `blocking` flag (schema version 2, off by default). When set on an enabled methodology, AtlasMind's write gate refuses non-test writes until a failing test has been observed. It is opt-in *per methodology* rather than a project-wide switch, because enabling a methodology is a statement of intent that should stay safe to make, whereas turning one into a gate changes how every task in the project runs. Declare the full standard you hold yourself to, and block on the one or two you are willing to stop work over. Where AtlasMind cannot read the config at all, the gate stays on.

**Enabling a methodology you do not practise produces a permanent, visible gap.** That is the intended behaviour rather than a flaw: the alternative is a declaration that means nothing. Turn on what the project genuinely does, and add the rest deliberately.

#### Configuration — Settings Panel → Testing

Open **AtlasMind: Open Settings Panel** and navigate to the **Testing** tab. The methodology matrix shows all 23 rows grouped by category. Each row provides:

- **Enable/disable toggle** — controls whether the methodology is active for this project.
- **ⓘ info button** — expands a detail row showing *When to use*, *Key tools*, *Trade-offs*, and the colour-coded **AI token impact** badge (green = Low, amber = Medium, red = High).
- **Primary Agent dropdown** — assigns a specific agent as the handler for this methodology.
- **Model override** — pins a model ID for tasks running under this methodology; blank follows global model routing.
- **Notes** — free-form per-methodology notes saved to `project_memory/index/testing-config.json`.

The **Auto-assess project** button scans the workspace — package.json dependencies and scripts, test framework config files, CI pipeline configs (`.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, etc.), UI source files, OpenAPI/Swagger specs, `SECURITY.md`, git contributor count, and the first 3 kB of `README.md` — and uses signal matching against each methodology's `autoDetectSignals` to generate a pre-selected recommendation set. An Auto / Manual / Skip picker controls how the result is applied.

#### Project Dashboard — Testing page

An activated-testing repair remains one normal approval-gated task, but its lifecycle is now visible in the page: the host reports when routing begins, streams concise real orchestration/tool updates, and stores the final report or failure. The indicator is intentionally indeterminate because tool approval and test duration cannot support an honest percentage. A terminal task result is not a green claim; the current test evidence remains the source of truth. **Open result in Atlas Chat** sends no browser-supplied transcript: it opens the host-retained, redacted report as a reviewable fenced draft that the user may inspect or edit before sending.

The **Project Dashboard → Testing** page includes a methodology toggle matrix with immediate save. Toggling a methodology writes directly to `project_memory/index/testing-config.json`. Each protocol has the same shared plain-English description, *When to use*, *Key tools*, and *Trade-offs* as Settings rather than a labels-only dashboard copy. Its **Fix activated testing** action gives the normal approval-gated Atlas task the host-derived enabled-policy coverage and report failures, so it can inspect, repair, and re-run the existing relevant test surfaces without inventing a command or silently weakening a test. An **Open Testing Strategy →** link navigates to the Settings Panel for agent assignment and model overrides.

Every Policy Coverage card also has a visible **Ask Atlas** explainer. This is not an agent task: `buildTestingPolicyLaymanGuide` declares beginner-facing copy for all 23 methodologies, and the Dashboard combines it with the live evidence row to answer what the method is, what it needs, the expected result, why it is useful, why the displayed status follows, and what to do next. The first reply bypasses model routing and tools entirely, then offers status-specific chips for an optional project-fit review, smallest-test plan, disablement explanation, coverage review, failure diagnosis, or practice checklist. Those follow-ups become ordinary routed turns only after the operator chooses one.

#### Agent Testing Roles

The **Agent Editor** shows a **Testing Roles** section below Skills. When a methodology is assigned to the agent in `testing-config.json`, the section renders read-only chips for each methodology plus per-methodology model override inputs. When no methodologies are assigned, a **Configure in Testing Strategy →** link opens the Settings Panel Testing page.

#### Bootstrap and import

During `@atlas /bootstrap` (new project) and `@atlas /import` (existing project), AtlasMind presents an **Auto / Manual / Skip** picker before the methodology list. In Auto mode the inferred methodology set is pre-selected in a customisable QuickPick; Manual lets you choose freely; Skip defaults to TDD + Unit. After confirming, if a test-focused agent exists, an offer is made to assign it as the primary agent for all enabled methodologies.

When guided bootstrap selects **Website / Marketing Site** (or a Shopify store/theme template), AtlasMind also seeds Website Studio from the captured brief. The seed is non-destructive: an existing `project_memory/domain/website.json` is never replaced. From there, **AtlasMind: Open Website Studio** provides client intake, sitemap, wireframe/UI review, UI-system, Hosting & Platforms, and n8n dashboards. The hosting plan is always Develop → Staging → Production: Develop defaults to loopback, Staging is a password-protected client-review subdomain of Production, and Production is public and promotion-protected.

Website Studio is a planning and review boundary, not an execution shortcut. Imported/webview data is bounded and sanitized before SSOT persistence; common credential shapes and n8n webhook URLs are redacted; password and n8n inputs store only provider-prefixed credential references rather than values. Hosting access policies are rebuilt server-side, with HTTPS/loopback/subdomain readiness checks, so a webview payload cannot make Staging public or remove Production protection. Choosing Cloudflare Pages, GitHub Pages, WordPress/Elementor, or another platform does not authorize a deployment, and marking an n8n workflow configured does not trigger it. Publishing continues through the guarded Delivery pipeline, and any future n8n runner must enter the normal tool-risk and approval path.

#### Framework scaffolding (`src/core/testingScaffolder.ts`)

The **Scaffold framework** button on the Settings → Testing page (command: `AtlasMind: Scaffold Testing Framework`) constructs a starter framework that fits the current project. `scaffoldTestingFramework` detects the project **language** — Node (JS/TS), Python, Rust, Go, .NET, or Java — from manifest fingerprints, plus a coarse **archetype** (web / api / cli / game / mobile / library / generic), then for each *enabled* methodology generates idiomatic starter files: Vitest/Jest specs, Playwright/Cypress e2e (or an API smoke test / CLI spawn harness depending on archetype), fast-check property tests, k6 load scripts and snapshot tests for Node; pytest + Hypothesis + Locust for Python; `cargo test` + proptest + criterion for Rust; `go test` + `testing/quick` + benchmarks for Go; xUnit for .NET; JUnit 5 for Java. It also writes a managed `project_memory/operations/testing-strategy.md` playbook with language-specific set-up commands, trade-offs, and starter-file references; unknown stacks degrade to playbook-only guidance. It is strictly **non-destructive**: files are created only when absent and never overwritten, no manifest is ever mutated (install commands are surfaced for the developer to run), and the action is confirmed via a modal dialog. After that confirmation it syncs the enabled protocol blocks to **existing** AI instruction files. If the project already has Vitest or Jest and a bounded scan finds a small module with a named export, AtlasMind then asks an agent to inspect and author exactly one focused first test through the normal approval path. The candidate is a lead, not proof: the agent may leave the source untouched. Its task may not add dependencies, alter a manifest, or edit production code; without both an existing runner and candidate it does not start a test-authoring task.

#### Outbound protocol sync to external AI agents (`src/utils/testingProtocolSync.ts`)

So that AI agents *outside* AtlasMind — Claude Code, GitHub Copilot, Cursor, Cline, Gemini, Windsurf, Aider, and Codex (`AGENTS.md`) — can discover and enact the same testing strategy, the **Sync to AI agents** button (command: `AtlasMind: Sync Testing Protocols to AI Agents`) writes the enabled protocols into the project's instruction files. Whereas `aiInstructionSync.ts` reads those files *into* AtlasMind, `syncTestingProtocols` does the reverse: it renders each enabled methodology (what, when to apply, key tools, owner agent, preferred model, project notes) into a delimited, AtlasMind-managed block (`<!-- atlasmind:testing-protocols:start -->` … `:end -->`) and upserts it into every *detected* (existing) markdown instruction file. The writer is non-destructive — it only touches its own block, preserves all surrounding content, writes only to files that already exist, and routes every path through the shared traversal guard. JSON-config tools (Continue) are reported as skipped. **Saving the Testing matrix auto-syncs**, and scaffold runs invoke this same sync before any eligible first-test task, keeping external agents continuously in step with the matrix.

Freeform execution also now emits lightweight live progress updates while a response is still running. In the dedicated chat surface, AtlasMind shows interim thinking-style notes such as agent selection, tool rounds, workspace-investigation retries, and escalation or anti-churn nudges before the final answer replaces those transient updates.

### Agent Selection

The orchestrator ranks enabled agents using a blend of lexical relevance and common development-intent heuristics. It still checks request-token overlap against each agent's role and description, but it also recognizes frequent software-development asks such as debugging, testing, review, architecture, frontend, backend, docs, security, devops, performance, and release work.

Selection behavior:
1. Disabled agents are excluded from consideration.
2. Remaining agents are scored by intent overlap across agent id, name, role, description, system prompt, and explicit skill metadata.
3. Requests that match common development needs add routing boosts for agents whose metadata lines up with those needs.
4. Workspace bug-report style prompts add an extra boost for agents that look investigation-ready.
5. Highest score wins; ties break by agent name.
6. If no enabled registered agent exists, the built-in fallback agent is used.

Agent selection and model execution remain separate decisions. If the selected agent has skills, its task normally requires a function-calling model. With `atlasmind.acp.toolsEnabled` enabled, an ACP subscription model that declares delegated native-tool execution may satisfy that requirement instead. AtlasMind then sends no skill schemas to ACP and authorizes only that exact provider request; the subscription agent uses its own tools and each readable operation request is automatically answered `allow_once` and written to the audit log. The global setting alone does not authorize an ordinary completion. With the setting off, ACP stays available for tool-free chat/reasoning while tool-backed work routes elsewhere. Explicit provider/model pins, agent allowlists, provider health, privacy gates, and normal scoring still apply.

That delegated alternative is never used when the current task has a read-only or no-command capability envelope. The normal function-calling path receives the narrowed read schemas and can therefore inspect without escalating authority; ACP remains a completion candidate only after repository-tool requirements are deliberately removed.

AtlasMind also exposes part of that route back to the user in the assistant footer. The Thinking summary now includes the selected agent, any detected routing hints, whether the workspace-investigation bias was applied before execution, the completed turn's token and cost usage, and any observed red-to-green TDD status.

### Registering Agents

**Via Settings and the Manage Agents panel:**

Open **AtlasMind Settings → Agents**, use the **Manage Agents** shortcut on the Settings overview, or run **AtlasMind: Manage Agents** from the command palette. Settings provides the discoverable landing page and live built-in/custom/enabled counts. It also renders the exact `IMMUTABLE_GUARDRAILS` runtime block as selectable, read-only text with source provenance, making the non-overrideable baseline applied to every routed agent visible without duplicating or weakening it. The dedicated manager uses a master/detail workspace so the searchable, filterable directory remains visible while you edit the selected definition.

The manager supports:
- Creating a custom agent from the compact **New agent** action (id auto-derived from name)
- Editing identity, description, system prompt, skills, model eligibility, per-request budget, testing assignments, and maintenance policy in grouped disclosure sections
- Adding up to 12 observable `completionCriteria.rubric` rows and 12 bounded `incompletePatterns` retry gates to custom agents
- Inspecting factory-defined completion criteria on built-ins while keeping built-in identity and criteria read-only
- Enabling or disabling any registered agent, deleting custom agents with confirmation, and resetting built-in customizations
- Searching by name, role, status, or skill and filtering by enabled/custom/built-in without losing that list state when the editor re-renders

Agents created through the panel are persisted to `globalState` and restored on next activation. Disabled-agent state is also persisted and restored. The sidebar agents tree updates immediately.

Model assignment can also be driven from the Models sidebar:
- Provider rows expose an assign action that adds all currently discovered models from that provider to the selected agents' `allowedModels` whitelist.
- Model rows expose an assign action that adds or removes a specific model from the selected agents' explicit whitelist.
- Built-in agent model assignments are persisted separately from user-created agents so they survive restarts without turning built-in agents into editable custom agents.

**Programmatically:**
```typescript
atlas.agentRegistry.register({
  id: 'architect',
  name: 'Architect',
  role: 'system design',
  description: 'Designs system architecture and makes structural decisions.',
  systemPrompt: 'You are a software architect...',
  skills: ['file-read', 'diagram-gen'],
});
```

**From SSOT (planned):**
Agent definitions in `project_memory/agents/*.md` will be auto-loaded.

### Agent Auto-Update

AtlasMind can automatically refresh user-defined agent system prompts and descriptions so they stay modern, accurate, and legally compliant. The feature is powered by AI: before each use the extension checks whether the cadence has elapsed and, if so, submits the current definition to an AI model that rewrites it against the criteria below.

**Update criteria applied on every refresh:**
1. Current AI assistant best practices and instruction-writing standards
2. Accuracy — references to frameworks, APIs, or tools are updated to reflect the modern landscape
3. Legal compliance across major territories (US, EU, UK, Canada, Australia) — data-handling guidance, privacy disclaimers, and jurisdiction-specific language are checked
4. Removal of outdated, obsolete, or irrelevant instructions
5. Preservation of the agent's core purpose, role, and capabilities
6. Clarity and conciseness

**Cadence setting (`atlasmind.agentAutoUpdateCadence`):**

The Manage Agents sidebar exposes this once under **Defaults & automation**, so the global cadence stays visible without being duplicated inside every agent editor.

| Value | Behaviour |
|---|---|
| `never` (default) | Agent definitions are never automatically updated |
| `every-use` | Refresh on every use of the agent |
| `daily` | Refresh if the last update was more than 24 hours ago |
| `weekly` | Refresh if the last update was more than 7 days ago |
| `monthly` | Refresh if the last update was more than 30 days ago |

**Exclusions:**
- Built-in agents (those shipped with the extension) are never auto-updated regardless of the cadence setting.
- Individual user-defined agents can opt out via the **Exclude from auto-updates** checkbox in the Agent Manager panel. This is useful for agents whose system prompt has been carefully hand-crafted and should not be touched.

The built-in check is enforced in `AgentAutoUpdater.isDue()` before any provider call, and Agent Manager renders the exclusion checked and disabled for built-ins. **Failure safety:** If the AI call fails for any reason, the original user-agent definition is used unmodified. The `lastAutoUpdated` timestamp is only written after a successful update, so the cadence clock is not advanced on failure.

---


## Asking another agent (`agent-handoff`)

The tenth built-in workspace tool, and the first that gains an agent a *capability* rather than a fact.

An agent calls it to put a question to a named specialist — a security judgement, a test-design decision — and gets that specialist's answer back. The caller keeps ownership of the task and acts on what it hears.

**It runs with the caller's permissions, not the delegate's.** The delegate gets `intersection(caller's skills, target's skills)`, never the union. A tool the caller does not have, the delegate does not get either, even if it normally would. This is the point rather than an oversight: if a handoff granted the union, any restricted agent could obtain any capability by asking a permissive one, and every restriction in the system would become a suggestion.

Delegation is capped at three deep and cannot loop back to an agent already in the chain. A delegate that would end up with no tools at all is refused rather than run, because a model that cannot check anything produces confident prose. Every refusal names what to do instead.

The delegate's answer returns fenced and labelled as another agent's opinion — it is model output feeding another model's reasoning, and it has not earned the credence a tool result gets.

## Ephemeral Sub-Agents (Project Execution)

When a `/project` command is executed, the orchestrator synthesises temporary `AgentDefinition` objects on the fly from each `SubTask.role` — these agents are never registered in the `AgentRegistry`. Supported roles and their system prompts:

| Role | Focus |
|---|---|
| `architect` | System design, scalable structure, patterns |
| `backend-engineer` | Server-side APIs, data layers |
| `frontend-engineer` | Responsive UIs, accessible components |
| `tester` | Test authoring, edge cases, coverage |
| `documentation-writer` | User and developer documentation |
| `devops` | CI/CD pipelines, deployment, infrastructure |
| `data-engineer` | Data models, pipelines, transformations |
| `security-reviewer` | OWASP issues, vulnerability mitigations |
| `general-assistant` | Catch-all for unrecognised roles |

Each sub-agent only receives the skill IDs listed in its `SubTask.skills` array plus the `depOutputs` context block prepended to its user message. The `Planner` builds the list of available skill IDs dynamically from the live `SkillsRegistry` at plan time — every enabled built-in, user-registered, and MCP-connected skill is automatically visible to subtask agents without manual additions to the planner prompt. A fallback list covering the core tool set is used when the registry is unavailable. Because planner JSON is untrusted and reasoning models can omit skills or return disabled IDs, AtlasMind normalizes each non-synthesis subtask before execution: invalid IDs are removed and an otherwise tool-less repository task receives the smallest enabled evidence set (`file-read`, `file-search`, `workspace-observability`). Dependency-only synthesis remains tool-free. This preserves the intended brain/hand split: a reasoning-only provider can plan, while execution routes through a model with `function_calling`.

For code-changing `/project` work, AtlasMind now gives these ephemeral agents an explicit autonomous TDD contract:
- Prefer tests first when a subtask changes behavior, fixes a regression, or introduces a new contract.
- Capture the expected behavior in the smallest relevant automated test before implementation when the task is meaningfully testable, creating the smallest missing regression test or spec if the repo does not already have one.
- Block non-test implementation writes until a failing relevant test signal has been observed, either in dependency context or in the current subtask.
- Aim for a red-green-refactor flow, then report which tests changed, what verification ran, and any remaining coverage gaps.
- Fall back to direct verification with an explicit explanation when a subtask is documentation-only, infrastructure-only, or otherwise not realistically testable.
- When a write is blocked and the model settles by only describing the fix, AtlasMind re-prompts once to complete the red→green cycle; if it still does not, a deterministic "Change not applied" caveat is appended so a blocked fix is never reported as if it had landed.

Project execution now runs a preflight preview in chat before orchestration starts:
- Atlas shows the decomposed task table and an estimated file-touch impact.
- Atlas also declares that `/project` will follow a tests-first delivery policy where behavior changes are involved.
- Atlas persists per-subtask TDD telemetry so the Project Run Center can show whether Atlas verified the red signal, got blocked by the gate, or never recorded the required evidence.
- If estimated impact exceeds the configured safety threshold, execution is paused until the user re-runs with `--approve`.
- Atlas snapshots the workspace and reports per-subtask changed-file deltas as subtasks complete, then emits a cumulative final summary at the end.
- Atlas records per-file attribution traces (which subtask titles touched which files) and persists a JSON run summary report in the configured report folder.
- When one or more subtasks fail, Atlas renders a post-run failure banner listing the failed subtask titles, the number of files already modified, and a *View Source Control* button for easy rollback.
- When a subtask hits the agentic tool-iteration cap (`maxToolIterations`) without finishing, it does **not** fail or silently complete — it reports a `needs-input` pause. The project report asks what to do next and the shared chat bubble renders immediate chips to **use the suggested value for this run**, **save it permanently**, or **keep the partial result**. A one-run override restores the prior runtime value when the retry ends; only the permanent choice writes the workspace setting. The run is recorded as `paused`, and Project Run Center retains the pause and suggested limit.
- A subtask is recorded as `completed` only when it actually delivered. Via `classifySubTaskFailure`, a response that ends on an unrecovered tool error, that announces an action without following through ("Let's inspect…"), that claims required tools are disabled/unavailable, or that signals incomplete/unverified work is marked `failed` (after one recovery retry). During a live tool-backed attempt, an explicit tool-unavailable refusal triggers an immediate model handoff before classification. These gates prevent the scheduler from building dependents on a broken foundation and stop the run from reporting a false "N/N subtask(s) completed".
- After completion, follow-up chips are outcome-driven: a run with failures surfaces *Retry the project* and *Diagnose failures*; a successful run with changed files surfaces *Add tests*; otherwise the default chips are shown.

---

## Skills

### What is a Skill?

A skill defines a capability that agents can use. Skills have typed parameters (JSON Schema) and a handler module that implements the logic.

### Skill Definition

```typescript
interface SkillDefinition {
  id: string;                          // Unique identifier
  name: string;                        // Display name
  description: string;                 // What the skill does
  parameters: Record<string, unknown>; // JSON Schema for input parameters
  execute: SkillHandler;               // Implementation function
  source?: string;                     // Absolute path (custom skills only)
  builtIn?: boolean;                   // True for extension-shipped skills
  panelPath?: string[];                // Skills tree category or folder path
  routingHints?: string[];             // Natural-language aliases and intent phrases for tool selection
}

type SkillHandler = (
  params: Record<string, unknown>,
  context: SkillExecutionContext,
) => Promise<string>;
```

`SkillExecutionContext` provides workspace file I/O (`readFile`, `writeFile`, `findFiles`), grep-style text search (`searchInFiles`), directory listing (`listDirectory`), bounded subprocess execution (`runCommand`), git inspection helpers (`getGitStatus`, `getGitDiff`), SSOT memory access (`queryMemory`, `upsertMemory`), safe git-backed patch application (`applyGitPatch`), and workspace observability (`getTestResults`, `getActiveDebugSession`, `listTerminals`), all injected by `extension.ts` so skills remain independently testable.

AtlasMind now also computes lightweight natural-language routing hints for MCP-backed skills. That means a third-party tool such as `git_commit` can advertise cues like “commit”, “git commit”, or “save changes” to the orchestrator instead of relying only on the raw tool identifier. When multiple tools look similarly plausible for a prompt, Atlas nudges the model to ask a short clarification question rather than guessing.

Risky built-in skills are also filtered by a tool-approval policy before execution. AtlasMind classifies each invocation as readonly, workspace-write, terminal-read, terminal-write, git-read, or git-write, then consults the configured approval mode before allowing the tool to run.

The Branch Dashboard's readiness, PR/CI, ownership, traceability, comparison, and cleanup readings are deterministic extension-host features, not agent claims. **Ask Atlas** receives the host-derived branch review as fenced context and remains advisory; it cannot invoke a dashboard action. Inspection and comparison are read-only host operations. Cleanup is intentionally outside the general skill surface so neither an agent nor a forged webview message can supply a ref or command: the webview sends an opaque branch id, the host re-resolves live branch state, refreshes remotes, refuses current/default/protected/worktree branches and unique commits, and presents its own confirmation. Local cleanup uses only Git's merged-only `branch -d`; remote cleanup additionally requires loaded PR evidence, a live remote hash match, and typing the exact branch name.

Pipeline CI management is likewise a host feature rather than a general-purpose agent tool. Workflow
inspection emits no YAML, commands, inputs or environment values. **Review with AtlasMind** sends an
opaque filename; the host re-reads the workflow and opens a proposal-only conversation. Starter
creation sends no payload at all and uses a closed template built from host-derived branches, lockfile
and package-script names. The host shows the exact create-only plan and writes with `wx`; agents cannot
use this surface to overwrite, disable, delete or silently weaken CI.

Execution-oriented built-in skills now include a dedicated `docker-cli` helper for container work. Instead of passing arbitrary Docker commands through the generic terminal skill, AtlasMind exposes a separate allow-list for `docker` and `docker compose` inspection and lifecycle operations such as `ps`, `logs`, `inspect`, `compose up`, and `compose down`.

### Operational Boundaries

The execution path is intentionally split so extending AtlasMind does not require editing one giant runtime class:

- `AgentRegistry` manages agent definitions, enablement, and success or failure history.
- `SkillsRegistry` manages skill definitions, security-scan state, and enablement.
- `Orchestrator` owns model routing, tool-loop execution, retries, failover, and final task results.
- `ProjectRunHistory` persists reviewable run telemetry for autonomous workflows.
- `ToolWebhookDispatcher` emits external audit events without becoming a hard dependency of the core tool loop.

That separation is the current answer to scaling the number of agents and tools: operational metadata and extension points stay in their own services, while orchestration only composes them.

### Skill Assignment

- `task-scoped` is the built-in and new-agent default. The `skills` array is an eligibility ceiling; AtlasMind selects at most 12 relevant tools for the current request. An empty list admits enabled built-in skills only. Custom and MCP skills must be named before the selector can consider them.
- `allowlist` offers exactly the enabled IDs in `skills`. Oversight advisors and planner-produced subtasks use this when the complete capability boundary is already known.
- `all` deliberately offers every enabled skill, including present and future custom/MCP integrations. It is an advanced opt-in, never the meaning of an empty list.
- A stored definition without `skillPolicy` remains compatible: a populated list resolves as `allowlist`; an empty list resolves as `task-scoped`.
- **A per-turn schema ceiling of 24 applies to every policy**, not only `task-scoped`. `skillPolicy` answers which skills an agent *may* use; it does not also decide how many schemas are worth a turn's context. Before this, an `allowlist` agent sent its whole list and an `all` agent sent every enabled skill — including every connected MCP tool — on every query. The ceiling is an overflow guard rather than a selection policy: a pool at or under it is returned untouched, so a hand-written allowlist is byte-identical to before. Above it, skills are ranked by request intent and unscored ones keep the order they were declared in rather than being sorted by id, so an overflowing allowlist keeps the ones the user named first. When the cap trims anything, the progress line says so.
- The turn selector uses explicit tool IDs plus workspace, action, testing, Git, memory, web, delivery, and prior-session follow-through signals. Selection can only narrow the eligibility pool and the user's capability envelope; it cannot grant a skill.
- **Delivery intent comes from the project's own declared vocabulary** (`src/core/projectVocabulary.ts`), never from a keyword table maintained in the selector. A promotion requires both a promotion verb *and* a stage the project declared in `delivery.json` — a verb alone is not delivery ("publish the docs"), and a stage alone is a question about it ("why is production slow?"). A stage's *kind* counts as a name, so "promote to staging" resolves a stage of kind `staging` whatever it is called.
- **Git integration flows select the write tools as a set.** Merging, rebasing, cherry-picking and promoting are one task ending in a published change, and per-word selection produced incoherent bundles: "merge to main then publish" contains neither `commit` nor `push`, so it received the tools that describe a repository and none of the tools that change one. `commit` and `push` keep their own per-word rules, so asking about a commit does not hand over the ability to publish one.
- **An escalating turn widens its selection once**, up to 18 tools, within the same eligibility pool. A thin answer is often a model that was never given the tool it needed, and re-routing to a stronger model does not fix that.
- `SkillsRegistry.getSkillsForAgent(agent)` resolves the enabled eligibility pool. `selectTaskScopedSkills()` performs the per-turn narrowing before model capability routing and schema construction.

### Enable / Disable

Each skill can be individually enabled or disabled from the Skills tree view using the eye icon (⊙). The state persists across sessions via `globalState`. A skill with a failed security scan cannot be enabled until the issues are resolved and the skill re-scanned.

### Skills Sidebar Organization

- Built-in skills are grouped under **Built-in Skills** and then sub-categorized by operational area so the bundled tool set does not expand into one flat list.
- Custom skills can live at the root of the Skills sidebar or inside nested custom folders.
- Custom folders are persistent, can be created from the Skills title bar or from an existing folder row, and are reused by create-template, import, and draft flows.
- Imported custom skills now restore on activation together with their folder placement and stored scan state.

### Security Scanning

Every custom skill must pass a security scan before it can be enabled. The scanner checks source text line-by-line against 12 built-in rules:

| Rule | Severity | What it catches |
|---|---|---|
| `no-eval` | error | `eval()` calls |
| `no-function-constructor` | error | `new Function()` |
| `no-child-process-require/import` | error | `require('child_process')` / `from 'child_process'` |
| `no-shell-exec` | error | `exec`, `spawn`, `execSync`, etc. |
| `no-path-traversal` | error | `../` path traversal |
| `no-hardcoded-secret` | error | API keys, tokens, passwords in source |
| `no-process-env` | warning | `process.env` access |
| `no-direct-fetch` | warning | `fetch()`, `axios`, `got` |
| `no-http-require/import` | warning | Node `http`/`https` module |
| `no-fs-direct` | warning | `require('fs')` bypassing context |

Error-level issues **block** enablement. Warning-level issues are flagged but do not block.

Built-in skills are pre-approved and auto-pass at activation.

### Scanner Rule Configurator

Open the scanner rules editor from the Skills panel title bar (gear icon) or via `atlasmind.openScannerRules`. Users can:

- Toggle individual rules on/off.
- Edit severity and message for built-in rules (patterns are read-only to preserve integrity).
- Add custom rules with their own id, pattern (regex), severity, and message.
- Delete custom rules.
- Reset built-in rules to factory defaults.

### Adding Custom Skills

From the Skills panel title bar click **+** (or run `AtlasMind: Add Skill`):

1. **Create template** — scaffolds a `.js` CommonJS skill file in `.atlasmind/skills/` and opens it for editing.
2. **Import .js skill** — opens a file picker; the selected file is scanned first and only imported if no errors are found. The skill starts **disabled** so you can review it before enabling.
3. **Let Atlas draft a skill** — available only when `atlasmind.experimentalSkillLearningEnabled` is enabled. Atlas generates a draft `.js` module with the current routing budget/speed settings, scans it, writes it into `.atlasmind/skills/`, and only imports it if you explicitly confirm. Imported drafts remain **disabled** until you review and enable them.

AtlasMind also exposes **Create Skill Folder** from the Skills view so custom skills can be filed into persistent nested folders before or after import.

Custom skills must export `module.exports.skill` (or `module.exports.default`) as a valid `SkillDefinition` object.

### Experimental Skill Learning

AtlasMind can optionally draft custom skill files for you, but this feature is guarded behind an explicit opt-in setting and repeated warnings.

Safety behavior:
- The setting is disabled by default.
- Enabling it shows a warning about extra token usage and generated-code risk.
- Each generation run shows a second modal warning before any model call is made.
- Generated source is security-scanned before import.
- Imported drafts remain disabled until you manually review and enable them.

This is intended as assisted scaffolding, not autonomous self-trust.

### Mission Loop & capability discovery

The autonomous **Mission Loop** (`/loop` chat command and the Mission Control panel, backed by `src/core/missionRunner.ts`) sends agents out to "learn what's required" across multiple iterations — but it does so **prefer-existing and gated**:

- Each increment runs through the orchestrator's normal subtask execution, so it first uses already-registered agents, skills, and MCP tools.
- When `atlasmind.loop.allowDiscovery` is on, the loop may fill a genuine capability gap by **synthesizing** a new agent/skill (the same `skillDrafting`/`agentDrafting` paths as Experimental Skill Learning) or by using **Agentic Resource Discovery**. New capabilities pass the **existing approval gates** before use; nothing is silently auto-trusted.
- The loop never bypasses guarded delivery: a goal that implies staging/production deployment is surfaced as a checkpoint/`blocked` and routed through the `PromotionRunner` pipeline rather than executed directly.
- A goal is only judged **achieved** when the iteration shows passing verification where behaviour changed — the project's Testing Methodology Matrix and TDD policy are inherited automatically (see [Testing](#project-dashboard--testing-page)).

See [Project Planner](../wiki/Project-Planner.md) for how the loop relates to the single-pass planner and scheduler.

### Registering Skills

```typescript
atlas.skillsRegistry.register({
  id: 'file-read',
  name: 'Read File',
  description: 'Read the contents of a file in the workspace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute file path' },
    },
    required: ['path'],
  },
  execute: async (params, context) => context.readFile(params.path as string),
});
```

### Built-in Skills

The following skills are registered automatically at extension activation (`src/skills/`):

Approval surfaces receive a bounded host-produced argument preview rather than serializing tool parameters in the webview. `toJsonPreview` applies secret redaction and a length cap to representable JSON; a non-empty object that collapses to `{}` is labelled `[unserializable arguments]` so the operator is not asked to approve a falsely empty parameter set.

| Skill | Status | Description |
|---|---|---|
| `file-read` | ✅ Implemented | Read file contents (supports optional `startLine`/`endLine` range) |
| `file-write` | ✅ Implemented | Write/create files (workspace-restricted) |
| `file-search` | ✅ Implemented | Search workspace files by glob pattern |
| `text-search` | ✅ Implemented | Search text within UTF-8 workspace files and return matching lines |
| `directory-list` | ✅ Implemented | List files and folders under a workspace directory |
| `file-edit` | ✅ Implemented | Targeted literal search/replace editing with match-count guards |
| `file-delete` | ✅ Implemented | Delete a workspace file |
| `file-move` | ✅ Implemented | Move/rename a workspace file |
| `memory-query` | ✅ Implemented | Search the SSOT (capped at 50 results) |
| `memory-write` | ✅ Implemented | Add/update SSOT entries with validation, security scanning, and disk persistence |
| `memory-delete` | ✅ Implemented | Remove an SSOT entry from index and disk |
| `git-apply-patch` | ✅ Implemented | Validate/apply unified git patches inside the workspace repository |
| `terminal-run` | ✅ Implemented | Execute subprocesses with tiered allow-list (auto-approve, blocked, unknown) and shell-aware argument parsing (handles single/double-quoted spans and backslash escapes); supports Node, Python, Rust, Go, Java, Ruby, PHP, Flutter, Dart, Expo, Elixir, Terraform, Helm, Kubectl, Godot, Turbo/Nx and more |
| `git-status` | ✅ Implemented | Show repository status |
| `git-diff` | ✅ Implemented | Show repository diff (staged or against a ref) |
| `git-commit` | ✅ Implemented | Create a commit with a message passed directly to git (no shell quoting needed); optional `stage_tracked` boolean runs `git add -u` first; allows up to 120 s for repository pre-commit hooks |
| `git-log` | ✅ Implemented | Query commit log with ref, filePath, and maxCount (capped at 100) |
| `git-branch` | ✅ Implemented | List, create, switch, or delete branches with name validation |
| `rollback-checkpoint` | ✅ Implemented | Restore the most recent automatic pre-write checkpoint |
| `diagnostics` | ✅ Implemented | Retrieve compiler errors/warnings via the VS Code diagnostics API |
| `code-symbols` | ✅ Implemented | AST-aware navigation: list symbols, find references, go to definition |
| `rename-symbol` | ✅ Implemented | Cross-codebase rename via the language server with identifier validation |
| `web-fetch` | ✅ Implemented | Fetch URL content with SSRF protection; 30 s skill timeout |
| `test-run` | ✅ Implemented | Auto-detect framework (vitest/jest/mocha/pytest/cargo) and run tests; 120 s skill timeout |
| `diff-preview` | ✅ Implemented | Combined git status + diff summary with add/modify/delete counts |
| `code-action` | ✅ Implemented | List and apply VS Code quick-fixes and refactorings |
| `workspace-observability` | ✅ Implemented | Snapshot of active debug session, open terminals, and most recent test run results |
| `exa-search` | ✅ Implemented | Search the web using the EXA AI search API; requires EXA API key stored in Specialist Integrations panel |
| `discover-resources` | ✅ Implemented | Read-only [Agentic Resource Discovery](resource-discovery.md) search across enabled Agent Finders for MCP servers, agents, skills, and APIs. Surfaces ranked candidates (with a "score is relevance, not trust" disclaimer) for the user to install; never installs anything itself. Registered only when `atlasmind.ard.enabled` is true. |
| `debug-session` | ✅ Implemented | List active VS Code debug sessions and evaluate expressions in the paused debug context |
| `terminal-read` | ✅ Implemented | List open VS Code integrated terminals, summarize the active terminal, and prompt for pasted buffer content when direct reads are unavailable |
| `vscode-extensions` | ✅ Implemented | List installed extensions, identify common developer-tooling extensions, and report forwarded ports from the Ports panel |
| `npm-scripts` | ✅ Implemented | List and run package.json scripts; supports listing all scripts and executing any named script via npm run |
| `log-file-tail` | ✅ Implemented | Find workspace log files (*.log, logs/*.txt, etc.), tail the last N lines, or grep for a pattern across all log files |
| `framework-detect` | ✅ Implemented | Detect the tech stack from package.json deps and config-file fingerprints; covers web, mobile, game, desktop, SaaS, infra, and testing tools |
| `specialist-guidance` | ✅ Implemented | Load one focused SEO or UX checklist on demand; explicitly classified `read/low` because it returns bundled text only, while recommended live checks remain separate calls |
| `git-blame` | ✅ Implemented | Show per-line commit attribution (author, date, hash, summary) with optional line-range focus |
| `simple-browser` | ✅ Implemented | Open a URL in the VS Code built-in Simple Browser panel; useful for previewing dev servers, dashboards, and HTML5 games |
| `debug-launch` | ✅ Implemented | List VS Code debug configurations from launch.json and start a debug session by configuration name |
| `debug-breakpoint` | ✅ Implemented | List, add (with optional condition or logpoint), remove by ID, and clear all breakpoints |
| `diagram-gen` | 🔲 Planned | Generate Mermaid diagrams |

### MCP-Sourced Skills

AtlasMind can connect to any [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server and expose its tools as skills. Open **AtlasMind: Manage MCP Servers** to configure servers, or run **AtlasMind: Import VS Code MCP Servers** to copy compatible entries from the current VS Code profile `mcp.json` and workspace `.vscode/mcp.json` files.

**Guided Setup wizard** (`src/views/mcpPanel.ts`): the panel leads with a step-by-step flow for first-time users — **Scan my computer** (`McpServerRegistry.detectAvailableServers()` surfaces only servers whose runtime is present) or **Browse by category** → prerequisite check (missing runtimes install only after confirmation, via `src/mcp/mcpRuntime.ts`) → guided credential/parameter fields → connect. Recommended starters declare typed `inputs` (`RecommendedMcpInput` in `src/constants.ts`); secret-kind values are stored in VS Code SecretStorage (`McpServerConfig.secretEnvKeys`) and merged into the process env only at connect time. The former raw form remains under the **Advanced** tab (and backs editing an existing server).

**Buzz Communications (Tier 1b)** is a first-party guided starter for the extension-bundled `buzzCommsServer.ts`, not for Buzz's developer MCP. It wraps official pinned `buzz-cli` source tag v0.4.26 and registers `buzz_list_channels`, `buzz_post_message`, `buzz_read_thread`, and `buzz_send_dm`. The starter stores `BUZZ_PRIVATE_KEY` and optional `BUZZ_AUTH_TAG` in SecretStorage, takes the executable path as non-secret configuration, and injects the existing Buzz enable/relay/remote-consent settings through a closed template allowlist. Because the upstream v0.4.26 CLI does not expose a working `--version` flag, the server probes the exact required command/flag surface and refuses an incompatible CLI or disallowed relay before completing the MCP handshake. Its tool surface is intentionally communication-only: no shell, files, workflows, repositories, administration, identity minting, or message mirroring.

**Skill ID pattern**: `mcp:<serverId>:<toolName>`  
**Source field**: `mcp://<serverId>/<toolName>`

MCP skills are registered in `SkillsRegistry` when a server connects and automatically marked as scan-passed (external process; trust is delegated to the server operator by the user who explicitly configured the connection). They can be individually disabled from the Skills view.

### ACP process lifetime does not widen ACP authority

ACP availability does not widen vendor entitlement either. A published launch
command says the process speaks ACP; it does not say the user's plan may call
the backing service. Gemini CLI is offered only with the explicit requirement
for an assigned Gemini Code Assist Standard or Enterprise license. Personal
Google AI Pro, Ultra, and free accounts stopped working with Gemini CLI on
18 June 2026, so setup states that boundary before installing or probing.

The routed ACP adapter may keep a successful agent session alive for 30 idle
minutes, but every operation in every turn still traverses the same
`session/request_permission` policy. The live `acp.toolsEnabled` value is read
again for each request and automatically produces only a one-operation
`allow_once` response; `allow_always` is never selected, and a missing or
throwing policy still denies. Disabling tools, changing the MCP allowlist, or
crossing between completion-only isolation and delegated execution invalidates
the session before another prompt is sent.

`atlasmind.acp.toolsEnabled` now participates in routing as well as permission handling. The adapter advertises only the distinct `delegatedToolExecution` shape and never claims it can consume AtlasMind `function_calling` schemas. The live setting makes a route eligible, but the Orchestrator must also stamp the individual `CompletionRequest` with delegated-execution authority. The ACP adapter requires both; omitted or false request authority creates an isolated completion-only session, shares no MCP servers, and wires no approval policy even while the global setting remains on. An empty MCP allowlist does not switch an authorized delegated turn back to completion-only mode because its built-in tools may still exist.

Change Story **Ask Atlas** is deliberately one such completion-only turn. The extension host reads the selected path from the exact committed head ref first, and the Orchestrator serializes the validated, bounded evidence into a model-visible user message. It clears workspace skills and ACP request authority for that turn so an external agent cannot replace exact-ref evidence with commands against the checked-out branch.

Conversation reuse is exact, not inferred. AtlasMind records the outer
transcript and sends only a suffix after proving the record is a byte-for-byte
message prefix of the next request. A branch or edited instruction gets another
session. A stable task identity lets concurrent calls for the same tool round
share one `session/prompt` without merging separate chats whose words happen to
match. ACP bypasses the generic transient-provider retry loop, so a failure
after a prompt may have crossed stdio is never automatically resent. The outer
provider timeout aborts the ACP attempt, sends `session/cancel`, and tears down
the uncertain session. This matters for tools as much as cost — duplicating a
prompt to an agent that may act can duplicate the requested operation even
though each individual operation remains visible in the permission and tool logs.

On Windows, `atlasmind.acp.hideConsoleWindows` changes where the process tree's
windows may appear, not what the process may do. The helper now creates a
non-interactive window station plus its default private desktop with Windows'
documented non-interactive UI-object access sets; Windows permits visible UI only
on `WinSta0`, so a descendant that chooses a new desktop cannot escape back to
the input screen merely by declining inheritance. The child inherits the
helper's established station/desktop connection instead of reopening generated
names, which lets PowerShell initialize without weakening the token-default ACL.
The supervisor creates one `SW_HIDE` console before the agent runs, so Node,
native CLIs, and later shells inherit the same non-visible console instead of
allocating separate `conhost.exe` windows. `CREATE_NO_WINDOW` is deliberately
not used: it hid only the first process and left descendants with no console to
inherit. Windows npm adapters are also resolved to a real `node.exe`; VS Code's
GUI `Code.exe` is refused as a JavaScript runtime.
Inherited system-error flags also turn a loader failure into a process failure
instead of a modal dialog that blocks Chat. This is neither a sandbox nor an
authorization boundary; the agent retains the same user-level filesystem/network
access. It is opt-in and disclosed because unusual hidden UI boundaries and an
unsigned native helper can attract application-control/EDR detection. The same
value is reachable from three places that all write it: the guided picker
(**AtlasMind: Choose ACP Console Window Behaviour**), the *Delegated agents
(ACP)* card on Settings → Safety & Verification, and VS Code's settings editor.
The panel checkbox exists because the control was previously in VS Code's editor
only, so searching the AtlasMind Settings panel for it found nothing.

### AtlasMind as an ACP agent

AtlasMind also exposes the reciprocal ACP direction through `atlasmind-acp`.
An ACP client creates a session and submits a prompt; AtlasMind still selects
the agent, gathers SSOT memory, routes the model, resolves skills, and applies
its tool policy. The client does not choose an AtlasMind specialist merely by
naming a Buzz identity or Director contact.

The endpoint is local stdio only. It accepts text and text-bearing embedded
resources, retains at most 80,000 characters of session history, streams
`agent_message_chunk` updates, and propagates `session/cancel` through the task's
abort signal. One turn may execute at a time because the core orchestrator owns
one active execution context.

Tool authority crosses the seam explicitly. Read-only categories retain the
headless default; everything else asks the ACP client through
`session/request_permission`, with **Allow once** and **Reject** as the only
options. A client response naming `allow_always`, a missing prompt context, or
a failed permission request denies. Client-declared MCP commands are ignored
rather than spawned.

Buzz uses this endpoint as a **Custom command** behind its own `buzz-acp`
harness. The Director's Person/channel record remains contact and inbound-work
routing metadata; it neither creates nor starts that managed agent. The
workspace-specific recipe from **AtlasMind: Copy Buzz ACP Agent Setup** supplies
the executable and arguments, while AtlasMind continues to own model selection.
VS Code SecretStorage credentials are never copied to Buzz.

**Workspace-path defaulting**: Before dispatch, `McpClient.callTool` (`applyMcpWorkspacePathDefaults`) fills repo/working-directory parameters the model omitted with the current workspace folder, keyed off the tool's input schema. This prevents failures such as GitKraken `git_status` rejecting a call with "repoPath is required". Only string-typed, currently-empty params whose name denotes a repo/working path (`repoPath`, `projectPath`, `cwd`, `workingDirectory`, …) are defaulted; a bare `path`/`file` argument is untouched and explicit caller values are preserved.

**Transport options**:

| Transport | When to use | Config fields |
|---|---|---|
| `stdio` | Local subprocess (e.g. `npx -y @modelcontextprotocol/server-filesystem`) | `command`, `args`, `env` |
| `http` | Remote server (Streamable HTTP, SSE fallback auto-applied) | `url` |

**Security notes**:
- MCP tools execute in a separate process or remote service — they are not sandboxed within the extension.
- The URL field must use `http://` or `https://`; other schemes are rejected.
- Env vars for stdio servers are merged with the extension host environment. Secrets entered through the Guided Setup wizard are stored in VS Code SecretStorage (via `McpServerConfig.secretEnvKeys`), never in `globalState`, and injected only at connect time; if you use the Advanced form's raw `env` field, prefer the server's native secret management for sensitive values.
- The bundled Buzz bridge adds a second boundary inside stdio: it calls the CLI without a shell, sends message text over stdin, validates channel/event/pubkey identifiers, caps process time and output, and redacts the Buzz key/authorization grant from errors. Remote relays require both explicit `allowRemoteRelay` consent and TLS.
- AtlasMind only imports MCP entries it can reproduce faithfully. VS Code-only fields such as sandbox settings, unresolved `${...}` variables, custom headers, or other unsupported transport options are skipped instead of being downgraded silently.

---

## Context Bundle

For each task, the orchestrator builds a context bundle containing:

1. **Agent system prompt** — from `AgentDefinition.systemPrompt`.
2. **Relevant memory slices** — from `MemoryManager.queryRelevant()`.
3. **Selected callable tool schemas** — the bounded result of agent policy, per-turn relevance, and capability-envelope narrowing.
4. **User message** — the original request.
5. **Conversation history** — from the chat context.

This bundle is sent to the selected model via the appropriate `ProviderAdapter`.

Current MVP behavior:
- The context bundle is actively built and sent through the orchestrator.
- Skills are not repeated as prose in the system message. Each selected skill's description, natural-language cues, and JSON parameters appear once in the provider's callable tool-definition field.
- Tool-schema tokens are included in initial request estimates, memory/session prompt budgets, and per-round context-window headroom.
- ACP completion-only and delegated-native-tool attempts receive an empty AtlasMind schema list and no AtlasMind skill catalogue; ordinary-provider failover restores the selected schemas.
- Memory slices come from `MemoryManager.queryRelevant()`.
- When a provider adapter is missing, orchestration returns a safe error response instead of throwing.

## Extension Paths Summary

AtlasMind supports four practical extension paths today:

1. **Add or edit agents** through the Agent Manager panel or `AgentRegistry.register()`.
2. **Add skills** as built-in handlers, imported custom skills, or MCP-backed tools.
3. **Add routed models** by implementing `ProviderAdapter` and registering the provider through the shared runtime.
4. **Add specialist integrations** through dedicated panels when the upstream API is not a good fit for the generic routed chat contract.

The important distinction is that routed providers must support AtlasMind's chat, capability, pricing, and health model, while specialist integrations can remain workflow-specific.
