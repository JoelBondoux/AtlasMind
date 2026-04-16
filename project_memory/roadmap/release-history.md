# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.46.29] - 2026-04-16

### Fixed
- Natural language project run requests in Atlas chat (e.g. "start a run to fix X", "prepare a run based on these instructions") now open the **Project Run Center** with the goal pre-filled and a plan preview ready for review, instead of executing immediately. Users can review and authorize the plan before anything runs; the `/project` slash command remains the express path for immediate execution.
- Broadened natural language detection to recognize "prepare a run", "set up a run", "draft a run", and "start/launch/begin a run" phrasing that does not contain the word "project", closing a gap where these requests fell through to freeform chat.

## [0.46.28] - 2026-04-10

### Fixed
- The dedicated Project Ideation feedback panel now publishes only the sanitized final facilitation response instead of leaking raw tool-loop narration, provider chatter, or the generic tool-failure banner into Atlas Feedback.
- The Project Dashboard now follows the active ideation workspace when opening or summarizing ideation board artifacts, keeping dashboard links aligned with the currently selected whiteboard thread.

### Added
- Project Ideation now supports multiple named ideation workspaces with create, switch, and delete controls, while persisting the active selection in `project_memory/ideas/atlas-ideation-workspaces.json`.

## [0.46.27] - 2026-04-10

### Fixed
- Project Ideation now uses matching CSS and renderer world dimensions, which realigns cards with their connection geometry after the larger canvas bounds expansion.

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
- Multi-turn Anthropic conversations now replay prior assistant tool calls using the same
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-16T03:15:51.743Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 8b2c1175
body-fingerprint: 261a05a7
-->
