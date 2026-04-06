# Architecture

## Overview

AtlasMind is a VS Code extension built in TypeScript, and it now also ships a small Node CLI. Both hosts share the same service-oriented runtime builder so orchestration, routing, skills, and memory loading stay consistent.

## Core Services

| Service | File | Purpose |
|---------|------|---------|
| **Orchestrator** | `src/core/orchestrator.ts` | Central coordinator: agent selection → memory → model routing → skill execution → cost tracking |
| **AgentRegistry** | `src/core/agentRegistry.ts` | CRUD for `AgentDefinition` objects; persisted enable/disable state |
| **SkillsRegistry** | `src/core/skillsRegistry.ts` | CRUD for `SkillDefinition` objects; per-skill enable/disable, security scan status, and persistent custom skill folders |
| **ModelRouter** | `src/core/modelRouter.ts` | Budget/speed-aware model selection with subscription quota tracking |
| **CostTracker** | `src/core/costTracker.ts` | Per-request and per-session cost accumulation |
| **MemoryManager** | `src/memory/memoryManager.ts` | SSOT folder read/write/search with semantic retrieval and security scanning |
| **MemoryScanner** | `src/memory/memoryScanner.ts` | Scans content for prompt injection and credential leakage |
| **TaskProfiler** | `src/core/taskProfiler.ts` | Infers task phase, modality, and reasoning intensity |
| **Planner** | `src/core/planner.ts` | Decomposes goals into DAGs of subtasks via LLM |
| **TaskScheduler** | `src/core/taskScheduler.ts` | Topologically sorts DAGs into batches and runs them in parallel |
| **CheckpointManager** | `src/core/checkpointManager.ts` | Pre-write snapshots for safe rollback |
| **SkillScanner** | `src/core/skillScanner.ts` | Security scanner with 12 rules for custom skill validation |
| **ScannerRulesManager** | `src/core/scannerRulesManager.ts` | Configurable rule overrides persisted in globalState |
| **McpClient** | `src/mcp/mcpClient.ts` | MCP SDK wrapper for stdio and HTTP transports |
| **McpServerRegistry** | `src/mcp/mcpServerRegistry.ts` | Persists MCP server configs; manages connections; bridges tools as skills |
| **ToolWebhookDispatcher** | `src/core/toolWebhookDispatcher.ts` | Sends outbound webhooks for tool lifecycle events |
| **VoiceManager** | `src/voice/voiceManager.ts` | TTS/STT bridge; uses ElevenLabs API server-side when configured, falls back to Web Speech API |
| **ProjectRunHistory** | `src/core/projectRunHistory.ts` | Persists project run records for the Run Center |
| **ProviderRegistry** | `src/providers/registry.ts` | Host-neutral registry of provider adapters |
| **SessionConversation** | `src/chat/sessionConversation.ts` | Persistent workspace chat sessions and compact carry-forward context |
| **Shared Runtime** | `src/runtime/core.ts` | Common bootstrapping path used by the extension and CLI |

## Activation Flow

```
1. VS Code fires `onStartupFinished`
2. extension.ts → activate()
  ├── Build shared runtime via `src/runtime/core.ts`
   ├── Create all core services
  ├── Register provider adapters (Anthropic, OpenAI, Azure OpenAI, Bedrock, Copilot, z.ai, DeepSeek, Mistral, Google, Local)
  ├── Seed default models → restore persisted model availability → start background model discovery
   ├── Register default agent + restore user agents from globalState
  ├── Register 31 built-in skills + restore enabled/disabled state
   ├── Auto-approve built-in skills (skip security scan)
   ├── Build SkillExecutionContext (backed by VS Code workspace APIs)
   ├── Create Orchestrator with all dependencies
   ├── Bundle everything into AtlasMindContext
   ├── Register chat participant (@atlas)
   ├── Register 18+ commands
  ├── Register tree views (sidebar, including Sessions)
   ├── Load SSOT memory from disk
   └── Connect MCP servers in background
3. @atlas chat + sidebar views become available

The CLI (`src/cli/main.ts`) follows the same runtime path but swaps in Node-backed memory, cost, and skill-context adapters. It supports `chat`, `project`, `memory`, and `providers` commands and auto-detects an existing SSOT root from the current workspace.

The shared runtime now also exposes an explicit plugin contract through `AtlasRuntimePlugin`, `AtlasRuntimePluginApi`, `AtlasRuntimePluginManifest`, and `AtlasRuntimeLifecycleEvent`. Runtime plugins can register agents, skills, and provider adapters, observe lifecycle stages such as `runtime:plugin-registering` and `runtime:ready`, and publish contribution counts without editing the core bootstrap path.

The Models tree view is stateful: provider and model rows expose inline enable/disable, configure, refresh, info, and assign-to-agent actions, and the enabled/model-assignment state is persisted in VS Code `globalState` so routing behavior survives restarts and catalog refreshes. For the local provider, the endpoint URL lives in workspace settings while any optional API key stays in SecretStorage. Azure OpenAI and Bedrock follow the same split, with deployment or model-list settings in the workspace and credentials in SecretStorage. Visible status is rendered with colored icons, mixed provider states add a bracketed warning marker, and unconfigured providers are kept at the bottom of the list.

The Skills tree keeps each row compact by showing only the skill name and inline actions. Built-in skills are grouped under a `Built-in Skills` root and then sub-categorized by operational area, while user custom skills can live at the root or inside persistent nested folders. Descriptions, parameters, and scan details stay available in the hover tooltip instead of taking horizontal space in the sidebar.

The AtlasMind sidebar now includes an embedded Chat view plus operational tree views whose shipped order is Project Runs, Sessions, Memory, Agents, Skills, MCP Servers, then Models. Those tree views ship collapsed by default so fresh or unbootstrapped workspaces start with a quieter sidebar, while the stable view ids let VS Code preserve each user's later reordering and expanded or collapsed state automatically. Selecting a chat thread reopens the shared Atlas chat workspace on that session, while selecting an autonomous run opens the Project Run Center where live batches can be inspected, paused, approved, or resumed. The Sessions tree now supports persistent folders, inline rename on each session row, archive and restore actions, and a dedicated Archive bucket that accepts dragged chat sessions and allows dragged restores back into the live tree or folder targets. The Chat, Sessions, and Memory titles all keep quick actions for the project dashboard, cost dashboard, and settings, while the project-memory action switches between `Import Existing Project` and `Update Project Memory` once AtlasMind detects workspace SSOT state. The shared Atlas chat workspace now stores per-assistant-turn metadata so each bubble can show the routed model and a collapsible thinking summary based on execution metadata instead of raw chain-of-thought. That summary now includes token totals and request cost alongside routing and tool-loop details. Its responsive Sessions rail keeps the drawer toggle and new-session action on a single compact row, stays at the top in narrow layouts, and reflows into a persistent left sidebar once the chat webview is at least 1000px wide, while each live session row exposes compact archive and delete icon actions. Assistant bubbles also expose thumbs up/down controls; those votes are validated in the extension host, persisted with the transcript entry, and aggregated into a small per-model routing preference signal. The assistant footer keeps the thinking-summary disclosure left-aligned and compact outlined vote controls right-aligned within the same bubble row. It also renders an animated AtlasMind globe while the latest assistant turn is still thinking. Its composer supports explicit send modes, queued workspace attachments, quick-add chips for currently open files, and drag-and-drop ingestion for workspace files or URLs before those inputs are normalized into safe prompt context, and the same controller also backs the detachable AtlasMind chat panel.

AtlasMind also exposes a dedicated Project Dashboard panel for cross-cutting workspace observability. It combines git branch status, recent commit velocity, Project Run History activity, Atlas runtime readiness, SSOT directory coverage, memory scan warnings, security and governance controls, dependency signals, workflow inventory, and aggregate `/project` TDD posture into one interactive surface with adjustable timeline windows.

The Project Run Center now shares that same professional visual language: autonomous-run review, batch approval controls, run history, changed-file inspection, and subtask artifacts all sit inside a card-based workspace so operators can move between Settings, Dashboard, and Run Center without relearning the layout. Those artifact cards now also expose per-subtask TDD telemetry so operators can see whether AtlasMind established the failing red signal before implementation writes, got blocked by the gate, or had no direct TDD requirement for that subtask.

AtlasMind Settings now uses a dedicated multi-page webview workspace with a persistent section nav, so routing, safety, chat context, and autonomous project controls are easier to reach without scanning one long form. The panel keeps the same validation rules on every write, adds direct shortcuts into the embedded Chat view, detached chat panel, provider management, and specialist surfaces, includes dependency-governance defaults for Atlas-built projects, exposes per-setting hover help directly inside the webview, exposes a bounded `atlasmind.feedbackRoutingWeight` dial for thumbs-based routing bias, and routes destructive project-memory purge actions through extension-side double confirmation instead of trusting the webview alone.

The Cost Dashboard panel now links spend back to the exact assistant response that produced it, shows the linked response's thumbs state in the recent-request table, and aggregates per-model approval rates plus filtered spend so feedback-weighted routing is inspectable from the same operational surface as cost data.

The Model Providers and Specialist Integrations panels now follow the same design language: each uses searchable page navigation, grouped cards instead of dense tables, and direct links back into the most relevant AtlasMind workflow or Settings page. The Model Providers panel also surfaces provider-level failure badges derived from routed model failures in the current session, so operators can see when a provider still has saved credentials but one or more of its live models have faulted and been removed from the active routing pool.

The Agent Manager, Tool Webhooks, MCP Servers, Voice, and Vision panels now follow that same workspace pattern as well. Agent rows in the sidebar open directly into the matching agent editor surface, model-provider rows open into the provider workspace, MCP overview actions can jump directly into safety settings or agent management, and page-specific settings commands plus richer sidebar empty states let operators jump directly to chat, models, safety, or project settings instead of reopening generic configuration.

When session-wide Autopilot is enabled, AtlasMind also surfaces a dedicated status bar item so the bypass state remains visible and can be disabled directly.

The Memory tree view is folder-aware: it keeps SSOT storage folders such as `architecture`, `roadmap`, `decisions`, and `operations` visible in the sidebar, files indexed notes beneath their storage paths, and still adds inline edit or review actions on each note row. Edit opens the underlying memory file directly in the editor, while the info action posts a concise assistant-style summary into Atlas chat and focuses the shared chat view on that note. The same chat-summary pattern now applies to Agent, Skill, Model, and MCP Server info actions so sidebar inspection stays inside the active conversation instead of fragmenting into transient notifications. For imported workspaces, activation also computes an SSOT freshness state from stored import fingerprints; when AtlasMind detects drift, it raises a startup warning, enables a title-bar `Update Project Memory` action on the Memory view, and pins a warning row at the top of the Memory tree so the stale state remains visible while browsing entries.
```

## Data Flow

### Single Chat Request

```
User message
  → @atlas chat participant
  → Orchestrator.processTask()
    → AgentRegistry.selectAgent()           // pick best agent by relevance
    → MemoryManager.queryRelevant()         // fetch memory context
    → TaskProfiler.profileTask()            // infer phase/modality/reasoning
    → ModelRouter.selectModel()             // budget/speed-aware selection
    → SkillsRegistry.getSkillsForAgent()    // resolve available tools
    → ProviderAdapter.complete()            // LLM call with tool definitions
    → [Tool calls loop]
      → ToolApprovalGate                    // gate destructive operations with task-aware bypass/autopilot
      → CheckpointManager.captureFiles()    // pre-write snapshot
      → Skill.execute()                     // run the tool
      → PostToolVerification                // optional test/lint
    → CostTracker.record()                  // account for tokens
  → Chat response stream
```

### Autonomous Project Execution

```
/project <goal>
  → Planner.plan()                          // LLM decomposes into ProjectPlan DAG
  → Preview + approval gate
  → TaskScheduler.execute()                 // parallel batch execution
    → For each batch:
      → Orchestrator.executeSubTask()       // ephemeral agent per subtask
  → Orchestrator.synthesize()               // final report across all subtasks
  → ProjectRunHistory.save()                // persist for Run Center
  → Chat response stream

Short continuation prompts such as `Proceed autonomously` reuse the latest substantive user request in the active chat session and route it through the same autonomous project pipeline.
```

## Extension Seams

- Agents extend through `AgentRegistry` and the Agent Manager panel.
- Skills extend through `SkillsRegistry` as built-in handlers, imported custom skills, or MCP-backed tools.
- Routed providers extend through `ProviderAdapter` plus shared runtime registration.
- Runtime plugins extend through `AtlasRuntimePlugin` and lifecycle events in `src/runtime/core.ts`.
- Tool approval, checkpoints, and post-write verification extend through `OrchestratorHooks`.
- Workflow-specific APIs that do not fit the routed chat contract belong on the specialist integration path instead of the router.

## Failure Handling And Scale

- Built-in `diagnostics` and `workspace-observability` skills provide compiler, test, terminal, and debug-session context so troubleshooting can stay inside the same workflow.
- `ProjectRunHistory` and the Project Run Center provide the primary reviewable telemetry surface for autonomous runs.
- `ToolWebhookDispatcher` is the current integration hook for external monitoring; AtlasMind does not yet ship a hosted alerting backend.
- The extension host logs shared-runtime lifecycle events to the AtlasMind output channel so startup ordering and plugin registration are observable.
- `TaskScheduler` runs only dependency-safe batches in parallel, and orchestrator concurrency, iteration, retry, and continuation limits remain bounded inside a single host process.

## Project Structure

```
src/
├── extension.ts          Entry point — creates services, registers commands/views
├── types.ts              Shared interfaces and constants
├── commands.ts           VS Code command registrations
├── chat/
│   ├── participant.ts    @atlas chat participant with slash commands
│   └── sessionConversation.ts  Persistent workspace chat sessions
├── core/
│   ├── orchestrator.ts   Central task coordinator
│   ├── agentRegistry.ts  Agent CRUD
│   ├── skillsRegistry.ts Skill CRUD + agent-skill resolution
│   ├── modelRouter.ts    Budget/speed-aware model selection
│   ├── costTracker.ts    Token cost accounting
│   ├── planner.ts        Goal → DAG decomposition
│   ├── taskScheduler.ts  DAG → parallel batch execution
│   ├── taskProfiler.ts   Task phase/modality inference
│   ├── checkpointManager.ts  Pre-write snapshots
│   ├── skillScanner.ts   Custom skill security scanning
│   ├── scannerRulesManager.ts  Rule overrides
│   ├── toolPolicy.ts     Tool risk classification
│   └── toolWebhookDispatcher.ts  Outbound webhooks
├── cli/
│   ├── main.ts           Node CLI entrypoint
│   ├── nodeMemoryManager.ts  Node SSOT loader/query layer
│   ├── nodeCostTracker.ts  CLI cost tracking
│   └── nodeSkillContext.ts  Node host implementation for built-in skills
├── mcp/
│   ├── mcpClient.ts      MCP SDK wrapper
│   └── mcpServerRegistry.ts  Server config + client management
├── memory/
│   ├── memoryManager.ts  SSOT memory CRUD + search
│   └── memoryScanner.ts  Prompt injection / credential scanning
├── providers/
│   ├── adapter.ts        ProviderAdapter interface
│   ├── anthropic.ts      Anthropic (Claude) adapter
│   ├── bedrock.ts        Amazon Bedrock adapter with SigV4 signing
│   ├── copilot.ts        GitHub Copilot adapter
│   ├── openai-compatible.ts  OpenAI-compatible adapter used by OpenAI, Azure OpenAI, DeepSeek, Mistral, Google, z.ai, xAI, Cohere, Hugging Face, NVIDIA, and Perplexity
│   ├── modelCatalog.ts   Well-known model metadata
│   ├── registry.ts       Host-neutral provider registry + local adapter
│   └── index.ts          Provider barrel for the extension host
├── runtime/
│   ├── core.ts           Shared runtime builder
│   └── secrets.ts        Host-neutral secret access contract
├── skills/
│   ├── index.ts          Built-in skill factory
│   ├── fileRead.ts       file-read, file-search, directory-list
│   ├── fileWrite.ts      file-write, file-edit, file-delete, file-move
│   ├── gitApplyPatch.ts  git-apply-patch, git-status, git-diff, git-commit, git-log, git-branch
│   ├── memoryQuery.ts    memory-query
│   ├── memoryWrite.ts    memory-write, memory-delete
│   ├── terminalRun.ts    terminal-run (allow-listed subprocess execution)
│   ├── terminalRead.ts   terminal-read (list open terminals, guide user to paste output)
│   ├── workspaceObservability.ts  workspace-state (problems, debug sessions, test results)
│   ├── debugSession.ts   debug-session (inspect + evaluate in VS Code debug)
│   ├── exaSearch.ts      exa-search (EXA API search)
│   ├── vscodeExtensions.ts  vscode-extensions (list extensions + forwarded ports)
│   └── ...               (other skill files)
├── views/
│   ├── treeViews.ts      Sidebar tree view providers, including Sessions
│   ├── chatPanel.ts      Dedicated AtlasMind session workspace webview
│   ├── projectDashboardPanel.ts  Cross-cutting workspace dashboard for repo, runtime, SSOT, security, and delivery signals
│   ├── settingsPanel.ts  Settings webview
│   ├── modelProviderPanel.ts  Routed-provider management webview backed by SecretStorage and workspace provider config
│   ├── specialistIntegrationsPanel.ts  Search/voice/image/video credential management surface
│   ├── agentManagerPanel.ts   Agent CRUD webview
│   ├── mcpPanel.ts       MCP server management webview
│   ├── toolWebhookPanel.ts    Webhook config webview
│   ├── skillScannerPanel.ts   Scanner rules webview
│   ├── costDashboardPanel.ts  Cost Dashboard webview (daily chart, model breakdown, budget bar)
│   └── webviewUtils.ts   Shared webview helpers (escapeHtml, CSP, nonce)
├── utils/
│   └── workspacePicker.ts  Multi-workspace folder selection
├── voice/
│   └── voiceManager.ts   TTS/STT bridge (ElevenLabs server-side + Web Speech API fallback)
└── bootstrap/
    └── bootstrapper.ts   Project init + import

media/
└── walkthrough/          Getting Started walkthrough content (4 steps)

tests/                    46 Vitest suites, 399 tests
  └── integration/        Multi-component integration tests
docs/                     Technical documentation
```

## Key Interfaces

All shared interfaces live in `src/types.ts`. Key types include:

| Interface | Purpose |
|-----------|---------|
| `AgentDefinition` | Agent identity, role, prompt, model constraints, cost limit, skills |
| `SkillDefinition` | Skill identity, JSON Schema parameters, handler function, timeout |
| `ModelInfo` | Model identity, provider, pricing, context window, capabilities |
| `ProviderConfig` | Provider registration, API key reference, pricing model, subscription quota |
| `CostRecord` | Per-request token counts plus provider, billing category, display cost, budget-counted cost, and optional chat session/message linkage |
| `TaskProfile` | Inferred task phase, modality, reasoning intensity, required capabilities |
| `MemoryEntry` | Memory path, title, tags, snippet, timestamp, optional embedding |
| `SubTask` | Plan node: title, role, skills, dependency edges |
| `ProjectPlan` | Goal string + SubTask DAG |
| `ProjectResult` | Execution results, synthesis, cost totals |
| `ToolInvocationPolicy` | Risk category, risk level, approval summary |
| `ToolApprovalState` | Runtime task-bypass and session autopilot flags for approval prompts |
| `McpServerConfig` | Server ID, transport type, command/args or URL |
| `SkillExecutionContext` | All workspace APIs injected into skill handlers |

## Security Boundaries

```
┌──────────────────────────────────────────────┐
│  VS Code Extension Host                      │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │  SecretStore  │  │  Workspace Sandbox   │  │
│  │  (API keys)   │  │  (file ops scoped)   │  │
│  └──────────────┘  └──────────────────────┘  │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Memory       │  │  Tool Approval Gate   │  │
│  │ Scanner      │  │  (per-tool gating)    │  │
│  └──────────────┘  └──────────────────────┘  │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Webview CSP  │  │  Terminal Allow-list  │  │
│  │ + nonces     │  │  (~40 safe commands)  │  │
│  └──────────────┘  └──────────────────────┘  │
└──────────────────────────────────────────────┘
```

- **Credentials** — VS Code SecretStorage only; never in settings, SSOT, or source
- **File operations** — workspace-sandboxed with path traversal rejection
- **Webviews** — strict CSP, nonce-protected scripts, validated message handling
- **Memory writes** — scanned for prompt injection and credential leakage
- **Terminal** — allow-list of ~40 safe commands; dangerous commands blocked
- **Tool approval** — tiered gating configurable from always-ask to allow-safe-readonly

See [[Security]] for the full security model.
