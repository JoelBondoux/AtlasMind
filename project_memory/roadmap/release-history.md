# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.100.1] - 2026-06-18

### Added
- **Open Knowledge Format (OKF) interoperability planning** (`docs/roadmap.md`, `project_memory/`): evaluation and design for adopting Google Cloud's Open Knowledge Format (OKF v0.1, published 2026-06-16). Rather than reformatting AtlasMind's own docs to a two-day-old spec, the plan adds OKF **import/export** — including a user-facing **"Convert project to OKF"** command that emits an ingested project as a portable, redaction-safe bundle — plus a lightweight **spec-watch sync** (modeled on the existing provider/pricing sync services) that tracks the spec as it evolves and raises an advisory on version bumps without auto-mutating memory. Captured in `project_memory/decisions/okf-alignment-evaluation.md` (verdict: align the SSOT, don't migrate wholesale), `project_memory/index/okf-frontmatter-audit.md` (AtlasMind's stores are structurally OKF-shaped but metadata-divergent, so export/import is favored over reformatting), and `project_memory/ideas/okf-interop.md`. Added to the Frontier / Horizon Watch (Horizon 1) in the human-facing roadmap. Planning only — no implementation yet.

## [0.100.0] - 2026-06-18

### Changed
- **Compare Models: list every configured model, grouped by provider** (`src/views/modelComparisonPanel.ts`): the picker previously showed only routing-`enabled` models, so most of a configured provider's catalog was hidden and very few models appeared. It now mirrors the Models tree — every model from a credentialed provider is listed in a collapsible per-provider group with a provider-level "select all" (plus the global Select All); disabled models are still selectable and marked.
- **Sortable results table** (`src/views/modelComparisonPanel.ts`): results are now rendered client-side from structured data and any column header (Model, Quality, Completion, Cost, Latency, Tokens) can be clicked to sort ascending/descending. The first row in the current sort order is flagged as the leader.
- **Quality, clarified** (`src/core/executionQuality.ts` doc, panel legend): the old single "Quality" column was the coarse completion-integrity grade (error 0 · empty 0.2 · truncated 0.6 · clean 1.0), which is ~1.0 for any clean response and so unhelpful for ranking. It is now labelled **Completion** with an inline legend explaining exactly what it measures.

### Added
- **Optional LLM answer-quality judge** (`src/core/modelEvalHarness.ts`, `src/views/modelComparisonPanel.ts`): an opt-in toggle (default off) grades each model's answer 0–100 for correctness, completeness, and usefulness using a judge model you pick from your configured models. When enabled, a **Quality** column appears (with the judge's rationale on h
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-18T03:47:22.234Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 1edc32e8
body-fingerprint: cf33f41d
-->
