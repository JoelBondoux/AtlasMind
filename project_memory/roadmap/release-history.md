# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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
- Project Run Center: Autonomous run previews and saved run history now persist a dedicated short `title` alongside the full `goal`, so the chat panel and Run Center can show stable subject labels while still keeping the full goal available as supporting detail.

## [0.44.17] - 2026-04-08

### Changed
- Chat routing: Freeform requests now pass through a broader specialist-intent layer that can redirect media generation and recognition into dedicated workflow surfaces and bias specialist in-chat tasks toward stronger capability sets.
- Model selection: Research, robotics, and simulation prompts now carry specialist routing guidance into execution, prefer deeper reasoning routes, and can bias toward dedicated providers such as Perplexity when those routes are available.

## [0.44.16] - 2026-04-08

### Fixed
- Chat context carry-forward: Native chat now detects clear subject changes and stops injecting stale session or thread history into fresh prompts, which prevents unrelated earlier discussions from skewing new requests like image or logo generation.
- Chat follow-up handling: Explicit follow-up prompts such as `based on the above` and similar contextual continuations still retain prior conversation context, so Atlas keeps the current th
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-08T08:17:20.332Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 6c69ca54
body-fingerprint: 9033b8fa
-->
