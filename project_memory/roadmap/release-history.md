# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.77.2] - 2026-06-10

### Added
- **Published release v0.77.2**: this marketplace release bundles the routine workflow shipped on `develop`, including the new `/ship` experience, routine-run UI, bootstrap routine extraction, and direct routine-edit intent.
- **Bootstrapper routine extraction** (`src/bootstrap/bootstrapper.ts`): `/import` now scans `CLAUDE.md`, `.github/copilot-instructions.md`, and `docs/development.md` for ordered procedure sections (Publishing Routine, Release Workflow, Deploy Process, etc.) and writes a starter routine file to `project_memory/routines/<id>.md`. Steps are extracted from numbered list items with a **Label** and a `command` in backticks; `<angle-bracket-placeholders>` become `${VAR}` interpolation tokens. The fingerprint system prevents overwriting manually edited routine files, and unchanged files are skipped on re-import. After writing, `RoutineRegistry` is reloaded automatically so the new routine is immediately available to `/ship`.
- **Chat routine-edit intent** (`src/chat/participant.ts`): freeform messages matching "edit/update/change/open [the] [X] routine" now open the matching routine's source `.md` file directly in the editor, bypassing the LLM. AtlasMind identifies the target routine by matching the routine name or ID in the prompt, falling back to the default routine. If no routines exist, the response explains how to scaffold one via `/import`.

## [0.77.1] - 2026-06-10

### Changed
- **Routine card UI in Project Run Center** (`src/views/projectRunCenterPanel.ts`): replaced the `<select>` dropdown in the Ship card with run-card–style tiles matching the panel's design language. Each routine renders as a clickable card showing its name, description, and step count. The action strip inside each card contains a **Ship** button and an **Edit** button; Edit opens the routine's source `.md` file directly in the editor. The separate standalone Run Routine button has been removed.

## [0.77.0] - 2026-06-10

### Added
- **Project Routines** (`src/core/routineRegistry.ts`, `src/core/routineRunner.ts`): named, executable workflows stored as YAML-frontmatter markdown files in `project_memory/routines/`. The registry scans that folder on startup and makes all valid routines available to the rest of the extension. The runner executes steps sequentially, streams per-step progress, respects `on_fail: abort | prompt | continue` policies, and persists run results to `ProjectRunHistory`.
- **`/ship` chat command** (`src/chat/participant.ts`, `package.json`): `/ship` runs the project's default routine (first file with `default: true`, or first file in the folder). `/ship <id>` runs a named routine. Text after the I
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-10T20:03:17.519Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 7a944142
body-fingerprint: 392838f8
-->
