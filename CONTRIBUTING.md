# Contributing to AtlasMind

## Development Setup

1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```

2. Compile:
   ```bash
   npm run compile
   ```

3. Press **F5** in VS Code to launch the Extension Development Host.

4. Use watch mode during development:
   ```bash
   npm run watch
   ```

5. Run quality checks before opening a PR:
   ```bash
   npm run lint
   npm run test
   npm run compile
   ```

## Project Conventions

### TypeScript
- Strict mode enabled. No `any` unless unavoidable.
- ES2022 target, Node16 module resolution.
- All imports use `.js` extension (required by Node16).
- Shared types go in `src/types.ts`.

### File Organisation
- **One class per file** for core services (orchestrator, registries, router).
- **Views** live in `src/views/`.
- **Provider adapters** live in `src/providers/`. Each provider gets its own file.
- **Barrel exports** (`index.ts`) for each module directory.

### Commits
- Use conventional commit messages: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- Every commit is pushed to the remote.
- Every commit includes an appropriate SemVer bump in `package.json` and a matching `CHANGELOG.md` update.

### Branching and Pull Requests
- Branch from `master` using descriptive names (for example `feat/provider-health-checks`).
- Open pull requests early and link the governing issue.
- Complete all PR checklist items from `.github/pull_request_template.md`.
- Require review from `CODEOWNERS` on touched areas.
- Merge only when CI checks pass.

### Issues and Project Tracking
- Create bugs and features using the issue templates under `.github/ISSUE_TEMPLATE/`.
- Apply labels for type, priority, and status.
- Add issues and PRs to the GitHub Project board with clear status.
- Keep acceptance criteria explicit before implementation starts.

### Documentation
- **Always** update docs when changing public interfaces, adding features, or modifying architecture.
- Copilot instructions (`.github/copilot-instructions.md`) enforce this automatically.
- Architecture docs live in `docs/`.

### Security
- API keys are stored in VS Code `SecretStorage` — never in settings or source control.
- Webview CSP is locked down with nonce-protected scripts and no inline event handlers.
- All user input displayed in webviews is HTML-escaped.
- Vulnerability disclosures must follow [SECURITY.md](SECURITY.md); do not use public issues for security reports.

### Safety-First Review Checklist
- Validate every message crossing the webview or tool boundary.
- Prefer deny-by-default behavior for file writes, command execution, and provider access.
- Never write secrets to the workspace, logs, settings, or SSOT memory.
- Avoid destructive filesystem behavior unless the user explicitly confirms it.
- Document every new security-sensitive behavior in `README.md` and the relevant file in `docs/`.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full system design.
See [docs/github-workflow.md](docs/github-workflow.md) for branch, PR, issue, and project standards.

### Key Design Principles
1. **Incremental** — features are stubbed first, then implemented.
2. **Modular** — each subsystem (routing, memory, agents) is independently testable.
3. **Cost-aware** — every LLM call is tracked and constrained by user preferences.
4. **Memory-first** — the SSOT is the canonical source of project knowledge.

## Adding a New Provider

1. Create `src/providers/<name>.ts` implementing `ProviderAdapter`.
2. Export it from `src/providers/index.ts`.
3. Register it in the `ModelRouter` during activation.
4. Add its config to the Model Provider webview.
5. Update `docs/model-routing.md` and this file.

Reference implementation:
- `src/providers/anthropic.ts` demonstrates SecretStorage credential lookup, retry handling for `429`/`5xx`, and usage token parsing.
- `src/providers/copilot.ts` demonstrates VS Code Language Model API integration for GitHub Copilot-backed execution.
- `src/providers/openai-compatible.ts` demonstrates a reusable adapter pattern for OpenAI-compatible APIs (OpenAI, Gemini-compatible endpoint, DeepSeek, Mistral, z.ai).

Provider model catalogs are refreshed at startup and via the Model Providers panel.
When adding a provider, ensure `listModels()` returns discoverable model IDs whenever the upstream API supports it.

## Adding a New Agent

1. Define the agent in `project_memory/agents/` (or programmatically).
2. Register it via `AgentRegistry.register()`.
3. Update `docs/agents-and-skills.md` if it introduces new patterns.

## Adding a New Skill

1. Create a handler module.
2. Define the `SkillDefinition` with a JSON Schema for tool parameters.
3. Register it via `SkillsRegistry.register()`.
4. Assign it to agents that need it.
