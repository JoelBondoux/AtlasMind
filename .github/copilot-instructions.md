# AtlasMind — Copilot Instructions

You are working on **AtlasMind**, a VS Code extension that provides a multi-agent orchestrator with model routing, long-term memory (SSOT), and a skills registry.

## Critical Rules

### Safety-First Principle
- AtlasMind defaults to the safest reasonable behavior, not the most permissive one.
- Treat every boundary as untrusted: chat input, webview messages, workspace files, model output, and tool parameters.
- Validate before executing, redact before sending, confirm before destructive changes, and deny by default when behavior is ambiguous.
- Security-sensitive regressions are treated as correctness bugs, not polish items.

### Documentation Maintenance
When you make **any** of the following changes, you **MUST** update the corresponding documentation:

| Change | Files to update |
|---|---|
| Add/remove/rename a source file | `README.md` (Project Structure), `docs/architecture.md` (Dependency Graph), `docs/development.md` (Project Structure), `wiki/Architecture.md` |
| Add/modify a command | `README.md` (Extension Commands), `package.json`, `wiki/Chat-Commands.md` |
| Add/modify a chat slash command | `README.md` (Slash Commands), `package.json`, `wiki/Chat-Commands.md` |
| Add/modify a configuration setting | `README.md` (Configuration), `package.json`, `wiki/Configuration.md` |
| Add/modify a type in `types.ts` | `docs/architecture.md` (Key Interfaces), `wiki/Architecture.md` |
| Add/modify an agent-related feature | `docs/agents-and-skills.md`, `wiki/Agents.md` |
| Add/modify a skill | `docs/agents-and-skills.md`, `wiki/Skills.md` |
| Add/modify the model router | `docs/model-routing.md`, `wiki/Model-Routing.md` |
| Add/modify a provider adapter | `docs/model-routing.md`, `CONTRIBUTING.md`, `wiki/Model-Routing.md` |
| Add/modify the SSOT/memory system | `docs/ssot-memory.md`, `wiki/Memory-System.md` |
| Add/modify webview panels | `docs/development.md` (Webview Development), `wiki/Architecture.md` |
| Add/modify tree views | `README.md`, `docs/architecture.md`, `wiki/Architecture.md` |
| Change build config or dependencies | `docs/development.md`, `README.md` (Quick Start), `wiki/Contributing.md` |
| Ship a new version | `CHANGELOG.md`, `package.json` (version), `wiki/Changelog.md` |
| Add/modify tool approval or safety | `wiki/Tool-Execution.md`, `wiki/Security.md` |
| Add/modify project planner or scheduler | `wiki/Project-Planner.md` |

### Version Tracking
- Version is in `package.json` → `"version"`.
- Current version: **0.32.0**.
- Every commit must include a version bump in `package.json` using SemVer.
- Every version bump must include a matching `CHANGELOG.md` entry in the same commit.
- Use [Semantic Versioning](https://semver.org/):
  - **PATCH** (0.0.x): bug fixes, docs, refactors.
  - **MINOR** (0.x.0): new features, new commands, new UI.
  - **MAJOR** (x.0.0): breaking changes to config, agent definitions, or memory format.

## Architecture Awareness

### Entry Point
- `src/extension.ts` — `activate()` creates all core services and registers commands/views.
- Services are bundled into `AtlasMindContext` and passed to all registrations.

### Core Services
| Service | File | Purpose |
|---|---|---|
| `Orchestrator` | `src/core/orchestrator.ts` | Task routing: select agent → gather memory → pick model → execute → record cost |
| `AgentRegistry` | `src/core/agentRegistry.ts` | CRUD for `AgentDefinition` objects |
| `SkillsRegistry` | `src/core/skillsRegistry.ts` | CRUD for `SkillDefinition` objects + agent-skill resolution |
| `ModelRouter` | `src/core/modelRouter.ts` | Budget/speed-aware model selection |
| `CostTracker` | `src/core/costTracker.ts` | Per-session cost accumulation |
| `MemoryManager` | `src/memory/memoryManager.ts` | SSOT folder read/write/search |

### UI Surfaces
| Surface | File | Description |
|---|---|---|
| `@atlas` chat participant | `src/chat/participant.ts` | Chat bar with slash commands |
| Sidebar tree views | `src/views/treeViews.ts` | Agents, Skills, Memory, Models trees |
| Model Provider panel | `src/views/modelProviderPanel.ts` | API key management webview |
| Settings panel | `src/views/settingsPanel.ts` | Budget/speed sliders webview |

### Type System
- All shared interfaces live in `src/types.ts`.
- Provider adapters are defined in `src/providers/adapter.ts`.
- Never duplicate type definitions across files.

## Coding Standards

### TypeScript
- **Strict mode** is enabled — no implicit `any`.
- Use `.js` extension on **all** relative imports (Node16 module resolution).
- Prefer `type` imports for types only used in type positions.
- One class per file for core services.

### Security
- API keys go in VS Code `SecretStorage`, never in settings or source.
- Webview HTML must use `escapeHtml()` from `webviewUtils.ts`.
- Webview scripts must be nonce-protected; do not use inline event handlers like `onclick`.
- All webview messages must be validated before mutating configuration, touching secrets, or invoking commands.
- File-system features must reject path traversal and default to non-destructive behavior.
- Memory retrieval and model execution must preserve a redaction boundary for secrets and sensitive project data.

### Commits
- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- Include doc updates in the same commit as the code change.
- Include an appropriate SemVer version bump in `package.json` and a matching `CHANGELOG.md` entry in every commit.

## SSOT Memory Folders
```
project_memory/
  project_soul.md, architecture/, roadmap/, decisions/, misadventures/,
  ideas/, domain/, operations/, agents/, skills/, index/
```
Defined as `SSOT_FOLDERS` in `src/types.ts`.

## Documentation Files
| File | Contents |
|---|---|
| `README.md` | User-facing overview, commands, config, structure |
| `CHANGELOG.md` | Version history in Keep a Changelog format |
| `CONTRIBUTING.md` | Dev setup, conventions, how to add providers/agents/skills |
| `docs/architecture.md` | System diagram, activation flow, data flow, dependency graph |
| `docs/model-routing.md` | Routing algorithm, budget/speed modes, provider list |
| `docs/ssot-memory.md` | SSOT folder details, retrieval, bootstrapping, security |
| `docs/agents-and-skills.md` | Agent and skill definitions, selection, context bundles |
| `docs/development.md` | Build, lint, run, test, package, TypeScript conventions |

## Wiki Pages (`wiki/`)

The GitHub Wiki is published from the `wiki/` directory. When any docs-level change is made, the corresponding wiki page **must** also be updated and pushed to the wiki repo.

| Wiki Page | Mirrors |
|---|---|
| `wiki/Home.md` | Project overview, navigation |
| `wiki/Getting-Started.md` | Installation, first steps |
| `wiki/Architecture.md` | `docs/architecture.md` |
| `wiki/Chat-Commands.md` | Slash commands and extension commands from `README.md` / `package.json` |
| `wiki/Agents.md` | Agent features from `docs/agents-and-skills.md` |
| `wiki/Skills.md` | Skill features from `docs/agents-and-skills.md` |
| `wiki/Model-Routing.md` | `docs/model-routing.md` |
| `wiki/Memory-System.md` | `docs/ssot-memory.md` |
| `wiki/Project-Planner.md` | Planner, scheduler, run history |
| `wiki/Tool-Execution.md` | Approval, safety, webhooks |
| `wiki/Configuration.md` | All `atlasmind.*` settings from `package.json` |
| `wiki/Security.md` | Security boundaries, threat model |
| `wiki/Contributing.md` | `CONTRIBUTING.md` |
| `wiki/FAQ.md` | Troubleshooting, common questions |
| `wiki/Comparison.md` | Feature comparison table |
| `wiki/Changelog.md` | `CHANGELOG.md` highlights |
| `wiki/_Sidebar.md` | Wiki navigation sidebar |
