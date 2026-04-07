# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.42.5] - 2026-04-07

### Changed
- Reverted the experimental composite Home sidebar and restored the previous native AtlasMind sidebar layout with the compact Quick Links strip at the top.

## [0.42.4] - 2026-04-07

### Changed
- Moved the Settings dashboard extension version badge from the title row to the lower-right corner of the hero banner.

## [0.42.3] - 2026-04-07

### Changed
- Added CLI-style prompt history navigation to the shared Atlas chat composer so pressing Up or Down at the start or end of the input recalls recent submitted prompts without breaking multiline editing.

## [0.42.2] - 2026-04-07

### Added
- Added a dedicated built-in `docker-cli` skill so AtlasMind can inspect containers and run controlled Docker Compose lifecycle operations through a strict allow-list instead of generic terminal passthrough.

### Changed
- Classified Docker tool calls as terminal-read or terminal-write based on the requested Docker or Docker Compose action so approval prompts match the operational risk.

## [0.42.1] - 2026-04-07

### Changed
- Added an AtlasMind sidebar container action that runs Collapse All across every AtlasMind tree view, so the sidebar title overflow menu now has a single command for folding the operational trees back down.

## [0.42.0] - 2026-04-07

### Added
- Added a Claude CLI (Beta) routed provider that reuses a locally installed Claude CLI login through constrained print-mode execution in both the extension host and the AtlasMind CLI.
- Added Claude CLI (Beta) provider discovery, seed models, provider-panel setup detection, and catalog metadata so the new backend is clearly labeled Beta across user-facing model-management surfaces.

## [0.41.33] - 2026-04-07

### Changed
- Replaced the modal OS-level tool approval prompt with an in-chat AtlasMind approval card so Allow Once, Bypass Approvals, Autopilot, and Deny decisions now happen inside the shared chat workspace.

## [0.41.32] - 2026-04-07

### Changed
- Added an always-on workspace identity prompt that combines the saved Atlas Personality Profile with a compact `project_soul.md` summary so every chat turn stays grounded in both operator preferences and project identity.

## [0.41.31] - 2026-04-07

### Changed
- Made AtlasMind's default chat agent more proactive for fix-oriented requests by injecting a stronger execution bias toward workspace tool use and re-prompting once when action-oriented turns answer with speculation instead of touching the repo.

## [0.41.30] - 2026-04-07

### Fixed
- Registered the AtlasMind sidebar Quick Links webview before the tree views so fresh default layouts now materialize the icon strip ahead of Project Runs instead of appending it lower in the stack.

## [
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-07T16:43:46.007Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: e4b74f7d
body-fingerprint: 65a2e531
-->
