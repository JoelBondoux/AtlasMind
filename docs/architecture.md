# Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  VS Code                                                        │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐  │
│  │ @atlas Chat   │   │ Sidebar      │   │ Webview Panels     │  │
│  │ Participant   │   │ Tree Views   │   │ (Dashboard, Chat,  │  │
│  │               │   │ (Agents,     │   │  Model Providers,  │  │
│  │               │   │  Skills,     │   │  Specialist        │  │
│  │               │   │  Project     │   │  Integrations,     │  │
│  │               │   │  Vision,     │   │  Tool Webhooks,    │  │
│  │ /bootstrap    │   │  Sessions)   │   │  Vision, Run       │  │
│  │ /agents       │   │  Memory,     │   │                    │  │
│  │ /skills       │   │  Models)     │   │                    │  │
│  │ /memory       │   │              │   │                    │  │
│  │ /cost         │   │              │   │                    │  │
│  └──────┬───────┘   └──────┬───────┘   └────────┬───────────┘  │
│         │                  │                     │              │
│  ───────┴──────────────────┴─────────────────────┘              │
│                            │                                    │
│                   ┌────────▼────────┐                           │
│                   │  Orchestrator   │                           │
│                   │                 │                           │
│                   │  • selectAgent  │                           │
│                   │  • gatherMemory │                           │
│                   │  • pickModel    │                           │
│                   │  • execute      │                           │
│                   │  • recordCost   │                           │
│                   └──┬────┬────┬───┘                           │
│                      │    │    │                                │
│         ┌────────────┘    │    └────────────┐                   │
│         ▼                 ▼                 ▼                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐           │
│  │ Agent       │  │ Model       │  │ Memory       │           │
│  │ Registry    │  │ Router      │  │ Manager      │           │
│  │             │  │             │  │              │           │
│  │ + Skills    │  │ + Cost      │  │ + SSOT       │           │
│  │   Registry  │  │   Tracker   │  │   Folders    │           │
│  └─────────────┘  └──────┬──────┘  └──────────────┘           │
│                          │                                     │
│                   ┌──────▼──────┐                              │
│                   │  Provider   │                              │
│                   │  Adapters   │                              │
│                   │             │                              │
│                   │ Anthropic   │                              │
│                   │ OpenAI      │                              │
│                   │ Azure       │                              │
│                   │ Google      │                              │
│                   │ Bedrock     │                              │
│                   │ Mistral     │                              │
│                   │ DeepSeek    │                              │
│                   │ Local LLM   │                              │
│                   │ Copilot     │                              │
│                   └─────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

## Activation Flow

1. VS Code triggers `onStartupFinished`.
2. `extension.ts` → `activate()` runs:
  - Uses `src/runtime/core.ts` to build the shared Atlas runtime so extension and CLI hosts seed the same default agent, providers, and built-in skills.
  - Creates core services: `CostTracker`, `AgentRegistry`, `SkillsRegistry`, `ModelRouter`, `TaskProfiler`, `MemoryManager`, `ToolWebhookDispatcher`, `SessionConversation`, `CheckpointManager`, `VoiceManager`, `ToolApprovalManager`, and `ProjectRunHistory`.
  - Creates status bar affordances for provider health and live Autopilot state.
  - Creates `ProviderRegistry` and registers provider adapters.
   - Instantiates the `Orchestrator` with all services injected, including the tool approval gate.
   - Bundles services into `AtlasMindContext`.
   - Calls `registerChatParticipant()`, `registerCommands()`, `registerTreeViews()`.
3. The `@atlas` chat participant, session workspace, and sidebar views are now available.

### CLI Flow

The Node CLI (`src/cli/main.ts`) reuses the same orchestration core through `src/runtime/core.ts` but swaps in host-specific adapters for memory, cost tracking, and skill execution:

1. Parse CLI args (`chat`, `project`, `memory`, `providers`).
2. Resolve a workspace root and auto-detect an existing SSOT root.
3. Load memory through `NodeMemoryManager`.
4. Build a Node `SkillExecutionContext` for file, git, terminal, and fetch operations.
5. Register host-neutral providers such as Anthropic, local OpenAI-compatible runtimes, and OpenAI-compatible hosted APIs from environment variables.
6. Run the same `Orchestrator` used by the extension.

## Core Services

### Orchestrator (`src/core/orchestrator.ts`)

Central coordinator. Receives a `TaskRequest` and:
1. Selects the best agent via `AgentRegistry`.
2. Gathers relevant memory slices via `MemoryManager.queryRelevant()`.
3. Builds a task profile via `TaskProfiler`.
4. Picks a model via `ModelRouter.selectModel()`.
5. Resolves skills for the agent via `SkillsRegistry.getSkillsForAgent()`.
6. Builds a context bundle and dispatches execution.
7. Compacts retrieved memory and recent session context against a model-aware prompt budget before constructing the final prompt.
8. Validates tool call arguments against skill JSON schemas before execution.
9. Applies per-tool approval policy before risky invocations, including task-aware bypass and session-wide autopilot state.
10. Runs post-write verification scripts after successful write-producing tool batches when automatic verification is enabled.
11. Records cost via `CostTracker`, tagging each request with provider billing metadata so direct or overflow-billed usage can be separated from subscription-included usage.

### ToolPolicy (`src/core/toolPolicy.ts`)

Pure helper that classifies tool invocations into risk categories (`read`, `workspace-write`, `terminal-read`, `terminal-write`, `git-read`, `git-write`, etc.) and decides whether the current approval mode should surface a confirmation prompt.

### CheckpointManager (`src/core/checkpointManager.ts`)

Tracks automatic pre-write snapshots for write-capable tool runs. Checkpoints are persisted in extension storage so the latest snapshot can still be restored through the built-in `rollback-checkpoint` skill after reloads, providing a stronger safety net for multi-file edits.

### ProjectRunHistory (`src/core/projectRunHistory.ts`)

Persists recent project-run records in `globalState`. Stores previewed/running/completed/failed run state, batch telemetry, summary report paths, changed-file summaries, and recent log entries so the Project Run Center panel and Project Runs tree view can survive reloads.

### SessionConversation (`src/chat/sessionConversation.ts`)

Persists per-workspace AtlasMind chat sessions in `workspaceState`. Tracks multiple named chat threads, the active session, per-message transcripts, and the compact carry-forward context used by the dedicated chat workspace and Sessions tree view.

### AgentRegistry (`src/core/agentRegistry.ts`)

In-memory map of `AgentDefinition` objects. Supports `register()`, `unregister()`, `get()`, `listAgents()`, `listEnabledAgents()`, and persisted enable/disable state for operator toggles.

### SkillsRegistry (`src/core/skillsRegistry.ts`)

In-memory map of `SkillDefinition` objects. Also supports:
- `getSkillsForAgent()` — resolves skills for an agent, filtered to enabled skills only.
- `enable(id)` / `disable(id)` — toggle availability; `enable` throws if the skill has a failed scan.
- `setScanResult(result)` / `getScanResult(id)` — store and retrieve security scan results.
- `setDisabledIds(ids)` / `getDisabledIds()` — bulk restore/persist disabled state.
- `registerCustomFolder(path)` / `listCustomFolders()` — track persistent custom folder paths used by the Skills sidebar.

The Skills sidebar tree now keeps bundled extension skills under a collapsed `Built-in Skills` root and then sub-categorizes them by operational area, while user custom skills can live either at the root or inside persistent nested custom folders. Imported custom skills and their folder placement are restored from `globalState` during activation. Skill rows stay compact by showing only the skill name plus inline actions; descriptions and scan details remain in the hover tooltip.

### Skill Drafting (`src/core/skillDrafting.ts`)

Utility helpers that build the prompt for Atlas-generated custom skill drafts, normalize suggested skill IDs, and extract JavaScript source from provider responses before scanning/import.

### ModelRouter (`src/core/modelRouter.ts`)

Maintains a map of `ProviderConfig` objects plus provider health state. `selectModel()` accepts `RoutingConstraints`, an optional model whitelist, and an optional `TaskProfile`. It filters by required capabilities, task-profile gates, provider health, and persisted provider/model enabled state before scoring the remaining models using budget mode, speed mode, capability proxies, pricing model awareness (subscription/free models get zero effective cost), and task fit. `selectModelsForParallel()` fills subscription/free slots first, then overflows to pay-per-token candidates. `getModelInfo()` exposes pricing metadata for orchestration cost accounting.

The Models tree view is backed by refresh events in `AtlasMindContext`, so inline provider/model toggles, provider configuration, provider-row refresh, and assign-to-agent actions immediately update the router and agent state and survive restarts via `globalState` persistence. That includes the local provider, whose configured endpoint URL lives in workspace settings while any optional auth token stays in SecretStorage. The tree renders enabled, disabled, and unconfigured states with colored status icons, adds a bracketed mixed-state warning marker when only some child models are enabled, and keeps unconfigured providers sorted to the bottom.

The Project Dashboard panel aggregates the broader operational picture for the current workspace: local git branch and drift state, recent commit cadence, Project Run History, Atlas runtime coverage, SSOT folder and memory-scan health, security and governance controls, package-manifest signals, and workflow inventory. It uses client-side timeline controls over extension-provided data so the panel can animate and re-slice charts without requerying the extension host on every interaction.

The AtlasMind sidebar now includes an embedded Chat webview plus operational tree views whose shipped order is Project Runs, Sessions, Memory, Agents, Skills, MCP Servers, then Models. Those tree views ship collapsed by default so fresh or unbootstrapped workspaces open into a quieter sidebar, while the stable contributed view ids let VS Code preserve each user's later reordering and expanded or collapsed state automatically. Sessions reopen directly into that embedded chat workspace by default, while autonomous run items still open the Project Run Center so operators can inspect live batch progress and steer approvals or pauses. The Sessions tree now supports persistent folders, inline rename per session row, archive and restore actions, and a dedicated Archive bucket that accepts dragged chat sessions and allows dragged restores back into the live session tree. The Chat, Sessions, and Memory titles all keep quick actions for the project dashboard, cost dashboard, and settings, while the project-memory action flips between `Import Existing Project` and `Update Project Memory` based on whether AtlasMind has already detected workspace SSOT state. The shared Atlas chat workspace composer now layers explicit send modes, queued workspace attachments, open-file quick links, drag-and-drop ingestion for workspace files or URLs, and per-session archive or delete actions on top of the same validated extension-host request pipeline, and the same controller also backs the detachable `AtlasMind: Open Chat Panel` surface.

The Memory tree view lists indexed SSOT entries and now exposes inline edit/review actions per row. Edit opens the underlying SSOT file in the editor, while the info action posts a concise assistant-style summary into Atlas chat and focuses the shared chat view on that note. The same chat-summary pattern now applies to Agent, Skill, Model, and MCP Server info actions so sidebar inspection stays inside the ongoing conversation instead of fragmenting into transient notifications. For imported workspaces, activation also computes an SSOT freshness state from stored import fingerprints; when AtlasMind detects drift, it raises a startup warning, enables a title-bar `Update Project Memory` action on the Memory view, and pins a warning row at the top of the Memory tree so the stale state remains visible while browsing entries.

### TaskProfiler (`src/core/taskProfiler.ts`)

Infers a `TaskProfile` from the current phase and request text. It classifies modality (`text`, `code`, `vision`, `mixed`), reasoning intensity (`low`, `medium`, `high`), and any hard or soft capability needs used by the router.

### SkillScanner (`src/core/skillScanner.ts`)

Static security scanner that checks skill source code against configurable rules. Exports `BUILTIN_SCAN_RULES` (12 rules), `resolveRules(config)` (merges overrides and custom rules), `scanSkillSource(id, source, config?)`, and `scanSkillFile(id, path, config?)`. Returns a `SkillScanResult` with per-issue details (rule, severity, line, snippet, message).

### ScannerRulesManager (`src/core/scannerRulesManager.ts`)

Persists scanner rule overrides and custom rules in `vscode.Memento` (`globalState`). Key: `atlasmind.scannerRulesConfig`. Methods: `getConfig()`, `getEffectiveRules()`, `updateBuiltInRule()`, `resetBuiltInRule()`, `upsertCustomRule()`, `deleteCustomRule()`. Validates regex patterns before accepting any change. entries per session. Provides `getSummary()` returning totals for cost, requests, and tokens. Supports `reset()`.

### MemoryManager (`src/memory/memoryManager.ts`)

Interface to the SSOT folder structure. Supports `queryRelevant()` (local hashed embeddings + lexical ranking), `upsert()`, `loadFromDisk()`, and `listEntries()`.

### ProviderRegistry (`src/providers/registry.ts`)

In-memory map of provider adapters implementing `ProviderAdapter`. The orchestrator resolves adapters by provider id (for example `anthropic`, `azure`, `bedrock`, and `local`) before executing completions. The shared registry/local-adapter module is intentionally host-neutral so the CLI can reuse it without loading VS Code-only providers. The `local` adapter supports both an offline echo fallback and a configurable OpenAI-compatible endpoint for tools such as Ollama or LM Studio, Azure OpenAI uses deployment-backed routing through the OpenAI-compatible adapter, and Bedrock uses a dedicated SigV4-signed runtime adapter.

### Shared Runtime (`src/runtime/core.ts`)

Constructs the common Atlas runtime for both hosts. It seeds default providers into the `ModelRouter`, registers the default agent, loads built-in skills, and returns the assembled registries plus `Orchestrator` so `extension.ts` and `cli/main.ts` do not duplicate bootstrapping logic.

The shared runtime now also exposes an explicit plugin contract through `AtlasRuntimePlugin`, `AtlasRuntimePluginApi`, `AtlasRuntimePluginManifest`, and `AtlasRuntimeLifecycleEvent`. Runtime plugins can register agents, skills, and provider adapters, observe lifecycle stages such as `runtime:plugin-registering` and `runtime:ready`, and publish contribution counts without editing the core bootstrap path.

## Extension And Integration Seams

AtlasMind is modular at the service boundary even though it does not yet expose a marketplace-style plugin SDK.

- **Agents** extend through `AgentRegistry`, the Agent Manager panel, and persisted `AgentDefinition` records.
- **Skills** extend through `SkillsRegistry` as built-in handlers, imported custom skills, or MCP-backed tools, all sharing the same `SkillDefinition` and `SkillExecutionContext` contracts.
- **Model providers** extend through `ProviderAdapter` plus registration in the shared runtime. Host-neutral adapters can run in both VS Code and the CLI; host-specific adapters such as Copilot stay isolated to the extension host.
- **Runtime plugins** extend through the shared runtime plugin API in `src/runtime/core.ts`, which gives contributors a stable registration surface plus lifecycle events for bootstrap diagnostics and capability discovery.
- **Execution controls** extend through `OrchestratorHooks`, which keep tool approval, checkpoint capture, and post-write verification separate from core routing.
- **Specialist integrations** that are not good fits for the routed chat-provider contract stay off the router and live behind dedicated surfaces such as the Specialist Integrations panel.

The practical extension model today is therefore: add an adapter, agent, skill, MCP server, or panel against these contracts rather than patching the orchestrator directly.

### ToolWebhookDispatcher (`src/core/toolWebhookDispatcher.ts`)

Sends outbound webhook notifications for tool execution events. Reads workspace webhook settings (`atlasmind.toolWebhook*`), stores bearer token in SecretStorage, persists delivery history in globalState, and applies timeout/event filtering before dispatch.

### McpClient (`src/mcp/mcpClient.ts`)

Wraps `@modelcontextprotocol/sdk` `Client` for a single server. Supports `connect()`, `disconnect()`, `callTool()`, `refreshTools()`. Handles `stdio` (subprocess via `StdioClientTransport`) and `http` (Streamable HTTP with SSE fallback via `StreamableHTTPClientTransport` / `SSEClientTransport`). Tracks `status: McpConnectionStatus` and surfaces `error` and `tools` as readable state.

### McpServerRegistry (`src/mcp/mcpServerRegistry.ts`)

Manages `McpServerConfig` persistence (key: `atlasmind.mcpServers` in `globalState`) and live `McpClient` instances. On `connectServer()`: instantiates a client, calls `connect()`, then registers each discovered tool as a `SkillDefinition` in `SkillsRegistry` (ID: `mcp:<serverId>:<toolName>`) with auto-approved scan status. On `disconnectServer()`: disables or unregisters the corresponding skills. `connectAll()` is called non-blocking on activation; `disposeAll()` is called on deactivation.

## Data Flow

```
User message → Chat Participant → Orchestrator.processTask()
  → AgentRegistry.selectAgent()
  → MemoryManager.queryRelevant()
  → TaskProfiler.profileTask()
  → ModelRouter.selectModel()
  → SkillsRegistry.getSkillsForAgent()
  → ProviderAdapter.complete()
  → CostTracker.record()
  → TaskResult → Chat response stream
```

Project execution flow:

```
/project <goal> → Chat Participant or Project Run Center → Orchestrator.processProject()
  → Planner.plan()          (LLM decomposes goal → ProjectPlan DAG)
  → onProgress({ type: 'planned' })
  → onProgress({ type: 'batch-start' })
  → TaskScheduler.execute()
      for each dependency batch (in parallel):
        → Orchestrator.executeSubTask()
            → ephemeral AgentDefinition (from SubTask.role)
            → Orchestrator.processTaskWithAgent()
        → onProgress({ type: 'subtask-done' })
  → Orchestrator.synthesize()  (LLM assembles final report)
  → ProjectResult → streamed to chat
```

Bootstrap flow behavior:

```
/bootstrap or command -> bootstrapProject()
  -> create SSOT structure
  -> offer governance scaffolding
     (.github workflow/templates, CODEOWNERS, .vscode/extensions.json)
  -> preserve existing files (non-destructive)
```

Import flow (existing projects):

```
/import or command -> importProject()
  -> ensure SSOT folder structure exists
  -> scan project files (manifests, README, configs, licenses)
  -> scan top-level directory listing
  -> detect project type (VS Code Extension, API Server, Web App, etc.)
  -> build + upsert memory entries (overview, dependencies, structure, conventions, license)
  -> reload memory index from disk
```

## Failure Handling And Observability

AtlasMind keeps failure handling local, explicit, and reviewable instead of hiding it behind unbounded retries.

- Missing provider adapters return a safe task result instead of crashing orchestration.
- Provider execution uses bounded retries for transient failures, bounded provider failover when a provider is unavailable, and one bounded model-escalation step when tool-loop struggle signals indicate the current route is too weak.
- `ProjectRunHistory` persists preview, running, completed, and failed run records with changed-file summaries, batch telemetry, failed-subtask titles, and recent log entries so the Project Run Center can survive reloads.
- The embedded Chat view, Sessions tree, and Project Run Center surface routed-model metadata, run-state transitions, and failure summaries directly in VS Code.
- Built-in `diagnostics` and `workspace-observability` skills provide compiler, test, terminal, and debug-session context so troubleshooting can stay inside the same workflow.
- `ToolWebhookDispatcher` is the current integration hook for external monitoring systems. AtlasMind does not yet ship a hosted alerting backend; teams that need centralized monitoring should route webhook events into their own observability stack.
- The extension host logs shared-runtime lifecycle events to the AtlasMind output channel during activation, which gives operators a first-party startup trace for plugin registration and bootstrap ordering.

The responsibility split is deliberate:

- `AgentRegistry` owns agent definitions and outcome history.
- `SkillsRegistry` owns skill availability and scan status.
- `Orchestrator` owns execution control flow and error recovery.
- `ProjectRunHistory` and `ToolWebhookDispatcher` own reviewable runtime telemetry.

## Security Boundaries

- Webviews are isolated behind a strict CSP and communicate only through validated message payloads.
- Provider credentials belong in VS Code SecretStorage and are not part of the SSOT or workspace configuration.
- Bootstrap operations are constrained to safe relative paths inside the current workspace.
- Future orchestrator execution should preserve the same rule: validate inputs, redact secrets, and prefer explicit user confirmation for risky actions.

## Concurrency And Scale Controls

AtlasMind currently scales within a single extension-host or CLI process.

- `TaskScheduler` topologically sorts project plans and executes only dependency-safe batches in parallel.
- The orchestrator caps concurrent tool execution, total tool calls per turn, tool iterations, provider retries, and continuation loops through shared constants and runtime config.
- Timeouts and approval gates apply per tool call, so concurrency does not bypass the normal safety model.
- Checkpoint capture and post-write verification remain serialized around write-producing batches to keep rollback and verification deterministic.
- Provider routing remains resource-aware through pricing, quota, capability, and health state, but AtlasMind does not yet implement distributed worker pools or cross-process load balancing.

That makes the current scalability posture suitable for editor-native and CI-style runs, while benchmark and soak testing still belong in the contributor workflow rather than being treated as an in-product guarantee.

## Quality Gates

- Local quality loop: `npm run lint`, `npm run test`, `npm run compile`.
- CI pipeline (`.github/workflows/ci.yml`) enforces compile, lint, test, and coverage for pushes and pull requests to `master`.
- Ownership and review enforcement are defined in `.github/CODEOWNERS`.

## Dependency Graph

```
extension.ts
  ├── constants.ts              (shared tunable constants)
  ├── runtime/core.ts
  ├── chat/participant.ts
  ├── chat/imageAttachments.ts
  ├── chat/sessionConversation.ts
  ├── commands.ts
  │     ├── views/chatPanel.ts
  │     ├── views/projectDashboardPanel.ts
  │     ├── views/settingsPanel.ts
  │     ├── views/modelProviderPanel.ts
  │     ├── views/specialistIntegrationsPanel.ts
  │     ├── views/toolWebhookPanel.ts
  │     ├── views/voicePanel.ts
  │     ├── views/visionPanel.ts
  │     ├── views/projectRunCenterPanel.ts
  │     ├── views/skillScannerPanel.ts
  │     ├── views/costDashboardPanel.ts
  │     ├── bootstrap/bootstrapper.ts
  │     └── utils/workspacePicker.ts
  ├── views/treeViews.ts
  └── core/orchestrator.ts
        ├── core/agentRegistry.ts
        ├── core/skillsRegistry.ts
        ├── core/modelRouter.ts
        ├── core/skillDrafting.ts
        ├── core/taskProfiler.ts
        ├── core/costTracker.ts
        ├── core/projectRunHistory.ts
        ├── core/skillScanner.ts
        ├── core/scannerRulesManager.ts
        ├── core/checkpointManager.ts
        ├── core/planner.ts
        ├── core/taskScheduler.ts
        ├── core/toolPolicy.ts
        ├── core/toolWebhookDispatcher.ts
        ├── memory/memoryManager.ts
        │     └── memory/memoryScanner.ts
        ├── mcp/mcpServerRegistry.ts
        │     └── mcp/mcpClient.ts
        ├── providers/registry.ts
        ├── skills/index.ts
          │     ├── skills/codeAction.ts
          │     ├── skills/codeSymbols.ts
          │     ├── skills/diagnostics.ts
          │     ├── skills/diffPreview.ts
          │     ├── skills/directoryList.ts
          │     ├── skills/fileEdit.ts
          │     ├── skills/fileManage.ts
          │     ├── skills/fileRead.ts
          │     ├── skills/fileSearch.ts
          │     ├── skills/validation.ts    (shared param validation helpers)
          │     ├── skills/gitApplyPatch.ts
          │     ├── skills/gitBranch.ts
          │     ├── skills/gitCommit.ts
          │     ├── skills/gitDiff.ts
          │     ├── skills/gitStatus.ts
          │     ├── skills/memoryDelete.ts
          │     ├── skills/memoryQuery.ts
          │     ├── skills/memoryWrite.ts
          │     ├── skills/renameSymbol.ts
          │     ├── skills/rollbackCheckpoint.ts
          │     ├── skills/terminalRun.ts
          │     ├── skills/terminalRead.ts
          │     ├── skills/testRun.ts
          │     ├── skills/textSearch.ts
          │     ├── skills/vscodeExtensions.ts
          │     ├── skills/webFetch.ts
          │     ├── skills/workspaceObservability.ts
          │     ├── skills/exaSearch.ts
          │     └── skills/debugSession.ts
        └── providers/index.ts
            ├── providers/anthropic.ts
            ├── providers/bedrock.ts
            ├── providers/copilot.ts
            ├── providers/openai-compatible.ts
            └── providers/modelCatalog.ts

cli/main.ts
  ├── runtime/core.ts
  ├── cli/nodeMemoryManager.ts
  ├── cli/nodeCostTracker.ts
  ├── cli/nodeSkillContext.ts
  ├── providers/registry.ts
  ├── providers/anthropic.ts
  ├── providers/openai-compatible.ts
  └── core/orchestrator.ts

tests/bootstrap/
  └── bootstrapper.test.ts
tests/integration/
  └── taskLifecycle.test.ts
tests/core/
  ├── modelRouter.test.ts
  ├── costTracker.test.ts
  ├── projectRunHistory.test.ts
  ├── skillScanner.test.ts
  ├── skillDrafting.test.ts
  └── planner.scheduler.test.ts
tests/memory/
  ├── memoryManager.test.ts
  └── memoryScanner.test.ts
tests/mcp/
  ├── mcpClient.test.ts
  └── mcpServerRegistry.test.ts
tests/providers/
  ├── providerAdapters.test.ts
  ├── modelCatalog.test.ts
  └── copilotDiscovery.test.ts
tests/skills/
  ├── fileEdit.test.ts
  ├── gitApplyPatch.test.ts
  ├── terminalRun.test.ts
  └── textSearch.test.ts
tests/views/
  └── webviewMessages.test.ts
```

## Key Interfaces

All shared types live in `src/types.ts`. See the [type definitions](../src/types.ts) for the full source.

| Interface | Purpose |
|---|---|
| `AgentDefinition` | Agent identity, role, system prompt, allowed models, cost limit, skills |
| `SkillDefinition` | Skill identity, JSON Schema for tool params, handler path |
| `ModelInfo` | Model identity, provider, pricing, context window, capabilities, `premiumRequestMultiplier` |
| `ProviderConfig` | Provider identity, API key setting key, enabled flag, pricing model, model list, `subscriptionQuota` |
| `RoutingConstraints` | Budget mode, speed mode, max cost, preferred provider, parallel slots |
| `SubscriptionQuota` | Quota tracking for subscription providers: total/remaining requests, reset time, cost per unit |
| `ToolApprovalState` | Runtime task-bypass and session autopilot state for approval prompts |
| `ToolInvocationPolicy` | Tool risk category, risk level, and human-readable approval summary |
| `TaskProfile` | Inferred task phase, modality, reasoning intensity, and capability preferences |
| `SubTask` | Unit of work in a project plan: id, title, role, skills, `dependsOn` edges |
| `SubTaskResult` | Execution outcome: status, output, costUsd, durationMs, error |
| `ProjectPlan` | Decomposed goal: id, goal, `subTasks[]` DAG |
| `ProjectResult` | Full execution outcome: subtask results, synthesis, totals |
| `ProjectProgressUpdate` | Discriminated progress event: `planned \| subtask-start \| subtask-done \| synthesizing \| error` |
| `TaskRequest` | User message, context, constraints, timestamp |
| `TaskResult` | Agent ID, model used, response, cost, duration |
| `CostRecord` | Per-request token counts plus provider, billing category, display cost, budget-counted cost, and optional chat session/message linkage |
| `MemoryEntry` | Path, title, tags, last modified, snippet |
| `McpServerConfig` | MCP server id, name, transport (stdio/http), command/args/env or url, enabled |
| `McpConnectionStatus` | `'disconnected' \| 'connecting' \| 'connected' \| 'error'` |
| `McpToolInfo` | Server id, tool name, description, input JSON Schema |
| `VoiceSettings` | TTS/STT rate, pitch, volume, and language settings validated before use |
| `McpServerState` | Live snapshot: config + status + error + discovered tools |
| `OrchestratorHooks` | Optional callback bag: task-aware toolApprovalGate, writeCheckpointHook, postToolVerifier |
| `OrchestratorConfig` | Runtime-configurable tunables: maxToolIterations, maxToolCallsPerTurn, timeouts |
