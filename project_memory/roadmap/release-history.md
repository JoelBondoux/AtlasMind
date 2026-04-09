# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.45.12] - 2026-04-09

### Fixed
- Settings panel: Changed nav links from `<a>` elements to `<button>` elements. VS Code webviews intercept anchor clicks through their built-in link handler before JavaScript event listeners fire, which silently prevented all Settings page navigation.

## [0.45.11] - 2026-04-09

### Fixed
- Settings panel: Navigation now binds clicks directly on each section link, synchronizes the active page through the URL hash, and gives explicit deep-link targets precedence over stale saved webview state so the side menu remains responsive and Local LLM Configure no longer gets pulled back to Home by remembered navigation state.

## [0.45.10] - 2026-04-09

### Fixed
- Settings panel: Replaced the hardcoded Overview-only fallback with a per-target fallback-visible section, so targeted opens such as Local LLM Configure now render the requested Settings page instead of falling back to Home.

## [0.45.9] - 2026-04-09

### Fixed
- Settings panel: The requested page now renders server-side on first open and when retargeting an already-open Settings panel, so deep links still land on the intended section even if the previous webview script instance was unhealthy.
- Settings panel: Corrected the local endpoints deep-link target so Local LLM configuration now points at the actual local endpoints card on the Models page.

## [0.45.8] - 2026-04-09

### Fixed
- Model Providers: The Local LLM Configure action now opens AtlasMind Settings directly to the Models page and scrolls to the local endpoints card instead of landing on a less relevant location.

## [0.45.7] - 2026-04-09

### Fixed
- Settings panel: Restored separated settings sections without depending on successful script startup, corrected the left-nav box sizing so the active pill no longer overflows its container, and kept hash-based section switching available as a no-JavaScript fallback.

## [0.45.6] - 2026-04-08

### Fixed
- Settings panel: Converted the left-side section menu to progressive-enhancement anchors and only enable single-page hiding after the settings script boots, so the menu still responds and scrolls to the correct section even if later control wiring fails in the webview.

## [0.45.5] - 2026-04-08

### Changed
- Chat panel: Refined long-answer typography with slightly looser paragraph rhythm, softer section heading weight, tighter list indentation, and calmer blockquote styling so dense responses read more like a polished assistant transcript.

## [0.45.4] - 2026-04-08

### Fixed
- Settings panel: Hardened the left-side page navigation so it initializes independently from the rest of the page controls, and raised the nav stacking context so it stays clickable even if neighboring content initi
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-09T09:01:15.975Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 240897c7
body-fingerprint: 088c5ed4
-->
