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
│   ├── mcp/              MCP client + server registry
│   ├── memory/           SSOT memory manager
│   ├── providers/        LLM provider adapters, including OpenAI-compatible, Azure-backed, and Bedrock-specific routing plus the model catalog (`modelCatalog.ts`)
│   ├── skills/           Built-in tool implementations (26 skills) + shared validation helpers (`validation.ts`)
│   ├── utils/            Shared utilities (workspace folder picker)
│   ├── views/            Webview panels and tree views
│   ├── voice/            Extension-host voice bridge
│   └── bootstrap/        Project bootstrapper and import
├── tests/                Vitest unit tests
│   ├── bootstrap/        Bootstrapper and import tests
│   ├── core/             Core service unit tests
│   ├── integration/      Multi-component integration tests
│   ├── memory/           Memory manager and scanner tests
│   ├── mcp/              MCP client and registry unit tests
│   ├── providers/        Provider adapter and registry tests
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

The Agent Manager panel (`src/views/agentManagerPanel.ts`) renders the full agent list plus an inline editor from extension-side state. Its markup must remain structurally valid on every re-render because the panel refreshes by replacing the webview HTML; malformed fragments can corrupt the DOM and make the management UI appear recursively nested.

The Chat panel (`src/views/chatPanel.ts`) provides a dedicated AtlasMind conversation surface for users who want a Claude Code or Continue-style panel instead of relying on VS Code's built-in Chat view. It reuses the same orchestrator, session carry-forward, streaming behavior, and optional TTS handoff used by the `@atlas` participant.

The Model Providers panel (`src/views/modelProviderPanel.ts`) reflects provider status from VS Code SecretStorage and workspace configuration at render time. It now handles generic API-key providers, local OpenAI-compatible endpoints, Azure OpenAI deployment configuration, Bedrock region/model configuration, and specialist-surface navigation. After saving credentials, configuring endpoints, or refreshing model metadata it re-renders so the status badges stay aligned with the live provider state.

The Specialist Integrations panel (`src/views/specialistIntegrationsPanel.ts`) keeps search, voice, image, and video vendors such as EXA, ElevenLabs, Stability AI, and Runway off the routed chat-provider list while still giving operators a dedicated SecretStorage-backed configuration surface.

The Settings panel (`src/views/settingsPanel.ts`) now includes validated controls for tool approval mode, terminal-write opt-in, local OpenAI-compatible endpoint URL, AtlasMind sidebar import-button visibility, automatic post-write verification scripts/timeouts, bounded chat carry-forward context, and `/project` execution behavior. Numeric fields are constrained to positive integers, local endpoint URLs must be valid absolute HTTP(S) URLs, and report-folder input is required to be non-empty before persisting.

The Tool Webhooks panel (`src/views/toolWebhookPanel.ts`) provides webhook enablement, endpoint URL, event selection, timeout control, bearer token management, test delivery, and recent delivery history.

The Voice Panel (`src/views/voicePanel.ts`) uses the Web Speech API for TTS/STT. Final transcripts are copied to the clipboard, and all voice settings updates are validated by `src/voice/voiceManager.ts` before being saved to workspace settings.

The Vision Panel (`src/views/visionPanel.ts`) provides a non-chat UI for multimodal prompts. It validates all incoming webview messages, opens the workspace image picker on the extension side, reuses the shared attachment-resolution helpers in `src/chat/imageAttachments.ts`, streams orchestrator output back into the panel, can open safe workspace file references directly from rendered panel responses, and now supports copy/open-as-markdown actions for the latest response.

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
2. Scans well-known project files: manifests (`package.json`, `Cargo.toml`, `pyproject.toml`, etc.), README, config files (`tsconfig.json`, `.eslintrc.*`, `Dockerfile`, etc.), and license files.
3. Detects project type (VS Code Extension, API Server, Web App, Library, CLI Tool, Rust/Python/Go/Java/Ruby/PHP Project).
4. Builds and upserts memory entries for: project overview, dependencies, directory structure, tooling conventions, and license.
5. Reloads the memory index from disk and fires a refresh event.

Import is non-destructive — it creates new entries and never removes existing ones.

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
- CI runs compile, lint, test, and coverage on push and pull requests to `master`.

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
