# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).


## [0.51.2] - 2026-04-20

### Added
- **Chat bubble classification and context weighting:** Each chat message is now automatically classified (intent, answer, system, error, irrelevant) and assigned a relevance weight. The orchestrator context selection logic now prioritizes relevant bubbles, reducing context pollution from system/billing errors and keeping the thread focused.

### Changed
- Context-building logic in sessionConversation.ts now uses classification and weighting to select the most relevant transcript entries for orchestrator context.

---
## [0.51.1] - 2026-04-20

### Added
- **Chat panel session search toggle:** Added a "Search" icon to the chat panel composer toolbar. Toggling this icon switches the composer between chat and session search modes. The search input and results area now appear when toggled, and the chat input is hidden in search mode. This lays the foundation for advanced session search with glob-style matching.

### Changed
- Refactored chat panel UI state logic to support toggling between chat and search modes.

---
## [0.51.0] - 2026-04-20

### Added
- **`/memory write` chat command**: Operators can now save a memory entry directly from the chat participant with `/memory write <path> | <title> | <content>`, bypassing the need to ask Atlas to remember something on their behalf.
- **`/memory stats` chat command**: `/memory stats` shows total entries, warnings, blocked count, stale imports, and a breakdown by document class.
- **Memory index stats tree item**: The Memory tree view now shows an inline stats row (entry count, warnings, blocked) whenever entries are indexed, giving at-a-glance health visibility without opening a separate panel.
- **`MemoryManager.queryWithOptions()`**: New method allowing callers to override the retrieval mode (`planning`, `live-verify`, `summary-safe`, `hybrid`), filter by required tags, and exclude document classes — replacing the need to rely on auto-inference for all use cases.
- **`MemoryManager.getStats()`**: New method returning aggregate statistics (`MemoryStat`) about the current index: entry count, per-class breakdown, warning/blocked counts, total snippet chars, and potentially-stale import count.
- **Memory-aware project planning**: The `Planner` now accepts an optional `MemoryStore` reference. When provided, it queries roadmap, decisions, and architecture memory entries and injects them into the planning prompt so subtask decomposition is informed by existing project context. All three `Planner` construction sites (orchestrator, chat participant, project run centre panel) now pass `memoryManager`.
- **Transient context injection scanning**: Session history, native chat context, and attachment context are now scanned for prom
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-20T08:49:19.991Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 2b14c212
body-fingerprint: 6c47fe52
-->
