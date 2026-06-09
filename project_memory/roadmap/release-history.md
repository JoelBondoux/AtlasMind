# Release History Snapshot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.73.5] - 2026-06-09

### Fixed
- **`github-operator` agent — chained instructions, auto commit messages, context-aware policy, publish routine** (`src/runtime/core.ts`): the built-in GitHub Operator agent now handles the full set of operational patterns exposed by the transcript review: (1) *Chained sequential ops* — requests like "commit and push" or "stage, commit, and push" are now executed sequentially in a single turn without pausing for confirmation between steps. (2) *Auto commit-message generation* — when no message is supplied, the agent runs `git diff --staged --stat` and composes a conventional commit message (feat:/fix:/docs:/chore:/refactor:) from the actual diff instead of asking the user or producing verbose explanations. (3) *Context-aware push target* — the agent derives the correct push-target branch, protected-branch rules, release-hygiene requirements, and publish routine from the injected workspace context (populated by the AI Instructions sync from CLAUDE.md, `.github/copilot-instructions.md`, or equivalent) rather than reading project files at runtime. (4) *Release-hygiene enforcement* — version-bump and changelog requirements are read from the workspace context and carried out in the same commit. (5) *Publishing routine* — when asked to publish or ship, the agent follows the routine from the workspace context and executes every step in sequence, reporting the outcome per step. (6) *Policy persistence* — when a requested policy (push target, version-bump rules, publish routine) is missing from the workspace context and the user supplies it, the agent records it immediately to `project_memory/domain/ai-instructions-sync.md` so it is available to all future tasks without the user repeating it.
- **Planner — chained git operations and release hygiene** (`src/core/planner.ts`): two new rules added to `PLANNER_SYSTEM_PROMPT`. The *chained sequential operations* rule directs the planner to model each operation in a "commit and push"-style request as a separate subtask with explicit `dependsOn` ordering. The *release hygiene* rule directs the planner to include a release-hygiene subtask (version bump + changelog) before the commit subtask and wire the commit to depend on it when the project enforces this policy.

## [0.73.4] - 2026-06-08

### Fixed
- **Responses ending with code or bare headings** (`src/core/orchestrator.ts`, `src/chat/participant.ts`): `looksLikeIncompleteDelivery` now also detects structural truncation — an odd number of fenced code blocks (unclosed fence) or a lone markdown heading at the very end of a response with no body. A new `sanitizeResponseTail` utility closes any unclosed code fence and strips the dangl
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-06-09T14:21:07.938Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 6c6e5cc3
body-fingerprint: c96ecf1f
-->
