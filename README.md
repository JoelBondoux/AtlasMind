# AtlasMind

> Developer-centric multi-agent orchestrator that runs entirely inside VS Code.

AtlasMind provides a unified interface for coordinating multiple AI agents, routing requests across model providers, maintaining long-term project memory, and tracking costs — all from within your editor.

## Security First

AtlasMind is being built with a safety-first and security-first default posture:

- Provider credentials are stored in VS Code SecretStorage, never in workspace settings or the SSOT.
- Webviews use nonce-protected scripts and validate all incoming messages before acting on them.
- SSOT bootstrapping rejects unsafe paths and avoids overwriting existing content by default.
- Planned memory retrieval will include redaction before model execution so sensitive data is not sent upstream by accident.

## Status

**v0.2.0** — MVP orchestration is active with provider adapters, plus baseline CI/testing and GitHub governance templates.

## Features (planned)

| Feature | Status |
|---|---|
| Chat participant (`@atlas`) | ✅ Registered |
| Sidebar tree views (Agents, Skills, Memory, Models) | ✅ Registered |
| Model Provider webview panel | ✅ Placeholder UI |
| Settings panel (budget/speed sliders) | ✅ Placeholder UI |
| Project bootstrapper (SSOT + Git init) | ✅ Scaffold |
| Orchestrator core | 🟨 MVP flow implemented (local adapter path) |
| Model routing (budget/speed/auto) | 🟨 Heuristic scoring implemented |
| SSOT memory with embeddings | 🟨 Disk index + keyword ranking (embeddings pending) |
| Agent execution pipeline | 🟨 MVP implemented |
| Provider adapters (Claude, OpenAI, etc.) | 🟨 Local + Anthropic + Copilot adapters implemented |
| Cost tracking with real token counts | 🟨 Provider token usage supported (when adapter provides usage) |
| Unit test baseline | ✅ Vitest tests + coverage command |
| CI quality gates | ✅ Compile + lint + test + coverage in GitHub Actions |
| PR/Issue governance templates | ✅ Added |
| Git-backed patch application | 🔲 Not started |

## Quick Start

### Prerequisites

- VS Code ≥ 1.95.0
- Node.js ≥ 18
- npm ≥ 9

### Build & Run

```bash
npm install
npm run compile
```

Press **F5** to launch the Extension Development Host.

### Watch Mode

```bash
npm run watch
```

### Tests

```bash
npm run test
npm run test:coverage
```

## Chat Participant

Type `@atlas` in the VS Code chat panel to interact with the orchestrator.

### Slash Commands

| Command | Description |
|---|---|
| `/bootstrap` | Initialise a new project with SSOT memory structure and optional governance baseline scaffolding |
| `/agents` | List or manage registered agents |
| `/skills` | List or manage registered skills |
| `/memory` | Query the SSOT memory system |
| `/cost` | Show cost summary for the current session |

## Extension Commands

| Command | Description |
|---|---|
| `AtlasMind: Open Settings Panel` | Budget/speed sliders and global config |
| `AtlasMind: Manage Model Providers` | API keys, enable/disable providers |
| `AtlasMind: Manage Agents` | Agent configuration (coming soon) |
| `AtlasMind: Bootstrap Project` | Create SSOT folder structure |
| `AtlasMind: Show Cost Summary` | Session cost at a glance |

## Security Baseline

Current safeguards built into the scaffold:

| Area | Current safeguard |
|---|---|
| Provider secrets | Stored in VS Code SecretStorage |
| Webviews | CSP with nonce-protected scripts; no inline handlers |
| Webview messages | Explicit runtime validation before state changes |
| SSOT bootstrap | Safe relative-path validation and non-destructive creation |
| Memory | SSOT excludes secrets by policy; redaction pipeline planned |

## Configuration

| Setting | Default | Description |
|---|---|---|
| `atlasmind.budgetMode` | `balanced` | `cheap` · `balanced` · `expensive` · `auto` |
| `atlasmind.speedMode` | `balanced` | `fast` · `balanced` · `considered` · `auto` |
| `atlasmind.ssotPath` | `project_memory` | Relative path to the SSOT folder |

## GitHub Workflow Standards

- Work on feature branches and open pull requests into `master`.
- Require CI checks to pass before merge (`compile`, `lint`, `test`, `coverage`).
- Link pull requests to issues and use templates for consistency.
- Use labels and project boards for prioritization and delivery visibility.
- Keep CODEOWNERS review coverage for core runtime and docs.

## Bootstrap Defaults

AtlasMind bootstrap now supports extension-wide governance scaffolding for any target project:

- `.github/workflows/ci.yml`
- `.github/pull_request_template.md`
- `.github/ISSUE_TEMPLATE/*`
- `.github/CODEOWNERS`
- `.vscode/extensions.json`

The scaffold is non-destructive: existing files are preserved and only missing files are created.

## Project Structure

```
src/
├── extension.ts              Extension entry point
├── commands.ts               Command handler implementations
├── types.ts                  Shared interfaces and type definitions
├── chat/
│   └── participant.ts        VS Code chat participant (@atlas)
├── core/
│   ├── orchestrator.ts       Multi-agent task orchestration
│   ├── agentRegistry.ts      Agent CRUD and persistence
│   ├── skillsRegistry.ts     Skill CRUD and persistence
│   ├── modelRouter.ts        Budget/speed-aware model selection
│   └── costTracker.ts        Per-session cost accounting
├── memory/
│   └── memoryManager.ts      SSOT folder CRUD and search
├── providers/
│   ├── adapter.ts            ProviderAdapter interface
│   ├── anthropic.ts          Anthropic provider adapter
│   ├── copilot.ts            GitHub Copilot provider adapter
│   └── index.ts              Provider barrel exports
├── views/
│   ├── treeViews.ts          Sidebar tree data providers
│   ├── modelProviderPanel.ts Model provider webview
│   ├── settingsPanel.ts      Settings webview
│   └── webviewUtils.ts       Shared webview HTML helpers
└── bootstrap/
    └── bootstrapper.ts       Project init (Git, SSOT, templates)

tests/
└── core/                     Unit tests for core services

.github/
├── workflows/ci.yml          CI quality gate pipeline
├── ISSUE_TEMPLATE/           Structured issue intake
├── pull_request_template.md  PR checklist and quality gate prompts
└── CODEOWNERS                Review ownership rules
```

## Recommended VS Code Extensions

- GitHub Copilot
- GitHub Copilot Chat
- ESLint
- GitHub Pull Requests and Issues
- GitLens
- EditorConfig
- Prettier
- YAML

## SSOT Memory Structure

When bootstrapped, AtlasMind creates:

```
project_memory/
├── project_soul.md       Living project identity
├── architecture/         System design and diagrams
├── roadmap/              Feature plans and milestones
├── decisions/            Architecture Decision Records
├── misadventures/        Failed approaches and lessons
├── ideas/                Unstructured brainstorms
├── domain/               Domain knowledge and glossary
├── operations/           Runbooks, deploy procedures
├── agents/               Per-agent config and prompts
├── skills/               Skill definitions and schemas
└── index/                Embeddings and search index
```

## Documentation

Full documentation lives in [`docs/`](docs/):

- [Architecture Overview](docs/architecture.md)
- [Model Routing](docs/model-routing.md)
- [SSOT Memory System](docs/ssot-memory.md)
- [Agents & Skills](docs/agents-and-skills.md)
- [Development Guide](docs/development.md)
- [GitHub Workflow Standards](docs/github-workflow.md)

## Versioning

AtlasMind follows [Semantic Versioning](https://semver.org/). The version is tracked in `package.json` and recorded in [CHANGELOG.md](CHANGELOG.md). Every commit should be pushed.

## License

MIT
