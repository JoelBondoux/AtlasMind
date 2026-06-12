# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.79.1] - 2026-06-11

### Fixed
- **Testing methodology runtime path** (`src/core/orchestrator.ts`, `src/core/testingConfigLoader.ts`): restored and verified the methodology inference / model-override path used for testing-related tasks, including the system-prompt methodology hint that improves routing behavior even when no explicit override is present.
- **Release handoff readiness** (`package.json`, `README.md`, `docs/architecture.md`, `wiki/Architecture.md`): aligned the current source version and architecture notes with the verified 0.79.1 release state.

## [0.78.8] - 2026-06-11

### Changed
- **Publishing routine in `CLAUDE.md`**: publish step now explicitly requires the PR to be merged into `master` before running `npm run publish:release`. Prevents Marketplace releases that don't correspond to a clean `master`. Also documents `NODE_OPTIONS="--use-system-ca"` as the required publish command on Windows.

## [0.78.7] - 2026-06-11

### Changed
- **ESLint cleanup** (`src/types.ts`): removed now-unused `eslint-disable` directive for `no-empty-object-type`; the `string & {}` open-union pattern is not flagged by the `@typescript-eslint` v8 recommended ruleset.

## [0.78.6] - 2026-06-11

### Fixed
- **CI `npm ci` failure** (`package-lock.json`, `src/types.ts`): lockfile was out of sync with `package.json` after the 0.78.3 tooling upgrades — CI rejected the mismatch. Lockfile regenerated against the correct installed packages. `@typescript-eslint/ban-types` (removed in v8) replaced with `@typescript-eslint/no-empty-object-type` in the inline disable comment in `src/types.ts`.

## [0.78.5] - 2026-06-11

### Fixed
- **Package build** (`package.json`): `engines.vscode` bumped from `^1.95.0` to `^1.116.0` to match the `@types/vscode` version already in devDependencies; `vsce package` previously refused to build with a mismatched constraint.

## [0.78.4] - 2026-06-11

### Fixed
- **Local provider not showing after save** (`src/views/modelProviderPanel.ts`): The Model Providers panel now subscribes to the `modelsRefresh` event so it reloads automatically when a local endpoint (LM Studio, Ollama, etc.) is saved in the Settings panel. Previously, the endpoint was persisted correctly but the panel UI stayed stale until manually reopened.

## [0.78.3] - 2026-06-11

### Changed
- **Dev-tooling major upgrades** (`package.json`, `package-lock.json`):
  - `typescript` 5.4 → 6.0.3 (verified: zero compile errors, all 908 tests pass)
  - `eslint` 8.57 → 10.4.1 (flat config already in use; lints clean)
  - `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser` 7 → 8.61.0
  - `@types/node` 20 → 25.9.3
  - `@vitest/coverage-v8` 4
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-11T20:04:57.860Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 808a33af
body-fingerprint: 29388286
-->
