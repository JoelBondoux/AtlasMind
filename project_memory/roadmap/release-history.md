# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.40.2] - 2026-04-06

### Added
- Added ideation promotion to the AtlasMind onboarding walkthrough and Project Runs empty-state so the new whiteboard is easier to discover before launching `/project` execution.
- Added focused test coverage for Project Dashboard deep-link navigation so the dedicated ideation command is verified to emit the correct webview navigation message.

## [0.40.1] - 2026-04-06

### Added
- Added a dedicated `AtlasMind: Open Project Ideation` command that opens the Project Dashboard directly on the Ideation page.
- Added direct ideation shortcuts to the Chat and Project Runs sidebar title bars so operators can jump into the whiteboard from the main Atlas workflow surfaces.

## [0.40.0] - 2026-04-06

### Added
- Added a guided ideation workspace to the Project Dashboard with a collaborative whiteboard canvas, draggable cards, card linking, focus selection, and persisted board state under `project_memory/ideas/`.
- Added a multimodal Atlas ideation loop so operators can run facilitated idea-shaping passes with voice capture, response narration, and optional image attachments that feed the same board update flow.
- Added Project Dashboard ideation persistence and validation so Atlas-generated prompts, feedback history, and board summaries are stored as both JSON and markdown artifacts for later review.

## [0.39.28] - 2026-04-06

### Changed
- Added live freeform execution progress updates in chat so AtlasMind now shows interim thinking-style notes while tool-heavy requests are still running.
- Added a read-only exploration nudge in the orchestrator so repeated search-only tool loops are pushed to summarize likely cause and fix before they hit the 10-iteration safety cap.
- Improved task profiling for chat-panel UI regressions so sidebar, dropdown, scroll, panel, and webview prompts are treated as code work instead of plain text.

## [0.39.27] - 2026-04-06

### Changed
- Inferred the tests-first write gate for ordinary freeform implementation tasks as well as `/project` subtasks, so AtlasMind now blocks implementation writes until a failing relevant test signal is established when the request looks like a testable code change.
- Added a red-to-green status cue to the chat Thinking summary so verified, blocked, missing, and not-applicable TDD states are visible directly in chat instead of being buried in verification prose.

## [0.39.26] - 2026-04-06

### Changed
- Added a Project Dashboard runtime TDD summary so operators can review aggregate verified, blocked, missing, and not-applicable `/project` outcomes without opening the Project Run Center first.
- Added per-run TDD labels to the Project Dashboard recent-runs list so autonomous runs blocked by the failing-test 
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-06T11:14:21.330Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 06e12886
body-fingerprint: cc11ec24
-->
