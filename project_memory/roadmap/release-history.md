# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.49.40] - 2026-04-19

### Changed
- Bump version to 0.49.40 to update Marketplace README and metadata.

## [0.49.39] - 2026-04-18

### Changed
- **Live settings**: All orchestrator limits (`maxToolIterations`, `maxToolCallsPerTurn`, `toolExecutionTimeoutMs`, `providerTimeoutMs`) now propagate immediately to the running orchestrator when changed in settings — no reload required. Previously, values were frozen at extension startup.
- **Smart limit-hit prompt**: When the agentic loop hits the tool-iteration or tool-calls-per-turn cap, the chat response now shows contextual raise buttons: "Raise to N (permanent)" saves the new value to workspace settings and continues; "Raise to N (this task)" applies it in-memory for the current task only; "Continue as-is" and "Cancel" remain for the original behaviour. The suggested N is computed as `ceil(current × 1.5 / 5) × 5`, capped at the configured setting maximum.

## [0.49.38] - 2026-04-18

### Changed
- Dashboard Runtime: TDD Compliance panel now shows contextual action buttons when gaps are detected. "Ask Atlas to fix TDD gaps" opens Atlas Chat with a pre-drafted prompt describing missing evidence and blocked subtasks. "Plan a TDD fix run" opens Project Run Center with a pre-filled goal ready to preview. The existing "Open Project Run Center" button is always shown.

## [0.49.37] - 2026-04-18

### Fixed
- Chat panel: Guarded automatic composer focus restoration so live transcript and busy-state refreshes no longer steal the editor cursor after the user clicks back into another VS Code surface.

## [0.49.36] - 2026-04-18

### Changed
- Added a dedicated Testing policy highlight card to the Project Dashboard so the active tests-first policy is visible at a glance beside the framework and coverage stats.
- Added an optional workspace override label so teams can display their own wording for the testing policy while still keeping AtlasMind's underlying verification guardrails in place.

## [0.49.36] - 2026-04-18

### Changed
- Moved warning-level generated-skill review into the AtlasMind in-chat approval stack so operators can approve or keep a draft blocked without leaving the conversation flow.
- Tailored the approval card for generated skills to show the warning summary and a one-time Allow Once versus Keep Blocked choice.

## [0.49.35] - 2026-04-18

### Changed
- Auto-synthesized skills that raise warning-level scan findings now pause behind an explicit user approval prompt before AtlasMind evaluates them in-process.
- Added a review-first flow for generated skill drafts so operators can inspect the warning summary and proposed source, then either allow once or keep the draft blocked for refinement.

## [0.49.34] - 2026-04-18

### Changed

…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-19T10:58:24.525Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 61c6884f
body-fingerprint: 185a1e52
-->
