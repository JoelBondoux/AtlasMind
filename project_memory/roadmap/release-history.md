# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.41.19] - 2026-04-06

### Fixed
- Preserved dependency-safe staged `/project` continuation runs by teaching planner-job splitting and Run Center previews to account for already completed seeded subtasks.
- Adopted legacy unstamped project run history into the active workspace so pre-scoping runs remain visible after upgrade instead of disappearing.

## [0.41.18] - 2026-04-06

### Changed
- Added staged planner-job execution for oversized Project Run Center drafts so large `/project` plans can execute in dependency-safe chunks with follow-up seed outputs.
- Scoped project run history to the active workspace, added deletion support for non-running saved runs, and updated the Run Center UI and tests to reflect the new review and continuation flow.

## [0.41.17] - 2026-04-06

### Changed
- Updated the repository workflow guidance to match the live solo-maintainer `master` protection model: PR-only merges plus required CI, without mandatory reviewer approval or CODEOWNERS review.

## [0.41.16] - 2026-04-06

### Changed
- Added a focused runtime regression that exercises a milestone-tracking review prompt and verifies Atlas routes it through the reviewer guidance that calls for creating the smallest missing regression spec.

## [0.41.15] - 2026-04-06

### Changed
- Tightened AtlasMind's tests-first execution prompts so freeform and `/project` code work now explicitly create the smallest missing regression test or spec when no suitable coverage exists, instead of only flagging the gap.
- Added regression coverage that locks the new tests-first wording into both the built-in agent prompts and the freeform and `/project` TDD gate path.

## [0.41.14] - 2026-04-06

### Fixed
- Corrected the Bedrock adapter request path so AWS SigV4 signing no longer double-encodes model IDs.
- Hardened the CLI workspace boundary checks by resolving real paths before approving filesystem access, which closes symlink-escape gaps for read and write operations.
- Isolated autopilot change listeners so one failing subscriber cannot break the rest of the approval-state updates.
- Reused computed SSOT memory metadata while indexing to keep evidence classification and embedding input in sync.

### Changed
- Added model-router regression coverage for repeated failure counts and preference-biased fallback after a model is marked failed.
- Removed repo-committed AtlasMind safety overrides from workspace settings and deleted the stub custom skill placeholder from `.atlasmind/skills/`.

## [0.41.13] - 2026-04-06

### Fixed
- Repaired the release-promotion CI failures by cleaning up lint issues in the runtime, bootstrapper, chat-panel attachment flow, and dashboard workflow parsing helpers.

## [0.41.12] - 2026-04-06

…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-06T20:23:10.969Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 77e6d9bb
body-fingerprint: e8bffa5e
-->
