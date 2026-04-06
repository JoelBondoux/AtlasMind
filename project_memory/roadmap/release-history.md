# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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

### Changed
- Restored the README title to show AtlasMind's current beta status directly in the main heading.

## [0.41.11] - 2026-04-06

### Changed
- Mirrored the README's safety-first, approval-aware, and red/green TDD-oriented positioning into the wiki landing pages so the top-level product message stays consistent across entry points.

## [0.41.10] - 2026-04-06

### Changed
- Strengthened the README positioning to call out AtlasMind's safety-first execution model and red/green TDD-oriented autonomous development principles.
- Reintroduced a compact comparison table in the README that highlights the biggest product differentiators without turning the page back into a long feature matrix.

## [0.41.9] - 2026-04-06

### Changed
- Rewrote the 
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-06T14:50:01.103Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 88d211b7
body-fingerprint: a83c0f47
-->
