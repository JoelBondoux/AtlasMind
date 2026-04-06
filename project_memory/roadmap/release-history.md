# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.39.27] - 2026-04-06

### Changed
- Inferred the tests-first write gate for ordinary freeform implementation tasks as well as `/project` subtasks, so AtlasMind now blocks implementation writes until a failing relevant test signal is established when the request looks like a testable code change.
- Added a red-to-green status cue to the chat Thinking summary so verified, blocked, missing, and not-applicable TDD states are visible directly in chat instead of being buried in verification prose.

## [0.39.26] - 2026-04-06

### Changed
- Added a Project Dashboard runtime TDD summary so operators can review aggregate verified, blocked, missing, and not-applicable `/project` outcomes without opening the Project Run Center first.
- Added per-run TDD labels to the Project Dashboard recent-runs list so autonomous runs blocked by the failing-test gate stand out immediately.

## [0.39.25] - 2026-04-06

### Changed
- Reworked the Memory sidebar into a folder-aware tree so SSOT storage folders stay visible and indexed notes are grouped beneath their storage paths instead of one flat list.
- Kept stale-memory warnings and inline memory actions intact while making larger SSOT collections easier to discover by area.

## [0.39.24] - 2026-04-06

### Changed
- Enforced a failing-test-before-write gate for testable `/project` implementation subtasks so AtlasMind holds non-test implementation writes until it has observed a relevant red signal.
- Expanded autonomous project subtasks to use test execution and workspace observability skills so AtlasMind can establish and verify that red signal during execution.
- Added persisted per-subtask TDD telemetry and surfaced it in the Project Run Center so operators can review verified, blocked, missing, and not-applicable TDD states.

## [0.39.22] - 2026-04-06

### Changed
- Added a hard `/project` TDD gate for testable implementation subtasks so AtlasMind blocks non-test implementation writes until it has observed a failing relevant test signal.
- Expanded planner subtask skills to include test execution and workspace observability tools, allowing AtlasMind to establish that red signal autonomously instead of only describing it.
- Added per-subtask TDD telemetry to persisted run artifacts and surfaced that status in the Project Run Center so operators can review whether each subtask was verified, blocked, missing evidence, or not applicable.

## [0.39.21] - 2026-04-06

### Changed
- Extended the new tests-first policy from autonomous `/project` execution into the stock freeform built-in agents so AtlasMind now prefers TDD-style verification in normal chat as well.
- Tuned the built-in debugging, frontend, backend, and review prompts so they demand failing-to-passing 
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-06T10:27:22.310Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: f712c400
body-fingerprint: df684089
-->
