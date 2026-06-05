# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.67.1] - 2026-06-05

### Fixed
- **Provider credentials now trigger an immediate model refresh**: Saving API-key-backed provider credentials now forces `refreshProviderModels(true)` before the health refresh, so the Models sidebar and router immediately pick up the provider's full discovered catalog instead of staying on fallback seed models until a later refresh.
- **Auto-paused provider alerts are now dismissible without re-enabling providers**: AtlasMind now tracks a session-scoped dismiss action for auto-paused provider notifications, exposes a `Dismiss Provider Notifications` command in the Models view, and clears the sidebar badge while keeping the affected providers disabled.

## [0.67.0] - 2026-06-05

### Fixed
- **Project runs no longer hang indefinitely**: `runProjectCommand` now derives an `AbortController` from VS Code's `CancellationToken` and passes the resulting `AbortSignal` down through `processProject`, `executeSubTask`, the agentic loop, and the synthesizer. Cancelling the chat request (or any provider call timing out via the signal) now terminates the whole project pipeline instead of freezing silently. The planner's `plan()` call also receives the signal, so even the planning phase is interruptible.
- **Project runs no longer plan twice**: The preview plan built before the approval gate was discarded and the orchestrator immediately re-planned inside `processProject`. The preview is now passed as `planOverride`, cutting the redundant LLM call and eliminating the duplicate plan table in the chat panel.
- **Cancellation shows a clear message**: Aborting a project run mid-flight now shows "_Project run cancelled._" instead of swallowing the error silently.
- **Project runs report real token counts**: `synthesize()` now returns `{ content, inputTokens, outputTokens }` and each `SubTaskResult` carries `inputTokens` and `outputTokens` from the underlying `TaskResult`. `processProject` aggregates these into `ProjectResult.totalInputTokens` / `totalOutputTokens`, which are shown in the chat footer (e.g. `12,540 in / 3,210 out`) and stored in the session transcript via `recordTurn()`.
- **Session transcript now includes project turns**: `runProjectCommand` was the only major handler that never called `recordTurn()`. It now records the goal and synthesis with full cost/token metadata so follow-up context and session history work correctly.

### Added
- **Built-in workspace tools for project subtask agents** (`file-read`, `file-write`, `file-edit`, `file-search`, `memory-query`, `memory-write`, `test-run`, `terminal-run`, `workspace-observability`): The planner already assigned these skill IDs to subtasks but the corresponding `Sk
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-05T02:57:32.667Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: eceebca3
body-fingerprint: 8ec13e9c
-->
