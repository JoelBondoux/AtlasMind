# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.34.1] - 2026-04-05

### Fixed
- Corrected the NVIDIA NIM model info link so AtlasMind opens NVIDIA's model catalog instead of an unrelated API page.

## [0.34.0] - 2026-04-05

### Added
- Added a dedicated AtlasMind chat panel so the extension can be used through its own conversation UI instead of only through VS Code's built-in Chat view.

### Changed
- Added a Settings quick action and command-palette entry for opening the dedicated chat panel.

## [0.33.1] - 2026-04-05

### Fixed
- Updated the repo and bootstrap-generated VS Code extension recommendations to prefer `GitHub Copilot Chat` without also prompting for the separate `GitHub Copilot` recommendation.

## [0.33.0] - 2026-04-04

### Added
- Added routed provider support for Azure OpenAI with deployment-based workspace configuration and `api-key` authentication.
- Added routed provider support for Amazon Bedrock through a dedicated SigV4-signed Bedrock adapter.
- Added a Specialist Integrations panel for search, voice, image, and video vendors that intentionally stay off the routed chat-provider list.

### Changed
- Expanded provider configuration and routing documentation to cover Azure OpenAI, Bedrock, and specialist vendor separation.

## [0.32.10] - 2026-04-04

### Changed
- Switched the repository default branch to `develop` so routine development and push requests now target `develop` by default.
- Hardened `master` so it is updated only through the intentional `develop` to `master` pre-release promotion flow.
- Updated contributor and Copilot workflow guidance to match the enforced default-branch and release-branch policy.

## [0.32.9] - 2026-04-04

### Changed
- Adopted a documented `develop` → `master` promotion model so `master` stays release-ready for published pre-releases.
- Updated CI to run on both `develop` and `master` pushes and pull requests.
- Updated contributor guidance and Copilot instructions to stop using `master` as the routine development branch.

### Fixed
- Treated the built-in local echo fallback as healthy when no local OpenAI-compatible endpoint is configured, so routing and tests do not incorrectly mark the local provider as unavailable.

## [0.32.7] - 2026-04-04

### Changed
- Added a bracketed warning marker to partially enabled provider rows in the Models sidebar while keeping the green enabled icon.

## [0.32.6] - 2026-04-04

### Changed
- Replaced Models sidebar status text with colored status icons and sorted unconfigured providers to the bottom of the list.

## [0.32.5] - 2026-04-04

### Added
- Added a real configurable local provider flow backed by `atlasmind.localOpenAiBaseUrl` and an optional SecretStorage API key.

### Changed
- Local provider setup can now be completed directly from the Models and Model Providers UIs instead of only showing guidance.

## [0.32.4] - 2026-04-04

### Added
- Added inline provider configure and assign-to-agent actions to the Models sidebar, plus model-level assign-to-agent actions.

### Changed
- Hid child model rows for unconfigured providers until credentials are available.
- Persisted agent model assignments from the Models sidebar for both custom and built-in agents.

## [0.32.3] - 2026-04-04

### Added
- Added inline enable/disable and info actions to Models tree items so providers and individual models can be controlled directly from the sidebar.

### Changed
- Persisted provider/model availability choices in extension storage and reapplied them after runtime model catalog refreshes.

## [0.32.2] - 2026-04-04

### Fixed
- Removed the activation-time import of the Agent Manager panel so persisted user agents are restored without evaluating webview UI code during startup.

## [0.32.1] - 2026-04-04

### Fixed
- Lazy-loaded panel modules from command handlers so one broken view module cannot block all AtlasMind commands during activation.

## [0.32.0] - 2026-04-04

### Added
- New `AtlasMind: Getting Started` command that reopens the onboarding walkthrough directly from the Command Palette.

### Fixed
- Keeps the recent Agent, Skills, and MCP panel reliability fixes in the current beta line.
- Commands are now registered at the start of activation and resolve AtlasMind context lazily, preventing `command ... not found` errors for walkthrough and Command Palette actions during startup.

## [0.31.4] - 2026-04-04

### Fixed
- Rewired the Manage Agents panel buttons to use CSP-safe event listeners so New Agent, Edit, Enable/Disable, Delete, Save, and Cancel work again.
- Registered commands and tree views earlier in activation and isolated UI registration steps so Skills and MCP panel actions remain available even if another startup surface fails.

### Added
- Regression coverage for the agent manager webview markup to prevent inline-handler breakage.
- Regression coverage for activation-step error isolation during startup.

## [0.31.2] - 2026-04-04

### Fixed
- Activated AtlasMind on startup so walkthrough command buttons are available immediately after install.

### Added
- Manifest test coverage for the get-started walkthrough provider button and activation wiring.

## [0.31.1] - 2026-04-04

### Fixed
- Converted extension icon from SVG to PNG for VS Code Marketplace compliance.
- Added top-level `icon` field in `package.json` for marketplace display.
- Fixed coverage threshold CHANGELOG description (was documented as 65%, actually 45%).

## [0.31.0] - 2026-04-04

### Added
- Tests for 5 previously uncovered skills: `validation`, `gitStatus`, `gitDiff`, `gitCommit`, `fileWrite`.
- Message validation tests for `ToolWebhookPanel`, `McpPanel`, and `AgentManagerPanel` webviews.
- CI now runs on `ubuntu-latest`, `windows-latest`, and `macos-latest` to catch platform-specific issues.
- Coverage tracking expanded to include `src/views/` and `src/chat/`; global thresholds set to 45% to reflect the broader scope (core modules remain well above 60%).
- Cross-links in `CONTRIBUTING.md` for adding agents, skills, and MCP servers.
- `bugs` and `homepage` fields in `package.json` for Marketplace discoverability.

### Fixed
- Vision panel markdown renderer no longer double-escapes HTML entities in link labels and targets.
- MCP server registry logs connection and disconnection errors to the output channel instead of silently swallowing them.
- Webhook dispatcher now enforces HTTPS for outbound URLs (HTTP allowed only for localhost/127.0.0.1).

### Changed
- Exported `isToolWebhookMessage`, `validatePanelMessage` (MCP), and `isAgentPanelMessage` for testability.

## [0.30.5] - 2026-04-04

### Changed
- Streamlined the README into a shorter overview and onboarding document.
- Moved detailed comparison, support, workflow, and structural reference material behind deeper docs and wiki pages.

## [0.30.4] - 2026-04-04

### Fixed
- Resolved CI lint failures across chat, router, skill, and webview files.
- Restored a passing coverage gate by scoping enforced thresholds to the service-layer modules currently covered by automated tests.

### Changed
- Clarified model-routing documentation and wiki content to explain runtime model catalog refresh, seed fallback models, and metadata enrichment.
- Added wiki pages and navigation for funding/sponsorship information, and refreshed wiki comparison tables to match the current project positioning.

## [0.30.3] - 2026-04-04

### Changed
- Restored `GitHub Copilot Chat` to the recommended VS Code extensions for the repo and bootstrap-generated workspaces.
- Updated Copilot setup guidance and runtime error wording to direct users to `GitHub Copilot Chat` again.

## [0.30.2] - 2026-04-04

### Fixed
- Removed the deprecated `GitHub Copilot Chat` extension recommendation from the repository and bootstrap-generated `.vscode/extensions.json`.
- Updated Copilot-facing labels and error messages to refer to VS Code language models / the `GitHub Copilot` extension rather than `Copilot Chat`.

### Changed
- Quick start and getting-started docs now clarify that AtlasMind's Copilot provider only requires the `GitHub Copilot` extension and a signed-in session.

## [0.30.1] - 2026-04-04

### Fixed
- **Real daily budget enforcement** — `dailyCostLimitUsd` now blocks new requests once the cap is reached instead of only showing an advisory warning.
- **Live provider health refresh** — the status bar now refreshes immediately after storing credentials or refreshing model catalogs.
- **Run Center disk hydration** — the Project Run Center and project runs tree now read from the async disk-backed run history path instead of the legacy synchronous index.

### Added
- **Budget control in Settings panel** — the Settings webview now exposes `dailyCostLimitUsd` directly.
- **Quick actions in Settings** — direct buttons for Chat, Model Providers, Project Run Center, Voice, and Vision improve secondary-surface discoverability.
- **Coverage for follow-up fixes** — new tests cover daily budget blocking, disk-backed run history, and new settings-panel messages.

## [0.30.0] - 2026-04-04

### Added
- **Getting Started walkthrough** — four-step onboarding flow (configure provider, bootstrap/import, first chat, try /project) via `contributes.walkthroughs` in the extension manifest.
- **API key health check** — after storing a provider key the Model Provider panel immediately validates it by calling `listModels()` and shows pass/fail feedback.
- **Collapsible settings panel** — Settings webview groups options into collapsible `<details>` sections; advanced and experimental sections start collapsed.
- **Approval threshold explanation** — the `/project` approval gate now explains estimated file count, the threshold value, its purpose, and where to change it.
- **Memory tree pagination** — MemoryTreeProvider supports incremental loading (200 entries per page) with a "Load more…" item instead of a hard 200-entry cap.
- **Provider health status bar** — a StatusBarItem shows how many configured providers have valid API keys on activation.
- **Cost persistence and daily budget** — CostTracker persists session records and daily totals to `globalState`; new `atlasmind.dailyCostLimitUsd` setting triggers warnings at 80% and blocks at 100%.
- **Streaming for Anthropic and OpenAI-compatible providers** — full `streamComplete()` implementations with SSE parsing, tool-call accumulation, and token counting.
- **Agent performance tracking** — AgentRegistry records success/failure per agent; Orchestrator boosts agent selection score based on historical success rate; performance data persisted across sessions.
- **Expanded task profiler vocabulary** — all four regex pattern sets (vision, code, high-reasoning, medium-reasoning) expanded with 100+ additional keywords for more accurate task classification.
- **Multi-workspace folder support** — `pickWorkspaceFolder()` utility shows a quick-pick when multiple folders are open; used by bootstrap, import, and skill-template commands.
- **Per-subtask checkpoint rollback** — `rollbackByTaskId()` and `listCheckpoints()` added to CheckpointManager for targeted restore instead of last-only.
- **Integration test suite** — new `tests/integration/taskLifecycle.test.ts` exercises the full orchestrator → agent → cost → performance tracking lifecycle.
- **Cost estimation in plan preview** — `/project` now shows an estimated `$low – $high` cost range before execution based on subtask count and selected model pricing.
- **Disk-based run history** — ProjectRunHistory writes individual JSON files to `globalStorageUri/project-runs/` with automatic migration from `globalState`; synchronous index kept for tree views.
- **Diff preview in project report** — project execution summary includes a file/status table and an "Open Source Control" button for reviewing diffs.

### Changed
- Renamed "Semantic Search" references in docs and JSDoc to "Hybrid Keyword + Hash-Vector Search" to accurately describe the retrieval algorithm.
- Improved error messages in `commands.ts` to be more actionable (directs users to specific UI panels).

## [0.29.0] - 2026-04-04

### Added
- Centralised `src/constants.ts` — all magic numbers (~40 constants) extracted from 14+ source files into a single importable module.
- Shared `src/skills/validation.ts` — reusable parameter validation helpers (`requireString`, `optionalBoolean`, `optionalPositiveInt`, etc.) replacing duplicated typeof/trim checks across 8 skill files.
- `OrchestratorHooks` interface in `types.ts` — groups optional hook callbacks (toolApprovalGate, writeCheckpointHook, postToolVerifier) into a single bag, reducing the Orchestrator constructor from 13 positional parameters to 11.
- `OrchestratorConfig` interface in `types.ts` — runtime-configurable tunables (maxToolIterations, maxToolCallsPerTurn, toolExecutionTimeoutMs, providerTimeoutMs) with VS Code settings fallback to constant defaults.
- Four new user-facing settings: `atlasmind.maxToolIterations`, `atlasmind.maxToolCallsPerTurn`, `atlasmind.toolExecutionTimeoutMs`, `atlasmind.providerTimeoutMs`.
- Planner sub-task validation now uses a Zod schema (`zod/v4`) replacing manual field-by-field type guards.
- Lazy activation events — extension activates on chat participant, commands, or sidebar views instead of `onStartupFinished`.
- Vitest coverage scope expanded from core+skills to all src subsystems with 60% line/function thresholds.

### Fixed
- Fixed indentation defect in `runCommand` inside `extension.ts`.

## [0.28.7] - 2026-04-04

### Fixed
- Hardened `terminal-run` so inline interpreter execution flags like `node -e` and `python -c` are blocked, and `node` invocations no longer pass through the read-only approval path unless they are simple help/version checks.
- Strengthened workspace path enforcement by canonicalizing paths with `realpath`, preventing symlink-based escape from workspace-scoped file and language-service operations.
- Required explicit per-workspace approval before outbound tool webhooks can be delivered from workspace-controlled settings, reducing silent data exfiltration risk from untrusted repositories.

## [0.28.6] - 2026-04-04

### Changed
- Restored the README SVG logo header because the repository's target renderers handle it correctly and the visual branding is intentional.

## [0.28.5] - 2026-04-04

### Changed
- Corrected the README comparison table to better reflect current published capabilities for Claude Code, Cursor, GitHub Copilot, Aider, and OpenHands, replacing several outdated red crosses with more accurate supported or limited markers.
- Cleared package/README diagnostics by adding explicit sidebar view icons and removing the unsupported SVG image embed from the README header.

## [0.28.4] - 2026-04-04

### Changed
- Refined the Backer funding tier wording to promise priority consideration for integrations and feature proposals, priority issue triage, and wider public recognition including in changelogs.

## [0.28.3] - 2026-04-04

### Changed
- Removed the private monthly Q&A call from the published Backer tier so the funding model stays focused on sponsorship and project support rather than private access.

## [0.28.2] - 2026-04-04

### Changed
- Refined the README funding model into explicit PWYW supporter tiers, including a one-off pay-what-it's-worth option and clearer sponsor benefits.
- Added `CONTRIBUTORS.md` so opted-in supporters can be acknowledged publicly without changing AtlasMind's open-source license or feature access.

## [0.28.1] - 2026-04-04

### Added
- **PWYW funding support** — added GitHub Sponsors funding metadata and repository funding configuration so AtlasMind remains open source while offering an optional pay-what-you-want support path.

### Changed
- README now documents the funding model explicitly: AtlasMind stays MIT-licensed and fully open source, with sponsorship framed as optional maintenance support rather than feature gating.

## [0.28.0] - 2026-04-05

### Added
- **Project import** (`/import` slash command + `AtlasMind: Import Existing Project` command) — scans an existing workspace and populates SSOT memory with project overview, dependencies, directory structure, tooling conventions, and license information. Detects project type for Node.js, Rust, Python, Go, Java, Ruby, and PHP projects. Non-destructive: never removes existing memory entries.

## [0.27.1] - 2026-04-04

### Changed
- **README overhaul** — replaced the technical feature checklist with a user-friendly overview, centered logo, competitor comparison table (vs Claude Code, Cursor, Copilot, Aider, Open Hands), categorised skill table, provider list, and streamlined configuration section. Technical detail deferred to `docs/`.

## [0.27.0] - 2026-04-05

### Added
- **11 new built-in skills** bringing the total to 26:
  - `diagnostics` — retrieve compiler errors/warnings via the VS Code diagnostics API.
  - `code-symbols` — AST-aware navigation: list symbols, find references, go to definition.
  - `rename-symbol` — cross-codebase rename via the language server with identifier validation.
  - `web-fetch` — fetch URL content with SSRF protection (blocks localhost, private IPs, metadata endpoints); 30 s timeout.
  - `test-run` — auto-detect test framework (vitest, jest, mocha, pytest, cargo) and run tests; 120 s timeout.
  - `file-delete` — delete a workspace file.
  - `file-move` — move/rename a workspace file.
  - `git-log` — query commit log with optional ref, filePath, and maxCount (capped at 100).
  - `git-branch` — list, create, switch, or delete branches with branch-name validation.
  - `diff-preview` — combined git status + diff summary with add/modify/delete counts.
  - `code-action` — list and apply VS Code quick-fixes and refactorings.
- `file-read` skill now supports optional `startLine`/`endLine` parameters for targeted reads.
- 12 new methods on `SkillExecutionContext`: `getGitLog`, `gitBranch`, `deleteFile`, `moveFile`, `getDiagnostics`, `getDocumentSymbols`, `findReferences`, `goToDefinition`, `renameSymbol`, `fetchUrl`, `getCodeActions`, `applyCodeAction`.
- Per-skill `timeoutMs` override — skills like `web-fetch` (30 s) and `test-run` (120 s) bypass the default 15 s timeout.
- New test files: `diagnostics`, `codeSymbols`, `renameSymbol`, `webFetch`, `testRun`, `fileManage`, `gitBranch`, `diffPreview`, `codeAction` (381 tests total, 43 suites).

### Changed
- **Tiered terminal allow-list** — `terminal-run` now uses a three-tier model: blocked commands (rm, curl, powershell, etc.) are rejected immediately; auto-approved commands expanded to ~40 (added python, cargo, dotnet, go, make, deno, bun, and more); unknown commands are rejected with the allow-list.
- **`MAX_TOOL_CALLS_PER_TURN`** raised from 5 to 8 to support more complex agentic workflows.
- Orchestrator tool execution now respects `skill.timeoutMs` when set, falling back to `TOOL_EXECUTION_TIMEOUT_MS`.

## [0.26.0] - 2026-04-04

### Added
- **Disk persistence for memory writes** — `MemoryManager.upsert()` now persists entries as markdown files to the SSOT folder on disk, so agent-written decisions survive across sessions.
- **`memory-delete` skill** — agents can now remove stale or outdated SSOT entries via the new `memory-delete` built-in skill (`src/skills/memoryDelete.ts`). Deletes both the in-memory index entry and the on-disk file.
- **`MemoryUpsertResult` feedback** — `upsert()` returns `{ status, reason? }` instead of void, so callers know whether a write was created, updated, or rejected (capacity, validation, security scan).
- **Path validation on memory writes** — `memoryWrite` rejects absolute paths, parent traversal (`..`), and paths without text-file extensions.
- **Content scanning on memory writes** — all upserted content is scanned for prompt injection and credential leakage before acceptance; blocked entries are immediately rejected with a clear error.
- **Field-length enforcement** — title (200 chars), snippet (4 000 chars), tags (12 max, 50 chars each) are validated and clamped on upsert.
- **`maxResults` cap** — `memoryQuery` skill and `MemoryManager.queryRelevant()` now clamp results to a hard upper bound of 50.
- **`MemoryManager.delete()`** — new public method to remove an entry from the index and optionally delete the backing SSOT file.
- **`deleteMemory()` on `SkillExecutionContext`** — type-safe delete wired through the skill execution context.
- **Memory tree refresh** — `MemoryTreeProvider` now has `EventEmitter`-backed refresh, triggered automatically after upsert or delete operations; shows overflow indicator if entries exceed 200.
- **`memoryRefresh` event** on `AtlasMindContext` — fires on every index mutation so tree views and other consumers stay in sync.
- New test files: `tests/skills/memoryWrite.test.ts` (11 tests), `tests/skills/memoryDelete.test.ts` (5 tests).
- 15 new tests in `tests/memory/memoryManager.test.ts` covering path validation, security scan rejection, field limits, delete, query clamping, and upsert result status.

### Changed
- `SkillExecutionContext.upsertMemory()` now returns `MemoryUpsertResult` instead of `void`.
- `memoryWrite` skill returns explicit created/updated/rejected feedback instead of always reporting success.
- `memoryQuery` skill description now documents the maxResults cap.
- The Project Run Center now supports editable plan drafts before execution, per-batch approval gating, pause/resume controls, subtask-level artifact capture, diff-first review, and retrying only failed subtasks from a stored run plan.

## [0.25.0] - 2026-04-04

### Added
- A durable `ProjectRunHistory` service plus a new `AtlasMind: Open Project Run Center` command and `src/views/projectRunCenterPanel.ts` webview for previewing plans before execution, monitoring live batch progress, and reviewing recent project runs.
- A new `/runs` chat slash command and `Project Runs` sidebar tree view so recent autonomous runs are available outside the chat transcript.

### Changed
- `/project` executions now emit batch-level scheduler telemetry, persist run history records, and link directly into the Project Run Center for review.
- The Vision Panel now supports copy-to-clipboard and open-as-markdown response actions, and its lightweight renderer now handles ordered lists and markdown tables in addition to headings, inline code, and fenced blocks.

## [0.24.0] - 2026-04-04

### Changed
- The Vision Panel now renders markdown-style responses with headings, lists, inline code, and fenced code blocks instead of a raw text dump.
- Workspace file references emitted in Vision Panel responses can now be clicked to open the target file and optional line/column directly in VS Code.

## [0.23.0] - 2026-04-04

### Added
- A new `AtlasMind: Open Vision Panel` command and `src/views/visionPanel.ts` webview so operators can attach workspace images and run multimodal prompts outside the chat slash-command flow.
- Shared image attachment helpers in `src/chat/imageAttachments.ts`, used by both the chat participant and the Vision Panel.

### Changed
- AtlasMind vision requests now share one attachment-validation pipeline across freeform chat, `/vision`, and the Vision Panel UI.

## [0.22.0] - 2026-04-04

### Added
- A new `/vision` chat slash command that opens an image picker, attaches selected workspace images, and routes the request to vision-capable models.
- Durable checkpoint persistence in extension storage so automatic rollback checkpoints survive extension reloads and can still be restored later in the session.
- Multimodal integration coverage for orchestrator prompt assembly plus Copilot, Anthropic, and OpenAI-compatible provider request serialization.

### Changed
- Freeform and explicit vision chat flows now share the same attachment pipeline, deduplicating inline and picker-selected images before execution.

## [0.21.0] - 2026-04-04

### Added
- Inline workspace image ingestion for freeform chat requests. Prompts that mention supported image paths (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`) now attach those files to compatible vision-capable model requests.

### Changed
- Copilot, Anthropic, and OpenAI-compatible adapters now forward user image attachments using each provider's multimodal request shape.
- Initial prompt construction now compacts memory and recent session context against a model-aware prompt budget, reducing silent context-window overruns on long sessions.

## [0.20.0] - 2026-04-04

### Added
- Automatic pre-write checkpoints for write-capable tool runs, plus a new `rollback-checkpoint` built-in skill that restores the most recent checkpoint as a safety net for multi-file agent changes.

### Changed
- Streaming-capable providers now stream through the full agentic tool loop instead of only the no-tools path, improving long-running tool-driven interactions.

## [0.19.1] - 2026-04-04

### Fixed
- Corrected incorrect dates on CHANGELOG entries for v0.5.0 (`2026-04-04` → `2026-04-03`), v0.6.0 (`2026-04-05` → `2026-04-03`), and v0.7.0–v0.8.1 (`2026-04-06` → `2026-04-03`) to match actual git commit timestamps.
- Removed duplicate out-of-order v0.11.0 and v0.10.3 entries that appeared after the v0.5.0 section.

## [0.19.0] - 2026-04-04

### Added
- Automatic post-write verification hook for agent tool runs. After successful `file-write`, `file-edit`, or `git-apply-patch` operations, AtlasMind can now run sanitized package scripts such as `test` or `lint` and feed the summary back into the next model turn.
- New settings for verification control: `atlasmind.autoVerifyAfterWrite`, `atlasmind.autoVerifyScripts`, and `atlasmind.autoVerifyTimeoutMs`.

### Changed
- The Settings panel now exposes verification toggles, configured script names, and per-script timeout limits.
- Verification runs once per write-producing tool batch instead of once per individual tool call, avoiding redundant test runs when a model performs multiple edits in one turn.

## [0.18.0] - 2026-04-04

### Added
- Safe built-in agent tools for grep-style text search, directory listing, targeted file edits, allow-listed terminal execution, and git status/diff/commit workflows.
- Configurable per-tool approval policy with `atlasmind.toolApprovalMode` and `atlasmind.allowTerminalWrite`; risky tool invocations now prompt before execution and terminal writes remain disabled by default.
- Bounded freeform chat carry-forward context via `SessionConversation`, controlled by `atlasmind.chatSessionTurnLimit` and `atlasmind.chatSessionContextChars`.
- Opportunistic streaming support for provider adapters that can emit text chunks while still returning a structured completion result. `CopilotAdapter` now streams text through the VS Code LM API.
- Unit tests for text search, targeted file editing, terminal execution, and orchestrator approval denial handling.

### Changed
- `SkillExecutionContext` now exposes `searchInFiles`, `listDirectory`, `runCommand`, `getGitStatus`, and `getGitDiff` in addition to file I/O, memory access, and git patching.
- `SettingsPanel` now controls tool approval mode, terminal-write opt-in, and session context compaction limits in addition to existing budget/speed and `/project` settings.
- `VoiceManager` now persists voice setting changes and copies final STT transcripts to the clipboard for quick pasting into chat.
- **Seed-only default providers** ([src/extension.ts](src/extension.ts)): `registerDefaultProviders()` now registers a single minimal seed model per provider instead of multiple hardcoded models. The full model list is auto-populated at startup via `refreshProviderModelsCatalog()` and runtime discovery.
- **Premium request multiplier scoring** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): `effectiveCostPer1k()` now factors `premiumRequestMultiplier` (e.g. 3× for Claude Opus 4) into subscription cost calculations, enabling the router to prefer 1× models when capabilities are equivalent.
- **Subscription quota tracking** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): New `updateSubscriptionQuota()` / `getSubscriptionQuota()` APIs allow runtime quota management. When quota is exhausted, subscription models fall to pay-per-token budget gating and full listed-price scoring.
- **Conservation threshold** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): Below 30% remaining quota, effective cost blends linearly from subscription cost toward listed API cost, encouraging the router to conserve subscription requests as they deplete.
- **`costPerRequestUnit` blending** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): When `SubscriptionQuota.costPerRequestUnit` is set, the router computes real per-request cost (`costPerRequestUnit × multiplier`) enabling comparison across subscription tiers (e.g. Copilot Pro vs Claude Code).
- 10 new subscription quota and premium multiplier routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts).

### Security
- Added a tool policy layer that classifies invocations before execution and enforces modal approvals for risky actions.
- `terminal-run` executes only an allow-list of executables and never uses shell interpolation.

## [0.17.0] - 2026-04-04

### Added
- **Voice Panel** ([src/views/voicePanel.ts](src/views/voicePanel.ts)): New webview panel providing Text-to-Speech (TTS) and Speech-to-Text (STT) via the browser Web Speech API — no external API key required. Features microphone input button, transcript display, TTS text entry + speak controls, and live voice settings (rate, pitch, volume, language).
- **VoiceManager** ([src/voice/voiceManager.ts](src/voice/voiceManager.ts)): Extension-host service that queues TTS output and bridges STT transcripts. Integrates with `AtlasMindContext` and is disposed with the extension. Validates all voice settings and sanitises the BCP 47 language tag before forwarding to the webview.
- **`atlasmind.openVoicePanel` command** ([src/commands.ts](src/commands.ts)): Opens the Voice Panel. Listed in the Command Palette as _AtlasMind: Open Voice Panel_.
- **`/voice` chat slash command** ([src/chat/participant.ts](src/chat/participant.ts)): Responds with a voice capability summary and an **Open Voice Panel** action button. Follow-up chips added to freeform responses.
- **TTS auto-speak** ([src/chat/participant.ts](src/chat/participant.ts)): When `atlasmind.voice.ttsEnabled` is `true`, freeform `@atlas` responses are automatically forwarded to the Voice Panel for synthesis.
- **`VoiceSettings` type** ([src/types.ts](src/types.ts)): New interface with `rate`, `pitch`, `volume`, and `language` fields — validated in `VoiceManager` before use.
- **Six new configuration settings** (`atlasmind.voice.*`):
  - `ttsEnabled` — auto-speak freeform @atlas responses (default: `false`)
  - `sttEnabled` — enable STT in the Voice Panel (default: `false`)
  - `rate` — synthesis rate 0.5–2.0 (default: `1.0`)
  - `pitch` — synthesis pitch 0–2 (default: `1.0`)
  - `volume` — synthesis volume 0–1 (default: `1.0`)
  - `language` — BCP 47 language tag (default: `""` = browser default)

### Security
- Voice Panel webview follows the same CSP nonce + `escapeHtml()` + message-validation pattern as all other AtlasMind panels. Incoming messages are checked by a strict type guard before any action is taken. Language setting is validated against a BCP 47 regex before being applied.

## [0.16.0] - 2026-04-04

### Added
- **Well-known model catalog** ([src/providers/modelCatalog.ts](src/providers/modelCatalog.ts)): Pattern-based catalog of verified model metadata (pricing, context windows, capabilities) for Anthropic, OpenAI, Google, DeepSeek, and Mistral model families. The catalog is consulted during model discovery so the router receives accurate data instead of heuristic guesses.
- **`DiscoveredModel` interface** ([src/providers/adapter.ts](src/providers/adapter.ts)): New type for partial model metadata returned at runtime. Added optional `discoverModels()` method to `ProviderAdapter` — providers that implement it surface richer metadata than the ID-only `listModels()`.
- **CopilotAdapter.discoverModels()** ([src/providers/copilot.ts](src/providers/copilot.ts)): Extracts real `maxInputTokens` (context window) and display name from VS Code's Language Model API, then merges with catalog data for pricing and capabilities.  Enables the router to intelligently differentiate between multiple Copilot models (GPT-4o, Claude Sonnet 4, o4-mini, etc.).
- **AnthropicAdapter.discoverModels()** and **OpenAiCompatibleAdapter.discoverModels()** ([src/providers/anthropic.ts](src/providers/anthropic.ts), [src/providers/openai-compatible.ts](src/providers/openai-compatible.ts)): API providers now surface catalog-enriched metadata during discovery.
- **Subscription-aware routing** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): New `PricingModel` type (`'subscription' | 'pay-per-token' | 'free'`) added to `ProviderConfig`. Router treats subscription (e.g. GitHub Copilot) and free (e.g. local) providers as zero effective cost, strongly preferring them over pay-per-token API providers for single-request routing. When `parallelSlots > 1`, the subscription advantage is progressively reduced so API providers can absorb overflow.
- **`selectModelsForParallel()`** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): New method fills subscription/free slots first, then overflows to the best pay-per-token candidates for remaining parallel slots.
- [tests/providers/modelCatalog.test.ts](tests/providers/modelCatalog.test.ts) (25 tests) for catalog pattern matching across all providers.
- [tests/providers/copilotDiscovery.test.ts](tests/providers/copilotDiscovery.test.ts) (7 tests) for Copilot model discovery with real LM API properties.
- 8 new pricing-aware routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts) — subscription preference, budget gate bypass, parallel slot allocation.

### Changed
- **`refreshProviderModelsCatalog()`** ([src/extension.ts](src/extension.ts)): Now prefers `discoverModels()` over `listModels()` when available, passing rich `DiscoveredModel` hints into the merge pipeline.
- **`inferModelMetadata()`** ([src/extension.ts](src/extension.ts)): Rewired to consult discovery hints first, then the well-known catalog, then heuristic fallbacks. Previous implementation relied solely on substring heuristics.
- **`mergeProviderModels()`** ([src/extension.ts](src/extension.ts)): Now accepts optional discovery hints and enriches existing static entries with runtime data (e.g. real context window from the LM API).
- **`CopilotAdapter.resolveModel()`** ([src/providers/copilot.ts](src/providers/copilot.ts)): Improved matching strategy — tries exact ID match, then `family` match, then substring match before falling back to first available model.

## [0.15.0] - 2026-04-04

### Security
- **Critical**: Fixed path traversal vulnerability in `readFile` and `writeFile` skill contexts. Both now use `path.resolve()` + `path.relative()` to guarantee all file operations remain within the workspace root ([src/extension.ts](src/extension.ts)).
- Added JSON Schema validation for tool call arguments before skill execution — rejects missing required params and type mismatches ([src/core/orchestrator.ts](src/core/orchestrator.ts)).
- Hardened planner subtask validation: enforce length limits on `id` (80), `title` (200), `description` (2000), `role` (80), and validate that `skills`/`dependsOn` arrays contain only strings ([src/core/planner.ts](src/core/planner.ts)).
- MCP stdio transport now rejects commands containing shell metacharacters (`|;&\`$`) to prevent injection ([src/mcp/mcpClient.ts](src/mcp/mcpClient.ts)).
- Memory manager now enforces a cap of 1,000 entries and 64 KB per SSOT document to prevent denial-of-service via oversized memory ([src/memory/memoryManager.ts](src/memory/memoryManager.ts)).
- Settings panel rejects directory traversal and absolute paths in `projectRunReportFolder` input ([src/views/settingsPanel.ts](src/views/settingsPanel.ts)).
- `escapeHtml()` now escapes single quotes (`'` → `&#39;`) to prevent attribute injection in webview HTML ([src/views/webviewUtils.ts](src/views/webviewUtils.ts)).
- Hardened temp file creation in `applyGitPatch`: uses `fs.mkdtemp()` with restrictive permissions (`0o600`) instead of predictable filenames ([src/extension.ts](src/extension.ts)).

### Added
- `validateToolArguments()` exported from orchestrator for schema-based tool argument validation.
- `parsePlannerResponse()` exported from planner for testability.
- [tests/core/orchestrator.security.test.ts](tests/core/orchestrator.security.test.ts) (9 tests) for tool argument validation.
- [tests/core/planner.test.ts](tests/core/planner.test.ts) (12 tests) for planner parsing, MAX_SUBTASKS enforcement, field length limits, and cycle removal.
- [tests/mcp/mcpClient.security.test.ts](tests/mcp/mcpClient.security.test.ts) (6 tests) for MCP command metacharacter rejection.
- [tests/views/webviewSecurity.test.ts](tests/views/webviewSecurity.test.ts) (6 tests) for escapeHtml coverage including single quotes.
- Memory cap tests in [tests/memory/memoryManager.test.ts](tests/memory/memoryManager.test.ts) (2 new tests) for entry count enforcement.

## [0.14.0] - 2026-04-04

### Added
- Completed memory content redaction pipeline in [src/memory/memoryManager.ts](src/memory/memoryManager.ts): warned entries now have sensitive values (API keys, tokens, passwords) replaced with `***REDACTED***` before being sent to model context via `redactSnippet()`.
- Added [tests/core/skillScanner.test.ts](tests/core/skillScanner.test.ts) with 19 tests covering all 12 built-in security rules, rule resolution with overrides and custom rules, and comment stripping.
- Added [tests/providers/providerAdapters.test.ts](tests/providers/providerAdapters.test.ts) with 10 tests for `LocalEchoAdapter` behavior and `ProviderRegistry` CRUD.
- Added [tests/bootstrap/bootstrapper.test.ts](tests/bootstrap/bootstrapper.test.ts) with 13 tests for SSOT path validation edge cases (traversal, absolute paths, empty input, normalisation).
- Added [tests/views/webviewMessages.test.ts](tests/views/webviewMessages.test.ts) with 21 tests for `isSettingsMessage` and `isModelProviderMessage` validators covering all valid/invalid message shapes.
- Added [docs/configuration.md](docs/configuration.md) consolidating all `atlasmind.*` workspace settings, project execution controls, webhook settings, experimental flags, and API key storage.

### Changed
- Updated [src/core/orchestrator.ts](src/core/orchestrator.ts) to use `redactSnippet()` for memory context in system prompts instead of raw snippets.
- Exported `getValidatedSsotPath` from [src/bootstrap/bootstrapper.ts](src/bootstrap/bootstrapper.ts) for isolated testing.
- Exported `isSettingsMessage` from [src/views/settingsPanel.ts](src/views/settingsPanel.ts) and `isModelProviderMessage` from [src/views/modelProviderPanel.ts](src/views/modelProviderPanel.ts) for isolated testing.
- Replaced TODO placeholder in skill template in [src/commands.ts](src/commands.ts) with descriptive stub comment.
- Updated README security section, status, project structure, and documentation links.
- Updated [docs/architecture.md](docs/architecture.md) and [docs/development.md](docs/development.md) test directory listings.

## [0.13.2] - 2026-04-03

### Added
- Added opt-in experimental skill learning in [src/commands.ts](src/commands.ts) so Atlas can draft custom skill files, scan them, and optionally import them as disabled skills.
- Added [src/core/skillDrafting.ts](src/core/skillDrafting.ts) with helper logic for skill-id suggestion, prompt construction, and generated-code extraction.
- Added [tests/core/skillDrafting.test.ts](tests/core/skillDrafting.test.ts) covering draft helper behavior.

### Changed
- Updated [src/views/settingsPanel.ts](src/views/settingsPanel.ts) and [package.json](package.json) with an explicit `atlasmind.experimentalSkillLearningEnabled` toggle and warning flow.
- Updated README and skill documentation to explain the token-usage and safety posture of Atlas-generated skills.

## [0.13.1] - 2026-04-03

### Added
- Added [src/core/taskProfiler.ts](src/core/taskProfiler.ts) to infer request phase, modality, reasoning intensity, and capability needs before routing.
- Added routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts) for vision gating, cheap-mode gating, and fast-mode gating.
- Added [tests/core/taskProfiler.test.ts](tests/core/taskProfiler.test.ts) covering mixed-modality inference, tool-use capability inference, and planning-phase reasoning.

### Changed
- Updated [src/core/modelRouter.ts](src/core/modelRouter.ts) so budget and speed act as hard routing gates before scoring, with task-profile-aware scoring afterward.
- Updated [src/core/orchestrator.ts](src/core/orchestrator.ts) and [src/core/planner.ts](src/core/planner.ts) to build task profiles for execution, planning, and synthesis.
- Updated README and architecture docs to reflect task-profile-aware routing.

## [0.13.0] - 2026-04-03

### Added
- Added local embeddings-backed retrieval in [src/memory/memoryManager.ts](src/memory/memoryManager.ts) with hashed vector indexing and cosine similarity ranking, covered by [tests/memory/memoryManager.test.ts](tests/memory/memoryManager.test.ts).
- Added built-in git-backed patch application skill in [src/skills/gitApplyPatch.ts](src/skills/gitApplyPatch.ts), wired through `SkillExecutionContext.applyGitPatch()`, covered by [tests/skills/gitApplyPatch.test.ts](tests/skills/gitApplyPatch.test.ts).
- Added routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts) for required-capability filtering and unhealthy-provider exclusion.

### Changed
- Upgraded [src/core/modelRouter.ts](src/core/modelRouter.ts) to be capability-aware and provider-health-aware.
- Updated [src/core/orchestrator.ts](src/core/orchestrator.ts) to request `function_calling` models automatically when agent skills are available.
- Added Anthropic tool-call parity in [src/providers/anthropic.ts](src/providers/anthropic.ts) so tool-use messages and tool results round-trip through the orchestrator loop.
- Updated README and docs to reflect fully implemented feature coverage across routing, memory, agent execution, and git-backed patching.

## [0.12.1] - 2026-04-03

### Added
- Added [SECURITY.md](SECURITY.md) with supported versions, private vulnerability reporting guidance, scope, and response goals.

### Changed
- Upgraded `vitest` and `@vitest/coverage-v8` to `4.1.2` to remediate the moderate Dependabot/npm audit advisory chain affecting `vitest`, `vite`, and `esbuild` in the development toolchain.
- Updated [README.md](README.md), [docs/development.md](docs/development.md), and [CONTRIBUTING.md](CONTRIBUTING.md) to point security disclosures to the repository security policy.

## [0.12.0] - 2026-04-03

### Added
- Added operator toggle support in [src/views/agentManagerPanel.ts](src/views/agentManagerPanel.ts): users can enable or disable registered agents directly from **AtlasMind: Manage Agents**.
- Added disabled-agent persistence in `globalState` (`atlasmind.disabledAgentIds`) and restore on activation in [src/extension.ts](src/extension.ts).
- Added orchestrator tests in [tests/core/orchestrator.tools.test.ts](tests/core/orchestrator.tools.test.ts) covering relevance-based agent selection and disabled-agent exclusion.

### Changed
- [src/core/agentRegistry.ts](src/core/agentRegistry.ts) now tracks enabled/disabled agent state with helper methods (`enable`, `disable`, `isEnabled`, `listEnabledAgents`).
- [src/core/orchestrator.ts](src/core/orchestrator.ts) now selects from enabled agents only and ranks candidates by request overlap with role/description/skills instead of picking the first registered agent.

## [0.11.1] - 2026-04-03

### Added
- Added orchestrator resilience tests in [tests/core/orchestrator.tools.test.ts](tests/core/orchestrator.tools.test.ts) for transient provider retry recovery and budget-cap termination.

### Changed
- Hardened [src/core/orchestrator.ts](src/core/orchestrator.ts) with bounded provider retries and request timeout handling for model completion calls.
- Added runtime budget cap enforcement in the agentic loop using cumulative token-based cost estimation (`TaskRequest.constraints.maxCostUsd` and `AgentDefinition.costLimitUsd`).
- Added safety limits for tool execution: max tool calls per turn, bounded parallel tool execution, and per-tool timeout handling.
- Agentic loop now returns an explicit termination response when the iteration safety cap is reached.
- Cost estimation now uses cumulative token usage across all model turns in a task, improving per-task cost accuracy.

## [0.10.3] - 2026-04-03

### Added
- Added webhook lifecycle emission coverage tests in [tests/core/orchestrator.tools.test.ts](tests/core/orchestrator.tools.test.ts) for `tool.started`, `tool.completed`, and `tool.failed` events.

### Changed
- Tool Webhooks panel now validates endpoint format and blocks non-HTTP(S) URLs before saving.
- Quality gate and packaging smoke path re-verified after webhook hardening changes.

## [0.10.2] - 2026-04-03

### Added
- Added [.vscodeignore](.vscodeignore) to reduce VSIX scope by excluding non-runtime project assets.
- Added [LICENSE](LICENSE) so packaging emits a standard bundled license file.

### Changed
- Added repository metadata to [package.json](package.json) to fix packaging base URL resolution.
- Packaging smoke-test now runs successfully via `npx @vscode/vsce package` without repository/license blockers.

## [0.10.1] - 2026-04-03

### Added
- **Webhook dispatcher tests** in [tests/core/toolWebhookDispatcher.test.ts](tests/core/toolWebhookDispatcher.test.ts) covering sensitive data redaction and preview truncation behavior.

### Changed
- `ToolWebhookDispatcher` delivery now retries transient failures with bounded backoff (`429` and `5xx`, up to 3 attempts) before final failure recording.
- Webhook preview helpers now redact sensitive values (`apiKey`, `token`, `password`, `secret`, bearer values, known token formats) before outbound payload emission.
- Fixed two lint issues in [src/memory/memoryScanner.ts](src/memory/memoryScanner.ts) so the full local quality gate is clean.

## [0.10.0] - 2026-04-03

### Added
- **Tool Webhooks panel** (`AtlasMind: Tool Webhooks`) for configuring webhook URL, event filters, timeout, bearer token, delivery testing, and recent delivery history.
- **Tool webhook dispatcher** (`src/core/toolWebhookDispatcher.ts`) with workspace-configurable event filtering, timeout handling, SecretStorage bearer token support, and globalState delivery history.
- **Tool lifecycle webhook events** from orchestrator tool execution loop:
  - `tool.started`
  - `tool.completed`
  - `tool.failed`
  - `tool.test` (manual test dispatch from panel)

### Changed
- `Orchestrator` now emits structured webhook payloads for each tool call lifecycle state (including task/agent/model context, duration, and preview fields).
- Added new workspace settings for webhook behavior:
  - `atlasmind.toolWebhookEnabled`
  - `atlasmind.toolWebhookUrl`
  - `atlasmind.toolWebhookTimeoutMs`
  - `atlasmind.toolWebhookEvents`

## [0.9.2] - 2026-04-03

### Added
- **Dynamic provider model discovery** at extension startup and via the Model Providers panel refresh action.
- **Adapter-driven catalog sync** that merges `listModels()` results into `ModelRouter`, preserving known curated metadata and inferring safe defaults for newly discovered models.
- **OpenAI-compatible `/models` discovery** in `OpenAiCompatibleAdapter` so OpenAI, Gemini-compatible endpoint, DeepSeek, Mistral, and z.ai can expose all currently available models.
- **Anthropic `/v1/models` discovery** with resilient fallback to curated defaults.

### Changed
- `@atlas` freeform and `/project` flows no longer force `preferredProvider: 'copilot'`; routing now evaluates all enabled providers unless explicitly constrained.
- Model Providers panel **Refresh Model Metadata** button now triggers a real catalog refresh and reports updated provider/model counts.

## [0.9.1] - 2026-04-03

### Added
- **z.ai (GLM) provider** — new `'zai'` provider ID with models GLM-4.7 Flash (free), GLM-4.7, and GLM-5.
  Uses the z.ai OpenAI-compatible endpoint (`https://api.z.ai/api/paas/v4`).
- **OpenAI provider** — GPT-4o mini and GPT-4o models now fully wired with adapter.
- **DeepSeek provider** — DeepSeek V3 (`deepseek-chat`) and DeepSeek R1 (`deepseek-reasoner`) models.
- **Mistral provider** — Mistral Small and Mistral Large models.
- **Google Gemini provider** — Gemini 2.0 Flash and Gemini 1.5 Pro via Google AI Studio's
  OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai`).
- **`OpenAiCompatibleAdapter`** (`src/providers/openai-compatible.ts`) — generic adapter for any
  OpenAI-compatible chat completion API. Supports tool calling, retry-after logic, and
  per-provider base URL / secret key configuration. Shared by all five new providers.
- **Model Provider panel** now lists z.ai alongside all existing providers.

### Changed
- `ProviderId` union in `src/types.ts` extended with `'zai'`.
- `requiresApiKey()` in the model provider panel now also excludes `'local'` (shows a
  dedicated message instead of an API key prompt for local LLMs).
- All 5 previously stub-only providers (openai, google, mistral, deepseek) now have
  working adapters and pre-populated model catalogs.

## [0.9.0] - 2026-04-03

### Added
- **Execution failure banner with rollback guidance** — when one or more subtasks fail,
  `/project` now shows a clear post-run banner listing the failed subtask titles, the
  number of files modified before the failure, and a *View Source Control* action button
  so users can quickly review and revert partial changes.
- **Outcome-driven follow-up chips** — `buildFollowups()` now accepts an optional
  `ProjectRunOutcome` context object and returns different chips based on run outcome:
  - Failures → *Retry the project* + *Diagnose failures*
  - Changed files (no failures) → *Add tests*
  - No changes / no outcome → original default chips
- **`ProjectRunOutcome` interface** exported from `src/chat/participant.ts` for
  downstream consumers and tests.
- **7 new participant helper tests** (17 total in `tests/chat/participant.helpers.test.ts`):
  - Outcome-driven followups: failure, changed-files, default, and no-outcome paths
  - Empty changed-file summary returns all-zero counts
  - Approval-threshold gating (10-subtask run exceeds default threshold)
  - No-op run stays within default threshold (2 subtasks)

### Changed
- `handleChatRequest` propagates `ProjectRunOutcome` through `ChatResult.metadata`
  so the follow-up provider receives structured run outcome rather than just the
  command name.
- Failed subtask titles are tracked live in `onProgress` and surfaced both in the
  failure banner and in `ProjectRunOutcome.failedSubtaskTitles`.

## [0.8.1] - 2026-04-03

### Added
- **Settings panel support for `/project` controls**.
  - AtlasMind Settings now exposes project execution UI controls directly in the webview panel:
    - approval threshold (files)
    - estimated files per subtask multiplier
    - changed-file reference limit
    - run summary report folder
  - Input values are validated client-side and server-side before being persisted to workspace settings.

### Changed
- Settings panel is no longer limited to budget/speed modes; it now provides first-class configuration for project execution behavior.

## [0.8.0] - 2026-04-03

### Added
- **Project run summary export** for `/project` executions.
  - Atlas now writes a JSON report to the configured report folder (default: `project_memory/operations`) containing goal, duration, cost, subtask outcomes, changed files, and per-file attribution traces.
  - Chat responses include a clickable reference and an "Open Run Summary" action button when report export succeeds.
- New configuration setting: `atlasmind.projectRunReportFolder`.

### Changed
- `/project` changed-file reporting now tracks per-subtask attribution traces and persists them in the exported run summary.

## [0.7.3] - 2026-04-03

### Added
- **Configurable project UI thresholds** for `/project` runs.
  - `atlasmind.projectApprovalFileThreshold` controls when `--approve` is required.
  - `atlasmind.projectEstimatedFilesPerSubtask` controls the preview heuristic for estimated file impact.
  - `atlasmind.projectChangedFileReferenceLimit` controls how many changed files are emitted as clickable references.

### Changed
- Workspace impact reporting now attributes file changes per completed subtask instead of only showing cumulative drift from the project start.

## [0.7.2] - 2026-04-03

### Added
- **Live workspace impact tracking** for `/project` runs.
  - Atlas now snapshots the workspace before execution starts, then reports how many files have actually changed as subtasks complete.
  - The final project report includes a changed-file summary broken down by `created`, `modified`, and `deleted` files.
  - Up to 5 changed files are surfaced as clickable references in the chat response.

## [0.7.1] - 2026-04-03

### Added
- **Follow-up suggestions** for the `@atlas` chat participant. After each response, VS Code displays contextual follow-up chips relevant to the command that just ran:
  - `/bootstrap` → view agents, view skills, query memory, start a project
  - `/agents` → skills, run a project, how to add an agent
  - `/skills` → agents, how to add a skill, run a project
  - `/memory` → search architecture/decisions, start a project from memory
  - `/cost` → which agents ran, tips to reduce cost
  - `/project` → review cost, save plan to memory, run another project
  - Freeform → turn into a project, search memory, check cost
- `handleChatRequest` now returns `vscode.ChatResult` with `metadata.command` so the `followupProvider` can distinguish which slash command produced the response.

## [0.7.0] - 2026-04-03

### Added
- **Parallel multi-agent project execution** — users can now ask Atlas to tackle a complex goal autonomously via the new `/project` slash command.
  - `src/core/planner.ts`: `Planner` class sends a structured JSON decomposition prompt to the LLM and returns a `ProjectPlan` — a DAG of `SubTask` nodes, each with an id, title, description, role, skill IDs, and `dependsOn` edges. Includes JSON fence extraction, per-field validation, and Kahn's cycle-removal algorithm so malformed LLM output can never produce an infinite loop.
  - `src/core/taskScheduler.ts`: `TaskScheduler` class topologically sorts the DAG into execution batches (Kahn's BFS), runs each batch with `Promise.all`, caps fan-out at `MAX_CONCURRENCY = 5`, and forwards completed task output as dependency context to downstream tasks. Fires a typed `SchedulerProgress` callback after every subtask.
  - `Orchestrator.processProject(goal, constraints, onProgress?)` — orchestrates the full flow: plan → parallel execution via ephemeral role-based sub-agents → LLM synthesis → `ProjectResult`. Sub-agents are synthesised from `SubTask.role` (one of: architect, backend-engineer, frontend-engineer, tester, documentation-writer, devops, data-engineer, security-reviewer, general-assistant) and never touch the `AgentRegistry`.
  - `Orchestrator.processTaskWithAgent(request, agent)` — new public method extracted from `processTask`; allows the executor to bypass agent selection and use any `AgentDefinition` directly.
  - Parallel tool calls in `runAgenticLoop`: the sequential `for...of` loop over `toolCalls` is replaced with `Promise.all`, so multiple skills in a single model turn now execute concurrently.
- New types in `src/types.ts`: `SubTask`, `SubTaskStatus`, `SubTaskResult`, `ProjectPlan`, `ProjectResult`, `ProjectProgressUpdate` (discriminated union: `planned | subtask-start | subtask-done | synthesizing | error`).
- `/project` chat slash command in `@atlas` participant — streams `planned` (markdown task table), per-task progress and output, and the final synthesised report.
- 12 new unit tests in `tests/core/planner.scheduler.test.ts` covering `removeCycles`, `buildExecutionBatches`, and `TaskScheduler` (dependency forwarding, progress callbacks, failure handling).

### Changed
- `Orchestrator.processTask` refactored to delegate to `processTaskWithAgent` — no behaviour change for existing callers.

## [0.6.0] - 2026-04-03

### Added
- **MCP Integration** — AtlasMind can now connect to any [Model Context Protocol](https://modelcontextprotocol.io/) server and expose its tools as AtlasMind skills.
  - `src/mcp/mcpClient.ts`: wraps `@modelcontextprotocol/sdk` `Client`; handles stdio (subprocess) and HTTP (Streamable HTTP with SSE fallback) transports; exposes `connect()`, `disconnect()`, `callTool()`, `refreshTools()`, and live `status`/`error`/`tools` state.
  - `src/mcp/mcpServerRegistry.ts`: persists server configurations in `globalState`; creates and manages `McpClient` instances; registers discovered tools as `SkillDefinition` objects in the `SkillsRegistry` with deterministic IDs (`mcp:<serverId>:<toolName>`); auto-approves MCP skills (user explicitly added the server = implicit trust); disables skills on disconnect and unregisters them on server removal.
  - `src/views/mcpPanel.ts`: webview panel with server list (connection status dot), per-server tool explorer, add-server form (transport toggle between stdio and HTTP), reconnect, enable/disable, and remove actions. All user input is HTML-escaped and all incoming messages are validated before acting.
- `McpServerConfig`, `McpConnectionStatus`, `McpToolInfo`, `McpServerState` types added to `src/types.ts`.
- `mcpServerRegistry: McpServerRegistry` added to `AtlasMindContext` in `src/extension.ts`; connected servers auto-reconnect on activation; disposed cleanly on deactivation.
- `atlasmind.openMcpServers` command (icon: `$(plug)`) opens the MCP panel.
- **MCP Servers** tree view added to AtlasMind sidebar.
- Runtime dependencies: `@modelcontextprotocol/sdk ^1.29.0`, `zod ^4.3.6`.
- 27 new unit tests in `tests/mcp/` (57 passing total).

## [0.5.1] - 2026-04-03

### Added
- **Memory Scanner** (`src/memory/memoryScanner.ts`): scans every SSOT document for prompt-injection patterns and credential leakage before it reaches model context.
  - 10 rules across three categories: instruction-override phrases (`pi-ignore-instructions`, `pi-disregard-instructions`, `pi-forget-instructions`, `pi-new-instructions`, `pi-system-prompt-override`, `pi-jailbreak`), persona/obfuscation red flags (`pi-act-as`, `pi-zero-width`, `pi-html-comment`), and credential leakage (`secret-api-key`, `secret-token`, `secret-password`). Also checks for oversized documents (`size-limit`).
  - `blocked` status (error-level hits) removes the entry from `queryRelevant` entirely — it is never sent to the model.
  - `warned` status (warning-level hits) keeps the entry in context but appends a `[SECURITY WARNING]` notice to the system prompt so the model applies extra scepticism.
- `MemoryScanIssue` and `MemoryScanResult` types added to `src/types.ts`.
- `MemoryManager` now scans all entries on `loadFromDisk` and on `upsert` (when content is provided); exposes `getScanResults()`, `getWarnedEntries()`, `getBlockedEntries()`.
- `Orchestrator.buildMessages()` appends a security notice when any loaded memory entries are warned or blocked.
- 12 new unit tests in `tests/memory/memoryScanner.test.ts` (30 passing total).

## [0.5.0] - 2026-04-03

### Added
- **Skills panel security scanning**: each skill shows a status icon (not scanned / passed / failed) and a rich tooltip with full description, enabled state, parameter list, scan status, and per-issue details (line, snippet, rule, message).
- **Per-skill enable/disable toggle**: skills can be individually enabled or disabled from the tree view via inline eye icon; state persists across sessions in `globalState`.
- **Security gate**: `SkillsRegistry.enable()` rejects skills whose scan found error-level issues, preventing unsafe code from running.
- **Skill security scanner** (`src/core/skillScanner.ts`): 12 built-in rules covering `eval`, `new Function`, `child_process`, shell execution, `process.env`, outbound fetch/HTTP, path traversal, direct `fs` access, and hardcoded secrets.
- **Scanner rule configurator** (`src/views/skillScannerPanel.ts`): webview panel listing all effective rules with per-rule toggle, severity and message editing, custom rule add/delete, and built-in rule reset. Built-in rule patterns are read-only to preserve security integrity.
- **`ScannerRulesManager`** (`src/core/scannerRulesManager.ts`): persists rule overrides and custom rules to `globalState`; validates regex patterns before accepting any change.
- **Add skill workflow** (`atlasmind.skills.addSkill`): create a template `.js` skill file in the workspace or import an existing compiled `.js` file; security scan runs before import is accepted; skill starts disabled pending review.
- **Scan details output channel** (`atlasmind.skills.showScanResults`): shows per-issue details (line, rule, snippet, message) in a dedicated VS Code output channel.
- Built-in skills marked `builtIn: true`; auto-approved on extension activation without requiring a manual scan.
- New commands: `atlasmind.skills.toggleEnabled`, `atlasmind.skills.scan`, `atlasmind.skills.addSkill`, `atlasmind.skills.showScanResults`, `atlasmind.openScannerRules`.
- Inline tree-view buttons for scan (shield) and toggle (eye) on every skill item.
- Skills view title-bar buttons: add skill (`+`) and configure scanner (gear).
- `SerializedScanRule`, `ScannerRulesConfig`, `SkillScanIssue`, `SkillScanResult`, `SkillScanStatus` types added to `src/types.ts`.
- `source?` and `builtIn?` fields added to `SkillDefinition`.
- `ScannerRulesManager` and `skillsRefresh` emitter added to `AtlasMindContext`.

### Changed
- `SkillsTreeProvider` fully rewritten with `SkillTreeItem` exposing `skillId`, rich `MarkdownString` tooltip, state-aware `ThemeIcon`, and `contextValue` (`skill-{builtin|custom}-{enabled|disabled}`) for when-clause menu targeting.
- `webviewUtils.ts` `WebviewShellOptions` extended with optional `extraCss` field.

## [0.3.0] - 2026-04-03

### Added
- Added extension-wide governance scaffolding support to bootstrap flow for any target project (`.github` templates, CI baseline, CODEOWNERS, and `.vscode/extensions.json`).

### Changed
- Updated chat `/bootstrap` command to execute real bootstrap flow instead of returning a placeholder response.

## [0.2.0] - 2026-04-03

### Added
- Added baseline unit tests for `ModelRouter` and `CostTracker` using Vitest.
- Added CI workflow at `.github/workflows/ci.yml` to run compile, lint, tests, and coverage on pushes and pull requests to `master`.
- Added GitHub governance templates: `.github/pull_request_template.md`, issue templates, and `.github/CODEOWNERS`.
- Added team extension recommendations in `.vscode/extensions.json`.

### Changed
- Added test scripts (`test`, `test:watch`, `test:coverage`) and testing dependencies in `package.json`.
- Added ESLint configuration with TypeScript support in `.eslintrc.cjs`.
- Updated documentation for testing workflow, CI quality gates, and branch/PR/issue governance expectations.

## [0.1.0] - 2026-04-03

### Added
- Added `ProviderRegistry` and a `local` fallback adapter (`local/echo-1`) to enable an executable end-to-end path without external SDK dependencies.
- Registered default provider metadata and default agent at activation.
- Added an Anthropic provider adapter (`src/providers/anthropic.ts`) with SecretStorage key lookup and retry handling for rate limits and transient server errors.
- Added a GitHub Copilot provider adapter (`src/providers/copilot.ts`) using VS Code's Language Model API.

### Changed
- Replaced orchestrator stub flow with an MVP pipeline: agent selection, memory query, model routing, provider dispatch, and cost recording.
- Implemented model routing scoring based on budget/speed/quality heuristics over enabled provider models.
- Implemented disk-backed SSOT indexing and ranked keyword retrieval in `MemoryManager`.
- Wired freeform `@atlas` chat messages through the orchestrator and implemented `/memory` query output.
- Updated memory sidebar view to display indexed SSOT entries.
- Updated cost calculation to use per-model pricing metadata and provider-reported token usage.
- Updated chat routing defaults to prefer the Copilot provider when available.

## [0.0.2] - 2026-04-03

### Changed
- Hardened webview security by replacing inline handlers with nonce-protected scripts and stricter CSP rules.
- Validated all webview messages before accepting configuration changes or provider actions.
- Moved provider credential handling to VS Code SecretStorage instead of placeholder UI-only flows.
- Made project bootstrapping safer by rejecting unsafe SSOT paths and by creating only missing files and folders.
- Updated project documentation and Copilot instructions to enforce a safety-first and security-first development model.

## [0.0.1] - 2026-04-03

### Added
- Extension scaffolding with `package.json` manifest and TypeScript build.
- Chat participant `@atlas` with slash commands: `/bootstrap`, `/agents`, `/skills`, `/memory`, `/cost`.
- Sidebar tree views: Agents, Skills, Memory (SSOT), Models.
- Webview panels: Model Provider management, Settings (budget/speed sliders).
- Core architecture stubs: Orchestrator, AgentRegistry, SkillsRegistry, ModelRouter, CostTracker.
- Memory manager stub with SSOT folder definitions.
- Project bootstrapper: Git init prompt, SSOT folder creation, project type selection.
- Provider adapter interface (`ProviderAdapter`) for normalised LLM access.
- Shared type definitions (`types.ts`): agents, skills, models, routing, cost tracking.
- Activity bar icon and sidebar container.
- Full documentation set: README, CHANGELOG, CONTRIBUTING, architecture guides.
- Copilot instruction set (`.github/copilot-instructions.md`) for documentation maintenance.
