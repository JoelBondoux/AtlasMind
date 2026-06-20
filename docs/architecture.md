# Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  VS Code                                                        │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐  │
│  │ @atlas Chat   │   │ Sidebar      │   │ Webview Panels     │  │
│  │ Participant   │   │ Tree Views   │   │ (Settings,         │  │
│  │               │   │ (Agents,     │   │  Model Providers,  │  │
│  │               │   │  Skills,     │   │  Tool Webhooks)    │  │
│  │ /bootstrap    │   │  Skills,     │   │                    │  │
│  │ /agents       │   │  Memory,     │   │                    │  │
│  │ /skills       │   │  Models)     │   │                    │  │
│  │ /memory       │   │              │   │                    │  │
│  │ /cost         │   │              │   │  Voice, Vision)    │  │
│  └──────┬───────┘   └──────┬───────┘   └────────┬───────────┘  │
│         │                  │                     │              │
│  ───────┴──────────────────┴─────────────────────┘              │
│                            │                                    │
│                   ┌────────▼────────┐                           │
│                   │  Orchestrator   │                           │
│                   │                 │                           │
│                   │  • selectAgent  │                           │
│                   │  • gatherMemory │                           │
│                   │  • pickModel    │                           │
│                   │  • execute      │                           │
│                   │  • recordCost   │                           │
│                   └──┬────┬────┬───┘                           │
│                      │    │    │                                │
│         ┌────────────┘    │    └────────────┐                   │
│         ▼                 ▼                 ▼                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐           │
│  │ Agent       │  │ Model       │  │ Memory       │           │
│  │ Registry    │  │ Router      │  │ Manager      │           │
│  │             │  │             │  │              │           │
│  │ + Skills    │  │ + Cost      │  │ + SSOT       │           │
│  │   Registry  │  │   Tracker   │  │   Folders    │           │
│  └─────────────┘  └──────┬──────┘  └──────────────┘           │
│                          │                                     │
│                   ┌──────▼──────┐                              │
│                   │  Provider   │                              │
│                   │  Adapters   │                              │
│                   │             │                              │
│                   │ Anthropic   │                              │
│                   │ Claude CLI  │                              │
│                   │ OpenAI      │                              │
│                   │ Google      │                              │
│                   │ Mistral     │                              │
│                   │ DeepSeek    │                              │
│                   │ Local LLM   │                              │
│                   │ Copilot     │                              │
│                   └─────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

## Activation Flow

1. VS Code triggers `onStartupFinished`.
2. `extension.ts` → `activate()` runs:
  - Creates core services: `CostTracker`, `AgentRegistry`, `SkillsRegistry`, `ModelRouter`, `TaskProfiler`, `MemoryManager`, `ToolWebhookDispatcher`.
    - Creates `VoiceManager` for browser-based voice panel orchestration and optional ElevenLabs audio delivery. It also owns a `HostSpeechSynthesizer` (`src/voice/hostSpeechSynthesizer.ts`) that drives the OS's built-in speech engine (Windows SAPI via PowerShell, macOS `say`, Linux `espeak-ng`) on-device when `atlasmind.voice.hostSpeechEnabled` is set; TTS backend priority is ElevenLabs → OS host engine → Web Speech API. For speech-to-text it owns a `LocalTranscriber` (`src/voice/localTranscriber.ts`) that runs a local `whisper-cli` on webview-captured WAV audio; the model (and, on Windows x64, the binary) are SHA-256-verified downloads provisioned on first use, and audio never leaves the machine. STT engine selection (`atlasmind.voice.sttEngine`) is `auto` | `webspeech` | `local`.
  - Creates `ProviderRegistry` and registers provider adapters, including the Claude CLI Beta bridge.
   - Instantiates the `Orchestrator` with all services injected.
   - Bundles services into `AtlasMindContext`.
   - Calls `registerChatParticipant()`, `registerCommands()`, `registerTreeViews()`.
3. The `@atlas` chat participant and sidebar views are now available.

The AtlasMind sidebar now starts with a compact Quick Links webview row that sits under the container title and exposes icon-only shortcuts for the Project Dashboard, Ideation board, Run Center, Cost Dashboard, Model Providers, and Settings before the embedded Chat view and the collapsed operational tree views. Assistant transcript metadata now carries not only routed-model and thinking-summary details but also learned-from-friction timeline notes, which lets both the dedicated chat panel and the native sidebar chat surface when Atlas has shifted into direct recovery after operator frustration.

AtlasMind's Voice panel is currently a webview-first specialist surface. It uses the Web Speech API for in-panel STT and fallback TTS, can route optional ElevenLabs audio through a selectable HTML audio sink when the runtime supports it, and stores preferred microphone and speaker ids for future native backends. There is not yet a host-side OS-native speech adapter.

## Core Services

### Orchestrator (`src/core/orchestrator.ts`)

Central coordinator. Receives a `TaskRequest` and:
1. Selects the best agent via `AgentRegistry`.
2. Gathers relevant memory slices via `MemoryManager.queryRelevant()`.
3. Builds a task profile via `TaskProfiler`.
4. Picks a model via `ModelRouter.selectModel()`.
5. Resolves skills for the agent via `SkillsRegistry.getSkillsForAgent()`.
6. Builds a context bundle and dispatches execution.
7. Records cost via `CostTracker`.

### AgentRegistry (`src/core/agentRegistry.ts`)

In-memory map of `AgentDefinition` objects. Supports `register()`, `unregister()`, `get()`, `listAgents()`, `listEnabledAgents()`, and persisted enable/disable state for operator toggles.

### SkillsRegistry (`src/core/skillsRegistry.ts`)

In-memory map of `SkillDefinition` objects. Also supports:
- `getSkillsForAgent()` — resolves skills for an agent, filtered to enabled skills only.
- `enable(id)` / `disable(id)` — toggle availability; `enable` throws if the skill has a failed scan.
- `setScanResult(result)` / `getScanResult(id)` — store and retrieve security scan results.
- `setDisabledIds(ids)` / `getDisabledIds()` — bulk restore/persist disabled state.

### Skill Drafting (`src/core/skillDrafting.ts`)

Utility helpers that build the prompt for Atlas-generated custom skill drafts, normalize suggested skill IDs, and extract JavaScript source from provider responses before scanning/import.

### ModelRouter (`src/core/modelRouter.ts`)

Maintains a map of `ProviderConfig` objects plus provider health state. `selectModel()` accepts `RoutingConstraints`, an optional model whitelist, and an optional `TaskProfile`. It filters by required capabilities, task-profile gates, and provider health before scoring the remaining models using budget mode, speed mode, capability proxies, and task fit. `getModelInfo()` exposes pricing metadata for orchestration cost accounting.

Key behaviors added in 0.73.0–0.73.1:
- **Deprecation filter**: models with a `deprecatedAt` date in the past are auto-excluded from candidates.
- **Failure TTL**: stale failure records (older than 5 min) are cleared so transient errors don't permanently exclude providers.
- **Thinking-token cost scaling**: `effectiveCostPer1k` applies `thinkingTokenMultiplier` to output price for accurate extended-thinking model budgeting.
- **Smooth context gradients**: context-window score penalties in `scoreTaskFit` interpolate linearly rather than applying binary cliff penalties, so future large-context models are not penalised.
- **Outcome feedback loop**: `recordModelOutcome(modelId, success)` accumulates fractional preference votes from completed tasks, feeding real execution results back into future routing decisions.
- **Named scoring constants**: all previously undocumented magic numbers in `scoreModel`, `scorePreferenceBias`, and `scoreTaskFit` are extracted to named constants in `src/constants.ts`.

### SecretRedactor (`src/utils/secretRedactor.ts`)

Pattern-based secret scanner applied to memory context and live evidence before LLM dispatch. Covers Anthropic/OpenAI/GitHub keys, bearer tokens, PEM private keys, database connection strings, and generic key/secret assignments. `redactSecrets()` returns a `RedactionResult` with match count and matched pattern names; `redactSecretsWithWarning()` logs a console warning when any secrets are found. This is separate from `MemoryScanner`, which blocks writes to SSOT — the `SecretRedactor` protects the runtime dispatch boundary.

### DataPrivacyManager (`src/core/dataPrivacyManager.ts`)

Project-scoped data-privacy policy that ensures confidential, proprietary, or regulated content is only ever sent to user-selected **trusted** models. Classifies text (literal terms and regexes) and file/folder paths (traversal-safe globs), maintains the trusted-model allow-list, and redacts classified spans (`[CONFIDENTIAL]`) for un-trusted models via `redactForModel()`. **Deny-by-default**: an empty trusted list trusts nothing, so enabling the policy with no trusted model redacts classified content for every model until one is selected. The policy lives at `project_memory/operations/data-privacy.json` (`readDataPrivacyConfig`/`writeDataPrivacyConfig`); the live policy is reloaded on file change.

Built-in **compliance packs** (`src/core/compliancePacks.ts`) contribute curated regulated-data detectors when enabled — GDPR (personal data), HIPAA (PHI), PCI-DSS (cardholder data, Luhn-validated), CCPA/CPRA, and Financial (IBAN mod-97). These are heuristic aids, not a compliance certification.

Enforcement lives in the `Orchestrator`: `applyDataPrivacyGate()` classifies the assembled context before model selection and restricts the agent's candidate models to the trusted allow-list (`RoutingConstraints.requireTrustedModel`); `buildMessages()` applies `privacyRedact()` to memory, live evidence, and supplemental context keyed on the actually-selected model (the fail-safe for pins/parallel overflow); and `redactToolResultForModel()` withholds `file-read` results for classified paths when the running model is un-trusted. When classified content is found but no trusted model is available, the content is redacted and the UI is notified via `OrchestratorHooks.onClassifiedContentForUntrustedModel`.

The gate also records a **catch** (`recordCatch`) each time a rule/detector fires for a real task, capturing the source label and sensitivity (never the matched value) and whether the selected model was trusted. The activity log is persisted workspace-scoped and powers the Privacy dashboard charts (catches over time + per-detector breakdown). `src/core/providerDataGovernance.ts` is a static reference mapping each provider to its GDPR/data-subject request portal, privacy policy, DPA, retention summary, and default training stance, surfaced on the Privacy page for the providers hosting trusted models. The Privacy page renders the trusted-model allow-list as a collapsible provider→model tree limited to currently-active models.

### DeliveryManager (`src/core/deliveryManager.ts`)

Models a project's **deployment stages** (Local → Staging → Production …) and the **promotion ("push") edges** between them, surfaced on the Project Dashboard → Delivery page. A `DeliveryConfig` (`stages: DeploymentStage[]`, `paths: PromotionPath[]`) is persisted as the source of truth at `project_memory/operations/delivery.json`, with a human-readable `delivery.md` runbook mirror regenerated on every write (`renderDeliveryMarkdown`) so the pipeline is understandable and editable by a newcomer without asking the AI. The persistence helpers (`readDeliveryConfig`/`writeDeliveryConfig`/`seedDeliveryConfig`) are `vscode`-free (node `fs` only), matching the `DataPrivacyManager` pattern.

On first open the dashboard seeds a pipeline that reflects the repository's **actual** delivery protocol. `detectDeliverySignals` (in `projectDashboardPanel.ts`) imports: branch layout, **project archetype** (VS Code extension / library / web service / generic, from `engines.vscode`/`contributes`/server deps/`Dockerfile`/`main`), **database presence** (DB dependency regex + `migrations`/`prisma` dirs), **publish target** (Marketplace from vsce, container from a Dockerfile, npm from a publish script), **`.env` files** (only referenced when present), **package scripts** (`compile`/`build`, `lint`, `test`), **CI** presence, and **existing routines** (the production push binds to a `publish|release|ship|deploy` or default routine). `seedDeliveryConfig` turns those into stages: a deploy-less project gets an **Integration** stage rather than a fictional staging-server-with-DB, the publish target becomes production hosting, required checks mirror the scripts that exist (+ "CI green"), and **no backup gate is imposed when there is no database** — avoiding a phantom deny-by-default block. A data-bearing production target still gets `required: true` with an empty command, so it stays **deny-by-default blocked** until a real backup command is supplied. Each `DeploymentStage` carries a plain-English `description`, config-source **location** (never secret values), and explicit `backupPolicy` / `promotionPolicy` / `rollbackPolicy`. Per-stage status (the deployed version) is read from each branch's `package.json`.

Detection also imports the **Git PR/CI promotion protocol** per branch. `detectBranchCiGating` parses `.github/workflows/*.yml` for the workflows that gate a branch (and whether any do so on `pull_request`); `fetchBranchProtection` is a best-effort `gh api .../branches/{branch}/protection` probe (run only at seed/re-import, short timeout, graceful fallback) that yields the exact required-check **contexts** and whether **PRs are required**. From these, `seedDeliveryConfig` sets `StagePromotionPolicy.viaPullRequest` (PR required — sourced from branch protection's `required_pull_request_reviews` or a bound routine's `gh pr create`, *not* merely from CI having a `pull_request` trigger, so a CI-gated-but-direct-push branch like `develop` is modelled correctly) and `requiredStatusChecks` (the real CI contexts). `buildPromotionPlan` surfaces each status check as a preflight item and **blocks a PR-required promotion that has no routine bound to open the PR**, so a protected branch is never targeted by a direct push.

A **"Re-import from repo"** action (the `reimportDelivery` message → `handleReimportDelivery`) re-runs detection and rebuilds the pipeline, so an already-seeded project whose real protocol has since moved on — or one seeded by older, generic logic — can refresh to match reality (two-click confirmed; it re-baselines the review state).

The Delivery page hosts a full **stage editor**: stages can be added, edited, reordered (by `rank`), and removed (two-click confirm), and promotion edges added / re-pointed / removed. The editor posts the whole config back as a `saveDeliveryConfig` webview message; the panel runs it through `sanitizeDeliveryConfig` — the untrusted-input boundary that clamps string lengths, coerces types (booleans are strict `=== true`), regenerates duplicate/missing ids, and drops promotion edges that reference a non-existent or self stage — before `DeliveryManager.save()` writes it.

**Stays current + drift detection.** A `vscode` file watcher on `delivery.json` (registered in `extension.ts`) reloads the manager and fires `deliveryRefresh` whenever the file changes outside the dashboard (hand edits, a teammate's `git pull`, a script), so the page never shows a stale protocol. The dashboard also computes a **review status**: it fingerprints the review-relevant state (a stable projection of the stage/path config, stage-candidate branches in the repo not yet modelled, stage branches that have gone missing, and the CI/CD workflow set) and diffs it against the last-reviewed baseline stored workspace-scoped in `workspaceState` (`atlasmind.deliveryReview`). When they differ, a **"Review needed"** banner lists what changed and offers **Mark reviewed**, which snapshots the current fingerprint as the new baseline. Saving edits through the dashboard editor updates the baseline implicitly — the banner is reserved for drift the user did *not* author.

### PromotionRunner (`src/core/promotionRunner.ts`)

The guarded promotion ("push") engine. `buildPromotionPlan(input)` assembles an inspectable `PromotionPlan` for a path: the ordered guarded steps (**preflight gate → backup → deploy → verify → record**) and the preflight checks. Checks AtlasMind can mechanically evaluate are computed (`requireVersionBump` via `compareSemver` of source vs target `package.json`, `requireChangelog` via a CHANGELOG scan, "working tree clean" via `git status`); every other named check is flagged for **manual attestation**. A target whose `backupPolicy.required` is set but has no command is recorded as a hard **blocker** (deny-by-default).

`evaluatePromotionGate(plan, attestations, confirmText, targetName)` is the single authorization point: it refuses when there is any blocker, any failing auto-check, an un-attested manual check, a missing approval (when `requiresApproval`), or — for a protected stage — a confirmation string that does not match the target name. `runPromotion(options)` executes only after the gate passes, running the backup command, the bound routine's deploy steps (honouring each step's `on_fail`), and an HTTP health check of `hosting.healthCheckUrl`, streaming per-step progress and returning a result plus a rollback hint.

**Live CI verification.** Required CI status checks are *verified* rather than self-attested: the panel resolves live check-run status for the source branch's head commit via `gh` (`gatherLiveCiStatus`) and passes it into `buildPromotionPlan` as `liveStatusChecks`. A context with live status becomes an **auto** preflight check (a failing *or pending* run makes the gate refuse); without `gh` it falls back to manual attestation. **Audit + recovery:** each promotion and rollback is appended to `project_memory/operations/delivery-history.json` (`appendPromotionHistory`, with the git actor) and surfaced as *Recent promotions*; `runRollback` executes a stage's user-authored rollback command after authorization (protected stages require the typed stage name). `checkHealthUrl` backs the stage **Test health** button. Import detection (`detectDeliverySignals`) spans polyglot ecosystems (Python/Go/Rust/Java/.NET manifests, web frameworks, ORMs) and PaaS/IaC targets (Fly.io, Vercel, Netlify, Render, GAE, Serverless, Kubernetes, Terraform, containers), deriving production hosting, database presence, and a production URL where possible.

**Governance + safety (concurrency, CD, data, duties).** A workspace lock (`acquireDeliveryLock` / `releaseDeliveryLock`, `project_memory/operations/.delivery-lock.json`, stale after 60 min) makes promotions/rollbacks single-flight. A stage may set `promotionPolicy.dispatchWorkflow` (auto-detected from a `workflow_dispatch` deploy/release workflow when no routine is bound) so the promote step becomes `gh workflow run <file>` — deploying in CI/CD rather than on the developer's machine. `backupPolicy.verifyCommand` runs as a managed step after the backup (verified, not just executed); `data.migrateCommand` runs migrations inside the guarded sequence. `promotionPolicy.requireDistinctApprover` adds an automatic separation-of-duties gate comparing the git actor's email against the source head-commit author (`resolveGitActorEmail` / `resolveLastCommitAuthor`), degrading to manual attestation when identities are unresolved. (Deferred for dedicated design: first-class progressive delivery and ephemeral preview environments.)

The panel (`projectDashboardPanel.ts`) drives this through two webview messages — `requestPromotionPlan` (builds the plan/runbook from live git state) and `runPromotion` (rebuilds the plan, re-runs `evaluatePromotionGate`, executes, then records the outcome onto the path via `DeliveryManager.save()`). **Security boundary:** every executed command is read server-side from the persisted, user-authored stage config (`backupPolicy.command`) or routine files — the webview can only *trigger* and *attest*, never supply a command string — and AtlasMind itself never force-pushes.

### MissionRunner (`src/core/missionRunner.ts`)

The autonomous goal-seeking **Mission Loop**. It wraps the existing single-pass plan→execute→synthesize machinery (`Orchestrator.processProject` with a `planOverride`) in an outer loop that re-evaluates progress against a goal after every iteration and keeps going until the goal is met **or** the closed parameter envelope confines progress. Each iteration runs: (1) **guardrail pre-check** — iterations / cost / cumulative tokens / wall-clock / consecutive-no-progress plus the project-wide daily budget gate (`CostTracker.getDailyBudgetStatus`); any hard cap stops the loop with a typed `MissionStopReason`; (2) **checkpoint gate** — hybrid autonomy: when a configured trigger fires (every N iterations, a budget-fraction crossing, or before write batches) the loop pauses for the `checkpointGate` hook, **deny-by-default** if unanswered; (3) **plan increment** — `Planner.plan(incrementGoal)` where the increment goal is composed from the goal, guardrails, success criteria, the evaluator's next-focus, and a carry-forward summary; (4) **execute**; (5) **evaluate** via `GoalEvaluator`; (6) **decide** — `achieved` (with confidence ≥ threshold) stops success, `blocked` stops, otherwise loop again. Every dependency is a narrow structural interface (`MissionExecutor`, `MissionPlannerLike`, `MissionBudgetStore`, `MissionPersistence`) so the runner is `vscode`-free and unit-testable; the Orchestrator, Planner, CostTracker, and MissionRegistry satisfy them. **Recoverable-block recovery:** when the loop would otherwise stop `blocked` or `no-progress`, `detectSettingBlocker()` checks whether the cause is a relaxable AtlasMind setting (it keys off the deterministic tool-approval denial reason, e.g. `allowTerminalWrite`); if so, the `blockedGate` hook asks the user to override-for-this-run, open settings, or stop — deny-by-default, and it never re-prompts for the same setting after one override. The surfaces wire this via the shared `createMissionSettingBlockGate()` helper (`participant.ts`), which applies the override and reverts it when the run ends. Progress is emitted as `MissionProgressUpdate` events for both the `/loop` chat command and the Mission Control panel. **SSOT integration:** the increment goal is grounded in project memory (the Planner already pulls `project_soul`/roadmap/decisions/architecture), discovery is prefer-existing (registered capabilities first, then gated synthesis/ARD), the project's Testing Methodology Matrix + TDD policy are inherited via `executeSubTask`, and deployments are never run directly — they route through the guarded `PromotionRunner` pipeline.

### GoalEvaluator (`src/core/goalEvaluator.ts`)

LLM-backed progress judge that decides whether a mission's goal is met. Given the goal, success criteria, accumulated outputs, changed files, and verification status, it returns a `GoalVerdict` (`achieved` | `progressing` | `stalled` | `blocked`, plus `confidence`, `remaining`, `nextFocus`, `rationale`). Output is treated as **untrusted**: `parseGoalVerdict` strips fences, extracts the first object, and validates every field (mirroring the Planner's discipline), falling back to `stalled`/zero-confidence on anything malformed so a bad evaluator can never falsely declare success. `applyVerificationGuard` defensively downgrades an `achieved` verdict to `progressing` when the iteration changed files but its TDD/verification status is `missing` or `blocked`. The evaluator takes an injected one-shot completion function (the runner passes `Orchestrator.summarizeText`).

### MissionRegistry (`src/core/missionRegistry.ts`)

Audit-trail persistence for mission runs. Like `DeliveryManager`, the persistence helpers are `vscode`-free (node `fs` only): a `MissionRunRecord[]` is stored as the source of truth at `project_memory/operations/missions.json` with a human-readable `missions.md` runbook mirror regenerated on every write (`renderMissionsMarkdown`). `toPersistedRecord` trims large synthesis/output text and drops heavy nested artifacts before writing, and the history is capped at `MAX_MISSION_RECORDS`. No secret values are persisted. It also exposes `listActive()` (running / awaiting-checkpoint missions) and a lightweight, `vscode`-free `onChange` subscription fired on every save — the **Cost Dashboard** subscribes to it to render its live "Current Loops" section (accumulated cost vs. cap, iteration progress, tokens, latest verdict) and re-render as each iteration is saved.

### TaskProfiler (`src/core/taskProfiler.ts`)

Infers a `TaskProfile` from the current phase and request text. It classifies modality (`text`, `code`, `vision`, `mixed`), reasoning intensity (`low`, `medium`, `high`), and any hard or soft capability needs used by the router.

### SkillScanner (`src/core/skillScanner.ts`)

Static security scanner that checks skill source code against configurable rules. Exports `BUILTIN_SCAN_RULES` (12 rules), `resolveRules(config)` (merges overrides and custom rules), `scanSkillSource(id, source, config?)`, and `scanSkillFile(id, path, config?)`. Returns a `SkillScanResult` with per-issue details (rule, severity, line, snippet, message).

### TestingConfigLoader (`src/core/testingConfigLoader.ts`)

Pure-Node utility (no VS Code dependency) that connects the Testing Methodology Matrix to the execution pipeline. `readProjectTestingConfig(workspaceRoot)` reads `project_memory/index/testing-config.json`. `inferTestingMethodologyForSubTask(task, config)` detects the best matching `TestingMethodologyId` from a subtask's role and description using `TESTING_METHODOLOGY_DEFINITIONS.autoDetectSignals`. `resolveTestingModelOverride(methodologyId, methodConfig, agents)` walks the lookup chain — `assignedModelId` → assigned agent's `testingModelOverrides[id]` — and returns the effective override model ID. Used by the orchestrator in both the project subtask path and the direct task path to apply per-methodology model routing when the Testing Methodology Matrix is configured.

### TestingScaffolder (`src/core/testingScaffolder.ts`)

Constructs a language- and archetype-aware starter testing framework from the enabled methodologies. `scaffoldTestingFramework(workspaceRoot, config)` detects the project **language** — Node (JS/TS), Python, Rust, Go, .NET, or Java — from manifest fingerprints (`package.json`, `pyproject.toml`/`requirements.txt`/`setup.py`/`Pipfile`, `Cargo.toml`, `go.mod`, `*.csproj`/`*.sln`, `pom.xml`/`build.gradle`) and a coarse **archetype** (web / api / cli / game / mobile / library / generic), then generates idiomatic starter files per enabled methodology: Vitest/Jest/Playwright/Cypress/fast-check/k6 (Node, with e2e branching on archetype), pytest/Hypothesis/Locust (Python), `cargo test`/proptest/criterion (Rust), `go test`/`testing/quick`/benchmarks (Go), xUnit (.NET), JUnit 5 (Java). It also writes a managed `project_memory/operations/testing-strategy.md` playbook with language-specific set-up hints. Unknown stacks degrade to playbook-only guidance. Strictly non-destructive: starter files are created only when absent and never overwritten, no manifest is ever mutated, and the only file always (re)written is the managed playbook.

### TestingProtocolSync (`src/utils/testingProtocolSync.ts`)

The outbound counterpart to `aiInstructionSync.ts`. `syncTestingProtocols(workspaceRoot, config, agents)` renders the enabled methodologies into a delimited, AtlasMind-managed markdown block (`<!-- atlasmind:testing-protocols:start -->` … `:end -->`) and upserts it into every *detected* (existing) external agent instruction file — `CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, Cursor, Cline, Gemini, Windsurf, Aider. It only ever rewrites its own block, preserves surrounding content, writes only to files that already exist, and routes all paths through the shared `isSafeRelativePath` / `resolveRelativePath` traversal guard (exported from `aiInstructionSync.ts`). JSON-config tools are reported as skipped. The orchestrator and the Settings → Testing matrix call this so external agents stay in step with the configured strategy.

### ModelEvalHarness (`src/core/modelEvalHarness.ts`)

A scored-replay harness (`compareModelsOnPrompt`) that runs one prompt across a set of candidate models and returns a ranked comparison — graded output quality (`gradeExecutionQuality` from the shared `executionQuality.ts`), cost, latency, token counts, and a preview. The model call is injected so the core is pure and host-independent; graded outcomes are surfaced via an `onResult` callback so a benchmark can record them into the router's outcome channel, calibrating outcome-driven routing. Backs the `AtlasMind: Compare Models on a Prompt` command.

### ScannerRulesManager (`src/core/scannerRulesManager.ts`)

Persists scanner rule overrides and custom rules in `vscode.Memento` (`globalState`). Key: `atlasmind.scannerRulesConfig`. Methods: `getConfig()`, `getEffectiveRules()`, `updateBuiltInRule()`, `resetBuiltInRule()`, `upsertCustomRule()`, `deleteCustomRule()`. Validates regex patterns before accepting any change. entries per session. Provides `getSummary()` returning totals for cost, requests, and tokens. Supports `reset()`.

### MemoryManager (`src/memory/memoryManager.ts`)

Interface to the SSOT folder structure. Supports `queryRelevant()` (local hashed embeddings + lexical ranking), `upsert()`, `loadFromDisk()`, and `listEntries()`.

### RemoteControlServer (`src/remote/remoteControlServer.ts`)

Desktop-only localhost WebSocket server that lets the AtlasMind web build remote-control this instance. Off by default; only listens after `AtlasMind: Enable Remote Control`, a workspace-trust approval, and a pairing token (stored in `SecretStorage`, modeled on `ToolWebhookDispatcher`). On an authenticated connection it constructs a `RemoteWebviewHost` (`src/remote/remoteBridge.ts`) — a synthetic `ChatPanelHost` — and binds a real `ChatPanel` to it, so the full chat implementation drives the remote browser. Outbound `webview.postMessage` calls are forwarded over the socket; inbound chat frames are re-validated with `isChatPanelMessage` before dispatch. It also answers read-only `cost`/`runs` RPCs backed by `CostTracker` and `ProjectRunHistory`. Disconnect disposes the ChatPanel (aborting in-flight work, so pending tool approvals default to denied). The wire protocol is the Node-free `src/remote/protocol.ts`, shared with the web build. See [Remote Control](remote-control.md).

## Key Interfaces

`VoiceSettings` carries both synthesis controls and capability-sensitive device preferences:

```typescript
interface VoiceSettings {
  rate: number;
  pitch: number;
  volume: number;
  sttEnabled: boolean;
  language: string;
  inputDeviceId: string;
  outputDeviceId: string;
}
```

The webview can always honor the tuning values, but device ids are enforced only when the active backend and runtime expose the necessary APIs.

`ProjectRunRecord` now also carries chat-link and review metadata so autonomous work can stay reviewable inside the originating transcript instead of forcing a separate dashboard hop:

```typescript
interface ProjectRunRecord {
  id: string;
  goal: string;
  chatSessionId?: string;
  chatMessageId?: string;
  reviewFiles?: Array<{
    relativePath: string;
    status: 'created' | 'modified' | 'deleted';
    decision: 'pending' | 'accepted' | 'dismissed';
    decidedAt?: string;
  }>;
}
```

That linkage lets the chat panel nest autonomous runs under their parent session, reopen the run as an inline review bubble beneath the assistant turn that launched it, and keep pending per-file decisions visible in the composer flyout.

### ProviderRegistry (`src/providers/index.ts`)

In-memory map of provider adapters implementing `ProviderAdapter`. The orchestrator resolves adapters by provider id (for example `anthropic`, `claude-cli`, and `local`) before executing completions.

The local model advisor reads its release-aware recommendation catalog from `src/providers/localModelRecommendationRegistry.ts`, which supports a validated workspace override file at `.atlasmind/local-model-recommendations.json` and falls back to built-in defaults when the override is missing or invalid.

### ToolWebhookDispatcher (`src/core/toolWebhookDispatcher.ts`)

Sends outbound webhook notifications for tool execution events. Reads workspace webhook settings (`atlasmind.toolWebhook*`), stores bearer token in SecretStorage, persists delivery history in globalState, and applies timeout/event filtering before dispatch.

### McpClient (`src/mcp/mcpClient.ts`)

Wraps `@modelcontextprotocol/sdk` `Client` for a single server. Supports `connect()`, `disconnect()`, `callTool()`, `refreshTools()`. Handles `stdio` (subprocess via `StdioClientTransport`) and `http` (Streamable HTTP with SSE fallback via `StreamableHTTPClientTransport` / `SSEClientTransport`). Tracks `status: McpConnectionStatus` and surfaces `error` and `tools` as readable state.

### McpServerRegistry (`src/mcp/mcpServerRegistry.ts`)

Manages `McpServerConfig` persistence (key: `atlasmind.mcpServers` in `globalState`) and live `McpClient` instances. On `connectServer()`: instantiates a client, calls `connect()`, then registers each discovered tool as a `SkillDefinition` in `SkillsRegistry` (ID: `mcp:<serverId>:<toolName>`) with auto-approved scan status. On `disconnectServer()`: disables or unregisters the corresponding skills. `connectAll()` is called non-blocking on activation; `disposeAll()` is called on deactivation.

### Agentic Resource Discovery (`src/ard/`)

[ARD](resource-discovery.md) is a discovery-only protocol layered in front of invocation. Three core services, plus a webview panel and a sidebar tree:

- **`ArdClient` (`src/ard/ardClient.ts`)** — the protocol client. `search()` issues `POST /search` to registry finders (following `referrals[]` up to `MAX_ARD_FEDERATION_DEPTH` with a loop guard) or fetches and locally ranks `manifest` finders; `fetchCatalog()` reads `/.well-known/ai-catalog.json` and expands nested catalogs. All responses pass strict validation (`urn:ai:` identifiers, value-or-reference exclusivity, byte/entry caps) and URL screening (HTTPS + private-host SSRF guard). Tunables are read fresh per call via an injected config getter.
- **`ArdRegistry` (`src/ard/ardRegistry.ts`)** — persists Agent Finders (key: `atlasmind.ardEndpoints` in `globalState`), seeded once from `DEFAULT_ARD_FINDERS` (all **disabled**), and caches recent results for the tree view. Mirrors `McpServerRegistry`'s persistence pattern.
- **`ArdInstaller` (`src/ard/ardInstaller.ts`)** — maps a discovered resource to a non-destructive action: MCP servers → `McpServerRegistry.addServer({ enabled: false })`; nested catalogs/registries → disabled finders; A2A/skill/API → reference only.
- **`buildAtlasMindCatalog` (`src/ard/ardCatalogExporter.ts`)** — the publisher; emits a spec-conformant `ai-catalog.json` of agents/skills/MCP servers with secrets, prompts, and env redacted.
- **`discover-resources` skill** (`src/skills/discoverResources.ts`) — read-only in-task discovery, registered via a factory closure over `ArdClient`/`ArdRegistry`.
- **UI** — the **Resource Discovery** tab in the Settings dashboard (the `discovery` page in `src/views/settingsPanel.ts`) and the `atlasmind.discoveryView` tree provider in `src/views/treeViews.ts`. The `AtlasMind: Resource Discovery` command opens the Settings panel on that tab.

The services are constructed in `activate()` and bundled into `AtlasMindContext` as `ardRegistry`, `ardClient`, `ardInstaller`, and `discoveryRefresh`.

## Data Flow

```
User message → Chat Participant → Orchestrator.processTask()
  → AgentRegistry.selectAgent()
  → MemoryManager.queryRelevant()
  → TaskProfiler.profileTask()
  → ModelRouter.selectModel()
  → SkillsRegistry.getSkillsForAgent()
  → ProviderAdapter.complete()
  → CostTracker.record()
  → TaskResult → Chat response stream
```

Project execution flow:

```
/project <goal> → Chat Participant → Orchestrator.processProject()
  → Planner.plan()          (LLM decomposes goal → ProjectPlan DAG)
  → onProgress({ type: 'planned' })
  → TaskScheduler.execute()
      for each dependency batch (in parallel):
        → Orchestrator.executeSubTask()
            → ephemeral AgentDefinition (from SubTask.role)
            → Orchestrator.processTaskWithAgent()
        → onProgress({ type: 'subtask-done' })
  → Orchestrator.synthesize()  (LLM assembles final report)
  → ProjectResult → streamed to chat
```

Bootstrap flow behavior:

```
/bootstrap or command -> bootstrapProject()
  -> run guided/skippable project intake
  -> reuse out-of-turn details from earlier answers so later prompts can be skipped
  -> create SSOT structure
  -> write project_soul.md + project brief + roadmap + intake log + repository plan
  -> seed project_memory/ideas/ with intake-aware ideation defaults
  -> seed project-scoped Personality Profile defaults when the intake provides stable project context
  -> update workspace routing and dependency-monitoring settings when answers map cleanly
  -> write GitHub-ready planning artifacts (.github issue template + project-planning seed)
  -> offer governance scaffolding
     (.github workflow/templates, CODEOWNERS, .vscode/extensions.json)
  -> preserve existing files (non-destructive)
```

Personality Profile flow behavior:

```
Command Palette or walkthrough -> openPersonalityProfile
  -> guided questionnaire webview
  -> each prompt offers quick-fill presets plus a freeform editable answer
  -> persist answers to workspace state
  -> inject the saved profile into Atlas task prompt assembly on every request
  -> update live AtlasMind settings (budget, speed, approvals, chat carry-forward)
  -> when SSOT is present, write profile artifacts into project_memory/agents/
  -> offer direct-edit links to the generated profile markdown and project_soul.md
  -> sync a summary block back into project_soul.md
```

## Security Boundaries

- Webviews are isolated behind a strict CSP and communicate only through validated message payloads.
- Provider credentials belong in VS Code SecretStorage and are not part of the SSOT or workspace configuration.
- Bootstrap operations are constrained to safe relative paths inside the current workspace.
- Future orchestrator execution should preserve the same rule: validate inputs, redact secrets, and prefer explicit user confirmation for risky actions.

## Quality Gates

- Local quality loop: `npm run lint`, `npm run test`, `npm run compile`.
- CI pipeline (`.github/workflows/ci.yml`) enforces compile, lint, test, and coverage for pushes and pull requests to `master`.
- Ownership and review enforcement are defined in `.github/CODEOWNERS`.

## Dependency Graph

```
extension.ts
  ├── chat/participant.ts
  ├── commands.ts
  │     ├── views/settingsPanel.ts
  │     ├── views/personalityProfilePanel.ts
  │     ├── views/modelProviderPanel.ts
  │     ├── views/toolWebhookPanel.ts
  │     ├── views/skillScannerPanel.ts
  │     ├── views/missionControlPanel.ts
  │     │     └── core/missionRunner.ts (→ core/goalEvaluator.ts, core/missionRegistry.ts)
  │     └── bootstrap/bootstrapper.ts
  ├── views/treeViews.ts
  └── core/orchestrator.ts
        ├── core/agentRegistry.ts
        ├── core/skillsRegistry.ts
        ├── core/modelRouter.ts
        ├── core/skillDrafting.ts
        ├── core/taskProfiler.ts
        ├── core/costTracker.ts
        ├── core/skillScanner.ts
        ├── core/scannerRulesManager.ts
        ├── core/planner.ts
        ├── core/taskScheduler.ts
        ├── core/toolWebhookDispatcher.ts
        ├── memory/memoryManager.ts
        │     └── memory/memoryScanner.ts
        ├── mcp/mcpServerRegistry.ts
        │     └── mcp/mcpClient.ts
            ├── skills/index.ts
            │     ├── skills/dockerCli.ts
            │     └── skills/gitApplyPatch.ts
          └── providers/index.ts
              ├── providers/anthropic.ts
              ├── providers/claude-cli.ts
              ├── providers/copilot.ts
              └── providers/localModelRecommendationRegistry.ts

tests/core/
  ├── modelRouter.test.ts
  ├── costTracker.test.ts
  ├── skillDrafting.test.ts
  └── planner.scheduler.test.ts
tests/memory/
  ├── memoryManager.test.ts
  └── memoryScanner.test.ts
tests/mcp/
  ├── mcpClient.test.ts
  └── mcpServerRegistry.test.ts
tests/skills/
  └── gitApplyPatch.test.ts
```

## Key Interfaces

All shared types live in `src/types.ts`. See the [type definitions](../src/types.ts) for the full source.

| Interface | Purpose |
|---|---|
| `AgentDefinition` | Agent identity, role, system prompt, allowed models, cost limit, skills |
| `SkillDefinition` | Skill identity, JSON Schema for tool params, handler path |
| `ModelInfo` | Model identity, provider, pricing, context window, capabilities, reasoning depth, latency class, and prompt-cache support (`supportsPromptCaching`, `cachedInputPricePer1k`) |
| `ProviderConfig` | Provider identity, API key setting key, enabled flag, model list |
| `RoutingConstraints` | Budget mode, speed mode, max cost, preferred provider, preferred model (role pin), parallel slots, cacheable-prefix ratio |
| `TaskProfile` | Inferred task phase, modality, reasoning intensity, and capability preferences |
| `SubTask` | Unit of work in a project plan: id, title, role, skills, `dependsOn` edges |
| `SubTaskResult` | Execution outcome: `status` (`completed` / `failed` / `needs-input`), output, costUsd, durationMs, error, and (when capped) `iterationLimitHit` + suggested raised limits |
| `ProjectPlan` | Decomposed goal: id, goal, `subTasks[]` DAG |
| `ProjectResult` | Full execution outcome: subtask results, synthesis, totals |
| `ProjectProgressUpdate` | Discriminated progress event: `planned \| subtask-start \| subtask-done \| synthesizing \| error` |
| `TaskRequest` | User message, context, constraints, timestamp |
| `TaskResult` | Agent ID, model used, response, cost, duration |
| `CostRecord` | Per-request token counts and cost |
| `MemoryEntry` | Path, title, tags, last modified, snippet |
| `McpServerConfig` | MCP server id, name, transport (stdio/http), command/args/env or url, enabled |
| `McpConnectionStatus` | `'disconnected' \| 'connecting' \| 'connected' \| 'error'` |
| `McpToolInfo` | Server id, tool name, description, input JSON Schema |
| `McpServerState` | Live snapshot: config + status + error + discovered tools |

## Detailed Architecture Subdocs

| Document | Description |
|---|---|
| `architecture/boundaries-and-seams.md` | Explicit review of all integration seams — contracts, protocols, and security rules for each crossing |
| `architecture/runtime-and-surfaces.md` | Runtime environment and UI surface overview |
| `docs/architecture/orchestrator-flow.md` | `processTaskWithAgent` and `runAgenticLoop` internal flow with Mermaid diagrams |
