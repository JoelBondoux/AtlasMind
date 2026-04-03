# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.0.1] — 2026-04-03

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
