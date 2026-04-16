# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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
  - `origin` — `manual` (human-authored), `generated` (tool output), or `tooling` (package manager / CI)
  - `lifecycle` — `source`, `build`, `test`, `deploy`, or `runtime`
  - `retention` — `keep` (must exist), `cache` (reproduced on demand), or `discard` (should be cleaned up)
- Artifacts that are `persistent + keep` but absent are flagged with a warning border and counted in an **"X missing"** badge at the top of the card. When all required artifacts are present the badge reads **"All present"** in green.
- Existing artifacts are clickable and open the file in the editor. Missing artifacts are shown as non-interactive rows.
- The catalog covers 14 a
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-16T16:20:12.060Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 9f034b28
body-fingerprint: c3dbf725
-->
