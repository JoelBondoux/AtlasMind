# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.76.5] - 2026-06-10

### Added
- **Animated logo on active-agent session tiles** (`media/chatPanel.js`, `src/views/chatPanel.ts`): session tiles in the Sessions panel now display a small animated AtlasMind globe (the same spinning-axis logo used in the thinking indicator, scaled to 14 px) when an agent is actively working in that session. The animation reuses the existing `atlas-spin` and `atlas-float` keyframes and disappears automatically once the run completes.

## [0.76.4] - 2026-06-10

### Changed
- **Model & provider info cards** (`src/views/treeViews.ts`): clicking "info" on a model or provider in the Models tree now routes the summary into a dedicated **"Model & Provider Info"** session instead of appending it to the currently active working session. If the dedicated session has been deleted or archived the next info request recreates it automatically. The user's active working session is never interrupted.

## [0.76.3] - 2026-06-10

### Fixed
- **Chat panel completely non-functional** (`media/chatPanel.js`): Unicode curly/smart single-quote characters (`‘`/`’`) were embedded in a JS string literal on line 3647, introduced when the AI instruction nudge text was written. JavaScript does not recognise curly quotes as string delimiters, so the entire IIFE failed to parse and no event handlers were ever registered. This caused the Send button, model-info output, and session panel toggle to all stop working simultaneously. Fixed by replacing the three curly quotes with plain ASCII single quotes (`'`).

## [0.76.2] - 2026-06-10

### Fixed
- **AI instruction nudge** (`src/views/chatPanel.ts`, `media/chatPanel.js`): three bugs introduced in 0.76.0 are resolved:
  1. Missing CSS for `.ai-instruction-nudge`, `.nudge-btn`, `.nudge-btn-primary`, and related classes caused the nudge banner to render as unstyled HTML that disrupted the chat layout.
  2. The "Sync Now" button stayed permanently disabled after a sync failure; the extension now sends `resetSyncButton` on failure and the webview re-enables the button.
  3. Nudge dismiss state was stored in an in-memory `Set` and lost on every extension reload; it is now persisted via `workspaceState` (`atlasmind.aiInstructionNudgeDismissed`).

## [0.76.1] - 2026-06-09

### Docs
- **Testing methodology system documented** across `README.md`, `docs/agents-and-skills.md`, `wiki/Agents.md`, `wiki/Changelog.md`, `wiki/Getting-Started.md`, and `wiki/Home.md`: added the full 23-methodology registry table, Settings Panel Testing matrix reference, auto-assess scan description, Project Dashboard Testing page, Agent Testing Roles section, and bootstrap/import flow. Updated all "red-green testing polic
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-10T17:53:13.662Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 19cfcd56
body-fingerprint: 550a2269
-->
