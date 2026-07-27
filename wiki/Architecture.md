# Architecture

## Overview

AtlasMind is a VS Code extension built in TypeScript, and it now also ships a small Node CLI. Both hosts share the same service-oriented runtime builder so orchestration, routing, skills, and memory loading stay consistent.

## Core Services

| Service | File | Purpose |
|---------|------|---------|
| **Orchestrator** | `src/core/orchestrator.ts` | Central coordinator: agent selection -> runtime operating-contract/rubric composition -> retrieval policy -> memory and live evidence -> model routing -> completion-gated skill execution -> evidence-backed outcome and cost tracking |
| **AgentRegistry** | `src/core/agentRegistry.ts` | CRUD for `AgentDefinition` objects; persisted enable/disable state |
| **SkillsRegistry** | `src/core/skillsRegistry.ts` | CRUD for `SkillDefinition` objects; per-skill enable/disable, security scan status, and persistent custom skill folders |
| **ModelRouter** | `src/core/modelRouter.ts` | Budget/speed-aware model selection with subscription quota tracking; deprecation filter; failure TTL auto-clear; thinking-token cost scaling; smooth context-window gradients; outcome feedback loop via `recordModelOutcome()`; persistent task-signature-keyed **struggle memory** (`recordModelStruggle()` + tier-escape in `selectBestModel()`) that de-weights models on the task kinds they repeatedly fail |
| **CostTracker** | `src/core/costTracker.ts` | Per-request and per-session cost accumulation |
| **MemoryManager** | `src/memory/memoryManager.ts` | SSOT folder read/write/search with semantic retrieval, source-backed evidence pointers, and security scanning |
| **MemoryScanner** | `src/memory/memoryScanner.ts` | Scans content for prompt injection and credential leakage |
| **SecretRedactor** | `src/utils/secretRedactor.ts` | Pattern-based secret scanner applied to memory context and live evidence before LLM dispatch; covers API keys, tokens, PEM private keys, DB connection strings, and generic key/secret assignments |
| **DataPrivacyManager** | `src/core/dataPrivacyManager.ts` | Classifies confidential/proprietary terms, regexes, and file/folder paths and gates classified content to user-selected "trusted" models; redacts classified spans (`[CONFIDENTIAL]`) for un-trusted models. The orchestrator's gate is tiered by `sensitivity`: `secret` (PCI/HIPAA) restricts routing, `confidential`/`proprietary` (GDPR/CCPA) are advisory and rely on redaction, so a heuristic hit in the context bundle can't silently re-route an unrelated task. Deny-by-default: an empty trusted list trusts nothing. Policy stored at `project_memory/operations/data-privacy.json` |
| **CompliancePacks** | `src/core/compliancePacks.ts` | Built-in regulated-data detector packs (GDPR, HIPAA, PCI-DSS w/ Luhn, CCPA/CPRA, Financial w/ IBAN mod-97) that feed the DataPrivacyManager classifier when enabled. Detectors are anchored on cues ordinary source does not contain and validated against reserved IP ranges (`isPublicIpv4`) and role/example mailboxes (`isPersonalEmail`), because a detector that fires on ordinary code gets the whole policy switched off. Heuristic aids, not a compliance certification |
| **ProviderDataGovernance** | `src/core/providerDataGovernance.ts` | Static per-provider data-governance reference (GDPR/data-subject request portal, privacy policy, DPA, retention, training stance) surfaced on the Privacy page for trusted providers |
| **WebsiteWorkspaceManager** | `src/core/websiteWorkspaceManager.ts` | Website Studio SSOT service: normalizes bounded client-intake JSON; server-locks and evaluates Develop → Staging → Production hosting policy; sanitizes sitemap/design/platform/n8n edits; redacts secret and n8n-webhook shapes; and writes `project_memory/domain/website.json` plus its `website.md` mirror. Models readiness only; it never deploys or triggers a workflow |
| **DeliveryManager** | `src/core/deliveryManager.ts` | Models deployment stages (Local → Staging → Production) and promotion ("push") edges; seeds a pipeline from the repo's branches (never fabricating a branch — an undetected production branch stays unset rather than defaulting to `main`), persists `project_memory/operations/delivery.json` + a `delivery.md` runbook mirror, and sanitises dashboard edits. Safety-first: production protected + deny-by-default backup gate. A `delivery.json` file watcher (`deliveryRefresh`) keeps the dashboard current on external edits, and a workspace-scoped review baseline drives a "review needed" banner when the protocol/branches/CI drift. Surfaced on the Project Dashboard → Delivery page |
| **PromotionRunner** | `src/core/promotionRunner.ts` | Guarded promotion engine: builds an inspectable plan (preflight → backup → deploy → verify → record), evaluates the authorization gate (auto/manual checks, approval, protected type-to-confirm), and executes user-authored commands with live progress + rollback hint. Never force-pushes; commands sourced server-side only |
| **ProjectDirectorManager** | `src/core/projectDirectorManager.ts` | Models the *people* around a project — stakeholders, delivery team, responsibilities, human assignments, and follow-ups — persisted to `project_memory/operations/project-director.json` + a `project-director.md` mirror + capped history, `fs`-only. Solo-dev aware: a `selfContactId` ("me") plus `teamMode` (`solo`/`team`/`auto`, via `resolveTeamMode`/`isSoloProject`) infers solo when you're the only person, so a one-person project skips team ceremony and foregrounds self-management. GDPR-first: prefers referencing people in their system of record (M365/Slack/Google) over storing raw PII, flags `piiStored` for the consent gate, and describes channels by kind/label only in the git-tracked mirror. `sanitizeProjectDirectorConfig` is the webview→disk boundary (length-clamp, enum-whitelist, id regen, drop dangling refs, deep-link scheme allowlist). Pure `deriveFollowUpUrgency`/`countOverdueFollowUps`; `project-director.json` watcher fires `projectDirectorRefresh`. Surfaced on the Project Dashboard → Director page |
| **DirectorCommsRunner** | `src/core/directorCommsRunner.ts` | Pure detection/arg-mapping layer for the Director's *opt-in, guarded* outbound messaging. Detects which connected MCP tool can email/schedule/message (name-pattern match across `mcpServerRegistry.listServers()`, preferring send/create over drafts) and best-effort maps a draft onto the tool's declared input schema, inventing nothing. Intent patterns include Slack/Teams *and* [Buzz](https://buzz.xyz)-style comms tool names (`post_to_channel`, `send_dm`, `buzz_*`), so a connected Buzz comms tool flows through the same guarded dispatch with no extra code. Dispatch + the `{modal:true}` authorization gate + deny-by-default (`outboundEnabled`) live in the dashboard panel; the tool runs via its `mcp:` skill wrapper, credentials stay in SecretStorage, and there's a deep-link fallback when no connector matches. Contacts carry a `buzz` `CommunicationChannelKind` (npub / @handle / #channel; `https`-only deep link) and can name Buzz as their identity system-of-record (`DirectoryRef.source: 'buzz'`). Governing contract: **Buzz owns identity + messaging; AtlasMind owns reasoning + execution** — AtlasMind references Buzz identities and dispatches through Buzz, never mirroring a directory or the message log. See `project_memory/roadmap/buzz-integration.md` |
| **FollowUpScheduler** | `src/core/followUpScheduler.ts` | In-process follow-up reminder engine. Pure `summarizeDueFollowUps`/`buildReminderMessage` + a thin timer class that surfaces a **throttled, once-per-day** in-editor nudge (opening the Director tab) when follow-ups are overdue/due-soon. Notification-only and deny-by-default — never sends outbound on a timer. Startup nudge gated by `nudgeOnActivation`; recurring 30-min timer gated by `remindersEnabled`; throttle key in `workspaceState`. Paired with the `atlasmind.projectDirectorView` sidebar tree (overdue badge) and the `/director` + `/followups` chat commands |
| **McpEnvironmentScanner** | `src/mcp/mcpEnvironmentScanner.ts` | Discovers MCP setup signals for the "Add MCP server" flow: imports server definitions from other tools' config files (Claude Desktop, Cursor, VS Code, Windsurf, repo `.mcp.json`), probes PATH for launch runtimes, and reads env-variable *names* from `.env*`/`wrangler.toml`. Cached in SSOT (`project_memory/operations/mcp-environment.json` + `.md` mirror), reused on future installs, with a Rescan button + workspace-config watcher. `vscode`-free + unit-tested. Redaction boundary: only env-var *names* are cached/shown; on Import & connect, `resolveImportedServer` re-reads secret values live and routes them to SecretStorage, never to the cache or webview |
| **PresenceManager** | `src/core/presenceManager.ts` | Cross-platform OS **keep-awake wake lock** so a connected Buzz presence, a Remote Control gateway session, or a long Mission Loop run isn't killed by system sleep. A VS Code extension can't use Electron `powerSaveBlocker`, so it spawns an OS helper tied to the extension-host lifetime — Windows `SetThreadExecutionState` via PowerShell (parent-PID orphan guard), macOS `caffeinate -i -w <pid>`, Linux `systemd-inhibit --what=idle:sleep`. Reference-counted `hold`/`release` reasons + the `atlasmind.presence.keepAwake` toggle. Deny-by-default: AC-power-gated (auto-suspends on battery), `maxAwakeMinutes` auto-release backstop, wall-clock sleep detector, no untrusted input in any command. `vscode`-free + unit-tested; wired in `extension.ts` to a click-to-stop status bar + `atlasmind.togglePresence` |
| **RiskOversightManager** | `src/core/riskOversightManager.ts` | Persists the **risk register** raised by the three oversight advisors to `project_memory/operations/risk-oversight.json` + a `risk-oversight.md` mirror + an append-only `risk-oversight-history.json` audit trail (capped at 1000, a cap the mirror states rather than truncating silently); `fs`-only and unit-tested. A record, not a gate — nothing blocks a commit or release, and findings are **never deleted**, only transitioned (`open → accepted / mitigated / closed / dismissed`), so the register stays complete. `mergeDomainFindings` lets a re-run refresh severity without undoing a human decision. Two untrusted boundaries: `parseRiskFindings` degrades malformed *model output* to `[]` rather than throwing, and `sanitizeRiskFindings`/`normalizeRelPath` clamp strings, coerce enums to safe defaults (unknown status → `open`), and reject path traversal in cited evidence. Pure `computeRiskScore` weights open findings by likelihood × impact, discounts by confidence, scales by domain coverage, and decays past 90 days. A `risk-oversight.json` watcher fires `riskOversightRefresh`. Surfaced on the Project Dashboard → Risk page |
| **SecurityReviewManager** | `src/core/securityReviewManager.ts` | `vscode`-free, `fs`-only persistence and scoring foundation for security reviews across secrets, runtime boundaries, dependencies, and permissions. Writes `project_memory/operations/security-review.json`, a regenerated `security-review.md` mirror, and capped `security-review-history.json`; it is not yet wired into the extension or a webview. A register, not a vulnerability scanner or delivery gate. Malformed model output becomes no findings, strings/collections are bounded, unknown statuses remain open, evidence paths cannot be absolute or traverse outside the workspace, and the score accounts for severity × exploitability × confidence, area coverage, and 45-day freshness. |
| **DocumentsManager** | `src/core/documentsManager.ts` | Models a project's **document filing system** (folder "shelves" + optional glob) and the documents to **keep updated automatically**, persisted to `project_memory/operations/documents.json` + a `documents.md` runbook mirror, `fs`-only and unit-tested. Safety-first / deny-by-default: never rewrites a document on a timer — the dashboard collector computes freshness from file mtime vs. a recorded `lastReviewed` baseline (+ weekly window), yielding `missing`/`review-due`/`fresh`/`unknown`, and offers explicit **Update with Atlas** / **Mark reviewed** actions plus discovery of uncovered markdown. `sanitizeDocumentsConfig` is the webview→disk boundary (length-clamp, cadence enum, id regen, array cap) and `normalizeRelPath` rejects absolute paths, drive letters, and `..` traversal. A `documents.json` watcher fires `documentsRefresh`. Surfaced on the Project Dashboard → Documents page |
| **MissionRunner** | `src/core/missionRunner.ts` | Autonomous goal-seeking **Mission Loop**: wraps plan→execute→synthesize in an outer loop that re-evaluates progress each iteration and continues until the goal is met or the closed parameter envelope (cost/iterations/tokens/time/no-progress) confines progress. Hybrid autonomy with deny-by-default approval checkpoints; when a stop would be caused by a recoverable setting (`detectSettingBlocker`) the `blockedGate` hook asks the user to override/open-settings/stop instead of cancelling. `vscode`-free via narrow structural deps |
| **GoalEvaluator** | `src/core/goalEvaluator.ts` | LLM progress judge applying an explicit goal/criteria/evidence/verification/completeness rubric and returning a validated `GoalVerdict`; untrusted output falls back to `stalled`/zero-confidence, while the guard downgrades unverified "achieved" claims or verdicts that still list remaining work |
| **MissionRegistry** | `src/core/missionRegistry.ts` | Audit-trail persistence for mission runs to `project_memory/operations/missions.json` + a `missions.md` runbook mirror; `fs`-only, trims large text, caps history. No secret values. Exposes `listActive()` + an `onChange` subscription powering the Cost Dashboard's live "Current Loops" section |
| **TaskProfiler** | `src/core/taskProfiler.ts` | Infers task phase, modality, and reasoning intensity |
| **Planner** | `src/core/planner.ts` | Decomposes goals into DAGs via a reasoning model, validates returned skill IDs, and grounds non-synthesis execution steps with the smallest enabled workspace-evidence tool set |
| **TaskScheduler** | `src/core/taskScheduler.ts` | Topologically sorts DAGs into batches and runs them in parallel |
| **CheckpointManager** | `src/core/checkpointManager.ts` | Pre-write snapshots for safe rollback |
| **SkillScanner** | `src/core/skillScanner.ts` | Security scanner with 12 rules for custom skill validation |
| **TestingConfigLoader** | `src/core/testingConfigLoader.ts` | Reads testing-config.json; infers methodology for subtasks; resolves per-methodology model overrides |
| **TestingScaffolder** | `src/core/testingScaffolder.ts` | Constructs a language- and archetype-aware starter testing framework (idiomatic example tests + strategy playbook) for Node/Python/Rust/Go/.NET/Java from enabled methodologies; non-destructive |
| **TestingProtocolSync** | `src/utils/testingProtocolSync.ts` | Outbound sync of enabled testing protocols into detected external agent instruction files (CLAUDE.md, copilot-instructions.md, AGENTS.md, …) via a managed, path-safe markdown block |
| **AiInstructionMerge** | `src/utils/aiInstructionMerge.ts` | Two-way instruction-set sync: gathers every tool's instructions + AtlasMind's, LLM-reconciles them into one unified set (auto-resolving trivial diffs, flagging significant conflicts), and mirrors the set back into each tool's file inside a managed block. Drives the `/sync-instructions` chat command |
| **ManagedBlock** | `src/utils/managedBlock.ts` | Shared delimited managed-block `upsertManagedBlock` / `stripManagedBlock` used by the testing-protocol and instruction-set outbound writers (non-destructive, reversible) |
| **TerminalOutput** | `src/utils/terminalOutput.ts` | Display-side sanitizers for captured tool output: `stripAnsiSequences` removes ANSI/CSI/OSC escape sequences; `sanitizeTerminalOutput` also folds carriage returns and drops residual control bytes so colour codes can't reach chat summaries as garbled `[1m…` fragments |
| **ModelEvalHarness** | `src/core/modelEvalHarness.ts` | Scored-replay model comparison: runs one prompt across candidate models, ranks by graded quality/cost, and records outcomes to calibrate routing |
| **ScannerRulesManager** | `src/core/scannerRulesManager.ts` | Configurable rule overrides persisted in globalState |
| **McpClient** | `src/mcp/mcpClient.ts` | MCP SDK wrapper for stdio and HTTP transports |
| **McpServerRegistry** | `src/mcp/mcpServerRegistry.ts` | Persists MCP server configs; manages connections; bridges tools as skills; resolves SecretStorage-backed env (`secretEnvKeys`) at connect; `detectAvailableServers()` scans the local environment |
| **mcpRuntime** | `src/mcp/mcpRuntime.ts` | Shared runtime bootstrap: `checkStarterRuntime` plans a missing-runtime install; `runRuntimeInstallPlan` runs it only after confirmation |
| **ArdClient** | `src/ard/ardClient.ts` | [[Resource Discovery]] protocol client: registry `POST /search` (bounded federation) + static `ai-catalog.json` fetch, with strict untrusted-input validation and SSRF screening |
| **ArdRegistry** | `src/ard/ardRegistry.ts` | Persists ARD Agent Finders in globalState (seeded disabled); caches recent results for the tree |
| **ArdInstaller** | `src/ard/ardInstaller.ts` | Maps a discovered resource to a non-destructive install (MCP servers added disabled; nested catalogs → finders; A2A/skills/APIs → references) |
| **ToolWebhookDispatcher** | `src/core/toolWebhookDispatcher.ts` | Sends outbound webhooks for tool lifecycle events |
| **VoiceManager** | `src/voice/voiceManager.ts` | TTS/STT bridge; backend priority is ElevenLabs (server-side, when keyed) → OS host engine → Web Speech API, and persists preferred audio-device ids for capable runtimes |
| **HostSpeechSynthesizer** | `src/voice/hostSpeechSynthesizer.ts` | On-device TTS via the OS engine (Windows SAPI/PowerShell, macOS `say`, Linux `espeak-ng`); no network/API key, spoken text passed only over stdin |
| **LocalTranscriber** | `src/voice/localTranscriber.ts` | On-device STT via a local `whisper-cli`; provisions a SHA-256-verified model (and, on Windows x64, the binary) on first use; audio stays on the machine |
| **ProjectRunHistory** | `src/core/projectRunHistory.ts` | Persists workspace-scoped project run records, staged planner-job metadata, and follow-up seed outputs for the Run Center |
| **ProviderRegistry** | `src/providers/registry.ts` | Host-neutral registry of provider adapters |
| **LocalModelRecommendationRegistry** | `src/providers/localModelRecommendationRegistry.ts` | Data-driven local-model recommendation catalog with validated workspace override loading |
| **SessionConversation** | `src/chat/sessionConversation.ts` | Persistent workspace chat sessions and compact carry-forward context |
| **Shared Runtime** | `src/runtime/core.ts` | Common bootstrapping path used by the extension and CLI |
| **RemoteControlServer** | `src/remote/remoteControlServer.ts` | Desktop-only localhost WebSocket server; pairs authenticated web clients and binds each to a `ChatPanel` via a synthetic host (off by default, token + workspace-trust gated). A `gateway` mode authenticates via an `x-atlas-origin-secret` upgrade header so it can sit behind an SSO gateway + tunnel for cross-machine access |
| **RemoteWebviewHost** | `src/remote/remoteBridge.ts` | Synthetic `ChatPanelHost` that pipes a ChatPanel's protocol over the socket; fans outbound messages to the client and injects validated inbound frames |
| **RemoteClient** (web) | `src/web/remoteClient.ts` | Browser-side WebSocket client (pairing, reconnect, RPC) for the web thin client |

## Web (Remote Control) Architecture

AtlasMind builds two targets from one codebase. The desktop build (`out/extension.js`, Node) is the full extension. The **web build** (`out/web/extension.js`, bundled by esbuild for the Web Worker host on vscode.dev/github.dev/code-server) is a thin client: it renders chat and read-only dashboards and relays the chat protocol to a desktop instance over a localhost WebSocket. The chat webview is host-agnostic — its protocol and markup live in Node-free shared modules (`src/views/chatProtocol.ts`, `src/views/chatWebviewMarkup.ts`) — so one `ChatPanel` serves both local and remote surfaces. See [[Remote Control]] for the wire protocol and security model.

## Activation Flow

```text
1. VS Code fires `onStartupFinished`
2. extension.ts -> activate()
  |- Build shared runtime via `src/runtime/core.ts`
  |- Create all core services
  |- Register provider adapters (Anthropic, Claude CLI Beta, OpenAI, Azure OpenAI, Bedrock, Copilot, z.ai, DeepSeek, Mistral, Google, Local)
  |- Seed default models -> restore persisted model availability -> start background model discovery
  |- Register default agent + restore user agents from globalState
  |- Register 43 built-in skills + restore enabled/disabled state
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

Every routed agent is composed at execution time from immutable guardrails, the portable operating contract, its concise role prompt, and the shared plus role-specific execution rubric. All 16 user-facing built-in specialists define three or four observable completion rows. Detailed SEO and UX audit matrices are returned on demand by `src/skills/specialistGuidance.ts`, so time-sensitive platform and standards details do not occupy every permanent prompt and can be verified from current primary sources when relevant.

The Models tree view is stateful: provider and model rows expose inline enable/disable, configure, refresh, info, and assign-to-agent actions, and the enabled/model-assignment state is persisted in VS Code `globalState` so routing behavior survives restarts and catalog refreshes. For the local provider, the endpoint URL lives in workspace settings while any optional API key stays in SecretStorage. Azure OpenAI and Bedrock follow the same split, with deployment or model-list settings in the workspace and credentials in SecretStorage. Visible status is rendered with colored icons, mixed provider states add a bracketed warning marker, and unconfigured providers are kept at the bottom of the list.

The Skills tree keeps each row compact by showing only the skill name and inline actions. Built-in skills are grouped under a `Built-in Skills` root and then sub-categorized by operational area, while user custom skills can live at the root or inside persistent nested folders. Descriptions, parameters, and scan details stay available in the hover tooltip instead of taking horizontal space in the sidebar.

The AtlasMind sidebar now starts with a composite Home webview that anchors major UI surfaces directly under the container title, then continues with the embedded Chat view plus operational tree views whose shipped order is Project Runs, Sessions, Memory, Agents, Skills, MCP Servers, then Models. Home replaces the earlier one-row Quick Links strip with an internal accordion that groups quick actions, recent sessions, recent autonomous runs, and workspace status into a single surface. Because this behavior is implemented inside one webview instead of across native VS Code sibling views, those sections can close upward, auto-size to their content, push lower sections down as they grow, and remember manual heights when the operator drags a section resizer. Those tree views ship collapsed by default so fresh or unbootstrapped workspaces start with a quieter sidebar, while the stable view ids let VS Code preserve each user's later reordering and expanded or collapsed state automatically. Selecting a chat thread reopens the shared Atlas chat workspace on that session, while selecting an autonomous run opens the Project Run Center where live batches can be inspected, paused, approved, or resumed. The Sessions tree now supports persistent folders, inline rename on each session row, archive and restore actions, and a dedicated Archive bucket that accepts dragged chat sessions and allows dragged restores back into the live tree or folder targets. The Chat, Sessions, and Memory titles all keep quick actions for the project dashboard, cost dashboard, and settings, while the project-memory action switches between `Import Existing Project` and `Update Project Memory` once AtlasMind detects workspace SSOT state. The shared Atlas chat workspace now stores per-assistant-turn metadata so each bubble can show the routed model, a collapsible thinking summary based on execution metadata, and ambiguity-aware follow-up choices for concrete repo-local diagnostics. That summary now includes token totals and request cost alongside routing and tool-loop details, and active freeform turns can inject transient `_Thinking: ..._` progress lines from orchestrator execution events while the run is still in flight. Structured tool updates are now rendered inside that same inner-monologue surface: the latest item is shown by default, while earlier tool lines remain available through a collapsible history disclosure. For ambiguous bug reports, AtlasMind can answer diagnostically first and then offer follow-up actions such as `Fix This`, `Explain Only`, and `Fix Autonomously` without forcing execution up front. The embedded chat webview now sizes itself against the host container instead of a raw `100vh` viewport assumption, which keeps the Sessions rail visible inside the sidebar container instead of letting the chat surface run taller than its allocated view. Its responsive Sessions rail keeps the drawer toggle and new-session action on a single compact row in narrow layouts, reflows into a persistent left sidebar once the chat webview is at least 1000px wide, and in that wider detached or centered presentation can now collapse back to a slim left rail without pushing the composer into a separate right-hand column. Each live session row still exposes compact archive and delete icon actions. Assistant bubbles also expose thumbs up/down controls; those votes are validated in the extension host, persisted with the transcript entry, and aggregated into a small per-model routing preference signal. The assistant footer keeps the thinking-summary disclosure left-aligned and compact outlined vote controls right-aligned within the same bubble row while also rendering persisted follow-up chips when the assistant offered an execution choice. Assistant response bodies in the embedded panel are rendered as safe markdown instead of plain text, the transient Thinking notes plus the expanded thinking-summary body use a slightly smaller, lower-contrast style so internal reasoning remains secondary to the main answer, compact `A-` / `A+` controls in the panel header adjust chat-bubble typography through a persisted webview font-scale value that now extends three steps below the previous minimum, and pasted or dropped local media can now be browser-serialized into inline prompt attachments instead of depending on workspace-relative paths. It also renders an animated AtlasMind globe while the latest assistant turn is still thinking, with the rotating axis group anchored to the shared SVG viewbox center so the mark stays intact through the loop. Its composer supports explicit send modes, queued workspace attachments, quick-add chips for currently open files, drag-and-drop ingestion for workspace files, local media, or URLs before those inputs are normalized into safe prompt context, CLI-style Up or Down history recall for recent submitted prompts when the caret is already at the start or end of the composer, a Stop action that cancels the active chat turn from the same input area, and managed terminal launch directives such as `@tps <command>`, `@tpowershell <command>`, `@twindowspowershell <command>`, `@twinps <command>`, `@tpwsh <command>`, `@tpowershell7 <command>`, `@tps7 <command>`, `@tpsh <command>`, `@tgit <command>`, `@tbash <command>`, `@tgitbash <command>`, `@tcmd <command>`, and `@tcommandprompt <command>` that open shell-integrated terminal sessions, stream terminal output back into the transcript, and let AtlasMind request at most one additional approval-gated command in the same session before it emits the final summary. Those managed launches now go straight through the normal tool-risk classification and approval flow instead of requiring the separate `atlasmind.allowTerminalWrite` toggle first. Bare aliases such as `@tcmd` are intercepted as usage prompts instead of falling through to the routed model. The same controller also backs the detachable AtlasMind chat panel. Profile-backed or remote terminals such as JavaScript Debug Terminal and Azure Cloud Shell are not routed through this managed path yet because it depends on a concrete local shell executable plus shell integration readback. Tool approvals now use that same shared chat surface: when a tool call needs confirmation, AtlasMind queues an approval card in the chat UI with Allow Once, Bypass Approvals, Autopilot, and Deny actions instead of interrupting the operator with an OS modal dialog, and managed terminal launches reuse that approval flow instead of bypassing it. While a request is active, the status line above the composer appends the last model id supplied by the host's `streamingModels` state and follows failovers without accepting browser-originated routing state.

Concurrent chat surfaces keep their selected sessions pinned locally. Session-change refresh events update UI state without force-switching every open chat surface to the global active session.

Project-run proposals cross the chat webview boundary as validated transcript metadata rather than browser-owned commands. Interactive chat renders **Start run**, **Save for later**, and **Cancel**; the extension host re-reads the pending proposal, accepts only those three actions, prevents double resolution, and sends saved proposals through Project Run Center preview persistence. Only Autopilot may bypass the card and auto-start when the matching setting permits it. Provider catalog refresh follows the same host-authoritative principle: successful live discovery replaces the prior list (including an empty result), while provider-confirmed removed/deprecated models keep a session tombstone that stale discovery cannot resurrect.

AtlasMind also exposes a dedicated Project Dashboard panel for cross-cutting workspace observability. It combines git branch status, recent commit velocity, Project Run History activity, Atlas runtime readiness, SSOT directory coverage, memory scan warnings, security and governance controls, dependency signals, workflow inventory, and aggregate `/project` TDD posture into one interactive surface with adjustable timeline windows. That dashboard now links out to a separate Project Ideation panel instead of embedding the board inline, so it stays focused on observability while still surfacing ideation counts and launch points. Its Operational Score cards now open a dedicated breakdown view that itemizes component scoring, folds in desired-outcome completeness from SSOT and run telemetry, and organizes improvement recommendations across short-, medium-, and long-term horizons. The outcome-completeness tiles and recommendation cards can also open Atlas chat with drafted prompts aimed at the underlying concern, giving operators a direct path from a dashboard signal to a concrete first-pass action. The Roadmap page opens with a **Road to MVP** section that turns the flat backlog into a guided path to a first shippable product: items are flagged for the MVP path with a per-item toggle (persisted non-destructively as a `#mvp` tag inside the managed block of `project_memory/roadmap/improvement-plan.md`), with a heuristic fallback that suggests foundational candidates when nothing is tagged yet. A milestone track and progress bar visualise how far along that road the project is, a deterministic best-route ordering front-loads foundational/security/architectural work with per-step reasoning, and a "Plan the MVP route with Atlas" button hands a focused prompt to a live chat session (reusing the Gap-Analysis handoff — no model calls are added to dashboard refresh). All dashboard pages share one Delivery-style visual/interaction language: a plain-English page-intro band, metric pills with tone status dots and inline meters, at-a-glance flow strips, and a strict "no dead hover" rule — every card with a hover affordance resolves to a file/page/command/chat action, and anything non-actionable renders as a genuinely static element. The Cost Dashboard, Project Run Center, and Project Ideation panels share the same visual-indicator / no-dead-hover language (tone status dots, budget/posture meters, live posture tone driven by run state). Mission Control was likewise refreshed (intro topbar, card sections, tone dots on recent missions), and the Project Run Center and Mission Control panels now cross-link to each other for one-click movement between manual run review and autonomous missions. AtlasMind's guided bootstrap now feeds this surface earlier by seeding the SSOT brief, roadmap, ideation board, project-scoped personality defaults, and planning files before the first delivery task is even run.

The dashboard's **tab order and grouping** are defined once, in `PAGE_GROUPS` in `media/projectDashboard.js`: five labelled clusters — Where we stand (Overview · Score · Gap Analysis), The work (Roadmap · Director · Runtime), The code (Repo · Testing), Is it safe (Security · Privacy · Risk), Ship & record (Delivery · Documents · SSOT) — ordered to follow the sentence a manager reads rather than the sequence the features shipped in. Tabs carry attention badges derived by `computeNavBadges` from counts already present in the snapshot, and the nav implements the full WAI-ARIA tabs pattern with roving `tabindex`, arrow-key navigation and focus restoration across re-render; the panel side of that wiring is emitted by a single `pageSectionOpen` helper so tabs and panels cannot drift apart. `DASHBOARD_PAGE_IDS` in `projectDashboardPanel.ts` stays the *validation* list — it also carries `ideation`, a legal prompt origin with no tab — and the webview's `normalizePageId` coerces any unrecognised `activePage` back to `overview` so an unrenderable id can never blank the dashboard. `tests/views/dashboardNav.test.ts` reads the real nav definition and asserts the two lists agree.

Because `render()` replaces the dashboard body wholesale, **value animation is driven from script** (`applyValueAnimations`) rather than from CSS transitions, which cannot interpolate on a freshly parsed node: elements declare a stable `data-anim-key` and target value, and only genuinely changed values move on the next frame, with meters on a hidden page deferred until that tab is first opened. `prefers-reduced-motion` is honoured in both the stylesheet and the script. Alongside `renderChartCard`, `renderScoreRing`, `renderMetricPill`, `renderFlowStrip` and `renderRiskMatrix`, the shared primitives now include `renderDistributionBar` for segmented proportion bars, and the Director page reuses the Risk matrix chrome for a stakeholder influence/interest grid. The "no dead hover" rule is enforced structurally: `cursor: pointer` is scoped to `button.x, .x.is-actionable` only, static variants are explicitly reset, and actionable cards carry an at-rest chevron so a clickable row is identifiable before hover.

Six page-based panels (Voice, Vision, Specialist Integrations, Tool Webhooks, Model Providers, MCP) share one vertical tab controller, `PANEL_NAV_JS` in `src/views/panelNav.ts`. Each had carried its own copy of the same nav, and every copy declared `role="tablist"` while shipping plain buttons — no `role="tab"`, `aria-selected`, `aria-controls`, `role="tabpanel"`, roving `tabindex` or keyboard handling. The controller upgrades the existing markup at runtime instead of replacing it, so panel styling is untouched, and panel-specific work (webview state persistence) rides along through an `onActivate` callback. Agent Manager no longer has page tabs: its directory and editor form one master/detail workspace. The Settings panel keeps its own implementation, which was already correct and additionally degrades to plain in-page anchors when the script does not boot.

Website Studio (`src/views/websiteStudioPanel.ts`) is the dedicated website delivery workspace opened by **AtlasMind: Open Website Studio**. Its six dashboards cover Client Brief, Sitemap, Wireframes & UI, UI System, Hosting & Platforms, and n8n Automations. The same page plan moves from a low-fidelity section outline through visual-design notes and independent wireframe/UI/content/SEO approval states. The hosting view adds a fixed Develop → Staging → Production pipeline: loopback-first Develop with an explicit password-protected hosted fallback, password-protected Staging at `<review-label>.<production-domain>`, and public/promotion-protected Production. Platform profiles cover Cloudflare Pages, GitHub Pages, WordPress + Elementor, WordPress, Vercel, Netlify, Azure Static Web Apps, Shopify, Webflow, and custom hosting. Guided **Website / Marketing Site** bootstrap seeds the captured brief and hosting defaults into the Studio without overwriting existing website SSOT.

The Studio's host boundary is intentionally narrower than Delivery. `isWebsiteStudioMessage` allows only save/import, two fixed SSOT paths, and three fixed navigation commands; `sanitizeWebsiteWorkspace` caps and normalizes every persisted value and reconstructs the canonical hosting policies even when the webview payload is tampered. `assessWebsiteHostingEnvironments` enforces loopback/HTTPS requirements, password-reference presence, and the Staging review-subdomain topology. The data model has no credential-value or webhook-value field, accepts only provider-prefixed credential references, rejects credential-bearing/query/fragment URLs, invokes the shared secret redactor, and replaces n8n webhook-shaped URLs before persistence. Selecting a platform or marking an automation configured is descriptive state only. Production changes still require Delivery's preflight, backup, approval, protected confirmation, and verification sequence; n8n execution would likewise require a separate host-side approved tool path.

The Project Ideation panel is AtlasMind's dedicated multimodal whiteboard. It keeps draggable cards, editable link lines, focused-card inspection, queued Atlas follow-up prompts, facilitation history, browser-side voice capture and narration, drag/drop and paste-driven media ingestion, and inline card editing in one surface. The canvas can expand to a viewport-fill mode, pan across a larger board area, zoom with Ctrl/Cmd plus wheel or keyboard shortcuts, fit the active board into view, and hint at off-screen cards with subtle edge glows so dense whiteboards remain navigable. Relationship links are first-class editable objects with label, relation type, line-style, arrow-direction, and delete controls, and the board now collapses card detail as zoom decreases so the canvas stays legible at a distance. Each facilitation pass now assembles a deterministic context packet from the active prompt, queued media, explicit constraints, selected-card lineage, and SSOT-derived project metadata, then stores run deltas so the board can show how ideas evolved over time. Cards also carry structured modes, scoring, tags, optional project-memory sync targets, and a one-click promotion path into a drafted `/project` execution prompt. New cards are placed with collision avoidance and, when created from the current focus context, gain an automatic association link. Ideation board state persists into `project_memory/ideas/` as both JSON and markdown artifacts so the same project-memory system can retain ideation output. Guided bootstrap now seeds that board with initial cards, constraints, and metadata so the first ideation session starts from the captured project brief rather than a blank canvas.

The Project Run Center now shares that same professional visual language: autonomous-run review, batch approval controls, run history, changed-file inspection, and subtask artifacts all sit inside a card-based workspace so operators can move between Settings, Dashboard, and Run Center without relearning the layout. It now frames preview as a reviewable execution draft, explains what subtasks and impact estimates mean, treats approval thresholds as advisory guidance rather than hard caps, and exposes a seeded draft-refinement jump into the Atlas chat panel before execution. For oversized drafts it can also stage execution into multiple planner jobs: Atlas runs the first dependency-safe job, stores its outputs, and queues the remaining scope as the next preview so operators do not have to push one monolithic run through the panel. Operators can also delete non-running historical runs directly from that surface when they want to prune stale local telemetry without touching saved workspace reports or changed files. Those artifact cards now also expose per-subtask TDD telemetry so operators can see whether AtlasMind established the failing red signal before implementation writes, got blocked by the gate, or had no direct TDD requirement for that subtask.

AtlasMind Settings now uses a dedicated multi-page webview workspace with a persistent section nav, so routing, agents, safety, chat context, and autonomous project controls are easier to reach without scanning one long form. **Agents** is a first-class Capabilities page with live registered/enabled/built-in/custom counts and a validated command bridge into the dedicated manager; the Settings overview exposes the same shortcut. The panel keeps the same validation rules on every write, adds direct shortcuts into the embedded Chat view, detached chat panel, provider management, and specialist surfaces, includes dependency-governance defaults for Atlas-built projects, exposes per-setting hover help directly inside the webview, keeps the installed extension version visible in the hero banner's lower-right corner, exposes a bounded `atlasmind.feedbackRoutingWeight` dial for thumbs-based routing bias, surfaces text-to-speech playback controls directly on the Models & Integrations page, and routes destructive project-memory purge actions through extension-side double confirmation instead of trusting the webview alone.

The Cost Dashboard panel now links spend back to the exact assistant response that produced it, shows the linked response's thumbs state in the recent-request table, and aggregates per-model approval rates plus filtered spend so feedback-weighted routing is inspectable from the same operational surface as cost data. Its time-period choices live in a compact, closed-by-default disclosure above the daily plot; opening it expands the toolbar in normal flow so it cannot cover a line-chart peak. Genuine local usage is grouped by exact model and compared with one explainable catalog-backed cloud reference per model, with the potential savings estimates totalled. That same calculation now appears in the top Efficiency summary with the local request count, so the overview and per-model drill-down share one filtered source.

The Model Providers and Specialist Integrations panels now follow the same design language: each uses searchable page navigation, grouped cards instead of dense tables, and direct links back into the most relevant AtlasMind workflow or Settings page. Their hero summary chips now either jump into a full catalog filtered by setup status or expose a tooltip when the chip is explanatory only. The Model Providers panel also surfaces provider-level failure badges derived from routed model failures in the current session, and marks subscription-backed providers such as GitHub Copilot and Claude CLI with a dedicated inline icon on the provider title, so operators can see both live failure state and plan-backed session usage without drilling into the setup copy.

The Agent Manager webview uses a searchable master/detail layout: the directory, enabled/custom/built-in filters, and the selected agent stay visible together, and search/filter state survives extension-host re-renders. Its grouped editor progressively discloses Identity, Instructions & completion, Skills, Models & budget, Testing, and Maintenance. Custom definitions can add bounded completion-rubric rows and incomplete-result retry patterns; built-in identity and factory criteria are inspectable but read-only. The global Agent Auto-Update cadence appears once under **Defaults & automation** and updates `atlasmind.agentAutoUpdateCadence` through validated extension-host message handling. Built-ins render their exclusion checked and disabled, mirroring the host-side `AgentAutoUpdater.isDue()` guard that rejects them before any provider call.

 The Agent Manager, Tool Webhooks, MCP Servers, Voice, Vision, and Personality Profile panels now follow that same workspace pattern as well. The Voice panel is now explicit about backend capability boundaries: it persists STT enablement plus preferred microphone and speaker ids, enumerates devices from the webview runtime, applies preferred output routing to ElevenLabs audio through `setSinkId()` when available, and calls out that Web Speech still follows the default browser or OS device where no direct routing API exists. AtlasMind does not yet ship an OS-native speech host adapter, but the stored device ids keep that seam ready for a future platform-specific backend. The Personality Profile surface is AtlasMind's guided operator questionnaire: it captures personality answers through freeform fields backed by quick-fill presets, lets the operator save them either as a global baseline or as a project-specific override, writes the paired live settings at user or workspace scope to match that save target, and now distinguishes clearly between editor-only load actions and the destructive action that clears the saved project override. The extension runtime merges any project override on top of the saved global profile before injecting that effective operator profile into task prompt assembly on every request. When SSOT is present, only project-specific saves mirror into `project_memory/agents/` plus a summary block inside `project_soul.md`, which keeps user-wide defaults out of repo-owned memory. The panel also exposes direct-open links for the generated project profile markdown and `project_soul.md` when those project artifacts exist. Agent rows in the sidebar open directly into the matching agent editor surface, model-provider rows open into the provider workspace, MCP overview actions can jump directly into safety settings or agent management, and page-specific settings commands plus richer sidebar empty states let operators jump directly to chat, models, safety, or project settings instead of reopening generic configuration. Their hero summary chips now act as lightweight navigation shortcuts whenever a matching page exists, rather than remaining inert labels. Within the shared Atlas chat surface itself, approval prompts are rendered in a dedicated warning stack below the transcript and above the composer so execution decisions stay visually separate from conversation history while still living in the same webview, the header toolbar now includes direct shortcuts into the Project Run Dashboard and the main sidebar chat view while preserving the current chat target, the toolbar and composer icon buttons now use explicit centering styles so their glyphs stay visually centered inside circular controls, the dedicated panel can surface a direct-recovery banner when the extension host detects operator frustration and shifts the active turn toward corrective action, the native sidebar chat mirrors that shift through assistant-footer timeline notes so the operator can see exactly when Atlas learned from friction, that frustration path also persists updated workspace personality answers plus an SSOT feedback note for future turns, the composer info affordance opens a structured hint panel with titled bullet lists that adapt between idle, busy, and run-inspector states and append context-aware guidance from recent transcript content plus live execution state, the composer accepts action-oriented Enter variants so operators can send with the selected mode, start a new chat thread, steer an in-flight response, or insert a newline directly from the keyboard, and idle chat-state refreshes return focus to the composer so operators can keep sending follow-up prompts without manually reactivating the input.

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
    -> SecretRedactor.redactSecretsWithWarning() // strip credentials from memory/evidence before dispatch
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
  -> Planner.plan()                          // reasoning LLM decomposes into ProjectPlan DAG
  -> Normalize execution skills             // reasoning-only planning cannot strand workspace execution
  -> Preview + approval gate
  -> TaskScheduler.execute()                 // parallel batch execution
    -> For each batch:
      -> Orchestrator.executeSubTask()       // ephemeral agent per subtask
        -> Route to function-calling model   // explicit "tools unavailable" refusal triggers failover
  -> Orchestrator.synthesize()               // final report across all subtasks
  -> ProjectRunHistory.save()                // persist for Run Center
  -> Chat response stream

Short continuation prompts such as `Proceed autonomously` reuse the latest substantive user request in the active chat session and route it through the same autonomous project pipeline.
```

When an execution cap pauses a chat-owned project run, the original assistant entry retains the bounded suggested values. The shared chat renderer turns that metadata into an explicit question and three choices: use the suggestion for this run, persist it for future runs, or keep the partial result. Extension-host handlers revalidate the transcript entry and limit before mutation. Temporary values are restored after the awaited retry; permanent values alone update workspace configuration. The custom panel also suppresses the native Settings-button placeholder and does not record a duplicate user/assistant pair after its streamed project bubble completes.

The Settings **Agents** page renders the escaped `IMMUTABLE_GUARDRAILS` runtime constant in a selectable, read-only block. This makes the authoritative non-overrideable policy visible to operators without creating a webview-maintained copy that could drift from execution behavior.

Settings Overview and Models & Integrations both expose Personality Profile shortcuts through the same validated webview-to-host message. The host dispatches the existing `atlasmind.openPersonalityProfile` command, keeping navigation authority outside the webview while making the global/project preference surface discoverable where users configure routing and models.

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
|  |- websiteWorkspaceManager.ts  Website brief/design/hosting/platform/n8n SSOT
|  |- planner.ts         Goal -> DAG decomposition
|  |- taskScheduler.ts   DAG -> parallel batch execution
|  |- taskProfiler.ts    Task phase/modality inference
|  |- checkpointManager.ts  Pre-write snapshots
|  |- skillScanner.ts    Custom skill security scanning
|  |- scannerRulesManager.ts  Rule overrides
|  |- securityReviewManager.ts  Security-review register persistence + scoring
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
|  |- localModelRecommendationRegistry.ts  Release-aware local recommendation candidates + `.atlasmind/local-model-recommendations.json` override loader
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
|  |- specialistGuidance.ts  specialist-guidance (focused SEO/UX reference checklists)
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
|  |- mcpPanel.ts        MCP server management webview (Guided Setup wizard: scan/browse → prerequisites → guided credentials → connect; Advanced manual form)
|  |- toolWebhookPanel.ts  Webhook config webview
|  |- skillScannerPanel.ts  Scanner rules webview
|  |- costDashboardPanel.ts  Cost Dashboard webview (daily chart, model breakdown, budget bar)
|  |- modelComparisonPanel.ts  Model Comparison webview (run a prompt across models, ranked results; flags models de-weighted by the router's struggle memory)
|  |- missionControlPanel.ts  Mission Control webview (define/launch/watch/checkpoint/audit Mission Loop runs)
|  |- websiteStudioPanel.ts  Website intake-to-delivery dashboards
|  `- webviewUtils.ts    Shared webview helpers (escapeHtml, CSP, nonce)
|- utils/
|  `- workspacePicker.ts Multi-workspace folder selection
|- voice/
|  |- voiceManager.ts    TTS/STT bridge (ElevenLabs server-side + OS host engine + Web Speech API + local Whisper)
|  |- hostSpeechSynthesizer.ts  On-device OS TTS (Windows SAPI / macOS say / Linux espeak-ng)
|  `- localTranscriber.ts  On-device Whisper STT (verified model/binary download + whisper-cli)
`- bootstrap/
   `- bootstrapper.ts    Project init + import

media/
`- walkthrough/          Getting Started walkthrough content (4 steps)

tests/                   Vitest unit and integration suites
`- integration/          Multi-component integration tests
docs/                    Technical documentation
```

## Key Interfaces

All shared interfaces live in `src/types.ts`. Key types include:

| Interface | Purpose |
|-----------|---------|
| `AgentDefinition` | Agent identity, role, prompt, model constraints, cost limit, skills, and optional completion rubric/incomplete-response gates |
| `SkillDefinition` | Skill identity, JSON Schema parameters, handler function, timeout |
| `ModelInfo` | Model identity, provider, pricing, context window, capabilities, reasoning depth, latency class, and prompt-cache support (`supportsPromptCaching`, `cachedInputPricePer1k`) |
| `ProviderConfig` | Provider registration, API key reference, pricing model, subscription quota |
| `CostRecord` | Per-request token counts plus provider, billing category, display cost, budget-counted cost, and optional chat session/message linkage |
| `TaskProfile` | Inferred task phase, modality, reasoning intensity, required capabilities |
| `ModelStruggleKind` / `ModelStruggleState` | A model's under-performance signal (`timeout`, `empty`, `tool-call-as-text`, `error-finish`, `user-correction`) and its persistent decaying de-weight per task signature |
| `MemoryEntry` | Memory path, title, tags, snippet, timestamp, optional embedding |
| `SubTask` | Plan node: title, role, skills, dependency edges |
| `SubTaskResult` | Execution outcome with `status` (`completed` / `failed` / `needs-input`); a capped subtask reports `needs-input` plus `iterationLimitHit` and suggested raised limits |
| `ProjectPlan` | Goal string + SubTask DAG |
| `ProjectResult` | Execution results, synthesis, cost totals |
| `ToolInvocationPolicy` | Risk category, risk level, approval summary |
| `PromotionPlan` / `PromotionRemediation` | Assembled guarded promotion (preflight checks, steps, gate flags) and the optional "Resolve & run" offer for fixable failing checks (assessed version bump + changelog + commit) |
| `WebsiteWorkspaceConfig` | Website Studio SSOT: client intake, page workflow, UI system, fixed hosting environments, platform targets, and n8n workflow references |
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
- **Website Studio** - bounded/sanitized edits, server-locked Develop/Staging/Production policies, loopback/HTTPS/review-subdomain checks, redacted secret and webhook shapes, provider-prefixed credential references only, and no direct deployment/workflow execution
- **Memory writes** - scanned for prompt injection and credential leakage
- **Terminal** - allow-list of ~40 safe commands; dangerous commands blocked
- **Tool approval** - tiered gating configurable from always-ask to allow-safe-readonly

See [[Security]] for the full security model.

## Detailed Architecture Subdocs

| Document | Description |
|---|---|
| `architecture/boundaries-and-seams.md` | Explicit review of all 8 integration seams — contracts, protocols, and security rules |
| `architecture/runtime-and-surfaces.md` | Runtime environment and UI surface overview |
| `docs/architecture/orchestrator-flow.md` | `processTaskWithAgent` and `runAgenticLoop` internal flow with Mermaid diagrams |

