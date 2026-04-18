# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.49.37] - 2026-04-18

### Fixed
- Chat panel: Guarded automatic composer focus restoration so live transcript and busy-state refreshes no longer steal the editor cursor after the user clicks back into another VS Code surface.

## [0.49.36] - 2026-04-18

### Changed
- Added a dedicated Testing policy highlight card to the Project Dashboard so the active tests-first policy is visible at a glance beside the framework and coverage stats.
- Added an optional workspace override label so teams can display their own wording for the testing policy while still keeping AtlasMind's underlying verification guardrails in place.

## [0.49.36] - 2026-04-18

### Changed
- Moved warning-level generated-skill review into the AtlasMind in-chat approval stack so operators can approve or keep a draft blocked without leaving the conversation flow.
- Tailored the approval card for generated skills to show the warning summary and a one-time Allow Once versus Keep Blocked choice.

## [0.49.35] - 2026-04-18

### Changed
- Auto-synthesized skills that raise warning-level scan findings now pause behind an explicit user approval prompt before AtlasMind evaluates them in-process.
- Added a review-first flow for generated skill drafts so operators can inspect the warning summary and proposed source, then either allow once or keep the draft blocked for refinement.

## [0.49.34] - 2026-04-18

### Changed
- Moved project-level testing visibility into the Project Dashboard so the testing surface now behaves like a workspace health view instead of a generic settings page.
- Added an interactive test explorer with category grouping, searchable long-list and dropdown navigation, and a selected-test detail pane that summarizes source-level description, likely input steps, assertions, and opens the relevant file at the matching line.

## [0.49.33] - 2026-04-18

### Added
- MCP intent heuristics: AtlasMind now derives natural-language routing cues for third-party MCP tools, biases tool selection toward the most likely match for prompts like “commit”, and asks for clarification when multiple tools look similarly plausible.
- SSOT recall: Successful natural-language-to-MCP resolutions are now written into project memory so future turns can reuse that learned mapping.

## [0.49.32] - 2026-04-18

### Fixed
- Made F2 rename use the currently focused Sessions sidebar item so keyboard rename now works reliably for chat threads and session folders.

## [0.49.31] - 2026-04-18

### Fixed
- Replaced the external Marketplace version badge in the README with a plain Marketplace-safe version callout so AtlasMind no longer shows a broken or retired badge placeholder on extension detail pages.

## [0.39.7] - 2026-04-18

### Changed
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-18T13:57:56.094Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 0d3e4fc1
body-fingerprint: 5eadbf4e
-->
