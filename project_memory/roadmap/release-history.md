# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.39.18] - 2026-04-06

### Fixed
- Extended the Model Providers webview to show provider-level warning badges when routed models from that provider have failed in the current session.
- Added an overview summary count for providers with failed models so failure state is visible in both the Models tree and the provider-management workspace.

## [0.39.17] - 2026-04-06

### Fixed
- Refreshed all enabled providers at startup, including GitHub Copilot, so AtlasMind builds its live model pool from the active providers instead of deferring interactive providers until manual activation.
- Switched agent execution, escalation, and failover to use the active candidate pool directly, removing failed models from routing until the next successful refresh instead of silently dropping back to `local/echo-1`.
- Added failed-model warning state in the Models sidebar so users can see which routed models faulted and inspect the latest failure details in the tooltip.

## [0.39.16] - 2026-04-06

### Fixed
- Prevented provider failover and escalation helpers from silently falling back to `local/echo-1` when the remaining models no longer satisfy required capabilities such as `function_calling`.
- Workspace-investigation requests that exhaust capable providers now fail explicitly instead of returning a misleading local echo of the user's prompt.

## [0.39.15] - 2026-04-06

### Fixed
- Stopped retrying provider timeout errors, so hung chat requests fail promptly instead of sitting in the AtlasMind panel through multiple 30-second retry windows.
- Preserved transient retries for actual retryable provider failures such as `429`, `5xx`, or explicitly temporary upstream errors.

## [0.39.14] - 2026-04-06

### Fixed
- Added an execution-layer retry for workspace-issue prompts so AtlasMind re-prompts once for actual workspace tool use when a model answers with "I'll search" style investigation narration instead of inspecting the repo.
- Kept `local/echo-1` on the built-in offline echo path even when a local OpenAI-compatible endpoint is configured, avoiding false 404 fallbacks for the reserved local model.

## [0.39.13] - 2026-04-06

### Fixed
- Normalized slash-containing upstream model IDs from OpenAI-compatible discovery and completion responses so Google Gemini models no longer surface as a fake `models` provider during routing.
- Hardened provider resolution in chat execution, project planning, and command-driven model actions so router metadata wins when a model ID is not already safely prefixed.

## [0.39.12] - 2026-04-06

### Changed
- Streamlined the README so commands, sidebar actions, and settings stay at a summary level and point to the dedicated command and configuration reference pages.
- Clarified
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-06T09:22:05.532Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 7331d76a
body-fingerprint: 8e765fd7
-->
