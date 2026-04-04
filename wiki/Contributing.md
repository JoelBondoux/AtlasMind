# Contributing

Thank you for your interest in contributing to AtlasMind! This guide covers development setup, conventions, and how to add new features.

## Development Setup

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- **VS Code** ≥ 1.95.0
- **Git**

### Getting Started

```bash
git clone https://github.com/JoelBondoux/AtlasMind.git
cd AtlasMind
npm install
```

### Build

```bash
npm run compile      # One-shot TypeScript compilation
npm run watch        # Watch mode (recommended during development)
```

### Test

```bash
npm test             # Run all Vitest tests
```

### Lint

```bash
npm run lint         # ESLint
```

### Package

```bash
npx vsce package     # Produces a .vsix file
```

### Run in VS Code

1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. The `@atlas` chat participant becomes available

---

## TypeScript Conventions

- **Strict mode** is enabled — no implicit `any`
- Use `.js` extension on **all** relative imports (Node16 module resolution)
- Prefer `type` imports for types only used in type positions:
  ```typescript
  import type { ModelInfo } from '../types.js';
  ```
- One class per file for core services
- All shared interfaces live in `src/types.ts` — never duplicate types across files

---

## File Organisation

| Directory | Purpose |
|-----------|---------|
| `src/core/` | Core services (orchestrator, agents, skills, router, planner) |
| `src/chat/` | Chat participant and slash commands |
| `src/providers/` | LLM provider adapters |
| `src/skills/` | Built-in skill implementations |
| `src/memory/` | Memory manager and scanner |
| `src/mcp/` | MCP client and server registry |
| `src/views/` | Webview panels and tree views |
| `src/voice/` | Voice (TTS/STT) integration |
| `src/bootstrap/` | Project bootstrap and import |
| `tests/` | Vitest test suites (mirrors `src/` structure) |
| `docs/` | Technical documentation |

---

## Commit Conventions

Use **Conventional Commits**:

```
feat: add new skill for Docker management
fix: prevent path traversal in memory-write
docs: update routing algorithm documentation
refactor: extract cost calculation into helper
chore: update dependencies
```

### Every Commit Must Include:

1. **Version bump** in `package.json` using [Semantic Versioning](https://semver.org/):
   - **PATCH** (0.0.x): bug fixes, docs, refactors
   - **MINOR** (0.x.0): new features, new commands, new UI
   - **MAJOR** (x.0.0): breaking changes to config, agent definitions, or memory format
2. **CHANGELOG.md entry** matching the version bump
3. **Documentation updates** for any changed interfaces (see table below)

---

## Documentation Maintenance Matrix

When you make any of these changes, update the corresponding docs:

| Change | Files to Update |
|--------|----------------|
| Add/remove/rename a source file | `README.md`, `docs/architecture.md`, `docs/development.md` |
| Add/modify a command | `README.md`, `package.json` |
| Add/modify a chat slash command | `README.md`, `package.json` |
| Add/modify a configuration setting | `README.md`, `package.json` |
| Add/modify a type in `types.ts` | `docs/architecture.md` |
| Add/modify an agent feature | `docs/agents-and-skills.md` |
| Add/modify a skill | `docs/agents-and-skills.md` |
| Add/modify the model router | `docs/model-routing.md` |
| Add/modify a provider adapter | `docs/model-routing.md`, `CONTRIBUTING.md` |
| Add/modify the SSOT memory | `docs/ssot-memory.md` |
| Add/modify webview panels | `docs/development.md` |
| Add/modify tree views | `README.md`, `docs/architecture.md` |
| Change build config or dependencies | `docs/development.md`, `README.md` |
| Ship a new version | `CHANGELOG.md`, `package.json` |

---

## Adding a Provider

1. Create `src/providers/<name>.ts` implementing the `ProviderAdapter` interface from `adapter.ts`
2. Register the adapter in `src/providers/index.ts`
3. Add the provider ID to `ProviderId` in `src/types.ts`
4. Add model metadata to the model catalog
5. Update `docs/model-routing.md` and `CONTRIBUTING.md`

---

## Adding a Skill

1. Create the skill file in `src/skills/`
2. Export a factory function returning a `SkillDefinition`
3. Register in `src/skills/index.ts`
4. Add tests in `tests/skills/`
5. Update `docs/agents-and-skills.md`

---

## Adding an Agent

Default agents are defined in `src/extension.ts` during activation. To add a new built-in agent:

1. Add the `AgentDefinition` in `activate()` with `builtIn: true`
2. Register via `agentRegistry.registerAgent()`
3. Update `docs/agents-and-skills.md`

---

## Quality Gates

Before submitting:

- [ ] `npm run compile` passes with 0 errors
- [ ] `npm test` — all suites pass
- [ ] `npm run lint` — no new warnings
- [ ] Version bumped in `package.json`
- [ ] `CHANGELOG.md` entry added
- [ ] Relevant docs updated
- [ ] Commit message follows conventional format

---

## Code of Conduct

Be respectful, constructive, and inclusive. We follow standard open-source community guidelines.
