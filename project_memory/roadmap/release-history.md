# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Memory safety: Added a background self-healing loop for SSOT memory that runs during activation and while the workspace is open, so warned and blocked memory entries are automatically remediated without manual intervention.

### Changed
- Chat tool activity in the dedicated panel now renders inside the inner-monologue/thinking surface with latest-first display by default and a collapsible history for earlier updates.
- Memory self-healing now quarantines blocked SSOT entries into `temp/quarantine/*.blocked.txt.bak`, replaces blocked files with safe placeholders, sanitizes warned entries (hidden Unicode, suspicious instruction-like comments, secret-like values), and reindexes memory automatically.

## [0.57.9] - 2026-05-13

### Added
- Deterministic SSOT auto-linker: Memory indexing and upserts now infer lightweight neighbor links when matching sibling artifacts exist in paired folders: `decisions/ <-> roadmap/` and `architecture/ <-> operations/`.

### Changed
- Bounded relation storage: `relatedPaths` are now capped to keep relationship density predictable and prevent graph-style noise growth over time.
- Cross-entry consistency on writes: Upserts now re-apply the auto-link pass across loaded memory entries so newly added sibling artifacts can become discoverable in one-hop expansion immediately.

## [0.57.8] - 2026-05-13

### Added
- Lightweight memory relationship overlay: `MemoryEntry` now supports optional `relatedPaths` links so SSOT notes can declare explicit neighbor artifacts (for example, decision -> rollout plan).

### Changed
- One-hop retrieval expansion: `MemoryManager.queryRelevant()` and `queryWithOptions()` now append bounded one-hop neighbors from top-ranked entries when result slots remain, giving AtlasMind better context continuity without replacing the existing lexical/vector ranking.
- Node CLI memory parity: `NodeMemoryManager` now applies the same related-path parsing and one-hop expansion behavior as the VS Code host memory manager.

### Fixed
- Import metadata ingestion: Memory import trailers now parse an optional `related-paths` field so generated memory can carry relationship links into retrieval.

## [0.57.7] - 2026-05-13

### Fixed
- Tool execution webview event handling regression: Removed duplicated nested status and busy handlers in `media/chatPanel.js` that caused repeated processing and unstable history rendering.
- Structured tool payload parsing: Replaced fragile regex parsing for `[TOOL_EXEC]` progress updates with brace-depth JSON extraction so nested tool metadata parses reliably.
- Chat panel template duplication and CSS corruption: Removed duplicated `recoveryNotice` markup and repaired 
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-05-13T09:10:29.328Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 302dff89
body-fingerprint: f3908a93
-->
