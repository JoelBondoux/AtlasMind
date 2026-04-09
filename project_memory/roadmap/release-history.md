# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.45.6] - 2026-04-08

### Fixed
- Settings panel: Converted the left-side section menu to progressive-enhancement anchors and only enable single-page hiding after the settings script boots, so the menu still responds and scrolls to the correct section even if later control wiring fails in the webview.

## [0.45.5] - 2026-04-08

### Changed
- Chat panel: Refined long-answer typography with slightly looser paragraph rhythm, softer section heading weight, tighter list indentation, and calmer blockquote styling so dense responses read more like a polished assistant transcript.

## [0.45.4] - 2026-04-08

### Fixed
- Settings panel: Hardened the left-side page navigation so it initializes independently from the rest of the page controls, and raised the nav stacking context so it stays clickable even if neighboring content initialization fails or spills visually during debug sessions.

## [0.45.3] - 2026-04-08

### Fixed
- Chat panel: Mixed markdown sections that contain headings followed by bullet lists now render as separate heading and list blocks instead of collapsing into title-like bullet text.

### Changed
- Chat panel: The transcript role pill and model badge now use matching font sizing and height, and the Thinking Summary disclosure uses a lighter, lower-contrast treatment against the bubble background.

## [0.45.2] - 2026-04-08

### Fixed
- Settings panel: Deferred the legacy local-endpoint migration until after the webview finishes initializing, and now sync the migrated endpoint list back into the live page so the left-side settings navigation keeps responding during first-open migration.

## [0.45.1] - 2026-04-08

### Changed
- Settings panel: Opening AtlasMind Settings now auto-migrates an explicitly configured legacy `atlasmind.localOpenAiBaseUrl` into the structured `atlasmind.localOpenAiEndpoints` list when no structured local endpoint list exists yet.

## [0.45.0] - 2026-04-08

### Added
- Local provider: AtlasMind can now aggregate multiple labeled local OpenAI-compatible endpoints under the single Local provider, which lets workspaces keep engines such as Ollama and LM Studio online together while preserving which endpoint owns each routed local model.
- Settings panel: Models & Integrations now exposes a dynamic local-endpoint list with a `+` add control so operators only create extra endpoint fields when they actually need them.

### Changed
- Model Providers panel: The Platform & Local page now shows each configured local endpoint by label and base URL so operators can tell which local engine is which at a glance.

## [0.44.37] - 2026-04-08

### Changed
- Chat panel: Softened the transcript header role pill and model badge, and tightened header spacing so assist
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-08T11:36:59.068Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: c4e11212
body-fingerprint: d763a1fd
-->
