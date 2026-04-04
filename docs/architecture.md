# Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  VS Code                                                        │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐  │
│  │ @atlas Chat   │   │ Sidebar      │   │ Webview Panels     │  │
│  │ Participant   │   │ Tree Views   │   │ (Settings,         │  │
│  │               │   │ (Agents,     │   │  Model Providers,  │  │
│  │               │   │  Skills,     │   │  Tool Webhooks)    │  │
│  │ /bootstrap    │   │  Skills,     │   │                    │  │
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
│                   │ Google      │                              │
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
  - Creates core services: `CostTracker`, `AgentRegistry`, `SkillsRegistry`, `ModelRouter`, `TaskProfiler`, `MemoryManager`, `ToolWebhookDispatcher`, `SessionConversation`, `CheckpointManager`, and `VoiceManager`.
  - Creates `ProviderRegistry` and registers provider adapters.
   - Instantiates the `Orchestrator` with all services injected, including the tool approval gate.
   - Bundles services into `AtlasMindContext`.
   - Calls `registerChatParticipant()`, `registerCommands()`, `registerTreeViews()`.
3. The `@atlas` chat participant and sidebar views are now available.

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
9. Applies per-tool approval policy before risky invocations.
10. Runs post-write verification scripts after successful write-producing tool batches when automatic verification is enabled.
11. Records cost via `CostTracker`.

### ToolPolicy (`src/core/toolPolicy.ts`)

Pure helper that classifies tool invocations into risk categories (`read`, `workspace-write`, `terminal-read`, `terminal-write`, `git-read`, `git-write`, etc.) and decides whether the current approval mode should surface a confirmation prompt.

### CheckpointManager (`src/core/checkpointManager.ts`)

Tracks automatic pre-write snapshots for write-capable tool runs. Checkpoints are persisted in extension storage so the latest snapshot can still be restored through the built-in `rollback-checkpoint` skill after reloads, providing a stronger safety net for multi-file edits.

### AgentRegistry (`src/core/agentRegistry.ts`)

In-memory map of `AgentDefinition` objects. Supports `register()`, `unregister()`, `get()`, `listAgents()`, `listEnabledAgents()`, and persisted enable/disable state for operator toggles.

### SkillsRegistry (`src/core/skillsRegistry.ts`)

In-memory map of `SkillDefinition` objects. Also supports:
- `getSkillsForAgent()` — resolves skills for an agent, filtered to enabled skills only.
- `enable(id)` / `disable(id)` — toggle availability; `enable` throws if the skill has a failed scan.
- `setScanResult(result)` / `getScanResult(id)` — store and retrieve security scan results.
- `setDisabledIds(ids)` / `getDisabledIds()` — bulk restore/persist disabled state.

### Skill Drafting (`src/core/skillDrafting.ts`)

Utility helpers that build the prompt for Atlas-generated custom skill drafts, normalize suggested skill IDs, and extract JavaScript source from provider responses before scanning/import.

### ModelRouter (`src/core/modelRouter.ts`)

Maintains a map of `ProviderConfig` objects plus provider health state. `selectModel()` accepts `RoutingConstraints`, an optional model whitelist, and an optional `TaskProfile`. It filters by required capabilities, task-profile gates, and provider health before scoring the remaining models using budget mode, speed mode, capability proxies, pricing model awareness (subscription/free models get zero effective cost), and task fit. `selectModelsForParallel()` fills subscription/free slots first, then overflows to pay-per-token candidates. `getModelInfo()` exposes pricing metadata for orchestration cost accounting.

### TaskProfiler (`src/core/taskProfiler.ts`)

Infers a `TaskProfile` from the current phase and request text. It classifies modality (`text`, `code`, `vision`, `mixed`), reasoning intensity (`low`, `medium`, `high`), and any hard or soft capability needs used by the router.

### SkillScanner (`src/core/skillScanner.ts`)

Static security scanner that checks skill source code against configurable rules. Exports `BUILTIN_SCAN_RULES` (12 rules), `resolveRules(config)` (merges overrides and custom rules), `scanSkillSource(id, source, config?)`, and `scanSkillFile(id, path, config?)`. Returns a `SkillScanResult` with per-issue details (rule, severity, line, snippet, message).

### ScannerRulesManager (`src/core/scannerRulesManager.ts`)

Persists scanner rule overrides and custom rules in `vscode.Memento` (`globalState`). Key: `atlasmind.scannerRulesConfig`. Methods: `getConfig()`, `getEffectiveRules()`, `updateBuiltInRule()`, `resetBuiltInRule()`, `upsertCustomRule()`, `deleteCustomRule()`. Validates regex patterns before accepting any change. entries per session. Provides `getSummary()` returning totals for cost, requests, and tokens. Supports `reset()`.

### MemoryManager (`src/memory/memoryManager.ts`)

Interface to the SSOT folder structure. Supports `queryRelevant()` (local hashed embeddings + lexical ranking), `upsert()`, `loadFromDisk()`, and `listEntries()`.

### ProviderRegistry (`src/providers/index.ts`)

In-memory map of provider adapters implementing `ProviderAdapter`. The orchestrator resolves adapters by provider id (for example `anthropic` and `local`) before executing completions.

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
/project <goal> → Chat Participant → Orchestrator.processProject()
  → Planner.plan()          (LLM decomposes goal → ProjectPlan DAG)
  → onProgress({ type: 'planned' })
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

## Security Boundaries

- Webviews are isolated behind a strict CSP and communicate only through validated message payloads.
- Provider credentials belong in VS Code SecretStorage and are not part of the SSOT or workspace configuration.
- Bootstrap operations are constrained to safe relative paths inside the current workspace.
- Future orchestrator execution should preserve the same rule: validate inputs, redact secrets, and prefer explicit user confirmation for risky actions.

## Quality Gates

- Local quality loop: `npm run lint`, `npm run test`, `npm run compile`.
- CI pipeline (`.github/workflows/ci.yml`) enforces compile, lint, test, and coverage for pushes and pull requests to `master`.
- Ownership and review enforcement are defined in `.github/CODEOWNERS`.

## Dependency Graph

```
extension.ts
  ├── chat/participant.ts
  ├── chat/sessionConversation.ts
  ├── commands.ts
  │     ├── views/settingsPanel.ts
  │     ├── views/modelProviderPanel.ts
  │     ├── views/toolWebhookPanel.ts
  │     ├── views/voicePanel.ts
  │     ├── views/skillScannerPanel.ts
  │     └── bootstrap/bootstrapper.ts
  ├── views/treeViews.ts
  └── core/orchestrator.ts
        ├── core/agentRegistry.ts
        ├── core/skillsRegistry.ts
        ├── core/modelRouter.ts
        ├── core/skillDrafting.ts
        ├── core/taskProfiler.ts
        ├── core/costTracker.ts
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
          ├── skills/index.ts
          │     ├── skills/directoryList.ts
          │     ├── skills/fileEdit.ts
          │     ├── skills/gitApplyPatch.ts
          │     ├── skills/gitCommit.ts
          │     ├── skills/gitDiff.ts
          │     ├── skills/gitStatus.ts
          │     ├── skills/rollbackCheckpoint.ts
          │     ├── skills/terminalRun.ts
          │     └── skills/textSearch.ts
          └── providers/index.ts
              ├── providers/anthropic.ts
              ├── providers/copilot.ts
              └── providers/modelCatalog.ts

tests/bootstrap/
  └── bootstrapper.test.ts
tests/core/
  ├── modelRouter.test.ts
  ├── costTracker.test.ts
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
| `ToolInvocationPolicy` | Tool risk category, risk level, and human-readable approval summary |
| `TaskProfile` | Inferred task phase, modality, reasoning intensity, and capability preferences |
| `SubTask` | Unit of work in a project plan: id, title, role, skills, `dependsOn` edges |
| `SubTaskResult` | Execution outcome: status, output, costUsd, durationMs, error |
| `ProjectPlan` | Decomposed goal: id, goal, `subTasks[]` DAG |
| `ProjectResult` | Full execution outcome: subtask results, synthesis, totals |
| `ProjectProgressUpdate` | Discriminated progress event: `planned \| subtask-start \| subtask-done \| synthesizing \| error` |
| `TaskRequest` | User message, context, constraints, timestamp |
| `TaskResult` | Agent ID, model used, response, cost, duration |
| `CostRecord` | Per-request token counts and cost |
| `MemoryEntry` | Path, title, tags, last modified, snippet |
| `McpServerConfig` | MCP server id, name, transport (stdio/http), command/args/env or url, enabled |
| `McpConnectionStatus` | `'disconnected' \| 'connecting' \| 'connected' \| 'error'` |
| `McpToolInfo` | Server id, tool name, description, input JSON Schema |
| `VoiceSettings` | TTS/STT rate, pitch, volume, and language settings validated before use |
| `McpServerState` | Live snapshot: config + status + error + discovered tools |
