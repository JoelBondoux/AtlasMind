# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.100.0] - 2026-06-18

### Changed
- **Compare Models: list every configured model, grouped by provider** (`src/views/modelComparisonPanel.ts`): the picker previously showed only routing-`enabled` models, so most of a configured provider's catalog was hidden and very few models appeared. It now mirrors the Models tree — every model from a credentialed provider is listed in a collapsible per-provider group with a provider-level "select all" (plus the global Select All); disabled models are still selectable and marked.
- **Sortable results table** (`src/views/modelComparisonPanel.ts`): results are now rendered client-side from structured data and any column header (Model, Quality, Completion, Cost, Latency, Tokens) can be clicked to sort ascending/descending. The first row in the current sort order is flagged as the leader.
- **Quality, clarified** (`src/core/executionQuality.ts` doc, panel legend): the old single "Quality" column was the coarse completion-integrity grade (error 0 · empty 0.2 · truncated 0.6 · clean 1.0), which is ~1.0 for any clean response and so unhelpful for ranking. It is now labelled **Completion** with an inline legend explaining exactly what it measures.

### Added
- **Optional LLM answer-quality judge** (`src/core/modelEvalHarness.ts`, `src/views/modelComparisonPanel.ts`): an opt-in toggle (default off) grades each model's answer 0–100 for correctness, completeness, and usefulness using a judge model you pick from your configured models. When enabled, a **Quality** column appears (with the judge's rationale on hover) and drives the ranking. New pure, unit-tested helpers `buildModelJudgePrompt` and `parseModelJudgeVerdicts` (defensive JSON parsing, id matching, score clamping) back it; the harness gained an injected `judge` hook (`ModelEvalResult.judgeScore`/`judgeRationale`). The judge is display/ranking only — the **completion grade** remains what is recorded into outcome-driven routing, so routing calibration stays consistent with normal turns.

## [0.99.1] - 2026-06-18

### Changed
- **Defer the activation-time memory freshness scan** (`src/extension.ts`): even with stale-memory auto-refresh off (v0.98.0), the `loadSsotFromDisk` step still ran the freshness *detection* — `getProjectMemoryFreshness` → `buildImportSnapshot`, which walks the entire repository to fingerprint imported sources — synchronously on the startup-critical path (observed ~4.5s on a large workspace). That scan exists only to light up the "Update Memory" badge, so it no longer sits between SSOT load and provider discovery: the SSOT is loaded from disk immediately, and the freshness scan is scheduled `MEMORY_FRESHNESS_STARTUP_DELAY_MS` (8s) after act
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-18T03:21:43.858Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 621233d9
body-fingerprint: f5f9cc98
-->
