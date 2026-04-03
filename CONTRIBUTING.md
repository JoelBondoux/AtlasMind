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
- Version in `package.json` is bumped and `CHANGELOG.md` is updated for each release.

### Documentation
- **Always** update docs when changing public interfaces, adding features, or modifying architecture.
- Copilot instructions (`.github/copilot-instructions.md`) enforce this automatically.
- Architecture docs live in `docs/`.

### Security
- API keys are stored in VS Code `SecretStorage` — never in settings or source control.
- Webview CSP is locked down with nonce-protected scripts and no inline event handlers.
- All user input displayed in webviews is HTML-escaped.

### Safety-First Review Checklist
- Validate every message crossing the webview or tool boundary.
- Prefer deny-by-default behavior for file writes, command execution, and provider access.
- Never write secrets to the workspace, logs, settings, or SSOT memory.
- Avoid destructive filesystem behavior unless the user explicitly confirms it.
- Document every new security-sensitive behavior in `README.md` and the relevant file in `docs/`.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full system design.

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
5. Update `docs/model-routing.md`.

## Adding a New Agent

1. Define the agent in `project_memory/agents/` (or programmatically).
2. Register it via `AgentRegistry.register()`.
3. Update `docs/agents-and-skills.md` if it introduces new patterns.

## Adding a New Skill

1. Create a handler module.
2. Define the `SkillDefinition` with a JSON Schema for tool parameters.
3. Register it via `SkillsRegistry.register()`.
4. Assign it to agents that need it.
