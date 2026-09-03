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

**To validate without a hosted run**, use the complete command sequence and trust boundaries in
[Local CI and safe self-hosted runners](local-ci-and-safe-runners.md). After `npm ci`, use
`npm run ci:local:quick` while iterating and `npm run ci:local` before pushing. The
`trusted-local-ci.yml` route runs that same complete gate only for the repository owner's `develop` push
or exact-ref manual dispatch.
A GitHub-connected runner belongs on a dedicated or disposable low-privilege host; it does not belong on a
daily-use development machine and must not accept untrusted pull-request code.



## UI/UX (Composer Input)

- The chat panel composer uses a single input field for both chat and session search (since v0.51.4).
- Toggling the Search icon swaps the Send/Mode controls for a Search button. In search mode, Enter triggers a session search.
- When multiple transcript matches are found, compact previous/next arrows appear beside Search so the webview can jump through results without leaving the thread.
- One-tap **quick-reply pills** are a property of Atlas asking a question, not of one panel. `buildQuickReplyPayload` (`src/chat/participant.ts`) turns a response into a webview-ready `{ question, replies }` payload — pills only, never a bare question, matching the Chat panel — with every label and prompt length-capped and control-stripped at that single boundary, since the label is rendered and the prompt is submitted on click. The Chat panel, the Project Ideation panel, the Vision panel, and the dashboard ideation path all post it; `QUICK_REPLY_CSS` in `src/views/webviewUtils.ts` is the single style definition so the four surfaces cannot drift into four different pills. Empty assistant bodies are a separate host-owned recovery state: `buildAssistantResponseMetadata` must attach a failure question plus `quickReplies`, and the webview may render those choices but must never promote the generic “Answered from context” execution summary into the missing answer body.
- The Project Dashboard Gap Analysis surface now seeds a structured report from workspace signals, then opens a fresh Atlas chat session for live investigation and writes the prioritized findings back into the dashboard.
- Transcript-changing ChatPanel actions must cross `SessionContextManager.invalidateSession()` before
  reporting completion or submitting a replacement prompt. Context loads always receive
  `SessionConversation.getRevision(sessionId)`; maintenance receives the revision of its exact transcript
  snapshot. Panel-flow tests must assert ordering for any new clear, delete, rewind, or replacement path.

# Development Guide (v0.53.6)

## Prerequisites

- **VS Code** ≥ 1.96.0
- **Node.js** ≥ 22 — CI builds on 24, which is what this is developed against. The floor moved off
  18 because the dev toolchain moved: `jsdom` and Stryker both require 22 or newer, and a stated
  prerequisite nobody can actually build on is worse than none.
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

- **Desktop** (Node): `tsc -p ./` emits `out/extension.js` (the `main` entry), the ordinary CLI, and the agent-side ACP stdio entrypoint under `out/cli/`.
- **Web** (browser/Web Worker): `tsc -p ./src/web/tsconfig.json` type-checks the web sources against WebWorker (not Node) globals, and `node esbuild.mjs` bundles `src/web/extension.ts` into the single dependency-free `out/web/extension.js` (the `browser` entry). The web build must stay free of Node built-ins; only `vscode`, WebWorker globals, and the Node-free shared modules (`src/remote/protocol.ts`, `src/views/chatProtocol.ts`, `src/views/chatWebviewMarkup.ts`, `src/views/webviewUtils.ts`) may be imported. `npm run compile` runs all three steps.

- **Webview DOM tests**: `tests/views/chatWebviewDom.test.ts` mounts `chatWebviewMarkup.ts` output in jsdom,
  evaluates `media/chatPanel.js`, and drives it with the same `state` messages the host posts. Every other
  test of that file asserts its source text, which is why a free variable left behind by a refactor
  (`selectedRun`, v0.329.1) could stop every assistant bubble from rendering while the compiler, the lint
  rules and the whole suite stayed green — the file is `@ts-nocheck` by necessity. Add a case here whenever
  a change alters what the panel *draws*, not just what it wires.

- **Webview highlighter**: the same `node esbuild.mjs` step also builds
  `media/vendor/highlight.min.js` from the pinned `highlight.js` devDependency, via
  `scripts/highlight-entry.mjs`. The chat webview is hand-authored, unbundled ES5 loaded straight from
  `media/`, so it cannot import a module, and the panel's CSP forbids a CDN — building the bundle from the
  dependency keeps the input reviewable and the version visible to `npm ls` and Dependabot, where a
  committed minified blob would be neither. The output **is** committed, because `media/` ships verbatim
  in the VSIX and a missing file there would mean code blocks quietly lose their colours rather than
  failing loudly. Re-run `npm run compile` after bumping the dependency; `media/vendor/highlight.js.LICENSE`
  travels with it.

## Run

Press **F5** in VS Code to launch the Extension Development Host. The extension activates on startup (`onStartupFinished`).

To exercise the **web build**, run `npm run open-in-browser` (uses `@vscode/test-web` to load the browser bundle in Chromium).

To smoke-test the headless entrypoints after compiling:

```bash
node out/cli/main.js --help
node out/cli/acpAgent.js --help
```

The ACP entrypoint dynamically imports the official `@agentclientprotocol/sdk` because that package is ESM while AtlasMind's desktop output is CommonJS. Do not replace the dynamic boundary with a top-level runtime import. Extension activation writes `atlasmind` and `atlasmind-acp` shims that run the packaged JavaScript through the VS Code Electron executable with `ELECTRON_RUN_AS_NODE=1`.

## Lint

```bash
npm run lint
```

## Test

**The tests are type-checked separately, and their errors ratchet down.** `tsconfig.json` has `rootDir: "src"` and emits to `out/`, so tests could not simply be added to its `include` — and were therefore never type-checked at all. Vitest transpiles without checking and ESLint here is not type-aware, so a fixture could declare a return type it no longer satisfied and nothing would notice: `CiRouteMachineFacts` gained a required field while a fixture kept omitting it, ran with `undefined`, and passed. `tsconfig.test.json` checks both trees with `noEmit`, aligning `module`/`moduleResolution` with how Vitest actually resolves these files rather than how the extension bundle is emitted — otherwise `import.meta` is reported as an error in files that legitimately use it, which is a disagreement about configuration and not a defect. Run it with `npm run typecheck:tests`.

Turning the check on as a gate was not available: a few hundred pre-existing mismatches exist, most of them partial mocks that are idiomatic in tests and would need casts that remove the value of checking them. So `tests/baselines/testTypecheck.test.ts` applies the same ratchet `unreadDeclarations` uses for dead exports — a ceiling that fails when the count rises **and** when it falls without being lowered, so the number moves one way only and cannot become a fiction after a cleanup. Only `tests/**` errors count toward it; a `src` regression must fail the compile where it belongs rather than being absorbed here. A new test file that does not type-check fails the suite, and the failure names the files.

**Settings are guarded too.** A setting is a promise: it shows in the VS Code settings UI with a description saying what it does. `tests/settingsIntegrity.test.ts` fails the build if a declared setting is read by no code, if a configuration key is read with a redundant `atlasmind.` prefix (`getConfiguration('atlasmind').get('atlasmind.x')` silently resolves to `atlasmind.atlasmind.x`), or if a setting on the not-yet-wired allowlist has a description that reads like a working feature. Adding to that allowlist requires a written reason, so it cannot become the place dead settings go to be forgotten.

**Webview scripts are guarded by a parser, not by the compiler.** `media/*.js` is a string handed to a browser: never type-checked, never imported by a test. A renamed function therefore leaves its old call site behind silently, and the failure arrives as a render-time `ReferenceError` that takes down the entire panel ("Dashboard refresh failed — …is not defined"). `tests/views/webviewIdentifierIntegrity.test.ts` parses each script with acorn and asserts every identifier it reads is bound — declared in the file, a parameter, or a real browser/host global. When it fails, the fix is either the rename you missed or, for a genuine new DOM global, an addition to its `HOST_GLOBALS` list.


**Every run writes a JUnit report.** `vitest.config.ts` declares `reporters: ['default', 'junit']` with `outputFile.junit`, so `npm run test` emits `test-results/junit.xml` alongside its normal console output. This is not a convenience: AtlasMind's own Testing dashboard reads pass/fail only from a report the project wrote and never runs a test command to find out, so until the report existed the dashboard rendered *"No test report"* on the project that ships it. It is configured rather than hidden behind a separate script for the same reason — a script reproduces the failure one step along, with the report existing only when somebody remembers. `test-results/` is gitignored: it is evidence of *your* run, and committing it would make the dashboard report whoever last pushed. `test:providers:local-recommendations` passes `--reporter=dot` and therefore writes nothing, which is correct — a single-file run must not overwrite the whole-suite verdict.

**The per-test timeout is 20s, not Vitest's 5s default.** A large share of this suite is deliberately not cheap: the `fs`-only managers are exercised against a real `mkdtemp` directory with a real project tree written into it, because mocking the filesystem under them would test the mock. Each such test's duration therefore tracks the host's disk, and a developer checkout on a synced folder (OneDrive, Dropbox) can be an order of magnitude slower than CI. At 5s the margin was thin enough that a filesystem-heavy test passed alone and timed out under full-suite load — the worst failure shape available, because at the moment it blocks a commit it is indistinguishable from a real one, and it trains whoever hits it to reach for `--no-verify`, which skips compile and lint as well. The higher ceiling hides nothing: a genuinely stuck test still fails, just later.

**The suite uses half this machine, not all of it.** Vitest defaults to `availableParallelism() - 1` workers — 23 processes on a 24-thread developer machine — and a large share of these tests write real project trees into real temporary directories, so those workers saturate CPU *and* disk together. `npm run ci:local` then runs the whole suite twice, the second time under coverage. The measured effect was an editor that stopped responding for the duration, which is how somebody learns to skip the pre-commit hook. `vitest.config.ts` therefore sets `maxWorkers: '50%'` locally and leaves CI on the default: a hosted runner has nothing else to be responsive for, and halving its parallelism would make every pull request slower for nobody's benefit. A percentage rather than a fixed count so it scales with the machine, and `VITEST_MAX_WORKERS=<n>` still overrides it — Vitest applies that variable after the config resolves — for when you want the whole machine and are not using it for anything else. Nothing here caps memory: a worker's footprint is a property of the test rather than of the pool. Mutation runs are unaffected; the Stryker runner pins one worker per instance and bounds the instances with its own `concurrency`.

**A long-lived branch conflicts on the release files, and `npm run resolve:release-conflicts` settles it.** Every commit here bumps `package.json` and writes release notes. That rule is worth its cost — the version always names an exact state of the code — but it means two branches doing entirely unrelated work conflict on the same five files (`package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md`, `wiki/Changelog.md`) *every time*, with no semantic overlap between the changes. A branch open while another stream is pushing re-conflicts within hours. `scripts/resolve-release-conflicts.mjs` encodes the resolution: version files take the incoming version patch-bumped (a feature branch is a PATCH on top of wherever the integration branch reached, never a revert of it, which is what taking "ours" silently does), and notes files keep **both** sides with this branch's entry relabelled and placed above. It refuses to report success while any marker survives, it only runs mid-merge, and it touches nothing else — a conflict in source, tests or docs is a real disagreement about behaviour and wants a human. The hazard it removes is specific: hand-resolving identical-looking hunks repeatedly is how a changelog entry quietly loses a paragraph while attention is on the version numbers.

**Tests live under `tests/`, and nowhere else.** The runner's `include` is `tests/**/*.test.ts`. A test file placed in `src/`, in a singular `test/` directory, or given a `.spec.ts` suffix does not run and reports nothing — its presence then reads as coverage that does not exist. Five such files were found and moved in v0.220.0; two of them did not pass once they ran. If a test seems to be passing suspiciously easily, confirm the runner is picking it up before believing it.

**BDD scenarios have an executable owner.** Gherkin files live under `tests/features/`; the matching
Vitest scenario reads the feature and executes the behavior named by its `Scenario:` line. A feature
file on its own is documentation, not evidence that BDD runs, while a Vitest test with no linked
scenario is an ordinary behavioral test. The pair is what makes the project policy auditable without
adding a second test runner.

**`evals/` holds batteries that are deliberately *not* in the suite.** `tests/**` asserts what the code is contracted to do, so a failure there is a regression and must block a commit. `evals/chat-window.stress.ts` asserts what the chat window ought to do *for a person reading it* — a higher bar than the code currently clears — and its failures are findings, not regressions. Wiring it into `npm test` would make every finding a blocked commit, and the whole battery would be deleted within a week. It therefore runs from its own config, which is also why `tsconfig.json` (`include: src/**`) and the pre-commit hook are unaffected by anything in `evals/`.

Two rules if you add probes to it. Each probe carries the question it asks *on the user's behalf* and why that shape is realistic for this codebase, so a failure reads as a defect report rather than a red assertion. And every lane interleaves **controls** — probes expected to pass — because a lane where nothing holds is broken outright rather than at the edges, and you cannot tell those apart from failures alone. Probes that scan source rather than calling a function need their regex anchored precisely: two of them originally passed by matching the wrong occurrence, which is a false pass of exactly the kind the battery exists to catch.

```bash
npm run test
npm run test:coverage
npm run test:mutation
npm run test:providers:local-recommendations
npm run ci:local:quick   # compile + lint + integration audit + full suite
npm run ci:local         # quick gate + focused regression + coverage + VSIX
npx vitest run --config evals/vitest.stress.config.ts   # chat-window stress battery (findings, not gates)
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
│   ├── workflows/ci.yml          Hosted release-PR operating-system matrix
│   ├── workflows/trusted-local-ci.yml  Owner-only develop route to isolated hardware
│   ├── ISSUE_TEMPLATE/           GitHub issue templates
│   ├── pull_request_template.md  GitHub PR checklist
│   └── CODEOWNERS               Review ownership
├── docs/
│   ├── architecture.md   System design overview
│   ├── model-routing.md  Model selection logic
│   ├── ssot-memory.md    Memory system design
│   ├── agents-and-skills.md  Agent and skill system
│   ├── website-studio.md Website Studio workflow and safety boundary
│   ├── ui-studio-builder-plan.md Approved visual-builder PRD and phased delivery plan
│   ├── github-workflow.md GitHub process standards
│   └── development.md    This file
├── media/
│   ├── icon.svg          Activity bar icon
│   └── bin/atlasmind-acp-private-desktop.exe  SHA-256-pinned Windows ACP launcher
├── native/
│   └── acp-private-desktop/  Dependency-free Rust source for that launcher
├── src/                  TypeScript source
│   ├── extension.ts      Entry point
│   ├── commands.ts       Command handlers
│   ├── types.ts          Shared type definitions
│   ├── acp/              Agent-side ACP sessions, permissions, Buzz setup/reply boundary
│   ├── chat/             Chat participant
│   ├── cli/              Headless CLI and `atlasmind-acp` stdio host
│   ├── core/             Orchestrator, registries, router, skill drafting, task profiler, cost tracker, currency formatter, webhook dispatcher, project composition and opt-in workspace scope (`projectComposition.ts`, `workspaceScope.ts`), UI Studio SSOT (`websiteWorkspaceManager.ts`), authoritative graph/edit/live-preview/repository core (`uiDesignGraph.ts`, `uiEditCommands.ts`, `uiPreviewRuntime.ts`, `uiRepositoryMapping.ts`, `uiRepositoryImport.ts`), and its design/generation modules (`websiteWireframe.ts`, `websiteSitemap.ts`, `websiteLinkGraph.ts`, `websiteDesignPrompt.ts`, `websiteGeneration.ts`, `websiteGenerationRunner.ts`, `websitePreviewServer.ts`, `websiteFrameworks.ts`, `websiteStackSetup.ts`, `websiteCiTemplate.ts`, `websiteDeliverySync.ts`, `websiteWireframePreview.ts`, `websiteContent.ts`, `websiteContentManager.ts`, `websiteReviewComments.ts`, `websiteReviewBundle.ts`), testing config loader + scaffolder + per-policy coverage + codebase-driven auto-assessment + declaration/evidence reconciliation (`testingScaffolder.ts`, `testingPolicyCoverage.ts`, `testingAutoAssess.ts`, `testingReconciliation.ts`), roadmap release gates (`roadmapGates.ts`), the roadmap dependency graph plus its on-disk overlay (`roadmapGraph.ts`, `roadmapGraphStore.ts`), release-gate destinations, filters and urgency ordering (`releaseGateNavigation.ts`), roadmap ingestion and its reconciliation planner (`roadmapImport.ts`) and the register-to-work hand-off (`registerHandoff.ts`), shared setup walkthroughs (`setupWalkthrough.ts`, `setupGuideRegistry.ts`, `acpSetupPlan.ts`), persisted-document migration (`schemaMigration.ts`), issue-tracker parsing (`issueTracker.ts`), CI inspection and starter construction (`ciManager.ts`, `trustedLocalCiStarter.ts`), the CI route model, routing policy, hosted-allowance meter, cross-route build ledger, act fidelity adapter and generated-workflow Node resolution (`ciRoutes.ts`, `ciRoutingPolicy.ts`, `ciCreditMeter.ts`, `ciBuildLedger.ts`, `ciActRoute.ts`, `nodeVersionDetection.ts`), local CI setup guidance, GitHub CLI install planning and the remembered machine inspection (`localCiSetupPlan.ts`, `localCiInstaller.ts`, `localCiInspectionMemory.ts`), issue/pull-request write echo (`trackerWriteOutcome.ts`), the semver primitives and the branch-to-channel versioning policy (`semver.ts`, `versioningPolicy.ts`), delivery/deployment-stage modelling (`deliveryManager.ts`) + detected-runbook terminal planning (`deliveryRunPlan.ts`) + guarded promotion engine (`promotionRunner.ts`) + declared delivery/workflow vocabulary (`projectVocabulary.ts`), Project Director people/follow-up modelling (`projectDirectorManager.ts`) + guarded outbound-comms detection (`directorCommsRunner.ts`) + follow-up reminder scheduler (`followUpScheduler.ts`), Buzz inbound protocol/connection-policy/derivation/subscription (`buzzProtocol.ts`, `buzzConnectionPolicy.ts`, `buzzInboundDerivation.ts`, `buzzClient.ts`, `buzzSocket.ts`, `buzzSigner.ts`, `buzzAgentBindings.ts`, `buzzChannelCatalog.ts`, `buzzInboundService.ts`), security-review register persistence/scoring (`securityReviewManager.ts`), Mission Loop (`missionRunner.ts`, `goalEvaluator.ts`, `missionRegistry.ts`), routing intelligence (`executionQuality.ts`, `modelEvalHarness.ts`)
│   │   ├── lensDashboard.ts Pure Lens catalog, readiness rules, flow map, and ranked actions
│   │   ├── lensDeclarationPlan.ts Derived walkthrough and worked examples for the five declaration files
│   │   ├── lensDeclarationDraft.ts Untrusted-model boundary for a proposed declaration: refuse, anchor-check, withhold, merge
│   │   ├── lensTarget.ts Versioned, validated source/evidence target contract for Lens
│   │   ├── lensGraph.ts Versioned, bounded graph and edge-evidence trust boundary
│   │   ├── lensCodeImpact.ts Deterministic caller/callee/reference change-impact projection
│   │   ├── lensTestMap.ts Conservative test-path classification over source-backed links
│   │   ├── lensDataTrust.ts Explicit field trust policy and connected-endpoint projection
│   │   ├── lensStateMachine.ts Strict declared lifecycle model and reachability projection
│   │   ├── lensConfigResolution.ts Explicit configuration precedence and value-policy projection
│   │   ├── lensChangeStory.ts Bounded committed-branch path/commit story projection
│   │   ├── lensContract.ts Contract fields, explicit mappings, suppressions, and wiring review
│   │   ├── lensContractSources.ts Bounded TypeScript, OpenAPI/JSON Schema, and heuristic SQL adapters
│   │   ├── lensContractDrift.ts Finding classes and active/suppressed severity summaries
│   │   ├── lensEndpoints.ts Committed live-service declarations; names a secret, never holds one
│   │   ├── lensProbePolicy.ts What a probe may send and where — read-only by construction
│   │   ├── lensServedContract.ts Untrusted served-schema derivation; shape only, values discarded by name
│   │   ├── lensLiveDrift.ts Declared vs. served comparison: absent, undeclared, type, nullability
│   │   ├── lensReachability.ts Which declared services answered, and which are dead ends
│   │   ├── lensLiveTrust.ts Served fields against declared classification policy
│   │   ├── lensProbeRunner.ts One probe end to end, every dependency injected
│   │   ├── lensDatabaseDialect.ts Every SQL statement AtlasMind can send, as constants
│   │   ├── lensCredentials.ts Connection-string parsing that cannot carry a password out
│   │   ├── lensDatabaseReading.ts Catalog rows into contracts, metrics, latency and plans
│   │   ├── lensSchemaImpact.ts Bounded proposed field-change impact ranking
│   │   └── lensContractRelations.ts Relationship trust boundary and endpoint resolution
│   ├── utils/            Shared helpers: `secretRedactor.ts`, `aiInstructionSync.ts` (inbound import), `aiInstructionMerge.ts` (two-way instruction-set sync), `managedBlock.ts` (shared delimited-block upsert/strip), `testingProtocolSync.ts` (outbound sync of the three managed blocks: testing protocols, debt markers, workflow), `instructionSyncCheck.ts` (vscode-free staleness check the pre-commit hook calls), `terminalOutput.ts` (ANSI/control-sequence sanitizer for captured tool output)
│   ├── mcp/              MCP client/registry plus bundled Buzz CLI communications bridge/server
│   ├── ard/              Agentic Resource Discovery: `ardClient.ts`, `ardRegistry.ts`, `ardInstaller.ts`, `ardCatalogExporter.ts`
│   ├── memory/           SSOT memory manager
│   ├── providers/        LLM provider adapters (for example `anthropic.ts`, `copilot.ts`); also `acp.ts` + `acpProtocol.ts` + `acpLaunch.ts` + `acpWindowsLauncher.ts` + `acpPermission.ts` + `acpInstaller.ts` + `acpEffort.ts` + `acpHostPolicy.ts` (Agent Client Protocol), `copilotMultiplierSync.ts`, `localModelSync.ts`, `modelRole.ts` (non-chat model exclusion, pure), `gpuProbe.ts` + `gpuProbeParse.ts` (GPU memory probing), `localFootprint.ts` (VRAM footprint estimation), `localRuntimeClient.ts` (local runtime residency), and `localModelRecommendationRegistry.ts`
│   ├── skills/           Built-in skill handlers (for example `dockerCli.ts`, `terminalRun.ts`, `gitApplyPatch.ts`)
│   ├── views/            Webview panels and tree views (including `personalityProfilePanel.ts`, `modelComparisonPanel.ts`, `missionControlPanel.ts`, `websiteStudioPanel.ts` + `websiteStudioStyles.ts`, the website preview surface `websitePreviewPanel.ts` + `websitePreviewHost.ts`, stack setup in `websiteStackSetupHost.ts`, feedback import in `websiteReviewHost.ts`, and presentation-only Models tree preferences in `modelSidebarVisibility.ts`); the chat panel's slash handling is `chatSlashRouting.ts` (pure router) + `chatStreamCollector.ts` (replays the participant's handlers into memory)
│   │   ├── lensDashboardPanel.ts The Atlas Lenses dashboard: catalog, flow map, next actions
│   │   ├── lensDeclarationGuidePanel.ts Per-file declaration guide with the Ask Atlas drafter
│   │   ├── lensVisuals.ts Shared Lens design system, flowing-link renderer, and ⓘ popovers
│   │   ├── lensTreeView.ts Active-file Code Explorer and action menu
│   │   ├── lensLanguageGraph.ts VS Code call-hierarchy/reference adapter
│   │   ├── lensJourneyPanel.ts Editor-hosted possible-flow graph and text alternative
│   │   ├── lensImpactPanel.ts Editor-hosted code-impact map and text alternative
│   │   ├── lensTestPanel.ts Editor-hosted test-evidence map and text alternative
│   │   ├── lensStateCommand.ts Workspace/machine selection for declared lifecycles
│   │   ├── lensStatePanel.ts Editor-hosted state lifecycle map and transition list
│   │   ├── lensConfigCommand.ts Workspace/setting selection for configuration resolution
│   │   ├── lensConfigPanel.ts Editor-hosted configuration precedence chain
│   │   ├── lensChangeStoryCommand.ts Read-only Git base/merge-base evidence collection
│   │   ├── lensChangeStoryPanel.ts Editor-hosted branch Change Story
│   │   ├── lensContractReviewCommand.ts Contract discovery, pair selection, and mapping load
│   │   ├── lensContractReviewPanel.ts Filterable Field Wiring review webview
│   │   ├── lensLiveCommand.ts Endpoint selection, the type-to-confirm gate, and session results
│   │   ├── lensLiveTransport.ts HTTP and MCP probe execution; no redirects, capped while reading
│   │   ├── lensDatabaseTransport.ts Postgres/MySQL/vendor-HTTP probes; drivers lazily loaded
│   │   ├── lensCredentialCommand.ts Store and clear a connection string in SecretStorage
│   │   └── lensLivePanel.ts Editor-hosted drift, reachability, and live trust results
│   ├── voice/            TTS/STT: `voiceManager.ts` bridge, `hostSpeechSynthesizer.ts` (OS TTS), `localTranscriber.ts` (on-device Whisper STT)
│   └── bootstrap/        Project bootstrapper
├── schemas/
│   ├── lens-mappings.schema.json VS Code guidance for repository-authored Lens mappings
│   ├── lens-data-trust.schema.json VS Code guidance for explicit Lens field trust metadata
│   ├── lens-state.schema.json VS Code guidance for declared Lens state machines
│   ├── lens-config.schema.json VS Code guidance for declared Lens configuration precedence
│   └── lens-endpoints.schema.json VS Code guidance for declared live services (never a credential value)
├── tests/                Vitest unit tests
│   ├── core/             Core service unit tests
│   ├── memory/           Memory manager and scanner tests
│   ├── mcp/              MCP client, registry, environment, and Buzz bridge unit tests
│   ├── ard/              ARD client, registry, installer, and catalog exporter tests
│   └── skills/           Built-in skill unit tests
└── out/                  Compiled JavaScript (gitignored)

- **User Environment Tracking**: On activation, AtlasMind detects and stores each user's OS, hardware, shell, and editor in a private, user-scoped location (VS Code SecretStorage). This is never shared with other users or the workspace. Multiple environments per user are supported.
```

### AtlasMind Lens development boundary

The first Lens surface is intentionally native: `LensTreeProvider` asks VS Code's document-symbol provider for the active file and renders the returned nested symbols. Keep language-specific parsing out of the view. Symbol filters operate on normalized language-service kind names, prune recursively, and retain ancestors of matching descendants. New Lens adapters should normalize their output into `LensVisualTarget`, publish evidence provenance, and remain useful when only part of a graph is known.

Command and webview inputs are untrusted. Re-run `normalizeLensTarget`, bind every source target to the live workspace folder name and index, keep paths root-relative, and revalidate all three values against the selected URI before acting. Target actions must be host-declared choices rather than browser- or language-provider-supplied prompts. Never attach source contents automatically, and route questions through the preferred chat surface as a draft plus one-shot context. A view becoming visible or a filter changing must not spend model budget or execute project code.

Graph adapters must finish at `normalizeLensGraph`; do not pass raw language-provider or model records to a webview. The initial possible-flow budget is 80 nodes, 160 edges, and two outgoing-call levels. Keep provider failure as an evidence notice rather than converting unknown relationships into defects. `LensJourneyPanel` receives graph data only through the host-to-webview ready handshake and renders labels with DOM text nodes. Its `openNode` and `askNode` messages contain only a node id; resolve the target from the host-held graph and revalidate workspace ownership before acting. Every visual graph needs an equivalent text/list view and keyboard-operable actions.

Contract adapters must emit complete `LensContract` records and pass them through `normalizeLensContract`; never silently discard malformed fields, because doing so can manufacture a false missing wire. Use `coverage: partial` or `unknown` when the source cannot prove completeness. Compare adjacent boundaries with `reviewLensContractWiring`. Exact compatible declarations may match automatically by field path, but drops, introductions, renames, transforms, and explicit inferences belong in `.atlasmind/lens-mappings.json`. Every mapping names both contract ids even when one field endpoint is absent, so the rule cannot apply to another boundary. The manifest-contributed schema is editing guidance; `normalizeLensContractMappingFile` remains the untrusted-file boundary. Suppressions stay attached to output as reviewable annotations rather than hiding wires.

Data-trust metadata belongs in `.atlasmind/lens-data-trust.json`, not in source-name heuristics or sample values. Every rule must name one normalized contract id and field path; duplicate endpoints make the file invalid. Store classifications, declared control names, and bounded policy context only—never secret or personal data values. JSON Schema is editor guidance; `normalizeLensDataTrustPolicyFile` is the runtime boundary. A declared control records policy intent and must not be described as observed implementation or runtime verification.

Lifecycle topology belongs in `.atlasmind/lens-state.json`. Keep machine, state, and transition ids unique and make every transition endpoint resolve inside its machine. `normalizeLensStateMachineFile` remains the runtime trust boundary even though the manifest contributes JSON Schema guidance. Optional source anchors must be root-relative and range-backed only when the location is defensible. Never import/evaluate a project state module to improve the map, and never describe declared event, guard, effect, reachability, or dead-end results as observed execution. Runtime comparison needs a separate explicit evidence adapter.

Configuration precedence metadata belongs in `.atlasmind/lens-config.json`. Every setting/source id, key, and precedence level must be unique inside its scope. Use `valuePolicy: "masked"` for credentials or sensitive values: masked sources must omit `value` entirely and may record presence only. Display policy is limited to bounded control-safe scalars and must never be used for sensitive data. The schema is editing guidance; `normalizeLensConfigFile` is the runtime boundary. Open/Ask targets may name source kind, precedence, and resolution status, but must never carry any value. Do not read the live process environment, SecretStorage, runtime memory, or remote flag services as a side effect of opening the declared view.

Declaration setup belongs in `lensDeclarations.ts`, `lensDeclarationPlan.ts`, `lensDeclarationDraft.ts`, and the two view modules, not in the individual State/Configuration commands. Resolve a file's path through `findLensDeclarationDescriptor`, never a local conditional on the kind: a two-armed `kind === 'state' ? … : …` silently routed every other kind to the configuration file as soon as a third kind existed. Keep status collection read-only: rendering onboarding, Settings, or Project Dashboard must never seed a repository file. A starter must remain valid and semantics-free—version plus an empty collection—because the extension cannot truthfully invent a project's states, transitions, precedence, values, or secret presence. Creation is exact-path and create-only (`wx`); never replace it with a preflight followed by an overwriting write. Every missing-file route should return to the shared setup command so the four discovery surfaces cannot drift into four formats or remedies.

Change Story collection must remain read-only and shell-free. Keep the Git executable fixed, pass fixed read operations as argument arrays, choose bases only from bounded refs returned by the repository, require the workspace folder to be the Git root, and parse filename evidence with `-z`. Feed only normalized commit/path records to `buildLensChangeStory`; never post raw Git output or diff contents to the webview. On an explicit **Ask Atlas**, re-resolve the host-held change id and read the exact head ref—not the checked-out workspace—through bounded `git diff`/`git cat-file` calls. The one-shot Chat context may carry at most the declared patch limit and full content only below the declared object-size limit; fence both as reported source data. If that read fails, refuse rather than substituting another branch's file. Deleted paths cannot form live source targets. Detect and name a dirty worktree but do not mix it into committed evidence. Filename categories are navigation signals, never semantic/runtime/compatibility/test/deployment proof. Remote PR bodies, issues, reviews, CI/checks, and runtime evidence require separate adapters.

The initial discovery command deliberately scans filename-signalled JSON (`schema`, `contract`, `openapi`, `swagger`), TypeScript (`dto`, `model`, `schema`, `type`, `entity`, `contract`, `interface`, `request`, `response`), plus SQL, with 200-file/200-contract and 2 MB per-source budgets. Keep JSON parsing strict and SQL/TypeScript extraction declaration-only; never execute SQL or import/evaluate project modules to improve coverage. The TypeScript syntax adapter must keep partial coverage and must not claim to resolve aliases, inheritance, mapped types, decorators, initializers, or runtime validators. New adapters must state `complete`, `partial`, or `unknown`, preserve source-kind/evidence, and attach a normalized source target only when the range is defensible. Keep base type separate from format or other constraints: one-sided evidence is unverified, while two contradictory declarations are incompatible. `LensContractReviewPanel` must receive only normalized/recomputed snapshots after its ready handshake, render untrusted text through DOM nodes, and resolve field/wire ids in the host. Do not render an Ask/Open affordance when no source anchor exists.

Contract drift classification consumes only `LensContractReview`; it must not rediscover endpoints or reinterpret absence as a defect. Keep exact wires finding-free, incompatible declarations definite, stale endpoints in an explicit mapping dead, and ordinary unmatched wires informational/missing-evidence. Suppressions remain records and must be excluded only from active severity counts, never from total/class counts. When a finding is handed to chat, enrich the existing source-anchored relation target in the host; the webview still sends only the bounded wire id.

Schema change-impact preview must remain a proposal, not a write path. Resolve the seed field and change kind in the extension host, re-normalize contracts, verify the selected review boundary, follow only normalized wires, cap output, and label rule-based compatibility/validation/migration/deployment implications as inferred. Keep tests, callers, traces, migration history, deployment state, and workspace-wide reachability in notices until evidence adapters exist; absence of a connected endpoint is not absence of consumers. The webview sends field/impact-item ids only, and Open/Ask reuses live workspace-target validation.

Contract relations must pass `normalizeLensContractRelations` before any panel use. Resolve by declared label only when exactly one same-root contract and field match; retain unresolved labels otherwise. SQL extraction currently accepts inline references and single-column foreign-key constraints only, attaches the exact clause target, caps aggregate output, and never executes SQL. Composite/dialect-specific keys stay unknown. The Relationship Map renders text through DOM nodes and returns relation ids only; host-held targets handle Open/Ask. A declared relation can inform change impact but cannot prove runtime traversal.

### Rebuilding the Windows ACP launcher

The release helper is checked in because Marketplace packaging runs on Linux while the helper must be a Windows PE executable. It is intentionally dependency-free Rust and 120 KB in the current release.

On Windows with Rust 1.97 or later:

```powershell
cargo build --locked --release --manifest-path native/acp-private-desktop/Cargo.toml
Copy-Item native/acp-private-desktop/target/release/atlasmind-acp-private-desktop.exe media/bin/atlasmind-acp-private-desktop.exe
Get-FileHash media/bin/atlasmind-acp-private-desktop.exe -Algorithm SHA256
```

Update `ACP_PRIVATE_DESKTOP_HELPER_SHA256` in `src/providers/acpWindowsLauncher.ts` to that exact lowercase hash, then run `npx vitest run tests/providers/acpWindowsLauncher.test.ts`. The suite refuses a source build whose shipped binary and pinned hash differ and, on Windows, executes the bundled PE around both a redirected-stdio console child and an installed `pwsh.exe`. Preserve the documented non-interactive station/desktop access masks, token-default ACL, inherited station/desktop connection (`STARTUPINFO.lpDesktop = NULL` after the helper establishes both objects), and inherited `SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX` error mode. Also preserve the launch ordering in the Rust source: create the agent suspended, assign the kill-on-close Job Object, then resume it; retain the restricted handle list and `STARTF_USESHOWWINDOW`/`SW_HIDE` defence. Review the Rust source and resulting binary together; the helper is security-sensitive even though its feature is opt-in.

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

### A webview outlives the host object that answers it

This is the failure mode to design against, because nothing about it looks like a failure. VS Code
brings a panel and its rendered DOM through a window reload or an extension update; it does not bring
the object that registered `onDidReceiveMessage`. The page comes back looking perfectly healthy —
hover works, CSS works, moving between pages works because that is local — and every message it posts
lands nowhere. Nothing throws, so the console stays clean. It reads as a dozen unrelated dead buttons
rather than as one dead channel, and it was reported exactly that way: as the Delivery runbook's
**copy** and **send to terminal** controls being broken, when every link in that chain was correct.

Delivery discussion adds one more host-side revalidation. Copy/send rebuilds the guide without a Git
probe because cleanliness cannot change the command being copied; **Ask Atlas** must not reuse that
shortcut. It calls `resolveDeliveryGuide({ includeWorkingTree: true })`, performs one bounded
`git status --short`, and carries the resulting clean/dirty/unknown fact into Chat. Failure remains
unknown, never clean. Keep the handoff's approval language declarative (operations remain subject to
approval), because the user-message capability parser enforces explicit no-command wording before tool
selection and a host-authored “do not execute” sentence can otherwise strip the Git tools the handoff
exists to use.

Two things close it, and a panel that persists across a reload needs both.

**Register a serializer.** `commands.ts` registers a `WebviewPanelSerializer` for
`PROJECT_DASHBOARD_VIEW_TYPE`, and `ProjectDashboardPanel.revive()` adopts the restored panel. Two
details are load-bearing. A restored panel keeps its content but *not* its capabilities, so
`webview.options` must be re-applied — without `localResourceRoots` the script the panel is made of
is blocked and it revives into a blank page. And nothing is read out of the restored webview: what it
holds was written by a build that may no longer exist, the panel rebuilds its snapshot from the
workspace on `ready`, so trusting the persisted value would buy nothing and would make a webview's own
storage an input to the host. A panel that cannot be served is disposed, not left on screen.

The view type lives in `webviewUtils.ts` rather than in the panel, so `commands.ts` can register the
serializer without statically importing a large module onto the activation path. One definition,
because a serializer registered under a view type that does not match the panel's never fires and
nothing reports that.

**Watch for silence.** A serializer cannot cover every case — the host can go away for reasons VS Code
will not restore from. So a request the host must answer arms a watchdog in the webview, and silence
past the window is rendered as silence rather than as work still in progress. Four rules are worth
copying.

**The host acknowledges receipt before it does anything slow.** `handleMessage` posts a bare `hostAck`
as its first act, ahead of the dispatch. Waiting for the *result* to prove the channel would report a
slow machine as a disconnected one — the same lie in the more damaging direction, because a banner that
cries wolf is one the reader learns to dismiss. Every message is acknowledged, not only `ready`, so any
click proves the channel for the cost of one empty reply.

**Any inbound message counts as proof of life** — a progress notice as much as a result. A watchdog
cleared only by the final reply fires in the middle of a refresh that is working.

**The window is generous and disconnection is never inferred from anything else.** A cold snapshot
reaches git, the filesystem and the routine registry; a slow machine is not a disconnected one.

**The banner's instruction is to close and reopen the tab**, because no control on a page whose host is
gone can reach anything. Its "Try again" makes the same request the Refresh button makes rather than
owning a second recovery path — a recovery route that works when the ordinary one does not is a route
nobody has tested.

`tests/views/dashboardHostConnection.test.ts` executes all of this against the real script.

### Long-running dashboard operations

When a dashboard action delegates work to the Orchestrator, make the lifecycle visible in the panel as well as in VS Code notifications. The activated-testing repair flow is the reference: the extension host sends a started event, concise real routing and approved-tool updates, and one terminal completed or failed result. The webview uses an indeterminate progress control while work is active rather than inventing a percentage, preserves the reported output for review, and distinguishes “task completed” from “tests are green.” Any Chat handoff is host-owned: the browser asks only to open the latest retained result, and Chat receives a redacted, fenced draft that the operator can review before sending.

Webview panels use `getWebviewHtmlShell()` from `src/views/webviewUtils.ts` for consistent styling.

### One design language across every panel

Pass `dashboardSkin: true` to `getWebviewHtmlShell()`. Every panel does, except the Personality Profile (its warm palette is deliberate) and the Project Dashboard itself (its stylesheet is what the shared one was extracted from). `tests/views/sharedPanelTheme.test.ts` fails if a new panel quietly opts out.

The shell wraps a panel's `extraCss` in the two layers exported by `src/views/dashboardTheme.ts`, and the order is the whole mechanism:

| Layer | Position | Contents |
|---|---|---|
| `DASHBOARD_PANEL_BASE_CSS` | before the panel's CSS | design tokens, legacy token aliases, the reduced-motion baseline, shared control primitives, the page frame |
| the panel's own `extraCss` | middle | everything specific to that panel |
| `DASHBOARD_PANEL_SKIN_CSS` | after the panel's CSS | surface, radius, border, shadow and type for the shared class vocabulary |

A panel therefore keeps its **layout** — grid templates, gaps, flex direction, sticky offsets — and loses its **palette**. Do not concatenate the layers by hand; there is deliberately no helper that does it, because a second entry point is a second chance to get the order backwards, and the symptom of getting it backwards is a panel that looks exactly as it did before.

Three rules when working on panel CSS:

- **Do not open a stylesheet with a `:root` block.** Nineteen panels used to, under five different prefixes (`--atlas-*`, `--lens-*`, `--run-*`, `--studio-*`, `--atlas-panel-*`), and four of those had drifted into slightly different copies of the dashboard's. Those names still resolve, through `DASHBOARD_TOKEN_ALIASES_CSS`; new work should use `--dash-*` directly. The test above rejects a redeclaration.
- **Register a new surface rather than styling one.** A page-level container joins `CARD_SELECTOR` in `dashboardTheme.ts`; a nav rail joins `NAV_RAIL_SELECTOR`; a header joins `HEADER_SELECTOR`. Anything not on a list keeps its own styling, visibly, which is the intended failure mode — a substring match on `-card` would silently repaint the next class somebody names after one.
- **Some things are excluded on purpose,** and should stay excluded: the Ideation board's tinted sticky notes, the chat transcript, and toned notices (`.status-banner`, `.warning-note`, `.info-band`). A shared surface must not overwrite a colour that carries meaning. The Lens accent is the same case in the tokens — eight lenses, eight hues, so the header rule says which lens you are reading.

The Agent Manager's skill controls map directly onto `AgentDefinition.skillPolicy`: task-scoped, manual allowlist, and the separately labelled advanced all-enabled override. Keep the advanced choice explicit because it admits future custom/MCP skills as well as those visible today. Webview payload validation accepts the legacy shape, but the extension host—not the browser—derives and persists the policy. New and synthesized agents default to task-scoped selection.

Actionable failures and explanatory cards use the shared `ATLAS_DISCUSS_ACTION_CSS` / `renderAtlasDiscussAction()` affordance rather than introducing panel-specific “Ask Atlas” chrome. The compact control is a **pill carrying two symbols**: the AtlasMind mark on the left saying who is being asked, and an intent glyph on the right saying what pressing it will do. It was the mark alone until v0.360.0, which named the who and never the what — a row of these was a row of identical circles, and telling two apart meant hovering each one. Intents come from `ATLAS_ACTION_GLYPHS` (`discuss`, `improve`, `fix`, `draft`, `summarise`); pass one via `intent` and omit it only where `discuss` is genuinely right, since the default is a fallback rather than a choice. The vocabulary is deliberately short, because a symbol set nobody can learn is decoration. The dashboard's webview script keeps its own copy — it is a string handed to a browser and cannot import from the host — and a test in `tests/views/workflowSurface.test.ts` pins the two tables together. The glyph **narrows** the meaning and never carries it alone: it is `aria-hidden`, the `title` must still state exactly what pressing the button will do, and the `aria-label` must carry the same topic and intent for assistive technology; the visually hidden label is not optional. `ATLAS_ICON_DATA_URI` supplies the same CSP-safe mark to panels without local resource roots, and the shared CSS inverts it in dark and high-contrast themes. Prefer an opaque record id in the webview message and re-read the current record in the extension host.

There are two distinct handoff shapes. Operational errors contain process-, tool-, or repository-derived text, so they are redacted, bounded, fenced as reported data, and placed in an unsent Chat draft. A fact AtlasMind itself owns should not be sent through the model router merely to restate it: Testing Policy Coverage rebuilds the live row, combines it with the declared 23-methodology layman guide, and uses a one-shot `ChatPanelDirectResponse` carrying the immediate answer plus bounded quick-reply prompts. Direct responses are normalized at the Chat target boundary, accept only `atlasmind/*` source ids, are secret-redacted and length-capped, and are consumed before any await. They carry no command id and must not be used as a shortcut around ordinary model/tool approval for investigative or mutating work.

The shell's responsive sizing contract distinguishes containers from content. Grid and flex containers may use `min-width: 0` so a panel can contract, but do not apply that reset to inline text, labels, buttons, or badges: doing so changes their minimum contribution to almost nothing and invites character-by-character wrapping. Normal prose and controls use word-boundary wrapping and stay within `max-width: 100%`; reserve `overflow-wrap: anywhere` for unbroken content such as URLs. In compact mixed-content rows, keep intrinsic columns such as a kind badge or numeric score at `max-content` and give the descriptive column `minmax(0, 1fr)`. `tests/views/panelWiring.test.ts` pins this contract and the Project Ideation checklist/analytics implementation.

UI Studio follows the same extension-host/webview split while retaining the compatibility-named
`websiteStudioPanel.ts` and command id. It renders a profile-aware sequence: Brief, Sitemap or Screens
& Flows, Content Design, UI System, Wireframes, Full Preview, Implementation, and website-only n8n. Non-website
profiles never render SEO, stack, hosting, Delivery comparison, or n8n controls. Every incoming message
is checked by `isWebsiteStudioMessage()` and the main payload passes through
`sanitizeWebsiteWorkspace()` before persistence.

Format v13 adds bounded adapter evidence/capability/loss reports; v12 added revisioned repository mappings and host-created verification fingerprints; v11 added validated asset metadata and stable node assignments; v10 added bounded sample-data collections and explicit node bindings; v9 added optional node-owned content-state presentations; v8 added reusable component definitions and explicit instances; v7 added typed
tokens and v6 introduced screens/nodes. `uiDesignGraph.ts` is the only compatibility converter and system-definition sanitizer: when a graph is
present it derives page wireframes for older renderers, and when the current canvas submits its temporary
wireframe batch the host transcribes that batch once and advances the graph revision. Do not add another
graph/wireframe converter. New design mutations belong in `uiEditCommands.ts`; its expected-revision check,
closed command union, bounded geometry/hierarchy, and monotonic history are the contract the live preview
will use too.

Repository mappings are host-owned through `uiRepositoryMapping.ts`, not part of the general save payload.
Keep the adapter catalog closed, the path workspace-relative, and verification hash-only. The host resolves
real paths, rejects symlink escape/non-files/files over 2 MiB, and computes the design and source fingerprints;
the webview may only request an exact revisioned mapping edit or verification. A definition edit clears the
baseline. Divergence is descriptive and never imports, evaluates, rewrites, or automatically reconciles source.

`import-mapping-evidence` is the only adapter-import webview command. It carries a mapping id and expected
mapping revision—never source, a parser choice, facts, or a report. The host reads the same contained snapshot
as verification and calls `uiRepositoryImport.ts`. Keep recognizers conservative and deterministic: every
built-in report stays partial with a loss; custom stays unsupported; no adapter executes code or resolves
dependencies. Copying exact-match suggestions changes only visible form fields until a separate set-mapping
command is submitted, which clears both the verification baseline and prior import report.

Token definitions are structured target-independent data, not CSS fragments. Keep new token kinds closed
and bounded in `uiDesignGraph.ts`; aliases must remain same-kind, acyclic, and resolvable to a direct value.
Format migrations must seed no visual choices. The v7 → v8 step adds an empty `components` collection only.
Components store no markup, CSS, or executable/source values: root kind, typed properties, variants, slots,
states, and bounded instance overrides remain target-independent graph data.

UI System token changes must use `add-token`, `set-token`, or `delete-token`; the ordinary save form must not
carry a replacement graph. Preview conversion belongs in `websiteWireframePreview.ts`: semantic roles are a
small reserved-id allowlist, while all resolved definitions use hex-encoded-id custom properties so graph
identities cannot become CSS syntax or collide after punctuation normalization. Keep Studio canvas and Full
Preview on those same reserved roles. A running Full Preview remains a saved-design review surface and is
rebuilt after Save/Refresh; do not render unsaved webview-only token state into it.

Component-library changes must use `add-component`, `set-component`, or `delete-component`; node assignments
use `set-node-component` and slot claims use `set-node-component-slot`. Definition and instance actions stay
separate in the UI and reducer. When extending the model, preserve resolution order (default → variant →
instance), retain provenance, reconcile removed properties/variants/states/slots deterministically, and refuse
definition deletion or incompatible root-kind changes while an instance uses it. The Full Preview adapter may
style only the closed state vocabulary and must escape displayed definition/variant labels.

Short empty/loading/error/success copy uses `set-node-content-state`; selecting a presentation for design
review uses `set-node-preview-content-state`. Do not move long-form screen copy out of its Markdown file or
infer state copy during migration. A non-default preview state requires an authored presentation, and approved
state copy must remain impossible while it contains `[PLACEHOLDER: …]`. Data bindings may select these states
for review but must not silently author them.

Preview fixture changes use `add-content-collection`, `set-content-collection`, or
`delete-content-collection`; node assignments use `set-node-data-binding`. Keep these records explicitly
sample-only: no production response import, credential, connector, query, or template language belongs in the
graph. A collection edit must refuse to remove a sample or field used by a binding. Sanitization deliberately
retains a well-shaped stale reference from a hand edit so `diagnoseUiContentBindings()` can report the missing
collection, record, field, value, or interface state at its owning node. Full Preview may render only declared
fixture values and must not make a network request.

Asset-library changes use `add-asset`, `set-asset`, or `delete-asset`; node assignment uses
`set-node-asset`. Keep sources as validated references only: normalized workspace-relative paths or HTTPS
URLs with no credentials, query, or fragment. Do not store binaries, data URLs, signed URLs, or secrets in
the graph. In-use deletion is refused, stale hand-edited ids remain owning-node diagnostics, and a
non-decorative assigned asset without alt text is an error. Full Preview may project dimensions, crop, focal
point, provenance, and alt status as inert markup; resolving a binary requires a separate guarded host path
and must not weaken the preview's no-network CSP.

Content files are a separate source of truth. `savePageContent` and `seedPageContent` may carry only a
bounded page id and bounded content fields; the host resolves that id against the current sanitized
plan, and `WebsiteContentManager` derives the path. Save includes the body originally opened and is
refused if disk now differs. Seeding is create-only and placeholder-only. Do not fold copy into
`website.json`, accept a webview-supplied path, or auto-merge concurrent prose.

For website profiles, treat all displayed hosting policy fields as presentation only: the host
reconstructs canonical environment names, access policies, hosting restrictions, and Production
protection; `assessWebsiteHostingEnvironments()` validates loopback/HTTPS/password-reference/review-
subdomain readiness. Credential inputs are references with an explicit provider prefix, never values.
Keep platform deployment and n8n execution out of the webview.

The Studio's CSS lives in `websiteStudioStyles.ts` and its behaviour in `media/websiteStudio.js` (read inline by the panel, as `projectDashboardPanel` does). Four rules matter when working on the canvas:

- **Geometry is canvas units, never pixels.** The canvas is a fixed 1000-unit column grid; the webview converts pointer positions into units before anything is stored. A pixel that reaches `website.json` records the author's monitor size in a committed file.
- **The webview sends data, never a command.** `promptForTarget` carries a scope, some ids and the user's sentence; `generate` carries a stage and ids. The panel composes the prompt and decides the file list. A webview that could name a path or a command would make every gate advisory.
- **Canvas mutations are closed design commands, not arbitrary patches.** `editDesignGraph` carries one exact
  `UiEditCommand` with the current revision. The host parses it again, applies it to its bounded session, and
  returns only the compatibility wireframes. Save names `designRevision`; the host supplies the graph. Keep
  pointer, keyboard, inspector, preview, and future model proposals on this same reducer path. Responsive
  overrides likewise use exact set/clear commands: a non-base breakpoint plus bounded geometry and/or
  Boolean visibility, never a style object or graph fragment. Resolve display values with
  `resolveUiNodeLayout()` so provenance and tablet-to-mobile inheritance cannot drift between surfaces.
- **The responsive canvas consumes a host projection, not a JavaScript resolver.** Add computed fields to
  `buildWebsiteStudioResponsiveScreens()` and its bounded webview snapshot; do not copy inheritance rules
  into `media/websiteStudio.js`. Geometry and visibility reset independently via
  `clear-node-viewport-override.property`. Responsive drag/resize/nudge may optimistically project the
  host-resolved rectangle for immediate feedback, but pointer-up must submit the existing exact viewport
  command and accept the next host snapshot as authoritative. Keep drawing, deletion, nesting, and all
  parent changes confined to the declared base breakpoint.
- **Multi-selection transforms are one command, not a message loop.** `set-node-frames` carries a bounded,
  unique list of node ids and rectangles plus an optional non-base breakpoint. The reducer validates every
  target before cloning or mutating, then creates one revision and undo record. Keep alignment, distribution,
  and group nudge on this path so a partial batch cannot survive a stale or missing target. Multi-selection
  does not imply multi-delete; deletion stays single-node until a separately reviewed atomic policy exists.
- **Container layout has one pure host engine.** Extend `resolveUiScreenLayout()` for stack/grid/overlay
  semantics and consume its result in both `buildWebsiteStudioResponsiveScreens()` and
  `websiteWireframePreview.ts`; never reproduce placement rules in the webview or CSS generator. Parent
  behaviour is flat bounded graph data (`mode`, `direction`, `gap`, `padding`, `columns`, `align`,
  `distribute`, width/height sizing, and nullable min/max width/height). Projection must not rewrite stored
  rectangles, because those are the free-layout/intrinsic fallback after reset/undo. Constraints use canvas
  units (width 1–1000, height 1–4000), and the closed boundary refuses an inverted pair. `set-node-layout` is
  the only browser/model mutation path. `wrap` is closed to `nowrap|wrap`; `order` is an integer from -1000
  to 1000. Container resolution sorts a copy and wraps a projection—never reorder `screen.nodes` to render it.
  Duplication must remain one `duplicate-node` command carrying a complete unique source→new identity map;
  never reconstruct it as browser-side `add-node` calls. Lock checks belong in the reducer, including batch
  and implicit structural edits, while the webview's disabled controls provide feedback only.
  Multi-selection pointer drag likewise ends in one `set-node-frames` command. Compute one clamped delta from
  the complete bounds, exclude the selected ids from snap candidates, and do not infer group reparenting.
  Responsive diagnostics belong in `diagnoseUiScreenLayout()` beside the resolver, never in the webview or a
  second geometry implementation. Keep touch thresholds tied to the preview widths and preserve the explicit
  ancestor/overlay exclusions when adding a diagnostic family.
- **Generation is gated twice and confirmed once.** `atlasmind.website.generation.enabled` and `atlasmind.website.preview.enabled` are separate and both default off; every Generate shows a `{modal:true}` dialog naming each file. The plan is built by `planWebsiteGeneration()` before any model call, which is what lets the dialog be specific.
- **Nothing is written outside `.atlasmind/website-preview/`.** Paths are validated at plan time, again when the model's reply is parsed, and again immediately before each write in `websiteGenerationRunner.ts`. Do not remove any of the three: the runner's writer is injected precisely so a test can fail the run if an escaping path is ever passed.
- **Preview has one canonical draft and two consumers.** `writeWireframePreviews()` rebuilds the `_wireframe/` index from saved geometry, safe UI tokens, and Markdown content; generated output may be linked but never becomes the entry point. Each page receives its matching graph screen, and the pure renderer emits inherited tablet/mobile geometry and visibility as static media rules before the host injects `UI_PREVIEW_RUNTIME_SCRIPT`. Simple Browser receives revision and selection SSE events, reloads after a successful render, and can send a clicked saved identity back; the responsive lab remains a scriptless iframe and is refreshed by its extension host. Both consume the same tokenized loopback URL.
- **The live protocol is three exact paths, never an API namespace.** `_atlas/runtime.js` is returned from a
  frozen constant, `_atlas/events` accepts GET/HEAD only, and `_atlas/selection` accepts only a 512-byte
  current-revision identity POST. Static `.js` remains refused, listeners cap at eight, saved-graph resolution
  precedes fan-out, and Stop Preview closes streams and idle sockets. Add future browser-to-host events as a
  separately reviewed closed protocol; do not turn these routes into arbitrary messages.

Stack setup adds four rules of its own, and each is pinned by a test rather than left as a convention:

- **Every command is a module constant** in `websiteFrameworks.ts` or `websiteCiTemplate.ts`. Never composed from a setting, a webview message, a fetched page, or a model. If you add a framework, add its command as a literal — a command built from input is remote code execution with extra steps, and `tests/core/websiteStackSetup.test.ts` walks every producible plan to catch it.
- **No shell, ever.** Executable steps are `execFile(command, args)` with `shell` left false. The test suite also rejects any step whose command names a shell or a downloader.
- **Create-only for anything that could destroy work** — config files, `package.json` scripts, branches, workflows. An existing one is reported untouched. A scaffolder that overwrites can only safely be run once, which makes it useless for the case it exists for.
- **Re-probe, never infer.** A scaffold command can exit zero having done nothing; `websiteStackSetupHost.ts` checks the filesystem afterwards and reports what is actually there.

Tests live in `tests/core/website*.test.ts`, `tests/core/uiDesignGraph.test.ts`,
`tests/core/uiEditCommands.test.ts`, and `tests/core/uiPreviewRuntime.test.ts` (including property tests for the graph/wireframe sanitizers and preview
path resolution, exact selection payload/revision checks, loopback token isolation, plus exhaustive walks for the setup planner and CI templates), with panel coverage in
`tests/views/websiteStudioPanel.test.ts` / `tests/views/websitePreviewPanel.test.ts`. The three executable
cross-target foundation scenarios are declared in `tests/fixtures/uiStudioReferenceProjects.ts` and run by
`tests/core/uiStudioReferenceProjects.test.ts`; keep migration, reopening, edit/history, selection, full
preview, and graph-neutrality coverage aligned when the shared graph contract changes.

The full-preview browser protocol is intentionally smaller than the Studio webview protocol. `runtime.js`
and the SSE stream are GET-only; `_atlas/selection` is the sole POST and carries exactly a render revision,
screen ID, and node ID in at most 512 bytes. Add no generic message envelope. A new browser-to-host event
needs its own exact route, payload cap, parser, stale-state rule, host-side resolution, and hostile-input
integration coverage. Selection remains ephemeral and must never call the graph reducer or a filesystem writer.

That shared shell is also used by compact sidebar webview views such as the AtlasMind Quick Links strip, so even very small sidebar surfaces still inherit the same CSP, nonce handling, and HTML escaping rules as the larger dashboard-style panels.

The dedicated chat panel now also carries lightweight runtime state for recovery-specific UI. When the extension host detects explicit operator frustration and biases the current turn toward direct corrective action, the panel receives a `recoveryNotice` payload and renders a banner near the transcript status area. Keep that state in the extension host and pass only already-sanitized strings into the webview so the browser script remains a pure renderer. Each chat surface keeps its own selected session pinned locally; session-change events should refresh state without forcing every open chat surface onto the globally active session. The composer mode is also status-driven: idle sessions default to `Send`, the active busy session flips to `Steer`, and one-shot `New Chat` or `New Session` choices immediately fall back to the live state after they are queued. During a busy turn, `media/chatPanel.js` appends the last host-provided `streamingModels` entry to the status text above the composer and updates it on failover; keep this decoration in the shared status helper so progress and search messages do not accidentally erase the active model. Tool-loop progress still includes a structured `[TOOL_EXEC]` payload prefix, but the webview now renders tooling updates inside the streaming inner-monologue block: by default only the latest line is shown, and earlier updates are available behind a collapsible disclosure. Project-run offers are stored as validated transcript metadata and rendered as a host-resolved card; the browser may request only `start`, `save`, or `cancel`, while the extension host re-reads the pending goal, prevents double resolution, and routes saving through Project Run Center. **Bursty state pushes are coalesced** (`scheduleCoalescedSync`, roughly one frame): a full `syncState()` enumerates providers through credential storage, reads the checkpoint store and run history off disk, rebuilds the context meter over the whole transcript and re-posts that transcript. Two callers used to run all of that far more often than what they changed warranted — every streamed chunk, which made a turn's cost scale with reply length and session size rather than with the request, and every `onDidChangeVisibleTextEditors` / `onDidChangeActiveTextEditor`, which fire on ordinary navigation while changing only the open-file chip list. Coalescing rate-limits the push and nothing else: a streamed chunk still updates its transcript entry synchronously and `lastActiveTextEditor` is still recorded the moment it changes, because both are sources of truth rather than rendering. The end-of-turn `syncAllPanels()` is the unconditional trailing flush on completion, failure and stop alike, with any pending tick cancelled first. Provider enumeration is additionally reused by coalesced syncs and re-read by every other sync, so its staleness window is one reply; when adding work to `syncState`, decide explicitly whether it belongs on the coalesced path.

Workflow chat guidance follows the same split. The dedicated panel may show the short host-authored `follow` status for the current turn, but it must not add that status as a durable assistant message or ask the operator to repeat a magic phrase. Only the extension host reads the declared workflow and constructs the narrow `WorkflowChatExecutionPolicy`; the Orchestrator revalidates that object and renders fixed system guidance. Never send repository-authored workflow prose, commands, checks, or blockers through this context field.

The Cost Dashboard's period picker is a native `<details>` disclosure in a normal-flow chart toolbar. Do not make its menu an absolute overlay: expanded controls must push the plot down so peak points remain unobscured. Local-savings presentation must filter on local provider/model identity rather than the generic `free` billing category, aggregate input/output tokens by exact local model id, and use `getComparableCloudReference()` so comparison pricing remains centralized in the model catalog. `calculateLocalModelSavings()` is the shared calculation for both the Efficiency summary card and detailed per-model panel; keep those surfaces on the same filtered record window.

**Content Security Policy** is set to:
```
default-src 'none'; img-src <webview-csp-source> https: data:; style-src <webview-csp-source> 'unsafe-inline'; script-src 'nonce-<generated>'; base-uri 'none'; form-action 'none';
```

All dynamic text in webviews must be HTML-escaped using the `escapeHtml()` utility.

Do not use inline JavaScript handlers such as `onclick`. Put script content in the shared shell and protect it with a generated nonce.

Communication between webview and extension uses `vscode.postMessage()` / `onDidReceiveMessage()`. Treat all incoming messages as untrusted and validate them before changing state or touching secrets. The native AtlasMind Chat view keeps exactly five visible title-bar actions: Project Dashboard, Mission Control, Personality Profile, Website Studio, and Settings. Project Ideation, Cost Dashboard, and contextual project-memory maintenance remain in the `…` overflow. Keep that split deliberate: adding a sixth `navigation` slot makes VS Code hide an action unpredictably instead of putting the requested manager shortcuts at the top right. Provider-card Settings shortcuts likewise send a named page id, which the host maps through a fixed allowlist; a card never chooses a command to run.

The shared Atlas chat webview now also hosts live tool-approval cards, so approval-response messages must be validated with the same strict message guards as prompt submission, voting, attachment flows, and the composer history shortcuts that recall recent submitted prompts from persisted webview state. Prompt attachments now keep a lightweight extension-host metadata record per user turn so the chat transcript can render clickable screenshot thumbnails while later same-session follow-ups still receive the prior image context even after the composer has cleared. Its circular toolbar and composer icon buttons now rely on explicit inline-flex centering plus block SVG layout so the shipped glyphs stay optically centered across the different chat-panel controls, detached chat-panel navigation into the Project Run Dashboard and the main sidebar chat view now lives in the VS Code editor title-bar action row instead of the in-panel circular button group, the transcript renderer now parses fenced code blocks before generic paragraph splitting, also splits mixed markdown heading-plus-list sections into separate structural blocks so bullets do not collapse into title-like text, assistant reasoning and work-log metadata now live inside compact disclosure cards with a separate footer utility row for votes and run links, and choice-oriented assistant replies now expose selectable option toggles plus an explicit Proceed button inline in that footer so operators can confirm the next path before Atlas continues. Automatic composer focus restoration is now guarded as well, so background state refreshes only return focus when the operator is still actively working inside the shared chat surface instead of stealing the editor cursor after a panel update. The transcript header role and model badges now share the same compact height and font sizing while staying visually subdued, the Thinking Summary disclosure uses a lighter contrast treatment against the surrounding message bubble, and long-answer transcript typography now uses slightly looser paragraph rhythm, calmer heading weight, tighter list indentation, and softer blockquote styling so dense technical replies stay readable without feeling oversized. The composer info affordance now opens a structured hint panel with titled bullet lists that adapt between idle, busy, and run-inspector guidance while also deriving context-aware tips from live chat state such as pending approvals, pending review, attachments, suggested follow-ups, and the latest user prompt.

Project-run `needs-input` results keep their suggested execution-cap metadata on the original assistant bubble, which renders a direct recovery question with **use once**, **save permanently**, and **keep partial result** chips. The host revalidates the entry and bounded value before applying either change. One-run overrides update only the live Orchestrator and restore its previous value in `finally`; permanent choices write workspace configuration. A custom-panel project stream owns its transcript entry and suppresses the native Settings-button placeholder, so it does not append an inert action line or duplicate the completed run as a second user/assistant pair.

The Project Run Center (`src/views/projectRunCenterPanel.ts`) is intentionally review-first: it explains what preview returns, clarifies that file-impact thresholds are advisory rather than hard execution caps, lets operators open a seeded draft-refinement discussion in a dedicated chat session before executing the reviewed plan, and now persists run-level execution options so autonomous mode, batch checkpoints, chat mirroring, and staged follow-up carry-forward survive refreshes and run-history reloads. Runs launched from Project Ideation also carry durable ideation-origin metadata into run history, which lets the Run Center show where a run came from and send completed or failed learnings back into the originating ideation thread or a fresh ideation thread without losing the execution context. The webview also treats the synthesized final output as a first-class panel alongside compact searchable run history, while the mirrored run chat uses timeline notes to render the live log as an internal-monologue disclosure instead of collapsing that progress into the generic assistant body.

The Project Dashboard (`src/views/projectDashboardPanel.ts`) now includes a dedicated Roadmap page backed by `project_memory/roadmap/improvement-plan.md` and a project-scoped Testing explorer. The Roadmap page carries three views behind one selector — **Dependency canvas** (default), **Prioritised backlog** (everything described below) and **Delivered** — and the canvas is the reason `roadmapGraph.ts`/`roadmapGraphStore.ts` exist. Its markup and pointer handling live in `media/projectDashboard.js` in a block placed *after* `renderRoadmap`, deliberately: `tests/views/workflowSurface.test.ts` slices the webview source from `renderWorkflow` to `renderRoadmap` to assert the Workflow page makes no network call and uses no native `<details>`, so canvas code sitting between those two markers is swept into that page's assertions. Canvas dragging and panning use pointer events rather than HTML5 drag-and-drop, because a drag has to redraw the node's attached edges continuously and drag-and-drop only reports a drop; the backlog list keeps drag-and-drop, since reordering genuinely is one. Local drag offsets are held only until the next snapshot and then dropped, so a position that failed to save never stays on screen looking saved. `tests/views/roadmapCanvasSurface.test.ts` asserts the escaping, the id-only message contract, the offline route filter and the "unmeasured is never rendered as confident" rules against the real webview source. The toolbar's four arranging controls are split by what they change: **Fit all** and **snap to grid** never send a message (fit measures the real frame via `clientWidth`/`clientHeight` and node `offsetHeight` rather than assuming a size, and snap is remembered in webview state); **Auto tree** and its two direction buttons send an orientation only, never coordinates, and always set `state.roadmapFitAfterRender` so the re-flow is followed by a fit — without it the layout changes entirely outside a viewport that never moved, which is why the arrange controls read as inert; the same flag is set when a snapshot brings node ids the canvas has not drawn before (`state.roadmapSeenNodeIds`), and only then, so a redraw does not fight the pan of somebody reading a large plan. The fit is consumed at the end of `render()`, after the nodes it measures exist, and clears its own flag first because fitting itself renders. A drag ends on a `window` `pointerup`/`pointercancel` rather than on `root`, with `lostpointercapture` for the mid-drag innerHTML swap and a window `blur` for an alt-tab away — bound to `root`, any release landing elsewhere left `rmDrag` set permanently and the canvas stopped accepting input. The by-person view is a fourth `state.roadmapView`, laid out host-side by `layoutRoadmapByAssignee` and shipped as `byPerson`/`lanes` on the snapshot so switching stays offline; it deliberately ignores stored positions and offers no drag, mirroring `layoutRoadmapCompletion`. `renderRoadmapFlatNotice` states why a plan with no accepted links lays out as one column — the tree comes from declared edges and a suggestion moves no node by design, a rule that is defensible and otherwise invisible. **Calculate tree** — the AtlasMind-marked button — only asks, with the confirmation and every write in the host. `RM_GRID` in the webview mirrors `ROADMAP_GRID_SIZE` in `roadmapGraph.ts` and the surface test pins them equal, alongside a check that every layout constant is a multiple of it. The testing surface pulls live suite inventory from the workspace, surfaces the active testing-policy label in the highlight row, groups detected tests by category, supports searchable long-list and dropdown browsing for larger repositories, and shows a selected test’s description, likely arrange and assertion summaries, plus a source link that jumps directly to the relevant line in the editor. Its protocol matrix receives `methodologyDefinitions` from the same `TestingDashboardSnapshot` catalogue Settings uses — including description, when-to-use guidance, common tools, and trade-offs — rather than maintaining a second labels-only list in `media/projectDashboard.js`. The Roadmap page validates roadmap-edit messages in the extension host, lets operators add/edit/delete backlog items from the dashboard, and supports drag-reordering so manual priority order feeds AtlasMind’s next-work weighting. The parser now reads only the marked backlog region, filters out import-generator scaffolding (Project Context metadata and Prioritisation-Notes filler) and collapses duplicate lines so the page never lists inappropriate or repeated items; drag-reorder shows a visible ⠿ handle (grab cursor) with a live drop-target highlight; and the "Mark MVP" control carries a plain-language tooltip explaining what a Minimum Viable Product is. The page now opens with a **Road to …** section, scoped by a **release gate** selector — MVP is built in and projects can declare their own gates (public beta, v1.0, v2; up to 12) in a managed `roadmap-gates` block, with one membership toggle per gate on each item and a route computed per gate up front so switching is instant (`src/core/roadmapGates.ts`). Removing a gate strips its tag and never deletes an item, and the heuristic suggestion fallback stays MVP-only. For the MVP gate specifically: items can be flagged for the MVP path with a per-item toggle (persisted non-destructively as a `#mvp` tag inside the file's managed block via `buildMvpSnapshot`/`serializeDashboardRoadmapDocument`, with the tag kept out of the displayed text), with a heuristic fallback that suggests foundational candidates when nothing is tagged. A milestone track and progress bar visualise distance to a first shippable product, a deterministic best-route ordering front-loads foundational/security/architectural work with per-step reasoning, and a "Plan the MVP route with Atlas" button hands a focused prompt to a live chat session (the Gap-Analysis handoff pattern) without adding model calls to dashboard refresh. Every dashboard page now shares one visual/interaction language (modelled on the Delivery page): shared helpers in `media/projectDashboard.js` — `resolveActionAttrs`, `renderPageIntro`, `renderFlowStrip`, plus tone/meter-aware `renderMetricPill` and resolve-or-static `renderSignalCard`/`renderStatCard`/`renderActionCard`/`renderRecommendationItem`/`renderScoreComponent` — guarantee that anything with a hover affordance resolves to a file/page/command/chat action while non-actionable elements render as genuinely static (no misleading hover). Each page opens with a plain-English `renderPageIntro` band (summary + tone chips + primary action), metric pills carry tone status dots and inline meters, and the Operational Score renders its component composition as a coloured flow strip. The same visual-indicator / no-dead-hover language now also extends to the sibling operational webviews: the **Cost Dashboard** (`costDashboardPanel.ts`) tones every summary/feedback card with a status dot and adds a budget-pressure meter to "Today's Spend"; the **Project Run Center** (`projectRunCenterPanel.ts`) drives live tone dots on the "Current posture" pills from run/preview state via `setDotTone`/`getStatusTone`; and the **Project Ideation** hero stat cards (`media/projectIdeation.js` `renderStat`) carry matching tone dots. Each of those panels was audited so no hover-capable control is inert. The **Mission Control** console (`missionControlPanel.ts`) — formerly the least-styled panel — now adopts the Project Dashboard's shared `--dash-*` design tokens directly (gradient page background, 20px-radius gradient panel-cards with soft shadows, display-font headings), with an intro topbar with a live status chip, card-style form sections, and tone status dots on the Recent missions list, so it is visually consistent with the dashboard pages rather than approximating them with `--vscode-*` styling. The two autonomous-delivery surfaces also cross-link: the Project Run Center header has an "🛰 Mission Control" button (`openMissionControl` message → `atlasmind.openMissionControl`) and Mission Control has a "▶ Project Run Center" button (`openRunCenter` message → `atlasmind.openProjectRunCenter`), each routed through the panel's validated webview → command bridge.

Dashboard refresh controls share `renderRefreshAction` and `.refresh-progress-button`: the indeterminate fill uses `--vscode-progressBar-background`, stays inside the pressed button, disables duplicate clicks, reports `aria-busy`, and becomes a static fill under `prefers-reduced-motion`. The browser sets an optimistic busy bit only for the post-message round-trip; `repositoryRefreshBusy`, `branchFetchBusy`, and branch-id-scoped `branchInspectionBusy` host replies own the real lifetime and clear in `finally`. One repository-activity refresh deliberately animates every matching Issues/PR/CI control because that guarded operation loads issues, pull requests, CI, taxonomy, and releases together. **Two host messages now drive that one flag**: `refreshIssues` (all five reads) and `refreshCi` (`gh run list` for the branch and repo, plus at most one `--log-failed` download). They are separate because the costs differ by more than an order of magnitude and somebody watching a build should not re-read a hundred issues to see whether it went green; they share `repositoryActivityRefreshRunning`, so clicking both is a no-op rather than two bursts of API quota. `handleRefreshCi` **records its failure on the snapshot** rather than swallowing it as `handleRefreshIssues` does — there the CI read is tertiary and hiding it would not hide the primary read that succeeded, here it is the entire point of the click. `DashboardCiIntelligence.fetchFailure` is kept apart from `logFailure` (the run list could not be read, versus one run's log could not be read: different causes, different fixes), and a failure *replaces* previously-read runs rather than sitting above them, because old runs under a fresh timestamp report a stale build as the current one. The header refresh exposes **Ctrl+Shift+R** / **⌘⇧R** through a panel-scoped `keydown` handler, visible platform-aware hint, tooltip, and `aria-keyshortcuts`; it works wherever focus sits inside the webview and does not register or override a global VS Code keybinding.

Pipeline Studio is deliberately progressive rather than one dense renderer. `state.pipelineSection` selects
**Start here / Workflow map / Runner / Tests / Analytics / Packages & repo** from a closed id list, and the
start view always remains useful before GitHub history has been loaded. Add unfamiliar pipeline concepts
through `renderInfoHelp`, which reuses the Workflow disclosure store and focus-restoration path; do not add
decorative `i` glyphs with no explanation. Dials and charts use `data-anim-*` plus
`applyValueAnimations()`, while test-cell, checkmark and graph-edge CSS must have a static
`prefers-reduced-motion` outcome.

The Start and Runner setup paths follow a **one-next-action** rule. Start renders the first incomplete
decision as the only primary action, then a compact four-step progress strip; the complete list, specialist
shortcuts, and recent history are native `<details>` disclosures. Runner renders its contextual action and
critical blockers before `setupCard`; the setup disclosure is `open` only when a prerequisite needs action,
and technical evidence stays in a separate closed disclosure. Do not move `runnerBlockers` into a disclosure
or duplicate primary actions at the bottom of the card. Native details are appropriate here because this is
optional depth; explanatory `renderWorkflowHelp`/`renderInfoHelp` controls still use persisted webview state
and focus restoration so an open explanation survives a host-driven re-render.

The beginner route must follow operational time rather than dashboard data availability: choose the
workflow, prepare the machine, queue GitHub, then confirm one temporary runner; read the verdict afterwards.
Do not make Start conditional on `queuedRun` already being in browser state—`prepare()` is the host-owned
operation that discovers and authorises it. Runner setup is intentionally visible rather than hidden behind
an information icon. Render unchecked prerequisites as “Not checked”, keep the live permission badge tied
to `DashboardLocalCiEnablementSnapshot`, and explain that the Docker container removes the need for a
permanent local runner daemon. Do not render raw machine installer commands in the repository workflow.
After inspection finds a missing tool, the webview may post only a closed help id; the host resolves that id
through `LOCAL_CI_SETUP_HELP_URLS`. Explain that Docker/GitHub CLI install outside the workspace. The browser
sign-in command may be copied into the VS Code terminal because it changes OS credential state, not files.
Queue instructions must say `--ref` uses pushed code, recognise both pending and queued workflow states,
and render a typed queue preflight issue separately from fatal runner blockers so the check remains retryable.

`bindPipelineGraph` runs only after the webview DOM is rebuilt. Its pointer and arrow-key handlers may
persist layout coordinates in webview state, but graph interaction is presentation-only: editing a
workflow still goes through the existing host-owned open/review/create boundaries. The Tests view may
render current JUnit aggregates but must not infer flakiness or slow tests without per-test history and
timings. Analytics may use the bounded GitHub runs already in the snapshot; creation-to-update duration is
labelled answer time because it includes queueing. Package/monorepo collection is read-only and bounded:
declared workspaces or one directory level, no repository command execution, no registry value reads, and
no cache/scan/publication claim before a provider adapter supplies it.

The Pipeline page also owns **CI configuration and management**, independently of run-history loading. `src/core/ciManager.ts` parses GitHub Actions files into bounded summaries—triggers and branch scopes, jobs/runners/step counts/timeouts, explicit permissions, concurrency, validation categories and declared cautions—while omitting raw YAML, commands, action inputs and environment values from the webview snapshot. The UI teaches the three layers explicitly: definition (workflow jobs), assignment (`on:` events/branches), and enforcement (required status checks/branch protection), then shows AtlasMind delivery-gate bindings without claiming those settings configure GitHub. Existing workflows open in the editor or enter a proposal-only AtlasMind review through an opaque filename that the host re-resolves. `createCiStarter` accepts no payload: the host derives a Node starter from live workflow config, lockfile and package scripts, confirms path/branches/checks, and writes `.github/workflows/ci.yml` with `wx`; an existing quality CI workflow, unreadable workflow, or occupied target filename suppresses creation to avoid duplicated checks and spend, while release-only automation does not masquerade as quality coverage.

The **trusted workflow** — the file authorising a GitHub job to execute on this machine — is generated by
`src/core/trustedLocalCiStarter.ts` and reviewed by `LocalCiRunnerManager.reviewWorkflow`. Both webview
messages, `assessTrustedCiWorkflow` and `createTrustedCiStarter`, carry **no payload whatsoever**: the host
re-derives the repository from the git remote (via `parseRepoSlug`, so no `gh` is required for either) and
the branch, label and filename from machine-scoped settings. A crafted message can therefore request a
review or a creation but can never name a different file, repository condition, or path outside
`.github/workflows`. Creation writes with `flag: 'wx'`, opens the result for review, and immediately
re-reviews what landed on disk rather than trusting the builder's own check. Review is a pure filesystem
read and is deliberately callable before Docker, `gh` or a queued job exists — the policy used to be
evaluated only at start time, which put the cheapest check at the end of the longest path.

The Pipeline page presents **four views** — Activity, Canvas, Tests, Rules — named for what a person is
doing rather than for the subsystem behind each. `PIPELINE_SECTIONS` is the allowlist and
`PIPELINE_SECTION_ALIASES` remaps ids persisted by the previous eight-tab layout, so a stale
`vscode.getState()` never resolves to a view that no longer exists. Setup is addressable (`setup`) but is
deliberately not a tab: it takes the page over while `pipelineSetupState` reports it unfinished and hands
it back once done. That predicate is computed **once** and shared by the journey card and the header chip,
because two computations of "is setup done" on one screen will eventually disagree.

The Pipeline page's **default view is state-aware**: with no explicitly chosen tab, a project with any
build or run history opens on Builds and only a fresh project opens on the setup journey, whose card
collapses to one line once the durable steps are done and anything has ever built. Routing rules are
editable from the page through `editCiRoutingRule` — a message carrying only a workload id from the closed
vocabulary; the QuickPick candidates are filtered by the same `routeSatisfiesRequirement` the decision
engine uses (trust rule included) and the result passes `validateCiRoutingConfig` before
`CiRoutingConfigManager.save`. `workOnCiFailure` carries no payload and hands the already-fetched
`CiFailureReport` to a chat session through `buildCiFailurePrompt`, which fences the log as reported
content — the builder existed unused since the failure analysis landed.

The Pipeline page's **execution fabric** is the opt-in impure counterpart (`src/core/localCiRunner.ts`). The
webview posts `inspectLocalCiRunner`, `startLocalCiRunner`, or `showLocalCiOutput` with no payload; all
workflow, branch, label, image, capacity and shutdown values are re-read from machine-scoped configuration
by the host. Rendering never probes Docker or GitHub. Inspection is read-only and derives a deterministic
resource plan from host plus Docker-engine capacity. Start performs the live queue/workflow/actor/runner
collision checks, then asks a modal before starting Desktop, pulling a digest or registering anything.
The `gh` registration token crosses the shared `ghClient.ts` boundary through a stream into Docker stdin
and is never captured. Runner output is ANSI/control-sanitized, secret-redacted and bounded before the
output channel or snapshot receives it. Closing the dashboard does not kill a running job; the owning
manager completes its ephemeral cleanup in the extension host. Add provider adapters behind this boundary
rather than adding provider-specific process calls to the panel, and never convert Linux-container evidence
into a native host result.

Queue guidance follows the dashboard command-control contract: never style a branch argument by itself as
runnable code. Render the complete `gh` command and its standard Copy/Send controls together. Queue
Copy/Send messages carry no command payload; the host rebuilds a validated argv value with
`buildLocalCiQueueInvocation` and formats it only at the terminal/clipboard presentation boundary. Cancel
messages carry only a positive run id and the host resolves it against
the current waiting-run issue. The shared command uses no shell-specific wrapper, and `sendText(..., false)`
types it into the workspace-rooted **AtlasMind CI** terminal without pressing Enter, so the configured
PowerShell, Command Prompt, bash, or zsh remains the operator's choice and execution boundary.

The Workflow page's **Your workflow file** card treats enablement as a segment state, not a checkbox decoration. `media/projectDashboard.js` emits `is-enabled` / `is-disabled` on each stage row, while the panel stylesheet colours only the outline and the standard **Enabled** status tag; row content and the 24-pixel marker stay neutral. The explicit **Enabled** / **Disabled** text and `aria-pressed` mean colour speeds up scanning but never carries the state alone.

The Dashboard's **Branches** page is a complete local/cached-remote inventory rather than the Repo page's capped recency list. `collectDashboardBranchInventory` reads `refs/heads` and `refs/remotes` with NUL-separated `git for-each-ref` fields, folds a tracked local/remote pair into one card, and derives current/default/protected/other-worktree, upstream, ahead/behind, merged, latest-commit, author, and 30-day staleness signals. A folded card's activity metadata comes from whichever side has the newest commit, so a behind or diverged local ref cannot make recent-activity ordering stale. The list is collected locally on render; **Fetch latest from remotes** is a separate `git fetch --all --prune --tags` action so opening the panel never hides a network/ref mutation. Cards start compact and keep expansion session-local; **Expand all** / **Collapse all** changes disclosure without changing Git or evidence. Activity, readiness, drift, and name sorts each have an explicit direction, and branch-family grouping applies the selected order within each family. Saved view, sort, order, grouping, and SCM-colour selections are written to both webview state and a host-validated workspace-state record: re-renders remain instant, while closing and recreating the panel restores the same presentation for that workspace. Long commit subjects use CSS ellipsis with the full escaped subject in a native hover title. The optional branch-title chip maps logical branches with a local ref to `--vscode-charts-blue` and remote-only refs to `--vscode-charts-purple`; its persisted **Show SCM colours** checkbox and Local/Remote preview sit immediately above the card inventory where the effect appears. **Work on this branch** sends only an opaque inventory id. `handleActivateBranch` rebuilds the inventory, refuses a dirty tree, another-worktree checkout, remote/local name collision, or vanished item, then confirms before it runs `git switch`; a remote-only item uses `--track -c` to create the local branch. Every card's Atlas icon uses the same opaque-id rule: `handleDiscussBranch` rebuilds live state, resolves commit hashes host-side, and produces a one-shot `ChatPanelDirectResponse` via `buildBranchChatTarget`. Its initial answer is deterministic and model-free: `rev-list --left-right --count` supplies current/production divergence, `git diff --name-only <base>...<selected>` counts selected-side files since the merge base, a declared rule set reports staleness/tracking/worktree/production-history concerns, and a bounded 30-commit `git log` supplies author names only (never addresses). Quick-reply chips enter normal Chat for deeper read-only comparison, issue review, or contributor analysis. Tests cover delimiter safety, local/remote folding, default-ref resolution, staleness/worktree blocking, durable preference validation, logical-branch recency, deterministic response/chip construction, message validation, page/nav parity, and both branch action contracts.

Expanded cards divide actions into **Work** and **Review**. Work's owner picker and icon toolbar sit inside one `branch-action-content` column, preventing the toolbar from auto-placing into the narrow label column; each action is a fixed 36-pixel control with a native tooltip and matching `aria-label`, so compact presentation does not discard the safety explanation. The browser sends `runBranchWorkflow` with an opaque card id and one closed action enum; `handleBranchWorkflow` serializes write operations and reuses `resolveLiveBranchAction` before resolving refs, remotes or commits. **Commit** opens Source Control only after proving the card is the current dirty branch, leaving staging, message review and the final commit visible. **Pull** requires the current clean tracked branch and runs `git pull --ff-only`; a known divergence is refused rather than choosing merge or rebase. **Push** uses a host-resolved remote and explicit `refs/heads/...` refspec, never force; **Publish** additionally sets the upstream after a remote choice and modal confirmation. **Branch from here** validates with `git check-ref-format` and creates a local ref at a host-resolved commit without switching the workspace. **Create pull request** requires evidence that the branch has been pushed and invokes `gh pr create --web`, so GitHub receives no submission until the user reviews its form. Merge, rebase, force-push and automatic commit are absent by design because a compact card cannot provide their necessary conflict and content review.

Human ownership is a shared Project Dashboard primitive rather than page-local state. `buildDashboardWorkTargets` projects concrete active work—branches, roadmap items, issues, pull requests, gaps, risks, debt and documents needing attention—from the already assembled snapshot. `renderDirectorOwnerControl` places the same Director contact picker beside each record and in Director → Assignments. A selection posts only the short-lived target token emitted for that render; `ProjectDashboardPanel` resolves it from its current map, validates the contact against `ProjectDirectorConfig.contacts`, and writes an `Assignment.linkedWork` pair through `sanitizeProjectDirectorConfig`. Branch targets additionally pass through `resolveLiveBranchAction` and must retain the same stable name before ownership is saved. Completed or otherwise inactive work is not offered as a new assignment, while an older linked assignment remains in the Director record rather than being silently deleted. Project State → Waiting on you and Project Director → Follow-ups both derive their active self-owned assignments from that same persisted record. Each tree link carries the stable `linkedWork.id` (or run/assignment/follow-up id) in a validated `ProjectDashboardOpenTarget`; the Director page's **Open work** control uses the same route. The webview validates the target again, clears presentation filters that could hide it, and focuses the matching `data-dashboard-focus-kind/id` record; stale focus ids degrade to page-only navigation.

`src/core/projectVocabulary.ts` is the single reader of the nouns a project has *declared* for its delivery pipeline and Git workflow — stage names, stage kinds, branch refs, and the workflow's integration/release/protected branches. It is pure and `fs`-free: callers pass already-parsed `DeliveryConfig`/`WorkflowConfig` fragments, which keeps it unit-testable (`tests/core/projectVocabulary.test.ts`) and stops it becoming a second reader of `delivery.json`. The Orchestrator reads both files per turn (like the testing config) and passes the result to `selectTaskScopedSkills()` and into the system prompt. When adding to it: a term must come from a file the project maintains — do not infer a stage from branch names, because a wrong stage name aims a promotion at the wrong branch. A stage's `kind` is a valid way to name it (this repository's staging stage is called `Integration`), matching is whole-word (`main` must not match inside `domain`), and `describeDeliveryPipeline` returns `undefined` rather than an empty heading so a project with no pipeline is never described as having none.

The Delivery page's **detected runbook** is built by `collectProjectDeliveryGuide` in `projectDashboardPanel.ts` and the pure `buildProjectDeliveryGuide` in `deliveryManager.ts`. Collection is intentionally bounded to root manifests/lockfiles, the workflow inventory already gathered for the page, the parsed delivery config, the routine registry, and git cleanliness; rendering a dashboard must not run package-manager, compiler, test, cloud, or credential probes. When extending detection, keep exact repository declarations (`configured`) distinct from ecosystem defaults (`conventional`) and human attestations (`manual`). A workspace path may be linked only after the builder has rejected absolute paths and traversal.

The Delivery page's **promotion dialog** (`renderPromotionModal` in `media/projectDashboard.js`) is a fixed-height column — a title that stays put, a `.promo-body` that scrolls, and an action bar pinned to the bottom — rather than a tall card inside a scrolling overlay. Four properties are load-bearing when editing it. **A tick never re-renders the dialog:** `render()` replaces `#dashboard-root` wholesale, so calling it from the attestation handler rebuilt the dialog and reset its scroller, throwing the reader back to the top on every checkbox of a list meant to be worked down in order; `syncPromotionGate()` updates the meters and button states in place instead, and the body carries `data-scroll-key` so the re-renders that *are* legitimate — progress arriving during a run — keep their position. **Checks the machine ran and confirmations only a person can give are separate metered sections**, because they fail for different reasons and are fixed by different people; one list is how a dialog ends up showing a row of green ticks above a disabled button. The protected-stage text box counts as one of the confirmation gates, so the meter and the footer's readiness line cannot disagree with the button. **Controls are disabled, not conditionally rendered** — "Resolve & run" appears whenever a remediation exists, because a control that materialises mid-scroll moves everything under it.

**Closing that dialog is not cancelling, and it is now possible.** The run belongs to the extension host, so the dialog has never been able to stop it — but while running there was no close control at all (the only button was a disabled "Running…"), and `promotionDone` was dropped whenever `state.promotion` was null, so a run somebody dismissed finished silently. That combination made "you can close this" both unavailable and untrue. The dialog now *detaches* rather than cancels (`promotion-detach`, and Escape while a run is in flight), keeping the state so the result still has somewhere to land, and `renderDetachedPromotionNotice` puts a strip on the Delivery page that reports the run and reopens the dialog. Keep the distinction when editing: `promotion-cancel` discards a dialog with nothing running behind it, `promotion-detach` hides one that has.

The runbook's copy / send-to-terminal / run-column actions go through `src/core/deliveryRunPlan.ts` and the `copyDeliveryCommand`, `sendDeliveryCommandToTerminal` and `runDeliveryGuidePhase` messages. The rule when adding to them: **the webview may name a step, never supply a command.** `resolveDeliveryGuide` rebuilds the guide from the workspace and looks the id up; a payload carrying command text would let a crafted message choose what a terminal receives, and `tests/views/dashboardNav.test.ts` fails if one appears. Cleanliness is deliberately left ungathered on that path — it changes a step's status and never a command, so a copy click does not pay for a git call. Keep `sendText(command, false)` for a single command: withholding the newline is what makes the human's keystroke the last gate, and it is why that action needs no dialog while a column run does. Real promotion commands continue to come from host-side persisted configuration after the promotion gate; nothing here touches that path.

`src/core/branchDashboard.ts` is the pure decision layer over that inventory. `deriveBranchDashboard` receives already-sanitized local branch facts plus the most recently and explicitly loaded PRs, repo-wide CI heads, issues, roadmap items, review comments, and operator identities. One declared rule table derives the visible readiness verdict, reason list, risk rank, cleanup candidacy, and membership in the persisted My branches / Needs my review / Ready / CI failing / Cleanup views. PR status-check rollups take precedence over repo-wide workflow runs for that head. An absent GitHub refresh remains `unknown`/`not-assessed`; do not default it to empty arrays when adding a field. The browser owns only view/sort/direction/group/chip presentation preferences through `vscode.setState`; it cannot persist evidence or a readiness outcome. A failing check, blocked verdict, change request, merge conflict, or structurally broken branch receives the critical red card/tag treatment; pending and merely cautionary states remain warning amber.

Expensive branch evidence is on demand. The readiness chip is informational: only the explicit **Review details** action on an expanded card sends `inspectBranch`. `handleInspectBranch` re-resolves the opaque id, finds the workflow/default production baseline, reads the merge-base changed paths and a bounded contributor range, sends only changed-area/category aggregates to the webview, and uses `parseBranchCodeowners` plus `matchBranchCodeowners` for last-match-wins review routing. The result is rendered immediately below that branch card, never as a global result above the inventory; it remains absent until requested and has an explicit Close action. The changed-path list and CODEOWNERS text stay in the extension host. `handleCompareBranches` similarly accepts two opaque ids and returns unique commit counts, bounded path counts/overlap, areas, and contributor summaries; overlap is never called a conflict. `handleOpenBranchChangeStory` calls `reviewWorkspaceChangeStoryForRefs`, which validates the host-resolved head/base and reuses Lens without switching `HEAD`.

Cleanup is intentionally not a generic Git-delete bridge. A candidate card only opens `handleReviewBranchCleanup`: remote-backed work is fetched first, then the id is resolved again. Current/default/protected/other-worktree/open-PR branches are refused; both current and production commits must resolve; unique commits outside both must be zero. Local removal is `git branch -d -- <host ref>` only. Remote removal additionally requires loaded GitHub PR evidence, production containment, `ls-remote` returning the exact reviewed hash, a modal evidence review, and an exact branch-name entry before `git push --delete`. Never add `-D`, a force push, or a browser-supplied ref to this path. The source-level guards live in `tests/views/branchDashboardSafety.test.ts`; pure verdict and CODEOWNERS rules live in `tests/core/branchDashboard.test.ts`.

The Project Dashboard also includes **Issues** and **Pull Requests** pages (backed by `src/core/issueTracker.ts`, `src/core/pullRequestTracker.ts`, and the `gh` CLI). The dashboard's ready handshake starts one shared read of issues, PRs, CI, releases, labels, and milestones; revealing it again retries only after a five-minute freshness window, and the in-flight guard prevents a double-click or concurrent reveal from multiplying requests. The dashboard-wide Refresh button and either GitHub page explicitly refresh the same snapshot. Data remains absent until a read succeeds, so unavailable GitHub is never reported as zero issues or zero PRs, and both pages receive independent navigation badges once loaded. Issues shows open / unassigned / stale counts, label and assignee distributions, search/filter controls, and a **Tracking coverage** card combining open issues, commits since the latest tag, and open PRs without a linked issue. Pull Requests lists open and draft work directly. An unlinked PR can create a deterministic composer draft derived host-side from its current sanitized record and repository-known labels; opening/refreshing never writes, the browser supplies only the PR number, and posting still passes through the existing issue-write permission and modal confirmation. Per-issue **Work on it with Atlas**, **Comment**, **Close/Reopen**, and **Open on GitHub** retain the same guarded behavior. The Project Dashboard also includes a **Risk** page (backed by `src/core/riskOversightManager.ts` and `project_memory/operations/risk-oversight.json` + a `risk-oversight.md` mirror and `risk-oversight-history.json` audit trail) that runs the three read-only oversight advisors, records what they find, scores it into the operational health number, and charts it. Runs are explicit and user-triggered — per-domain or all three **sequentially**, never concurrently, since three parallel model calls is a surprising cost from one click — with live per-advisor progress via `riskBusy`/`riskStatus` messages. The advisor is *pinned* with `orchestrator.processTaskWithAgent` rather than routed, so the page always consults the advisor requested. Because the advisors are read-only, the panel owns the write path: it parses the model's JSON defensively (`parseRiskFindings` never throws), sanitises it (`sanitizeRiskFindings`, path-traversal rejected in cited evidence), and merges it without undoing human decisions. Charts are hand-rolled under the existing CSP (no external library): a likelihood × impact **risk matrix** heatmap in CSS grid whose cells filter the register, plus the shared `renderChartCard`/`renderScoreRing`/`renderMetricPill` primitives. Risk is **excluded from the score until a project has actually been assessed**, so an unassessed project reads as unknown rather than safe.

The Project Dashboard also includes a **Documents** page (backed by `src/core/documentsManager.ts` and `project_memory/operations/documents.json` + a `documents.md` mirror) for managing a project's `.md` files: operators define a *filing system* of folder "shelves" (optionally narrowed by a glob) and a set of documents to *keep updated automatically*. The page computes each tracked document's freshness (file mtime vs. a recorded `lastReviewed` baseline plus a weekly-cadence window), surfaces `missing`/`review-due`/`up-to-date` status, discovers uncovered markdown to file or track, and offers explicit **Update with Atlas** (an `openPrompt` chat handoff) and **Mark reviewed** actions. The Dashboard's **Testing** page additionally carries a **Policy coverage** board (`src/core/testingPolicyCoverage.ts`): for every enabled methodology it shows whether anything in the tree tests it (`covered` / `tooling-only` / `missing`, with practices reported as `not-file-evident` rather than as gaps), how many of its cases are skipped, and which of its tests are failing according to the newest JUnit report the project has written. `collectTestingDashboardSnapshot` gathers the evidence — dependency and script names, probed policy config paths, per-file case/skip counts, and a bounded report search (`findTestResultReport`) — and the pure module derives the board. Nothing runs a test command on render: with no report the page reports *no verdict* and quotes the framework-appropriate command to produce one. **Fix activated testing** is the deliberate execution counterpart: a no-payload webview message asks the host to rebuild that snapshot, show a modal scope disclosure, then call the normal Orchestrator. The prompt fences project-derived labels as reported data, permits only existing relevant test commands, and forbids false-green tactics (disabling/skipping/weakening tests, lowering thresholds) as well as dependency, manifest, runner-configuration, and external-network changes. Each tool action stays behind its ordinary approval gate. Every policy card on that board is **expandable** (`renderPolicyCardDetail` in `media/projectDashboard.js`): opening one reveals a case-mix distribution bar, an evidence table, and the failing cases with file links. `src/core/testingPolicyDetail.ts` grades each policy against a published rule table and derives the follow-up and issue drafts; the card carries the shared Director ownership picker via a `testing-policy` `DashboardWorkKind`, an **Add to follow-ups** action, a **File as issue…** action offered only for a `serious` finding and always behind the standard issue confirmation, and a per-policy **Scaffold framework** button shown only where `scaffoldableMethodologies` says a starter file would actually be created. The webview posts an opaque policy id and nothing else — every path, command and issue body is rebuilt host-side — which `tests/views/testingPolicyCardWiring.test.ts` pins.

Saving a shelf also **creates its folder** if it is missing (`newShelfPaths` + `createShelfFolders`), and shelves still pointing at an absent folder expose an explicit **Create folder** action — create-only: an existing directory is a no-op and a file at that path is reported, never replaced. It never rewrites documents on a timer (deny-by-default); every webview-supplied path is sanitised via `sanitizeDocumentsConfig`/`normalizeRelPath` (path-traversal, absolute paths, and drive letters rejected) before it touches disk, and a `documents.json` file watcher (`documentsRefresh`) keeps the page current on external edits.

**The automatic CI refresh cadence is a pop-out attached to refresh buttons.** It was `renderPipelineAutoRefresh()` — four segmented buttons and a note, rendered permanently into one card of the Pipeline page — which spent a row and a half on a setting most people choose once and could not be reached from the thirteen other pages that display what it refreshes. `renderRefreshAction` now takes `cadence: true` and returns a split button: the label refreshes once, and `renderRefreshCadenceToggle()` adds a caret that opens the menu. It is **opt-in per call site**, because two kinds of refresh control must not carry it — one that does something else (`branch-fetch` fetches remote refs, `branch-inspect` reads one branch's review) would offer a cadence governing neither, and a first-load or retry control ("Load issues", "Try again") would offer to schedule repeats of a read that has never once succeeded. Four things are load-bearing, and `tests/views/workflowSurface.test.ts` pins each. **One menu, shared**: `ciRefreshCadenceMenu` builds a single node on first use and appends it to `document.body`, following the same reasoning as the Lens panel's info popover — N menus is N chances for one to be left open behind a re-render, and each needs an id that survives renders it cannot see. Living outside `#dashboard-root` also means `render()` cannot destroy it mid-interaction, and it is what lets the header's caret and a card's caret share one implementation despite the header being outside the delegated click handler's reach. **The triggers carry no state**: `renderRefreshCadenceToggle()` emits a shell and `syncRefreshCadenceIndicators()` fills every `[data-refresh-cadence]` in the document from the one source after each render, so a card rendered a moment ago cannot disagree with the timer that is running. **A running cadence stays visible with the menu closed** — the caret carries the interval and an accent — because a setting that spends a rate limit must not become invisible just because its control folded away. And **choosing does not re-render**: nothing on any page states the cadence any more, so `chooseCiRefreshCadence` moves the timer and the triggers only, which is also what stops a full render tearing the menu down mid-interaction.

The poll gate changed with it. `syncCiRefreshCadence` keeps the two conditions that prevent genuinely wasted requests — the panel must be visible, and no fetch may already be in flight — and drops the third, which required the Pipeline page to be active. That rule defeated the cadence people most want (one minute, to watch a run you just started, which is exactly when you go and do something else) and, with the control now on every refresh button, would have been contradicted by the affordance on thirteen pages out of fourteen. Its *absence* is asserted, because re-adding it would look like a fix. The persisted key moved from `pipelineAutoRefresh` to `ciRefreshCadence` and is deliberately not migrated: a stored value whose meaning changed is better re-chosen than silently reinterpreted, and the direction it falls back in is Off. The timer is also started at script init, which it never was — the only callers were the click handler and the visibility listener, so reopening the panel with a cadence saved showed it as running and fetched nothing until the editor tab was switched away and back.

**The Project Dashboard header is one band, and it lives outside `#dashboard-root`.** It used to be four stacked blocks — a generic 44px "Project Dashboard" title, a three-line description of the tabs sitting directly beneath it, the version strip, and then a `.hero-grid` of two full-width cards, one repeating the project name at `h2` with three provenance pills and one carrying a 150px score ring. That is roughly 600px of chrome above the first real signal on a wide editor and past 900px on a narrow one, on a page whose entire purpose is the signals. The hero is gone; the same facts are stated in the topbar the panel already emitted. The **project's own name** is the `h1` (`.dashboard-project-name`, `clamp(26px, 3vw, 36px)`) rather than the third heading down, the line under it is the snapshot's `healthSummary` rather than a list of the tabs below it, `Generated / Branch / SSOT` is one muted `.dashboard-provenance` line rather than three pills, and the score is a `.dashboard-score-chip` beside **Refresh** that opens the Score page — where `renderScoreRing` now lives, on the page that is about the number. Four consequences matter when editing this, and `tests/views/dashboardHeader.test.ts` pins each: the header is written by `applyHeaderIdentity` into host markup rather than returned as HTML, because `render()` replaces `#dashboard-root` wholesale on every keystroke; it is filled **before** that swap, so a page renderer that throws cannot leave the title reading its fallback; `clearHeaderIdentity` drops every collection-derived value on a failed refresh (the summary as much as the score — both are readings) while keeping the project name, which identifies the workspace rather than measuring it; and the header chip deliberately does **not** use `renderScoreRing`, because `applyValueAnimations()` only scans inside `#dashboard-root` and a ring outside it would sit at its "from" value forever, drawing an empty circle beside a number that says 84. For the same reason the chip binds its own click handler — the delegated one is on the root.

The Project Dashboard **header** renders one version pill per delivery stage (`src/core/versionStrip.ts`, rendered by `renderVersionStrip`/`renderVersionPill` in `media/projectDashboard.js`), derived from the same `DashboardStageView`s the Delivery page renders rather than from a second collection pass — so a stage added on that page appears in the header without a second definition of what a stage is, and the two surfaces cannot report different versions. The module is pure and `vscode`-free, unit-tested in `tests/core/versionStrip.test.ts` with the wiring pinned by `tests/views/headerVersionStrip.test.ts`. Its rules are all about not claiming to know a version: a stage whose branch does not exist reports that rather than borrowing a plausible number (the pipeline's `—` placeholder is treated as unknown, never as a value); the working tree carries its own pill because it is the only reading taken from `package.json` on disk rather than from git, and therefore the only one that can be ahead of what is committed — it reads `working tree` and is marked when the tree is dirty; pills are ordered by stage rank with name breaking ties so they cannot shuffle between renders, capped with the remainder stated and routed to the Delivery page; and a project with no pipeline configured falls back to the original git-derived pair under `source: 'branches'`, so a heuristically detected production branch is not presented in the same shape as a declared stage. A pill also names the release channel its branch produces (`src/core/versioningPolicy.ts`), but only where the project declared one in its workflow file — an undeclared project shows no channels rather than a guessed `beta`.

The Dashboard's **Overview** page opens with a *Needs you* band (`src/core/attentionFeed.ts`, rendered by `renderAttentionBand` in `media/projectDashboard.js`) that gathers what needs a person from the pages that already know it — failing tests, a red pipeline, blocked memory writes, overdue follow-ups, release gates not passing, blocked promotion paths, high-severity debt, open risk findings, documents due review, stale issues — as clickable cards routed through the existing `data-action="page"` bridge. The module is pure and `vscode`-free; `buildAttentionInput` in `projectDashboardPanel.ts` maps the finished snapshot onto its eleven optional input groups, so the band reads exactly the fields the pages render and cannot disagree with them. Three properties are load-bearing and unit-tested (`tests/core/attentionFeed.test.ts`, `tests/views/overviewAttention.test.ts`): the band is **empty when nothing needs you** — it renders one muted line rather than a card frame, unlike the twelve-card shortcut grid it sits in place of; **unassessed is never reported as clear**, so an absent input group raises its own item rather than contributing nothing, and the empty state distinguishes `clear` from `unexamined`; and ranking is **by consequence rather than magnitude**, taken from the rule table's declaration order so it cannot shuffle between renders. The *What moved* strip beneath the cards reuses the Workflow page's observed delta and routes every chip there, because that page owns the only **Mark as seen** control and a delta must advance exactly once.

The Project Dashboard's **navigation and metric surface** are each defined in exactly one place. The tab order and grouping live in `PAGE_GROUPS` in `media/projectDashboard.js` — six labelled clusters (Where we stand · The work · The code · Is it safe · Ship & record · The engine) that follow the sentence a manager actually reads: where do we stand → what is the work and who is on it → is the code sound → is it safe → can we ship, and is the record straight. **Branches** is the first page under The code, before Repo, Pipeline, Testing, and Tech Debt; Ideation is a real page under Where we stand. The previous order was archaeological (it recorded the sequence features shipped) and disagreed with both the render dispatch order and `DASHBOARD_PAGE_IDS`. `tests/views/dashboardNav.test.ts` now reads the real `PAGE_GROUPS` definition out of the webview script and asserts that every nav page is a valid prompt `sourcePage`, has a matching `pageSectionOpen` panel, and appears exactly once — the two lists live in different files and different languages and have drifted before. `DASHBOARD_PAGE_IDS` remains the host validation list, so `normalizePageId` in the webview coerces any unrecognised `activePage` back to `overview` rather than leaving every section inactive and rendering a blank dashboard. Tabs carry **attention badges** computed by `computeNavBadges` from counts already present in the same snapshot on the same render pass (open gaps — red when any are P1, stale/drifted/activation-blocked branches, open risk findings, overdue follow-ups, documents due for review or missing, blocked memory entries, unhealthy providers, artifacts needing attention, pending file changes); the badge is a bare number visually, with its meaning carried in words on the tab's `aria-label`. The nav implements the full WAI-ARIA tabs pattern — `role="tab"`/`aria-selected`/`aria-controls` on the tabs and `role="tabpanel"`/`aria-labelledby` on the panels (both emitted through the single `pageSectionOpen` helper so tab and panel wiring cannot drift apart), roving `tabindex`, arrow keys with Home/End, and focus restoration across the re-render that destroys the focused tab. The toolbar is sticky, and holds the tabs alone: the 7D/30D/90D range picker used to share that row and the tabs’ pill shape and accent, so on a narrow panel it wrapped underneath and read as a sixth tab group. `renderChartRange` now places it directly above the charts it filters (on Overview, Repo, SSOT, Risk and Privacy — the only pages that read `state.timescale`), styled with the squared, joined `.segmented` treatment so it belongs to a different visual family from the nav. The Director page’s team-mode switch shares `.segmented` rather than re-using the nav pill styling as it previously did.

**The pull-request read is two queries, and the reason is cost.** `gh pr list --json …reviews,statusCheckRollup,reviewRequests` prices as limit × per-pull-request nested connections, and at `--limit 100` GitHub's GraphQL API returns `HTTP 502` — measured on this repository, where the same query succeeds at 50 and the lean field set succeeds at 100. So `refreshGitHubActivity` bounds the rich read to 30 and falls back to a lean read (no nested connections) at 100 if it fails, because a list without review state beats no list. **The failure is recorded rather than swallowed**: the previous `catch {}` left `pullRequestsState` as `undefined`, so the page said "Pull requests have not been loaded" indefinitely and a manual refresh repeated the failure with nothing shown. `pullRequestsNotice` carries the reason to the page. A failed refresh still never empties an existing list — "we could not look" must not become a confident "none".

**CI runs a secret scan as its own job.** `.github/workflows/ci.yml` has a `secret-scan` job alongside the three-OS `quality` matrix, checking out the full history — a credential that was committed and later removed is still a credential that leaked, and a shallow clone cannot see it. It is deliberately not a matrix step: a secret is a secret on every platform, and three identical scans would treble the cost of the job most likely to be the reason somebody rotates a key today. `.gitleaks.toml` allowlists the files that hold *synthetic* secrets so the redaction boundary can be tested against real shapes — by **path, never by pattern**, because allowlisting a pattern switches that shape off everywhere including where it matters, while allowlisting a file says "this one is understood" and forces a new file to be added deliberately. The scan feeds ISO A.8.24 / SOC 2 CC6.7 / NIST SC-28 through `complianceTechnicalControls`.

**Dashboard grids reflow on a stated minimum rather than a fixed column count.** Every grid used to be `repeat(N, minmax(0, 1fr))` — six stat cards, three charts, two panels — which fails at both ends: in a narrow editor six columns squeeze below readability, and on an ultrawide two columns stretch a 13px paragraph across 900px, which is what made these pages read as badly proportioned. `dashboardTheme.ts` now declares the measures (`--dash-content-max`, `--dash-col-stat`, `--dash-col-chart`, `--dash-col-panel`, `--dash-measure`) and each grid is `repeat(auto-fit, minmax(min(100%, var(--dash-col-…)), 1fr))`, so the column count follows the space. Three consequences worth knowing when editing this CSS. `.dashboard-shell` is capped and centred, which fixes most "why is this so wide" cases in one place instead of adding a max-width to forty cards. **Prose is capped, panels are not** — a full-width card is often right because a table or chart wants the room, and it is the sentence above it that needs the measure; the cap is lifted again inside grid cells, where the column already provides one. And the old `max-width: 1280px` breakpoints that pinned `.stats-grid` to three columns and collapsed the panel grids to one were **removed rather than adjusted**: they actively undid the reflow at an entirely ordinary editor width. Only genuinely asymmetric layouts (`.ideation-shell`, `.score-summary-grid`) still need a breakpoint, because repeating-track reflow cannot express a deliberate 0.95/1.05 split — `.hero-grid` was the third until the dashboard header absorbed it. `tests/views/testingStatistics.test.ts` pins the tokens, the `auto-fit` rules and the policy-grid minimum at source level.

**Dashboard animation is driven from script, not from CSS.** `render()` replaces `#dashboard-root`'s innerHTML wholesale, so every node is freshly parsed with exactly one computed style and a CSS `transition` between two values can never interpolate — the score ring's `stroke-dashoffset`, the metric meters' width and the MVP progress bar all declared transitions that had never once played, painting straight at their final value. Conversely `@keyframes` *do* restart on every insert, so the Overview chart re-grew up to 90 bars whenever any unrelated part of the dashboard re-rendered, including on every keystroke in the Testing search box. `applyValueAnimations()` resolves both: animatable elements declare a stable `data-anim-key` and a target `data-anim-to`, the module remembers the last value painted per key, and on the next frame only the values that actually changed move. Elements inside a hidden `.page-section` are deliberately not recorded, so their meters animate the first time the manager opens that tab. `prefers-reduced-motion` is honoured in both the stylesheet and the script, so reduced-motion users never pay the class churn either. The shared visual primitives now include `renderDistributionBar` (a segmented proportion bar plus legend — used for TDD subtask evidence, the test pyramid, gap severity mix, roadmap focus mix, document freshness, artifact coverage by lifecycle phase, assignment status and follow-up urgency) alongside the existing `renderChartCard`, `renderScoreRing`, `renderMetricPill`, `renderFlowStrip` and `renderRiskMatrix`. Chart cards headline their period total and the delta against the preceding equal-length window and draw a mean line, so a bar chart conveys direction and not only shape. Overview additionally carries a **work mix** row driven by `renderDonutChart` — SVG arcs rather than a chart library or a canvas, so rings inherit theme colours, stay crisp at any zoom, and carry a `<title>` per slice: *commits by contributor*, *route to the selected release gate*, and *outstanding objectives by gate* (a distribution bar, since an item can sit on more than one gate). Contributor data comes from a single `git log --pretty=%ad|%an` over the same window as the timeline — author **names** only, never addresses — reduced by the pure, exported `buildContributorSeries`, which ranks by commit count, breaks ties by name so slice colours are stable between renders, and merges the long tail into one **Others (n)** entry that keeps its commits rather than dropping contributors from the total. Clicking a contributor (in the ring legend or the segmented filter) scopes the commit timeline to that person and toggles off on a second click; the run and memory timelines are deliberately *not* filtered, because they are not per-person data. The contributor filter is rendered only when the window has more than one author.

Overview closes with `renderOverviewNextActions`, which surfaces the top three short-horizon entries from `score.recommendations`. It replaced a `quickActions` grid of twelve shortcut cards whose destinations were all reachable elsewhere on the page, and whose kicker was taken from an inert `pageTarget` field — a card with a `command` never navigated to its `pageTarget`, so the label named a page the card did not open. `resolveRecommendationAction` now derives both the dispatched action and a human-readable destination (“Ask Atlas”, “Opens Run Center”, “Opens SECURITY.md”) from the same field, so the two cannot disagree. `DashboardSnapshot.quickActions` and `renderActionCard` no longer exist.

**Affordance discipline is enforced by class, not by convention.** `.recent-item` and `.action-card` render as both real buttons and inert `<div>`s, so `cursor: pointer` is scoped to `button.x, .x.is-actionable` only. A later blanket rule used to override that scoping and hand a hand-cursor to every one of them, which is what made roughly fifteen dead cards across Repo, Roadmap, Testing, Gap Analysis and Documents look clickable; an explicit reset now keeps a static variant inert even inside a pointer-cursor container. Actionable cards additionally carry an at-rest chevron so a live row reads as live *before* hover, rather than only after the user commits to a click. Every `data-action` emitted in markup must have a matching branch in the delegated handler — two that did not (`openRun` and `openCommand`, message *type* names mistaken for action names) were buttons that did nothing at all.

**Panel section ordering.** `costDashboardPanel.ts` promotes `buildBudgetBar` out of the Daily Spend card into a full-width `.budget-strip` under the topbar (tone-tinted via `:has(.budget-track-fill.warn|.over)`), moves `buildCurrentLoops` beneath it, groups `buildSummaryCards` output into labelled Spend/Efficiency/Volume clusters, and drops the Today’s-Spend and Daily-Limit cards when a budget exists because the strip already carries them. Note the deliberate asymmetry in the chart controls: the line/bar switch is gated on `hasDailySpend`, but the timescale strip is not — `filteredRecords` is produced by `buildCostQuery(this.timescale, …)`, so hiding the timescale control on an empty window would leave no way to widen it. Five panels were reordered so their sections follow use rather than shipping history, each pinned by `tests/views/panelInformationArchitecture.test.ts`. `SETTINGS_PAGE_IDS` (`settingsPanel.ts`) is the canonical settings order and the nav is asserted to match it — the two hand-maintained lists had already drifted. `PROFILE_SECTIONS` (`personalityProfilePanel.ts`) was reordered by moving whole entries verbatim and verified as a pure permutation. `mcpPanel.ts` defaults to the `servers` page and its Overview lost a summary grid that duplicated the hero badges. `specialistIntegrationsPanel.ts` collapsed three card sections into one filtered page — the previous “All Integrations” was a concatenation of the other two, so each card was rendered twice — with a `data-surface` attribute on each card driving a segmented filter. `websiteStudioPanel.ts` swapped its numbered steps 3 and 4 so the shared UI system precedes the per-page UI-design stage that consumes it.

**Panel tab navigation is shared where pages remain.** Voice, Vision, Specialist Integrations, Tool Webhooks, Model Providers, and MCP once carried their own copy of the same vertical nav, and each copy had the same gap: a container declaring `role="tablist"` whose children were plain buttons, with no `role="tab"`, no `aria-selected`, no `aria-controls`, no `role="tabpanel"` on the sections, no roving `tabindex` and no keyboard handling at all. A screen reader was promised a tab list and found unrelated buttons, and reaching the last tab took one Tab press per tab. `src/views/panelNav.ts` exports `PANEL_NAV_JS`, a client-side controller injected into those page-based panels. Agent Manager no longer needs a tablist: its former Overview / Directory / Editor hierarchy was replaced by one searchable master/detail workspace.

It *upgrades* the existing markup rather than replacing it. The remaining page-based panels already agree on the same conventions — a nav container with `role="tablist"`, `<button data-page-target="X">` per tab, `<section id="page-X" class="panel-page">` per panel, and a local `activatePage(pageId)` — so `createPanelNav()` adds the missing ARIA at runtime and takes over activation and keyboard handling, while each panel keeps its own markup, classes and styling untouched. A panel swaps its bespoke `activatePage` body for `panelNav.activate(pageId)` and passes any extra work (webview state persistence in Specialist Integrations and Model Providers) through `onActivate`. Arrow keys honour the declared `aria-orientation`, Home/End jump to the ends, and tabs hidden by a panel's search filter are skipped rather than being focusable while invisible. `activate()` ignores an unknown page id — several panels activate from a persisted state value that may name a page which no longer exists — and validates against the rendered panels as well as the tabs, so "go to page X" controls outside the nav (hero badges, `data-nav-target` links) keep working.

**ACP plan labels are deliberately not a billing integration.** The Model Providers panel reads the current `atlasmind.acp.agents` setting when the Configure Agent Plan action opens, so Gemini and custom ACP clients appear from configuration rather than a vendor-plan table. It stores only the label the operator enters in extension global state; ACP has no standard plan/balance field, so this UI never asks for, estimates, or decrements credits. Keep Copilot's observable-credit UI separate from this path.

**The Settings panel is deliberately exempt.** It is the one panel that already implemented the pattern properly, and it does so on top of a progressive-enhancement fallback (`fallback-visible` / `settings-pages-ready`) that keeps every section reachable as a plain in-page anchor if the script never boots. Adopting the shared controller there would trade a working, more capable implementation for uniformity. `tests/views/panelNav.test.ts` asserts that every other tablist-bearing panel uses `createPanelNav`, that none of them still hand-rolls an `activatePage` body, and that Settings retains its own `role="tab"` / `aria-selected` / `role="tabpanel"` / keyboard wiring.

The Project Ideation panel (`src/views/projectIdeationPanel.ts`) now combines deterministic prompt scaffolding with model-led facilitation. Before Atlas answers, the extension infers likely board facets from the operator prompt, such as external references, current-system context, code considerations, workflow implications, and team or process concerns, then feeds that scaffold into the ideation prompt and shows the same inference live in the composer. The facilitation response contract also supports card updates, explicit connection suggestions, and stale-card archiving so repeated prompts can reshape an existing whiteboard instead of only appending descendant cards. Prompt-inference scaffold cards now receive stronger default linking when they are inserted into the canvas, including starter-card relationships on a fresh board, and the feedback surface now derives follow-up prompts and Next Card suggestions dynamically from the latest facilitation output and current board gaps. Atlas-generated cards are now also placed through a layered graph-aware placement pass so the default board communicates a more readable flow from inputs and framing into decisions, constraints, actions, risks, and synthesized outputs, and relation defaults now carry direction-aware styles instead of collapsing into generic joins. The panel now also includes a staged workflow guide plus hover and focus tooltips across the major sections and actions so new users can understand what ideation is for, where they are in the process, and what each control changes. The canvas now tracks the last two clicked cards as an ordered source-to-target pair, uses bottom-edge status markers instead of full-corner indicators, and exposes direct keyboard shortcuts for linking and relation types so operators can manipulate the whiteboard without relying on a temporary link mode. The board is now treated as the primary full-width surface in the normal layout, can expand into a true viewport-filling canvas mode, and the composer CTA now explicitly reads as creating or evolving the ideation board with a Ctrl/Cmd+Enter shortcut. Its relationship links now render with relation-specific colours, markers, and path shapes so support, dependency, contradiction, opportunity, and causal flows are distinguishable at a glance, and the canvas now offers a toggle between angular and spline routing plus visible flow lanes when dense boards need more readable hierarchy. Operators can now also switch the canvas into multiple workflow review views, temporarily re-layout cards for focused reading, filter by relation family, and rely on adjacency-based fading plus an inline legend to understand which cards and links actually matter to the current selection. Relationship endpoints now terminate at the visible card boundary using each card's actual rendered footprint at the current detail level rather than a coarse approximation, the routing pass now scores nearby card bounds to repel links away from occupied card space where possible, link labels now render as collision-aware badges instead of bare midpoint text, the board world itself now allows substantially more travel in every direction, spline mode now renders a single smooth curve per relationship instead of multi-join bends, and a plain left-click on empty canvas space now clears the current selection without breaking drag-to-pan or reintroducing selection-driven desaturation. Ideation facilitation is also now explicitly treated as research and planning work rather than implementation work, so coding-specific TDD gate safeguards and red-to-green status cues do not block or pollute prompt-driven board creation. Atlas Feedback now waits for the finalized facilitation payload and strips tool-loop chatter or synthetic failure banners before rendering user-facing copy, so the webview stays facilitator-oriented even when orchestration internals get noisy. Its analytics surface now also turns non-green findings into expandable actions that can insert linked experiment, evidence, risk, or checkpoint cards directly into the canvas. Focused cards can also be sent straight into Project Run Center as seeded run previews, and later Project Run learnings can be re-imported into the same ideation board or branched into a fresh ideation thread. Ideation persistence now supports multiple named workspaces under `project_memory/ideas/`, with `atlas-ideation-workspaces.json` tracking the active board and each workspace keeping its own JSON and markdown artifacts so divergent explorations can be switched or deleted without overwriting the main thread.

The Settings panel (`src/views/settingsPanel.ts`) now includes validated controls for `/project` execution behavior in addition to budget/speed modes. Numeric fields are constrained to positive integers, report-folder input is required to be non-empty before persisting, the Budget and Speed choice pills expose per-option hover and focus tooltips so operators can understand the routing tradeoff attached to each mode before changing it, and **Agents** is a first-class Capabilities page with live counts and a validated command bridge into the dedicated Agent Manager; the Settings overview exposes the same destination. The Models & Integrations page manages local OpenAI-compatible routing through a dynamic labeled endpoint list with add/remove controls instead of a single always-visible endpoint field. Project-specific test discovery remains available through deep links for compatibility, but the primary testing workflow now lives in the Project Dashboard so operators review coverage, verification posture, and individual test cases in the same project-health surface as runtime and delivery signals. MCP onboarding is now routed into the dedicated MCP Add Server workspace rather than pretending to install directly inside Settings, which keeps the curated recommended starters and the manual endpoint form in one place, surfaces stage-aware connection feedback, labels each preset as Official, Community, Registry fallback, or Archived reference so operators can judge how strongly AtlasMind verified the upstream setup path, distinguishes AtlasMind-ready presets from manual-setup-only ones using an audited connection map, and blocks docs-only submissions until the operator enters a real command or URL. AtlasMind-ready CLI presets can now also be installed and connected directly from the Settings starter card in one click, and on supported systems that same flow can bootstrap missing runtimes through winget, Homebrew, or common Linux package managers before AtlasMind retries the first connection. The Guided Setup wizard no longer dead-ends on manual-setup starters: when a chosen server has no command/endpoint AtlasMind can auto-fill (and no fields to complete), the wizard now says so and swaps the Connect button for **Open Advanced setup** (carrying the starter across) instead of failing with a misleading "complete every required field" message; when a required field genuinely is blank, the error names the specific field(s). Building on that, the entire recommended catalogue is now guided rather than manual: `getRecommendedMcpStarterDetails` carries a verified command plus `prerequisites`, `credentialSteps`, `credentialHelpUrl`, `safetyNote`, and per-input `example` placeholders (all researched and supply-chain-verified in two batches — the 13 platform servers, then the 21 cloud/data/devops/comms/payments servers), and the wizard's configure step renders a "What you'll need" checklist, a numbered credential how-to, an "Open credentials page" button, a docs link, and an amber safety callout. Only first-party/reputable packages are prefilled; a handful stay opt-in guided-manual (community/low-adoption: Twitch, LinkedIn, OpenAI web-search, Bark/APNs), and servers that require a credential on the command line (Twilio, Jenkins) route to Advanced with full guidance rather than auto-storing a secret in config — enforced by a test asserting no recommended input carries a secret as a CLI argument. Remote OAuth services (Cloudflare ×2, Atlassian Jira, Trello) are wired through a version-pinned `mcp-remote` stdio bridge so the url-only http transport's lack of auth-header support is never hit. `openWizardConfigure` now treats any starter with an endpoint as connectable (guided-manual community servers connect with an "Add & connect" affordance and a review banner; only a truly endpoint-less custom entry falls back to Advanced), and the Advanced form itself gained inline help + examples on every field. The Advanced page also carries a "Detected on this machine" scan panel backed by `src/mcp/mcpEnvironmentScanner.ts`: it imports MCP servers already configured in Claude Desktop, Cursor, VS Code, Windsurf, or a repo `.mcp.json` (offering per-server **Prefill form** / **Import & connect**), reports which launch runtimes are on PATH, surfaces workspace env-variable names as click-to-add chips, and offers an "Ask Atlas to help" chat handoff for unknown servers. The scan is cached in SSOT (`project_memory/operations/mcp-environment.json` + a markdown mirror), reused on future installs, refreshed by a workspace-config file watcher, and re-runnable via a Rescan button. It is redaction-safe: only env-variable names are cached or sent to the webview; on import, `resolveImportedServer` re-reads secret values live from the source file and routes them to SecretStorage. The Configured Servers page also supports reopening a saved MCP entry in edit mode so operators can correct URLs, commands, arguments, environment JSON, and enablement without deleting and re-adding the connection. Legacy broken preset commands restored from storage are also repaired or safely disabled before AtlasMind tries to reconnect them, and workspace-aware placeholders such as `${workspaceFolder}` are resolved before AtlasMind launches a saved MCP transport. When an older workspace still only has the legacy single local endpoint setting, opening the panel auto-migrates that explicit value into the structured endpoint list so the new UI stays in sync. Navigation setup is also intentionally isolated from the rest of the settings control wiring now, the left-side menu uses progressive enhancement so section links still work as ordinary in-page anchors if a later widget failure stops the richer single-page behavior, the CSS fallback keeps only one settings section visible at a time even before the script boots, explicit panel targets now render server-side so commands that reopen Settings at a specific page or card do not depend on a healthy prior webview instance, and the runtime nav logic now binds each section link directly while syncing the active section through the page hash so remembered webview state cannot override an explicit deep link.

The Models sidebar and Settings page share `src/views/modelSidebarVisibility.ts` for reversible display preferences. Hide actions persist sanitized provider/model/subscription-route identities in user `globalState`, and tree refreshes filter those identities without touching provider or model enablement. Settings renders host-derived labels with one Restore button per entry. Its inbound message is bounded and can remove only an exact key already present in host storage; keep future visibility controls on this narrow path rather than reusing model-configuration messages. The tree must retain its Settings-linked placeholder when all applicable rows are hidden, because an unexplained empty inventory is indistinguishable from a broken provider refresh.

The Personality Profile panel (`src/views/personalityProfilePanel.ts`) is a guided questionnaire webview that combines editable role, tone, memory, and boundary prompts with live AtlasMind configuration values such as budget mode, speed mode, approval mode, and chat carry-forward limits. Each prompt now keeps a freeform text area as the source of truth while also exposing quick-fill presets so operators can seed a response without losing the ability to write custom guidance. It persists the profile in workspace state and, when SSOT is available, mirrors the result into `project_memory/agents/` plus a synced summary block in `project_soul.md`. The extension runtime now reads both the saved workspace-state profile and a compact summary of `project_soul.md`, then injects that combined workspace identity into Atlas task prompt assembly so the operator profile and project identity influence every request instead of staying passive documentation, and the panel can open the generated markdown artifacts directly for manual editing.

The Tool Webhooks panel (`src/views/toolWebhookPanel.ts`) provides webhook enablement, endpoint URL, event selection, timeout control, bearer token management, test delivery, and recent delivery history.

Across AtlasMind's newer multi-page webview panels, top-right hero summary chips follow a consistent interaction rule: if a chip maps to a real section or filtered catalog, it is rendered as a button; if it is purely explanatory, it exposes a hover/focus tooltip instead of pretending to navigate.

The Manage Agents webview is a two-column master/detail workspace: search, enabled/custom/built-in filters, and the selected definition stay visible together; list state is stored with the webview API across host-side re-renders. The former Overview / Directory / Editor tabs and empty-editor destination are gone. The sidebar exposes the global Agent Auto-Update cadence exactly once under **Defaults & automation**. Its message, all agent action payloads, and custom rubric fields are validated in the extension host before configuration or registry mutation. Built-ins render their exclusion checked and disabled and their factory completion criteria read-only; custom agents can supply at most 12 bounded rubric rows and 12 incomplete-result patterns.

Built-in skills now include a git-backed patch application helper (`src/skills/gitApplyPatch.ts`) that validates or applies unified diffs through `git apply` from the shared `SkillExecutionContext`.

The local git lifecycle is covered end to end by dedicated skill files rather than terminal passthrough: `src/skills/gitWorktree.ts` (list/remove/prune, removal restricted to worktrees `git worktree list` itself names), `src/skills/gitSync.ts` (`git-fetch` and `git-pull`, fast-forward-only by default), `src/skills/gitStash.ts` (entries addressed by validated integer index), and `src/skills/gitMerge.ts` (merge/abort with conflict-file reporting). All of them execute through `context.runCommand('git', args)` with no shell, and every remote, branch, and ref argument is rejected when flag-shaped (`isSafeGitRefArgument` in `gitSync.ts`), so a name can never be parsed as a git option.

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

Platform prefabs use the same create-only rule. `buildBootstrapTemplateFiles()` is a pure plan boundary:
it returns bounded workspace/SSOT-relative paths and content before the bootstrapper writes anything.
The WooCommerce Extension plan normalizes the display name, slug, namespace, and paths separately;
creates a minimal PHP plugin, compatibility/privacy records, and syntax/contract CI; and records the
official environment commands without executing them. Tests inspect the whole plan, including hostile
project-name input, without requiring WordPress, Docker, Composer, or a network connection.

The other commerce plans exercise two additional contracts. Magento is safe to build locally because its
minimum component surface is stable and small: one Composer package, `registration.php`, and
`etc/module.xml`. Tests assert the three identifiers agree, an all-numeric leading name becomes a valid
letter-prefixed PHP identifier, the module stays inert, and CI performs only metadata, syntax, and
scaffold-contract checks. BigCommerce Catalyst and Wix Commerce instead produce documentation-only
workspace plans plus SSOT guidance. Tests assert they contain no guessed executable source, retain literal
command placeholders, disclose remote provisioning, and never imply that an unrun generator succeeded.

The SaaS/Web plans add a second exhaustive family over the same pure boundary. Next.js, React Router,
Laravel, Django, and Astro Content plans must contain workspace Markdown plus SSOT guidance only; tests
walk every plan, assert unique bounded paths, locate the literal-placeholder command block, and prove that
hostile project text never reaches it. Each records the generator and dependency/database side effects it
does not perform. Static Website is intentionally different: tests parse its generated JavaScript contract,
escape hostile HTML names, reject inline script/style, and pin semantic/CSP/accessibility assertions plus a
least-privilege workflow using only Node’s built-in test runner. Adding a future generator requires the same
choice: either demonstrate that a small stable native contract can be owned and tested, or ship a truthful
handoff—never a partial copy of upstream source.

Frontend bootstrap has its own executable specification in
`tests/features/frontend-bootstrap.feature`. Its Vitest bridge exhaustively walks Next.js, SvelteKit,
Nuxt, React/Vite, and Vue plans; asserts bounded unique documentation-only paths, literal placeholders,
escaped hostile names, and Not-assessed review records; and pins the current Svelte, React, and Vue
ownership decisions. Framework-catalog tests separately reject create-svelte, verify Next.js install/Git
separation and Nuxt's no-install/no-modules flags, and require React/Vue to degrade to documented manual
setup rather than running an invented command.

Mobile bootstrap is specified in `tests/features/mobile-bootstrap.feature`. The Vitest bridge walks
React Native, Expo, and Flutter plans; proves every workspace output is documentation-only and every
command uses literal placeholders; escapes hostile project text; and requires Not-assessed privacy and
compatibility records. Focused scenarios pin React Native's framework-first boundary, Expo's no-install/
no-agent-instruction flags plus deferred native generation and EAS, and Flutter's package-name and
dependency-retrieval disclosures. Additions must preserve that non-execution contract and extend the
shared permission, device, accessibility, signing, store, update, migration, and rollback matrices.

Game integration fixtures live under `tests/fixtures/game-engines/`. They are deliberately minimal
identity evidence, not runnable projects: Unreal supplies a `.uproject` plus corroborating config, Unity
supplies `ProjectVersion.txt`, Godot 3 and 4 preserve their distinguishing feature boundary, and the
composite fixture declares three VS Code roots with one inert Perforce content component. Keep the
fixture contract in `tests/core/gameEngineFixtures.test.ts` aligned with the normative game/composition
specifications; never add credentials, console SDK paths, engine binary paths, a live depot, or derived
topology to these fixtures.

`projectComposition.ts` is the structural trust boundary for the optional composition held in
`workflow.json`. Add new roles or VCS values only with a specification change and tests. Do not repair a
partly invalid declaration by dropping entries, persist topology, or make a detected proposal effective.
`workspaceScope.ts` accepts host-provided opened-folder descriptors and remains `vscode`-free; its omitted
target must keep returning only the first folder. Migrate consumers explicitly and in consequence order,
with tests that assert scope labels and unknown roots before replacing a direct `workspaceFolders[0]` read.

The Shopify bootstrap composition test is the non-game conformance case. Keep the theme/app/extension
picker multi-select and test both the pure canonical mapping and the VS Code-backed JSON/Markdown write.
The bootstrap adapter must call the shared workflow document interpreter before writing: existing
composition and newer/invalid/unreadable files stay untouched. This path declares boundaries only; adding
source generation or a platform command would cross the bootstrapper's existing no-execution boundary.

The Project Dashboard now performs that opt-in migration for Git status, local CI, issue visibility, debt
scans, and observed deltas. Keep detailed legacy repository/GitHub data tied to the declared home component,
and add a typed component inventory beside it. A missing or non-Git component must remain `not-visible` with
a reason; do not coerce it to an empty result, omit it from coverage, or compare an observed snapshot whose
component scope changed. Debt scans must retain component ids on candidates and scanned paths so one
repository cannot obsolete another repository's evidence at the same relative path.

## Versioning Workflow

1. Make changes and choose the correct SemVer bump for the same commit.
2. Update `version` in `package.json` in that commit.
3. Add a matching `CHANGELOG.md` entry in that same commit.
4. Every commit (not just PRs) must include a version bump and changelog entry. This applies to all code, doc, and config changes. The version bump and changelog update must be in the same commit as the change.
5. Use a conventional commit message and push.

## Testing

- Test runner: Vitest 4. Every run writes `test-results/junit.xml` (gitignored); see **Test** above for why that is config rather than a script.
- Test files must live under `tests/` and end in `.test.ts` — anything else is silently not run.
- Baseline unit tests currently cover core services (`ModelRouter`, `CostTracker`).
- Coverage reports are generated via `npm run test:coverage`.
- Mutation testing is available through `npm run test:mutation`; the committed Stryker configuration starts with the safety-critical criticality, tool-policy, and agent-registry modules. It is deliberately a separate, slower check rather than part of the normal test command.
- Stryker runs the suite through **`vitest.stryker.config.ts`**, not the ordinary config. It excludes exactly one test and suppresses the JUnit reporter, both for reasons that are easy to rediscover the hard way. Stryker copies the project into a sandbox, which is fine for the `fs`-only managers here — the copied tree is a perfectly good tree — but wrong for a test whose *subject* is this repository: `tests/baselines/testTypecheck.test.ts` is a ratchet over the working tree, it counts zero inside the sandbox, concludes 244 errors were fixed, and fails. Stryker will not mutate an already-red suite, and is right not to — a mutant "killed" by a test that was failing anyway is not evidence of anything. The exclusion is one file rather than a list of the fifty tests that read repository paths, because almost all of those work fine and a broad list would quietly narrow what mutation testing covers. The reporter override matters just as much: a mutation run executes the suite hundreds of times against deliberately broken code, and letting it write `test-results/junit.xml` would leave the Testing dashboard reporting Stryker's induced failures as the project's own.
- Static mutants are excluded by `ignoreStatic`. Stryker measured 29 of them as only 4% of the
  configured mutants but projected them to consume 96% of an hour-long run because each requires the
  whole 7,659-test process to reload. The bounded gate still exercises every non-static mutation in the
  three declared policy modules; a separate unbounded static run can be invoked deliberately when its
  cost is justified.
- Stryker's `typed-rest-client@2.3.1` pins `qs@6.15.1` exactly even though `6.15.2` contains the CVE-2026-8723 fix. The root manifest therefore overrides `qs` to `6.15.2` across the dependency tree; every other consumer already resolves to or accepts that patch. Keep the override until upstream removes the vulnerable exact pin, and verify both `npm ls qs --all` and production/full `npm audit` before deleting it.
- CI runs compile, lint, test, and coverage on push and pull requests to **`main` and `develop`**, and on manual `workflow_dispatch`.

## Security Reporting

- Security disclosures should follow [SECURITY.md](../SECURITY.md).
- Do not report vulnerabilities through public GitHub issues.

## GitHub Governance

The workflow itself is specified in **[The Guided GitHub Workflow](guided-github-workflow.md)**;
this repository's instantiation of it — branches, labels, required checks, secrets — is in
[github-workflow.md](github-workflow.md). Those two are authoritative. What follows names values
only.

- Feature branches are created from **`develop`**, and pull requests target **`develop`**. `develop` → `main` is the release promotion, not a feature PR.
- This repository runs the **`solo` profile**, so `main` requires a pull request and passing checks but **zero approving reviews**. Requiring self-approval trains a maintainer to dismiss a gate; CI is the reviewer instead, which is why its checks are genuinely required.
- Follow `.github/pull_request_template.md` for release and quality checklists.
- Use `.github/ISSUE_TEMPLATE/` for bug and feature intake.
- Keep ownership mappings updated in `.github/CODEOWNERS`.
- Branch protection values for `main` and `develop` are listed in [github-workflow.md](github-workflow.md).

## Packaging

```bash
npm run package    # Produces a .vsix file
npm run package:vsix    # Packages with the checked-in @vscode/vsce dependency
npm run publish:release    # Publishes the current build (does not tag)
npm run tag:release    # Re-run the git tag step on its own if it failed after publish
```

`publish:release` runs `vsce publish` and nothing else, authenticating with whatever credential `vsce login` stored in the OS keychain — it is the emergency path for publishing from a developer machine. **CI uses `publish:release:ci` instead** (`vsce publish --azure-credential`), which authenticates as the managed identity `vscode-marketplace-publisher` through workload identity federation; there is no Marketplace secret in the repository. The two are kept separate because adding `--azure-credential` to the local script would break publishing from a machine that has no Azure sign-in. Tagging is `npm run tag:release`, which creates and pushes a `v<version>` annotated git tag (`.github/scripts/tag-release.mjs`, cross-platform and idempotent — it skips if the tag already exists). The two are deliberately **not** chained: the tag push triggers `publish.yml`, so chaining them made one release attempt two publishes, the second failing on "version already exists". Normal flow is `tag:release` locally, then CI publishes from the tag.

The checked-in `.gitignore` keeps the local `project_memory_old/` backup outside source control, and `.vscodeignore` is the packaging boundary for local and release VSIX files. It intentionally excludes workspace-only content such as all `project_memory*` directories (including local archive or backup variants), a top-level local/generated `website/` tree, `wiki/`, local `.vsix` outputs, Vitest JSON report artifacts, Stryker's `.stryker-tmp/` sandbox, separate test/e2e/performance trees, assistant instruction folders, and extra dependency test or docs folders so the packaged extension stays closer to runtime-only contents. `tests/packageManifest.test.ts` pins the generated directory exclusions. Review the `vsce package` file listing before publishing; workspace memory or a project website in that listing is a release blocker.

Requires `vsce` to be installed globally or as a dev dependency:
```bash
npm install -g @vscode/vsce
```

AtlasMind is still branded as Beta until `1.0.0`, but Marketplace publication now
uses the standard release channel.
The manifest is marked with `"preview": false`, `npm run publish:release`
publishes the default stable listing, and `npm run publish:pre-release` remains
available only if you intentionally need a prerelease build later.

## Ideation dashboard implementation

**Project Dashboard → Where we stand → Ideation** is a stage-0 overview, not a second canvas. Its
snapshot combines the active ideation board, the current roadmap, and five existing evidence
owners: Gap Analysis, Security Review, Risk Oversight, Tech Debt, and Testing Coverage. Refreshing
the tab does not run a scanner or model call.

The webview's `addIdeationEvidence` message carries only a strict opaque id. The dashboard host
rebuilds the snapshot and resolves the id again before it opens `ProjectIdeationPanel` with a
bounded seed. The canvas is still the sole board writer; it creates an unconnected `evidence` card
so the bridge cannot discard fields the dashboard does not own or invent what the evidence supports.
`tests/views/dashboardNav.test.ts` pins the tab/panel rendering contract and
`tests/views/webviewMessages.test.ts` pins both message validators.

## Project Dashboard DOM security boundary

The Project Dashboard treats its rendered DOM as an untrusted boundary: user-authored Director values
are applied after static markup through `textContent`, and delivery-stage editor fields are assigned by
an explicit allowlist rather than a recursive dotted-property setter. Keep both constraints when adding
dashboard fields; webview CSP does not make unsafe HTML or prototype writes safe.
