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

CLI argument parsing is now explicit rather than permissive: unknown flags, missing option values, invalid provider IDs, invalid budget or speed modes, and malformed daily-budget values are reported as errors, while `atlasmind --help` and `atlasmind --version` are supported as first-class flows.

## Extending The Shared Runtime

The shared runtime in `src/runtime/core.ts` now exposes an explicit plugin contract for extension-host or CLI integrations that want to contribute runtime capabilities without rewriting bootstrap logic.

```ts
import type { AtlasRuntimePlugin } from '../src/runtime/core.js';

const plugin: AtlasRuntimePlugin = {
	id: 'example-plugin',
	description: 'Registers an extra agent and skill.',
	register(api) {
		api.registerAgent({
			id: 'review-bot',
			name: 'Review Bot',
			role: 'reviewer',
			description: 'Performs focused review tasks.',
			systemPrompt: 'Review changes carefully.',
			skills: ['plugin-review'],
		});

		api.registerSkill({
			id: 'plugin-review',
			name: 'Plugin Review',
			description: 'Example plugin-provided skill.',
			parameters: { type: 'object', properties: {} },
			execute: async () => 'ok',
		});
	},
	onRuntimeEvent(event) {
		// Forward to your own logger or tracing sink.
	},
};
```

`createAtlasRuntime()` accepts `plugins` and `onRuntimeEvent` build options. Plugins can contribute agents, skills, and provider adapters, and the returned runtime publishes `plugins` manifests with contribution counts for dynamic capability discovery.

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

## Integration Drift Monitoring

```bash
npm run monitor:integrations
npm run monitor:integrations:update
npm run monitor:integrations:audit
```

- `monitor:integrations` generates a report against the curated integration manifest in `.github/integration-monitor.json`.
- `monitor:integrations:update` refreshes the stored baselines after you intentionally accept newer marketplace-extension versions.
- `monitor:integrations:audit` fails when new third-party providers, specialist integrations, or recommended extensions are added without corresponding monitoring coverage in `.github/integration-monitor.json`.
- Dependabot handles package-managed drift for npm and GitHub Actions separately via `.github/dependabot.yml`.

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
│   ├── dependabot.yml            Automated npm and GitHub Actions update policy
│   ├── integration-monitor.json  Curated external integration version baselines
│   ├── workflows/ci.yml          CI quality gates
│   ├── workflows/integration-monitor.yml Scheduled extension and integration drift reporting
│   ├── scripts/check-integration-drift.mjs Local and CI drift-report generator
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
│   ├── views/            Webview panels and tree views, including the project dashboard surface
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

The Settings panel (`src/views/settingsPanel.ts`) now supports in-panel search and command-driven deep links into specific pages such as `models`, while the Project Dashboard, Model Providers, Specialist Integrations, Agent Manager, Tool Webhooks, MCP Servers, Voice, and Vision panels use the same page-based searchable workspace pattern so operators can move between related surfaces without losing context. The overview page also exposes the bounded `atlasmind.feedbackRoutingWeight` control so operators can disable or tune thumbs-based routing bias without editing raw JSON.

The Project Dashboard (`src/views/projectDashboardPanel.ts`) is the high-level operational overview surface. It composes local git state, Atlas runtime status, Project Run History, SSOT coverage, memory scan warnings, workflow inventory, and dependency-governance scaffolding into one interactive panel with animated chart cards and adjustable 7-day, 30-day, and 90-day timelines.

The Agent Manager panel (`src/views/agentManagerPanel.ts`) renders the full agent list plus an inline editor from extension-side state. Its markup must remain structurally valid on every re-render because the panel refreshes by replacing the webview HTML; malformed fragments can corrupt the DOM and make the management UI appear recursively nested.

The Chat panel (`src/views/chatPanel.ts`) now backs both the detachable AtlasMind chat panel and the embedded Atlas **Chat** view contributed into the AtlasMind sidebar container. That shared surface reuses the same orchestrator, session carry-forward, streaming behavior, and optional TTS handoff used by the `@atlas` participant, persists per-assistant-turn metadata so bubbles can show the routed model plus a collapsible thinking summary derived from actual routing and tool-execution state, renders an animated AtlasMind-globe pending indicator while the latest assistant turn is still streaming, and exposes explicit send modes (`Send`, `Steer`, `New Chat`, `New Session`) plus composer-side attachment queues. Its Sessions rail is responsive: it stays as a compact collapsible strip at the top in narrow layouts, then reflows into a persistent left sidebar once the webview reaches 1000px so detached or wide chat surfaces can keep session navigation beside the transcript. The section toggle and new-session action remain sibling controls so the header stays compact inside the webview bounds rather than letting an oversized create button stretch the bar vertically, and each live session row now exposes compact archive and delete icon actions instead of text buttons. Archived sessions drop out of the live rail, remain reopenable from the Sessions tree Archive bucket, and can be restored by tree drag-and-drop back into the main session area or a specific folder. Assistant bubbles also expose validated thumbs up/down controls that persist with the transcript metadata and feed a small bounded per-model routing preference on later turns; the footer now keeps the thinking-summary disclosure on the left and compact outlined vote controls on the right edge of the bubble. Those attachments can come from the workspace picker, one-click open-file chips, or drag-and-drop, and extension-side message validation must continue treating every dropped path, URL, or vote message as untrusted input before it is resolved into workspace context or used to update routing state.

The Cost Dashboard (`src/views/costDashboardPanel.ts`) now correlates spend with feedback as well as routing metadata. Its recent-request rows can deep-link back into the exact assistant response, surface the recorded thumbs state for that response, and summarize per-model approval rates, thumbs totals, and filtered spend for rated models so operators can inspect the same signals that influence feedback-weighted routing.

The Model Providers panel (`src/views/modelProviderPanel.ts`) reflects provider status from VS Code SecretStorage and workspace configuration at render time. It now handles generic API-key providers, local OpenAI-compatible endpoints, Azure OpenAI deployment configuration, Bedrock region/model configuration, and specialist-surface navigation. After saving credentials, configuring endpoints, or refreshing model metadata it re-renders so the status badges stay aligned with the live provider state.

The Specialist Integrations panel (`src/views/specialistIntegrationsPanel.ts`) keeps search, voice, image, and video vendors such as EXA, ElevenLabs, Stability AI, and Runway off the routed chat-provider list while still giving operators a dedicated SecretStorage-backed configuration surface.

The Settings panel (`src/views/settingsPanel.ts`) now renders as a keyboard-friendly multi-page workspace with a persistent section nav instead of a single long accordion. It still includes validated controls for tool approval mode, terminal-write opt-in, local OpenAI-compatible endpoint URL, AtlasMind sidebar import-button visibility, automatic post-write verification scripts/timeouts, bounded chat carry-forward context, `/project` execution behavior, and dependency-governance bootstrap defaults for Atlas-built repositories. Numeric fields are constrained to positive integers, local endpoint URLs must be valid absolute HTTP(S) URLs, report-folder input is required to be non-empty before persisting, dependency-provider selections are allow-listed, and the destructive project-memory purge flow is routed through extension-side double confirmation instead of trusting the webview alone. The same panel now exposes per-setting hover help so the richer guidance is visible directly inside AtlasMind's custom settings surface instead of only through native Settings metadata.

The Tool Webhooks panel (`src/views/toolWebhookPanel.ts`) provides webhook enablement, endpoint URL, event selection, timeout control, bearer token management, test delivery, and recent delivery history.

The Voice Panel (`src/views/voicePanel.ts`) uses the Web Speech API for TTS/STT. Final transcripts are copied to the clipboard, all voice settings updates are validated by `src/voice/voiceManager.ts` before being saved to workspace settings, and the panel now exposes overview shortcuts into chat, specialist integrations, and model settings from the same workspace-style navigation shell used by the rest of AtlasMind.

The Vision Panel (`src/views/visionPanel.ts`) provides a non-chat UI for multimodal prompts. It validates all incoming webview messages, opens the workspace image picker on the extension side, reuses the shared attachment-resolution helpers in `src/chat/imageAttachments.ts`, streams orchestrator output back into the panel, can open safe workspace file references directly from rendered panel responses, supports copy/open-as-markdown actions for the latest response, and now splits the multimodal workflow into searchable attachments, prompt, and response pages.

The MCP Servers panel (`src/views/mcpPanel.ts`) now follows the same workspace pattern as the other configuration surfaces, with overview actions, searchable server inventory, and a dedicated add-server page. All incoming MCP panel messages remain validated before AtlasMind touches registry state or executes navigation commands.

The Project Run Center (`src/views/projectRunCenterPanel.ts`) provides a review-before-execute surface for `/project`-style runs. It previews the planner DAG, allows operators to edit the JSON plan before execution, persists preview/running/completed state through `src/core/projectRunHistory.ts`, streams batch/subtask telemetry back into the panel, can pause or require approval before each batch, and exposes review actions for run reports, changed files, diff-first subtask artifacts, failed-subtask retry, Source Control, and rollback. Its presentation now follows the same professional dashboard-style shell used by AtlasMind Settings and the Project Dashboard, so run posture, history, execution controls, and artifact review all stay readable inside one card-based workspace instead of a plain stacked form. The dashboard complements that surface by aggregating broader repo, SSOT, security, and delivery signals rather than focusing only on autonomous execution.

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

When `atlasmind.projectDependencyMonitoringEnabled` is on, the same scaffold step can also create:

- `.github/dependabot.yml`
- `renovate.json`
- `.github/workflows/snyk-monitor.yml`
- `azure-pipelines.dependency-monitor.yml`
- `.github/ISSUE_TEMPLATE/dependency_review.md`
- `project_memory/operations/dependency-monitoring.md`
- `project_memory/decisions/dependency-policy.md`

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
- Integration coverage now explicitly exercises end-to-end orchestration paths such as agent selection, provider execution, tool-loop recovery, provider failover, daily-budget blocking, and shared runtime behavior across the CLI and extension-host abstractions.
- Coverage reports are generated via `npm run test:coverage`.
- Coverage thresholds are currently enforced for service-layer modules under `src/core`, `src/skills`, `src/memory`, `src/providers`, `src/mcp`, and `src/bootstrap`.
- UI-heavy `src/views` and chat participant wiring in `src/chat` are excluded from the enforced threshold until dedicated integration coverage is added.
- CI runs compile, lint, and unit tests on Ubuntu, Windows, and macOS for pushes and pull requests targeting `master` and `develop`.
- The coverage gate and uploaded coverage artifact run on the Ubuntu matrix leg only to avoid duplicate artifact conflicts across OS jobs.
- Dependabot watches npm dependencies and GitHub Actions weekly, while the scheduled integration monitor workflow checks curated marketplace-extension and critical integration baselines.

### Reliability And Troubleshooting Workflow

When debugging multi-agent or routed-model issues, prefer the same progression AtlasMind uses internally:

1. Reproduce the behavior through the extension surface or `npm run cli -- ... --json` so the request path is explicit.
2. Inspect the Project Run Center, Sessions metadata, or routed response metadata to confirm which agent and model actually ran.
3. Use the `diagnostics` and `workspace-observability` skills to collect compiler, test, terminal, and debug-session context before changing code.
4. Review webhook history, runtime lifecycle events in the AtlasMind output channel, or external webhook receivers when you need a durable audit trail for tool activity.
5. Add or update the narrowest unit or integration test that locks the failure mode before changing routing, concurrency, or approval behavior.

### Performance And Concurrency Notes

AtlasMind's current performance model is bounded and local-first:

- Project subtasks run in dependency-safe parallel batches through `TaskScheduler`.
- Tool execution inside a task is capped by orchestrator concurrency and iteration limits.
- Provider retries, failover, and continuation loops are all bounded.
- There is not yet a dedicated benchmark or soak-test suite checked into the repository.

For concurrency-sensitive changes, contributors should treat targeted integration tests and repeated local runs as the required validation path until a formal benchmark harness exists.

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
