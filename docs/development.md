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
│   ├── providers/        LLM provider adapters (for example `anthropic.ts`, `claude-cli.ts`, `copilot.ts`)
│   ├── skills/           Built-in skill handlers (for example `dockerCli.ts`, `terminalRun.ts`, `gitApplyPatch.ts`)
│   ├── views/            Webview panels and tree views (including `personalityProfilePanel.ts`)
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

That shared shell is also used by compact sidebar webview views such as the AtlasMind Quick Links strip, so even very small sidebar surfaces still inherit the same CSP, nonce handling, and HTML escaping rules as the larger dashboard-style panels.

The dedicated chat panel now also carries lightweight runtime state for recovery-specific UI. When the extension host detects explicit operator frustration and biases the current turn toward direct corrective action, the panel receives a `recoveryNotice` payload and renders a banner near the transcript status area. Keep that state in the extension host and pass only already-sanitized strings into the webview so the browser script remains a pure renderer.

**Content Security Policy** is set to:
```
default-src 'none'; img-src <webview-csp-source> https: data:; style-src <webview-csp-source> 'unsafe-inline'; script-src 'nonce-<generated>'; base-uri 'none'; form-action 'none';
```

All dynamic text in webviews must be HTML-escaped using the `escapeHtml()` utility.

Do not use inline JavaScript handlers such as `onclick`. Put script content in the shared shell and protect it with a generated nonce.

Communication between webview and extension uses `vscode.postMessage()` / `onDidReceiveMessage()`. Treat all incoming messages as untrusted and validate them before changing state or touching secrets.

The shared Atlas chat webview now also hosts live tool-approval cards, so approval-response messages must be validated with the same strict message guards as prompt submission, voting, attachment flows, and the composer history shortcuts that recall recent submitted prompts from persisted webview state. Prompt attachments now keep a lightweight extension-host metadata record per user turn so the chat transcript can render clickable screenshot thumbnails while later same-session follow-ups still receive the prior image context even after the composer has cleared. Its circular toolbar and composer icon buttons now rely on explicit inline-flex centering plus block SVG layout so the shipped glyphs stay optically centered across the different chat-panel controls, detached chat-panel navigation into the Project Run Dashboard and the main sidebar chat view now lives in the VS Code editor title-bar action row instead of the in-panel circular button group, the transcript renderer now parses fenced code blocks before generic paragraph splitting, also splits mixed markdown heading-plus-list sections into separate structural blocks so bullets do not collapse into title-like text, assistant reasoning and work-log metadata now live inside compact disclosure cards with a separate footer utility row for votes and run links, the transcript header role and model badges now share the same compact height and font sizing while staying visually subdued, the Thinking Summary disclosure uses a lighter contrast treatment against the surrounding message bubble, and long-answer transcript typography now uses slightly looser paragraph rhythm, calmer heading weight, tighter list indentation, and softer blockquote styling so dense technical replies stay readable without feeling oversized. The composer info affordance now opens a structured hint panel with titled bullet lists that adapt between idle, busy, and run-inspector guidance while also deriving context-aware tips from live chat state such as pending approvals, pending review, attachments, suggested follow-ups, and the latest user prompt.

The Project Run Center (`src/views/projectRunCenterPanel.ts`) is intentionally review-first: it explains what preview returns, clarifies that file-impact thresholds are advisory rather than hard execution caps, lets operators open a seeded draft-refinement discussion in a dedicated chat session before executing the reviewed plan, and now persists run-level execution options so autonomous mode, batch checkpoints, chat mirroring, and staged follow-up carry-forward survive refreshes and run-history reloads. Runs launched from Project Ideation also carry durable ideation-origin metadata into run history, which lets the Run Center show where a run came from and send completed or failed learnings back into the originating ideation thread or a fresh ideation thread without losing the execution context. The webview also treats the synthesized final output as a first-class panel alongside compact searchable run history, while the mirrored run chat uses timeline notes to render the live log as an internal-monologue disclosure instead of collapsing that progress into the generic assistant body.

The Project Dashboard (`src/views/projectDashboardPanel.ts`) now includes a dedicated Roadmap page backed by `project_memory/roadmap/improvement-plan.md`. That page validates roadmap-edit messages in the extension host, lets operators add/edit/delete backlog items from the dashboard, and supports drag-reordering so manual priority order feeds AtlasMind’s next-work weighting.

The Project Ideation panel (`src/views/projectIdeationPanel.ts`) now combines deterministic prompt scaffolding with model-led facilitation. Before Atlas answers, the extension infers likely board facets from the operator prompt, such as external references, current-system context, code considerations, workflow implications, and team or process concerns, then feeds that scaffold into the ideation prompt and shows the same inference live in the composer. The facilitation response contract also supports card updates, explicit connection suggestions, and stale-card archiving so repeated prompts can reshape an existing whiteboard instead of only appending descendant cards. Prompt-inference scaffold cards now receive stronger default linking when they are inserted into the canvas, including starter-card relationships on a fresh board, and the feedback surface now derives follow-up prompts and Next Card suggestions dynamically from the latest facilitation output and current board gaps. Atlas-generated cards are now also placed through a layered graph-aware placement pass so the default board communicates a more readable flow from inputs and framing into decisions, constraints, actions, risks, and synthesized outputs, and relation defaults now carry direction-aware styles instead of collapsing into generic joins. The panel now also includes a staged workflow guide plus hover and focus tooltips across the major sections and actions so new users can understand what ideation is for, where they are in the process, and what each control changes. The canvas now tracks the last two clicked cards as an ordered source-to-target pair, uses bottom-edge status markers instead of full-corner indicators, and exposes direct keyboard shortcuts for linking and relation types so operators can manipulate the whiteboard without relying on a temporary link mode. The board is now treated as the primary full-width surface in the normal layout, can expand into a true viewport-filling canvas mode, and the composer CTA now explicitly reads as creating or evolving the ideation board with a Ctrl/Cmd+Enter shortcut. Its relationship links now render with relation-specific colours, markers, and path shapes so support, dependency, contradiction, opportunity, and causal flows are distinguishable at a glance, and the canvas now offers a toggle between angular and spline routing plus visible flow lanes when dense boards need more readable hierarchy. Operators can now also switch the canvas into multiple workflow review views, temporarily re-layout cards for focused reading, filter by relation family, and rely on adjacency-based fading plus an inline legend to understand which cards and links actually matter to the current selection. Relationship endpoints now terminate at the visible card boundary using each card's actual rendered footprint at the current detail level rather than a coarse approximation, the routing pass now scores nearby card bounds to repel links away from occupied card space where possible, link labels now render as collision-aware badges instead of bare midpoint text, the board world itself now allows substantially more travel in every direction, spline mode now renders a single smooth curve per relationship instead of multi-join bends, and a plain left-click on empty canvas space now clears the current selection without breaking drag-to-pan or reintroducing selection-driven desaturation. Ideation facilitation is also now explicitly treated as research and planning work rather than implementation work, so coding-specific TDD gate safeguards and red-to-green status cues do not block or pollute prompt-driven board creation. Atlas Feedback now waits for the finalized facilitation payload and strips tool-loop chatter or synthetic failure banners before rendering user-facing copy, so the webview stays facilitator-oriented even when orchestration internals get noisy. Its analytics surface now also turns non-green findings into expandable actions that can insert linked experiment, evidence, risk, or checkpoint cards directly into the canvas. Focused cards can also be sent straight into Project Run Center as seeded run previews, and later Project Run learnings can be re-imported into the same ideation board or branched into a fresh ideation thread. Ideation persistence now supports multiple named workspaces under `project_memory/ideas/`, with `atlas-ideation-workspaces.json` tracking the active board and each workspace keeping its own JSON and markdown artifacts so divergent explorations can be switched or deleted without overwriting the main thread.

The Settings panel (`src/views/settingsPanel.ts`) now includes validated controls for `/project` execution behavior in addition to budget/speed modes. Numeric fields are constrained to positive integers, report-folder input is required to be non-empty before persisting, the Budget and Speed choice pills expose per-option hover and focus tooltips so operators can understand the routing tradeoff attached to each mode before changing it, and the Models & Integrations page now manages local OpenAI-compatible routing through a dynamic labeled endpoint list with add/remove controls instead of a single always-visible endpoint field. When an older workspace still only has the legacy single local endpoint setting, opening the panel auto-migrates that explicit value into the structured endpoint list so the new UI stays in sync. Navigation setup is also intentionally isolated from the rest of the settings control wiring now, the left-side menu uses progressive enhancement so section links still work as ordinary in-page anchors if a later widget failure stops the richer single-page behavior, the CSS fallback keeps only one settings section visible at a time even before the script boots, explicit panel targets now render server-side so commands that reopen Settings at a specific page or card do not depend on a healthy prior webview instance, and the runtime nav logic now binds each section link directly while syncing the active section through the page hash so remembered webview state cannot override an explicit deep link.

The Personality Profile panel (`src/views/personalityProfilePanel.ts`) is a guided questionnaire webview that combines editable role, tone, memory, and boundary prompts with live AtlasMind configuration values such as budget mode, speed mode, approval mode, and chat carry-forward limits. Each prompt now keeps a freeform text area as the source of truth while also exposing quick-fill presets so operators can seed a response without losing the ability to write custom guidance. It persists the profile in workspace state and, when SSOT is available, mirrors the result into `project_memory/agents/` plus a synced summary block in `project_soul.md`. The extension runtime now reads both the saved workspace-state profile and a compact summary of `project_soul.md`, then injects that combined workspace identity into Atlas task prompt assembly so the operator profile and project identity influence every request instead of staying passive documentation, and the panel can open the generated markdown artifacts directly for manual editing.

The Tool Webhooks panel (`src/views/toolWebhookPanel.ts`) provides webhook enablement, endpoint URL, event selection, timeout control, bearer token management, test delivery, and recent delivery history.

Across AtlasMind's newer multi-page webview panels, top-right hero summary chips follow a consistent interaction rule: if a chip maps to a real section or filtered catalog, it is rendered as a button; if it is purely explanatory, it exposes a hover/focus tooltip instead of pretending to navigate.

Built-in skills now include a git-backed patch application helper (`src/skills/gitApplyPatch.ts`) that validates or applies unified diffs through `git apply` from the shared `SkillExecutionContext`.

Container-aware automation uses a separate Docker skill (`src/skills/dockerCli.ts`) rather than expanding generic terminal passthrough. That skill only permits a curated subset of `docker` and `docker compose` inspection and lifecycle commands, keeping container workflows explicit in the approval pipeline.

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

The checked-in `.vscodeignore` is the packaging boundary for local and release VSIX files. It intentionally excludes workspace-only content such as `project_memory/`, `wiki/`, local `.vsix` outputs, Vitest JSON report artifacts, assistant instruction folders, and extra dependency test or docs folders so the packaged extension stays closer to runtime-only contents.

Requires `vsce` to be installed globally or as a dev dependency:
```bash
npm install -g @vscode/vsce
```

AtlasMind is still branded as Beta until `1.0.0`, but Marketplace publication now
uses the standard release channel.
The manifest is marked with `"preview": false`, `npm run publish:release`
publishes the default stable listing, and `npm run publish:pre-release` remains
available only if you intentionally need a prerelease build later.
