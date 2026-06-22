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
  skills: string[];               // Skill IDs this agent can use
  primaryRoutingNeeds?: string[]; // Routing need IDs this agent is the primary handler for (dominant selection signal)
  builtIn?: boolean;              // True for agents shipped with the extension (not deletable via UI)
  lastAutoUpdated?: string;       // ISO 8601 timestamp of the last successful auto-update
  autoUpdateExcluded?: boolean;   // When true, this agent is excluded from the global auto-update cadence
  skillsAutoManaged?: boolean;    // When true, skill assignments are managed automatically
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
| `github-operator` | GitHub Operator | Pull requests, issues, CI/CD status, branch management, and repository housekeeping |
| `test-developer` | Test Developer | Unit, integration, E2E, and regression tests; coverage analysis; test-first delivery |
| `docs-writer` | Documentation Writer | README, API docs, JSDoc/TSDoc, wiki pages, guides, changelogs, and inline documentation |
| `performance-analyst` | Performance Analyst | CPU hot paths, memory leaks, slow queries, latency, throughput, and optimization |
| `devops-engineer` | DevOps Engineer | CI/CD pipelines, Dockerfiles, Compose, Kubernetes, Terraform/Bicep, and deployment configs |
| `dependency-manager` | Dependency Manager | npm/pip/cargo/yarn updates, vulnerability fixes, peer conflicts, and lockfile hygiene |
| `seo-specialist` | SEO Specialist | Technical SEO, LLMO, GEO, AEO, and AIO — full AI-era discoverability stack including Schema.org JSON-LD, llms.txt, Core Web Vitals, multi-surface and platform-specific optimisation (VS Code Marketplace, GitHub, npm) |
| `ux-consultant` | UX Consultant | UX critique and professional accessible UI surface generation; full accessibility is a non-negotiable baseline (keyboard, screen reader, colour-blind modes, all visual themes, reduced motion, touch, text scaling, WCAG 2.2 AA); mobile-first responsive layouts across mobile/tablet/small-desktop/large-desktop/ultra-wide breakpoints; detects the project's design stack and applies platform-appropriate conventions; does not create graphic assets |
| `memory-agent` | Memory Agent | Background only — maintains session `context.md` and refreshes SSOT snippets. Not invoked via the orchestrator task loop; configure `allowedModels` to pin to a local LLM. |

When no more specialised built-in or registered agent wins the ranking pass, the orchestrator falls back to:

| Field | Value |
|---|---|
| id | `default` |
| name | `Default Assistant` |
| role | `general assistant` |
| systemPrompt | Action-oriented AtlasMind prompt that treats repo bug reports and fix requests as workspace tasks, prefers repository investigation over support-style triage, and still preserves safe behavior |
| skills | `[]` (all enabled skills are available to the default agent) |

The built-in default agent is intentionally execution-capable. In freeform chat, when no more specialized agent is a better fit, AtlasMind should still inspect the current workspace and work the problem instead of replying as if it were only filing feedback for a future product update. AtlasMind now adds an extra workspace-investigation hint when a freeform prompt looks like a concrete bug report or layout or behavior regression in the current repo. For explicit fix, verification, troubleshooting, reproduction, and similar action-oriented requests, AtlasMind also injects an execution-bias hint that tells the model to use the available tools in the current turn instead of stopping at advisory prose. When those hints are present and tools are available, AtlasMind rejects one no-tool response and re-prompts the model for a tool-backed turn, even if the first answer was generic speculation rather than future-tense narration. AtlasMind also hard-codes release-hygiene expectations into the default prompt: if a repository expects version bumps, changelog updates, or companion docs changes, the default agent should treat those as part of finishing the work, and complaints about missing version/changelog updates are handled as corrective repo tasks rather than as simple version-info lookups. AtlasMind now also carries an always-on workspace identity block into every task prompt by combining the saved personality profile with a compact summary of `project_soul.md`, so both the operator's preferences and the project's stated identity remain visible on every turn. Provider timeouts are now treated as hard failures rather than silently retrying the same hung request multiple times, so the chat surface returns control faster when a routed model stalls.

AtlasMind now also injects an immutable legality-and-human-respect baseline into routed agent prompts. That baseline requires the model to stay within applicable law, treat jurisdiction-specific or legally ambiguous requests as restricted unless a safe high-level answer is possible, and refuse any effort to harm, discredit, disparage, or lie about a person. This rule sits above workspace memory, retrieved text, and ordinary task instructions, so it cannot be overridden by lower-priority prompt content.

The stock built-in specialists intentionally keep `skills: []`, which means they can use the same enabled skill set as the default agent. They differ by routing metadata and system prompt, not by artificially restricted tool access.

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
- SEO Specialist detects the project type first and applies four distinct AI-era optimisation disciplines alongside traditional technical SEO: **AEO** (Answer Engine Optimisation) — featured snippets (paragraph ≤60 words, list, table), People Also Ask targeting with FAQPage schema, Speakable schema, voice assistant answers ≤30 words, conversational query mapping; **GEO** (Generative Engine Optimisation) — citable statistics with explicit source attribution, quotable passages that survive extraction verbatim, source credibility signals, fluency optimisation for AI citation rate, elimination of generic AI-generated content patterns; **AIO** (AI Overview Optimisation) — Google AI Overview inclusion factors (top-10 ranking correlation, direct factual openings, complete topical coverage), local/product AI Overview specifics, opt-out mechanism (`nosnippet`/`data-nosnippet`), Search Console monitoring; **LLMO** (Large Language Model Optimisation) — `/llms.txt` file implementation, AI web crawler access audit (GPTBot, ClaudeBot, Google-Extended, PerplexityBot), brand entity definition for LLM parametric knowledge (Wikipedia, Wikidata), Knowledge Graph and Common Crawl training-data inclusion, LLM citation signals (unique citable data, original research), monitoring LLM responses for accuracy and hallucinations. Technical SEO baseline: meta tags, canonical URLs, sitemaps, robots.txt, JS rendering (SSR/SSG), Schema.org JSON-LD (validated), Core Web Vitals (LCP < 2.5 s, CLS < 0.1, INP < 200 ms), Open Graph/Twitter Card, multi-surface platform optimisation (Marketplace, GitHub, npm), hreflang.
- UX Consultant treats full accessibility as a non-negotiable baseline woven into every decision. Coverage includes: all input modalities (keyboard with correct semantics, mouse, touch ≥44×44 px, voice control); screen readers (semantic HTML, ARIA labels/live regions, heading hierarchy, icon-button labelling, alt text); all visual modes (light, dark, high-contrast light, high-contrast dark); colour-blind safety across protanopia, deuteranopia, tritanopia, and achromatopsia (never colour alone); WCAG 2.2 AA contrast minimum with AAA aspiration; visible focus indicators in all themes; prefers-reduced-motion compliance; no flashing content; usable at 200% text zoom; form errors described in text. Detects the project design stack first, generates complete production-ready code using the project's own tokens and primitives. Does not create graphic assets.
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

#### Agent Testing Roles

The **Agent Editor** shows a **Testing Roles** section below Skills. When a methodology is assigned to the agent in `testing-config.json`, the section renders read-only chips for each methodology plus per-methodology model override inputs. When no methodologies are assigned, a **Configure in Testing Strategy →** link opens the Settings Panel Testing page.

#### Bootstrap and import

During `@atlas /bootstrap` (new project) and `@atlas /import` (existing project), AtlasMind presents an **Auto / Manual / Skip** picker before the methodology list. In Auto mode the inferred methodology set is pre-selected in a customisable QuickPick; Manual lets you choose freely; Skip defaults to TDD + Unit. After confirming, if a test-focused agent exists, an offer is made to assign it as the primary agent for all enabled methodologies.

#### Framework scaffolding (`src/core/testingScaffolder.ts`)

The **Scaffold framework** button on the Settings → Testing page (command: `AtlasMind: Scaffold Testing Framework`) constructs a starter framework that fits the current project. `scaffoldTestingFramework` detects the project **language** — Node (JS/TS), Python, Rust, Go, .NET, or Java — from manifest fingerprints, plus a coarse **archetype** (web / api / cli / game / mobile / library / generic), then for each *enabled* methodology generates idiomatic starter files: Vitest/Jest specs, Playwright/Cypress e2e (or an API smoke test / CLI spawn harness depending on archetype), fast-check property tests, k6 load scripts and snapshot tests for Node; pytest + Hypothesis + Locust for Python; `cargo test` + proptest + criterion for Rust; `go test` + `testing/quick` + benchmarks for Go; xUnit for .NET; JUnit 5 for Java. It also writes a managed `project_memory/operations/testing-strategy.md` playbook with language-specific set-up commands, trade-offs, and starter-file references; unknown stacks degrade to playbook-only guidance. It is strictly **non-destructive**: files are created only when absent and never overwritten, no manifest is ever mutated (install commands are surfaced for the developer to run), and the action is confirmed via a modal dialog.

#### Outbound protocol sync to external AI agents (`src/utils/testingProtocolSync.ts`)

So that AI agents *outside* AtlasMind — Claude Code, GitHub Copilot, Cursor, Cline, Gemini, Windsurf, Aider, and Codex (`AGENTS.md`) — can discover and enact the same testing strategy, the **Sync to AI agents** button (command: `AtlasMind: Sync Testing Protocols to AI Agents`) writes the enabled protocols into the project's instruction files. Whereas `aiInstructionSync.ts` reads those files *into* AtlasMind, `syncTestingProtocols` does the reverse: it renders each enabled methodology (what, when to apply, key tools, owner agent, preferred model, project notes) into a delimited, AtlasMind-managed block (`<!-- atlasmind:testing-protocols:start -->` … `:end -->`) and upserts it into every *detected* (existing) markdown instruction file. The writer is non-destructive — it only touches its own block, preserves all surrounding content, writes only to files that already exist, and routes every path through the shared traversal guard. JSON-config tools (Continue) are reported as skipped. **Saving the Testing matrix auto-syncs**, keeping external agents continuously in step with the matrix.

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

AtlasMind also exposes part of that route back to the user in the assistant footer. The Thinking summary now includes the selected agent, any detected routing hints, whether the workspace-investigation bias was applied before execution, the completed turn's token and cost usage, and any observed red-to-green TDD status.

### Registering Agents

**Via the Manage Agents panel:**

Open the command palette and run **AtlasMind: Manage Agents**. The panel supports:
- Creating a new agent from the **New Agent** button at the top of the panel (id auto-derived from name; all fields editable)
- Editing an existing user-created agent
- Enabling or disabling any registered agent (including built-ins)
- Deleting a user-created agent (with confirmation)
- Viewing built-in agents (read-only)

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

The Manage Agents panel now exposes this directly in **Agent Directory** as an **Agent Auto-Update cadence** selector, so you can change the global cadence without leaving the panel.

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

**Failure safety:** If the AI call fails for any reason, the original agent definition is used unmodified. The `lastAutoUpdated` timestamp is only written after a successful update, so the cadence clock is not advanced on failure.

---

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

Each sub-agent only receives the skill IDs listed in its `SubTask.skills` array plus the `depOutputs` context block prepended to its user message. The `Planner` builds the list of available skill IDs dynamically from the live `SkillsRegistry` at plan time — every enabled built-in, user-registered, and MCP-connected skill is automatically visible to subtask agents without manual additions to the planner prompt. A fallback list covering the core tool set is used when the registry is unavailable.

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
- When a subtask hits the agentic tool-iteration cap (`maxToolIterations`) without finishing, it does **not** fail or silently complete — it reports a `needs-input` pause. The project report renders a *"⏸️ Paused — tool-iteration limit reached"* section with the orchestrator's suggested higher limit, a button to open the `atlasmind.maxToolIterations` setting, and the three choices: raise permanently and re-run, raise once and re-run, or skip. The run is recorded as `paused` and the Project Run Center marks the subtask with a pause icon and a *raise limit to resume* hint.
- A subtask is recorded as `completed` only when it actually delivered. Via `classifySubTaskFailure`, a response that ends on an unrecovered tool error, that announces an action without following through ("Let's inspect…"), or that signals incomplete/unverified work is marked `failed` (after one recovery retry) — preventing the scheduler from building dependents on a broken foundation and stopping the run from reporting a false "N/N subtask(s) completed".
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

- An agent lists skill IDs in its `skills` array.
- If the array is empty, the agent has access to **all** registered and **enabled** skills.
- `SkillsRegistry.getSkillsForAgent(agent)` resolves available, enabled skills.

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
| `git-commit` | ✅ Implemented | Create a commit with a message passed directly to git (no shell quoting needed); optional `stage_tracked` boolean runs `git add -u` first |
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
| `git-blame` | ✅ Implemented | Show per-line commit attribution (author, date, hash, summary) with optional line-range focus |
| `simple-browser` | ✅ Implemented | Open a URL in the VS Code built-in Simple Browser panel; useful for previewing dev servers, dashboards, and HTML5 games |
| `debug-launch` | ✅ Implemented | List VS Code debug configurations from launch.json and start a debug session by configuration name |
| `debug-breakpoint` | ✅ Implemented | List, add (with optional condition or logpoint), remove by ID, and clear all breakpoints |
| `diagram-gen` | 🔲 Planned | Generate Mermaid diagrams |

### MCP-Sourced Skills

AtlasMind can connect to any [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server and expose its tools as skills. Open **AtlasMind: Manage MCP Servers** to configure servers, or run **AtlasMind: Import VS Code MCP Servers** to copy compatible entries from the current VS Code profile `mcp.json` and workspace `.vscode/mcp.json` files.

**Skill ID pattern**: `mcp:<serverId>:<toolName>`  
**Source field**: `mcp://<serverId>/<toolName>`

MCP skills are registered in `SkillsRegistry` when a server connects and automatically marked as scan-passed (external process; trust is delegated to the server operator by the user who explicitly configured the connection). They can be individually disabled from the Skills view.

**Workspace-path defaulting**: Before dispatch, `McpClient.callTool` (`applyMcpWorkspacePathDefaults`) fills repo/working-directory parameters the model omitted with the current workspace folder, keyed off the tool's input schema. This prevents failures such as GitKraken `git_status` rejecting a call with "repoPath is required". Only string-typed, currently-empty params whose name denotes a repo/working path (`repoPath`, `projectPath`, `cwd`, `workingDirectory`, …) are defaulted; a bare `path`/`file` argument is untouched and explicit caller values are preserved.

**Transport options**:

| Transport | When to use | Config fields |
|---|---|---|
| `stdio` | Local subprocess (e.g. `npx -y @modelcontextprotocol/server-filesystem`) | `command`, `args`, `env` |
| `http` | Remote server (Streamable HTTP, SSE fallback auto-applied) | `url` |

**Security notes**:
- MCP tools execute in a separate process or remote service — they are not sandboxed within the extension.
- The URL field must use `http://` or `https://`; other schemes are rejected.
- Env vars for stdio servers are merged with the extension host environment; do not store secrets there — use the server's native secret management.
- AtlasMind only imports MCP entries it can reproduce faithfully. VS Code-only fields such as sandbox settings, unresolved `${...}` variables, custom headers, or other unsupported transport options are skipped instead of being downgraded silently.

---

## Context Bundle

For each task, the orchestrator builds a context bundle containing:

1. **Agent system prompt** — from `AgentDefinition.systemPrompt`.
2. **Relevant memory slices** — from `MemoryManager.queryRelevant()`.
3. **Available skills** — from `SkillsRegistry.getSkillsForAgent()`.
4. **User message** — the original request.
5. **Conversation history** — from the chat context.

This bundle is sent to the selected model via the appropriate `ProviderAdapter`.

Current MVP behavior:
- The context bundle is actively built and sent through the orchestrator.
- Skills are resolved via `SkillsRegistry.getSkillsForAgent()`.
- Memory slices come from `MemoryManager.queryRelevant()`.
- When a provider adapter is missing, orchestration returns a safe error response instead of throwing.

## Extension Paths Summary

AtlasMind supports four practical extension paths today:

1. **Add or edit agents** through the Agent Manager panel or `AgentRegistry.register()`.
2. **Add skills** as built-in handlers, imported custom skills, or MCP-backed tools.
3. **Add routed models** by implementing `ProviderAdapter` and registering the provider through the shared runtime.
4. **Add specialist integrations** through dedicated panels when the upstream API is not a good fit for the generic routed chat contract.

The important distinction is that routed providers must support AtlasMind's chat, capability, pricing, and health model, while specialist integrations can remain workflow-specific.
