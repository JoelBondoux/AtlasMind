# Changelog

This page highlights major releases. For the complete changelog, see [CHANGELOG.md](https://github.com/JoelBondoux/AtlasMind/blob/master/CHANGELOG.md) in the repository.

---

## v0.38.2 — CI Workflow Repair

- Removed duplicate `if` keys from the CI workflow coverage steps so the `v0.38.x` roadmap branch can execute GitHub Actions normally again after the develop sync

## v0.38.1 — Roadmap Branch Sync

- Synced the `v0.38.0` roadmap-completion branch with the latest `develop` fixes so the extension-skill, terminal-reader, Ports, cost dashboard, and ElevenLabs work remains mergeable on top of the newer review-cleanup and lint-gate repairs

## v0.38.0 — Roadmap Goals Resolved

- **Terminal session readers** — new `terminal-read` skill and `getTerminalOutput()` context method; informs AtlasMind which terminals are open and guides the user to paste content.
- **Test result file parsing** — `workspace-state` skill now parses JUnit XML and Vitest/Jest JSON result files and includes pass/fail counts and coverage percentages in the workspace snapshot.
- **VS Code Extensions skill** (`vscode-extensions`) — lists installed extensions with version and active state, tags top-50 popular extensions, filters by name, and reports forwarded ports from the VS Code Ports panel.
- **Cost Management Dashboard** (`atlasmind.openCostDashboard`) — full-page webview with daily spend bar chart, per-model cost breakdown, budget utilisation bar, and recent-requests table.
- **ElevenLabs TTS integration** — Voice Panel now uses ElevenLabs server-side audio synthesis when an API key is configured; falls back to Web Speech API.

## v0.37.0 — Observability, EXA Search & CLI Dev Subcommands

- EXA AI search specialist runtime (`exa-search` skill)
- Debug session inspector skill (`debug-session`)
- Workspace state skill (`workspace-state`)
- CLI `build`, `lint`, and `test` subcommands with `--dry-run`, `--fix`, and `--watch` flags
- Amazon Bedrock model catalog expanded with 16 additional entries

## v0.36.26 — Lint Gate Repair

- Replaced non-reassigned `let` declarations in the orchestrator task-attempt path so `develop` passes the current lint gate again

## v0.36.25 — Review Cleanup Follow-up

- Removed the duplicate Tool Webhooks command entry from the wiki command reference and normalized provider registry indentation to the repo's standard TypeScript style

## v0.36.24 — Review Follow-up Fixes

- Repaired the Project Run Center webview string assembly so its preview, run summary, and artifact views no longer generate invalid JavaScript
- Restored a nonce-only script policy for shared webviews, fixed broken CLI wiki links, and normalized the duplicated `v0.36.4` changelog history

## v0.36.21 — Extension Interoperability Roadmap

- Expanded the roadmap to cover interoperability with the top 50 commonly used VS Code developer extensions, their interface surfaces such as Output and Terminal, Ports view support, and explicit safety boundaries for extension interaction

## v0.36.20 — CI Artifact Upload Fix

- Restricted CI coverage generation and coverage artifact upload to the Ubuntu matrix leg, preventing duplicate artifact-name conflicts while preserving compile, lint, and test coverage across Ubuntu, Windows, and macOS
- Updated the developer-facing docs to reflect the actual CI matrix behavior and Ubuntu-only coverage artifact publishing path

## v0.36.19 — CI Repair Follow-up

- Fixed the lint and TypeScript issues that were blocking CI on the protected develop-to-master promotion path

## v0.36.18 — Observability Roadmap Additions

- Added roadmap items for workspace observability, debug-session integration, and safe output or terminal readers so AtlasMind can eventually reason over more of the active VS Code environment

## v0.36.17 — Workstation-Aware Responses

- AtlasMind now includes workstation context in routed prompts so responses can default to the active environment, including Windows and PowerShell guidance inside VS Code when appropriate
- Added regression coverage for workstation-aware prompt context in native chat and orchestrator message building

## v0.36.16 — Provider Failover

- AtlasMind now fails over to another eligible provider when the initially selected provider errors or is missing, instead of ending the task immediately on the first provider failure
- Added orchestrator regression coverage for cross-provider failover after provider-side errors

## v0.36.15 — OpenAI Fixed-Temperature Compatibility

- OpenAI modern chat payloads now omit `temperature` for fixed-temperature model families such as GPT-5 and the `o`-series, preventing request failures on models that reject that parameter
- Added regression coverage to keep OpenAI modern, Azure OpenAI, and generic compatible providers on the correct parameter contract

## v0.36.14 — Early Difficulty Escalation

- AtlasMind now detects repeated tool-loop struggle signals and can reroute once to a stronger reasoning-capable model instead of spending the full loop budget on a failing route
- Added regression coverage for bounded mid-task model escalation after repeated failed tool calls

## v0.36.13 — Grounded Version Answers

- AtlasMind now answers version questions from the root `package.json` manifest instead of depending on model inference
- If the manifest is unavailable, AtlasMind falls back to SSOT memory so repo-fact answers still come from grounded project context

## v0.36.12 — Provider-Specific OpenAI Compatibility

- Split OpenAI-family payload handling by provider so OpenAI and Azure use `developer` plus `max_completion_tokens`, while generic OpenAI-compatible endpoints retain `system` plus `max_tokens`
- Added regression tests to lock the expected contract for OpenAI, Azure OpenAI, and third-party OpenAI-compatible providers

## v0.36.11 — OpenAI-Compatible Token Parameter Fix

- Updated OpenAI-compatible request payloads to send `max_completion_tokens` instead of `max_tokens`, resolving 400 errors from models that reject the legacy parameter
- Added regression coverage to verify AtlasMind no longer emits `max_tokens` in OpenAI-style chat completion requests

## v0.36.10 — Terminal Tool Schema Validation Fix

- Fixed the built-in `terminal-run` tool schema so `args` is declared as an array of strings, resolving chat failures from OpenAI function schema validation
- Added a regression test to keep the terminal tool schema compatible with function-calling providers

## v0.36.6 — CLI Safety Gate And Narrower SSOT Auto-Load

- AtlasMind CLI now allows read-only tools by default, requires an explicit `--allow-writes` flag before workspace or git writes are permitted, and blocks external high-risk tools in CLI mode
- Startup SSOT auto-load now trusts only the configured SSOT path or the default `project_memory/` folder instead of treating workspace-root marker folders as sufficient
- Added regression tests covering CLI tool gating and the tightened startup SSOT detection boundary

## v0.36.5 — Import Freshness And Memory Purge Safeguards

- `/import` now records generator metadata, skips unchanged generated files on repeat imports, and preserves imported SSOT files that were manually edited
- AtlasMind now generates both `index/import-catalog.md` and `index/import-freshness.md` so memory refresh status stays reviewable
- The Project Settings page now exposes a destructive memory-purge action protected by a modal confirmation plus a required `PURGE MEMORY` confirmation phrase

## v0.36.4 — MCP, Voice, And Vision Workspaces

- Reworked the MCP Servers, Voice, and Vision panels into the same searchable multi-page workspace pattern used by AtlasMind Settings and the other admin surfaces
- Added richer sidebar empty-state links so sessions, models, agents, MCP, and project runs can jump directly to the matching panel or settings page

## v0.36.3 — Richer Project Import Baseline

- Expanded `/import` so it generates a deeper SSOT baseline from manifests, docs, workflow/security guidance, and a focused codebase map
- Import now upgrades the starter `project_soul.md` template when it is still blank so Atlas begins with a more useful project identity

## v0.36.2 — Deep-Linked Panel Workspaces

- Reworked the Agent Manager and Tool Webhooks panels into searchable multi-page workspaces consistent with AtlasMind Settings and the provider surfaces
- Added page-specific settings commands so sidebar actions and walkthrough steps can open the exact chat, models, safety, or project settings page directly

## v0.36.1 — Searchable Provider Workspaces

- Reworked the Model Providers and Specialist Integrations panels into searchable multi-page workspaces with grouped cards instead of single dense tables
- Added deep-linkable AtlasMind Settings navigation so provider surfaces can reopen Settings directly on the Models page

## v0.36.0 — Shared Runtime And CLI

- Added a compiled `atlasmind` CLI with `chat`, `project`, `memory`, and `providers` commands backed by the same orchestrator and SSOT memory pipeline as the extension
- Introduced a shared runtime builder plus Node-hosted memory, cost, and skill-context adapters so AtlasMind can run outside the VS Code host without forking core logic

## v0.35.15 — Accessible Settings Workspace

- Reworked AtlasMind Settings into a multi-page workspace with a persistent section nav instead of a long collapsible form
- Added faster in-panel shortcuts to the embedded Chat view, detached chat panel, provider management, and specialist integrations

## v0.35.12 — Startup SSOT Auto-Load

- AtlasMind now auto-detects and loads an existing workspace SSOT during startup when the configured `atlasmind.ssotPath` is missing
- The Memory sidebar now refreshes immediately after startup indexing so existing project memory appears without a manual reload

## v0.35.5 — Models Tree Refresh Action

- Added a refresh action on configured provider rows in the Models sidebar so routed model catalogs can be refreshed directly where missing models are noticed

## v0.35.4 — Follow-Up Routing Escalation Fix

- Adjusted routing so important thread-based follow-up turns can escalate away from weak local models instead of being dominated by zero-cost local scoring
- Updated the task profiler and router scoring so high-stakes conversation follow-ups can favor stronger reasoning-capable models when appropriate

## v0.35.3 — Memory Sidebar Edit And Review Actions

- Added inline edit and review actions to Memory sidebar entries so SSOT files can be opened directly or summarized before editing

## v0.35.2 — Get Started Chat Shortcut Fix

- Added a working `Ctrl+Alt+I` (`Cmd+Alt+I` on macOS) shortcut for `AtlasMind: Open Chat Panel`
- Updated the Get Started walkthrough chat buttons to open the AtlasMind chat panel directly

## v0.35.1 — Sidebar Settings Shortcut And Optional Import Action

- Added an AtlasMind Settings entry to the overflow menu of AtlasMind sidebar views so the settings panel can be opened directly from the panel itself
- Added an optional Import Existing Project toolbar action to the Sessions view, with a new `atlasmind.showImportProjectAction` setting to hide it when not wanted

## v0.35.0 — Session Workspace And Sessions Sidebar

- Upgraded the dedicated AtlasMind chat panel into a session workspace with persistent workspace chat threads and a session rail
- Added a Sessions sidebar view that lists chat sessions and autonomous runs together, with direct handoff into the Project Run Center for live run steering

## v0.34.2 — Deferred Copilot Permission Prompt

- Deferred GitHub Copilot model discovery and health checks until explicit activation so AtlasMind no longer prompts for Copilot language-model access during normal startup

## v0.34.1 — NVIDIA NIM Model Info Link Fix

- Corrected the NVIDIA NIM model info link so AtlasMind opens NVIDIA's model catalog instead of an unrelated API page

## v0.34.0 — Dedicated AtlasMind Chat Panel

- Added a dedicated AtlasMind chat panel for users who want a standalone conversation UI instead of only the built-in VS Code Chat view
- Added a Settings shortcut and command-palette entry for opening the panel

## v0.33.1 — Copilot Chat Recommendation Cleanup

- Updated the repo and bootstrap-generated VS Code extension recommendations to prefer `GitHub Copilot Chat` without also prompting for the separate `GitHub Copilot` recommendation

## v0.33.0 — Azure OpenAI, Bedrock, And Specialist Integrations

- Added routed provider support for Azure OpenAI with deployment-based workspace configuration and `api-key` authentication
- Added routed provider support for Amazon Bedrock through a dedicated SigV4-signed adapter
- Added a Specialist Integrations panel for non-routing search, voice, image, and video vendors

## v0.32.10 — Default Branch And Release Flow Hardening

- Switched the repository default branch to `develop`
- Locked `master` to the `develop` to `master` pre-release promotion flow
- Updated contributor and Copilot guidance to treat `develop` as the normal development push target

## v0.32.9 — Branch Strategy Update

- Adopted `develop` for normal integration work and reserved `master` for release-ready pre-release publishing
- Updated CI to validate both `develop` and `master`
- Updated contributing guidance and Copilot instructions to avoid routine direct work on `master`
- Fixed local provider health reporting so the built-in echo fallback remains available even without a configured local endpoint

## v0.32.7 — Mixed Provider Status Marker

- Added a bracketed warning marker for partially enabled providers in the Models sidebar while preserving the green enabled status icon

## v0.32.6 — Models Status Icon Cleanup

- Replaced visible Models sidebar status text with colored status icons
- Sorted unconfigured providers to the bottom of the Models list

## v0.32.5 — Configurable Local Provider

- Added a real configurable local provider path backed by `atlasmind.localOpenAiBaseUrl` and an optional SecretStorage API key
- Local provider setup can now be completed directly from the Models and Model Providers surfaces

## v0.32.4 — Provider Configuration And Agent Assignment

- Added inline provider configure and assign-to-agent actions in the Models sidebar
- Added model-level assign-to-agent actions for quick `allowedModels` updates
- Hid child model rows for unconfigured providers until the provider is configured

## v0.32.3 — Models Sidebar Controls

- Added inline enable/disable and info actions to provider and model rows in the Models sidebar
- Persisted provider/model availability choices so routing keeps honoring them after restarts and model catalog refreshes

## v0.32.2 — Agent Restore Activation Fix

- Removed the activation-time dependency on the Agent Manager webview so persisted user agents can be restored without loading panel UI code during startup

## v0.32.1 — Lazy Command Panel Loading

- Changed AtlasMind command handlers to lazy-load panel modules so panel-specific runtime issues cannot block command registration during activation

## v0.32.0 — Getting Started Command

- Added `AtlasMind: Getting Started` so the onboarding walkthrough can be reopened directly from the Command Palette
- Carries forward the recent Agent, Skills, and MCP panel reliability fixes in the beta channel

## v0.31.4 — Agent & Skills Panel Reliability Fixes

- Replaced CSP-blocked inline button handlers in the Manage Agents panel with explicit event bindings
- Restored the New Agent, edit, enable/disable, delete, save, and cancel actions
- Registered commands and tree views earlier in activation so Skills and MCP panel actions are available sooner
- Isolated startup registration failures so one broken surface cannot prevent command registration for the others

## v0.31.2 — Walkthrough Activation Fix

- Activated AtlasMind on startup so getting-started walkthrough buttons are available immediately after install
- Added manifest regression tests covering the provider onboarding button wiring

## v0.31.1 — Marketplace Beta Release

- Switched the extension icon from SVG to PNG for Marketplace compatibility
- Added the top-level extension icon field and updated the publisher to `JoelBondoux`
- Published the first live beta release to the VS Code Marketplace

## v0.30.5 — README Cleanup

- Streamlined the README into a shorter overview and onboarding page
- Moved detailed inventories and reference material into deeper docs and wiki pages

## v0.30.4 — CI Fixes And Wiki Refresh

- Fixed the lint issues that were failing CI and restored a passing coverage gate for the currently tested service-layer modules
- Clarified model-routing documentation around seed models, runtime catalog refresh, and metadata enrichment
- Added a funding and sponsorship wiki page and refreshed the wiki comparison content

## v0.30.3 — Copilot Chat Recommendation Restored

- Restored `GitHub Copilot Chat` in extension recommendations for the repo and bootstrap templates
- Updated setup guidance and Copilot runtime wording to point users back to `GitHub Copilot Chat`

## v0.30.2 — Copilot Dependency Cleanup

- Removed the deprecated `GitHub Copilot Chat` recommendation from the repo and bootstrap templates
- Updated setup guidance to point to the `GitHub Copilot` extension instead
- Renamed Copilot UI/error wording from `Copilot Chat` to `Copilot language model` / `Copilot Model`

## v0.30.1 — Trust & Freshness Fixes

- **Real daily budget enforcement** — `dailyCostLimitUsd` now blocks new requests once the cap is reached
- **Live provider health refresh** — Status bar updates immediately after key save and model refresh
- **Run Center disk hydration** — Project Run Center and project runs tree now consume async disk-backed history
- **Settings quick actions** — Direct buttons for Chat, Model Providers, Project Run Center, Voice, and Vision
- **Budget control in Settings** — `dailyCostLimitUsd` is now editable in the Settings panel

## v0.30.0 — UX & Feature Overhaul

- **Getting Started walkthrough** — Four-step guided onboarding for new users
- **API key health check** — Immediate validation after storing a provider key
- **Collapsible settings panel** — Grouped, collapsible sections replace the flat wall of options
- **Cost persistence and daily budget** — Session costs persisted to globalState; `dailyCostLimitUsd` setting with 80%/100% alerts
- **Streaming for Anthropic + OpenAI** — Full `streamComplete()` with SSE parsing and tool-call handling
- **Agent performance tracking** — Success/failure tracking influences future agent selection
- **Cost estimation in plan preview** — `/project` shows estimated $low–$high cost before execution
- **Disk-based run history** — Individual JSON files replace single-blob globalState storage
- **Diff preview in project report** — File/status table and "Open Source Control" button in report
- **Multi-workspace folder support** — Quick-pick when multiple folders are open
- **Per-subtask checkpoint rollback** — Rollback by task ID instead of last-only
- **Memory tree pagination** — Incremental loading with "Load more…" instead of hard 200-entry cap
- **Provider health status bar** — Shows how many providers have valid API keys
- **Expanded task profiler** — 100+ new keywords for more accurate task classification
- **Integration test suite** — Full orchestrator → agent → cost → performance lifecycle tests

## v0.29.0 — Constants, Shared Validation & Zod

## v0.28.x — Project Import & Stability

- **`/import` command** — Scan existing workspaces and auto-populate SSOT memory from manifests, READMEs, configs, and license files
- **TypeScript fixes** — Added `"types": ["node"]` to tsconfig for full Node.js global support
- **Documentation overhaul** — Comprehensive README rewrite with logo, comparison table, and complete feature coverage

## v0.27.x — Skills Gap Analysis & README

- **11 new skills** — `code-symbols`, `rename-symbol`, `code-action`, `web-fetch`, `diff-preview`, `rollback-checkpoint`, `test-run`, `diagnostics`, `file-move`, `file-delete`, `git-branch`
- **README overhaul** — Logo, competitor comparison table, comprehensive feature documentation

## v0.26.x — MCP Integration

- **MCP client** — Connect external tool servers via stdio or HTTP transport
- **MCP server registry** — Persistent server configs with auto-reconnect
- **MCP tools as skills** — External tools seamlessly appear in the skill registry

## v0.25.x — Project Planner

- **`/project` command** — Decompose goals into DAGs of subtasks
- **TaskScheduler** — Topological sort into parallel batches
- **Ephemeral agents** — Role-specific agents for each subtask
- **Project Run History** — Persistent run records with the Run Center

## v0.24.x — Skill Security Scanner

- **Static analysis** — 12 built-in rules for custom skill validation
- **Scanner Rules Manager** — Configure rules via webview panel
- **Pre-enablement gate** — Custom skills must pass scanning before use

## v0.23.x — Voice & Vision

- **Voice Panel** — TTS and STT via Web Speech API
- **Vision Panel** — Image picker for multimodal prompts
- **`/voice` and `/vision` commands**

## v0.22.x — Tool Webhooks

- **Outbound webhooks** — Forward tool lifecycle events to external HTTPS endpoints
- **Configurable events** — tool.started, tool.completed, tool.failed
- **Webhook management panel**

## v0.21.x — Cost Tracking & Budget Control

- **CostTracker** — Per-session, per-provider cost accumulation
- **Budget modes** — cheap, balanced, expensive, auto
- **Speed modes** — fast, balanced, considered, auto
- **`/cost` command**

## v0.20.x — Multi-Agent Orchestration

- **AgentRegistry** — Custom agents with roles, prompts, and constraints
- **Agent selection** — Token overlap scoring for best-fit selection
- **Agent Manager Panel** — Create and configure agents via webview

## Earlier Releases

See [CHANGELOG.md](https://github.com/JoelBondoux/AtlasMind/blob/master/CHANGELOG.md) for the complete version history.
