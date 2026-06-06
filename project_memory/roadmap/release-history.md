# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.68.2] - 2026-06-06

### Added
- **Local Model Advisor in Settings**: Added a new "Scan & Recommend" panel under Models & Integrations that analyzes AtlasMind's recent local-model usage, inspects local hardware capacity (CPU, RAM, and detected GPU/VRAM), and ranks release-aware local model families to recommend the most appropriate models to keep installed. The advisor now also supports install/remove lifecycle actions: one-click install and remove for Ollama models, plus LM Studio install/remove guidance directly in the panel where stable API automation is not currently available.
- **Data-driven local recommendation registry**: Moved release-aware local model candidate definitions into `src/providers/localModelRecommendationRegistry.ts` and added validated workspace override loading from `.atlasmind/local-model-recommendations.json`. The advisor now falls back to built-in defaults automatically when overrides are absent or invalid, so future model families can be added without editing Settings panel logic.
- **Registry override coverage tests**: Added provider-level tests for local recommendation override parsing, normalization, invalid-entry filtering, and built-in fallback behavior when override content is malformed or non-array.
- **Focused provider test script**: Added `npm run test:providers:local-recommendations` to run only the local recommendation registry override and fallback test suite with dot reporting.
- **CI regression gate for local recommendation registry**: The CI quality matrix now runs `npm run test:providers:local-recommendations` as an explicit focused gate alongside the full unit-test suite.

### Fixed
- **Chat panel now fails safely when webview markup is incomplete**: Added a startup guard in `media/chatPanel.js` that validates required DOM nodes before wiring event handlers. If required elements are missing, AtlasMind now shows an explicit in-panel error instead of throwing null-access runtime errors and leaving the view blank or unresponsive.
- **Project Dashboard now avoids webview service-worker bootstrap dependency**: `projectDashboardPanel` now prefers inline loading of `media/projectDashboard.js` (with URI fallback) when composing webview HTML. This mitigates environments where webview resource service-worker registration fails with `InvalidStateError` during dashboard startup.
- **Shared webview shell now allows worker/service-worker bootstrap paths**: `getWebviewHtmlShell` now includes explicit `worker-src`, `child-src`, and `frame-src` directives for the webview origin (plus `blob:` where needed). This resolves debug-host startup failures where webviews immediately showed “Could not register service worker …
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-06T19:09:28.643Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: c4c7c430
body-fingerprint: c26bdb09
-->
