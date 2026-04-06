# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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
- Rewrote the README to be shorter, clearer, and more value-focused for both new and experienced developers.
- Tightened core docs and wiki pages for accuracy, including current skill counts, exact command names, and clearer sidebar surface descriptions.

## [0.41.8] - 2026-04-06

### Changed
- Promoted SSOT memory from a snippet-only retrieval layer into a source-backed evidence system by storing document class, evidence type, and import source pointers on indexed memory entries.
- Updated memory ranking to account for document class, source-backed evidence, and recency so exact or current-state questions prefer fresher operational notes over generated index pages.
- Taught the orchestrator to classify summary-safe versus live-verify requests and include live source excerpts alongside memory summaries when the user asks for current or exact workspace state.

## [0.41.7] - 2026-04-06

### Changed
- Extended the embedded Atlas chat font-size range with three additional smaller `A-` steps, allowing the chat bubbles to scale down to `70%` of the default size while keeping the existing header controls and persistence behavior.

## [0.41.6] - 2026-04-06

### Fixed
- Added browser-side paste and drag-drop media ingestion for the embedded Atlas chat panel so clipboard screenshots and dropped local files can be attached without requiring a workspace file path.
- Extended the chat-panel attachment pipeline to accept serialized inline files, turning pasted images and dropped media into the same prompt attachments used by the existing composer flow.

## [0.41.5] - 2026-04-06

### Changed
- Added compact `A-` and `A+` controls to the embedded Atlas chat panel so operators can shrink or enlarge chat-bubble typography without affecting t
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-06T13:25:25.040Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: dfa18334
body-fingerprint: 55e3be15
-->
