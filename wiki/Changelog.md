# Changelog

This page highlights major releases. For the complete changelog, see [CHANGELOG.md](https://github.com/JoelBondoux/AtlasMind/blob/master/CHANGELOG.md) in the repository.

**Note:** Every commit (not just PRs) must include a version bump in `package.json` and a matching `CHANGELOG.md` entry. This applies to all code, doc, and config changes. The version bump and changelog update must be in the same commit as the change.

---

## v0.67.7 — Cross-Session Bleeding Fix

- **Simultaneous chat sessions no longer bleed into each other**: When the sidebar Chat View and the detached Chat Panel were both running prompts concurrently, each session's streaming responses were appearing in the other. The fix ensures each concurrent run gets its own isolated session and eliminates spurious syncState cascades caused by redundant `selectSession` events.

## v0.67.6 — Self-Managing SSOT Memory

- **"Project memory needs update" banner removed**: The Memory sidebar no longer shows a manual-review warning when imported entries go stale. The MemoryManager now auto-runs the import pipeline silently on activation and SSOT reload. The `Update Project Memory` command remains available on-demand from the command palette and view toolbars.

## v0.67.1 — Provider Refresh And Notification Acknowledgement

- **Immediate post-credential model discovery**: Saving API-key-backed provider credentials now forces a provider model refresh before the health pass, so the Models sidebar and router immediately show the provider's discovered catalog instead of waiting for a later refresh.
- **Dismissible auto-paused provider badge**: The Models view now exposes a dismiss action for auto-paused provider notifications. Acknowledging the badge clears the session warning state but leaves the affected providers disabled until the user re-enables them explicitly.

## v0.63.0 — AI Instructions Sync

- **AI Instructions page in Settings**: Scan the workspace for instruction files from GitHub Copilot, Claude Code, Cursor, Cline, Continue, OpenAI Codex, Gemini CLI, Windsurf, Aider, and more. Found files appear with a content preview and checkboxes. Confirming the selection merges chosen sets into `project_memory/domain/ai-instructions-sync.md` for automatic context inclusion.

## v0.62.0 — Dynamic Agent Routing Overhaul

- **`primaryRoutingNeeds`** field on `AgentDefinition`: every built-in specialist now self-declares its domain. The orchestrator gives these declarations +25 pts per matched need (LLM) or +15 pts (regex), making them the dominant selection signal.
- **`fromLlm`** flag on `ClassificationResult`: the classifier now reports whether its output came from an LLM call or the regex fallback, enabling trust-weighted routing need scoring.
- **`scoreAgent()` fixed**: system prompt tokens are no longer included in the base score. The UX Consultant's large prompt was causing it to win on almost every technical query.
- **Routing need corpus narrowed**: pattern matching against agent header only (role, description, skills); system prompt excluded to prevent false positive boosts.
- **`architecture` agentPattern tightened**: removed generic terms `design`, `structure`, `systems` that were causing UX Consultant to incorrectly receive an architecture routing need boost.

## v0.67.0 — Project Run Reliability & File-Writing Agents

- **Project runs no longer hang**: `AbortSignal` from VS Code's `CancellationToken` is now threaded through the full pipeline (planner → subtask execution → synthesizer). Cancellation terminates the pipeline immediately and shows a clear "_Project run cancelled._" message.
- **No more double-planning**: The preview plan is reused as `planOverride` inside `processProject`, eliminating the redundant second LLM call and the duplicate plan table.
- **Real token counts in project footers**: `synthesize()` and every `SubTaskResult` now track `inputTokens`/`outputTokens`. The chat footer shows `N in / M out` and the session transcript is written via `recordTurn()` so follow-up context works.
- **Subtask agents can now edit files**: Nine built-in workspace tools (`file-read`, `file-write`, `file-edit`, `file-search`, `memory-query`, `memory-write`, `test-run`, `terminal-run`, `workspace-observability`) are registered on Orchestrator startup. These are the exact IDs the planner assigns to subtasks, so agents now actually write code to disk instead of printing it as chat text.

## Unreleased

- Added a background SSOT memory self-healing loop that runs during activation and while the workspace remains open, so warned and blocked memory entries can be remediated automatically.
- Updated dedicated chat-panel tool activity to render inside the inner-monologue surface with latest-first display by default and a collapsible history for earlier updates.
- Memory self-healing now quarantines blocked SSOT entries into `temp/quarantine/*.blocked.txt.bak`, replaces blocked files with safe placeholders, sanitizes warned entries (hidden Unicode, suspicious instruction-like comments, secret-like values), and reindexes memory automatically.

## v0.61.4 — Agent Skills Auto-Management Refresh

- Expanded the agent skills auto-management experience and supporting runtime behavior.
- Refreshed related tests, docs, and SSOT memory snapshots so the shipped documentation matches the current implementation.

## v0.61.3 — Documentation Sync Guardrail

- Restored the README source-version banner so it matches `package.json` again
- Added a regression test that enforces the changelog title and README version banner so both docs stay in sync
- Tightened the release/docs guidance so README and mirror documentation are updated together when versioned changes land

## v0.57.10 - SSOT Sessions Folder Documentation Alignment

- Documented the internal `project_memory/sessions/` folder in SSOT structure docs and clarified it stores per-session chat context.
- Clarified that `sessions/` is intentionally excluded from normal SSOT retrieval/index operations to keep ephemeral runtime context separate from durable project memory.

## v0.57.9 — Release Metadata Sync

- Added deterministic SSOT auto-linking between sibling artifacts in paired folders (`decisions/ <-> roadmap/`, `architecture/ <-> operations/`) during memory indexing and upserts.
- Capped `relatedPaths` density and re-applied auto-linking on upserts so new sibling artifacts become discoverable through one-hop expansion immediately.

## v0.57.8 - Memory Relationship Overlay and One-Hop Retrieval

- Added optional `MemoryEntry.relatedPaths` links so SSOT entries can declare explicit neighbor artifacts.
- Added bounded one-hop neighbor expansion in `MemoryManager.queryRelevant()` and `queryWithOptions()` when result slots remain.
- Brought `NodeMemoryManager` behavior in line with VS Code host memory retrieval for related-path parsing and one-hop expansion.
- Fixed memory import trailer parsing for optional `related-paths` metadata.

## v0.57.7 - Chat Tool Execution Rendering and Changelog Integrity Fixes

- Removed duplicated nested busy/status handlers in `media/chatPanel.js` that caused unstable history rendering.
- Replaced regex-based `[TOOL_EXEC]` parsing with brace-depth JSON extraction for nested tool metadata reliability.
- Removed duplicated `recoveryNotice` template markup and repaired tool-history CSS block placement in `src/views/chatPanel.ts`.
- Repaired malformed and duplicated `0.57.3`/`0.57.4` changelog sections from prior edits.

## v0.57.2 ÔÇö Version bump

- **Copilot quota hard-stop fixed**: `"exhausted your premium model quota"` errors are now recognised as billing failures, triggering provider auto-pause and graceful failover instead of a hard error.
- **`review` no longer escalates to Opus**: Removed bare `review` from `HIGH_REASONING_HINTS`; `code review` is still treated as high-reasoning. Lightweight reads like "review the roadmap" now route to a cheap/fast model.

## v0.57.1 - Copilot Quota Failover and Routing Over-Escalation Fix

- **Copilot quota hard-stop fixed**: `"exhausted your premium model quota"` errors are now recognised as billing failures, triggering provider auto-pause and graceful failover instead of a hard error.
- **`review` no longer escalates to Opus**: Removed bare `review` from `HIGH_REASONING_HINTS`; `code review` is still treated as high-reasoning. Lightweight reads like "review the roadmap" now route to a cheap/fast model.

## v0.57.0 ÔÇö ClassifierService: LLM-Backed Routing, Domain Detection, and UI Command Routing

- **`ClassifierService`**: New service (`src/core/classifierService.ts`) that runs a single batched LLM call per request ÔÇö cheap/local-first via the `completeMaintenance` path ÔÇö answering all routing questions at once: specialist domain, routing needs, modality, reasoning depth, workspace bias, and UI command. Replaces ~50 per-request regex tests. Degrades gracefully to regex fallback when no model is available.
- **`Orchestrator.classify()`**: Public method that exposes classification to participant.ts and other extension-layer callers without duplicating construction.
- **`resolveSpecialistRoutingPlanWithClassifier()`**: Async variant of specialist routing in `participant.ts` that replaces 6 domain regex patterns and the 20-entry `NATURAL_LANGUAGE_COMMAND_INTENTS` array with a single classifier call. Falls back to sync regex on failure.
- **Context-aware downstream routing**: `selectAgent`, `buildMessages`, and `TaskProfiler.profileTask` all read the `__classification` result from context instead of re-running regex, ensuring one call per request.

## v0.56.0 ÔÇö Universal Prompt Decomposition, Multi-Step Execution, and Robust Error Recovery

- **Universal prompt decomposition**: All freeform chat prompts are now classified for multi-action intent using a fast cheap LLM (via `completeMaintenance`). When two or more distinct separable actions are detected, AtlasMind decomposes the prompt into a Planner DAG and executes each step with streaming progress ÔÇö no `/project` command required.
- **`processTaskMultiStep`**: New orchestrator method that decomposes, schedules, and streams subtask results incrementally, falling back to a single-step plan on planner failure.
- **Robust error recovery**: All chat modes (freeform, native chat, vision) now retry once with a simplified prompt on failure, then surface actionable feedback (credits, network, no model) instead of raw exceptions.
- **Subtask auto-retry**: `executeSubTask` retries on transient provider errors and empty/capped responses before marking a step failed.

## v0.53.7 ÔÇö Dev Tooling Upgrade

- vitest 2ÔåÆ4, eslint 9ÔåÆ10, TypeScript 5ÔåÆ6 ÔÇö all 890 tests pass, zero lint warnings.
- Token count formatting pinned to `en-US` locale for consistent CI output across all platforms.

## v0.53.6 ÔÇö Live Local Model Sync

- New `src/providers/localModelSync.ts` queries Ollama and LM Studio on activation, extracting real context windows, parameter counts, and quantisation from the live API. Results cached with 1-hour TTL and applied as highest-priority metadata.
- Local provider pricing always forced to zero in `inferModelMetadata` ÔÇö no more cloud pricing heuristics leaking into local models.

## v0.53.5 ÔÇö Local Model Static Catalog

- `LOCAL_CATALOG` added to `modelCatalog.ts` covering 30+ common Ollama model families (Gemma 3, Nemotron, Devstral, Mistral, Qwen 2.5/3, Llama 3, Phi, DeepSeek R1 distills, Codestral, Command R). All entries have zero pricing and accurate capability flags.
- `inferCapabilities` updated so small local models don't get `function_calling` by default.

## v0.53.4 ÔÇö Local Model Routing Fixes

- `scoreLocalPreference` replaced with capability-gated graduated bonus (max +0.4), eliminating over-preference for weak local models.
- `classifySpeedTier` now returns `'balanced'` for local models so they are not excluded from `speed: 'considered'` routing.
- `shouldPreferLocalToolCapableModelForPrompt` tightened: threshold 8 ÔåÆ 5 words, complexity verbs and scope words now suppress local-first routing.

## v0.53.3 ÔÇö Failover And Agent Prompt

- `selectProviderFailoverModel` rewritten to step through budget/speed tiers incrementally rather than immediately jumping to expensive/considered.
- `DEFAULT_AGENT_SYSTEM_PROMPT` now names specific files per change type rather than giving vague release-hygiene guidance.

## v0.53.2 ÔÇö Documentation Matrix Fixes

- `CLAUDE.md` and `.github/copilot-instructions.md` doc matrix now includes `docs/configuration.md` for settings changes and `README.md (version banner)` for version bumps.
- Architecture docs updated for CurrencyFormatter, CopilotMultiplierSync, LocalModelSync.

## v0.52.9 ÔÇö Changelog Guardrail

- Restored the missing CHANGELOG title and intro block so release notes keep their expected structure
- Added an automated regression check and authoring guidance so future edits preserve the heading

## v0.52.9 ÔÇö Release Hygiene And Merge Reliability

- Restored the changelog heading guardrails and kept the protected merge gate stable across integration auditing, default-agent fallback behavior, and cross-platform verification
- Atlas also preserves the recent paste-handling and tool-failure recovery improvements included in this release line

## v0.52.6 ÔÇö Integration Audit Restore

- Restored the missing integration-monitor manifest so the protected CI release gate can validate extension, provider, and specialist coverage again

## v0.52.5 ÔÇö CI Release Cleanup

- Cleared the release-blocking lint issues across the command, environment, chat, dashboard, and testing surfaces so the protected master promotion flow can pass cleanly

## v0.52.4 ÔÇö Intent Routing And Release Hygiene

- Tightened Atlas chat intent handling so prompts about missing version or changelog updates stay on the corrective workspace-action path instead of collapsing into a simple version reply
- Hard-coded release-hygiene guidance into the default agent prompt so version bumps, changelog updates, and related docs are treated as part of completing the work when repo policy requires them

## v0.52.3 ÔÇö Search And Stop Reliability

- Repaired the search jump helpers so previous and next arrows can move through results reliably again
- Wired prompt cancellation through the active chat execution path so Stop can interrupt answer generation more reliably

## v0.52.2 ÔÇö Search Centering And Jump Fix

- Active search results now center themselves in the transcript and outline the containing bubble for clearer orientation
- Previous and next arrows now produce a stronger visual jump between matches

## v0.52.1 ÔÇö Session Search Recovery

- Repaired the in-thread search path so Search no longer stalls on a perpetual running message
- Kept multi-result navigation responsive with visible arrows and active highlight movement inside the transcript


## v0.51.9 ÔÇö Live Gap Analysis Chat Sessions

- Gap Analysis now opens a fresh Atlas chat session and reports progress there while it works
- The completed checklist is saved back into the Project Dashboard automatically

## v0.51.9 ÔÇö Search Navigation And Count Fix

- Session search now counts matches from the visible rendered transcript so totals align with what the operator sees
- Added previous and next result arrows beside Search for direct in-thread navigation across multiple matches

## v0.52.0 ÔÇö Prioritized Gap Analysis Reports

- Gap Analysis now produces a richer project report with grouped P1, P2, and P3 findings across architecture, safety, functionality, UI/UX, memory, code structure, testing, and delivery
- Each gap can now open its own live Atlas chat resolution session, and whole priority groups can be actioned at once

## v0.51.8 ÔÇö Instant Session Search Repair

- Session search now runs immediately against the current in-memory thread so small conversations respond instantly
- Restored match highlighting and transcript scrolling without getting stuck on a perpetual searching state

## v0.51.7 ÔÇö Session Search Feedback Fix

- Pressing Search in the chat panel now immediately shows a running status and a clear found-or-not-found result message
- Reconnected the search toggle to the live webview controls so session search mode behaves reliably

## v0.51.6 ÔÇö Chat Bubble Delete Refresh

- Replaced the header X delete control with a minimalist footer trash icon beside the chat vote actions for a cleaner transcript layout
- Preserved in-thread message deletion while reducing visual clutter in each bubble

## v0.51.7 ÔÇö Live Gap Analysis Sessions

- Gap Analysis now opens a fresh Atlas chat session and reports progress there while it works
- The completed checklist is written back into the Project Dashboard automatically

## v0.51.6 ÔÇö Gap Analysis Trigger Feedback

- Gap Analysis now opens its dashboard page immediately and shows live progress while it runs
- Fixed the silent-looking trigger behavior from the Project Dashboard

## v0.51.5 ÔÇö Project Dashboard Recovery

- Restored the Project Dashboard after the new Gap Analysis work injected broken panel and webview code that stopped the dashboard from opening
- Safely reconnected the Gap Analysis page, actions, and snapshot parsing so the dashboard loads again

## v0.49.37 ÔÇö Chat Focus Guard

- Guarded automatic Atlas chat composer focus restoration so transcript refreshes no longer steal the editor cursor after the user clicks back into another VS Code surface

## v0.49.36 ÔÇö Testing Policy Card

- Added a dedicated Testing policy highlight card to the Project Dashboard beside the framework and coverage stats
- Added an optional workspace override label so teams can show their own tests-first wording without changing AtlasMind's verification safeguards

## v0.49.36 ÔÇö In-Chat Generated Skill Review

- Warning-level generated-skill reviews now appear in the AtlasMind in-chat approval stack instead of a separate modal flow
- The approval card now shows the warning context and a focused one-time Allow Once versus Keep Blocked choice

## v0.49.35 ÔÇö Generated Skill Review Gate

- Auto-generated skills that hit warning-level scanner findings now pause for explicit user approval before AtlasMind evaluates them in-process
- Added a review-first path so operators can inspect the draft and either allow it once or keep it blocked for refinement

## v0.49.34 ÔÇö Project Dashboard Testing Explorer

- Moved the main testing inventory into the Project Dashboard so test health is shown alongside runtime, delivery, and SSOT signals
- Added searchable and category-grouped per-test browsing with a jump dropdown plus a detail inspector that opens the relevant source file at the right line

## v0.49.33 ÔÇö MCP Intent Heuristics And Memory Recall

- AtlasMind now derives natural-language routing cues for third-party MCP tools, biases tool selection toward the most likely match for prompts like ÔÇ£commitÔÇØ, and asks for clarification when multiple tools look similarly plausible
- Successful natural-language-to-MCP resolutions are now written into project memory so future turns can reuse that learned mapping

## v0.49.32 ÔÇö Keyboard Rename In Sessions

- Made F2 rename use the currently focused Sessions sidebar item so keyboard rename now works reliably for chat threads and session folders

## v0.49.31 ÔÇö Marketplace Badge Replacement

- Replaced the external README Marketplace badge with a plain version callout so the extension page no longer shows a broken or retired badge placeholder in VS Code surfaces

## v0.39.7 ÔÇö Immutable Guardrails Baseline

- Added a non-overrideable legal and human-respect baseline to built-in and routed AtlasMind agent prompts
- Restricted jurisdictionally ambiguous legal asks to safe high-level guidance and blocked person-targeted harmful, defamatory, or deceptive assistance in generated tools

## v0.39.6 ÔÇö Sidebar Default Order

- Reordered the default AtlasMind sidebar tree views to Project Runs, Sessions, Memory, Agents, Skills, MCP Servers, and Models
- Set those tree views to ship collapsed by default while keeping stable view ids so VS Code continues remembering each user's custom order and open-state preferences

## v0.39.6 ÔÇö Sidebar Quick Actions

- Added title-bar shortcuts for Settings, Project Dashboard, and Cost Dashboard across the Chat, Sessions, and Memory sidebar views
- Switched the project-memory toolbar action between `Import Existing Project` and `Update Project Memory` based on whether AtlasMind has detected workspace SSOT state

## v0.39.4 ÔÇö Command Naming Guardrails

- Hid the remaining unprefixed session actions from the Command Palette and added a manifest-level guard so unprefixed command titles stay view-local
- Split the README command reference into explicit Command Palette and Sidebar Actions sections

## v0.39.3 ÔÇö Command Surface Cleanup

- Hid sidebar-only actions from the Command Palette so palette-visible AtlasMind commands stay reserved for top-level entry points
- Split the command docs between palette-facing AtlasMind commands and view-local sidebar actions

## v0.39.2 ÔÇö Persistent Memory Drift Signal

- Added a pinned warning row at the top of the Memory tree so stale imported SSOT remains visible while browsing entries
- Treated legacy `#import` SSOT files without Atlas metadata trailers as stale imported memory so older projects also surface the refresh signal

## v0.39.2 ÔÇö Skills Panel Folders

- Grouped built-in skills into sidebar categories so the bundled set no longer expands as one flat list
- Added persistent custom skill folders, including a Skills title-bar `Create Skill Folder` action and folder-aware add/import flows
- Added `F2` rename support for highlighted chat-session rows in the Sessions sidebar

## v0.39.0 ÔÇö Filed Session Sidebar

- Added persistent folders to the Sessions sidebar so related chat threads can be filed together instead of staying in one flat list
- Added an inline rename action on each session row plus move-to-folder and create-folder commands in the Sessions tree
- Moved the optional `Import Existing Project` toolbar shortcut from the Sessions view to the Memory view

## v0.38.22 ÔÇö Cost Dashboard Visual Refresh

- Reworked the Cost Dashboard to share the Project Dashboard's stronger visual language with a cleaner shell, animated metric cards, a more professional budget meter, and upgraded model and feedback panels
- Replaced the old checkbox and numeric day input with a topbar visibility toggle and chart-overlay time-range controls inside the Daily Spend panel
- Tightened summary-card layout so the primary spend metrics stay on one row instead of wrapping into a cluttered grid

## v0.38.21 ÔÇö Responsive Chat Sessions Rail

- Made the shared Atlas chat Sessions area responsive so it remains a top strip in narrow layouts and becomes a persistent left sidebar when the webview reaches 1000px wide

## v0.38.20 ÔÇö Dashboard Settings Compatibility

- Fixed the Project Dashboard refresh path so array-backed `autoVerifyScripts` settings from AtlasMind Settings no longer break the dashboard security snapshot
- Added regression coverage for the dashboard configuration compatibility path

## v0.38.19 ÔÇö Inline Chat Feedback Controls

- Moved assistant-response vote controls onto the same footer row as the thinking summary and aligned them to the right edge of the bubble
- Replaced emoji-style thumbs with compact outlined thumb icons for a quieter chat UI

## v0.38.18 ÔÇö Feedback-Aware Cost Dashboard

- Added Cost Dashboard feedback analytics showing per-model approval rate, thumbs totals, and spend on rated models
- Added `atlasmind.feedbackRoutingWeight` so thumbs-based routing bias can be disabled or tuned without clearing vote history
- Updated recent-request rows to show the recorded feedback state for each linked assistant response

## v0.38.17 ÔÇö Chat Session Header Fit

- Tightened the shared Atlas chat Sessions header so the new-session control stays inline with the label and no longer pushes the collapsible bar partly out of view

## v0.38.16 ÔÇö Cost To Chat Deep Links

- Added session-aware links from Cost Dashboard recent-request rows back to the matching chat transcript entry when the session still exists
- Stored optional chat session and message references with cost records so AtlasMind can reopen the exact assistant response that produced a charge

## v0.38.14 ÔÇö Memory Freshness Signals

- Added startup SSOT freshness checks for imported workspaces so AtlasMind can warn when generated memory has drifted behind the codebase
- Added an `Update Project Memory` Memory-view action that reruns the import pipeline against the latest workspace state
- Fixed import body fingerprint normalization so unchanged generated files are not treated as manually edited or permanently stale on later refreshes

## v0.38.13 ÔÇö Cost Dashboard Polishing

- Sent the Cost Dashboard budget shortcut to Settings ÔåÆ Overview with a budget-focused query instead of reopening the last active settings page
- Clarified the recent-requests table so the final column is explicitly the per-message request cost

## v0.38.11 ÔÇö Dashboard Reliability And Access

- Fixed the Project Dashboard loading path so git timeline collection no longer stalls the panel and failures render a visible error state instead of hanging on the loading screen
- Added a direct Project Dashboard action to the AtlasMind sidebar chat view title bar
- Restored clean TypeScript compilation after the project-memory bootstrap refactor left import-scan metadata incomplete

## v0.38.10 ÔÇö Subscription-Aware Cost Tracking

- Added subscription-aware cost accounting so only direct and overflow-billed requests count toward the daily budget while included subscription usage remains visible for analysis
- Upgraded the Cost Dashboard with adjustable day windows, an exclude-subscriptions toggle, and explicit per-request billing labels

## v0.38.7 ÔÇö Runtime Extensibility And Project Dashboard

- Added an explicit shared-runtime plugin API with lifecycle events and plugin contribution manifests for extension-host and CLI integrations
- Added the AtlasMind Project Dashboard surface with interactive pages for repo health, runtime state, SSOT coverage, security posture, delivery workflow, and review-readiness signals
- Hardened CLI argument parsing and expanded the architecture, development, contribution, and wiki guidance for runtime extensibility, diagnostics, and operational review

## v0.38.6 ÔÇö Final Observability Sync

- Synced the `v0.38.x` roadmap branch with the newly merged workspace-observability base changes so the terminal-reader, extensions/Ports, cost dashboard, and ElevenLabs work remains mergeable on top of the latest `develop` head

## v0.38.5 ÔÇö Final Roadmap Branch Sync

- Synced the `v0.38.x` roadmap branch with the latest `develop` EXA search, workspace observability, and settings-documentation updates while preserving the terminal-reader, extensions/Ports, cost dashboard, and ElevenLabs feature work

## v0.38.4 ÔÇö Settings Docs Sync

- Synced the `v0.38.x` roadmap branch with the latest `develop` settings-documentation updates so it stays mergeable on top of the new configuration hover-help work

## v0.38.3 ÔÇö Roadmap Branch Re-Sync

- Synced the `v0.38.0` roadmap-completion branch with the latest `develop` observability changes while preserving its terminal-reader, extension, Ports, dashboard, and ElevenLabs feature work

## v0.38.2 ÔÇö CI Workflow Repair

- Removed duplicate `if` keys from the CI workflow coverage steps so the `v0.38.x` roadmap branch can execute GitHub Actions normally again after the develop sync

## v0.38.1 ÔÇö Roadmap Branch Sync

- Synced the `v0.38.0` roadmap-completion branch with the latest `develop` fixes so the extension-skill, terminal-reader, Ports, cost dashboard, and ElevenLabs work remains mergeable on top of the newer review-cleanup and lint-gate repairs

## v0.38.0 ÔÇö Roadmap Goals Resolved

- **Terminal session readers** ÔÇö new `terminal-read` skill and `getTerminalOutput()` context method; informs AtlasMind which terminals are open and guides the user to paste content.
- **Test result file parsing** ÔÇö `workspace-state` skill now parses JUnit XML and Vitest/Jest JSON result files and includes pass/fail counts and coverage percentages in the workspace snapshot.
- **VS Code Extensions skill** (`vscode-extensions`) ÔÇö lists installed extensions with version and active state, tags top-50 popular extensions, filters by name, and reports forwarded ports from the VS Code Ports panel.
- **Cost Management Dashboard** (`atlasmind.openCostDashboard`) ÔÇö full-page webview with daily spend bar chart, per-model cost breakdown, budget utilisation bar, and recent-requests table.
- **ElevenLabs TTS integration** ÔÇö Voice Panel now uses ElevenLabs server-side audio synthesis when an API key is configured; falls back to Web Speech API.

## v0.37.4 ÔÇö Workspace Observability

- Added the `workspace-observability` built-in skill plus the supporting debug-session, terminal, and test-result host hooks with safe CLI fallbacks
- Hardened the observability path so missing host hooks degrade safely and test-result output remains bounded

## v0.37.3 ÔÇö Settings Docs Sync

- Synced the `v0.37.x` feature branch with the latest `develop` settings-documentation updates so the EXA search, observability, and CLI subcommand work stays mergeable on top of the new configuration hover-help changes

## v0.37.2 ÔÇö EXA And Observability Branch Sync

- Synced the `v0.37.0` feature branch with the latest `develop` fixes so the EXA search, observability, and CLI subcommand work stays mergeable on top of the newer review-cleanup and lint-gate repairs

## v0.37.0 ÔÇö Observability, EXA Search & CLI Dev Subcommands

- EXA AI search specialist runtime (`exa-search` skill)
- Debug session inspector skill (`debug-session`)
- Workspace state skill (`workspace-state`)
- CLI `build`, `lint`, and `test` subcommands with `--dry-run`, `--fix`, and `--watch` flags
- Amazon Bedrock model catalog expanded with 16 additional entries

## v0.36.26 ÔÇö Lint Gate Repair

- Replaced non-reassigned `let` declarations in the orchestrator task-attempt path so `develop` passes the current lint gate again

## v0.36.25 ÔÇö Review Cleanup Follow-up

- Removed the duplicate Tool Webhooks command entry from the wiki command reference and normalized provider registry indentation to the repo's standard TypeScript style

## v0.36.24 ÔÇö Review Follow-up Fixes

- Repaired the Project Run Center webview string assembly so its preview, run summary, and artifact views no longer generate invalid JavaScript
- Restored a nonce-only script policy for shared webviews, fixed broken CLI wiki links, and normalized the duplicated `v0.36.4` changelog history

## v0.36.23 ÔÇö Workspace Observability Compatibility Fix

- Added safe CLI fallback implementations for workspace observability context methods so the shared `SkillExecutionContext` contract is satisfied outside the VS Code host
- Adjusted workspace observability test-results access so the extension compiles cleanly even when the typed VS Code API surface does not expose a stable `testResults` property

## v0.36.22 ÔÇö Workspace Observability Skill

- Added `workspace-observability` built-in skill: snapshots the active debug session, open integrated terminals, and most recent test run results in one call
- Added `getTestResults()`, `getActiveDebugSession()`, and `listTerminals()` to `SkillExecutionContext`, backed by `vscode.tests`, `vscode.debug`, and `vscode.window.terminals`

## v0.36.21 ÔÇö Extension Interoperability Roadmap

- Expanded the roadmap to cover interoperability with the top 50 commonly used VS Code developer extensions, their interface surfaces such as Output and Terminal, Ports view support, and explicit safety boundaries for extension interaction

## v0.36.20 ÔÇö CI Artifact Upload Fix

- Restricted CI coverage generation and coverage artifact upload to the Ubuntu matrix leg, preventing duplicate artifact-name conflicts while preserving compile, lint, and test coverage across Ubuntu, Windows, and macOS
- Updated the developer-facing docs to reflect the actual CI matrix behavior and Ubuntu-only coverage artifact publishing path

## v0.36.19 ÔÇö CI Repair Follow-up

- Fixed the lint and TypeScript issues that were blocking CI on the protected develop-to-master promotion path

## v0.36.18 ÔÇö Observability Roadmap Additions

- Added roadmap items for workspace observability, debug-session integration, and safe output or terminal readers so AtlasMind can eventually reason over more of the active VS Code environment

## v0.36.17 ÔÇö Workstation-Aware Responses

- AtlasMind now includes workstation context in routed prompts so responses can default to the active environment, including Windows and PowerShell guidance inside VS Code when appropriate
- Added regression coverage for workstation-aware prompt context in native chat and orchestrator message building

## v0.36.16 ÔÇö Provider Failover

- AtlasMind now fails over to another eligible provider when the initially selected provider errors or is missing, instead of ending the task immediately on the first provider failure
- Added orchestrator regression coverage for cross-provider failover after provider-side errors

## v0.36.15 ÔÇö OpenAI Fixed-Temperature Compatibility

- OpenAI modern chat payloads now omit `temperature` for fixed-temperature model families such as GPT-5 and the `o`-series, preventing request failures on models that reject that parameter
- Added regression coverage to keep OpenAI modern, Azure OpenAI, and generic compatible providers on the correct parameter contract

## v0.36.14 ÔÇö Early Difficulty Escalation

- AtlasMind now detects repeated tool-loop struggle signals and can reroute once to a stronger reasoning-capable model instead of spending the full loop budget on a failing route
- Added regression coverage for bounded mid-task model escalation after repeated failed tool calls

## v0.36.13 ÔÇö Grounded Version Answers

- AtlasMind now answers version questions from the root `package.json` manifest instead of depending on model inference
- If the manifest is unavailable, AtlasMind falls back to SSOT memory so repo-fact answers still come from grounded project context

## v0.36.12 ÔÇö Provider-Specific OpenAI Compatibility

- Split OpenAI-family payload handling by provider so OpenAI and Azure use `developer` plus `max_completion_tokens`, while generic OpenAI-compatible endpoints retain `system` plus `max_tokens`
- Added regression tests to lock the expected contract for OpenAI, Azure OpenAI, and third-party OpenAI-compatible providers

## v0.36.11 ÔÇö OpenAI-Compatible Token Parameter Fix

- Updated OpenAI-compatible request payloads to send `max_completion_tokens` instead of `max_tokens`, resolving 400 errors from models that reject the legacy parameter
- Added regression coverage to verify AtlasMind no longer emits `max_tokens` in OpenAI-style chat completion requests

## v0.36.10 ÔÇö Terminal Tool Schema Validation Fix

- Fixed the built-in `terminal-run` tool schema so `args` is declared as an array of strings, resolving chat failures from OpenAI function schema validation
- Added a regression test to keep the terminal tool schema compatible with function-calling providers

## v0.36.6 ÔÇö CLI Safety Gate And Narrower SSOT Auto-Load

- AtlasMind CLI now allows read-only tools by default, requires an explicit `--allow-writes` flag before workspace or git writes are permitted, and blocks external high-risk tools in CLI mode
- Startup SSOT auto-load now trusts only the configured SSOT path or the default `project_memory/` folder instead of treating workspace-root marker folders as sufficient
- Added regression tests covering CLI tool gating and the tightened startup SSOT detection boundary

## v0.36.5 ÔÇö Import Freshness And Memory Purge Safeguards

- `/import` now records generator metadata, skips unchanged generated files on repeat imports, and preserves imported SSOT files that were manually edited
- AtlasMind now generates both `index/import-catalog.md` and `index/import-freshness.md` so memory refresh status stays reviewable
- The Project Settings page now exposes a destructive memory-purge action protected by a modal confirmation plus a required `PURGE MEMORY` confirmation phrase

## v0.36.4 ÔÇö MCP, Voice, And Vision Workspaces

- Reworked the MCP Servers, Voice, and Vision panels into the same searchable multi-page workspace pattern used by AtlasMind Settings and the other admin surfaces
- Added richer sidebar empty-state links so sessions, models, agents, MCP, and project runs can jump directly to the matching panel or settings page

## v0.36.3 ÔÇö Richer Project Import Baseline

- Expanded `/import` so it generates a deeper SSOT baseline from manifests, docs, workflow/security guidance, and a focused codebase map
- Import now upgrades the starter `project_soul.md` template when it is still blank so Atlas begins with a more useful project identity

## v0.36.2 ÔÇö Deep-Linked Panel Workspaces

- Reworked the Agent Manager and Tool Webhooks panels into searchable multi-page workspaces consistent with AtlasMind Settings and the provider surfaces
- Added page-specific settings commands so sidebar actions and walkthrough steps can open the exact chat, models, safety, or project settings page directly

## v0.36.1 ÔÇö Searchable Provider Workspaces

- Reworked the Model Providers and Specialist Integrations panels into searchable multi-page workspaces with grouped cards instead of single dense tables
- Added deep-linkable AtlasMind Settings navigation so provider surfaces can reopen Settings directly on the Models page

## v0.36.0 ÔÇö Shared Runtime And CLI

- Added a compiled `atlasmind` CLI with `chat`, `project`, `memory`, and `providers` commands backed by the same orchestrator and SSOT memory pipeline as the extension
- Introduced a shared runtime builder plus Node-hosted memory, cost, and skill-context adapters so AtlasMind can run outside the VS Code host without forking core logic

## v0.35.15 ÔÇö Accessible Settings Workspace

- Reworked AtlasMind Settings into a multi-page workspace with a persistent section nav instead of a long collapsible form
- Added faster in-panel shortcuts to the embedded Chat view, detached chat panel, provider management, and specialist integrations

## v0.35.12 ÔÇö Startup SSOT Auto-Load

- AtlasMind now auto-detects and loads an existing workspace SSOT during startup when the configured `atlasmind.ssotPath` is missing
- The Memory sidebar now refreshes immediately after startup indexing so existing project memory appears without a manual reload

## v0.35.5 ÔÇö Models Tree Refresh Action

- Added a refresh action on configured provider rows in the Models sidebar so routed model catalogs can be refreshed directly where missing models are noticed

## v0.35.4 ÔÇö Follow-Up Routing Escalation Fix

- Adjusted routing so important thread-based follow-up turns can escalate away from weak local models instead of being dominated by zero-cost local scoring
- Updated the task profiler and router scoring so high-stakes conversation follow-ups can favor stronger reasoning-capable models when appropriate

## v0.35.3 ÔÇö Memory Sidebar Edit And Review Actions

- Added inline edit and review actions to Memory sidebar entries so SSOT files can be opened directly or summarized before editing

## v0.35.2 ÔÇö Get Started Chat Shortcut Fix

- Added a working `Ctrl+Alt+I` (`Cmd+Alt+I` on macOS) shortcut for `AtlasMind: Open Chat Panel`
- Updated the Get Started walkthrough chat buttons to open the AtlasMind chat panel directly

## v0.35.1 ÔÇö Sidebar Settings Shortcut And Optional Import Action

- Added an AtlasMind Settings entry to the overflow menu of AtlasMind sidebar views so the settings panel can be opened directly from the panel itself
- Added an optional Import Existing Project toolbar action to the Sessions view, with a new `atlasmind.showImportProjectAction` setting to hide it when not wanted

## v0.35.0 ÔÇö Session Workspace And Sessions Sidebar

- Upgraded the dedicated AtlasMind chat panel into a session workspace with persistent workspace chat threads and a session rail
- Added a Sessions sidebar view that lists chat sessions and autonomous runs together, with direct handoff into the Project Run Center for live run steering

## v0.34.2 ÔÇö Deferred Copilot Permission Prompt

- Deferred GitHub Copilot model discovery and health checks until explicit activation so AtlasMind no longer prompts for Copilot language-model access during normal startup

## v0.34.1 ÔÇö NVIDIA NIM Model Info Link Fix

- Corrected the NVIDIA NIM model info link so AtlasMind opens NVIDIA's model catalog instead of an unrelated API page

## v0.34.0 ÔÇö Dedicated AtlasMind Chat Panel

- Added a dedicated AtlasMind chat panel for users who want a standalone conversation UI instead of only the built-in VS Code Chat view
- Added a Settings shortcut and command-palette entry for opening the panel

## v0.33.1 ÔÇö Copilot Chat Recommendation Cleanup

- Updated the repo and bootstrap-generated VS Code extension recommendations to prefer `GitHub Copilot Chat` without also prompting for the separate `GitHub Copilot` recommendation

## v0.33.0 ÔÇö Azure OpenAI, Bedrock, And Specialist Integrations

- Added routed provider support for Azure OpenAI with deployment-based workspace configuration and `api-key` authentication
- Added routed provider support for Amazon Bedrock through a dedicated SigV4-signed adapter
- Added a Specialist Integrations panel for non-routing search, voice, image, and video vendors

## v0.32.10 ÔÇö Default Branch And Release Flow Hardening

- Switched the repository default branch to `develop`
- Locked `master` to the `develop` to `master` pre-release promotion flow
- Updated contributor and Copilot guidance to treat `develop` as the normal development push target

## v0.32.9 ÔÇö Branch Strategy Update

- Adopted `develop` for normal integration work and reserved `master` for release-ready pre-release publishing
- Updated CI to validate both `develop` and `master`
- Updated contributing guidance and Copilot instructions to avoid routine direct work on `master`
- Fixed local provider health reporting so the built-in echo fallback remains available even without a configured local endpoint

## v0.32.7 ÔÇö Mixed Provider Status Marker

- Added a bracketed warning marker for partially enabled providers in the Models sidebar while preserving the green enabled status icon

## v0.32.6 ÔÇö Models Status Icon Cleanup

- Replaced visible Models sidebar status text with colored status icons
- Sorted unconfigured providers to the bottom of the Models list

## v0.32.5 ÔÇö Configurable Local Provider

- Added a real configurable local provider path backed by `atlasmind.localOpenAiBaseUrl` and an optional SecretStorage API key
- Local provider setup can now be completed directly from the Models and Model Providers surfaces

## v0.32.4 ÔÇö Provider Configuration And Agent Assignment

- Added inline provider configure and assign-to-agent actions in the Models sidebar
- Added model-level assign-to-agent actions for quick `allowedModels` updates
- Hid child model rows for unconfigured providers until the provider is configured

## v0.32.3 ÔÇö Models Sidebar Controls

- Added inline enable/disable and info actions to provider and model rows in the Models sidebar
- Persisted provider/model availability choices so routing keeps honoring them after restarts and model catalog refreshes

## v0.32.2 ÔÇö Agent Restore Activation Fix

- Removed the activation-time dependency on the Agent Manager webview so persisted user agents can be restored without loading panel UI code during startup

## v0.32.1 ÔÇö Lazy Command Panel Loading

- Changed AtlasMind command handlers to lazy-load panel modules so panel-specific runtime issues cannot block command registration during activation

## v0.32.0 ÔÇö Getting Started Command

- Added `AtlasMind: Getting Started` so the onboarding walkthrough can be reopened directly from the Command Palette
- Carries forward the recent Agent, Skills, and MCP panel reliability fixes in the beta channel

## v0.31.4 ÔÇö Agent & Skills Panel Reliability Fixes

- Replaced CSP-blocked inline button handlers in the Manage Agents panel with explicit event bindings
- Restored the New Agent, edit, enable/disable, delete, save, and cancel actions
- Registered commands and tree views earlier in activation so Skills and MCP panel actions are available sooner
- Isolated startup registration failures so one broken surface cannot prevent command registration for the others

## v0.31.2 ÔÇö Walkthrough Activation Fix

- Activated AtlasMind on startup so getting-started walkthrough buttons are available immediately after install
- Added manifest regression tests covering the provider onboarding button wiring

## v0.31.1 ÔÇö Marketplace Beta Release

- Switched the extension icon from SVG to PNG for Marketplace compatibility
- Added the top-level extension icon field and updated the publisher to `JoelBondoux`
- Published the first live beta release to the VS Code Marketplace

## v0.30.5 ÔÇö README Cleanup

- Streamlined the README into a shorter overview and onboarding page
- Moved detailed inventories and reference material into deeper docs and wiki pages

## v0.30.4 ÔÇö CI Fixes And Wiki Refresh

- Fixed the lint issues that were failing CI and restored a passing coverage gate for the currently tested service-layer modules
- Clarified model-routing documentation around seed models, runtime catalog refresh, and metadata enrichment
- Added a funding and sponsorship wiki page and refreshed the wiki comparison content

## v0.30.3 ÔÇö Copilot Chat Recommendation Restored

- Restored `GitHub Copilot Chat` in extension recommendations for the repo and bootstrap templates
- Updated setup guidance and Copilot runtime wording to point users back to `GitHub Copilot Chat`

## v0.30.2 ÔÇö Copilot Dependency Cleanup

- Removed the deprecated `GitHub Copilot Chat` recommendation from the repo and bootstrap templates
- Updated setup guidance to point to the `GitHub Copilot` extension instead
- Renamed Copilot UI/error wording from `Copilot Chat` to `Copilot language model` / `Copilot Model`

## v0.30.1 ÔÇö Trust & Freshness Fixes

- **Real daily budget enforcement** ÔÇö `dailyCostLimitUsd` now blocks new requests once the cap is reached
- **Live provider health refresh** ÔÇö Status bar updates immediately after key save and model refresh
- **Run Center disk hydration** ÔÇö Project Run Center and project runs tree now consume async disk-backed history
- **Settings quick actions** ÔÇö Direct buttons for Chat, Model Providers, Project Run Center, Voice, and Vision
- **Budget control in Settings** ÔÇö `dailyCostLimitUsd` is now editable in the Settings panel

## v0.30.0 ÔÇö UX & Feature Overhaul

- **Getting Started walkthrough** ÔÇö Four-step guided onboarding for new users
- **API key health check** ÔÇö Immediate validation after storing a provider key
- **Collapsible settings panel** ÔÇö Grouped, collapsible sections replace the flat wall of options
- **Cost persistence and daily budget** ÔÇö Session costs persisted to globalState; `dailyCostLimitUsd` setting with 80%/100% alerts
- **Streaming for Anthropic + OpenAI** ÔÇö Full `streamComplete()` with SSE parsing and tool-call handling
- **Agent performance tracking** ÔÇö Success/failure tracking influences future agent selection
- **Cost estimation in plan preview** ÔÇö `/project` shows estimated $lowÔÇô$high cost before execution
- **Disk-based run history** ÔÇö Individual JSON files replace single-blob globalState storage
- **Diff preview in project report** ÔÇö File/status table and "Open Source Control" button in report
- **Multi-workspace folder support** ÔÇö Quick-pick when multiple folders are open
- **Per-subtask checkpoint rollback** ÔÇö Rollback by task ID instead of last-only
- **Memory tree pagination** ÔÇö Incremental loading with "Load moreÔÇª" instead of hard 200-entry cap
- **Provider health status bar** ÔÇö Shows how many providers have valid API keys
- **Expanded task profiler** ÔÇö 100+ new keywords for more accurate task classification
- **Integration test suite** ÔÇö Full orchestrator ÔåÆ agent ÔåÆ cost ÔåÆ performance lifecycle tests

## v0.29.0 ÔÇö Constants, Shared Validation & Zod

## v0.28.x ÔÇö Project Import & Stability

- **`/import` command** ÔÇö Scan existing workspaces and auto-populate SSOT memory from manifests, READMEs, configs, and license files
- **TypeScript fixes** ÔÇö Added `"types": ["node"]` to tsconfig for full Node.js global support
- **Documentation overhaul** ÔÇö Comprehensive README rewrite with logo, comparison table, and complete feature coverage

## v0.27.x ÔÇö Skills Gap Analysis & README

- **11 new skills** ÔÇö `code-symbols`, `rename-symbol`, `code-action`, `web-fetch`, `diff-preview`, `rollback-checkpoint`, `test-run`, `diagnostics`, `file-move`, `file-delete`, `git-branch`
- **README overhaul** ÔÇö Logo, competitor comparison table, comprehensive feature documentation

## v0.26.x ÔÇö MCP Integration

- **MCP client** ÔÇö Connect external tool servers via stdio or HTTP transport
- **MCP server registry** ÔÇö Persistent server configs with auto-reconnect
- **MCP tools as skills** ÔÇö External tools seamlessly appear in the skill registry

## v0.25.x ÔÇö Project Planner

- **`/project` command** ÔÇö Decompose goals into DAGs of subtasks
- **TaskScheduler** ÔÇö Topological sort into parallel batches
- **Ephemeral agents** ÔÇö Role-specific agents for each subtask
- **Project Run History** ÔÇö Persistent run records with the Run Center

## v0.24.x ÔÇö Skill Security Scanner

- **Static analysis** ÔÇö 12 built-in rules for custom skill validation
- **Scanner Rules Manager** ÔÇö Configure rules via webview panel
- **Pre-enablement gate** ÔÇö Custom skills must pass scanning before use

## v0.23.x ÔÇö Voice & Vision

- **Voice Panel** ÔÇö TTS and STT via Web Speech API
- **Vision Panel** ÔÇö Image picker for multimodal prompts
- **`/voice` and `/vision` commands**

## v0.22.x ÔÇö Tool Webhooks

- **Outbound webhooks** ÔÇö Forward tool lifecycle events to external HTTPS endpoints
- **Configurable events** ÔÇö tool.started, tool.completed, tool.failed
- **Webhook management panel**

## v0.21.x ÔÇö Cost Tracking & Budget Control

- **CostTracker** ÔÇö Per-session, per-provider cost accumulation
- **Budget modes** ÔÇö cheap, balanced, expensive, auto
- **Speed modes** ÔÇö fast, balanced, considered, auto
- **`/cost` command**

## v0.20.x ÔÇö Multi-Agent Orchestration

- **AgentRegistry** ÔÇö Custom agents with roles, prompts, and constraints
- **Agent selection** ÔÇö Token overlap scoring for best-fit selection
- **Agent Manager Panel** ÔÇö Create and configure agents via webview

## Earlier Releases

See [CHANGELOG.md](https://github.com/JoelBondoux/AtlasMind/blob/master/CHANGELOG.md) for the complete version history.
