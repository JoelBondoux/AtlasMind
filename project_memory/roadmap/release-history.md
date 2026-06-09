# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.73.4] - 2026-06-08

### Fixed
- **Responses ending with code or bare headings** (`src/core/orchestrator.ts`, `src/chat/participant.ts`): `looksLikeIncompleteDelivery` now also detects structural truncation — an odd number of fenced code blocks (unclosed fence) or a lone markdown heading at the very end of a response with no body. A new `sanitizeResponseTail` utility closes any unclosed code fence and strips the dangling heading before the text enters the session transcript, preventing the stale artifact from contaminating subsequent turns.
- **"New Session" mode silently discarded when selected while busy** (`media/chatPanel.js`): `applyComposerModePreference` previously cleared the `queuedComposerMode` when `isBusy` was true at the moment the user selected "New Session" from the send-mode dropdown (webview state lag). The queued intent is now always stored; `submitPrompt` already guards against submitting it as a `new-session` while still busy (it overrides to `steer`), and the queued mode is now preserved across that steer submission so the intent is honoured on the next idle message instead of being silently lost.

## [0.73.3] - 2026-06-08

### Changed
- **Comparison matrix rewritten** (`wiki/Comparison.md`): replaced single 7-column table with structured sections (Editor Integration, Model Routing, Memory & Context, Skills & Tools, Safety & Operations, I/O & Integrations, Licensing). Added **Windsurf** and **Continue** as new comparison targets. Added rows for inline completions (honest ❌), speed-aware routing, local model sync, adaptive routing from outcomes, deprecation-aware routing, dispatch-time secret redaction, per-session context carry-forward, auto-synthesized skills, workspace sandbox, TDD gate, webhook integration, and CLI companion. Expanded Key Differentiators with vs. Cline, vs. Windsurf, and vs. Continue sections. Added an explicit "Honest Gaps" section (no inline completions, no diff UI, no cloud agent pool).

## [0.73.2] - 2026-06-08

### Changed
- **Documentation updated** for all 0.72.2, 0.73.0, and 0.73.1 changes: `README.md` project structure, `docs/architecture.md`, `docs/model-routing.md`, `docs/ssot-memory.md`, `wiki/Architecture.md`, `wiki/Changelog.md`, `wiki/Memory-System.md`, `wiki/Model-Routing.md`, `wiki/Security.md`, `wiki/Tool-Execution.md`.

## [0.73.1] - 2026-06-08

### Added
- **Secret redactor utility** (`src/utils/secretRedactor.ts`): new pattern-based secret scanner covers Anthropic keys, OpenAI keys, GitHub tokens, bearer tokens, PEM private keys, database connection strings, and generic key/secret assignments. `redactSecrets()` returns a `RedactionResult` with match count and matched pattern n
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-08T20:16:44.581Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 9bef74a5
body-fingerprint: 74d09e34
-->
