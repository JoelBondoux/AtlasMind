# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-04-03

### Added
- Added five built-in skills: `file-read`, `file-write`, `file-search`, `memory-query`, `memory-write` (`src/skills/`).
- Added `SkillExecutionContext` interface in `types.ts` for injectable workspace and memory access; skills are independently testable without VS Code.
- Added multi-turn agentic tool-call loop to `Orchestrator`: executes tool calls requested by the model and feeds results back until a final text response is returned, capped at 10 iterations.
- Added tool calling support to `CopilotAdapter` using VS Code LM API `LanguageModelToolCallPart` / `LanguageModelToolResultPart`.
- Added `ToolDefinition` and `ToolCall` types to the shared `ProviderAdapter` contract.
- Added `tests/__mocks__/vscode.ts` stub and updated `vitest.config.ts` to alias `vscode` so orchestrator unit tests run without a VS Code runtime.
- Added 13 new unit tests across skill and orchestrator test suites (18 passing total).

### Changed
- Updated `SkillDefinition` to replace `handler: string` and `toolSchema?` with `parameters` (JSON Schema) and an `execute` function.
- Updated `buildSkillExecutionContext()` in `extension.ts` to implement workspace FS operations with path-traversal guard on `writeFile`.
- Expanded coverage `include` in `vitest.config.ts` to cover `src/skills/**`.

## [0.3.0] - 2026-04-03

### Added
- Added extension-wide governance scaffolding support to bootstrap flow for any target project (`.github` templates, CI baseline, CODEOWNERS, and `.vscode/extensions.json`).

### Changed
- Updated chat `/bootstrap` command to execute real bootstrap flow instead of returning a placeholder response.

## [0.2.0] - 2026-04-03

### Added
- Added baseline unit tests for `ModelRouter` and `CostTracker` using Vitest.
- Added CI workflow at `.github/workflows/ci.yml` to run compile, lint, tests, and coverage on pushes and pull requests to `master`.
- Added GitHub governance templates: `.github/pull_request_template.md`, issue templates, and `.github/CODEOWNERS`.
- Added team extension recommendations in `.vscode/extensions.json`.

### Changed
- Added test scripts (`test`, `test:watch`, `test:coverage`) and testing dependencies in `package.json`.
- Added ESLint configuration with TypeScript support in `.eslintrc.cjs`.
- Updated documentation for testing workflow, CI quality gates, and branch/PR/issue governance expectations.

## [0.1.0] - 2026-04-03

### Added
- Added `ProviderRegistry` and a `local` fallback adapter (`local/echo-1`) to enable an executable end-to-end path without external SDK dependencies.
- Registered default provider metadata and default agent at activation.
- Added an Anthropic provider adapter (`src/providers/anthropic.ts`) with SecretStorage key lookup and retry handling for rate limits and transient server errors.
- Added a GitHub Copilot provider adapter (`src/providers/copilot.ts`) using VS Code's Language Model API.

### Changed
- Replaced orchestrator stub flow with an MVP pipeline: agent selection, memory query, model routing, provider dispatch, and cost recording.
- Implemented model routing scoring based on budget/speed/quality heuristics over enabled provider models.
- Implemented disk-backed SSOT indexing and ranked keyword retrieval in `MemoryManager`.
- Wired freeform `@atlas` chat messages through the orchestrator and implemented `/memory` query output.
- Updated memory sidebar view to display indexed SSOT entries.
- Updated cost calculation to use per-model pricing metadata and provider-reported token usage.
- Updated chat routing defaults to prefer the Copilot provider when available.

## [0.0.2] - 2026-04-03

### Changed
- Hardened webview security by replacing inline handlers with nonce-protected scripts and stricter CSP rules.
- Validated all webview messages before accepting configuration changes or provider actions.
- Moved provider credential handling to VS Code SecretStorage instead of placeholder UI-only flows.
- Made project bootstrapping safer by rejecting unsafe SSOT paths and by creating only missing files and folders.
- Updated project documentation and Copilot instructions to enforce a safety-first and security-first development model.

## [0.0.1] - 2026-04-03

### Added
- Extension scaffolding with `package.json` manifest and TypeScript build.
- Chat participant `@atlas` with slash commands: `/bootstrap`, `/agents`, `/skills`, `/memory`, `/cost`.
- Sidebar tree views: Agents, Skills, Memory (SSOT), Models.
- Webview panels: Model Provider management, Settings (budget/speed sliders).
- Core architecture stubs: Orchestrator, AgentRegistry, SkillsRegistry, ModelRouter, CostTracker.
- Memory manager stub with SSOT folder definitions.
- Project bootstrapper: Git init prompt, SSOT folder creation, project type selection.
- Provider adapter interface (`ProviderAdapter`) for normalised LLM access.
- Shared type definitions (`types.ts`): agents, skills, models, routing, cost tracking.
- Activity bar icon and sidebar container.
- Full documentation set: README, CHANGELOG, CONTRIBUTING, architecture guides.
- Copilot instruction set (`.github/copilot-instructions.md`) for documentation maintenance.
