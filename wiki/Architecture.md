# Architecture

## Overview

AtlasMind is a VS Code extension built in TypeScript. It follows a service-oriented architecture where the entry point (`extension.ts`) creates all core services, bundles them into an `AtlasMindContext`, and passes them to all registration functions.

## Core Services

| Service | File | Purpose |
|---------|------|---------|
| **Orchestrator** | `src/core/orchestrator.ts` | Central coordinator: agent selection → memory → model routing → skill execution → cost tracking |
| **AgentRegistry** | `src/core/agentRegistry.ts` | CRUD for `AgentDefinition` objects; persisted enable/disable state |
| **SkillsRegistry** | `src/core/skillsRegistry.ts` | CRUD for `SkillDefinition` objects; per-skill enable/disable and security scan status |
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
| **VoiceManager** | `src/voice/voiceManager.ts` | TTS/STT bridge via Web Speech API |
| **ProjectRunHistory** | `src/core/projectRunHistory.ts` | Persists project run records for the Run Center |
| **ProviderRegistry** | `src/providers/index.ts` | Registry of provider adapters |
| **SessionConversation** | (inline) | Compact carry-forward context for the active session |

## Activation Flow

```
1. VS Code fires `onStartupFinished`
2. extension.ts → activate()
   ├── Create all core services
   ├── Register provider adapters (Anthropic, OpenAI, Copilot, z.ai, DeepSeek, Mistral, Google, Local)
   ├── Seed default models → start background model discovery
   ├── Register default agent + restore user agents from globalState
   ├── Register 26 built-in skills + restore enabled/disabled state
   ├── Auto-approve built-in skills (skip security scan)
   ├── Build SkillExecutionContext (backed by VS Code workspace APIs)
   ├── Create Orchestrator with all dependencies
   ├── Bundle everything into AtlasMindContext
   ├── Register chat participant (@atlas)
   ├── Register 18+ commands
   ├── Register tree views (sidebar)
   ├── Load SSOT memory from disk
   └── Connect MCP servers in background
3. @atlas chat + sidebar views become available
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
      → ToolApprovalGate                    // gate destructive operations
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
```

## Project Structure

```
src/
├── extension.ts          Entry point — creates services, registers commands/views
├── types.ts              Shared interfaces and constants
├── commands.ts           VS Code command registrations
├── chat/
│   └── participant.ts    @atlas chat participant with slash commands
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
├── mcp/
│   ├── mcpClient.ts      MCP SDK wrapper
│   └── mcpServerRegistry.ts  Server config + client management
├── memory/
│   ├── memoryManager.ts  SSOT memory CRUD + search
│   └── memoryScanner.ts  Prompt injection / credential scanning
├── providers/
│   ├── adapter.ts        ProviderAdapter interface
│   ├── anthropic.ts      Anthropic (Claude) adapter
│   ├── copilot.ts        GitHub Copilot adapter
│   ├── openai-compatible.ts  OpenAI/DeepSeek/Mistral/Google/z.ai adapter
│   ├── modelCatalog.ts   Well-known model metadata
│   └── index.ts          Provider registry
├── skills/
│   ├── index.ts          Built-in skill factory
│   ├── fileRead.ts       file-read, file-search, directory-list
│   ├── fileWrite.ts      file-write, file-edit, file-delete, file-move
│   ├── gitApplyPatch.ts  git-apply-patch, git-status, git-diff, git-commit, git-log, git-branch
│   ├── memoryQuery.ts    memory-query
│   ├── memoryWrite.ts    memory-write, memory-delete
│   └── ...               (other skill files)
├── views/
│   ├── treeViews.ts      Sidebar tree view providers
│   ├── settingsPanel.ts  Settings webview
│   ├── modelProviderPanel.ts  Provider management webview
│   ├── agentManagerPanel.ts   Agent CRUD webview
│   ├── mcpPanel.ts       MCP server management webview
│   ├── toolWebhookPanel.ts    Webhook config webview
│   ├── skillScannerPanel.ts   Scanner rules webview
│   └── webviewUtils.ts   Shared webview helpers (escapeHtml, CSP, nonce)
├── utils/
│   └── workspacePicker.ts  Multi-workspace folder selection
├── voice/
│   └── voiceManager.ts   TTS/STT bridge
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
| `TaskProfile` | Inferred task phase, modality, reasoning intensity, required capabilities |
| `MemoryEntry` | Memory path, title, tags, snippet, timestamp, optional embedding |
| `SubTask` | Plan node: title, role, skills, dependency edges |
| `ProjectPlan` | Goal string + SubTask DAG |
| `ProjectResult` | Execution results, synthesis, cost totals |
| `ToolInvocationPolicy` | Risk category, risk level, approval summary |
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
