# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.72.1] - 2026-06-07

### Added
- **`completionCriteria` field on `AgentDefinition`** (`src/types.ts`): optional `incompletePatterns` regex array that the orchestrator matches against the final response before accepting task completion. When a match is found, a re-prompt is injected asking the agent to either finish outstanding work or declare explicit unresolved blockers.
- **`definitionOfDoneChecker` hook on `OrchestratorHooks`** (`src/types.ts`): caller-injectable async gate invoked once after the agentic loop produces its final response. Returns `{ passed, blockers }` — when blockers are present the orchestrator re-prompts for one additional turn before surfacing the response.
- **Completion-integrity reprompt gate** (`src/core/orchestrator.ts` `runAgenticLoop`): before any loop exit, AtlasMind now checks the final response for language that signals incomplete delivery (e.g. "not yet wired", "important follow-up", "focused verification is still incomplete"). On a match a single structured re-prompt is injected requiring the agent to either complete the work or write an explicit **Unresolved blockers** section. The gate fires at most once per task to avoid infinite loops.
- **`looksLikeIncompleteDelivery` / `buildCompletionIntegrityReprompt` helpers** (`src/core/orchestrator.ts`): pure functions backing the completion gate; independently testable.

### Changed
- **Synthesis prompt** (`src/core/orchestrator.ts` `synthesize`): rewritten from a descriptive request into five strict rules. Rule 1: a task is only complete when wired end-to-end and verified. Rule 2: unresolved work must appear as a prominent **Unresolved blockers** section. Rule 3: test files invisible to the runner must be flagged as verification gaps. Rule 4: a passing overall test suite cannot mask absence of coverage for the specific change. Rule 5: be concise about successes, explicit about failures.
- **TDD missing-status warning** (`src/chat/participant.ts`): when `tddStatus === 'missing'`, an explicit ⚠️ bullet is now emitted in the thought summary reminding the user to verify test coverage manually and confirm test files are visible to the project's test runner.

## [0.72.0] - 2026-06-07

### Added
- **Live local model catalog sync** (`src/providers/localModelCatalogSync.ts`): fetches currently trending models from Ollama (via ollamadb.dev) and Hugging Face Hub (GGUF models sorted by downloads) and caches results in VS Code `globalState` with a 24-hour TTL. A bundled fallback (`data/local-model-catalog.json`) is used when both APIs are unreachable. The catalog feeds into `getLocalModelRecommendationCandidates` with priority: workspace override JSON > live/bundled synced 
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-07T17:52:00.466Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 0b0b6069
body-fingerprint: 8e08acfd
-->
