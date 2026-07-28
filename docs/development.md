## Running a branch

**Debugging from source (F5) needs no packaged build.** The launch config points at the workspace folder and `preLaunchTask` runs `npm run watch`, so pressing **F5** compiles the current checkout and opens an Extension Development Host against it.

```bash
git fetch origin <branch>
git checkout <branch> && git pull
npm install     # required whenever the branch changed dependencies
# F5
```

`npm install` is the step worth remembering: skipping it after a branch adds a dependency produces a launch failure that looks unrelated to the pull.

**To install a branch into your real editor** rather than a development host, download the `.vsix` artifact from that commit's CI run (Actions → the run → Artifacts → `atlasmind-vsix-<sha>`, retained 14 days). CI can also be started by hand from the Actions tab for a branch with no open pull request.



## UI/UX (Composer Input)

- The chat panel composer uses a single input field for both chat and session search (since v0.51.4).
- Toggling the Search icon swaps the Send/Mode controls for a Search button. In search mode, Enter triggers a session search.
- When multiple transcript matches are found, compact previous/next arrows appear beside Search so the webview can jump through results without leaving the thread.
- One-tap **quick-reply pills** are a property of Atlas asking a question, not of one panel. `buildQuickReplyPayload` (`src/chat/participant.ts`) turns a response into a webview-ready `{ question, replies }` payload — pills only, never a bare question, matching the Chat panel — with every label and prompt length-capped and control-stripped at that single boundary, since the label is rendered and the prompt is submitted on click. The Chat panel, the Project Ideation panel, the Vision panel, and the dashboard ideation path all post it; `QUICK_REPLY_CSS` in `src/views/webviewUtils.ts` is the single style definition so the four surfaces cannot drift into four different pills.
- The Project Dashboard Gap Analysis surface now seeds a structured report from workspace signals, then opens a fresh Atlas chat session for live investigation and writes the prioritized findings back into the dashboard.

# Development Guide (v0.53.6)

## Prerequisites

- **VS Code** ≥ 1.96.0
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
npm run compile      # One-shot build (desktop + web)
npm run watch        # Watch mode for the desktop build (recommended during dev)
npm run watch:web    # Watch mode for the browser bundle
```

The extension has **two build targets**:

- **Desktop** (Node): `tsc -p ./` emits `out/extension.js` (the `main` entry) and the CLI under `out/cli/`.
- **Web** (browser/Web Worker): `tsc -p ./src/web/tsconfig.json` type-checks the web sources against WebWorker (not Node) globals, and `node esbuild.mjs` bundles `src/web/extension.ts` into the single dependency-free `out/web/extension.js` (the `browser` entry). The web build must stay free of Node built-ins; only `vscode`, WebWorker globals, and the Node-free shared modules (`src/remote/protocol.ts`, `src/views/chatProtocol.ts`, `src/views/chatWebviewMarkup.ts`, `src/views/webviewUtils.ts`) may be imported. `npm run compile` runs all three steps.

## Run

Press **F5** in VS Code to launch the Extension Development Host. The extension activates on startup (`onStartupFinished`).

To exercise the **web build**, run `npm run open-in-browser` (uses `@vscode/test-web` to load the browser bundle in Chromium).

## Lint

```bash
npm run lint
```

## Test

```bash
npm run test
npm run test:coverage
npm run test:providers:local-recommendations
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
│   ├── website-studio.md Website Studio workflow and safety boundary
│   ├── github-workflow.md GitHub process standards
│   └── development.md    This file
├── media/
│   └── icon.svg          Activity bar icon
├── src/                  TypeScript source
│   ├── extension.ts      Entry point
│   ├── commands.ts       Command handlers
│   ├── types.ts          Shared type definitions
│   ├── chat/             Chat participant
│   ├── core/             Orchestrator, registries, router, skill drafting, task profiler, cost tracker, currency formatter, webhook dispatcher, Website Studio SSOT (`websiteWorkspaceManager.ts`), testing config loader + scaffolder + per-policy coverage (`testingScaffolder.ts`, `testingPolicyCoverage.ts`), roadmap release gates (`roadmapGates.ts`), delivery/deployment-stage modelling (`deliveryManager.ts`) + guarded promotion engine (`promotionRunner.ts`), Project Director people/follow-up modelling (`projectDirectorManager.ts`) + guarded outbound-comms detection (`directorCommsRunner.ts`) + follow-up reminder scheduler (`followUpScheduler.ts`), Buzz inbound protocol/connection-policy/derivation/subscription (`buzzProtocol.ts`, `buzzConnectionPolicy.ts`, `buzzInboundDerivation.ts`, `buzzClient.ts`, `buzzSocket.ts`, `buzzSigner.ts`, `buzzAgentBindings.ts`, `buzzChannelCatalog.ts`, `buzzInboundService.ts`), security-review register persistence/scoring (`securityReviewManager.ts`), Mission Loop (`missionRunner.ts`, `goalEvaluator.ts`, `missionRegistry.ts`), routing intelligence (`executionQuality.ts`, `modelEvalHarness.ts`)
│   ├── utils/            Shared helpers: `secretRedactor.ts`, `aiInstructionSync.ts` (inbound import), `aiInstructionMerge.ts` (two-way instruction-set sync), `managedBlock.ts` (shared delimited-block upsert/strip), `testingProtocolSync.ts` (outbound testing-protocol sync), `terminalOutput.ts` (ANSI/control-sequence sanitizer for captured tool output)
│   ├── mcp/              MCP client/registry plus bundled Buzz CLI communications bridge/server
│   ├── ard/              Agentic Resource Discovery: `ardClient.ts`, `ardRegistry.ts`, `ardInstaller.ts`, `ardCatalogExporter.ts`
│   ├── memory/           SSOT memory manager
│   ├── providers/        LLM provider adapters (for example `anthropic.ts`, `claude-cli.ts`, `copilot.ts`); also `copilotMultiplierSync.ts`, `localModelSync.ts`, and `localModelRecommendationRegistry.ts`
│   ├── skills/           Built-in skill handlers (for example `dockerCli.ts`, `terminalRun.ts`, `gitApplyPatch.ts`)
│   ├── views/            Webview panels and tree views (including `personalityProfilePanel.ts`, `modelComparisonPanel.ts`, `missionControlPanel.ts`, `websiteStudioPanel.ts`)
│   ├── voice/            TTS/STT: `voiceManager.ts` bridge, `hostSpeechSynthesizer.ts` (OS TTS), `localTranscriber.ts` (on-device Whisper STT)
│   └── bootstrap/        Project bootstrapper
├── tests/                Vitest unit tests
│   ├── core/             Core service unit tests
│   ├── memory/           Memory manager and scanner tests
│   ├── mcp/              MCP client, registry, environment, and Buzz bridge unit tests
│   ├── ard/              ARD client, registry, installer, and catalog exporter tests
│   └── skills/           Built-in skill unit tests
└── out/                  Compiled JavaScript (gitignored)

- **User Environment Tracking**: On activation, AtlasMind detects and stores each user's OS, hardware, shell, and editor in a private, user-scoped location (VS Code SecretStorage). This is never shared with other users or the workspace. Multiple environments per user are supported.
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

The Website Studio follows the same extension-host/webview split. `websiteStudioPanel.ts` renders and collects the six dashboard pages, including the fixed Develop → Staging → Production hosting cards, but every incoming message is checked by `isWebsiteStudioMessage()` and every data payload is passed through `sanitizeWebsiteWorkspace()` in `websiteWorkspaceManager.ts` before persistence. Treat all displayed policy fields as presentation only: the host reconstructs canonical environment names, access policies, hosting restrictions, and Production protection; `assessWebsiteHostingEnvironments()` then validates loopback/HTTPS/password-reference/review-subdomain readiness. Credential inputs are references with an explicit provider prefix, never password values. Keep platform deployment and n8n execution out of the webview: it may record readiness and non-secret references, while real production actions must continue through a separately reviewed/approved host-side path. Tests live in `tests/core/websiteWorkspaceManager.test.ts` and `tests/views/websiteStudioPanel.test.ts`.

That shared shell is also used by compact sidebar webview views such as the AtlasMind Quick Links strip, so even very small sidebar surfaces still inherit the same CSP, nonce handling, and HTML escaping rules as the larger dashboard-style panels.

The dedicated chat panel now also carries lightweight runtime state for recovery-specific UI. When the extension host detects explicit operator frustration and biases the current turn toward direct corrective action, the panel receives a `recoveryNotice` payload and renders a banner near the transcript status area. Keep that state in the extension host and pass only already-sanitized strings into the webview so the browser script remains a pure renderer. Each chat surface keeps its own selected session pinned locally; session-change events should refresh state without forcing every open chat surface onto the globally active session. The composer mode is also status-driven: idle sessions default to `Send`, the active busy session flips to `Steer`, and one-shot `New Chat` or `New Session` choices immediately fall back to the live state after they are queued. During a busy turn, `media/chatPanel.js` appends the last host-provided `streamingModels` entry to the status text above the composer and updates it on failover; keep this decoration in the shared status helper so progress and search messages do not accidentally erase the active model. Tool-loop progress still includes a structured `[TOOL_EXEC]` payload prefix, but the webview now renders tooling updates inside the streaming inner-monologue block: by default only the latest line is shown, and earlier updates are available behind a collapsible disclosure. Project-run offers are stored as validated transcript metadata and rendered as a host-resolved card; the browser may request only `start`, `save`, or `cancel`, while the extension host re-reads the pending goal, prevents double resolution, and routes saving through Project Run Center.

The Cost Dashboard's period picker is a native `<details>` disclosure in a normal-flow chart toolbar. Do not make its menu an absolute overlay: expanded controls must push the plot down so peak points remain unobscured. Local-savings presentation must filter on local provider/model identity rather than the generic `free` billing category, aggregate input/output tokens by exact local model id, and use `getComparableCloudReference()` so comparison pricing remains centralized in the model catalog. `calculateLocalModelSavings()` is the shared calculation for both the Efficiency summary card and detailed per-model panel; keep those surfaces on the same filtered record window.

**Content Security Policy** is set to:
```
default-src 'none'; img-src <webview-csp-source> https: data:; style-src <webview-csp-source> 'unsafe-inline'; script-src 'nonce-<generated>'; base-uri 'none'; form-action 'none';
```

All dynamic text in webviews must be HTML-escaped using the `escapeHtml()` utility.

Do not use inline JavaScript handlers such as `onclick`. Put script content in the shared shell and protect it with a generated nonce.

Communication between webview and extension uses `vscode.postMessage()` / `onDidReceiveMessage()`. Treat all incoming messages as untrusted and validate them before changing state or touching secrets.

The shared Atlas chat webview now also hosts live tool-approval cards, so approval-response messages must be validated with the same strict message guards as prompt submission, voting, attachment flows, and the composer history shortcuts that recall recent submitted prompts from persisted webview state. Prompt attachments now keep a lightweight extension-host metadata record per user turn so the chat transcript can render clickable screenshot thumbnails while later same-session follow-ups still receive the prior image context even after the composer has cleared. Its circular toolbar and composer icon buttons now rely on explicit inline-flex centering plus block SVG layout so the shipped glyphs stay optically centered across the different chat-panel controls, detached chat-panel navigation into the Project Run Dashboard and the main sidebar chat view now lives in the VS Code editor title-bar action row instead of the in-panel circular button group, the transcript renderer now parses fenced code blocks before generic paragraph splitting, also splits mixed markdown heading-plus-list sections into separate structural blocks so bullets do not collapse into title-like text, assistant reasoning and work-log metadata now live inside compact disclosure cards with a separate footer utility row for votes and run links, and choice-oriented assistant replies now expose selectable option toggles plus an explicit Proceed button inline in that footer so operators can confirm the next path before Atlas continues. Automatic composer focus restoration is now guarded as well, so background state refreshes only return focus when the operator is still actively working inside the shared chat surface instead of stealing the editor cursor after a panel update. The transcript header role and model badges now share the same compact height and font sizing while staying visually subdued, the Thinking Summary disclosure uses a lighter contrast treatment against the surrounding message bubble, and long-answer transcript typography now uses slightly looser paragraph rhythm, calmer heading weight, tighter list indentation, and softer blockquote styling so dense technical replies stay readable without feeling oversized. The composer info affordance now opens a structured hint panel with titled bullet lists that adapt between idle, busy, and run-inspector guidance while also deriving context-aware tips from live chat state such as pending approvals, pending review, attachments, suggested follow-ups, and the latest user prompt.

Project-run `needs-input` results keep their suggested execution-cap metadata on the original assistant bubble, which renders a direct recovery question with **use once**, **save permanently**, and **keep partial result** chips. The host revalidates the entry and bounded value before applying either change. One-run overrides update only the live Orchestrator and restore its previous value in `finally`; permanent choices write workspace configuration. A custom-panel project stream owns its transcript entry and suppresses the native Settings-button placeholder, so it does not append an inert action line or duplicate the completed run as a second user/assistant pair.

The Project Run Center (`src/views/projectRunCenterPanel.ts`) is intentionally review-first: it explains what preview returns, clarifies that file-impact thresholds are advisory rather than hard execution caps, lets operators open a seeded draft-refinement discussion in a dedicated chat session before executing the reviewed plan, and now persists run-level execution options so autonomous mode, batch checkpoints, chat mirroring, and staged follow-up carry-forward survive refreshes and run-history reloads. Runs launched from Project Ideation also carry durable ideation-origin metadata into run history, which lets the Run Center show where a run came from and send completed or failed learnings back into the originating ideation thread or a fresh ideation thread without losing the execution context. The webview also treats the synthesized final output as a first-class panel alongside compact searchable run history, while the mirrored run chat uses timeline notes to render the live log as an internal-monologue disclosure instead of collapsing that progress into the generic assistant body.

The Project Dashboard (`src/views/projectDashboardPanel.ts`) now includes a dedicated Roadmap page backed by `project_memory/roadmap/improvement-plan.md` and a project-scoped Testing explorer. The testing surface pulls live suite inventory from the workspace, surfaces the active testing-policy label in the highlight row, groups detected tests by category, supports searchable long-list and dropdown browsing for larger repositories, and shows a selected test’s description, likely arrange and assertion summaries, plus a source link that jumps directly to the relevant line in the editor. The Roadmap page validates roadmap-edit messages in the extension host, lets operators add/edit/delete backlog items from the dashboard, and supports drag-reordering so manual priority order feeds AtlasMind’s next-work weighting. The parser now reads only the marked backlog region, filters out import-generator scaffolding (Project Context metadata and Prioritisation-Notes filler) and collapses duplicate lines so the page never lists inappropriate or repeated items; drag-reorder shows a visible ⠿ handle (grab cursor) with a live drop-target highlight; and the "Mark MVP" control carries a plain-language tooltip explaining what a Minimum Viable Product is. The page now opens with a **Road to …** section, scoped by a **release gate** selector — MVP is built in and projects can declare their own gates (public beta, v1.0, v2; up to 12) in a managed `roadmap-gates` block, with one membership toggle per gate on each item and a route computed per gate up front so switching is instant (`src/core/roadmapGates.ts`). Removing a gate strips its tag and never deletes an item, and the heuristic suggestion fallback stays MVP-only. For the MVP gate specifically: items can be flagged for the MVP path with a per-item toggle (persisted non-destructively as a `#mvp` tag inside the file's managed block via `buildMvpSnapshot`/`serializeDashboardRoadmapDocument`, with the tag kept out of the displayed text), with a heuristic fallback that suggests foundational candidates when nothing is tagged. A milestone track and progress bar visualise distance to a first shippable product, a deterministic best-route ordering front-loads foundational/security/architectural work with per-step reasoning, and a "Plan the MVP route with Atlas" button hands a focused prompt to a live chat session (the Gap-Analysis handoff pattern) without adding model calls to dashboard refresh. Every dashboard page now shares one visual/interaction language (modelled on the Delivery page): shared helpers in `media/projectDashboard.js` — `resolveActionAttrs`, `renderPageIntro`, `renderFlowStrip`, plus tone/meter-aware `renderMetricPill` and resolve-or-static `renderSignalCard`/`renderStatCard`/`renderActionCard`/`renderRecommendationItem`/`renderScoreComponent` — guarantee that anything with a hover affordance resolves to a file/page/command/chat action while non-actionable elements render as genuinely static (no misleading hover). Each page opens with a plain-English `renderPageIntro` band (summary + tone chips + primary action), metric pills carry tone status dots and inline meters, and the Operational Score renders its component composition as a coloured flow strip. The same visual-indicator / no-dead-hover language now also extends to the sibling operational webviews: the **Cost Dashboard** (`costDashboardPanel.ts`) tones every summary/feedback card with a status dot and adds a budget-pressure meter to "Today's Spend"; the **Project Run Center** (`projectRunCenterPanel.ts`) drives live tone dots on the "Current posture" pills from run/preview state via `setDotTone`/`getStatusTone`; and the **Project Ideation** hero stat cards (`media/projectIdeation.js` `renderStat`) carry matching tone dots. Each of those panels was audited so no hover-capable control is inert. The **Mission Control** console (`missionControlPanel.ts`) — formerly the least-styled panel — now adopts the Project Dashboard's shared `--dash-*` design tokens directly (gradient page background, 20px-radius gradient panel-cards with soft shadows, display-font headings), with an intro topbar with a live status chip, card-style form sections, and tone status dots on the Recent missions list, so it is visually consistent with the dashboard pages rather than approximating them with `--vscode-*` styling. The two autonomous-delivery surfaces also cross-link: the Project Run Center header has an "🛰 Mission Control" button (`openMissionControl` message → `atlasmind.openMissionControl`) and Mission Control has a "▶ Project Run Center" button (`openRunCenter` message → `atlasmind.openProjectRunCenter`), each routed through the panel's validated webview → command bridge.

The Project Dashboard also includes a **Risk** page (backed by `src/core/riskOversightManager.ts` and `project_memory/operations/risk-oversight.json` + a `risk-oversight.md` mirror and `risk-oversight-history.json` audit trail) that runs the three read-only oversight advisors, records what they find, scores it into the operational health number, and charts it. Runs are explicit and user-triggered — per-domain or all three **sequentially**, never concurrently, since three parallel model calls is a surprising cost from one click — with live per-advisor progress via `riskBusy`/`riskStatus` messages. The advisor is *pinned* with `orchestrator.processTaskWithAgent` rather than routed, so the page always consults the advisor requested. Because the advisors are read-only, the panel owns the write path: it parses the model's JSON defensively (`parseRiskFindings` never throws), sanitises it (`sanitizeRiskFindings`, path-traversal rejected in cited evidence), and merges it without undoing human decisions. Charts are hand-rolled under the existing CSP (no external library): a likelihood × impact **risk matrix** heatmap in CSS grid whose cells filter the register, plus the shared `renderChartCard`/`renderScoreRing`/`renderMetricPill` primitives. Risk is **excluded from the score until a project has actually been assessed**, so an unassessed project reads as unknown rather than safe.

The Project Dashboard also includes a **Documents** page (backed by `src/core/documentsManager.ts` and `project_memory/operations/documents.json` + a `documents.md` mirror) for managing a project's `.md` files: operators define a *filing system* of folder "shelves" (optionally narrowed by a glob) and a set of documents to *keep updated automatically*. The page computes each tracked document's freshness (file mtime vs. a recorded `lastReviewed` baseline plus a weekly-cadence window), surfaces `missing`/`review-due`/`up-to-date` status, discovers uncovered markdown to file or track, and offers explicit **Update with Atlas** (an `openPrompt` chat handoff) and **Mark reviewed** actions. The Dashboard's **Testing** page additionally carries a **Policy coverage** board (`src/core/testingPolicyCoverage.ts`): for every enabled methodology it shows whether anything in the tree tests it (`covered` / `tooling-only` / `missing`, with practices reported as `not-file-evident` rather than as gaps), how many of its cases are skipped, and which of its tests are failing according to the newest JUnit report the project has written. `collectTestingDashboardSnapshot` gathers the evidence — dependency and script names, probed policy config paths, per-file case/skip counts, and a bounded report search (`findTestResultReport`) — and the pure module derives the board. Nothing runs a test command on render: with no report the page reports *no verdict* and quotes the framework-appropriate command to produce one.

Saving a shelf also **creates its folder** if it is missing (`newShelfPaths` + `createShelfFolders`), and shelves still pointing at an absent folder expose an explicit **Create folder** action — create-only: an existing directory is a no-op and a file at that path is reported, never replaced. It never rewrites documents on a timer (deny-by-default); every webview-supplied path is sanitised via `sanitizeDocumentsConfig`/`normalizeRelPath` (path-traversal, absolute paths, and drive letters rejected) before it touches disk, and a `documents.json` file watcher (`documentsRefresh`) keeps the page current on external edits.

The Project Dashboard's **navigation and metric surface** are each defined in exactly one place. The tab order and grouping live in `PAGE_GROUPS` in `media/projectDashboard.js` — five labelled clusters (Where we stand · The work · The code · Is it safe · Ship & record) that follow the sentence a manager actually reads: where do we stand → what is the work and who is on it → is the code sound → is it safe → can we ship, and is the record straight. The previous order was archaeological (it recorded the sequence features shipped) and disagreed with both the render dispatch order and `DASHBOARD_PAGE_IDS`. `tests/views/dashboardNav.test.ts` now reads the real `PAGE_GROUPS` definition out of the webview script and asserts that every nav page is a valid prompt `sourcePage`, has a matching `pageSectionOpen` panel, and appears exactly once — the two lists live in different files and different languages and have drifted before. `DASHBOARD_PAGE_IDS` remains the *validation* list only: it additionally carries `ideation`, which is a legal prompt origin (it routes to `openIdeationPromptInChat`) but has no tab, so `normalizePageId` in the webview coerces any unrecognised `activePage` back to `overview` rather than leaving every section inactive and rendering a blank dashboard. Tabs carry **attention badges** computed by `computeNavBadges` from counts already present in the same snapshot on the same render pass (open gaps — red when any are P1, open risk findings, overdue follow-ups, documents due for review or missing, blocked memory entries, unhealthy providers, artifacts needing attention, pending file changes); the badge is a bare number visually, with its meaning carried in words on the tab's `aria-label`. The nav implements the full WAI-ARIA tabs pattern — `role="tab"`/`aria-selected`/`aria-controls` on the tabs and `role="tabpanel"`/`aria-labelledby` on the panels (both emitted through the single `pageSectionOpen` helper so tab and panel wiring cannot drift apart), roving `tabindex`, arrow keys with Home/End, and focus restoration across the re-render that destroys the focused tab. The toolbar is sticky, and holds the tabs alone: the 7D/30D/90D range picker used to share that row and the tabs’ pill shape and accent, so on a narrow panel it wrapped underneath and read as a sixth tab group. `renderChartRange` now places it directly above the charts it filters (on Overview, Repo, SSOT, Risk and Privacy — the only pages that read `state.timescale`), styled with the squared, joined `.segmented` treatment so it belongs to a different visual family from the nav. The Director page’s team-mode switch shares `.segmented` rather than re-using the nav pill styling as it previously did.

**Dashboard animation is driven from script, not from CSS.** `render()` replaces `#dashboard-root`'s innerHTML wholesale, so every node is freshly parsed with exactly one computed style and a CSS `transition` between two values can never interpolate — the score ring's `stroke-dashoffset`, the metric meters' width and the MVP progress bar all declared transitions that had never once played, painting straight at their final value. Conversely `@keyframes` *do* restart on every insert, so the Overview chart re-grew up to 90 bars whenever any unrelated part of the dashboard re-rendered, including on every keystroke in the Testing search box. `applyValueAnimations()` resolves both: animatable elements declare a stable `data-anim-key` and a target `data-anim-to`, the module remembers the last value painted per key, and on the next frame only the values that actually changed move. Elements inside a hidden `.page-section` are deliberately not recorded, so their meters animate the first time the manager opens that tab. `prefers-reduced-motion` is honoured in both the stylesheet and the script, so reduced-motion users never pay the class churn either. The shared visual primitives now include `renderDistributionBar` (a segmented proportion bar plus legend — used for TDD subtask evidence, the test pyramid, gap severity mix, roadmap focus mix, document freshness, artifact coverage by lifecycle phase, assignment status and follow-up urgency) alongside the existing `renderChartCard`, `renderScoreRing`, `renderMetricPill`, `renderFlowStrip` and `renderRiskMatrix`. Chart cards headline their period total and the delta against the preceding equal-length window and draw a mean line, so a bar chart conveys direction and not only shape. Overview additionally carries a **work mix** row driven by `renderDonutChart` — SVG arcs rather than a chart library or a canvas, so rings inherit theme colours, stay crisp at any zoom, and carry a `<title>` per slice: *commits by contributor*, *route to the selected release gate*, and *outstanding objectives by gate* (a distribution bar, since an item can sit on more than one gate). Contributor data comes from a single `git log --pretty=%ad|%an` over the same window as the timeline — author **names** only, never addresses — reduced by the pure, exported `buildContributorSeries`, which ranks by commit count, breaks ties by name so slice colours are stable between renders, and merges the long tail into one **Others (n)** entry that keeps its commits rather than dropping contributors from the total. Clicking a contributor (in the ring legend or the segmented filter) scopes the commit timeline to that person and toggles off on a second click; the run and memory timelines are deliberately *not* filtered, because they are not per-person data. The contributor filter is rendered only when the window has more than one author.

Overview closes with `renderOverviewNextActions`, which surfaces the top three short-horizon entries from `score.recommendations`. It replaced a `quickActions` grid of twelve shortcut cards whose destinations were all reachable elsewhere on the page, and whose kicker was taken from an inert `pageTarget` field — a card with a `command` never navigated to its `pageTarget`, so the label named a page the card did not open. `resolveRecommendationAction` now derives both the dispatched action and a human-readable destination (“Ask Atlas”, “Opens Run Center”, “Opens SECURITY.md”) from the same field, so the two cannot disagree. `DashboardSnapshot.quickActions` and `renderActionCard` no longer exist.

**Affordance discipline is enforced by class, not by convention.** `.recent-item` and `.action-card` render as both real buttons and inert `<div>`s, so `cursor: pointer` is scoped to `button.x, .x.is-actionable` only. A later blanket rule used to override that scoping and hand a hand-cursor to every one of them, which is what made roughly fifteen dead cards across Repo, Roadmap, Testing, Gap Analysis and Documents look clickable; an explicit reset now keeps a static variant inert even inside a pointer-cursor container. Actionable cards additionally carry an at-rest chevron so a live row reads as live *before* hover, rather than only after the user commits to a click. Every `data-action` emitted in markup must have a matching branch in the delegated handler — two that did not (`openRun` and `openCommand`, message *type* names mistaken for action names) were buttons that did nothing at all.

**Panel section ordering.** `costDashboardPanel.ts` promotes `buildBudgetBar` out of the Daily Spend card into a full-width `.budget-strip` under the topbar (tone-tinted via `:has(.budget-track-fill.warn|.over)`), moves `buildCurrentLoops` beneath it, groups `buildSummaryCards` output into labelled Spend/Efficiency/Volume clusters, and drops the Today’s-Spend and Daily-Limit cards when a budget exists because the strip already carries them. Note the deliberate asymmetry in the chart controls: the line/bar switch is gated on `hasDailySpend`, but the timescale strip is not — `filteredRecords` is produced by `buildCostQuery(this.timescale, …)`, so hiding the timescale control on an empty window would leave no way to widen it. Five panels were reordered so their sections follow use rather than shipping history, each pinned by `tests/views/panelInformationArchitecture.test.ts`. `SETTINGS_PAGE_IDS` (`settingsPanel.ts`) is the canonical settings order and the nav is asserted to match it — the two hand-maintained lists had already drifted. `PROFILE_SECTIONS` (`personalityProfilePanel.ts`) was reordered by moving whole entries verbatim and verified as a pure permutation. `mcpPanel.ts` defaults to the `servers` page and its Overview lost a summary grid that duplicated the hero badges. `specialistIntegrationsPanel.ts` collapsed three card sections into one filtered page — the previous “All Integrations” was a concatenation of the other two, so each card was rendered twice — with a `data-surface` attribute on each card driving a segmented filter. `websiteStudioPanel.ts` swapped its numbered steps 3 and 4 so the shared UI system precedes the per-page UI-design stage that consumes it.

**Panel tab navigation is shared where pages remain.** Voice, Vision, Specialist Integrations, Tool Webhooks, Model Providers, and MCP once carried their own copy of the same vertical nav, and each copy had the same gap: a container declaring `role="tablist"` whose children were plain buttons, with no `role="tab"`, no `aria-selected`, no `aria-controls`, no `role="tabpanel"` on the sections, no roving `tabindex` and no keyboard handling at all. A screen reader was promised a tab list and found unrelated buttons, and reaching the last tab took one Tab press per tab. `src/views/panelNav.ts` exports `PANEL_NAV_JS`, a client-side controller injected into those page-based panels. Agent Manager no longer needs a tablist: its former Overview / Directory / Editor hierarchy was replaced by one searchable master/detail workspace.

It *upgrades* the existing markup rather than replacing it. The remaining page-based panels already agree on the same conventions — a nav container with `role="tablist"`, `<button data-page-target="X">` per tab, `<section id="page-X" class="panel-page">` per panel, and a local `activatePage(pageId)` — so `createPanelNav()` adds the missing ARIA at runtime and takes over activation and keyboard handling, while each panel keeps its own markup, classes and styling untouched. A panel swaps its bespoke `activatePage` body for `panelNav.activate(pageId)` and passes any extra work (webview state persistence in Specialist Integrations and Model Providers) through `onActivate`. Arrow keys honour the declared `aria-orientation`, Home/End jump to the ends, and tabs hidden by a panel's search filter are skipped rather than being focusable while invisible. `activate()` ignores an unknown page id — several panels activate from a persisted state value that may name a page which no longer exists — and validates against the rendered panels as well as the tabs, so "go to page X" controls outside the nav (hero badges, `data-nav-target` links) keep working.

**The Settings panel is deliberately exempt.** It is the one panel that already implemented the pattern properly, and it does so on top of a progressive-enhancement fallback (`fallback-visible` / `settings-pages-ready`) that keeps every section reachable as a plain in-page anchor if the script never boots. Adopting the shared controller there would trade a working, more capable implementation for uniformity. `tests/views/panelNav.test.ts` asserts that every other tablist-bearing panel uses `createPanelNav`, that none of them still hand-rolls an `activatePage` body, and that Settings retains its own `role="tab"` / `aria-selected` / `role="tabpanel"` / keyboard wiring.

The Project Ideation panel (`src/views/projectIdeationPanel.ts`) now combines deterministic prompt scaffolding with model-led facilitation. Before Atlas answers, the extension infers likely board facets from the operator prompt, such as external references, current-system context, code considerations, workflow implications, and team or process concerns, then feeds that scaffold into the ideation prompt and shows the same inference live in the composer. The facilitation response contract also supports card updates, explicit connection suggestions, and stale-card archiving so repeated prompts can reshape an existing whiteboard instead of only appending descendant cards. Prompt-inference scaffold cards now receive stronger default linking when they are inserted into the canvas, including starter-card relationships on a fresh board, and the feedback surface now derives follow-up prompts and Next Card suggestions dynamically from the latest facilitation output and current board gaps. Atlas-generated cards are now also placed through a layered graph-aware placement pass so the default board communicates a more readable flow from inputs and framing into decisions, constraints, actions, risks, and synthesized outputs, and relation defaults now carry direction-aware styles instead of collapsing into generic joins. The panel now also includes a staged workflow guide plus hover and focus tooltips across the major sections and actions so new users can understand what ideation is for, where they are in the process, and what each control changes. The canvas now tracks the last two clicked cards as an ordered source-to-target pair, uses bottom-edge status markers instead of full-corner indicators, and exposes direct keyboard shortcuts for linking and relation types so operators can manipulate the whiteboard without relying on a temporary link mode. The board is now treated as the primary full-width surface in the normal layout, can expand into a true viewport-filling canvas mode, and the composer CTA now explicitly reads as creating or evolving the ideation board with a Ctrl/Cmd+Enter shortcut. Its relationship links now render with relation-specific colours, markers, and path shapes so support, dependency, contradiction, opportunity, and causal flows are distinguishable at a glance, and the canvas now offers a toggle between angular and spline routing plus visible flow lanes when dense boards need more readable hierarchy. Operators can now also switch the canvas into multiple workflow review views, temporarily re-layout cards for focused reading, filter by relation family, and rely on adjacency-based fading plus an inline legend to understand which cards and links actually matter to the current selection. Relationship endpoints now terminate at the visible card boundary using each card's actual rendered footprint at the current detail level rather than a coarse approximation, the routing pass now scores nearby card bounds to repel links away from occupied card space where possible, link labels now render as collision-aware badges instead of bare midpoint text, the board world itself now allows substantially more travel in every direction, spline mode now renders a single smooth curve per relationship instead of multi-join bends, and a plain left-click on empty canvas space now clears the current selection without breaking drag-to-pan or reintroducing selection-driven desaturation. Ideation facilitation is also now explicitly treated as research and planning work rather than implementation work, so coding-specific TDD gate safeguards and red-to-green status cues do not block or pollute prompt-driven board creation. Atlas Feedback now waits for the finalized facilitation payload and strips tool-loop chatter or synthetic failure banners before rendering user-facing copy, so the webview stays facilitator-oriented even when orchestration internals get noisy. Its analytics surface now also turns non-green findings into expandable actions that can insert linked experiment, evidence, risk, or checkpoint cards directly into the canvas. Focused cards can also be sent straight into Project Run Center as seeded run previews, and later Project Run learnings can be re-imported into the same ideation board or branched into a fresh ideation thread. Ideation persistence now supports multiple named workspaces under `project_memory/ideas/`, with `atlas-ideation-workspaces.json` tracking the active board and each workspace keeping its own JSON and markdown artifacts so divergent explorations can be switched or deleted without overwriting the main thread.

The Settings panel (`src/views/settingsPanel.ts`) now includes validated controls for `/project` execution behavior in addition to budget/speed modes. Numeric fields are constrained to positive integers, report-folder input is required to be non-empty before persisting, the Budget and Speed choice pills expose per-option hover and focus tooltips so operators can understand the routing tradeoff attached to each mode before changing it, and **Agents** is a first-class Capabilities page with live counts and a validated command bridge into the dedicated Agent Manager; the Settings overview exposes the same destination. The Models & Integrations page manages local OpenAI-compatible routing through a dynamic labeled endpoint list with add/remove controls instead of a single always-visible endpoint field. Project-specific test discovery remains available through deep links for compatibility, but the primary testing workflow now lives in the Project Dashboard so operators review coverage, verification posture, and individual test cases in the same project-health surface as runtime and delivery signals. MCP onboarding is now routed into the dedicated MCP Add Server workspace rather than pretending to install directly inside Settings, which keeps the curated recommended starters and the manual endpoint form in one place, surfaces stage-aware connection feedback, labels each preset as Official, Community, Registry fallback, or Archived reference so operators can judge how strongly AtlasMind verified the upstream setup path, distinguishes AtlasMind-ready presets from manual-setup-only ones using an audited connection map, and blocks docs-only submissions until the operator enters a real command or URL. AtlasMind-ready CLI presets can now also be installed and connected directly from the Settings starter card in one click, and on supported systems that same flow can bootstrap missing runtimes through winget, Homebrew, or common Linux package managers before AtlasMind retries the first connection. The Guided Setup wizard no longer dead-ends on manual-setup starters: when a chosen server has no command/endpoint AtlasMind can auto-fill (and no fields to complete), the wizard now says so and swaps the Connect button for **Open Advanced setup** (carrying the starter across) instead of failing with a misleading "complete every required field" message; when a required field genuinely is blank, the error names the specific field(s). Building on that, the entire recommended catalogue is now guided rather than manual: `getRecommendedMcpStarterDetails` carries a verified command plus `prerequisites`, `credentialSteps`, `credentialHelpUrl`, `safetyNote`, and per-input `example` placeholders (all researched and supply-chain-verified in two batches — the 13 platform servers, then the 21 cloud/data/devops/comms/payments servers), and the wizard's configure step renders a "What you'll need" checklist, a numbered credential how-to, an "Open credentials page" button, a docs link, and an amber safety callout. Only first-party/reputable packages are prefilled; a handful stay opt-in guided-manual (community/low-adoption: Twitch, LinkedIn, OpenAI web-search, Bark/APNs), and servers that require a credential on the command line (Twilio, Jenkins) route to Advanced with full guidance rather than auto-storing a secret in config — enforced by a test asserting no recommended input carries a secret as a CLI argument. Remote OAuth services (Cloudflare ×2, Atlassian Jira, Trello) are wired through a version-pinned `mcp-remote` stdio bridge so the url-only http transport's lack of auth-header support is never hit. `openWizardConfigure` now treats any starter with an endpoint as connectable (guided-manual community servers connect with an "Add & connect" affordance and a review banner; only a truly endpoint-less custom entry falls back to Advanced), and the Advanced form itself gained inline help + examples on every field. The Advanced page also carries a "Detected on this machine" scan panel backed by `src/mcp/mcpEnvironmentScanner.ts`: it imports MCP servers already configured in Claude Desktop, Cursor, VS Code, Windsurf, or a repo `.mcp.json` (offering per-server **Prefill form** / **Import & connect**), reports which launch runtimes are on PATH, surfaces workspace env-variable names as click-to-add chips, and offers an "Ask Atlas to help" chat handoff for unknown servers. The scan is cached in SSOT (`project_memory/operations/mcp-environment.json` + a markdown mirror), reused on future installs, refreshed by a workspace-config file watcher, and re-runnable via a Rescan button. It is redaction-safe: only env-variable names are cached or sent to the webview; on import, `resolveImportedServer` re-reads secret values live from the source file and routes them to SecretStorage. The Configured Servers page also supports reopening a saved MCP entry in edit mode so operators can correct URLs, commands, arguments, environment JSON, and enablement without deleting and re-adding the connection. Legacy broken preset commands restored from storage are also repaired or safely disabled before AtlasMind tries to reconnect them, and workspace-aware placeholders such as `${workspaceFolder}` are resolved before AtlasMind launches a saved MCP transport. When an older workspace still only has the legacy single local endpoint setting, opening the panel auto-migrates that explicit value into the structured endpoint list so the new UI stays in sync. Navigation setup is also intentionally isolated from the rest of the settings control wiring now, the left-side menu uses progressive enhancement so section links still work as ordinary in-page anchors if a later widget failure stops the richer single-page behavior, the CSS fallback keeps only one settings section visible at a time even before the script boots, explicit panel targets now render server-side so commands that reopen Settings at a specific page or card do not depend on a healthy prior webview instance, and the runtime nav logic now binds each section link directly while syncing the active section through the page hash so remembered webview state cannot override an explicit deep link.

The Personality Profile panel (`src/views/personalityProfilePanel.ts`) is a guided questionnaire webview that combines editable role, tone, memory, and boundary prompts with live AtlasMind configuration values such as budget mode, speed mode, approval mode, and chat carry-forward limits. Each prompt now keeps a freeform text area as the source of truth while also exposing quick-fill presets so operators can seed a response without losing the ability to write custom guidance. It persists the profile in workspace state and, when SSOT is available, mirrors the result into `project_memory/agents/` plus a synced summary block in `project_soul.md`. The extension runtime now reads both the saved workspace-state profile and a compact summary of `project_soul.md`, then injects that combined workspace identity into Atlas task prompt assembly so the operator profile and project identity influence every request instead of staying passive documentation, and the panel can open the generated markdown artifacts directly for manual editing.

The Tool Webhooks panel (`src/views/toolWebhookPanel.ts`) provides webhook enablement, endpoint URL, event selection, timeout control, bearer token management, test delivery, and recent delivery history.

Across AtlasMind's newer multi-page webview panels, top-right hero summary chips follow a consistent interaction rule: if a chip maps to a real section or filtered catalog, it is rendered as a button; if it is purely explanatory, it exposes a hover/focus tooltip instead of pretending to navigate.

The Manage Agents webview is a two-column master/detail workspace: search, enabled/custom/built-in filters, and the selected definition stay visible together; list state is stored with the webview API across host-side re-renders. The former Overview / Directory / Editor tabs and empty-editor destination are gone. The sidebar exposes the global Agent Auto-Update cadence exactly once under **Defaults & automation**. Its message, all agent action payloads, and custom rubric fields are validated in the extension host before configuration or registry mutation. Built-ins render their exclusion checked and disabled and their factory completion criteria read-only; custom agents can supply at most 12 bounded rubric rows and 12 incomplete-result patterns.

Built-in skills now include a git-backed patch application helper (`src/skills/gitApplyPatch.ts`) that validates or applies unified diffs through `git apply` from the shared `SkillExecutionContext`.

Container-aware automation uses a separate Docker skill (`src/skills/dockerCli.ts`) rather than expanding generic terminal passthrough. That skill only permits a curated subset of `docker` and `docker compose` inspection and lifecycle commands, keeping container workflows explicit in the approval pipeline.

Detailed SEO and UX instructions use the read-only `specialist-guidance` skill (`src/skills/specialistGuidance.ts`). Its short tool description stays in the normal tool schema, while the selected checklist is returned only when called. Keep permanent agent prompts limited to role, scope, safety boundaries, and measurable completion criteria; add or revise a guidance topic instead of embedding volatile platform facts or full audit matrices in `src/runtime/core.ts`.

**Global agent-policy visibility.** The Settings **Agents** page imports `IMMUTABLE_GUARDRAILS` from the orchestrator and escapes it into a selectable, read-only `<pre>` block. The webview therefore shows the runtime source of truth rather than maintaining a second policy copy; the surrounding copy identifies its provenance and non-overrideable precedence.

**Personality Profile shortcuts.** Settings Overview and Models & Integrations each post the validated `openPersonalityProfile` message, which the extension host maps to the existing `atlasmind.openPersonalityProfile` command. Keeping the command bridge host-side avoids embedding command URIs or execution authority in the webview.

## Security Defaults

- Keep `SecurityReviewManager` as a persistence and scoring boundary until an explicit dashboard integration wires it into `extension.ts`: it records bounded findings and per-area runs for secrets, boundaries, dependencies, and permissions, but does not run a scanner or gate delivery. Future model or webview callers must use `parseSecurityFindings` and the sanitizers so malformed output becomes no findings, unknown statuses remain open, and evidence paths remain workspace-relative.
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
4. Every commit (not just PRs) must include a version bump and changelog entry. This applies to all code, doc, and config changes. The version bump and changelog update must be in the same commit as the change.
5. Use a conventional commit message and push.

## Testing

- Test runner: Vitest 4.
- Baseline unit tests currently cover core services (`ModelRouter`, `CostTracker`).
- Coverage reports are generated via `npm run test:coverage`.
- CI runs compile, lint, test, and coverage on push and pull requests to `main`.

## Security Reporting

- Security disclosures should follow [SECURITY.md](SECURITY.md).
- Do not report vulnerabilities through public GitHub issues.

## GitHub Governance

- Use feature branches and open pull requests into `main`.
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
npm run publish:release    # Publishes the current build, then tags the release
npm run tag:release    # Re-run the git tag step on its own if it failed after publish
```

`publish:release` runs `vsce publish` and then `npm run tag:release`, which creates and pushes a `v<version>` annotated git tag (`.github/scripts/tag-release.mjs`). The tagger is cross-platform and idempotent — it skips if the tag already exists — so every Marketplace release stays traceable to a tagged commit without a manual step.

The checked-in `.gitignore` keeps the local `project_memory_old/` backup outside source control, and `.vscodeignore` is the packaging boundary for local and release VSIX files. It intentionally excludes workspace-only content such as all `project_memory*` directories (including local archive or backup variants), `wiki/`, local `.vsix` outputs, Vitest JSON report artifacts, assistant instruction folders, and extra dependency test or docs folders so the packaged extension stays closer to runtime-only contents. Review the `vsce package` file listing before publishing; a workspace-memory directory in that listing is a release blocker.

Requires `vsce` to be installed globally or as a dev dependency:
```bash
npm install -g @vscode/vsce
```

AtlasMind is still branded as Beta until `1.0.0`, but Marketplace publication now
uses the standard release channel.
The manifest is marked with `"preview": false`, `npm run publish:release`
publishes the default stable listing, and `npm run publish:pre-release` remains
available only if you intentionally need a prerelease build later.
