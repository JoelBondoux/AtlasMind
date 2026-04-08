# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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
- MCP registry: AtlasMind now deduplicates imported MCP server configs against its own registry, can re-enable matching disabled entries instead of creating duplicates, and skips VS Code-only MCP options that AtlasMind cannot reproduce safely.

## [0.44.20] - 2026-04-08

### Changed
- Specialist routing: Freeform specialist domains now derive preferred providers from the live refreshed model catalog instead of a fixed provider list, using domain metadata carried through discovery and catalog enrichment.
- Configuration: Added `atlasmind.specialistRoutingOverrides` so workspaces can pin or suppress specialist domain routes without turning off automatic provider adaptation.

## [0.44.19] - 2026-04-08

### Fixed
- Models sidebar: When one provider exposes multiple model ids that share the same friendly display name, AtlasMind now shows the exact model slug inline so entries such as repeated Claude Opus 4 variants can be distinguished without opening each tooltip.

## [0.44.18] - 2026-04-08

### Changed
- Session history: New chat sessions now derive a concise 1-3 word subject title from the first user turn instead of persisting a raw truncated sentence as the session label.
- Project Run Center: Autonomous run previews and saved run history now persist a dedi
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-08T08:45:14.592Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 5a193855
body-fingerprint: a57f5601
-->
