<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind</h1>

<p align="center"><sub> · <strong>Current source version: 0.116.1</strong> · </sub></p>


<p align="center">
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
| Model provider choice | ✅ | <span title="Copilot supports only GitHub-hosted models, not bring-your-own.">⚠️</span> | <span title="Claude Code supports only Anthropic models.">⚠️</span> | <span title="Cline supports OpenAI-compatible providers and configurable endpoints.">✅</span> | ✅ |
| Project memory (SSOT) | ✅ | <span title="Copilot has session memory but not persistent project SSOT.">⚠️</span> | <span title="Claude Code has session memory but not persistent project SSOT.">⚠️</span> | <span title="Cline can use rules and context, but not AtlasMind-style persistent project SSOT.">⚠️</span> | <span title="Cursor has session memory but not persistent project SSOT.">⚠️</span> |
| Approval/safety gates | ✅ | <span title="Copilot has some safety checks but not approval gating.">⚠️</span> | ✅ | ✅ | <span title="Cursor has some safety checks but not approval gating.">⚠️</span> |
| Cost tracking | ✅ | ❌ | ❌ | <span title="Cline shows usage and token costs, but not AtlasMind-style cost dashboards.">⚠️</span> | ❌ |
| VS Code native | ✅ | ✅ | ✅ | ✅ | ✅ |
| Built-in dashboards | ✅ | <span title="Copilot has some usage stats but not full dashboards.">⚠️</span> | <span title="Claude Code has some usage stats but not full dashboards.">⚠️</span> | <span title="Cline surfaces usage and settings views, but not AtlasMind-style project/run/cost dashboards.">⚠️</span> | <span title="Cursor has some usage stats but not full dashboards.">⚠️</span> |
| Extensible with MCP servers | ✅ | ✅ | ✅ | ✅ | ✅ |
| Secure by default | ✅ | <span title="Copilot has security features but not full sandboxing or approval gating.">⚠️</span> | <span title="Claude Code has security features but not full sandboxing or approval gating.">⚠️</span> | <span title="Cline has strong approval controls, but not AtlasMind's full security guardrail stack.">⚠️</span> | <span title="Cursor has security features but not full sandboxing or approval gating.">⚠️</span> |
| Configurable testing methodology system | ✅ | ❌ | ❌ | ❌ | ❌ |

- **Multi-agent orchestration**: 15 built-in specialized agents — debugger, frontend/backend engineers, reviewer, security, SEO, UX, DevOps, and more — plus instant AI-drafted custom agents on demand.
- **Multi-provider model routing**: Supports GitHub Copilot, Claude, GPT, Gemini, Azure OpenAI, Bedrock, Mistral, and more. Budget and speed preferences steer selection automatically.
- **Built-in skills**: 35 pre-built skills including file editing, git, diagnostics, code navigation, test running, HTTP requests, Docker, web fetch, and more. Skills are grouped by category and support custom folders. Agents use AI-driven auto skill assignment by default.
- **Long-term project memory (SSOT)**: Decisions, architecture notes, and lessons learned persist in a structured memory folder. A dedicated Memory Agent maintains session context and keeps SSOT snippets fresh as source files evolve.
- **Project planner**: Decompose goals into subtasks, preview impact, gate execution, and review results.
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
| `/ship` | Run the project's default routine from `project_memory/routines/`. `/ship <id>` runs a named routine; trailing text sets `${message}` for interpolation |
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
| `AtlasMind: Open Project Dashboard` | Project health, gap analysis, and roadmap |
| `AtlasMind: Open Project Ideation` | Ideation whiteboard before launching a project run |
| `AtlasMind: Open Project Run Center` | Task run history and checkpoint browser |
| `AtlasMind: Open Mission Control` | Define, launch, watch, checkpoint, and audit autonomous Mission Loop runs |
| `AtlasMind: Show Cost Summary` | Quick cost summary in the chat |
| `AtlasMind: Toggle Autopilot` | Toggle autopilot mode |
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
| `AtlasMind: Disable Remote Control` | Stop the remote-control server and drop sessions (desktop) |
| `AtlasMind: Show Remote Pairing Code` | Re-display the remote pairing URL and token (desktop) |
| `AtlasMind: Revoke Remote Access` | Rotate the pairing token and disconnect all clients (desktop) |
| `AtlasMind: Connect to Desktop Instance` | Pair the web build with a desktop instance (web) |
| `AtlasMind: Disconnect from Desktop Instance` | Disconnect the web client (web) |
| `AtlasMind: Open Remote Dashboard` | Read-only cost and project-run dashboard in the web build (web) |

See [Remote Control](docs/remote-control.md) for the architecture and security model.

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

AtlasMind ships 15 specialized agents, automatically routed by task type.

| Agent | Role |
|---|---|
| **Default Assistant** | General-purpose coding and task assistant |
| **Workspace Debugger** | Root-cause diagnosis, error tracing, and fix verification |
| **Frontend Engineer** | UI components, CSS, accessibility, responsive layouts |
| **Backend Engineer** | APIs, services, databases, and server-side logic |
| **Code Reviewer** | Code quality, correctness, and improvement feedback |
| **Security Reviewer** | Threat modelling, vulnerability detection, and remediation |
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

36 built-in skills organized by category. All skills are enable/disable toggleable and undergo security scanning before use.

| Category | Skills |
|---|---|
| **Workspace Files** | file-read, file-write, file-edit, file-search, file-delete, file-move, directory-list |
| **Git & Review** | git-status, git-diff, git-commit, git-push, git-log, git-branch, git-apply-patch, rollback-checkpoint, diff-preview |
| **Execution & Testing** | terminal-run, terminal-read, test-run, debug-session, docker-cli, workspace-observability |
| **Code Intelligence** | diagnostics, code-symbols, rename-symbol, code-action, code-format |
| **Search & Fetch** | text-search, web-fetch, http-request, exa-search, discover-resources |
| **Memory** | memory-query, memory-write, memory-delete |
| **VS Code** | vscode-extensions |

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
| `ssotPath` | `project_memory` | Relative path to the SSOT memory folder |
| `localOpenAiBaseUrl` | `http://127.0.0.1:11434/v1` | Base URL for Ollama or LM Studio |
| `toolWebhookEnabled` | `false` | Send tool execution events to an outbound webhook |
| `ard.enabled` | `true` | Enable Agentic Resource Discovery (panel, `/discover`, and the read-only `discover-resources` skill) |
| `ard.federationMode` | `referrals` | How ARD searches fan out across federated registries: `auto`, `referrals`, `none` |
| `ard.maxResults` | `10` | Maximum results returned from a discovery search |
| `ard.requestTimeoutMs` | `15000` | Timeout for each outbound ARD discovery request (ms) |
| `ard.allowInsecureEndpoints` | `false` | Allow `http://`/localhost Agent Finders (e.g. the ARD conformance demo); otherwise HTTPS is required and private hosts are rejected |
| `remote.enabled` | `false` | Allow the web build to remote-control this desktop instance over a localhost WebSocket |
| `remote.port` | `0` | Localhost port for the remote-control server (0 = auto) |

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
- Data privacy: `src/core/dataPrivacyManager.ts` (classifies confidential/proprietary terms, files, and folders and gates them to user-selected "trusted" models; records catch activity for the dashboard charts), `src/core/compliancePacks.ts` (built-in GDPR/HIPAA/PCI-DSS/CCPA detector packs), and `src/core/providerDataGovernance.ts` (per-provider GDPR/data-management reference links). Managed from the Project Dashboard → **Privacy** page (provider/model trust tree, catch charts, and provider data-management panel); policy stored at `project_memory/operations/data-privacy.json`.
- Delivery & deployment stages: `src/core/deliveryManager.ts` (models Local → Staging → Production stages and promotion "push" edges; seeds a pipeline from the repo's branches, sanitises dashboard edits via `sanitizeDeliveryConfig`, and persists `project_memory/operations/delivery.json` + a human-readable `delivery.md` runbook mirror) and `src/core/promotionRunner.ts` (the guarded promotion engine: builds the preflight → backup → deploy → verify → record plan, enforces the authorization gate, and executes user-authored commands with live progress). Surfaced on the Project Dashboard → **Delivery** page as an editable **Stages & Promotion** pipeline with **Execute / Runbook** push buttons; production is protected, a data-bearing target with no backup command is deny-by-default blocked, executed commands are sourced only from your saved config/routines, and AtlasMind never force-pushes. The page **auto-refreshes** on external `delivery.json` changes (file watcher) and shows a **"review needed"** banner when the protocol, stage-candidate branches, or CI workflows have drifted since your last review.
- Mission Loop (autonomous goal-seeking loop): `src/core/missionRunner.ts` (the outer plan → execute → evaluate loop with the closed parameter envelope and deny-by-default checkpoints), `src/core/goalEvaluator.ts` (validated, untrusted-output progress verdicts), and `src/core/missionRegistry.ts` (audit persistence to `project_memory/operations/missions.json` + a `missions.md` runbook mirror). Defined/launched/watched from the **Mission Control** webview (`src/views/missionControlPanel.ts`) and the `/loop` chat command.
- Testing strategy: `src/core/testingConfigLoader.ts` (methodology resolution for orchestrated runs) and `src/core/testingScaffolder.ts` (stack-aware framework scaffolding)
- Routing intelligence: `src/core/executionQuality.ts` (shared output-quality scorer), `src/core/modelEvalHarness.ts` (scored-replay model comparison), and `src/views/modelComparisonPanel.ts` (comparison webview)
- Webview and sidebar surfaces: `src/views/` (`chatProtocol.ts` and `chatWebviewMarkup.ts` are Node-free so they are shared with the web build)
- Voice (TTS/STT): `src/voice/` (`voiceManager.ts` bridge, `hostSpeechSynthesizer.ts` on-device OS speech engine, `localTranscriber.ts` on-device Whisper STT)
- Memory and MCP layers: `src/memory/`, `src/mcp/`
- Agentic Resource Discovery: `src/ard/` (`ardClient.ts` protocol client, `ardRegistry.ts` Agent Finder registry, `ardInstaller.ts` install mapping, `ardCatalogExporter.ts` publisher). The discovery UI is the **Resource Discovery** tab in the Settings dashboard (`src/views/settingsPanel.ts`). See [Resource Discovery](docs/resource-discovery.md).
- Remote control: `src/remote/` (`protocol.ts` wire format, `remoteControlServer.ts` desktop server, `remoteBridge.ts` synthetic webview host) and `src/web/` (browser thin-client entry, `remoteClient.ts`, `chatClientPanel.ts`, `dashboardPanel.ts`)

---

## Contributing & License

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup and contribution guidelines.

MIT License — see [LICENSE]
