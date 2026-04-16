# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.48.0] - 2026-04-16

### Added
- `/bootstrap` and `/import` now both seed a developer-facing roadmap in `project_memory/roadmap/improvement-plan.md`, giving every project a durable backlog AtlasMind can absorb into SSOT from the start.
- The Project Dashboard now includes a dedicated Roadmap page where backlog items can be added, edited, deleted, marked done, and drag-reordered directly in the webview.

### Changed
- When users ask what Atlas should work on next, roadmap order is now treated as a weighted signal alongside criticality, security, architecture, and delivery evidence instead of relying on generic memory ranking alone.

## [0.47.6] - 2026-04-16

### Fixed
- Atlas chat now shows miniature screenshot previews for image attachments in the composer and in the sent user bubble, with click-to-enlarge lightbox viewing for quick inspection.
- Same-session follow-up turns now retain prompt attachment context so Atlas can combine the typed request, the attached screenshot, and the earlier chat history into a more coherent response.

## [0.47.5] - 2026-04-16

### Changed
- Atlas chat now uses heuristic output weighting in the embedded and detached chat surfaces so the main answer stays visually primary while low-priority execution metadata is collapsed into supporting-detail disclosures.
- Auxiliary sections such as changed files, execution notes, references, actions, and similar run-support blocks now render with lower visual weight and can be expanded on demand instead of competing with the actual user-facing response.

## [0.47.4] - 2026-04-16

### Fixed
- Atlas chat now forwards the live thinking state across the detached panel and sidebar view so opening a second chat surface mid-response shows the same in-progress status.
- Thinking indicators are now scoped to the session that is actually running, so switching to another session no longer makes Atlas appear to be thinking everywhere at once.
- Stopping an in-flight Atlas chat request now works reliably from any visible chat surface bound to the active session.

## [0.47.3] - 2026-04-16

### Fixed
- Atlas chat now renders Markdown tables as structured, scrollable tables in the embedded chat panel and autonomous run previews instead of showing raw pipe-delimited text.
- Restored clean workspace verification by repairing the malformed criticality helper and hardening SSOT import when the agent registry is unavailable in minimal test contexts.

## [0.47.2] - 2026-04-16

### Added
- **Artifact inventory** on the Project Dashboard Delivery page. Each workspace artifact is now classified along four axes and displayed with status badges:
  - `type` — `persistent` (checked in, stable) or `ephemeral` (generated, disposable)
  - `origin
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-16T16:54:46.496Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 390b521d
body-fingerprint: d09660e7
-->
