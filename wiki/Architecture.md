# Architecture

## Overview

AtlasMind is a VS Code extension built in TypeScript, and it now also ships a small Node CLI. Both hosts share the same service-oriented runtime builder so orchestration, routing, skills, and memory loading stay consistent.

## Core Services

| Service | File | Purpose |
|---------|------|---------|
| **Orchestrator** | `src/core/orchestrator.ts` | Central coordinator: agent selection -> retrieval policy -> memory and live evidence -> model routing -> skill execution -> cost tracking |
| **AgentRegistry** | `src/core/agentRegistry.ts` | CRUD for `AgentDefinition` objects; persisted enable/disable state |
| **SkillsRegistry** | `src/core/skillsRegistry.ts` | CRUD for `SkillDefinition` objects; per-skill enable/disable, security scan status, and persistent custom skill folders |
| **ModelRouter** | `src/core/modelRouter.ts` | Budget/speed-aware model selection with subscription quota tracking and specialist-domain metadata exposure |
| **CostTracker** | `src/core/costTracker.ts` | Per-request and per-session cost accumulation |
| **MemoryManager** | `src/memory/memoryManager.ts` | SSOT folder read/write/search with semantic retrieval, source-backed evidence pointers, and security scanning |
| **MemoryScanner** | `src/memory/memoryScanner.ts` | Scans content for prompt injection and credential leakage |
| **TaskProfiler** | `src/core/taskProfiler.ts` | Infers task phase, modality, and reasoning intensity |
| **Planner** | `src/core/planner.ts` | Decomposes goals into DAGs of subtasks via LLM |
| **TaskScheduler** | `src/core/taskScheduler.ts` | Topologically sorts DAGs into batches and runs them in parallel |
| **CheckpointManager** | `src/core/checkpointManager.ts` | Pre-write snapshots for safe rollback |
| **SkillScanner** | `src/core/skillScanner.ts` | Security scanner with 12 rules for custom skill validation |
| **ScannerRulesManager** | `src/core/scannerRulesManager.ts` | Configurable rule overrides persisted in globalState |
| **McpClient** | `src/mcp/mcpClient.ts` | MCP SDK wrapper for stdio and HTTP transports |
| **McpServerRegistry** | `src/mcp/mcpServerRegistry.ts` | Persists MCP server configs; manages connections; bridges tools as skills; imports compatible VS Code `mcp.json` entries into AtlasMind |
| **ToolWebhookDispatcher** | `src/core/toolWebhookDispatcher.ts` | Sends outbound webhooks for tool lifecycle events |
| **VoiceManager** | `src/voice/voiceManager.ts` | TTS/STT bridge; uses ElevenLabs API server-side when configured, falls back to Web Speech API, and persists preferred audio-device ids for capable runtimes |
| **ProjectRunHistory** | `src/core/projectRunHistory.ts` | Persists workspace-scoped project run records, staged planner-job metadata, and follow-up seed outputs for the Run Center |
| **ProviderRegistry** | `src/providers/registry.ts` | Host-neutral registry of provider adapters |
| **SessionConversation** | `src/chat/sessionConversation.ts` | Persistent workspace chat sessions and compact carry-forward context |
| **Shared Runtime** | `src/runtime/core.ts` | Common bootstrapping path used by the extension and CLI |

## Activation Flow

```text
1. VS Code fires `onStartupFinished`
2. extension.ts -> activate()
  |- Build shared runtime via `src/runtime/core.ts`
  |- Create all core services
  |- Register provider adapters (Anthropic, Claude CLI Beta, OpenAI, Azure OpenAI, Bedrock, Copilot, z.ai, DeepSeek, Mistral, Google, Local)
  |- Seed default models -> restore persisted model availability -> start background model discovery
  |- Register default agent + restore user agents from globalState
  |- Register 32 built-in skills + restore enabled/disabled state
  |- Auto-approve built-in skills (skip security scan)
  |- Build SkillExecutionContext (backed by VS Code workspace APIs)
  |- Create Orchestrator with all dependencies
  |- Bundle everything into AtlasMindContext
  |- Register chat participant (@atlas)
  |- Register 19+ commands
  |- Register tree views (sidebar, including Sessions)
  |- Load SSOT memory from disk
  `- Connect MCP servers in background
3. @atlas chat + sidebar views become available

The CLI (`src/cli/main.ts`) follows the same runtime path but swaps in Node-backed memory, cost, and skill-context adapters. It supports `chat`, `project`, `memory`, and `providers` commands and auto-detects an existing SSOT root from the current workspace.

The shared runtime now also exposes an explicit plugin contract through `AtlasRuntimePlugin`, `AtlasRuntimePluginApi`, `AtlasRuntimePluginManifest`, and `AtlasRuntimeLifecycleEvent`. Runtime plugins can register agents, skills, and provider adapters, observe lifecycle stages such as `runtime:plugin-registering` and `runtime:ready`, and publish contribution counts without editing the core bootstrap path.

The Models tree view is stateful: provider and model rows expose inline enable/disable, configure, refresh, info, and assign-to-agent actions, and the enabled/model-assignment state is persisted in VS Code `globalState` so routing behavior survives restarts and catalog refreshes. For the local provider, the endpoint URL lives in workspace settings while any optional API key stays in SecretStorage. Azure OpenAI and Bedrock follow the same split, with deployment or model-list settings in the workspace and credentials in SecretStorage. Visible status is rendered with colored icons, mixed provider states add a bracketed warning marker, and unconfigured providers are kept at the bottom of the list.

The Skills tree keeps each row compact by showing only the skill name and inline actions. Built-in skills are grouped under a `Built-in Skills` root and then sub-categorized by operational area, while user custom skills can live at the root or inside persistent nested folders. Descriptions, parameters, and scan details stay available in the hover tooltip instead of taking horizontal space in the sidebar.

The AtlasMind sidebar now starts with a composite Home webview that anchors major UI surfaces directly under the container title, then continues with the embedded Chat view plus operational tree views whose shipped order is Project Runs, Sessions, Memory, Agents, Skills, MCP Servers, then Models. Home replaces the earlier one-row Quick Links strip with an internal accordion that groups quick actions, recent sessions, recent autonomous runs, and workspace status into a single surface. Because this behavior is implemented inside one webview instead of across native VS Code sibling views, those sections can close upward, auto-size to their content, push lower sections down as they grow, and remember manual heights when the operator drags a section resizer. Those tree views ship collapsed by default so fresh or unbootstrapped workspaces start with a quieter sidebar, while the stable view ids let VS Code preserve each user's later reordering and expanded or collapsed state automatically. Selecting a chat thread reopens the shared Atlas chat workspace on that session, while selecting an autonomous run opens the Project Run Center where live batches can be inspected, paused, approved, or resumed. The Sessions tree now supports persistent folders, inline rename on each session row, archive and restore actions, and a dedicated Archive bucket that accepts dragged chat sessions and allows dragged restores back into the live tree or folder targets. The Chat, Sessions, and Memory titles all keep quick actions for the project dashboard, cost dashboard, and settings, while the project-memory action switches between `Import Existing Project` and `Update Project Memory` once AtlasMind detects workspace SSOT state. The shared Atlas chat workspace now stores per-assistant-turn metadata so each bubble can show the routed model, a collapsible thinking summary based on execution metadata, and ambiguity-aware follow-up choices for concrete repo-local diagnostics. That summary now includes token totals and request cost alongside routing and tool-loop details, and active freeform turns can inject transient `_Thinking: ..._` progress lines from orchestrator execution events while the run is still in flight. For ambiguous bug reports, AtlasMind can answer diagnostically first and then offer follow-up actions such as `Fix This`, `Explain Only`, and `Fix Autonomously` without forcing execution up front. The embedded chat webview now sizes itself against the host container instead of a raw `100vh` viewport assumption, which keeps the Sessions rail visible inside the sidebar container instead of letting the chat surface run taller than its allocated view. Its responsive Sessions rail keeps the drawer toggle and new-session action on a single compact row in narrow layouts, reflows into a persistent left sidebar once the chat webview is at least 1000px wide, and in that wider detached or centered presentation can now collapse back to a slim left rail without pushing the composer into a separate right-hand column. Each live session row still exposes compact archive and delete icon actions. Assistant bubbles also expose thumbs up/down controls; those votes are validated in the extension host, persisted with the transcript entry, and aggregated into a small per-model routing preference signal. The assistant footer keeps the thinking-summary disclosure left-aligned and compact outlined vote controls right-aligned within the same bubble row while also rendering persisted follow-up chips when the assistant offered an execution choice. Assistant response bodies in the embedded panel are rendered as safe markdown instead of plain text, the transient Thinking notes plus the expanded thinking-summary body use a slightly smaller, lower-contrast style so internal reasoning remains secondary to the main answer, compact `A-` / `A+` controls in the panel header adjust chat-bubble typography through a persisted webview font-scale value that now extends three steps below the previous minimum, and pasted or dropped local media can now be browser-serialized into inline prompt attachments instead of depending on workspace-relative paths. It also renders an animated AtlasMind globe while the latest assistant turn is still thinking, with the rotating axis group anchored to the shared SVG viewbox center so the mark stays intact through the loop. Its composer supports explicit send modes, queued workspace attachments, quick-add chips for currently open files, drag-and-drop ingestion for workspace files, local media, or URLs before those inputs are normalized into safe prompt context, CLI-style Up or Down history recall for recent submitted prompts when the caret is already at the start or end of the composer, a Stop action that cancels the active chat turn from the same input area, and managed terminal launch directives such as `@tps <command>`, `@tpowershell <command>`, `@twindowspowershell <command>`, `@twinps <command>`, `@tpwsh <command>`, `@tpowershell7 <command>`, `@tps7 <command>`, `@tpsh <command>`, `@tgit <command>`, `@tbash <command>`, `@tgitbash <command>`, `@tcmd <command>`, and `@tcommandprompt <command>` that open shell-integrated terminal sessions, stream terminal output back into the transcript, and let AtlasMind request at most one additional approval-gated command in the same session before it emits the final summary. Those managed launches now go straight through the normal tool-risk classification and approval flow instead of requiring the separate `atlasmind.allowTerminalWrite` toggle first. Bare aliases such as `@tcmd` are intercepted as usage prompts instead of falling through to the routed model. The same controller also backs the detachable AtlasMind chat panel. Profile-backed or remote terminals such as JavaScript Debug Terminal and Azure Cloud Shell are not routed through this managed path yet because it depends on a concrete local shell executable plus shell integration readback. Tool approvals now use that same shared chat surface: when a tool call needs confirmation, AtlasMind queues an approval card in the chat UI with Allow Once, Bypass Approvals, Autopilot, and Deny actions instead of interrupting the operator with an OS modal dialog, and managed terminal launches reuse that approval flow instead of bypassing it. In the Models tree specifically, duplicate-friendly names are now disambiguated inline with the exact model slug, so multiple provider variants such as repeated Claude Opus 4 entries remain identifiable without opening each row.

AtlasMind also exposes a dedicated Project Dashboard panel for cross-cutting workspace observability. It combines git branch status, recent commit velocity, Project Run History activity, Atlas runtime readiness, SSOT directory coverage, memory scan warnings, security and governance controls, dependency signals, workflow inventory, and aggregate `/project` TDD posture into one interactive surface with adjustable timeline windows. That dashboard now links out to a separate Project Ideation panel instead of embedding the board inline, so it stays focused on observability while still surfacing ideation counts and launch points. Its Operational Score cards now open a dedicated breakdown view that itemizes component scoring, folds in desired-outcome completeness from SSOT and run telemetry, and organizes improvement recommendations across short-, medium-, and long-term horizons. The outcome-completeness tiles and recommendation cards can also open Atlas chat with drafted prompts aimed at the underlying concern, giving operators a direct path from a dashboard signal to a concrete first-pass action. AtlasMind's guided bootstrap now feeds this surface earlier by seeding the SSOT brief, roadmap, ideation board, project-scoped personality defaults, and planning files before the first delivery task is even run.

The Project Ideation panel is AtlasMind's dedicated multimodal whiteboard. It keeps draggable cards, editable link lines, focused-card inspection, queued Atlas follow-up prompts, facilitation history, browser-side voice capture and narration, drag/drop and paste-driven media ingestion, and inline card editing in one surface. The canvas now owns the full available width in the standard workspace layout and can expand into a true viewport-filling board mode with a clear return-to-normal control, while still supporting pan across a larger board area, zoom with Ctrl/Cmd plus wheel or keyboard shortcuts, fit-to-board, and subtle edge glows for off-screen cards. Relationship links are first-class editable objects with label, relation type, line-style, arrow-direction, and delete controls, and the board now collapses card detail as zoom decreases so the canvas stays legible at a distance. The canvas interaction model now also tracks the last two clicked cards as an ordered pair, surfaces their state on the bottom edge of each card rather than on every corner, and lets operators create inferred or typed relations directly from the keyboard. Atlas-generated cards now land in clearer structural lanes so the board reads more like a left-to-right flow of context, decisions, constraints, actions, risks, and outputs rather than a scattered set of notes, and relation-aware defaults now give those links directional travel automatically. Each facilitation pass now assembles a deterministic context packet from the active prompt, queued media, explicit constraints, selected-card lineage, and SSOT-derived project metadata, and before the routed model answers the extension also infers likely board facets from the prompt itself, such as external references, current-system context, code considerations, operator workflow impact, and team or process implications. That inferred scaffold is previewed directly in the composer, supplied to the facilitation prompt, and then reconciled against the active board through explicit card updates, relationship rewiring, and stale-card archiving so later prompts can genuinely reshape the whiteboard instead of only appending more child cards. Prompt-inference cards now also receive stronger default linking when Atlas is seeding the board from scratch, and the feedback panel derives both Next Prompts and Next Cards dynamically from the latest facilitation output and any still-missing board facets so operators can close obvious gaps directly from Atlas Feedback. The surface now also includes a staged workflow guide and pervasive hover/focus tooltips across major sections and controls so first-time users can understand what the ideation phase is trying to achieve and what each action changes. The composer now frames its primary action as creating or evolving the board, including a Ctrl/Cmd+Enter submission shortcut, so a fresh ideation prompt reads as a direct board action instead of an abstract loop command. Its relationship links now also use relation-specific colours, markers, and path shapes so support, dependency, contradiction, opportunity, and causal flows remain distinguishable even on denser boards, and the canvas adds visible hierarchy lanes plus an angular-vs-spline routing toggle so operators can reduce overlap on demand. Operators can now switch into review-oriented workflow views that temporarily re-layout the same board for clarity, isolate relation families through a dedicated filter, and visually fade unrelated cards and links when inspecting a selected node or relationship. Link labels now render through a collision-aware badge placement pass rather than sitting directly on the routed line, and the board world itself now provides substantially more travel room so panning is no longer cut off prematurely near the outer edges. Its meta-thinking analytics now also surface expandable warning chips for non-green findings, with one-click insertions for linked experiment, evidence, risk, or checkpoint cards so deep analysis produces immediate board actions instead of passive observations. Cards also carry structured modes, scoring, tags, optional project-memory sync targets, and an explicit handoff into Project Run Center that seeds a run preview from the selected ideation card. Completed or failed runs can later feed their learnings back into the originating ideation thread or start a fresh ideation branch, which closes the loop between whiteboarding and execution. New cards are placed with collision avoidance and, when created from the current focus context, gain an automatic association link. Ideation board state persists into `project_memory/ideas/` as both JSON and markdown artifacts so the same project-memory system can retain ideation output. Guided bootstrap now seeds that board with initial cards, constraints, and metadata so the first ideation session starts from the captured project brief rather than a blank canvas.

The Project Run Center now shares that same professional visual language: autonomous-run review, batch approval controls, run history, changed-file inspection, and subtask artifacts all sit inside a card-based workspace so operators can move between Settings, Dashboard, and Run Center without relearning the layout. It now frames preview as a reviewable execution draft, explains what subtasks and impact estimates mean, treats approval thresholds as advisory guidance rather than hard caps, and exposes a seeded draft-refinement jump into a dedicated Atlas chat session before execution. For oversized drafts it can also stage execution into multiple planner jobs: Atlas runs the first dependency-safe job, stores its outputs, and queues the remaining scope as the next preview so operators do not have to push one monolithic run through the panel. Autonomous runs now persist a dedicated short subject title alongside the full goal, durable execution options for autonomous mode and chat mirroring, a synthesized final output block, optional carry-forward context for staged follow-up jobs, and ideation-origin metadata when the run started from the whiteboard, which keeps run history readable in both the Run Center and the chat panel without discarding the full execution brief. That origin metadata also powers Run Center actions that send completed or failed learnings back into ideation as either an update to the original thread or a new ideation branch. Operators can also delete non-running historical runs directly from that surface when they want to prune stale local telemetry without touching saved workspace reports or changed files. Those artifact cards now also expose per-subtask TDD telemetry so operators can see whether AtlasMind established the failing red signal before implementation writes, got blocked by the gate, or had no direct TDD requirement for that subtask.

AtlasMind Settings now uses a dedicated multi-page webview workspace with a persistent section nav, so routing, safety, chat context, and autonomous project controls are easier to reach without scanning one long form. The panel keeps the same validation rules on every write, adds direct shortcuts into the embedded Chat view, detached chat panel, provider management, and specialist surfaces, includes dependency-governance defaults for Atlas-built projects, exposes per-setting hover help directly inside the webview, adds hover and focus tooltips on each Budget and Speed choice pill so routing tradeoffs are visible at the option level, keeps the installed extension version visible in the hero banner's lower-right corner, exposes a bounded `atlasmind.feedbackRoutingWeight` dial for thumbs-based routing bias, surfaces text-to-speech playback controls directly on the Models & Integrations page, manages local OpenAI-compatible routing through a dynamic labeled endpoint list with add/remove controls, auto-migrates an explicit legacy single local endpoint into that structured list the first time operators open Settings, isolates the nav wiring from the rest of the page-control initialization so page switching stays responsive even if a later widget fails, progressively enhances the left-side menu from ordinary anchor navigation into the richer single-page tab behavior after the settings script boots, keeps the settings sections separated through a CSS `:target` fallback before JavaScript takes over, server-renders explicit page targets so commands can reopen an already-visible Settings panel at a specific page or card without relying on live script messaging, now binds each nav link directly and synchronizes page changes through the URL hash so the side menu still responds even when webview state is restored, prevents stale remembered pages from overriding an explicit deep-link target such as Local LLM Configure, and routes destructive project-memory purge actions through extension-side double confirmation instead of trusting the webview alone.

The Cost Dashboard panel now links spend back to the exact assistant response that produced it, shows the linked response's thumbs state in the recent-request table, and aggregates per-model approval rates plus filtered spend so feedback-weighted routing is inspectable from the same operational surface as cost data.

The Model Providers and Specialist Integrations panels now follow the same design language: each uses searchable page navigation, grouped cards instead of dense tables, and direct links back into the most relevant AtlasMind workflow or Settings page. Their hero summary chips now either jump into a full catalog filtered by setup status or expose a tooltip when the chip is explanatory only. The Model Providers panel also surfaces provider-level failure badges derived from routed model failures in the current session, marks subscription-backed providers such as GitHub Copilot and Claude CLI with a dedicated inline icon on the provider title, and on the Platform & Local page now lists each configured local endpoint by label and base URL so operators can tell which local engine is which without opening settings first.

 The Agent Manager, Tool Webhooks, MCP Servers, Voice, Vision, and Personality Profile panels now follow that same workspace pattern as well. The Voice panel is now explicit about backend capability boundaries: it persists STT enablement plus preferred microphone and speaker ids, enumerates devices from the webview runtime, applies preferred output routing to ElevenLabs audio through `setSinkId()` when available, and calls out that Web Speech still follows the default browser or OS device where no direct routing API exists. AtlasMind does not yet ship an OS-native speech host adapter, but the stored device ids keep that seam ready for a future platform-specific backend. The Personality Profile surface is AtlasMind's guided operator questionnaire: it captures personality answers through freeform fields backed by quick-fill presets, lets the operator save them either as a global baseline or as a project-specific override, writes the paired live settings at user or workspace scope to match that save target, and now distinguishes clearly between editor-only load actions and the destructive action that clears the saved project override. The extension runtime merges any project override on top of the saved global profile before injecting that effective operator profile into task prompt assembly on every request. When SSOT is present, only project-specific saves mirror into `project_memory/agents/` plus a summary block inside `project_soul.md`, which keeps user-wide defaults out of repo-owned memory. The panel also exposes direct-open links for the generated project profile markdown and `project_soul.md` when those project artifacts exist. Agent rows in the sidebar open directly into the matching agent editor surface, model-provider rows open into the provider workspace, MCP overview actions can jump directly into safety settings or agent management, and page-specific settings commands plus richer sidebar empty states let operators jump directly to chat, models, safety, or project settings instead of reopening generic configuration. Their hero summary chips now act as lightweight navigation shortcuts whenever a matching page exists, rather than remaining inert labels. Within the shared Atlas chat surface itself, approval prompts are rendered in a dedicated warning stack below the transcript and above the composer so execution decisions stay visually separate from conversation history while still living in the same webview, the header toolbar now includes direct shortcuts into the Project Run Dashboard and the main sidebar chat view while preserving the current chat target, the toolbar and composer icon buttons now use explicit centering styles so their glyphs stay visually centered inside circular controls, the dedicated panel can surface a direct-recovery banner when the extension host detects operator frustration and shifts the active turn toward corrective action, the native sidebar chat mirrors that shift through assistant-footer timeline notes so the operator can see exactly when Atlas learned from friction, that frustration path also persists updated workspace personality answers plus an SSOT feedback note for future turns, the transcript renderer now keeps fenced code blocks intact across blank lines, splits mixed markdown heading-plus-list sections into separate blocks so bullets stay readable, and constrains those elements inside a tighter card shell so long technical samples do not break the reading flow, assistant reasoning and work-log details now collapse into compact disclosure cards while votes and autonomous-run links sit on a separate footer utility row, the transcript header role and model badges now share a matched compact height and font size, the Thinking Summary disclosure sits closer to the surrounding bubble contrast instead of reading like a dark inset panel, and the long-answer typography now uses slightly looser paragraph rhythm, calmer heading weight, tighter list indentation, and softer blockquote styling so dense transcript content stays readable, the composer info affordance opens a structured hint panel with titled bullet lists that adapt between idle, busy, and run-inspector states and append context-aware guidance from recent transcript content plus live execution state, the composer accepts action-oriented Enter variants so operators can send with the selected mode, start a new chat thread, steer an in-flight response, or insert a newline directly from the keyboard, and idle chat-state refreshes return focus to the composer so operators can keep sending follow-up prompts without manually reactivating the input.

`VoiceSettings` now carries both tuning values and persisted device preferences:

```typescript
interface VoiceSettings {
  rate: number;
  pitch: number;
  volume: number;
  sttEnabled: boolean;
  language: string;
  inputDeviceId: string;
  outputDeviceId: string;
}
```

The panel can always apply the tuning fields immediately. Device ids are honored only when the active backend and runtime expose the required routing APIs.

`ModelInfo` also now carries optional `specialistDomains`, derived from provider discovery plus the well-known catalog. The chat participant uses those tags to compute live preferred providers for research, visual-analysis, and other specialist routes instead of relying on a fixed provider list.

When session-wide Autopilot is enabled, AtlasMind also surfaces a dedicated status bar item so the bypass state remains visible and can be disabled directly.

The Memory tree view is folder-aware: it keeps SSOT storage folders such as `architecture`, `roadmap`, `decisions`, and `operations` visible in the sidebar, files indexed notes beneath their storage paths, and still adds inline edit or review actions on each note row. Edit opens the underlying memory file directly in the editor, while the info action posts a concise assistant-style summary into Atlas chat and focuses the shared chat view on that note. The same chat-summary pattern now applies to Agent, Skill, Model, and MCP Server info actions so sidebar inspection stays inside the active conversation instead of fragmenting into transient notifications. For imported workspaces, activation also computes an SSOT freshness state from stored import fingerprints; when AtlasMind detects drift, it raises a startup warning, enables a title-bar `Update Project Memory` action on the Memory view, and pins a warning row at the top of the Memory tree so the stale state remains visible while browsing entries.
```

## Data Flow

### Single Chat Request

```text
User message
  -> @atlas chat participant
  -> Orchestrator.processTask()
    -> AgentRegistry.selectAgent()           // pick best agent by relevance
    -> MemoryManager.queryRelevant()         // fetch ranked memory context
    -> Live evidence read via sourcePaths    // exact/current-state grounding when available
    -> TaskProfiler.profileTask()            // infer phase/modality/reasoning
    -> ModelRouter.selectModel()             // budget/speed-aware selection
    -> SkillsRegistry.getSkillsForAgent()    // resolve available tools
    -> ProviderAdapter.complete()            // LLM call with tool definitions
    -> [Tool calls loop]
      -> ToolApprovalGate                    // gate destructive operations with task-aware bypass/autopilot
      -> CheckpointManager.captureFiles()    // pre-write snapshot
      -> Skill.execute()                     // run the tool
      -> PostToolVerification                // optional test/lint
    -> CostTracker.record()                  // account for tokens
  -> Chat response stream
```

### Autonomous Project Execution

```text
/project <goal>
  -> Planner.plan()                          // LLM decomposes into ProjectPlan DAG
  -> Preview + approval gate
  -> TaskScheduler.execute()                 // parallel batch execution
    -> For each batch:
      -> Orchestrator.executeSubTask()       // ephemeral agent per subtask
  -> Orchestrator.synthesize()               // final report across all subtasks
  -> ProjectRunHistory.save()                // persist for Run Center
  -> Chat response stream

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

## Key Interfaces

`MemoryEntry` now carries both retrieval summaries and evidence pointers:

```typescript
interface MemoryEntry {
  path: string;
  title: string;
  tags: string[];
  lastModified: string;
  snippet: string;
  sourcePaths?: string[];
  sourceFingerprint?: string;
  bodyFingerprint?: string;
  documentClass?: 'project-soul' | 'architecture' | 'roadmap' | 'decision' | 'misadventure' | 'idea' | 'domain' | 'operations' | 'agent' | 'skill' | 'index' | 'other';
  evidenceType?: 'manual' | 'imported' | 'generated-index';
  embedding?: number[];
}
```

That metadata lets the memory layer stay fast for summary requests while still giving the orchestrator enough provenance to ground exact answers in live files.

## Project Structure

```text
src/
|- extension.ts          Entry point - creates services, registers commands/views
|- types.ts              Shared interfaces and constants
|- commands.ts           VS Code command registrations
|- chat/
|  |- participant.ts     @atlas chat participant with slash commands
|  `- sessionConversation.ts  Persistent workspace chat sessions
|- core/
|  |- orchestrator.ts    Central task coordinator
|  |- agentRegistry.ts   Agent CRUD
|  |- skillsRegistry.ts  Skill CRUD + agent-skill resolution
|  |- modelRouter.ts     Budget/speed-aware model selection
|  |- costTracker.ts     Token cost accounting
|  |- planner.ts         Goal -> DAG decomposition
|  |- taskScheduler.ts   DAG -> parallel batch execution
|  |- taskProfiler.ts    Task phase/modality inference
|  |- checkpointManager.ts  Pre-write snapshots
|  |- skillScanner.ts    Custom skill security scanning
|  |- scannerRulesManager.ts  Rule overrides
|  |- toolPolicy.ts      Tool risk classification
|  `- toolWebhookDispatcher.ts  Outbound webhooks
|- cli/
|  |- main.ts            Node CLI entrypoint
|  |- nodeMemoryManager.ts  Node SSOT loader/query layer
|  |- nodeCostTracker.ts CLI cost tracking
|  `- nodeSkillContext.ts  Node host implementation for built-in skills
|- mcp/
|  |- mcpClient.ts       MCP SDK wrapper
|  `- mcpServerRegistry.ts  Server config + client management
|- memory/
|  |- memoryManager.ts   SSOT memory CRUD + search
|  `- memoryScanner.ts   Prompt injection / credential scanning
|- providers/
|  |- adapter.ts         ProviderAdapter interface
|  |- anthropic.ts       Anthropic (Claude) adapter
|  |- bedrock.ts         Amazon Bedrock adapter with SigV4 signing
|  |- claude-cli.ts      Claude CLI (Beta) adapter for local CLI-backed routing
|  |- copilot.ts         GitHub Copilot adapter
|  |- openai-compatible.ts  OpenAI-compatible adapter used by OpenAI, Azure OpenAI, DeepSeek, Mistral, Google, z.ai, xAI, Cohere, Hugging Face, NVIDIA, and Perplexity
|  |- modelCatalog.ts    Well-known model metadata
|  |- registry.ts        Host-neutral provider registry + local adapter
|  `- index.ts           Provider barrel for the extension host
|- runtime/
|  |- core.ts            Shared runtime builder
|  `- secrets.ts         Host-neutral secret access contract
|- skills/
|  |- index.ts           Built-in skill factory
|  |- dockerCli.ts       docker-cli (strict Docker and Docker Compose allow-list)
|  |- fileRead.ts        file-read, file-search, directory-list
|  |- fileWrite.ts       file-write, file-edit, file-delete, file-move
|  |- gitApplyPatch.ts   git-apply-patch, git-status, git-diff, git-commit, git-log, git-branch
|  |- memoryQuery.ts     memory-query
|  |- memoryWrite.ts     memory-write, memory-delete
|  |- terminalRun.ts     terminal-run (allow-listed subprocess execution)
|  |- terminalRead.ts    terminal-read (list open terminals, guide user to paste output)
|  |- workspaceObservability.ts  workspace-state (problems, debug sessions, test results)
|  |- debugSession.ts    debug-session (inspect + evaluate in VS Code debug)
|  |- exaSearch.ts       exa-search (EXA API search)
|  |- vscodeExtensions.ts  vscode-extensions (list extensions + forwarded ports)
|  `- ...                (other skill files)
|- views/
|  |- treeViews.ts       Sidebar tree view providers, including Sessions
|  |- chatPanel.ts       Dedicated AtlasMind session workspace webview
|  |- projectDashboardPanel.ts  Cross-cutting workspace dashboard for repo, runtime, SSOT, security, and delivery signals
|  |- personalityProfilePanel.ts Guided questionnaire for Atlas role, tone, memory policy, and live workflow defaults
|  |- settingsPanel.ts   Settings webview
|  |- modelProviderPanel.ts  Routed-provider management webview backed by SecretStorage and workspace provider config
|  |- specialistIntegrationsPanel.ts  Search/voice/image/video credential management surface
|  |- agentManagerPanel.ts  Agent CRUD webview
|  |- mcpPanel.ts        MCP server management webview
|  |- toolWebhookPanel.ts  Webhook config webview
|  |- skillScannerPanel.ts  Scanner rules webview
|  |- costDashboardPanel.ts  Cost Dashboard webview (daily chart, model breakdown, budget bar)
|  `- webviewUtils.ts    Shared webview helpers (escapeHtml, CSP, nonce)
|- utils/
|  `- workspacePicker.ts Multi-workspace folder selection
|- voice/
|  `- voiceManager.ts    TTS/STT bridge (ElevenLabs server-side + Web Speech API fallback)
`- bootstrap/
   `- bootstrapper.ts    Project init + import

media/
`- walkthrough/          Getting Started walkthrough content (4 steps)

tests/                   46 Vitest suites, 399 tests
`- integration/          Multi-component integration tests
docs/                    Technical documentation
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

```text
+--------------------------------------------+
| VS Code Extension Host                     |
| +--------------+  +----------------------+ |
| | SecretStore  |  | Workspace Sandbox    | |
| | (API keys)   |  | (file ops scoped)    | |
| +--------------+  +----------------------+ |
| +--------------+  +----------------------+ |
| | Memory       |  | Tool Approval Gate   | |
| | Scanner      |  | (per-tool gating)    | |
| +--------------+  +----------------------+ |
| +--------------+  +----------------------+ |
| | Webview CSP  |  | Terminal Allow-list  | |
| | + nonces     |  | (~40 safe commands)  | |
| +--------------+  +----------------------+ |
+--------------------------------------------+
```

- **Credentials** - VS Code SecretStorage only; never in settings, SSOT, or source
- **File operations** - workspace-sandboxed with path traversal rejection
- **Webviews** - strict CSP, nonce-protected scripts, validated message handling
- **Memory writes** - scanned for prompt injection and credential leakage
- **Terminal** - allow-list of ~40 safe commands; dangerous commands blocked
- **Tool approval** - tiered gating configurable from always-ask to allow-safe-readonly

See [[Security]] for the full security model.

