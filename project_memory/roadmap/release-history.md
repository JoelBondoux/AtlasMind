# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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
- Clarified version presentation by labeling the README badge as the published Marketplace release and directing branch-specific source version checks to `package.json`.

## [0.39.11] - 2026-04-06

### Changed
- Added natural-language escalation for Atlas chat so prompts like "start a project run to ..." can enter `/project` execution mode without requiring the literal slash command.
- Added natural-language AtlasMind surface routing for high-confidence prompts such as opening Settings, the Cost Dashboard, Model Providers, the Project Run Center, and related panels from chat.

## [0.39.10] - 2026-04-06

### Changed
- Strengthened agent selection with common software-development routing heuristics for debugging, testing, review, architecture, frontend, backend, docs, security, devops, performance, and release-oriented requests.
- Added a visible routing trace to assistant metadata so the Thinking summary now shows the selected agent, detected routing hints, and when workspace-investigation bias was applied.

## [0.39.9] - 2026-04-06

### Changed
- Added a workspace-issue heuristic to freeform chat so bug-report style prompts inject an extra inspect-the-repo-first hint into the default agent context.
- Further reduced the chance of support-style replies for concrete AtlasMind UI or behavior regressions by biasing the model toward workspace evidence before answering.

## [0.39.8] - 2026-04-06

### Changed
- Strengthened the default AtlasMind agent prompt so freeform chat treats repo bug reports as workspace tasks to inspect and act on instead of replying like a support-triage bot.
- Kept the default fallback agent on the full enabled skill set while explicitly biasing it
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-06T08:39:27.518Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 21e096a6
body-fingerprint: cbb690e0
-->
