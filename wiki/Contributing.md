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
npm run test:coverage # Run the CI coverage gate locally
npm run monitor:integrations # Generate the curated integration drift report
npm run monitor:integrations:audit # Enforce monitoring coverage for new third-party surfaces
```

CI executes compile, lint, and tests on Ubuntu, Windows, and macOS, and publishes the coverage artifact from the Ubuntu leg only.
Dependabot handles npm and GitHub Actions updates weekly, and the scheduled integration monitor workflow raises review issues when curated VS Code extension versions move.

### Lint

```bash
npm run lint         # ESLint
```

### Package

```bash
npm run package:vsix # Produces a .vsix file with runtime dependencies included
```

AtlasMind has runtime dependencies. Do not package or publish with `--no-dependencies` unless those dependencies have been bundled into the extension output first.

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

## Branch Strategy

- `develop` is the default branch for everyday integration work.
- Create `feat/*`, `fix/*`, and `chore/*` branches from `develop`.
- Keep `master` release-ready and use it only when intentionally publishing a new pre-release.
- Do not push routine work directly to `master`; promote `develop` into `master` by PR once the build is ready to ship.
- Treat `develop` as the normal destination for development push requests.

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

If the provider should work in both the extension and the CLI, keep it free of direct `vscode` imports and use the shared secret contract in `src/runtime/secrets.ts`. Shared provider bootstrapping now flows through the runtime builder rather than being duplicated per host.

AtlasMind's `local` provider supports both an offline echo fallback and a configurable OpenAI-compatible local endpoint through `src/providers/registry.ts`. Azure OpenAI uses the same reusable adapter with deployment-backed routing, while Bedrock uses a dedicated SigV4-signed adapter. OpenAI-compatible providers also normalize upstream model IDs into AtlasMind's internal `provider/model` format during discovery and execution so routing metadata stays consistent. If you change any of those paths, update the routing and configuration docs as well.

When changing routing heuristics, validate both low-stakes and high-stakes follow-up prompts. Free or local models should stay attractive for simple turns, but they should not dominate later thread-based requests when the task profile signals higher reasoning demand.

If an upstream API is not a routed chat backend, or it requires modality-specific workflows, keep it on the specialist integration surface instead of forcing it into the routed provider list.

Minimum validation for provider work:

- Add or update adapter-level tests in `tests/providers/`.
- Add routing or orchestrator regression coverage when the change affects failover, health, pricing, or capability selection.
- Update `.github/integration-monitor.json` when the new provider introduces a third-party dependency or monitoring obligation.

## Debugging Orchestration And Concurrency

1. Confirm whether the issue is in agent selection, skill availability, provider routing, or tool execution before editing shared orchestrator code.
2. Inspect Project Run Center state, `ProjectRunHistory`, and webhook events for autonomous-run failures.
3. Use `diagnostics` and `workspace-observability` to capture editor-state evidence instead of guessing from the final model response alone.
4. For race-condition or dependency-order problems, add a focused scheduler or integration regression before changing concurrency behavior.
5. For routing regressions, add coverage near `tests/core/orchestrator.tools.test.ts` or the relevant provider tests before changing heuristics.

AtlasMind does not yet ship a formal load-test harness. For performance-sensitive changes, repeated local execution and targeted regression tests are the current required bar.

## Adding A Runtime Plugin

The shared runtime now supports `AtlasRuntimePlugin` contributions through `src/runtime/core.ts`.

1. Create an `AtlasRuntimePlugin` object in your host or integration layer.
2. Register capabilities through `registerAgent()`, `registerSkill()`, or `registerProvider()`.
3. Optionally listen to runtime lifecycle events for diagnostics or tracing.
4. Pass the plugin to `createAtlasRuntime({ plugins: [...] })`.
5. Add runtime tests in `tests/runtime/` and update the architecture or development docs.

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

Coverage thresholds are currently enforced for service-layer modules under `src/core`, `src/skills`, `src/memory`, `src/providers`, `src/mcp`, and `src/bootstrap`.
Webview-heavy `src/views` code and chat participant wiring in `src/chat` are excluded from the enforced threshold until dedicated integration tests are added.
CI runs compile, lint, and tests on Ubuntu, Windows, and macOS, with coverage upload restricted to the Ubuntu matrix job to avoid duplicate artifact collisions.
External integration drift is reviewed separately through `.github/dependabot.yml`, `.github/integration-monitor.json`, and `.github/workflows/integration-monitor.yml`.

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
