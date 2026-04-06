# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.41.1] - 2026-04-06

### Changed
- Added ambiguity-aware follow-up choices for concrete repo-local chat diagnostics so AtlasMind can answer first and then offer "Fix This", "Explain Only", and "Fix Autonomously" instead of assuming execution.
- Extended the embedded Atlas chat panel to persist and render those follow-up chips inside assistant bubbles, keeping the sidebar chat aligned with native `@atlas` follow-up behavior.

## [0.41.0] - 2026-04-06

### Changed
- Refactored Project Ideation into its own dedicated dashboard so operators can open the whiteboard directly from the Project Dashboard, Project Runs view, or Project Run Center without navigating through the broader operational dashboard first.
- Added drag-and-drop and paste-driven ideation media ingestion so files, images, and links can be queued for the next Atlas pass or dropped onto the board to create media cards inline.
- Added inline card editing on double-click inside the ideation canvas while keeping the inspector available for structured edits.

## [0.40.3] - 2026-04-06

### Fixed
- Fixed the embedded Atlas chat panel to use container-relative height and zero shell padding so the sidebar chat no longer grows taller than its allocated view and hide the Sessions rail.
- Added panel regression coverage for the chat webview sizing contract so future shell-style changes do not reintroduce the overflow.

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
- Added Project Dashboard ideation persistence and validation so Atlas-generated prompts, feedback history, and board summaries are stored as both JSON and markdown artifacts for later revi
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-06T11:59:42.852Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 34ab01f7
body-fingerprint: 9a4e45a3
-->
