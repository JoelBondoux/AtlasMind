<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind</h1>

<p align="center"><sub> · <strong>Current source version: 0.141.7</strong> · </sub></p>


<p align="center">
  <strong>BETA</strong><br/>
  <strong>AtlasMind is your AI teammate for solo and small dev teams.</strong><br/>
  <em>Ship faster, automate the boring parts, and keep your project's brain in one place — all inside VS Code.</em>
</p>


---


AtlasMind is built for indie developers, freelancers, and small teams who want to get more done without context switching or tool overload. It's not just a chatbot — it's a multi-agent orchestrator that routes your tasks to the right AI, remembers your decisions, and helps you focus on what matters most.

**Why solo and small devs love AtlasMind:**

- **No more context switching:** Everything happens in your editor — chat, code, memory, and planning.
- **Automate the grind:** Refactoring, testing, docs, and more — handled by specialized agents.
- **Bring your own models:** Use Local LLM, OpenAI, Claude, Gemini, Azure, or your favorite provider. Mix and match for cost, speed, or quality.
- **Project memory that sticks:** AtlasMind remembers your architecture, decisions, and lessons learned, so you don't have to.
- **Stay in control:** Approvals, cost tracking, and safety guardrails keep you in the driver's seat.
- **Secure and reliable by default:** Strong security guardrails and a configurable 23-methodology testing strategy system — TDD, BDD, E2E, security, performance, and more — with per-agent assignment, auto-detect, and AI token impact guidance so you can build with confidence from day one.
- **Everything at a glance:** Project, run, personality, and cost dashboards keep you in control — review agent runs, memory, and spend in one place.

---




## What Makes AtlasMind Different?




| Feature | AtlasMind | Copilot | Claude Code | Cline | Cursor |
|---|:---:|:---:|:---:|:---:|:---:|
| Multi-agent workflow | ✅ | <span title="Copilot supports some agent-like flows but not true multi-agent orchestration.">⚠️</span> | ✅ | <span title="Cline is a single agent with a plan/act loop, not multi-agent orchestration.">⚠️</span> | <span title="Cursor supports some agent-like flows but not true multi-agent orchestration.">⚠️</span> |
| Goal-seeking autonomous loops (Mission Control) | ✅ | <span title="Copilot agent mode and the cloud coding agent run agentic loops, but without a goal-bounded budget/iteration/time envelope.">⚠️</span> | <span title="Claude Code's /loop runs on an interval or self-paces, but without AtlasMind's cost/iteration envelope, per-iteration goal self-evaluation, and persisted audit trail.">⚠️</span> | <span title="Cline's auto-approve/YOLO mode keeps acting on a task, but without goal self-evaluation or a budget/iteration envelope.">⚠️</span> | <span title="Cursor's agent and background agents iterate autonomously, but without a goal-bounded budget/iteration envelope.">⚠️</span> |
| Model provider choice | ✅ | <span title="Copilot supports only GitHub-hosted models, not bring-your-own.">⚠️</span> | <span title="Claude Code supports only Anthropic models.">⚠️</span> | <span title="Cline supports OpenAI-compatible providers and configurable endpoints.">✅</span> | ✅ |
| Project memory (SSOT) | ✅ | <span title="Copilot has session memory but not persistent project SSOT.">⚠️</span> | <span title="Claude Code has session memory but not persistent project SSOT.">⚠️</span> | <span title="Cline can use rules and context, but not AtlasMind-style persistent project SSOT.">⚠️</span> | <span title="Cursor has session memory but not persistent project SSOT.">⚠️</span> |
| Approval/safety gates | ✅ | <span title="Copilot has some safety checks but not approval gating.">⚠️</span> | ✅ | ✅ | <span title="Cursor has some safety checks but not approval gating.">⚠️</span> |
| Cost tracking | ✅ | ❌ | <span title="Claude Code shows session token cost via /cost, but not AtlasMind-style per-model cost dashboards.">⚠️</span> | <span title="Cline shows usage and token costs, but not AtlasMind-style cost dashboards.">⚠️</span> | <span title="Cursor has a usage dashboard and spend caps, but not AtlasMind-style per-request/per-model cost dashboards.">⚠️</span> |
| VS Code native | ✅ | ✅ | ✅ | ✅ | ✅ |
| Built-in dashboards | ✅ | <span title="Copilot has some usage stats but not full dashboards.">⚠️</span> | <span title="Claude Code has some usage stats but not full dashboards.">⚠️</span> | <span title="Cline surfaces usage and settings views, but not AtlasMind-style project/run/cost dashboards.">⚠️</span> | <span title="Cursor has some usage stats but not full dashboards.">⚠️</span> |
| Extensible with MCP servers | ✅ | ✅ | ✅ | ✅ | ✅ |
| Secure by default | ✅ | <span title="Copilot has security features but not full sandboxing or approval gating.">⚠️</span> | <span title="Claude Code has security features but not full sandboxing or approval gating.">⚠️</span> | <span title="Cline has strong approval controls, but not AtlasMind's full security guardrail stack.">⚠️</span> | <span title="Cursor has security features but not full sandboxing or approval gating.">⚠️</span> |
| Configurable testing methodology system | ✅ | ❌ | ❌ | ❌ | ❌ |

- **Multi-agent orchestration**: 18 built-in specialized agents — debugger, frontend/backend engineers, reviewer, security, SEO, UX, DevOps, plus ethics/legal/commercial oversight advisors — and instant AI-drafted custom agents on demand.
- **Multi-provider model routing**: Supports GitHub Copilot, Claude, GPT, Gemini, Azure OpenAI, Bedrock, Mistral, and more. Budget and speed preferences steer selection automatically.
- **Built-in skills**: 43 pre-built skills including file editing, git, diagnostics, code navigation, test running, debugging, HTTP requests, Docker, web fetch, and more. Skills are grouped by category and support custom folders. Agents use AI-driven auto skill assignment by default.
- **Long-term project memory (SSOT)**: Decisions, architecture notes, and lessons learned persist in a structured memory folder. A dedicated Memory Agent maintains session context and keeps SSOT snippets fresh as source files evolve.
- **Project planner**: Decompose goals into subtasks, preview impact, gate execution, and review results.
- **Website Studio**: Run a client website from normalized intake through sitemap, wireframes, high-fidelity UI decisions, a fixed Develop → Staging → Production hosting pipeline, platform readiness, and n8n workflow mapping. Targets include Cloudflare Pages, GitHub Pages, WordPress/Elementor, Vercel, Netlify, Azure Static Web Apps, Shopify, Webflow, and custom hosting.
- **Cost tracking**: Real-time per-session spend with budget guardrails and a daily cost limit.
- **MCP server support**: Extend AtlasMind with Model Context Protocol (MCP) servers for custom tools, agent extensions, and advanced workflows.
- **Voice & Vision**: Speak your prompts and hear responses via the Voice Panel (TTS/STT). Attach workspace images to any question via the Vision Panel for multimodal analysis.
- **Session management**: Name, organize into folders, archive, and restore chat sessions for long-running projects.

---



## Quick Start

1. Install **AtlasMind** from the VS Code Marketplace.
2. Open **AtlasMind: Manage Model Providers** and configure your first model provider.
3. Start AtlasMind in your workspace:
  - For a new project, run `@atlas /bootstrap`.
  - For an existing project, run `@atlas /import`.
4. Ask AtlasMind to help with your next task.

For advanced setup, provider notes, CLI usage, or development workflows, see:
- [Getting Started](wiki/Getting-Started.md)
- [CLI Usage](wiki/CLI.md)
- [Model Routing](docs/model-routing.md)
- [Website Studio](docs/website-studio.md)
- [Development Guide](docs/development.md)

Focused provider test example:
- `npm run test:providers:local-recommendations` (validates local-model recommendation override loading and fallback behavior; this also runs as an explicit CI quality gate)

---

## Chat Slash Commands

Use these in the AtlasMind chat panel by typing `@atlas /<command>`.

| Command | Description |
|---|---|
| `/bootstrap` | Initialise a new project with SSOT memory structure |
| `/import` | Import an existing project by scanning files and populating memory |
| `/project <goal>` | Decompose a goal into tests-first subtasks and execute autonomously |
| `/loop <goal>` | Run an autonomous, goal-seeking **Mission Loop** within a closed budget envelope: plan → execute → re-evaluate each iteration until the goal is met or a guardrail (cost/iterations/no-progress/time) confines progress. Pauses for approval at configurable checkpoints |
| `/agents` | List or manage registered agents |
| `/skills` | List or manage registered skills |
| `/discover <query>` | Discover external agentic resources (MCP servers, agents, skills, APIs) via [Agentic Resource Discovery](https://agenticresourcediscovery.org/), with one-click install of the results |
| `/memory` | Query or manage the SSOT memory system |
| `/cost` | Show cost summary for the current session |
| `/runs` | Open the Project Run Center and inspect recent autonomous runs |
| `/director` | Project Director status: stakeholders, team, responsibilities, assignments, and follow-ups (open/overdue) |
| `/followups` | List open follow-ups grouped by overdue / due soon / upcoming |
| `/ship` | Run the project's default routine from `project_memory/routines/`. `/ship <id>` runs a named routine; trailing text sets `${message}` for interpolation |
| `/sync-instructions` | Two-way sync AI instruction sets across tools (Claude, Copilot, Cursor, …) and AtlasMind: reconcile every tool's instructions into one unified set, resolve significant conflicts in chat, then mirror the set back into each tool's file (managed block, native format). `apply` / `choose <#> <#>` continue an in-progress sync |
| `/voice` | Open the Voice Panel for TTS and STT |
| `/vision` | Pick workspace images and ask a multimodal question |

---

## Extension Commands

Access these from the VS Code Command Palette (`Ctrl+Shift+P`).

| Command | Description |
|---|---|
| `AtlasMind: Getting Started` | Open the guided walkthrough |
| `AtlasMind: Open Chat Panel` | Open the detached chat panel (`Ctrl+Alt+I`) |
| `AtlasMind: Focus Chat View` | Focus the sidebar chat view |
| `AtlasMind: Manage Model Providers` | Configure API keys and provider quota |
| `AtlasMind: Dismiss Provider Notifications` | Clear the Models view auto-paused badge for the current session without re-enabling paused providers |
| `AtlasMind: Manage Agents` | Create, edit, and enable/disable agents |
| `AtlasMind: Open Settings Panel` | Open the budget/speed settings panel |
| `AtlasMind: Open Personality Profile` | Configure Atlas's role, tone, and memory posture |
| `AtlasMind: Bootstrap Project` | Create SSOT memory structure for a new project |
| `AtlasMind: Import Existing Project` | Populate memory from an existing project |
| `AtlasMind: Update Project Memory` | Re-scan and refresh the SSOT memory |
| `AtlasMind: Open Cost Dashboard` | Per-session and per-model cost breakdown, plus a live "Current Loops" section for in-flight Mission Loop spend |
| `AtlasMind: Open Project Dashboard` | Project health, gap analysis, and roadmap — including a **Road to MVP** section that tags backlog items (`#mvp`), visualises a milestone track to a first shippable product, and recommends the best route with an "ask Atlas" handoff |
| `AtlasMind: Open Project Director` | Open the Project Dashboard on the **Director** tab — the people model (stakeholders, team, responsibilities, assignments, follow-ups) |
| `AtlasMind: Open Project Ideation` | Ideation whiteboard before launching a project run |
| `AtlasMind: Open Website Studio` | Six website dashboards for client intake, sitemap, wireframes and visual-design review, UI system decisions, guarded Develop/Staging/Production hosting plus CMS targets, and n8n workflow mapping |
| `AtlasMind: Open Project Run Center` | Task run history and checkpoint browser |
| `AtlasMind: Open Mission Control` | Define, launch, watch, checkpoint, and audit autonomous Mission Loop runs |
| `AtlasMind: Show Cost Summary` | Quick cost summary in the chat |
| `AtlasMind: Toggle Autopilot` | Toggle autopilot mode |
| `AtlasMind: Toggle Keep Computer Awake` | Keep this computer awake (prevent system sleep) while an activity needs the agent online — a Mission Loop run, a Remote Control gateway session, or a Buzz presence; deny-by-default and AC-power-gated |
| `AtlasMind: Open Voice Panel` | Open TTS/STT voice interaction panel |
| `AtlasMind: Open Vision Panel` | Open multimodal image analysis panel |
| `AtlasMind: Manage MCP Servers` | Configure MCP server connections |
| `AtlasMind: Resource Discovery` | Open the Agentic Resource Discovery (ARD) panel: search Agent Finders, install discovered resources, manage finders, and export this project's catalog |
| `AtlasMind: Discover Resources (ARD)` | Prompt for a query and search enabled Agent Finders |
| `AtlasMind: Export Resource Catalog (ai-catalog.json)` | Publish AtlasMind's agents, skills, and MCP servers as a spec-conformant `ai-catalog.json` (secrets/prompts excluded) |
| `AtlasMind: Specialist Integrations` | Configure specialist search and media providers |
| `AtlasMind: Tool Webhooks` | Configure outbound tool execution webhooks |
| `AtlasMind: Scaffold Testing Framework` | Construct a stack-aware starter framework (config, example tests, strategy playbook) for the enabled testing methodologies |
| `AtlasMind: Compare Models on a Prompt` | Run one prompt across your configured models (grouped by provider, Select All + sample prompts) and view a sortable comparison. An optional LLM **judge** scores each answer 0–100; click any column header to sort. Records outcomes to calibrate routing. Reachable from the Models view titlebar (beaker icon) and the Settings overview. |
| `AtlasMind: Sync Testing Protocols to AI Agents` | Write the enabled testing protocols into detected AI agent instruction files (`CLAUDE.md`, `copilot-instructions.md`, `AGENTS.md`, etc.) |
| `AtlasMind: Enable Remote Control` | Start the localhost server so the web build can drive this desktop instance (desktop) |
| `AtlasMind: Enable Remote Control (Gateway)` | Switch to `gateway` mode and start the server behind an SSO-gated Cloudflare Worker + tunnel for cross-machine access (desktop) |
| `AtlasMind: Disable Remote Control` | Stop the remote-control server and drop sessions (desktop) |
| `AtlasMind: Show Remote Pairing Code` | Re-display the remote pairing URL and token (desktop) |
| `AtlasMind: Revoke Remote Access` | Rotate the pairing token and disconnect all clients (desktop) |
| `AtlasMind: Connect to Desktop Instance` | Pair the web build with a desktop instance (web) |
| `AtlasMind: Disconnect from Desktop Instance` | Disconnect the web client (web) |
| `AtlasMind: Open Remote Dashboard` | Read-only cost and project-run dashboard in the web build (web) |

See [Remote Control](docs/remote-control.md) for the architecture and security model.

---

## Website Studio

Choose **Website / Marketing Site** during guided bootstrap, or run **AtlasMind: Open Website Studio** in any workspace. The Studio provides six connected dashboards:

1. **Client brief** — capture manually or import bounded JSON from a form, CRM, or n8n normalization flow.
2. **Sitemap** — define each page, slug, purpose, and reusable template.
3. **Wireframes & UI** — outline page sections and track wireframe, visual design, content, and SEO through draft, review, and approval.
4. **UI system** — record brand direction, type, palette, spacing, corners, accessibility target, and component decisions.
5. **Hosting & Platforms** — configure the fixed Develop → Staging → Production path, then choose and track Cloudflare Pages, GitHub Pages, WordPress/Elementor, WordPress, Vercel, Netlify, Azure Static Web Apps, Shopify, Webflow, or a custom target.
6. **n8n automations** — map events and outcomes while storing only workflow IDs and credential references, never webhook or credential values.

The hosting policy is fixed: **Develop** uses a loopback URL by default and can use an HTTPS, password-protected hosted fallback only when local hosting is not possible; **Staging** is always an HTTPS, password-protected `<review-label>.<production-domain>` for client review; **Production** is public and promotion-protected. Password values are never stored—only references such as `SecretStorage:website.staging.password` or `env:WEBSITE_STAGING_PASSWORD`.

The source of truth is `project_memory/domain/website.json`; AtlasMind regenerates `website.md` as a review-friendly mirror. Website Studio evaluates readiness but does not publish or trigger workflows directly. Production delivery remains behind the Project Dashboard's preflight, backup, approval, publish, and verification gates.

---

## Sidebar Views

AtlasMind adds a sidebar with the following tree and webview panels:

| View | Description |
|---|---|
| **Quick Links** | Fast access to key panels and actions |
| **Chat** | Inline chat interface within the sidebar |
| **Project Runs** | History of autonomous project runs and checkpoints |
| **Sessions** | Named chat sessions with folder organization and archiving |
| **Memory (SSOT)** | Browse and edit SSOT memory entries |
| **Agents** | Enable/disable and inspect registered agents |
| **Skills** | Enable/disable, scan, and manage skills and custom folders |
| **MCP Servers** | Status and summary of connected MCP servers |
| **Resource Discovery** | ARD Agent Finders (enable/disable) and recently discovered resources |
| **Models** | Available models by provider with enable/disable and routing controls |

---

## Built-in Agents

AtlasMind ships 18 specialized agents, automatically routed by task type.

| Agent | Role |
|---|---|
| **Default Assistant** | General-purpose coding and task assistant |
| **Workspace Debugger** | Root-cause diagnosis, error tracing, and fix verification |
| **Frontend Engineer** | UI components, CSS, accessibility, responsive layouts |
| **Backend Engineer** | APIs, services, databases, and server-side logic |
| **Code Reviewer** | Code quality, correctness, and improvement feedback |
| **Security Reviewer** | Threat modelling, vulnerability detection, and remediation |
| **Ethics Oversight** | User harm, fairness and bias, consent, dark patterns — advisory, read-only |
| **Legal Oversight** | Licence compatibility, IP, GDPR/CCPA, liability, terms — not legal advice |
| **Commercial Oversight** | Monetisation, vendor cost, obligations, competitors, go-to-market |
| **GitHub Operator** | Pull requests, issues, CI/CD workflows, and git housekeeping |
| **Test Developer** | Unit, integration, E2E, regression tests — test-first by default |
| **Documentation Writer** | READMEs, API docs, JSDoc/TSDoc, wikis, and changelogs |
| **Performance Analyst** | CPU hot paths, memory leaks, slow queries, and benchmarks |
| **DevOps Engineer** | CI/CD pipelines, Docker, Kubernetes, Terraform, and IaC |
| **Dependency Manager** | Package updates, vulnerability remediation, and lockfile hygiene |
| **SEO Specialist** | Technical SEO, Core Web Vitals, structured data, AEO, GEO, LLMO |
| **UX Consultant** | UX critique, accessible UI generation, responsive design |
| **Memory Agent** | Background session context and SSOT snippet maintenance |

Agents use **AI-driven skill auto-assignment** by default — AtlasMind selects the best-fit skills for each agent's role automatically. Skills can also be assigned manually per agent.

Agents can be **auto-updated on a configurable cadence** (never/daily/weekly/monthly/every-use) so system prompts stay current with best practices and compliance requirements. Individual agents can opt out of auto-updates.

---

## Built-in Skills

43 built-in skills organized by category. All skills are enable/disable toggleable and undergo security scanning before use.

| Category | Skills |
|---|---|
| **Workspace Files** | file-read, file-write, file-edit, file-search, file-delete, file-move, directory-list |
| **Git & Review** | git-status, git-diff, git-commit, git-push, git-log, git-branch, git-apply-patch, git-blame, rollback-checkpoint, diff-preview |
| **Execution & Testing** | terminal-run, terminal-read, test-run, debug-session, docker-cli, npm-scripts, workspace-observability |
| **Code Intelligence** | diagnostics, code-symbols, rename-symbol, code-action, code-format, framework-detect |
| **Debugging** | debug-launch, debug-breakpoint, log-file-tail |
| **Search & Fetch** | text-search, web-fetch, http-request, exa-search, discover-resources |
| **Memory** | memory-query, memory-write, memory-delete |
| **VS Code** | vscode-extensions, simple-browser |

Custom skills can be authored and loaded from any workspace folder. The Skills view supports folder organization and per-skill security scanning.

---

## Configuration

Key settings under `atlasmind.*` in VS Code settings:

| Setting | Default | Description |
|---|---|---|
| `budgetMode` | `balanced` | Model cost preference: `cheap`, `balanced`, `expensive`, `auto` |
| `speedMode` | `balanced` | Model speed preference: `fast`, `balanced`, `considered`, `auto` |
| `planningModelId` | `""` | Optional model ID pinned for the planning "brain" phase; empty routes planning normally |
| `synthesisModelId` | `""` | Optional model ID pinned for the synthesis (summarization) phase; empty routes synthesis normally |
| `draftModelId` | `""` | Optional model pinned to draft mechanical tasks (local-draft / frontier-escalate); empty routes normally |
| `toolApprovalMode` | `ask-on-write` | When to prompt for tool approval: `always-ask`, `ask-on-write`, `ask-on-external`, `allow-safe-readonly` |
| `dailyCostLimitUsd` | `0` | Daily spend cap in USD (0 = unlimited) |
| `agentAutoUpdateCadence` | `never` | How often to AI-refresh agent definitions: `never`, `daily`, `weekly`, `monthly`, `every-use` |
| `maxToolIterations` | `10` | Max tool-call loop iterations per agent turn |
| `loop.enabled` | `true` | Enable the autonomous Mission Loop (`/loop` + Mission Control) |
| `loop.defaultMaxIterations` | `8` | Default hard cap on Mission Loop iterations |
| `loop.defaultMaxCostUsd` | `5` | Default hard ceiling (USD) on a Mission Loop run |
| `loop.defaultMaxTokens` | `2000000` | Default cumulative token cap for a Mission Loop run |
| `loop.defaultMaxDurationMinutes` | `30` | Default wall-clock cap (minutes) for a Mission Loop run |
| `loop.maxConsecutiveNoProgress` | `2` | Stop after this many consecutive no-progress iterations |
| `loop.checkpointEveryNIterations` | `3` | Pause for approval every N iterations (0 = off) |
| `loop.checkpointAtBudgetFraction` | `0.75` | Pause when spend crosses this fraction (0..1) of the cost budget |
| `loop.requireApprovalBeforeWriteBatches` | `false` | Require approval before any write/commit iteration |
| `loop.allowDiscovery` | `true` | Allow the loop to synthesize/discover capabilities (gated) |
| `loop.goalAchievedConfidenceThreshold` | `0.7` | Min evaluator confidence to accept an `achieved` verdict |
| `allowTerminalWrite` | `false` | Allow terminal subprocesses (installs, commits) after explicit approval |
| `autoVerifyAfterWrite` | `true` | Run verification scripts after workspace writes |
| `autoStartProposedProjectRuns` | `true` | When a reply offers an autonomous project run, flow straight into it (immediate under Autopilot; cancellable notice otherwise) instead of waiting for "Proceed"; the file-count gate still applies |
| `ssotPath` | `project_memory` | Relative path to the SSOT memory folder |
| `localOpenAiEndpoints` | `[]` | Labeled local OpenAI-compatible endpoints (`id`/`label`/`baseUrl`) aggregated under the Local provider; managed from Settings → Models & Integrations |
| `localOpenAiBaseUrl` | `http://127.0.0.1:11434/v1` | Legacy single-endpoint fallback for Ollama or LM Studio (auto-migrated into `localOpenAiEndpoints`) |
| `toolWebhookEnabled` | `false` | Send tool execution events to an outbound webhook |
| `ard.enabled` | `true` | Enable Agentic Resource Discovery (panel, `/discover`, and the read-only `discover-resources` skill) |
| `ard.federationMode` | `referrals` | How ARD searches fan out across federated registries: `auto`, `referrals`, `none` |
| `ard.maxResults` | `10` | Maximum results returned from a discovery search |
| `ard.requestTimeoutMs` | `15000` | Timeout for each outbound ARD discovery request (ms) |
| `ard.allowInsecureEndpoints` | `false` | Allow `http://`/localhost Agent Finders (e.g. the ARD conformance demo); otherwise HTTPS is required and private hosts are rejected |
| `buzz.enabled` | `false` | Enable [Buzz](https://buzz.xyz) integration: record Buzz identities/channels on Project Director contacts and reach them via a Buzz deep link (opt-in) |
| `buzz.relayUrl` | `ws://localhost:3000` | Buzz relay URL (`BUZZ_RELAY_URL`); defaults to a local self-hosted relay |
| `buzz.allowRemoteRelay` | `false` | Allow a non-local Buzz relay URL (off-machine send); otherwise only loopback/localhost is used |
| `presence.keepAwake` | `false` | Keep the computer awake (prevent system sleep) while an activity needs the agent online — a Mission Loop run, a Remote Control gateway session, or a Buzz presence; released when the activity ends |
| `presence.keepDisplayAwake` | `false` | When keep-awake is active, also keep the display on; default lets the screen sleep |
| `presence.acPowerOnly` | `true` | Only keep awake on AC power; suspended on battery so an unplugged laptop is never drained |
| `presence.maxAwakeMinutes` | `240` | Safety backstop that auto-releases the wake lock after N minutes (0 = until the activity ends; range 0–1440) |
| `remote.enabled` | `false` | Allow the web build to remote-control this desktop instance over a localhost WebSocket |
| `remote.mode` | `localhost` | Transport/auth mode: `localhost` (same-machine token pairing) or `gateway` (SSO-gated Cloudflare Worker + tunnel for cross-machine access) |
| `remote.port` | `0` | Localhost port for the remote-control server (0 = auto; pin a value in `gateway` mode so the tunnel target stays fixed) |

See [Configuration Reference](docs/configuration.md) and [wiki/Configuration.md](wiki/Configuration.md) for the full settings list.

---

## Open Source & Support

AtlasMind is fully open source and available under the permissive MIT license. There are no paywalls, feature gates, or commercial editions—just the full project, free for everyone.

If AtlasMind saves you time or helps your team, consider a pay-what-it's-worth donation to keep the project alive and thriving. Every bit of support helps sustain ongoing development.

See [Funding and Sponsorship](wiki/Funding-and-Sponsorship.md) for details.

---



## Learn More


- [Core Workflows](wiki/Chat-Commands.md)
- [Model Routing](docs/model-routing.md)
- [Agents & Skills](docs/agents-and-skills.md)
- [SSOT Memory System](docs/ssot-memory.md)
- [Configuration Reference](docs/configuration.md)
- [Roadmap](docs/roadmap.md)
- [Comparison Matrix](wiki/Comparison.md)
- [Funding and Sponsorship](wiki/Funding-and-Sponsorship.md)

---

## Project Structure

- Core runtime: `src/core/`, `src/runtime/`, `src/chat/`, `src/commands.ts`, `src/extension.ts`
- Provider adapters and catalogs: `src/providers/` (including `localModelSync.ts` and `localModelRecommendationRegistry.ts`)
- Skills and tool handlers: `src/skills/`
- Shared utilities: `src/utils/` (including `secretRedactor.ts` — pattern-based secret scanner used to scrub credentials from memory context before LLM dispatch; `aiInstructionSync.ts` — inbound merge of external agent rule files; `testingProtocolSync.ts` — outbound sync of enabled testing protocols into external agent instruction files; `terminalOutput.ts` — strips ANSI/control escape sequences from captured tool output before it is shown in chat summaries or webviews)
- Data privacy: `src/core/dataPrivacyManager.ts` (classifies confidential/proprietary terms, files, and folders and gates them to user-selected "trusted" models; records catch activity for the dashboard charts), `src/core/compliancePacks.ts` (built-in GDPR/HIPAA/PCI-DSS/CCPA detector packs), and `src/core/providerDataGovernance.ts` (per-provider GDPR/data-management reference links). The gate scans the context assembled for a task rather than your request, so it responds in proportion: PCI cardholder data and HIPAA PHI restrict routing to trusted models, while GDPR/CCPA matches are advisory and rely on the redaction boundary — one heuristic hit can't silently downgrade an unrelated task. Managed from the Project Dashboard → **Privacy** page (provider/model trust tree, catch charts, and provider data-management panel); policy stored at `project_memory/operations/data-privacy.json`.
- Delivery & deployment stages: `src/core/deliveryManager.ts` (models Local → Staging → Production stages and promotion "push" edges; seeds a pipeline from the repo's branches, sanitises dashboard edits via `sanitizeDeliveryConfig`, and persists `project_memory/operations/delivery.json` + a human-readable `delivery.md` runbook mirror) and `src/core/promotionRunner.ts` (the guarded promotion engine: builds the preflight → backup → deploy → verify → record plan, enforces the authorization gate, and executes user-authored commands with live progress). Surfaced on the Project Dashboard → **Delivery** page as an editable **Stages & Promotion** pipeline with **Execute / Runbook** push buttons; production is protected, a data-bearing target with no backup command is deny-by-default blocked, executed commands are sourced only from your saved config/routines, and AtlasMind never force-pushes. The page **auto-refreshes** on external `delivery.json` changes (file watcher) and shows a **"review needed"** banner when the protocol, stage-candidate branches, or CI workflows have drifted since your last review.
- Website delivery: `src/core/websiteWorkspaceManager.ts` (bounded client-intake normalization, fixed Develop/Staging/Production hosting policy and readiness, sitemap/design/platform/n8n SSOT persistence, secret redaction, and Markdown mirroring) and `src/views/websiteStudioPanel.ts` (the six-tab Website Studio webview). Website bootstrap seeds `project_memory/domain/website.json` plus `website.md` without overwriting an existing plan; publishing continues through the guarded Delivery pipeline rather than executing from the Studio.
- Project Director (people & follow-ups): `src/core/projectDirectorManager.ts` models the stakeholders, delivery team, responsibilities, human task assignments, and follow-ups around a project, persisted to `project_memory/operations/project-director.json` plus a `project-director.md` mirror (with capped history). It is GDPR-first — it prefers to *reference* people in their system of record (Microsoft 365 / Slack / Google Workspace, each with a data-governance reference) over storing raw PII, flags any locally-stored PII for a one-time consent gate, restricts communication deep-links to a scheme allowlist, and describes channels by kind/label only in the git-tracked mirror. `src/core/directorCommsRunner.ts` adds *opt-in, guarded* outbound messaging: it detects which connected MCP connector can email/schedule/message a contact and maps a composed draft onto that tool, dispatched only after an explicit confirmation (default off; deep-link fallback otherwise). `src/core/followUpScheduler.ts` surfaces a throttled, once-per-day in-editor reminder when follow-ups are overdue/due-soon (notification-only; never auto-sends). Surfaced on the Project Dashboard → **Director** page, a **Project Director** sidebar tree (with an overdue badge), the **AtlasMind: Open Project Director** command, and the `@atlas /director` + `@atlas /followups` chat commands.
- Document (.md) management: `src/core/documentsManager.ts` models a project's *document filing system* (folder "shelves", optionally narrowed by a glob) and the documents to *keep updated automatically*, persisted to `project_memory/operations/documents.json` plus a human-readable `documents.md` runbook mirror (`fs`-only, unit-testable; webview edits sanitised via `sanitizeDocumentsConfig` with path-traversal/absolute-path rejection). Surfaced on the Project Dashboard → **Documents** page, which tracks each document's freshness (file mtime vs. a recorded review baseline), discovers uncovered markdown, and offers an explicit **Update with Atlas** / **Mark reviewed** action. Safety-first / deny-by-default: AtlasMind never rewrites a document on a timer.
- Mission Loop (autonomous goal-seeking loop): `src/core/missionRunner.ts` (the outer plan → execute → evaluate loop with the closed parameter envelope and deny-by-default checkpoints), `src/core/goalEvaluator.ts` (validated, untrusted-output progress verdicts), and `src/core/missionRegistry.ts` (audit persistence to `project_memory/operations/missions.json` + a `missions.md` runbook mirror). Defined/launched/watched from the **Mission Control** webview (`src/views/missionControlPanel.ts`) and the `/loop` chat command.
- Risk oversight: `src/core/riskOversightManager.ts` persists the ethics/legal/commercial risk register raised by the three read-only oversight advisors, at `project_memory/operations/risk-oversight.json` plus a readable `risk-oversight.md` mirror and an append-only `risk-oversight-history.json` audit trail (`fs`-only, unit-tested; model output parsed defensively and sanitised with path-traversal rejection before it touches disk). Surfaced on the Project Dashboard → **Risk** page, which runs the advisors on request, shows a likelihood × impact risk matrix and assessment-cadence chart, and lets you accept, mitigate, dismiss, or reopen each finding. Findings are never deleted — only transitioned — so the register stays a complete record. Advisory only: nothing here blocks a commit or a release, and it is not a substitute for professional advice.
- Presence / keep-awake: `src/core/presenceManager.ts` keeps the computer awake (prevent system sleep) so a connected Buzz presence, a Remote Control gateway session, or a long Mission Loop run isn't dropped — a `vscode`-free, unit-tested service that spawns an OS-native wake lock (Windows `SetThreadExecutionState` via PowerShell, macOS `caffeinate`, Linux `systemd-inhibit`) since a VS Code extension can't use Electron `powerSaveBlocker`. Deny-by-default (`atlasmind.presence.*`), AC-power-gated, auto-releasing; surfaced as a click-to-stop status-bar item + the **AtlasMind: Toggle Keep Computer Awake** command.
- Testing strategy: `src/core/testingConfigLoader.ts` (methodology resolution for orchestrated runs) and `src/core/testingScaffolder.ts` (stack-aware framework scaffolding)
- Routing intelligence: `src/core/executionQuality.ts` (shared output-quality scorer), `src/core/modelEvalHarness.ts` (scored-replay model comparison), and `src/views/modelComparisonPanel.ts` (comparison webview)
- Webview and sidebar surfaces: `src/views/` (`chatProtocol.ts` and `chatWebviewMarkup.ts` are Node-free so they are shared with the web build)
- Voice (TTS/STT): `src/voice/` (`voiceManager.ts` bridge, `hostSpeechSynthesizer.ts` on-device OS speech engine, `localTranscriber.ts` on-device Whisper STT)
- Memory and MCP layers: `src/memory/`, `src/mcp/` (`mcpServerRegistry.ts` persists servers and resolves SecretStorage-backed env at connect, `mcpClient.ts` the transport client, `mcpRuntime.ts` the shared confirm-before-install runtime bootstrap, `mcpEnvironmentScanner.ts` discovers MCP servers already configured in other tools plus PATH/env hints — cached in SSOT, redaction-safe). MCP setup uses a guided wizard (`src/views/mcpPanel.ts` → **Guided Setup**): scan the environment or browse by category, AtlasMind checks prerequisites and collects any credentials (stored in SecretStorage), then connects; a raw form remains under **Advanced** (now with inline help + examples on every field). For servers that need credentials (GitHub, Microsoft 365, Shopify, Wix, YouTube, …) the configure step hand-holds novices with a "What you'll need" checklist, a step-by-step how-to for obtaining the credential, a direct link to the right console page, and a safety note — with the launch command prefilled from an audited, supply-chain-verified starter.
- Agentic Resource Discovery: `src/ard/` (`ardClient.ts` protocol client, `ardRegistry.ts` Agent Finder registry, `ardInstaller.ts` install mapping, `ardCatalogExporter.ts` publisher). The discovery UI is the **Resource Discovery** tab in the Settings dashboard (`src/views/settingsPanel.ts`). See [Resource Discovery](docs/resource-discovery.md).
- Remote control: `src/remote/` (`protocol.ts` wire format, `remoteControlServer.ts` desktop server, `remoteBridge.ts` synthetic webview host) and `src/web/` (browser thin-client entry, `remoteClient.ts`, `chatClientPanel.ts`, `dashboardPanel.ts`)

---

## Contributing & License

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup and contribution guidelines.

MIT License — see [LICENSE]
