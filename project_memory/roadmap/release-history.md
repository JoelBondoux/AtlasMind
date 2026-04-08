# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.44.33] - 2026-04-08

### Changed
- Chat panel: Session timeline bullets now render with inline body-style labels instead of oversized title-like headings, improving transcript readability in the Atlas chat surface.

## [0.44.32] - 2026-04-08

### Fixed
- Action-oriented workspace requests: AtlasMind now recognizes feature-wiring prompts such as "wire in", "configure", or "integrate" as direct-execution work more reliably, and gives action-biased turns one stronger follow-through reprompt after read-only evidence so the chat does not stop at a polished summary before attempting concrete progress.

## [0.44.31] - 2026-04-08

### Fixed
- Cost-aware tool routing: Terse command-style MCP actions now prefer a real local function-calling model when the local provider can satisfy the request, reducing unnecessary billed-provider usage for simple tool turns.
- Tool execution reporting: AtlasMind now surfaces authoritative failed-tool summaries when a tool round only returns failures or validation errors, preventing contradictory "success" narration after an MCP action did not actually complete.

## [0.44.30] - 2026-04-08

### Changed
- Cost Dashboard: Added proper MTD, QTD, YTD, and All Time window presets to the Daily Spend filter and removed the old 60-day preset.
- Cost Dashboard: Added a chart-style toggle so Daily Spend can render as either a line chart or a bar chart instead of overlaying both at once.
- Cost Dashboard: Made Recent Requests sortable by clicking the column headings and constrained the Model column to a single truncated line with the full value preserved in the tooltip.

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
- Model routing: `fast` mode now applies a much stronger score multiplier to speed after the sp
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-08T09:50:33.944Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: a2529a32
body-fingerprint: 262a6406
-->
