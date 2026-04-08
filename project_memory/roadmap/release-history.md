# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.44.29] - 2026-04-08

### Changed
- Chat panel: Moved the Project Run Dashboard and main chat navigation shortcuts out of the blue in-panel button group and into the detached chat panel's grey title-bar action row.

## [0.44.28] - 2026-04-08

### Fixed
- Settings panel: Repaired the routing settings stylesheet so Budget and Speed option hover help renders reliably inside the settings webview instead of being dropped by malformed embedded CSS.

## [0.44.27] - 2026-04-08

### Changed
- Settings panel: Budget and Speed routing options now show option-specific hover help so operators can see the routing tradeoff attached to each choice before switching modes.

## [0.44.26] - 2026-04-08

### Fixed
- Tool routing: Short command-style prompts such as starting or stopping timers now keep the tool-capable routing path for built-in agents instead of silently downgrading to a pinned text-only model like Claude CLI when a function-calling model is available.

## [0.44.25] - 2026-04-08

### Fixed
- OpenAI tool routing: AtlasMind now normalizes MCP-style tool ids into OpenAI-safe function names before sending tool-enabled requests to OpenAI-compatible providers, then maps provider-returned tool calls back to the original Atlas skill ids.

## [0.44.24] - 2026-04-08

### Changed
- Model routing: `cheap` mode now applies a much stronger score multiplier to effective cost after the budget gate, so low-cost eligible models win more decisively within the cheap pool.
- Model routing: `fast` mode now applies a much stronger score multiplier to speed after the speed gate, so fast-eligible models are ranked more aggressively toward low-latency choices.

## [0.44.23] - 2026-04-08

### Fixed
- Claude CLI routing: AtlasMind no longer treats Claude CLI (Beta) as `function_calling` capable after model discovery refresh, so tool-routed turns can fall through to real tool-capable providers such as OpenAI instead of getting stuck on the print-mode bridge.

## [0.44.22] - 2026-04-08

### Fixed
- Chat metadata: AtlasMind no longer exposes internal provider failover and escalation debug trails as the visible `Model` label in chat responses, which prevents long failover strings from flooding the transcript footer when a request recovers through another model.
- Cost tracking: Billing and usage records now stay pinned to the final routed model instead of inheriting a user-facing failover summary string.

## [0.44.21] - 2026-04-08

### Added
- MCP import: Added `AtlasMind: Import VS Code MCP Servers` plus an MCP panel shortcut that scans the current VS Code profile `mcp.json` and workspace `.vscode/mcp.json` files, then imports compatible `stdio` and `http` servers into AtlasMind.

### Changed
- MCP registry: At
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-08T09:16:20.730Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 6008a387
body-fingerprint: 9801479b
-->
