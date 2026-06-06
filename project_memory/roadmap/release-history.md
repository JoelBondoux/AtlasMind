# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Local Model Advisor in Settings**: Added a new "Scan & Recommend" panel under Models & Integrations that analyzes AtlasMind's recent local-model usage, inspects local hardware capacity (CPU, RAM, and detected GPU/VRAM), and ranks release-aware local model families to recommend the most appropriate models to keep installed. The advisor now also supports install/remove lifecycle actions: one-click install and remove for Ollama models, plus LM Studio install/remove guidance directly in the panel where stable API automation is not currently available.
- **Data-driven local recommendation registry**: Moved release-aware local model candidate definitions into `src/providers/localModelRecommendationRegistry.ts` and added validated workspace override loading from `.atlasmind/local-model-recommendations.json`. The advisor now falls back to built-in defaults automatically when overrides are absent or invalid, so future model families can be added without editing Settings panel logic.
- **Registry override coverage tests**: Added provider-level tests for local recommendation override parsing, normalization, invalid-entry filtering, and built-in fallback behavior when override content is malformed or non-array.
- **Focused provider test script**: Added `npm run test:providers:local-recommendations` to run only the local recommendation registry override and fallback test suite with dot reporting.
- **CI regression gate for local recommendation registry**: The CI quality matrix now runs `npm run test:providers:local-recommendations` as an explicit focused gate alongside the full unit-test suite.

## [0.68.1] - 2026-06-06

### Fixed
- **Self-recovery with dynamic agent/skill synthesis on empty responses**: When the primary model attempt returns no content, the orchestrator now runs two recovery steps before falling back to asking the user: (1) *Reprompt* — re-runs the agentic loop with an explicit instruction to use available workspace tools and find the answer itself; (2) *Synthesize* — if the reprompt also produces nothing, infers routing needs from the LLM classification embedded in the request, synthesizes a specialist agent (and any required skills) better suited to the task, and retries the full agentic loop with it. A `__recoveryPass` flag prevents the synthesized-agent retry from triggering another recovery cycle. Only if both steps fail does the orchestrator fall through to generating a targeted clarifying question for the user.
- **Chat panel no longer throws "Webview is disposed" errors after panel close**: Added an `_isDisposed` flag that is set at the start of `dispose()`. Both `syncState()` and `runPrompt()` now return immediately if the panel has be
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-06T17:52:23.940Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: abf943f4
body-fingerprint: 2e1128dd
-->
