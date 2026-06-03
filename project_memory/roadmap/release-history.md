# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.61.4] - 2026-06-03

### Added
- Agent skills auto-management UI and supporting runtime behavior were expanded, with related documentation, tests, and SSOT memory snapshots refreshed to match the current implementation.

### Changed
- Synced release metadata for this commit by bumping `package.json` and `package-lock.json` to `0.61.4`.

## [0.61.3] - 2026-06-03

### Fixed
- Restored the README source-version banner to match `package.json` and added a regression test so the banner cannot drift again.
- Tightened the release/docs guidance so README, changelog, and mirror documentation are updated together when versioned changes land.

## [0.61.2] - 2026-06-03

### Changed
- README refresh: updated project overview and docs sections, including command, view, agent, skill, and configuration reference summaries.
- Version metadata sync: bumped `package.json` and `package-lock.json` to `0.61.2` for this commit.

## [0.61.1] - 2026-06-03

### Fixed
- **Windows CI**: Increased `bootstrapProject` test timeout from 15 s to 30 s to accommodate the slower `windows-2025-vs2026` runner that GitHub is rolling out.

## [0.61.0] - 2026-06-03

### Added
- **Agent Skills Auto mode**: The Manage Agents editor now features an **Auto** checkbox in the Skills section (checked by default for new agents). When Auto is on, the skill checkboxes are hidden and AtlasMind uses an AI model to assess which registered skills best match the agent's role and context. Unchecking Auto reveals the manual selection list for per-agent customisation.
- **`SkillAutoAssigner` service** (`src/core/skillAutoAssigner.ts`): New service that uses a frugal AI model call to assign skill IDs to auto-managed agents. Handles concurrent reassessments safely (skips if a reassessment for the same agent is already in-flight).
- **Automatic reassessment triggers**: Skill assignments are re-evaluated (a) immediately when an agent is saved with Auto enabled, (b) whenever an MCP server connects or disconnects (changing the available tool set), and (c) after the agent auto-updater refreshes an agent's system prompt. All reassessments are fire-and-forget — the original skills are preserved on any failure.
- **`assessAgentSkills(agentId)`** method on `AtlasMindContext` for programmatic reassessment from panels.
- `skillsAutoManaged?: boolean` field added to `AgentDefinition` in `src/types.ts`.

## [0.60.4] - 2026-06-03

### Changed
- **Pre-commit hook**: Expanded from version-bump/changelog enforcement only to a full local quality gate — now runs `compile` (TypeScript), `lint` (ESLint), and `test` (Vitest) before each commit, mirroring the CI steps. This ensures lint errors, type er
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-03T14:56:06.806Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: e18e8921
body-fingerprint: 2e9e4d2c
-->
