# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.67.8] - 2026-06-05

### Fixed
- **Provider discovery pipeline now fully traced in the output channel**: Added per-provider log lines to `refreshProviderModelsCatalog` at three checkpoints — discovery start (with health state), discovered model count, and post-merge registered count. Previously the pipeline could silently skip or lose models with no visible signal. These logs appear in the **AtlasMind** output channel and will show exactly where the chain breaks for any provider.

## [0.67.7] - 2026-06-05

### Fixed
- **Cross-session response bleeding between simultaneous chat panels**: When the sidebar Chat View and the detached Chat Panel were both open and running prompts concurrently, responses from one session appeared in the other. Two root causes were addressed: (1) `runPrompt` now calls `spawnSession()` instead of `createSession()` for "new session" mode, preventing the global active-session pointer from being silently hijacked by one panel and triggering a session-ID reset in the other; (2) when a prompt is submitted in "send" mode and another panel is already executing on the same session, a fresh session is automatically spawned for the new prompt, ensuring each concurrent run has its own isolated transcript. Additionally, `selectSession()` now short-circuits without firing `onDidChange` when the requested session is already active, eliminating the wave of redundant `syncState()` calls that all live panels were absorbing on every streaming update.

## [0.67.6] - 2026-06-05

### Changed
- **SSOT memory is now fully self-managed**: Removed the "Project memory needs update" warning item from the Memory sidebar panel. When the MemoryManager detects stale imported entries on activation or SSOT reload, it now silently auto-runs the import pipeline rather than surfacing a manual-review prompt to the user. The `atlasmind.updateProjectMemory` command remains available from the command palette and view toolbars for on-demand refreshes.

## [0.67.5] - 2026-06-05

### Changed
- **Live model badge redesigned**: The streaming model badge now uses the same grey pill style as the completed model badge. During streaming it shows the most recent model name with a subtle pulsing dot. When the orchestrator switches models mid-response (escalation, failover, re-route) a `(+N)` count appears next to the name; clicking the badge drops down a list of every model used in the reply (labelled "Models used so far" while streaming, "Models used in this reply" after completion). The same expandable behaviour applies to completed multi-model responses where `modelsUsed` is stored in transcript metadata.

### Fixed
- **Token count in response cost summary 
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-05T14:23:25.007Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: e65154c9
body-fingerprint: 3f105e39
-->
