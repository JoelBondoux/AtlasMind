# Development Guide

## Prerequisites

- **VS Code** ≥ 1.95.0
- **Node.js** ≥ 18
- **npm** ≥ 9

## Setup

```bash
git clone <repo-url>
cd AtlasMind
npm install
```

## Build

```bash
npm run compile    # One-shot build
npm run watch      # Watch mode (recommended during dev)
```

## CLI

```bash
npm run cli -- providers list
npm run cli -- memory list
npm run cli -- chat "Summarise the project memory"
```

The CLI is compiled from `src/cli/main.ts` and reuses the shared runtime builder in `src/runtime/core.ts`. It auto-loads the configured SSOT path when present, otherwise the default `project_memory/` folder if it already exists. Reusable providers read credentials from environment variables derived from the VS Code secret keys, such as `ATLASMIND_PROVIDER_OPENAI_APIKEY` and `ATLASMIND_PROVIDER_ANTHROPIC_APIKEY`. Copilot remains VS Code-only, and Bedrock is still configured through the extension host path.

CLI safety is intentionally stricter than the extension host. Read-only skills remain available by default, but write-capable workspace and git tools require an explicit `--allow-writes` flag, and external high-risk tools remain blocked in CLI mode.

## Run

Press **F5** in VS Code to launch the Extension Development Host. The extension activates on startup (`onStartupFinished`).

## Package And Publish

```bash
npm run package:vsix
npm run publish:pre-release
```

AtlasMind ships runtime dependencies such as the MCP SDK. Do not use `vsce package --no-dependencies` or `vsce publish --no-dependencies` unless all runtime dependencies have been bundled into the compiled output first, otherwise the installed extension can fail at activation with `Cannot find module ...` errors.

## Lint

```bash
npm run lint
```

## Test

```bash
npm run test
npm run test:coverage
```

## Project Structure

```
AtlasMind/
├── package.json          Extension manifest and npm config
├── tsconfig.json         TypeScript compiler config
├── CHANGELOG.md          Version history
├── CONTRIBUTING.md       Contribution guidelines
├── README.md             Project overview
├── SECURITY.md           Vulnerability reporting and supported versions
├── .gitignore            Git ignore rules
├── .github/
│   ├── copilot-instructions.md   Copilot documentation maintenance rules
│   ├── workflows/ci.yml          CI quality gates
│   ├── ISSUE_TEMPLATE/           GitHub issue templates
│   ├── pull_request_template.md  GitHub PR checklist
│   └── CODEOWNERS               Review ownership
├── docs/
│   ├── architecture.md   System design overview
│   ├── model-routing.md  Model selection logic
│   ├── ssot-memory.md    Memory system design
│   ├── agents-and-skills.md  Agent and skill system
│   ├── configuration.md  Configuration reference
│   ├── github-workflow.md GitHub process standards
│   └── development.md    This file
├── media/
│   ├── icon.svg          Activity bar icon
│   └── walkthrough/      Getting Started walkthrough content (4 steps)
├── src/                  TypeScript source
│   ├── extension.ts      Entry point
│   ├── commands.ts       Command handlers
│   ├── types.ts          Shared type definitions (OrchestratorHooks, OrchestratorConfig, etc.)
│   ├── constants.ts      Centralised tunable constants (~40 values)
│   ├── chat/             Chat participant, image attachment helpers, and bounded session carry-forward context
│   ├── core/             Orchestrator, registries, router, checkpoint manager, project run history, tool policy, skill drafting, task profiler, cost tracker, webhook dispatcher
│   ├── cli/              Node-hosted CLI entrypoint plus Node memory/cost/skill-context adapters
│   ├── mcp/              MCP client + server registry
│   ├── memory/           SSOT memory manager
│   ├── providers/        LLM provider adapters, the shared provider registry/local adapter (`registry.ts`), and the model catalog (`modelCatalog.ts`)
│   ├── runtime/          Shared runtime builder and host-neutral secret abstraction
│   ├── skills/           Built-in tool implementations (27 skills) + shared validation helpers (`validation.ts`)
│   ├── utils/            Shared utilities (workspace folder picker)
│   ├── views/            Webview panels and tree views
│   ├── voice/            Extension-host voice bridge
│   └── bootstrap/        Project bootstrapper and import
├── tests/                Vitest unit tests
│   ├── bootstrap/        Bootstrapper and import tests
│   ├── cli/              CLI parsing and SSOT detection tests
│   ├── core/             Core service unit tests
│   ├── integration/      Multi-component integration tests
│   ├── memory/           Memory manager and scanner tests
│   ├── mcp/              MCP client and registry unit tests
│   ├── providers/        Provider adapter and registry tests
│   ├── runtime/          Shared runtime builder tests
│   ├── skills/           Built-in skill unit tests
│   └── views/            Webview message validation tests
└── out/                  Compiled JavaScript (gitignored)
```

## TypeScript Conventions

| Rule | Detail |
|---|---|
| Target | ES2022 |
| Module | Node16 |
| Module resolution | Node16 |
| Strict mode | Enabled |
| Import extensions | `.js` required on all relative imports |
| Declaration files | Generated (`declaration: true`) |
| Source maps | Enabled |

## Adding a New Source File

1. Create the `.ts` file in the appropriate `src/` subdirectory.
2. Use `.js` extension in all `import` statements.
3. Export from the relevant barrel file (`index.ts`) if applicable.
4. Run `npm run compile` to verify.

## Webview Development

Webview panels use `getWebviewHtmlShell()` from `src/views/webviewUtils.ts` for consistent styling.

**Content Security Policy** is set to:
```
default-src 'none'; img-src <webview-csp-source> https: data:; style-src <webview-csp-source> 'unsafe-inline'; script-src 'nonce-<generated>'; base-uri 'none'; form-action 'none';
```

All dynamic text in webviews must be HTML-escaped using the `escapeHtml()` utility.

Do not use inline JavaScript handlers such as `onclick`. Put script content in the shared shell and protect it with a generated nonce.

Communication between webview and extension uses `vscode.postMessage()` / `onDidReceiveMessage()`. Treat all incoming messages as untrusted and validate them before changing state or touching secrets.

The Settings panel (`src/views/settingsPanel.ts`) now supports in-panel search and command-driven deep links into specific pages such as `models`, while the Model Providers, Specialist Integrations, Agent Manager, Tool Webhooks, MCP Servers, Voice, and Vision panels use the same page-based searchable workspace pattern so operators can move between related surfaces without losing context.

The Agent Manager panel (`src/views/agentManagerPanel.ts`) renders the full agent list plus an inline editor from extension-side state. Its markup must remain structurally valid on every re-render because the panel refreshes by replacing the webview HTML; malformed fragments can corrupt the DOM and make the management UI appear recursively nested.

The Chat panel (`src/views/chatPanel.ts`) now backs both the detachable AtlasMind chat panel and the embedded Atlas **Chat** view contributed into the AtlasMind sidebar container. That shared surface reuses the same orchestrator, session carry-forward, streaming behavior, and optional TTS handoff used by the `@atlas` participant, persists per-assistant-turn metadata so bubbles can show the routed model plus a collapsible thinking summary derived from actual routing and tool-execution state, renders an animated AtlasMind-globe pending indicator while the latest assistant turn is still streaming, and exposes explicit send modes (`Send`, `Steer`, `New Chat`, `New Session`) plus composer-side attachment queues. Those attachments can come from the workspace picker, one-click open-file chips, or drag-and-drop, and extension-side message validation must continue treating every dropped path or URL as untrusted input before it is resolved into workspace context.

The Model Providers panel (`src/views/modelProviderPanel.ts`) reflects provider status from VS Code SecretStorage and workspace configuration at render time. It now handles generic API-key providers, local OpenAI-compatible endpoints, Azure OpenAI deployment configuration, Bedrock region/model configuration, and specialist-surface navigation. After saving credentials, configuring endpoints, or refreshing model metadata it re-renders so the status badges stay aligned with the live provider state.

The Specialist Integrations panel (`src/views/specialistIntegrationsPanel.ts`) keeps search, voice, image, and video vendors such as EXA, ElevenLabs, Stability AI, and Runway off the routed chat-provider list while still giving operators a dedicated SecretStorage-backed configuration surface.

The Settings panel (`src/views/settingsPanel.ts`) now renders as a keyboard-friendly multi-page workspace with a persistent section nav instead of a single long accordion. It still includes validated controls for tool approval mode, terminal-write opt-in, local OpenAI-compatible endpoint URL, AtlasMind sidebar import-button visibility, automatic post-write verification scripts/timeouts, bounded chat carry-forward context, and `/project` execution behavior. Numeric fields are constrained to positive integers, local endpoint URLs must be valid absolute HTTP(S) URLs, report-folder input is required to be non-empty before persisting, and the destructive project-memory purge flow is routed through extension-side double confirmation rather than trusting the webview alone.

The Tool Webhooks panel (`src/views/toolWebhookPanel.ts`) provides webhook enablement, endpoint URL, event selection, timeout control, bearer token management, test delivery, and recent delivery history.

The Voice Panel (`src/views/voicePanel.ts`) uses the Web Speech API for TTS/STT. Final transcripts are copied to the clipboard, all voice settings updates are validated by `src/voice/voiceManager.ts` before being saved to workspace settings, and the panel now exposes overview shortcuts into chat, specialist integrations, and model settings from the same workspace-style navigation shell used by the rest of AtlasMind.

The Vision Panel (`src/views/visionPanel.ts`) provides a non-chat UI for multimodal prompts. It validates all incoming webview messages, opens the workspace image picker on the extension side, reuses the shared attachment-resolution helpers in `src/chat/imageAttachments.ts`, streams orchestrator output back into the panel, can open safe workspace file references directly from rendered panel responses, supports copy/open-as-markdown actions for the latest response, and now splits the multimodal workflow into searchable attachments, prompt, and response pages.

The MCP Servers panel (`src/views/mcpPanel.ts`) now follows the same workspace pattern as the other configuration surfaces, with overview actions, searchable server inventory, and a dedicated add-server page. All incoming MCP panel messages remain validated before AtlasMind touches registry state or executes navigation commands.

The Project Run Center (`src/views/projectRunCenterPanel.ts`) provides a review-before-execute surface for `/project`-style runs. It previews the planner DAG, allows operators to edit the JSON plan before execution, persists preview/running/completed state through `src/core/projectRunHistory.ts`, streams batch/subtask telemetry back into the panel, can pause or require approval before each batch, and exposes review actions for run reports, changed files, diff-first subtask artifacts, failed-subtask retry, Source Control, and rollback.

Built-in skills now include a git-backed patch application helper (`src/skills/gitApplyPatch.ts`), grep-style text search, directory listing, targeted file editing, git status/diff/commit helpers, an allow-listed terminal execution helper, a rollback checkpoint skill, and memory read/write/delete skills with disk persistence and security scanning. Successful workspace-write batches can trigger both automatic verification scripts and automatic pre-write checkpoint capture through the orchestrator hooks, and those checkpoints are persisted in extension storage for later rollback.

Freeform chat requests can inline workspace image paths, and the `/vision` chat command provides an explicit picker-backed attachment flow. Those images are attached to compatible vision-capable providers, while the orchestrator compacts memory and session context to stay within a model-aware prompt budget.

## Security Defaults

- Store credentials in `ExtensionContext.secrets`.
- Keep security-sensitive writes non-destructive where possible.
- Reject unsafe relative paths and any path traversal input.
- Prefer confirmation prompts before risky operations.

## Bootstrap Governance Scaffolding

`/bootstrap` and `AtlasMind: Bootstrap Project` now offer extension-wide governance scaffolding for any initialized project.

When accepted, AtlasMind creates missing governance files:

- `.github/workflows/ci.yml`
- `.github/pull_request_template.md`
- `.github/ISSUE_TEMPLATE/*`
- `.github/CODEOWNERS`
- `.vscode/extensions.json`

Scaffolding is non-destructive and will not overwrite existing files.

## Project Import

`/import` and `AtlasMind: Import Existing Project` scan the current workspace and populate SSOT memory with discovered metadata:

1. Ensures the SSOT folder structure exists (same as `/bootstrap`).
2. Scans well-known project files: manifests (`package.json`, `Cargo.toml`, `pyproject.toml`, etc.), README, config files (`tsconfig.json`, `.eslintrc.*`, `Dockerfile`, etc.), license files, and key project docs such as architecture, routing, agents/skills, development, configuration, workflow, security, and governance guidance when present.
3. Detects project type (VS Code Extension, API Server, Web App, Library, CLI Tool, Rust/Python/Go/Java/Ruby/PHP Project).
4. Builds and upserts a broader structured baseline including: project overview, dependencies, project structure, focused codebase map, runtime architecture, routing summary, agents/skills summary, tooling conventions, product capabilities, development workflow, configuration summary, security/safety summary, governance guardrails, release-history snapshot, and an import catalog.
5. Upgrades the starter `project_soul.md` template into a filled-out identity document when that file is still using the bootstrap placeholders.
6. Reloads the memory index from disk and fires a refresh event.

Import is incremental and non-destructive — it creates or refreshes structured entries, skips unchanged generated files based on embedded metadata, preserves manual edits to generated import artifacts, and writes reviewable status reports under `index/import-catalog.md` and `index/import-freshness.md`.

## Versioning Workflow

1. Make changes and choose the correct SemVer bump for the same commit.
2. Update `version` in `package.json` in that commit.
3. Add a matching `CHANGELOG.md` entry in that same commit.
4. Use a conventional commit message and push.

## Testing

- Test runner: Vitest 4.
- Baseline unit tests cover core services, durable checkpoint rollback behavior, and multimodal request serialization across supported provider adapters.
- Coverage reports are generated via `npm run test:coverage`.
- Coverage thresholds are currently enforced for service-layer modules under `src/core`, `src/skills`, `src/memory`, `src/providers`, `src/mcp`, and `src/bootstrap`.
- UI-heavy `src/views` and chat participant wiring in `src/chat` are excluded from the enforced threshold until dedicated integration coverage is added.
- CI runs compile, lint, and unit tests on Ubuntu, Windows, and macOS for pushes and pull requests targeting `master` and `develop`.
- The coverage gate and uploaded coverage artifact run on the Ubuntu matrix leg only to avoid duplicate artifact conflicts across OS jobs.

## Security Reporting

- Security disclosures should follow [SECURITY.md](SECURITY.md).
- Do not report vulnerabilities through public GitHub issues.

## GitHub Governance

- Use feature branches and open pull requests into `master`.
- Follow `.github/pull_request_template.md` for release and quality checklists.
- Use `.github/ISSUE_TEMPLATE/` for bug and feature intake.
- Keep ownership mappings updated in `.github/CODEOWNERS`.
- Configure branch protection in GitHub settings:
	- Require pull requests before merging
	- Require status checks to pass
	- Require at least one review
	- Require conversation resolution before merge

## Packaging

```bash
npm run package    # Produces a .vsix file
```

Requires `vsce` to be installed globally or as a dev dependency:
```bash
npm install -g @vscode/vsce
```
