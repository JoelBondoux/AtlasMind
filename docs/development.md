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
│   ├── github-workflow.md GitHub process standards
│   └── development.md    This file
├── media/
│   └── icon.svg          Activity bar icon
├── src/                  TypeScript source
│   ├── extension.ts      Entry point
│   ├── commands.ts       Command handlers
│   ├── types.ts          Shared type definitions
│   ├── chat/             Chat participant
│   ├── core/             Orchestrator, registries, router, skill drafting, task profiler, cost tracker, webhook dispatcher
│   ├── mcp/              MCP client + server registry
│   ├── memory/           SSOT memory manager
│   ├── providers/        LLM provider adapters (for example `anthropic.ts`, `copilot.ts`)
│   ├── views/            Webview panels and tree views
│   └── bootstrap/        Project bootstrapper
├── tests/                Vitest unit tests
│   ├── core/             Core service unit tests
│   ├── memory/           Memory manager and scanner tests
│   ├── mcp/              MCP client and registry unit tests
│   └── skills/           Built-in skill unit tests
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

The Project Run Center (`src/views/projectRunCenterPanel.ts`) is intentionally review-first: it explains what preview returns, clarifies that file-impact thresholds are advisory rather than hard execution caps, hides batch-approval controls unless that mode is enabled, and lets operators open a seeded draft-refinement discussion in the chat panel before executing the reviewed plan.

The Settings panel (`src/views/settingsPanel.ts`) now includes validated controls for `/project` execution behavior in addition to budget/speed modes. Numeric fields are constrained to positive integers, and report-folder input is required to be non-empty before persisting.

The Tool Webhooks panel (`src/views/toolWebhookPanel.ts`) provides webhook enablement, endpoint URL, event selection, timeout control, bearer token management, test delivery, and recent delivery history.

Built-in skills now include a git-backed patch application helper (`src/skills/gitApplyPatch.ts`) that validates or applies unified diffs through `git apply` from the shared `SkillExecutionContext`.

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

## Versioning Workflow

1. Make changes and choose the correct SemVer bump for the same commit.
2. Update `version` in `package.json` in that commit.
3. Add a matching `CHANGELOG.md` entry in that same commit.
4. Use a conventional commit message and push.

## Testing

- Test runner: Vitest 4.
- Baseline unit tests currently cover core services (`ModelRouter`, `CostTracker`).
- Coverage reports are generated via `npm run test:coverage`.
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
npm run package:vsix    # Packages with the checked-in @vscode/vsce dependency
npm run publish:release    # Publishes the current build as a Marketplace release
```

Requires `vsce` to be installed globally or as a dev dependency:
```bash
npm install -g @vscode/vsce
```

AtlasMind is still branded as Beta until `1.0.0`, but Marketplace publication now
uses the standard release channel.
The manifest is marked with `"preview": false`, `npm run publish:release`
publishes the default stable listing, and `npm run publish:pre-release` remains
available only if you intentionally need a prerelease build later.
