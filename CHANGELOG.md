# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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

## [0.8.1] - 2026-04-06

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

## [0.8.0] - 2026-04-06

### Added
- **Project run summary export** for `/project` executions.
  - Atlas now writes a JSON report to the configured report folder (default: `project_memory/operations`) containing goal, duration, cost, subtask outcomes, changed files, and per-file attribution traces.
  - Chat responses include a clickable reference and an "Open Run Summary" action button when report export succeeds.
- New configuration setting: `atlasmind.projectRunReportFolder`.

### Changed
- `/project` changed-file reporting now tracks per-subtask attribution traces and persists them in the exported run summary.

## [0.7.3] - 2026-04-06

### Added
- **Configurable project UI thresholds** for `/project` runs.
  - `atlasmind.projectApprovalFileThreshold` controls when `--approve` is required.
  - `atlasmind.projectEstimatedFilesPerSubtask` controls the preview heuristic for estimated file impact.
  - `atlasmind.projectChangedFileReferenceLimit` controls how many changed files are emitted as clickable references.

### Changed
- Workspace impact reporting now attributes file changes per completed subtask instead of only showing cumulative drift from the project start.

## [0.7.2] - 2026-04-06

### Added
- **Live workspace impact tracking** for `/project` runs.
  - Atlas now snapshots the workspace before execution starts, then reports how many files have actually changed as subtasks complete.
  - The final project report includes a changed-file summary broken down by `created`, `modified`, and `deleted` files.
  - Up to 5 changed files are surfaced as clickable references in the chat response.

## [0.7.1] - 2026-04-06

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

## [0.7.0] - 2026-04-06

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

## [0.6.0] - 2026-04-05

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

## [0.5.0] - 2026-04-04

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


### Added
- Added five built-in skills: `file-read`, `file-write`, `file-search`, `memory-query`, `memory-write` (`src/skills/`).
- Added `SkillExecutionContext` interface in `types.ts` for injectable workspace and memory access; skills are independently testable without VS Code.
- Added multi-turn agentic tool-call loop to `Orchestrator`: executes tool calls requested by the model and feeds results back until a final text response is returned, capped at 10 iterations.
- Added tool calling support to `CopilotAdapter` using VS Code LM API `LanguageModelToolCallPart` / `LanguageModelToolResultPart`.
- Added `ToolDefinition` and `ToolCall` types to the shared `ProviderAdapter` contract.
- Added `tests/__mocks__/vscode.ts` stub and updated `vitest.config.ts` to alias `vscode` so orchestrator unit tests run without a VS Code runtime.
- Added 13 new unit tests across skill and orchestrator test suites (18 passing total).

### Changed
- Updated `SkillDefinition` to replace `handler: string` and `toolSchema?` with `parameters` (JSON Schema) and an `execute` function.
- Updated `buildSkillExecutionContext()` in `extension.ts` to implement workspace FS operations with path-traversal guard on `writeFile`.
- Expanded coverage `include` in `vitest.config.ts` to cover `src/skills/**`.

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
