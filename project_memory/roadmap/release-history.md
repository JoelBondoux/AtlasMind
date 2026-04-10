# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.46.26] - 2026-04-10

### Fixed
- Dashboard-launched ideation follow-up prompts now open a fresh ideation-scoped chat turn with board context attached instead of sending a bare ambiguous prompt into generic chat history.
- Ambiguous ideation-scoped requests now default back to the general assistant when they do not explicitly ask for a specialist domain, preventing reviewer-style routing from hijacking whiteboard follow-up questions.

## [0.46.25] - 2026-04-10

### Fixed
- Project Ideation link labels now render as collision-aware badges that avoid cards and previously placed labels instead of sitting directly on top of routed lines.
- The ideation canvas now exposes a larger world area with expanded card-position limits, which removes the earlier panning cutoff on edges such as the far right side of the board.

## [0.46.24] - 2026-04-10

### Fixed
- Anthropic chat requests now sanitize provider-facing tool names and map them back to the original AtlasMind skill ids, fixing failures when MCP-backed tool ids contain unsupported characters such as `:` or `/`.
- Multi-turn Anthropic conversations now replay prior assistant tool calls using the same sanitized provider tool names, so chat-driven ideation board edits can continue across tool loops without invalid request errors.

## [0.46.23] - 2026-04-10

### Fixed
- Project Ideation connection routing now evaluates nearby card bounds and prefers obstacle-avoiding corridors so relationship lines are less likely to cut through cards on dense boards.
- Spline link mode now renders each relationship as a single smooth curve instead of relation-specific multi-join splines that could introduce awkward extra bends.

## [0.46.22] - 2026-04-10

### Fixed
- Project Ideation requests are now explicitly treated as TDD-not-applicable research/planning work, preventing the implementation write gate from blocking external evidence gathering during board creation.
- Ideation thinking summaries no longer surface red-to-green TDD status lines that only apply to coding workflows.

## [0.46.21] - 2026-04-10

### Fixed
- Project Ideation relationship anchors now use each card's actual rendered footprint at the current zoom/detail level, so links continue to meet the card edge correctly as the canvas changes scale.
- Empty-canvas deselection now persists until the operator selects a card or link again, so unrelated-card desaturation clears correctly instead of being reintroduced by auto-selection fallback.

## [0.46.20] - 2026-04-10

### Changed
- Project Ideation now uses a layered graph-aware placement pass for generated cards so inputs, framing, decisions, constraints, actions, risks, and outputs land in a more coherent default board structure.

### Fixe
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-10T03:40:38.651Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 749176bc
body-fingerprint: 9fbf8aca
-->
