# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.79.2] - 2026-06-12

### Fixed
- **Autonomous run context continuity** (`src/core/orchestrator.ts`, `src/chat/participant.ts`, `src/views/chatPanel.ts`): preserved the loaded session context bundle for autonomous project subtasks so project runs keep the prior chat goal, summary, decisions, open threads, and SSOT excerpts instead of dropping back to a blank context frame.

### Added
- **Context compression toggle and savings reporting** (`src/core/orchestrator.ts`, `src/core/costTracker.ts`, `src/chat/participant.ts`, `src/views/costDashboardPanel.ts`, `package.json`, `src/types.ts`): added an opt-in `atlasmind.contextCompressionEnabled` setting, connected it to the existing compaction path, and surfaced estimated compression savings in the exec summary and cost dashboard.
- **Chat-side project-run context loading** (`src/chat/participant.ts`, `tests/chat/participant.helpers.test.ts`): project execution now loads the session SSOT context bundle before launching autonomous runs, so the same continuity data is available in both standard chat and autonomous project execution paths.
- **Calmer tool-failure summaries** (`src/core/orchestrator.ts`, `tests/cli/adversarialPrompt.test.ts`): refined the user-facing failure text to explain the tool problem clearly and offer next-step guidance without the blunt fallback wording.

## [0.77.2] - 2026-06-10

### Added
- **Published release v0.77.2**: this marketplace release bundles the routine workflow shipped on `develop`, including the new `/ship` experience, routine-run UI, bootstrap routine extraction, and direct routine-edit intent.
- **Bootstrapper routine extraction** (`src/bootstrap/bootstrapper.ts`): `/import` now scans `CLAUDE.md`, `.github/copilot-instructions.md`, and `docs/development.md` for ordered procedure sections (Publishing Routine, Release Workflow, Deploy Process, etc.) and writes a starter routine file to `project_memory/routines/<id>.md`. Steps are extracted from numbered list items with a **Label** and a `command` in backticks; `<angle-bracket-placeholders>` become `${VAR}` interpolation tokens. The fingerprint system prevents overwriting manually edited routine files, and unchanged files are skipped on re-import. After writing, `RoutineRegistry` is reloaded automatically so the new routine is immediately available to `/ship`.
- **Chat routine-edit intent** (`src/chat/participant.ts`): freeform messages matching "edit/update/change/open [the] [X] routine" now open the matching routine's source `.md` file directly in the editor, bypassing the LLM. AtlasMind identifies the target routine by matching the routine name or ID in the prompt, falling back to the default routine. If no rou
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-12T17:24:01.898Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 8edeac14
body-fingerprint: b5550d77
-->
