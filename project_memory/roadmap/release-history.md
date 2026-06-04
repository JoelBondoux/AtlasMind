# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.64.0] - 2026-06-04

### Added
- **Collapsible Standalone Runs section**: The Standalone Runs list in the Sessions panel is now a collapsible section with its own toggle button. It is collapsed by default. When one or more runs are actively in progress a count badge appears next to the title; the badge is hidden when no runs are running. Collapse state is persisted across panel reloads.

### Fixed
- **Project Dashboard double-send**: Clicking a Dashboard button that auto-submits a prompt to the Chat Panel no longer also puts the same text into the composer input box. `pendingComposerDraft` is now skipped when `autoSubmit: true` is set, so the prompt appears only in the conversation, not duplicated in the input field.
- **Memory: empty-title guard**: `MemoryManager.upsert()` (VS Code host) and `NodeMemoryManager.upsert()` (CLI) now reject entries with a blank or whitespace-only title before any other validation, preventing unscorable zero-match ghost entries from being indexed.
- **Memory: `persistEntry` write failures now logged**: Previously, disk write errors were silently swallowed because callers used `void persistEntry()`. Both managers now wrap `createDirectory` + `writeFile` in a try/catch that logs the error to the VS Code output channel and re-throws, so failures are visible without breaking the in-memory state.
- **Memory: path escape guard in `persistEntry`**: Added a belt-and-suspenders check that the resolved file URI/path is still under the SSOT root before any write, preventing a bypassed `isValidSsotPath` from writing outside the project memory folder.
- **Memory CLI: sessions excluded from `queryWithOptions`**: `NodeMemoryManager.queryWithOptions()` now excludes `sessions/` entries to match the existing VS Code host `queryRelevant` and `queryWithOptions` behavior.

### Added
- **Memory: `fingerprintedImports` stat**: `MemoryStat` now includes `fingerprintedImports` — the count of imported entries that have both `sourcePaths` and a `bodyFingerprint`. This separates fully-tracked imports from `potentiallyStaleImports` (entries with source paths but no fingerprint), giving the memory browser and diagnostics a clear picture of import health.
- **Memory: `scanForOrphanedEntries()`**: New async method on both `MemoryManager` and `NodeMemoryManager` that checks entries with `sourcePaths` against the workspace root and SSOT root and returns the SSOT-relative paths of entries where no source file is accessible. Enables future cleanup UIs to surface deleted or renamed source references without manual inspection.
- **Memory: staleness penalty in `live-verify` and `planning` modes**: `getFreshnessBoost` now extends the staleness window 
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-04T10:35:06.655Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: cd1a412f
body-fingerprint: c6dae063
-->
