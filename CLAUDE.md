# AtlasMind — Claude Code Instructions

You are working on **AtlasMind**, a VS Code extension providing a multi-agent orchestrator with model routing, long-term memory (SSOT), and a skills registry.

## Critical Rules

### Safety-First
- AtlasMind defaults to the safest reasonable behavior, not the most permissive one.
- Treat every boundary as untrusted: chat input, webview messages, workspace files, model output, and tool parameters.
- Validate before executing, redact before sending, confirm before destructive changes, deny by default when behavior is ambiguous.
- Security-sensitive regressions are treated as correctness bugs, not polish items.

### Version and Changelog
- Current version is in `package.json` → `"version"`.
- Every meaningful change must include a version bump in `package.json` and a matching `CHANGELOG.md` entry.
- Versioning follows SemVer:
  - **PATCH** (0.0.x): bug fixes, docs, refactors.
  - **MINOR** (0.x.0): new features, new commands, new UI.
  - **MAJOR** (x.0.0): breaking changes to config, agent definitions, or memory format.

### Documentation Maintenance
When you make any of the following changes, update the corresponding documentation in the same pass:

| Change | Files to update |
|---|---|
| Add/remove/rename a source file | `README.md` (Project Structure), `docs/architecture.md`, `docs/development.md`, `wiki/Architecture.md` |
| Add/modify a command | `README.md` (Extension Commands), `package.json`, `wiki/Chat-Commands.md` |
| Add/modify a chat slash command | `README.md` (Slash Commands), `package.json`, `wiki/Chat-Commands.md` |
| Add/modify a configuration setting | `README.md` (Configuration), `package.json`, `wiki/Configuration.md` |
| Add/modify a type in `types.ts` | `docs/architecture.md`, `wiki/Architecture.md` |
| Add/modify an agent-related feature | `docs/agents-and-skills.md`, `wiki/Agents.md` |
| Add/modify a skill | `docs/agents-and-skills.md`, `wiki/Skills.md` |
| Add/modify the model router | `docs/model-routing.md`, `wiki/Model-Routing.md` |
| Add/modify a provider adapter | `docs/model-routing.md`, `CONTRIBUTING.md`, `wiki/Model-Routing.md` |
| Add/modify the SSOT/memory system | `docs/ssot-memory.md`, `wiki/Memory-System.md` |
| Add/modify webview panels | `docs/development.md`, `wiki/Architecture.md` |
| Add/modify tree views | `README.md`, `docs/architecture.md`, `wiki/Architecture.md` |
| Change build config or dependencies | `docs/development.md`, `README.md`, `wiki/Contributing.md` |
| Ship a new version | `CHANGELOG.md`, `package.json` (version), `wiki/Changelog.md` |
| Add/modify tool approval or safety | `wiki/Tool-Execution.md`, `wiki/Security.md` |
| Add/modify project planner or scheduler | `wiki/Project-Planner.md` |

### Branching
- **`develop`** is the default branch for all implementation work and the normal push target.
- **`master`** is protected — updated only by intentional Marketplace release promotion from `develop`.
- Never push directly to `master`. Always push to `origin/develop`.

### Publishing Routine
When asked to publish or ship a release, follow these steps in order:

1. **Commit** all changes to the current working branch with a conventional commit message and version bump.
2. **Merge to `develop`**: `git checkout develop && git pull origin develop && git merge <branch> --no-ff && git push origin develop`
3. **Compile**: `npm run compile` — must produce zero TypeScript errors.
4. **Package**: `npm run package` — produces `atlasmind-<version>.vsix`.
5. **Open PR to `master`**: `gh pr create --base master --head develop` — master is protected and requires a PR; never force-push.
6. **Publish**: `npm run publish:release` — publishes to the VS Code Marketplace via `vsce`.

## Architecture Quick Reference

### Entry Point
`src/extension.ts` — `activate()` creates all core services and registers commands/views, bundled into `AtlasMindContext`.

### Core Services
| Service | File | Purpose |
|---|---|---|
| `Orchestrator` | `src/core/orchestrator.ts` | Task routing: agent → memory → model → execute → cost |
| `AgentRegistry` | `src/core/agentRegistry.ts` | CRUD for `AgentDefinition` objects |
| `SkillsRegistry` | `src/core/skillsRegistry.ts` | CRUD for `SkillDefinition` + agent-skill resolution |
| `ModelRouter` | `src/core/modelRouter.ts` | Budget/speed-aware model selection |
| `CostTracker` | `src/core/costTracker.ts` | Per-session cost accumulation |
| `MemoryManager` | `src/memory/memoryManager.ts` | SSOT folder read/write/search |

### Type System
- All shared interfaces live in `src/types.ts`.
- Provider adapters are defined in `src/providers/adapter.ts`.
- Never duplicate type definitions across files.

### SSOT Memory Layout
```
project_memory/
  project_soul.md, architecture/, roadmap/, decisions/, misadventures/,
  ideas/, domain/, operations/, agents/, skills/, index/
```
Defined as `SSOT_FOLDERS` in `src/types.ts`.

## Coding Standards

### TypeScript
- **Strict mode** is enabled — no implicit `any`.
- Use `.js` extension on all relative imports (Node16 module resolution).
- Prefer `type` imports for types only used in type positions.
- One class per file for core services.

### Security
- API keys go in VS Code `SecretStorage`, never in settings or source.
- Webview HTML must use `escapeHtml()` from `webviewUtils.ts`.
- Webview scripts must be nonce-protected; do not use inline event handlers (`onclick`, etc.).
- All webview messages must be validated before mutating configuration, touching secrets, or invoking commands.
- File-system features must reject path traversal and default to non-destructive behavior.

### Commits
- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- Include doc updates in the same commit as the code change.
- Include a SemVer version bump in `package.json` and a matching `CHANGELOG.md` entry in every commit.
