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
│  │               │   │  Skills,     │   │  Tool Webhooks,    │  │
│  │ /bootstrap    │   │  Skills,     │   │                    │  │
│  │ /agents       │   │  Memory,     │   │                    │  │
│  │ /skills       │   │  Models)     │   │                    │  │
│  │ /memory       │   │              │   │                    │  │
│  │ /cost         │   │              │   │  Voice, Vision,    │  │
│  │               │   │              │   │  Website Studio)   │  │
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

The AtlasMind sidebar now starts with a compact Quick Links webview row that sits under the container title and exposes icon-only shortcuts for the Project Dashboard, Ideation board, Run Center, Cost Dashboard, Model Providers, and Settings before the embedded Chat view and the collapsed operational tree views. Assistant transcript metadata now carries not only routed-model and thinking-summary details but also learned-from-friction timeline notes, which lets both the dedicated chat panel and the native sidebar chat surface when Atlas has shifted into direct recovery after operator frustration. Project-run offers are another validated metadata shape: interactive chat renders a **Start run / Save for later / Cancel** card, the host resolves each action once, and saving delegates preview creation to Project Run Center; Autopilot is the only mode allowed to auto-start. During an active request, the composer status also derives the current model from the host-provided `streamingModels` state and appends it to progress text; a failover updates that label without trusting model text supplied by the browser.

AtlasMind's Voice panel is currently a webview-first specialist surface. It uses the Web Speech API for in-panel STT and fallback TTS, can route optional ElevenLabs audio through a selectable HTML audio sink when the runtime supports it, and stores preferred microphone and speaker ids for future native backends. There is not yet a host-side OS-native speech adapter.

## Core Services

### Orchestrator (`src/core/orchestrator.ts`)

Central coordinator. Receives a `TaskRequest` and:
1. Selects the best agent via `AgentRegistry`.
2. Gathers relevant memory slices via `MemoryManager.queryRelevant()`.
3. Builds a task profile via `TaskProfiler`.
4. Picks a model via `ModelRouter.selectModel()`.
5. Resolves skills for the agent via `SkillsRegistry.getSkillsForAgent()`.
6. Composes immutable guardrails, the portable operating contract, the selected role prompt, and the shared plus agent-specific execution rubric.
7. Builds a context bundle and dispatches execution, enforcing incomplete-delivery and verification gates.
8. Records cost and an evidence-backed execution-quality outcome via `CostTracker` and `ModelRouter`.

The operating contract and rubric are injected in `buildMessages()` rather than copied into built-in definitions. This closes prompt drift across hand-written specialists, custom agents, ephemeral project agents, synthesized agents, and persisted prompt overrides. Built-in role prompts therefore contain only specialist scope and boundaries; all 16 user-facing specialists add concise observable criteria through `completionCriteria.rubric`. Detailed SEO and UX checklists are progressively disclosed by `src/skills/specialistGuidance.ts` only when relevant, keeping volatile platform and standards details out of permanent prompts. `completionCriteria.incompletePatterns` is evaluated inside the agentic loop using a bounded restricted-regex policy before the existing one-time completion-integrity reprompt. Execution artifacts record failed tool-call count alongside tool count, verification, and TDD status so the router's outcome signal reflects observable delivery rather than only the provider finish reason. The agentic loop also recognizes explicit runtime claims that workspace tools are disabled or unavailable: instead of spending the remaining iterations re-prompting the same bridge, it marks that model's runtime capability as failed and immediately asks the provider-failover path for another `function_calling` model. If no recovery succeeds, the project classifier records the refusal as failed, never completed.

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

The router carries two learned, decaying routing channels (both gated by `feedbackRoutingWeight`): a positive **outcome bias** (EWMA of graded execution quality, in `executionOutcomes`) and a **struggle memory** (`struggleSignals`) — a persistent, task-signature-keyed de-weight for models that repeatedly fail a *kind* of task. Normal orchestrator grades incorporate expected tool use, tool success/failure counts, verification, TDD status, incomplete-delivery signals, and the final recovered response; clean text is no longer automatically a perfect execution outcome. The explicit Model Comparison harness intentionally retains its coarse completion-integrity grade and optional judge. `recordModelStruggle()` folds a severity-weighted, decaying increment (kinds: timeout, empty, tool-call-as-text, error-finish, user-correction) keyed by `phase|modality|reasoning|requiresTools`; `scoreModel()` subtracts the decayed penalty, and `selectBestModel()` applies a **tier-escape** (re-opening candidacy one budget tier higher and re-ranking) when the top pick is a chronic struggler, so a capable model can take over the task kind a cheap model keeps failing. `recoverModelStruggle()` halves the penalty on a clean turn; `getStruggleSignals()`/`setStruggleSignals()` snapshot/restore for persistence (`globalState` key `atlasmind.modelStruggleSignals`); `getStruggleSummary()` exposes active de-weights for the Model Comparison panel hint.

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

**Detector precision is a safety property.** The detectors run over the whole assembled task context — source, logs, memory, chat history — so a pattern that fires on ordinary code silently restricts routing, redacts useful context, and floods the Privacy charts until the operator disables the policy entirely, at which point genuine regulated data is protected by nothing. Every detector is therefore anchored on a cue ordinary code does not contain (an explicit `phone:`/`SWIFT:` label, a `+` country code, a clinical construction) or paired with a validator that rejects the structurally impossible: `isPublicIpv4()` drops loopback/private/link-local/CGNAT/documentation/multicast ranges (which identify no subscriber and dominate bind configs and netmasks) and the pattern's lookbehinds drop four-part version strings; `isPersonalEmail()` drops role mailboxes (`noreply@`, `support@`, CI senders) and RFC 2606/6761 reserved domains. `tests/core/compliancePacks.test.ts` holds a benign source-repository corpus that must stay unclassified, plus the matching recall cases so tightening precision cannot silently blind a pack.

Enforcement lives in the `Orchestrator`: `applyDataPrivacyGate()` classifies the assembled context before model selection; `buildMessages()` applies `privacyRedact()` to memory, live evidence, and supplemental context keyed on the actually-selected model (the fail-safe for pins/parallel overflow); and `redactToolResultForModel()` withholds `file-read` results for classified paths when the running model is un-trusted. When classified content is found but no trusted model is available, the content is redacted and the UI is notified via `OrchestratorHooks.onClassifiedContentForUntrustedModel`.

The gate's response is **tiered by sensitivity**, because it scans the assembled *context* rather than the user's request — a hit means something in the retrieved haystack looked regulated, not that the task concerns personal data. `selectHardGatingMatches()` (exported, pure, unit-tested) picks the `secret` matches — PCI cardholder data and HIPAA PHI — and only those restrict the agent's candidate models to the trusted allow-list. `confidential`/`proprietary` matches set `RoutingConstraints.requireTrustedModel` as a marker but leave routing alone: the redaction boundary already removes the matched spans before they reach an un-trusted model, so re-routing buys no extra protection while costing an unexplained model downgrade on every heuristic hit. The gate classifies each context slice separately so its progress notice can name *where* a detector fired (`"email address in memory \"Stakeholders\""`) — an unattributed hit is indistinguishable from a false positive.

The gate also records a **catch** (`recordCatch`) each time a rule/detector fires for a real task, capturing the source label and sensitivity (never the matched value) and whether the selected model was trusted. The activity log is persisted workspace-scoped and powers the Privacy dashboard charts (catches over time + per-detector breakdown). `src/core/providerDataGovernance.ts` is a static reference mapping each provider to its GDPR/data-subject request portal, privacy policy, DPA, retention summary, and default training stance, surfaced on the Privacy page for the providers hosting trusted models. The Privacy page renders the trusted-model allow-list as a collapsible provider→model tree limited to currently-active models.

### WebsiteWorkspaceManager (`src/core/websiteWorkspaceManager.ts`)

Filesystem-only service behind **AtlasMind: Open Website Studio**. It owns the website SSOT at `project_memory/domain/website.json` and regenerates `website.md` on every save. The shared `WebsiteWorkspaceConfig` types in `src/types.ts` model:

- normalized client intake;
- page inventory with sitemap fields, section outline, design notes, and separate wireframe/UI/content/SEO review states;
- project-level UI system decisions;
- the fixed Develop → Staging → Production hosting environments, including URL/branch references, locked access policy, secret reference, and promotion-protection metadata;
- a catalog of static, managed-CMS, commerce, and custom platform targets;
- n8n workflow maps containing event/outcome/status plus non-secret references.

`sanitizeWebsiteWorkspace()` is the untrusted-input boundary for both webview edits and imported client JSON. It caps text/list/page/workflow sizes, normalizes and deduplicates IDs, allow-lists statuses, platform IDs, HTTP(S) URLs, and six-digit hex colors, removes URL credentials/query/fragment values, enforces at most one primary platform, applies the shared secret redactor, and replaces n8n webhook-shaped URLs with a marker before disk persistence. It also rebuilds the three hosting environments from canonical server-side policy: Develop is loopback/local unless the explicit hosted fallback is selected (then password-protected), Staging is always hosted and password-protected, and Production is always hosted, public, and promotion-protected. Credential references require an explicit secret-provider prefix, so a raw password-like string does not survive sanitation. Both rendered SSOT files then pass `scanMemoryEntry`; error-level prompt-injection content aborts the write before either file is created. The schema intentionally has no API-key, password, bearer-token, or webhook-value field.

`assessWebsiteHostingEnvironments()` is a non-executing readiness evaluator. It requires HTTPS for hosted environments, restricts local Develop to loopback hosts, requires password references for hosted Develop and Staging, and verifies Staging's exact `<review-label>.<production-domain>` topology. It reports missing setup separately from blocking policy violations; it never deploys.

Guided bootstrap exposes **Website / Marketing Site**. `seedWebsiteWorkspace()` carries the captured project name, summary, audience, outcome, constraints, metrics, timing, budget, and inferred platform into the Studio, but refuses to overwrite an existing website plan. The same Studio can import a bounded JSON brief and normalize common form/CRM aliases.

`src/views/websiteStudioPanel.ts` is a six-page webview (Brief, Sitemap, Wireframes & UI, UI System, Hosting & Platforms, n8n Automations). Its Hosting & Platforms page renders the fixed three-stage environment pipeline, locked access posture, readiness issues, and platform catalog. Its message guard accepts only save/import, the two fixed website SSOT paths, and three fixed AtlasMind navigation commands. It models publishing and automation readiness but executes neither. Production publishing stays in `PromotionRunner`, where backup, preflight, approval, protected confirmation, and verification remain enforceable; n8n triggering is likewise deliberately outside this planning surface.

### DeliveryManager (`src/core/deliveryManager.ts`)

Models a project's **deployment stages** (Local → Staging → Production …) and the **promotion ("push") edges** between them, surfaced on the Project Dashboard → Delivery page. A `DeliveryConfig` (`stages: DeploymentStage[]`, `paths: PromotionPath[]`) is persisted as the source of truth at `project_memory/operations/delivery.json`, with a human-readable `delivery.md` runbook mirror regenerated on every write (`renderDeliveryMarkdown`) so the pipeline is understandable and editable by a newcomer without asking the AI. The persistence helpers (`readDeliveryConfig`/`writeDeliveryConfig`/`seedDeliveryConfig`) are `vscode`-free (node `fs` only), matching the `DataPrivacyManager` pattern.

On first open the dashboard seeds a pipeline that reflects the repository's **actual** delivery protocol. `detectDeliverySignals` (in `projectDashboardPanel.ts`) imports: branch layout, **project archetype** (VS Code extension / library / web service / generic, from `engines.vscode`/`contributes`/server deps/`Dockerfile`/`main`), **database presence** (DB dependency regex + `migrations`/`prisma` dirs), **publish target** (Marketplace from vsce, container from a Dockerfile, npm from a publish script), **`.env` files** (only referenced when present), **package scripts** (`compile`/`build`, `lint`, `test`), **CI** presence, and **existing routines** (the production push binds to a `publish|release|ship|deploy` or default routine). `seedDeliveryConfig` turns those into stages: a deploy-less project gets an **Integration** stage rather than a fictional staging-server-with-DB, the publish target becomes production hosting, required checks mirror the scripts that exist (+ "CI green"), and **no backup gate is imposed when there is no database** — avoiding a phantom deny-by-default block. A data-bearing production target still gets `required: true` with an empty command, so it stays **deny-by-default blocked** until a real backup command is supplied. Each `DeploymentStage` carries a plain-English `description`, config-source **location** (never secret values), and explicit `backupPolicy` / `promotionPolicy` / `rollbackPolicy`. Per-stage status (the deployed version) is read from each branch's `package.json`, preferring the **remote-tracking ref** (`origin/<branch>`) over the local branch (`chooseDeployedVersionRef`) — a developer working on `develop` rarely pulls the release branch, so the local `master` is usually stale and would otherwise report a long-outdated version; the local ref is used only as a fallback for offline/local-only repos. Branch import is **honest, never fabricated**: when `detectProductionBranchRef` finds no production branch (no `main`/`master`/`production`/`prod`/`release` ref), `seedDeliveryConfig` leaves the Production `branchRef` unset rather than inventing `main`, and the runbook mirror renders `— (not detected)` for a branchless non-local stage — a wrong imported branch could mislead a promotion target, so deny-by-default applies to detection too.

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

### ProjectDirectorManager (`src/core/projectDirectorManager.ts`)

Models the **people** a project runs on — its stakeholders, delivery team, responsibilities (who owns what), human task assignments, and follow-ups — the data backbone of the Project Director dashboard (Project Dashboard → Director page). A `ProjectDirectorConfig` (`contacts`, `stakeholders`, `teamMembers`, `responsibilities`, `assignments`, `followUps`, `settings`) is persisted as the source of truth at `project_memory/operations/project-director.json`, with a human-readable `project-director.md` mirror regenerated on every write (`renderProjectDirectorMarkdown`) and a capped `project-director-history.json` audit trail. Like `DeliveryManager`/`DataPrivacyManager`, the persistence helpers (`readProjectDirectorConfig`/`writeProjectDirectorConfig`/`seedProjectDirectorConfig`) are `vscode`-free (node `fs` only).

**Contacts are the identity layer.** A `DirectorContact` holds a person/group's name, title, communication `links`, and an optional `ref: DirectoryRef` pointing at their system of record (`m365`/`slack`/`google`/`buzz`/`local`). Each link's `kind` is a `CommunicationChannelKind` open union (`email`, `slack`, `teams`, `buzz`, `phone`, `github`, `linkedin`, …); `buzz` records a [Buzz](https://buzz.xyz) identity (npub / @handle / #channel) with an `https`-only deep link. The governing contract is **Buzz owns identity + messaging; AtlasMind owns reasoning + execution** — so `DirectoryRef.source: 'buzz'` *references* a Buzz-owned Nostr identity; AtlasMind never mints or mirrors a directory (see `project_memory/roadmap/buzz-integration.md`). `Stakeholder` and `TeamMember` are thin role records referencing a contact by id, so one human can be both without duplicating their channels. `Assignment` is the human-owner overlay that `ProjectRunRecord`/`SubTask` (assigned to *agent roles*) lack; `Assignment.linkedRunId` binds an autonomous run to a human owner **without mutating the run record**.

**Solo dev, not just teams.** `ProjectDirectorConfig.selfContactId` marks "me" (seeded from the git user), so assignments/follow-ups default to you and the UI can address you as "you". `settings.teamMode` (`solo`/`team`/`auto`) with `resolveTeamMode`/`isSoloProject` infers **solo** when there is no team member other than yourself — a one-person project is never asked to fill in team ceremony, the dashboard foregrounds self-management (your follow-ups and the areas you own), and external stakeholders (a client, end-users, an app-store reviewer) are still first-class when they exist.

**GDPR-first, deny-by-default.** AtlasMind prefers to *reference* people in their GDPR-compliant system of record (Microsoft 365 / Entra, Slack, Google Workspace — each carries a `providerDataGovernance` entry with DSAR/retention links) and resolve details on demand, rather than hoarding raw personal data locally. A contact that stores raw PII is flagged `piiStored` so the extension layer can gate it behind a one-time consent notice and the existing `gdpr-pii` classification. Communication `handle`s are non-secret identifiers (never tokens/passwords); the markdown mirror describes channels by *kind/label only* so raw addresses never land in git-tracked prose. `sanitizeProjectDirectorConfig` is the webview→disk boundary: it clamps string lengths, whitelists every enum (unknown → safe fallback), regenerates duplicate/missing ids, **drops role records referencing a non-existent contact**, clears dangling optional references, and strips any `deepLink` whose scheme is not allowlisted (`mailto:`/`tel:`/`sms:`/`slack:`/`msteams:`/`zoommtg:`/`https:` — bare `http:`, `javascript:`, and `data:` are rejected). Pure derivations `deriveFollowUpUrgency`/`countOverdueFollowUps` classify follow-ups (`overdue`/`due-soon`/`upcoming`/`snoozed`/`done`) for the dashboard, tree badge, and (later) scheduler. A `vscode` file watcher on `project-director.json` (registered in `extension.ts`) reloads the manager and fires `projectDirectorRefresh` on external edits.

**Dashboard tab (Phase 2).** The Project Dashboard has a **Director** page (`collectDirectorSnapshot`/`detectDirectorSignals` in `projectDashboardPanel.ts`, rendered by `renderDirector` in `media/projectDashboard.js`) with Setup, People (roster), Responsibilities, Assignments (+ an "assign a human owner" overlay on autonomous `ProjectRunRecord`s via `Assignment.linkedRunId`), and Follow-ups sub-sections. It is **solo-aware** (`resolveTeamMode`/`isSoloProject` foreground self-management for a one-person project) and **GDPR-gated**: persisting raw PII triggers a one-time consent modal (workspace-scoped ack) that also enables the `gdpr-pii` compliance pack. Every webview payload is validated by `isProjectDashboardMessage` and re-run through `sanitizeProjectDirectorConfig` before it touches disk; contact deep-links are resolved and re-checked against the scheme allowlist server-side before `openExternal`, and "Copy contact" is built host-side.

**Guarded connectors (Phase 3).** With outbound messaging enabled (`settings.outboundEnabled`, default off) and a matching MCP connector connected, the Director tab can email / schedule / message a contact. `DirectorCommsRunner` (`src/core/directorCommsRunner.ts`, pure/vscode-free) detects which connected MCP tool can perform each intent — matching tool names (`outlook_send_mail`, `create_event`, `post_message`, …) across `mcpServerRegistry.listServers()`, preferring real send/create tools over drafts — and best-effort maps a composed draft onto that tool's declared input-schema fields (inventing nothing). Capabilities stay partitioned by contact channel kind (`email`/`slack`/`teams`/`buzz`) and delivery shape, so a Buzz recipient can never fall through to another connected messaging provider; Buzz channel UUIDs select `buzz_post_message`, while 64-character Nostr pubkeys select `buzz_send_dm`. Dispatch is deny-by-default in the panel: it requires the toggle, a connected connector, and an explicit `{ modal: true }` confirmation showing the exact action (connector, tool, recipient, subject/body, classified risk via `classifyToolInvocation`) before running the tool through its `mcp:<serverId>:<toolName>` skill wrapper (`skillsRegistry.get(...).execute(args, atlas.skillContext)`). No connector for the exact channel kind → non-destructive fallback to the deep-link. The webview only supplies the draft; the tool comes from the connected server, credentials stay in SecretStorage, and successful sends are recorded to `project-director-history.json`.

**Buzz Tier 1b bridge.** `src/mcp/buzzCommsServer.ts` is an extension-bundled stdio MCP server backed by the pure `BuzzCliBridge` in `src/mcp/buzzCliBridge.ts`. It wraps official `buzz-cli` source tag v0.4.26 and exposes only bounded channel listing, channel posting, bounded thread reading, and DM sending. Upstream v0.4.26 has no working `--version` flag, so the bridge probes the exact required root/channel/message/thread/DM help contracts before the MCP handshake; reads the agent private key and optional NIP-OA authorization tag from SecretStorage-backed env; converts the WS/WSS relay setting to the HTTP/HTTPS base the CLI expects; rejects remote relays without `atlasmind.buzz.allowRemoteRelay` and rejects non-TLS remote URLs; invokes the CLI without a shell; passes message bodies over stdin; validates identifiers; caps input, output, and duration; and redacts credentials from failures. It exposes none of `buzz-dev-mcp`'s shell/file-edit surface and none of Buzz's workflow/repository/admin commands. The boundary remains: **Buzz owns identity + messaging; AtlasMind owns reasoning + execution.**

**Reminders + surfacing (Phase 4).** `FollowUpScheduler` (`src/core/followUpScheduler.ts`, pure eval + a thin timer class) surfaces a **throttled, once-per-day** in-editor nudge (via injected `notify`) when follow-ups are overdue/due-soon, opening the Director tab on click. It is **notification-only and deny-by-default** — it never sends anything outbound on a timer (outbound always needs the per-send confirmation above). A startup `runOnce()` fires when `settings.nudgeOnActivation` is on (default); the recurring 30-minute timer (wired near the manager in `extension.ts`) only nudges while `settings.remindersEnabled` is on (default off); the once/day throttle is a `workspaceState` date-key that survives restarts. A sidebar tree `atlasmind.projectDirectorView` (`ProjectDirectorTreeProvider` in `treeViews.ts`) groups Stakeholders / Team / Follow-ups with an overdue badge refreshed on `projectDirectorRefresh`; `atlasmind.openProjectDirector` opens the dashboard on the Director tab, and `@atlas /director` + `/followups` print a skimmable status.

### DocumentsManager (`src/core/documentsManager.ts`)

Models a project's **document filing system** and the documents to be **kept updated automatically** — the data backbone of the Project Dashboard → **Documents** page. A `DocumentsConfig` (`filing: DocumentFilingEntry[]`, `autoUpdate: DocumentAutoUpdateEntry[]`) is persisted as the source of truth at `project_memory/operations/documents.json`, with a human-readable `documents.md` runbook mirror regenerated on every write (`renderDocumentsMarkdown`). Like `DeliveryManager`/`ProjectDirectorManager`, the persistence helpers (`readDocumentsConfig`/`writeDocumentsConfig`/`seedDocumentsConfig`) are `vscode`-free (node `fs` only) and unit-tested.

**Shelf folders are created, never written.** Declaring a shelf and then finding the folder absent is a papercut, so saving a shelf creates its folder: `newShelfPaths` (pure) diffs the incoming config against what was persisted — by *path*, so re-pointing a shelf counts as new — and `createShelfFolders` `mkdir`s the result. That is the whole of its authority: a path already a directory is a no-op, a path occupied by a **file** is reported and left untouched, an unsafe path is refused (re-validated through `normalizeRelPath`, with the resolved target re-checked against the workspace root), and every creation is surfaced to the user. Shelves whose folder is still missing get an explicit **Create folder** action on the page (`createShelfFolder` message).

**Registry, not an auto-writer (safety-first).** Following the deny-by-default posture, nothing here ever rewrites a user's documents on a timer. The manager records *where* documents live and *which* matter; the dashboard collector (`collectDocumentsSnapshot`) computes freshness by comparing each tracked file's mtime against a recorded `lastReviewed` baseline (plus a weekly-cadence window) and yields a `missing`/`review-due`/`fresh`/`unknown` status, a bounded workspace markdown walk (`listWorkspaceMarkdown`, capped, ignore-list) for "uncovered" suggestions, and per-file `updatePrompt`/counts. The user then triggers an explicit **Update with Atlas** (an `openPrompt` handoff) or **Mark reviewed** (baseline reset). `sanitizeDocumentsConfig` is the webview→disk boundary: it clamps string lengths, validates the cadence enum, regenerates duplicate/missing ids, caps array sizes, and — via `normalizeRelPath` — rejects absolute paths, drive letters, and `..` traversal so a saved entry can never point outside the workspace. A `documents.json` file watcher (`documentsRefresh`, wired in `extension.ts`) keeps the page current on external edits.

### RiskOversightManager (`src/core/riskOversightManager.ts`)

Persists the **risk register** raised by the three oversight advisors (`ethics-oversight`, `legal-oversight`, `commercial-oversight`) — the data backbone of the Project Dashboard → **Risk** page. A `RiskOversightConfig` (`findings: RiskFinding[]`, `runs: RiskDomainRun[]`) is the source of truth at `project_memory/operations/risk-oversight.json`, with a readable `risk-oversight.md` mirror regenerated on every write (`renderRiskOversightMarkdown`) and an append-only `risk-oversight-history.json` audit trail. Like `DocumentsManager`/`DeliveryManager`, the persistence helpers are `vscode`-free (node `fs` only) and unit-tested.

**A record, not an enforcement gate.** Nothing here blocks a commit, a promotion, or a release; an analysis only ever runs because the user asked for one on the Risk page. Findings are **never deleted** — they transition through `open → accepted / mitigated / closed / dismissed` — so the register stays a complete account of what was raised and what was decided, while the history file (capped at `MAX_RISK_HISTORY = 1000`, a cap the markdown mirror states rather than truncating silently) records every run and status change. Re-running an advisor calls `mergeDomainFindings`, which refreshes prose and severity on a finding already on file but preserves its human-set `status`/`statusNote`, and keeps findings the advisor no longer reports.

**Two untrusted boundaries.** Findings originate as *model output*: `parseRiskFindings` locates candidate JSON (fenced block, bare array, or a `{findings:[...]}` wrapper) and degrades to `[]` on anything malformed rather than throwing, then `sanitizeRiskFindings`/`sanitizeRiskOversightConfig` clamp every string, coerce every enum to a safe default (unknown severity → `medium`, unknown confidence → `low`, unknown status → `open`, so a finding is never silently resolved), generate collision-safe ids, and — via `normalizeRelPath` — reject absolute paths, drive letters, and `..` traversal in cited evidence. The dashboard's webview messages are validated separately in `isProjectDashboardMessage`, where an unrecognised risk domain or status is refused outright rather than coerced, because a run costs a real model call and a status change mutates the register.

**Scoring (`computeRiskScore`, pure).** Open findings are weighted by likelihood × impact, discounted by the advisor's stated confidence, then scaled by domain coverage (an unassessed domain is unknown risk, so it cannot count as assurance) and decayed as the oldest assessment goes stale past `RISK_STALE_DAYS` (90). `accepted` findings are excluded — a consciously owned risk is a decision, not an unmanaged gap. The resulting 0–100 becomes a 15-point `risk` component in `buildScoreBreakdown`, **omitted entirely until the project has been assessed** so an unassessed project reads as *unknown*, not safe, and installing the feature does not move any existing project's health number.

### SecurityReviewManager (`src/core/securityReviewManager.ts`)

Provides the `vscode`-free, `fs`-only persistence and scoring foundation for a future Project Dashboard security-review surface. `SecurityReviewConfig` records findings and the latest run for each of four areas — secrets, runtime boundaries, dependencies, and permissions — in `project_memory/operations/security-review.json`; every write regenerates a human-readable `security-review.md` mirror, while `security-review-history.json` keeps the newest 1,000 audit entries. The service is not yet wired into `extension.ts` or a webview.

**A register, not a scanner or gate.** The manager does not discover vulnerabilities, invoke an agent, grant tool authority, or block commits, promotions, and releases. It stores review evidence and human decisions. Re-running an area can refresh a finding's evidence and risk attributes without overwriting its human-managed status, and findings remain in the register rather than disappearing when a later run no longer reports them.

**Untrusted-input boundary and scoring.** `parseSecurityFindings` accepts a fenced array, bare array, or `{ findings: [...] }` wrapper and degrades malformed model output to `[]`. `sanitizeSecurityFindings` and `sanitizeSecurityReviewConfig` cap collections and text, coerce unknown enums to conservative defaults (including unknown status → `open`), generate collision-safe ids, and reject absolute, drive-qualified, or traversal evidence paths. `computeSecurityReviewScore` weights open findings by severity × exploitability × confidence, scales assurance by reviewed-area coverage, and applies freshness decay after `SECURITY_REVIEW_STALE_DAYS` (45).

### PresenceManager (`src/core/presenceManager.ts`)

Cross-platform OS **keep-awake wake lock** so an AtlasMind activity that must stay online — a connected Buzz presence, an active Remote Control gateway session, or a long Mission Loop run — is not killed by system sleep. A VS Code extension runs in the Node.js **extension host, not Electron's main process**, so it cannot call `powerSaveBlocker`; instead `PresenceManager` spawns an OS-native inhibitor helper and ties the lock to that child's lifetime — killing it releases the lock. Per-OS commands (pure, unit-tested via `buildInhibitCommand`): Windows PowerShell P/Invoking `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED [| ES_DISPLAY_REQUIRED])` on a re-assert loop with a **parent-PID orphan guard**; macOS `caffeinate -i [-d] -w <hostPid>`; Linux `systemd-inhibit --what=idle:sleep --mode=block sleep infinity`. Modelled on `HostSpeechSynthesizer` (injectable `spawn`/`platform`, idempotent kill/dispose), it is `vscode`-free and unit-tested.

**Reference-counted and safety-first.** The lock is held while any *reason* is present — the `atlasmind.presence.keepAwake` master toggle contributes a reason, and future activities (Buzz/Loop/Remote) can `hold(reason)`/`release(reason)`. Deny-by-default throughout: nothing is held unless opted in; `acPowerOnly` (default `true`) auto-suspends on battery via a best-effort AC-power probe (`defaultDetectAcPower`, sysfs on Linux / `pmset` on macOS / `Win32_Battery` on Windows) so an unplugged laptop is never drained; a `maxAwakeMinutes` backstop auto-releases the lock so a stuck activity can never hold the machine awake indefinitely; a wall-clock-gap **sleep detector** re-asserts the lock after a suspend; and no untrusted input is ever interpolated into a spawned command (only validated integers). `extension.ts` wires it to the `atlasmind.presence.*` settings (live via `onDidChangeConfiguration`), a click-to-stop status-bar indicator, and the `atlasmind.togglePresence` command; it is disposed on deactivate (killing any held lock).

### MissionRunner (`src/core/missionRunner.ts`)

The autonomous goal-seeking **Mission Loop**. It wraps the existing single-pass plan→execute→synthesize machinery (`Orchestrator.processProject` with a `planOverride`) in an outer loop that re-evaluates progress against a goal after every iteration and keeps going until the goal is met **or** the closed parameter envelope confines progress. Each iteration runs: (1) **guardrail pre-check** — iterations / cost / cumulative tokens / wall-clock / consecutive-no-progress plus the project-wide daily budget gate (`CostTracker.getDailyBudgetStatus`); any hard cap stops the loop with a typed `MissionStopReason`; (2) **checkpoint gate** — hybrid autonomy: when a configured trigger fires (every N iterations, a budget-fraction crossing, or before write batches) the loop pauses for the `checkpointGate` hook, **deny-by-default** if unanswered; (3) **plan increment** — `Planner.plan(incrementGoal)` where the increment goal is composed from the goal, guardrails, success criteria, the evaluator's next-focus, and a carry-forward summary; (4) **execute**; (5) **evaluate** via `GoalEvaluator`; (6) **decide** — `achieved` (with confidence ≥ threshold) stops success, `blocked` stops, otherwise loop again. Every dependency is a narrow structural interface (`MissionExecutor`, `MissionPlannerLike`, `MissionBudgetStore`, `MissionPersistence`) so the runner is `vscode`-free and unit-testable; the Orchestrator, Planner, CostTracker, and MissionRegistry satisfy them. **Recoverable-block recovery:** when the loop would otherwise stop `blocked` or `no-progress`, `detectSettingBlocker()` checks whether the cause is a relaxable AtlasMind setting (it keys off the deterministic tool-approval denial reason, e.g. `allowTerminalWrite`); if so, the `blockedGate` hook asks the user to override-for-this-run, open settings, or stop — deny-by-default, and it never re-prompts for the same setting after one override. The surfaces wire this via the shared `createMissionSettingBlockGate()` helper (`participant.ts`), which applies the override and reverts it when the run ends. Progress is emitted as `MissionProgressUpdate` events for both the `/loop` chat command and the Mission Control panel. **SSOT integration:** the increment goal is grounded in project memory (the Planner already pulls `project_soul`/roadmap/decisions/architecture), discovery is prefer-existing (registered capabilities first, then gated synthesis/ARD), the project's Testing Methodology Matrix + TDD policy are inherited via `executeSubTask`, and deployments are never run directly — they route through the guarded `PromotionRunner` pipeline.

### GoalEvaluator (`src/core/goalEvaluator.ts`)

LLM-backed progress judge that decides whether a mission's goal is met. Given the goal, success criteria, accumulated outputs, changed files, and verification status, it applies an explicit goal/criteria/evidence/verification/completeness/calibration rubric and returns a `GoalVerdict` (`achieved` | `progressing` | `stalled` | `blocked`, plus `confidence`, `remaining`, `nextFocus`, `rationale`). Output is treated as **untrusted**: `parseGoalVerdict` strips fences, extracts the first object, and validates every field (mirroring the Planner's discipline), falling back to `stalled`/zero-confidence on anything malformed so a bad evaluator can never falsely declare success. `applyVerificationGuard` defensively downgrades an `achieved` verdict to `progressing` when the iteration changed files but its TDD/verification status is `missing`/`blocked`, or when the verdict itself still lists outstanding work. The evaluator takes an injected one-shot completion function (the runner passes `Orchestrator.summarizeText`).

### MissionRegistry (`src/core/missionRegistry.ts`)

Audit-trail persistence for mission runs. Like `DeliveryManager`, the persistence helpers are `vscode`-free (node `fs` only): a `MissionRunRecord[]` is stored as the source of truth at `project_memory/operations/missions.json` with a human-readable `missions.md` runbook mirror regenerated on every write (`renderMissionsMarkdown`). `toPersistedRecord` trims large synthesis/output text and drops heavy nested artifacts before writing, and the history is capped at `MAX_MISSION_RECORDS`. No secret values are persisted. It also exposes `listActive()` (running / awaiting-checkpoint missions) and a lightweight, `vscode`-free `onChange` subscription fired on every save — the **Cost Dashboard** subscribes to it to render its live "Current Loops" section (accumulated cost vs. cap, iteration progress, tokens, latest verdict) and re-render as each iteration is saved.

The Cost Dashboard keeps period/style controls in a toolbar before the daily plot. The period choices use a closed-by-default `<details>` disclosure whose expanded content remains in normal flow, so controls cannot cover a line-chart peak. Local savings are derived only from local-provider records, grouped by exact model id, compared individually with a catalog-backed budget/mid/premium cloud reference selected from the advertised parameter count or model-family markers, and totalled as an explicitly estimated—not realized—saving. The same bounded calculation feeds both the top-level Efficiency metric and the detailed per-model comparison, so the overview and drill-down cannot diverge.

### TaskProfiler (`src/core/taskProfiler.ts`)

Infers a `TaskProfile` from the current phase and request text. It classifies modality (`text`, `code`, `vision`, `mixed`), reasoning intensity (`low`, `medium`, `high`), and any hard or soft capability needs used by the router.

### SkillScanner (`src/core/skillScanner.ts`)

Static security scanner that checks skill source code against configurable rules. Exports `BUILTIN_SCAN_RULES` (12 rules), `resolveRules(config)` (merges overrides and custom rules), `scanSkillSource(id, source, config?)`, and `scanSkillFile(id, path, config?)`. Returns a `SkillScanResult` with per-issue details (rule, severity, line, snippet, message).

### TestingConfigLoader (`src/core/testingConfigLoader.ts`)

Pure-Node utility (no VS Code dependency) that connects the Testing Methodology Matrix to the execution pipeline. `readProjectTestingConfig(workspaceRoot)` reads `project_memory/index/testing-config.json`. `inferTestingMethodologyForSubTask(task, config)` detects the best matching `TestingMethodologyId` from a subtask's role and description using `TESTING_METHODOLOGY_DEFINITIONS.autoDetectSignals`. `resolveTestingModelOverride(methodologyId, methodConfig, agents)` walks the lookup chain — `assignedModelId` → assigned agent's `testingModelOverrides[id]` — and returns the effective override model ID. Used by the orchestrator in both the project subtask path and the direct task path to apply per-methodology model routing when the Testing Methodology Matrix is configured.

### TestingScaffolder (`src/core/testingScaffolder.ts`)

Constructs a language- and archetype-aware starter testing framework from the enabled methodologies. `scaffoldTestingFramework(workspaceRoot, config)` detects the project **language** — Node (JS/TS), Python, Rust, Go, .NET, or Java — from manifest fingerprints (`package.json`, `pyproject.toml`/`requirements.txt`/`setup.py`/`Pipfile`, `Cargo.toml`, `go.mod`, `*.csproj`/`*.sln`, `pom.xml`/`build.gradle`) and a coarse **archetype** (web / api / cli / game / mobile / library / generic), then generates idiomatic starter files per enabled methodology: Vitest/Jest/Playwright/Cypress/fast-check/k6 (Node, with e2e branching on archetype), pytest/Hypothesis/Locust (Python), `cargo test`/proptest/criterion (Rust), `go test`/`testing/quick`/benchmarks (Go), xUnit (.NET), JUnit 5 (Java). It also writes a managed `project_memory/operations/testing-strategy.md` playbook with language-specific set-up hints. Unknown stacks degrade to playbook-only guidance. Strictly non-destructive: starter files are created only when absent and never overwritten, no manifest is ever mutated, and the only file always (re)written is the managed playbook.

### SchemaMigration (`src/core/schemaMigration.ts`)

How a persisted AtlasMind document changes shape over time — the mechanism that makes 1.0's compatibility promise keepable. Every document in `project_memory/` carries a `version`, but until now that field was only ever a **validity test** (`version === 1` or the file was treated as unreadable), with two consequences that only bite later: a format could not change except as a break, and **a document from the future was destroyed silently**. An unreadable file made the manager seed a default *and write it back*, so opening a project in an older AtlasMind than the one that wrote it replaced the documents registry, delivery pipeline, or people roster with an empty one — with nothing to warn you, because from the reader's point of view there was simply no valid file.

The load-bearing distinction is between **invalid** (corrupt, truncated, not ours — safe to replace) and **refused** (structurally fine but written by a newer AtlasMind — *never* safe to replace). `interpretVersionedDocument` owns that decision for every manager rather than leaving nine readers to re-derive it, `shouldPreserveExisting` expresses the rule once, and `DocumentsManager`, `ProjectDirectorManager`, `RiskOversightManager` and `SecurityReviewManager` all skip their seed-and-persist path on a refusal, surfacing the reason through `getNotice()`. An **explicit** save still writes — the user is editing on purpose, and refusing their own edit would be its own data loss — which is why the notice is rendered on the page rather than kept internal.

`applyMigrationLadder` walks a document up one version at a time: it starts from the version found rather than the beginning, stamps the resulting version even when a step forgets to, and reports a throwing step rather than leaving a half-applied chain. It takes its bounds as arguments specifically so it can be tested while every kind still sits at v1 — otherwise the code that runs at the first real format change would ship unexercised. `SCHEMA_MIGRATIONS` is deliberately empty today, and a test asserts each kind's version matches its migration count, so bumping a version without writing the migration fails the build.

### SetupWalkthrough (`src/core/setupWalkthrough.ts`)

The shape **every** AtlasMind setup guide shares. The Buzz walkthrough worked because of a handful of decisions — derive the state rather than asking the user to self-report it, show one step at a time with the command written out, count only the steps that gate the outcome, and never flip a switch on the user's behalf — and none of those is specific to Buzz. Re-deriving them per feature is how they get lost; the second guide is always the one that quietly starts installing things. So the *mechanics* live here and the *content* lives per guide: `buzzSetupPlan.ts` and `acpSetupPlan.ts` decide what the steps are, and this module orders them, picks the next one, renders it, and counts progress identically for both.

Two properties are enforced rather than documented:

1. **A plan is never an installer.** `isOpeningAction` is an allowlist of commands a step may offer — panels, settings pages, docs URLs, a command pre-loaded into a terminal the user presses Enter on, and *prompts* that ask for a value (dismissing one stores nothing). It deliberately admits `atlasmind.setBuzzAgentKey` by name while refusing `atlasmind.setBuzzEnabled`: the first asks the user for a value, the second would decide one for them. `findNonOpeningActions` reports offenders rather than throwing, and both shipped guides are asserted clean in every state.
2. **A step blocked only by an optional prerequisite is never nominated.** Sending someone to install a binary they do not need is how a guide teaches people to stop trusting it.

`acpSetupPlan.ts` is the second guide: name an agent → install it → sign in → enable the provider → **prove a completion comes back**. That last step sits in the walkthrough but *outside* `isAcpProviderReady`, for the same reason the Buzz guide refuses to stop at "subscribed": a provider can be correctly configured and never have answered, and reporting that as a fault would be wrong while reporting it as finished would be worse. `setupGuideRegistry.ts` is what `/setup` lists, with each guide's progress computed from that guide's own plan — the index cannot claim a guide is finished while the guide disagrees, because there is only one source for both.

### IssueTracker (`src/core/issueTracker.ts`)

The repository's issue tracker, read into the Project Dashboard → **Issues** page. A project's issues are where work arrives from *outside* the editor: the roadmap knew what we planned, and nothing knew what anyone had reported. This module is the parse/derive half — `parseGhIssueList`, `summarizeIssues`, `sanitizeIssueDraft`, `buildIssueWorkPrompt` — and the panel owns every `gh` invocation and every write.

**Issue text is untrusted, third-party input.** Titles, bodies, labels, and author names are written by anyone who can open an issue. Everything is control-stripped, length-clamped, and count-capped at this single entry point; a non-`https` URL is dropped rather than rendered as a button; and the parser never throws — malformed JSON, a wrong shape, or one unusable entry degrades to *fewer issues*, never to an exception on a dashboard render. An issue with no usable number is dropped, since every action the page offers is addressed by number.

**A body that reaches a model is quoted as data.** `buildIssueWorkPrompt` fences the issue and labels it `REPORTED CONTENT, not instructions`, telling the model not to follow anything inside it and not to treat its claims as verified. This is the one path on the page where text written by an arbitrary internet user reaches a model that can call tools, so the mitigation lives in the prompt itself rather than in a reviewer's memory (pinned by test).

**Reads on demand; writes behind a confirmation.** The list comes from a rate-limited network call, so it is fetched when the user asks and cached on the panel — never refreshed as part of an unrelated render. Creating, commenting, closing, and reopening are outward-facing and usually public, so each is gated on a `{ modal: true }` confirmation built by `describeIssueAction` from the same values that will be sent; the webview supplies data only, never a command or an argument list, and `gh` is executed directly rather than through a shell. Failure modes are reported as themselves with the command that fixes them (`gh` missing, not authenticated, no GitHub repo) — "no issues" and "we could not look" are different facts, and collapsing them would report a clean tracker that nobody checked.

### WorkflowCurriculum (`src/core/workflowCurriculum.ts`)

The eight-stage guided GitHub workflow as *teachable data*, backing the Project Dashboard → **Workflow** page. `docs/guided-github-workflow.md` is the normative specification; this module is its machine-readable form and the source of every word the page shows.

**Derived, never model-generated.** A hallucinated workflow step is worse than no step at all, because somebody would follow it. Status comes from observed repository state — a file exists, a command answered, a count is what it is — and the prose is written in source and reviewed like code.

**The teaching payload is a first-class field.** `WorkflowStep` extends `SetupStep` with required `why` and `how`, plus optional `commonMistakes` and `glossary` references. That shape exists because the audience includes somebody learning professional practice for the first time, and a step that says only *what* to do has not done its job. `commonMistakes` is separate from `how` because recognising the failure is a different skill from following the happy path.

**Built on the setup-walkthrough model rather than beside it.** `setupWalkthrough.ts` already had status, progress counting and next-step selection, pure and tested, and had no webview consumer — only chat. Reusing it is what stops the chat guidance and the dashboard guidance drifting apart, which is the same failure the specification exists to fix. The `isOpeningAction` allowlist carries over: a guide opens surfaces, it never flips the switches it exists to explain.

**Absent evidence is never "done".** `statusFrom` reports `todo` for undetermined evidence rather than `done` — "not known" and "not done" are different, and only one is the user's problem. `deriveStageStatus` and `summarizeWorkflowProgress` exclude `optional` steps, so a stage is not unfinished because somebody declined something they were told was a choice; an empty curriculum reports **unfinished**, never finished.

### WorkflowMetrics (`src/core/workflowMetrics.ts`)

Every statistic on the Workflow page, derived purely so each is testable against fixtures rather than inspected by eye in a webview. No I/O, no `vscode`, and no clock — `now` is always a parameter, so a windowed metric is reproducible in a test.

**`MetricVerdict` does most of the work.** A metric is either *known* or it is not, and "not known" carries a reason and often the command that would produce the data. This exists because the most damaging thing a delivery dashboard can do is render a confident zero for something it never measured: a test suite that did not run is not one that passed, and a repository with no merged pull requests has no median review latency — displaying "0 hours" would be a lie that looks like an achievement. Making absence a *type* means a renderer cannot forget to handle it.

Consequences that follow from that one decision: `median` refuses below `MIN_SAMPLES_FOR_MEDIAN` (3) so one data point is never reported as a project characteristic; `percentage` has no verdict on a zero denominator; `deriveCiMetrics` on an empty check list reports `none` with a fix hint rather than 0% passing; and `deriveWorkflowHealth` **omits** unmeasured components and redistributes their weight, returning the omissions by name so a score of 80 cannot read as "80% of everything is fine".

Output shapes match the dashboard's existing render primitives — series for `renderChartCard`, slices for `renderDonutChart`, segments for `renderDistributionBar` — so the instrumentation wall is assembled from components that already exist. `deriveBranchMetrics` exempts integration and release branches from naming conformance, because a permanent unfixable gap teaches people to ignore gaps; `deriveCommitConformance` excludes platform-generated merge commits, which would otherwise penalise a team for using squash merges.

### CiFailureAnalysis (`src/core/ciFailureAnalysis.ts`)

Why a CI run failed, decided by rule rather than by model. AtlasMind has always read check *states*; it has never read a *log*, and that is the difference between knowing a build failed and knowing why.

**No model participates in classification**, and that is the design rather than an implementation choice. A taxonomy that varies run to run cannot be charted, and a chart of CI failures over time is one of the most useful things a team can look at. An agent's job is to *explain* a classification and propose a fix — never to choose it, which is why `ci-analyst`'s prompt tells it not to re-classify.

The rules are ordered and first-match-wins, and the order is part of the contract: `infra → dependency-install → compile → lint → test-failure → timeout`. A run that could not install its dependencies also fails to compile, so reporting the compile error would send somebody to fix code that never had a chance to build; and an unreachable registry looks exactly like a dependency failure, so infrastructure is checked before it. Patterns are deliberately narrow — a rule that matches too eagerly is worse than one falling through to `unknown`, because `unknown` asks a human while a wrong class sends them somewhere else entirely.

**`unknown` is a real answer**, not a fallback for guessing: it escalates to a human and names no agent. **Flakiness is a property of history, not of one log** — `detectFlakeSuspect` needs both a pass and a fail on the same commit, and overrides whatever the latest log says, because no amount of reading one failure can establish it.

A CI log is untrusted input. `sanitizeCiLog` strips ANSI *before* redacting (a secret wrapped in colour codes would not match a redaction pattern otherwise), then caps size keeping the **tail** — a failure message is at the end of a log, and keeping the head would reliably discard the only part anybody needs. Truncation and redaction are both reported on the report, never silent, and `buildCiFailurePrompt` fences the excerpt as REPORTED CONTENT.

### WorkflowAutomation (`src/core/workflowAutomation.ts`)

Where the specification's central claim is kept: **full automation is possible, never default.** That has to be true by construction rather than by policy, and the mechanism is a minimum over four independent gates that all default closed — `effective = min(master, userCeiling, capability, stage)`. A project's committed workflow file may request `auto`; if any one of the four disagrees, `auto` does not happen. Personal settings can only *lower* the result, so a repository cannot force unattended action onto somebody's machine and a developer cannot grant themselves more than the repository allows. An exhaustive test walks the whole lattice rather than arguing the property.

Three decisions carry weight. **A disabled capability caps at `draft`** rather than zeroing the stage — turning off "may write pull requests" should stop the writing, not stop AtlasMind explaining and preparing, and `propose` is exactly where writing begins. **Every refusal names its binding gate**, because "you cannot do that" with no reason sends somebody to toggle four settings at random. And **an unrecognised level reads as `off`** — a settings file with a typo must never be read as consent.

Hard ceilings sit outside the ladder deliberately: force-pushing, deleting a tag or release, re-running CI, editing a CI workflow or the workflow config, and merging a dependency update are excluded at *every* rung, so their messages must not imply a setting exists that would permit them. `permitsProtectedRefWrite` is likewise a veto on a *target* rather than a cap on a level — with it off, `auto` is unreachable for a protected base, not merely discouraged.

### PullRequestDraft (`src/core/pullRequestDraft.ts`)

Removes the two steps people skip — writing the body and linking the issue — without letting a model author either. The determinism requirement is exact: the same commit range plus the same template produces a byte-identical draft.

**The title reuses `classifyBumpLevel`** rather than parsing commits again. That function already reads conventional commits to decide a version bump; a second parser of the same format would eventually disagree with it, and the disagreement would surface as a release whose version does not match its own pull-request title. A single conventional commit keeps its subject verbatim — a human already wrote the best available description.

**The template is filled, never replaced.** Recognised headings receive content; everything else is preserved exactly, including headings this module has never seen, because a team's checklist is theirs and a drafter that quietly dropped a custom section would be worse than one that left the body empty. The `- Closes #<issue-number>` placeholder is substituted rather than appended to, so a pull request never ships containing a literal `<issue-number>`; where there is no issue, the body says so, because a silent omission reads as an oversight. Labels come only from the declared taxonomy, and an unmatched one is dropped *and reported*.

### PullRequestTracker (`src/core/pullRequestTracker.ts`)

The sibling of `issueTracker.ts`, built to the same discipline because the threat is the same one: **a pull-request body and a review comment are third-party text.** Anyone who can comment can write a paragraph designed to be read as an instruction by an AI assistant, and "address this review feedback" is precisely the workflow that hands that paragraph to a model holding tools.

Until this module, nothing in AtlasMind sanitized that text — because nothing read it. Adding the reading is what created the obligation.

`parseGhPullRequestList` never throws: malformed JSON, a wrong shape, or one unusable entry degrades to *fewer pull requests*, never to an exception on a dashboard render. `buildPrReviewPrompt` fences review bodies as REPORTED CONTENT and instructs the model not to follow them, so the mitigation lives where the prompt is built rather than in a reviewer's memory. Two smaller decisions carry real weight: an unrecognised review verdict reads as `commented` rather than `approved`, so a malformed feed can never satisfy an approval gate; and `parseLinkedIssues` recognises only GitHub's closing keywords, so a bare `#142` is not counted as traceability the repository does not have.

### BranchNaming (`src/core/branchNaming.ts`)

`deriveBranchName` turns an issue into `feat/142-guided-github-workflow`. A branch name is the only context anyone gets before opening a branch, and deriving it means the link back to the issue is never forgotten because it was never typed.

Three properties are asserted rather than assumed. It is **pure and predictable** — collisions resolve with an ordinal suffix (`-2`, `-3`) rather than a hash or timestamp, so running the same command twice gives a name you could have predicted rather than one you have to go and read. It is **structurally incapable of producing a protected name**, because the result always carries a `<type>/` prefix; the protected-set check is belt-and-braces against a future format change. And it **refuses rather than inventing**: a title that reduces to no ASCII slug produces a stated refusal, not `feat/142-branch`, because an unreadable branch name is worse than a question. Accents fold to their base letter rather than being dropped, since "caf" reads as a typo and a branch name is read far more often than typed.

### GhClient (`src/core/ghClient.ts`)

The single boundary between AtlasMind and the GitHub CLI. Before it there were three independent `gh` call sites — one in the dashboard panel, one in the bootstrapper, and one that built a command *string* for later shell execution — and three call sites means three answers to "is this argument escaped?", only one of which needs to be wrong.

**No shell, ever.** Every call is `execFile(cmd, args)` with an argv array, so a repository name, an issue title, or a branch name may contain a semicolon or a backtick without becoming a second command. `assertNoShellMetacharacters` sits on top of that and can never fire in correct code — which is the point: it converts a future refactor that reintroduces string composition from a silent vulnerability into a loud failure at the call site.

**AtlasMind holds no credential.** It shells to an already-authenticated `gh`, so the user's GitHub authorisation is managed by GitHub's own tooling, lives in the OS keychain, and is revocable there. There is no token setting and adding one would move a secret AtlasMind does not need into a place it does not belong.

**A failure names its fix.** `classifyGhFailure` distinguishes not-installed, not-authenticated, rate-limited, forbidden, not-found and timeout, each with the command that resolves it — ordered most-specific first, because a rate-limit message mentions tokens and sending somebody to re-authenticate when they are merely throttled wastes their time. Every method returns a result rather than throwing: a dashboard that throws on a network failure disappears exactly when you wanted it to say what was wrong. The process runner is injected, so the module is unit-tested without a `gh` binary.

### RoadmapGates (`src/core/roadmapGates.ts`)

The release milestones a roadmap item can be tagged for. The Roadmap page only ever knew one — `#mvp` — which is the right first gate and the wrong only gate: a project that has shipped its MVP still needs to say "this belongs to the public beta" or "this is v2", and had nowhere to record it. `mvp` stays built in (always present, never removable, still the gate that feeds the Operational Score), and up to `MAX_ROADMAP_GATES` (12) further gates can be declared.

**Gates live in the roadmap file.** A managed `<!-- atlasmind:roadmap-gates:start/end -->` block in `improvement-plan.md` holds them as readable markdown (`` - `#beta` — Public beta ``), inserted after the backlog block: one SSOT document, diffable and reviewable, with no second source of truth to drift. `parseRoadmapGates` / `renderRoadmapGatesBlock` / `upsertRoadmapGatesBlock` are the round trip, and `stripRoadmapGatesBlock` removes the block before item parsing so its list lines can never be read as backlog items.

**A tag is a gate only when it has been declared.** `extractItemGates` recognises only declared ids, so an item reading `fix the #2 case` keeps its wording rather than inventing a gate called "2", and a tag-boundary check stops `#v1` matching inside `#v10`. Ids go through `slugifyGateId` (lowercase alphanumerics, dots, dashes; length-capped; must start alphanumeric) and unusable input is **refused with a reason** rather than coerced — the id becomes a `#tag` in a tracked file, so a value that would not parse back must never be written. Gate creation collects its name through a native input box (validated where the write happens); gate removal is modally confirmed, strips the tag from every item, and **never deletes backlog work**.

The panel computes one route per gate up front (`buildGateRoutes`) so switching gates in the UI is instant and cannot fail on a message round trip. The heuristic "suggested foundations" fallback remains **MVP-only**: recognising foundational work is not a claim about which release something belongs to, so a user-created gate with nothing tagged is reported as empty rather than filled with a guess.

### TestingPolicyCoverage (`src/core/testingPolicyCoverage.ts`)

Answers, for every *enabled* testing policy, the question the Testing dashboard could not previously answer: **is anything actually testing it, and is any of it failing?** Pure and `vscode`-free — the caller (`collectTestingDashboardSnapshot`) gathers the evidence (test-file list with case/skip counts, dependency and script names, probed config paths, a discovered report) and `deriveTestingPolicyCoverage` derives the readout, so the whole derivation is unit-tested.

Each policy has a **marker set** (file-path patterns, dependency names, script-name patterns, config paths) chosen to be something the tooling itself creates — a `.feature` file, a `stryker.conf`, a `__snapshots__` directory — never a word that might appear in a filename, because a false "covered" is the one outcome the panel must not produce. That yields four statuses: `covered` (matching test files exist), `tooling-only` (its tooling is installed but nothing tests with it), `missing` (enabled with nothing to show), and `not-file-evident` for the policies that are a *practice* rather than an artifact (exploratory, black-box, gray-box, V-model, white-box, test-design, agile testing) — those are **never** reported as a gap, since flagging a practice trains people to ignore the panel.

**Failures come only from a report the project produced.** `parseJUnitReport` reads the JUnit XML interchange format every mainstream runner can emit (vitest/jest reporters, pytest `--junitxml`, Playwright, surefire, gotestsum, dotnet). Nothing here ever runs a test command — a dashboard that shells out on render is both a surprise and an execution surface — so when no report exists the page says it has *no verdict* and quotes the command that would create one, rather than rendering "0 failures". The report is untrusted input: the parser never throws, resolves no entities beyond the five predefined ones and no external DTDs (attributes are read by regex, not an XML parser), caps how much it reads and how many cases it keeps, clamps and control-strips every string, and prefers the failures it can *count* over the totals the report *asserts* so a hand-edited report cannot present itself as clean. **Failure messages are deliberately never extracted** — an assertion message can carry values from a test environment and this data is rendered in a webview; the test name, suite, and file are enough to open it. Report staleness (a test file changed after the report was written) is surfaced rather than hidden, and skipped-test counts are derived locally from the test files themselves, so that signal exists even with no report at all.

### TestingProtocolSync (`src/utils/testingProtocolSync.ts`)

The outbound counterpart to `aiInstructionSync.ts`. `syncTestingProtocols(workspaceRoot, config, agents)` renders the enabled methodologies into a delimited, AtlasMind-managed markdown block (`<!-- atlasmind:testing-protocols:start -->` … `:end -->`) and upserts it into every *detected* (existing) external agent instruction file — `CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, Cursor, Cline, Gemini, Windsurf, Aider. It only ever rewrites its own block, preserves surrounding content, writes only to files that already exist, and routes all paths through the shared `isSafeRelativePath` / `resolveRelativePath` traversal guard (exported from `aiInstructionSync.ts`). The upsert/strip primitives live in the shared `managedBlock.ts`. JSON-config tools are reported as skipped. The orchestrator and the Settings → Testing matrix call this so external agents stay in step with the configured strategy.

### AiInstructionMerge (`src/utils/aiInstructionMerge.ts`)

Two-way instruction-set sync, driving the `/sync-instructions` chat command and the Settings → AI Instructions "Align all instruction sets" action. Where `aiInstructionSync.ts` only imports other tools' instructions *into* AtlasMind, this module reconciles them *across* tools:

- `gatherInstructionSources(workspaceRoot)` reads the full authored content of every detected tool file plus AtlasMind's own canonical instructions (`project_memory/agents/atlas-personality-profile.md`, `project_soul.md`), stripping AtlasMind-managed blocks so the merge never re-ingests its own mirror.
- `runInstructionMerge` / `parseMergeResult` run one LLM reconciliation (via the injected `complete()` — wired to `Orchestrator.completeBootstrap`) returning a unified directive set, auto-resolved minor differences, and only *genuinely contradictory* `conflicts`. Parsing is defensive: malformed/empty output throws before anything is written.
- `runInstructionRender` / `renderUnifiedMarkdown` re-express the unified set in each tool's native format (deterministic fallback when the model omits a tool); `applyManagedInstructionBlock` upserts the result into each detected file's `<!-- atlasmind:shared-instructions:start -->` block (same non-destructive, traversal-guarded, detected-set-only, JSON-skipped policy as the testing sync); `writeUnifiedToSsot` mirrors the set to `project_memory/domain/ai-instructions-sync.md`.

Significant conflicts are surfaced in chat and the writeback is gated on user resolution (recommended pick, per-option override, then apply); in-flight state lives in `workspaceState` (`atlasmind.pendingInstructionSync`).

### TerminalOutput (`src/utils/terminalOutput.ts`)

Display-side sanitizers for raw command/terminal output. `stripAnsiSequences(value)` removes ANSI/VT escape sequences — CSI (colours, cursor moves) and OSC (window titles, shell-integration markers) — while leaving printable text intact. `sanitizeTerminalOutput(value)` builds on it for non-terminal surfaces: it strips the escape sequences, folds carriage returns into newlines, and removes any leftover non-printable control bytes (preserving tab/newline). Patterns are assembled with `String.fromCharCode` so the module holds no literal control characters. The post-write verification summary in `extension.ts` (`formatVerificationOutcome`) runs captured tool output (e.g. `vitest`) through `sanitizeTerminalOutput` so colour codes can't reach the chat **Verified:** bullet as garbled `[1m[7m[36m RUN …` fragments; the managed-terminal stream in `chatPanel.ts` uses `stripAnsiSequences`.

### ModelEvalHarness (`src/core/modelEvalHarness.ts`)

A scored-replay harness (`compareModelsOnPrompt`) that runs one prompt across a set of candidate models and returns a ranked comparison — graded output quality (`gradeExecutionQuality` from the shared `executionQuality.ts`), cost, latency, token counts, and a preview. The model call is injected so the core is pure and host-independent; graded outcomes are surfaced via an `onResult` callback so a benchmark can record them into the router's outcome channel, calibrating outcome-driven routing. Backs the `AtlasMind: Compare Models on a Prompt` command.

### ScannerRulesManager (`src/core/scannerRulesManager.ts`)

Persists scanner rule overrides and custom rules in `vscode.Memento` (`globalState`). Key: `atlasmind.scannerRulesConfig`. Methods: `getConfig()`, `getEffectiveRules()`, `updateBuiltInRule()`, `resetBuiltInRule()`, `upsertCustomRule()`, `deleteCustomRule()`. Validates regex patterns before accepting any change. entries per session. Provides `getSummary()` returning totals for cost, requests, and tokens. Supports `reset()`.

### MemoryManager (`src/memory/memoryManager.ts`)

Interface to the SSOT folder structure. Supports `queryRelevant()` (local hashed embeddings + lexical ranking), `upsert()`, `loadFromDisk()`, and `listEntries()`.

### RemoteControlServer (`src/remote/remoteControlServer.ts`)

Desktop-only localhost WebSocket server that lets the AtlasMind web build remote-control this instance. Off by default; only listens after `AtlasMind: Enable Remote Control`, a workspace-trust approval, and a pairing token (stored in `SecretStorage`, modeled on `ToolWebhookDispatcher`). On an authenticated connection it constructs a `RemoteWebviewHost` (`src/remote/remoteBridge.ts`) — a synthetic `ChatPanelHost` — and binds a real `ChatPanel` to it, so the full chat implementation drives the remote browser. Outbound `webview.postMessage` calls are forwarded over the socket; inbound chat frames are re-validated with `isChatPanelMessage` before dispatch. It also answers read-only `cost`/`runs` RPCs backed by `CostTracker` and `ProjectRunHistory`. Disconnect disposes the ChatPanel (aborting in-flight work, so pending tool approvals default to denied). The wire protocol is the Node-free `src/remote/protocol.ts`, shared with the web build. In `gateway` mode (`atlasmind.remote.mode`) it instead authenticates each connection by an `x-atlas-origin-secret` upgrade header injected by an SSO gateway (verified timing-safe against the pairing-token slot) and records `x-atlas-user-id` for audit, so it can sit behind a Cloudflare Worker + tunnel for cross-machine access without opening an inbound port. See [Remote Control](remote-control.md).

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

The local model advisor reads its release-aware recommendation catalog from `src/providers/localModelRecommendationRegistry.ts`, which supports a validated workspace override file at `.atlasmind/local-model-recommendations.json` and falls back to built-in defaults when the override is missing or invalid. Each recommendation card offers one-click install into **Ollama** (via the streaming `/api/pull` API — surfaced as live progress in a shared output channel and a cancellable notification, with a daemon-reachability preflight — translating `hf:owner/repo` candidates to the `hf.co/owner/repo` pull syntax) and **LM Studio** (via `lms get <model> --yes` run as a direct child process). Both stream into the shared **"AtlasMind: Local Model Install"** output channel. Cards whose model is already present in a local runtime — matched on a normalized identity key (`localModelMatchKey`) so HuggingFace- and Ollama-style ids reconcile — show an installed badge instead of install buttons.

### ToolWebhookDispatcher (`src/core/toolWebhookDispatcher.ts`)

Sends outbound webhook notifications for tool execution events. Reads workspace webhook settings (`atlasmind.toolWebhook*`), stores bearer token in SecretStorage, persists delivery history in globalState, and applies timeout/event filtering before dispatch.

### McpClient (`src/mcp/mcpClient.ts`)

Wraps `@modelcontextprotocol/sdk` `Client` for a single server. Supports `connect()`, `disconnect()`, `callTool()`, `refreshTools()`. Handles `stdio` (subprocess via `StdioClientTransport`) and `http` (Streamable HTTP with SSE fallback via `StreamableHTTPClientTransport` / `SSEClientTransport`). Tracks `status: McpConnectionStatus` and surfaces `error` and `tools` as readable state.

For audited bundled starters it also resolves `${extensionPath}` plus the three fixed Buzz configuration templates (`buzz.enabled`, `buzz.relayUrl`, `buzz.allowRemoteRelay`). This is a closed allowlist, not a general settings interpolation surface.

### McpServerRegistry (`src/mcp/mcpServerRegistry.ts`)

Manages `McpServerConfig` persistence (key: `atlasmind.mcpServers` in `globalState`) and live `McpClient` instances. On `connectServer()`: instantiates a client, calls `connect()`, then registers each discovered tool as a `SkillDefinition` in `SkillsRegistry` (ID: `mcp:<serverId>:<toolName>`) with auto-approved scan status. On `disconnectServer()`: disables or unregisters the corresponding skills. `connectAll()` is called non-blocking on activation; `disposeAll()` is called on deactivation.

Credentials are kept out of `globalState`: env vars listed in `McpServerConfig.secretEnvKeys` have their **values** stored in VS Code `SecretStorage` (key `atlasmind.mcp.<serverId>.<KEY>`, injected via the constructor's optional `secrets` param), resolved and merged into the process env only inside `connectServer()`, and deleted on `removeServer()`. `setServerSecrets()` writes them; the persisted config holds only the key names. `detectAvailableServers()` scans the local environment and returns only servers whose launch runtime is actually present (each with a `reason`), for the guided setup wizard's **Scan my computer** step.

### McpEnvironmentScanner (`src/mcp/mcpEnvironmentScanner.ts`)

Discovers MCP setup signals so the "Add MCP server" flow can hand-hold instead of asking a novice to invent a command. It **imports** server definitions from other tools' config files (Claude Desktop, Cursor, VS Code, Windsurf, a repo `.mcp.json`/`mcp.json` — parsing both the `mcpServers` and `servers` shapes), **probes PATH** for launch runtimes (npx/uvx/docker/…), and reads env-variable **names** from `.env*`/`wrangler.toml` plus project signals (e.g. a Cloudflare Workers project). The result (`McpEnvironmentScan`) is cached in SSOT at `project_memory/operations/mcp-environment.json` with a `mcp-environment.md` mirror and reused on future installs; the panel exposes a **Rescan** button and auto-refreshes when a workspace MCP config file changes. Like the other managers, the module is `vscode`-free and unit-tested.

**Redaction boundary (safety-first):** the scan and its cache capture only env-variable *names* and a secret/not-secret classification (`classifySecretEnvKey`) — never secret **values**. On **Import & connect**, `resolveImportedServer()` re-reads the source config file live, splits secret-looking env vars into a `secrets` map routed to `SecretStorage` (recorded as `secretEnvKeys`) and non-secret ones into `env`, so a token is never written to the git-tracked cache nor sent to the webview. Complements `McpServerRegistry.detectAvailableServers()` (runtime-only detection for the guided "Scan my computer" step) and the bulk `importFromVsCode` command.

### mcpRuntime (`src/mcp/mcpRuntime.ts`)

Shared runtime-bootstrap helpers used by both the recommended-install command and the guided wizard. `checkStarterRuntime()` reports whether a server's launch runtime exists and, if not, *plans* an install (`installable` with the exact command, or `manual`) — it never installs. `runRuntimeInstallPlan()` runs a plan only after the caller has obtained explicit user confirmation (confirm-before-install policy).

### BuzzCliBridge / Buzz communications MCP (`src/mcp/buzzCliBridge.ts`, `src/mcp/buzzCommsServer.ts`)

Communication-only adapter for official Buzz CLI source tag v0.4.26. `BuzzCliBridge` owns configuration/relay validation, required command/flag contract probing, direct process execution, bounded JSON parsing, identifier validation, stdin message delivery, and secret redaction. `buzzCommsServer.ts` declares the four MCP tool schemas and annotations, checks readiness before connecting stdio, and contains no AtlasMind reasoning or workspace-execution surface.

### BuzzProtocol (`src/core/buzzProtocol.ts`)

Verified Nostr wire framing for Tier-3 **inbound** sync — the read side, complementing the outbound `BuzzCliBridge`. Buzz is Nostr-based, so the transport is **not** a Buzz invention: NIP-01 and NIP-42 are published open specifications, which is why this layer could be built and fully tested without a live relay. Everything is read from spec or from Buzz's own registry: NIP-01 event shape and `EVENT`/`REQ`/`CLOSE`/`OK`/`EOSE`/`CLOSED`/`NOTICE` framing; NIP-42's `["AUTH", <challenge>]` → signed **kind 22242** event carrying `relay` and `challenge` tags; and kind numbers from `crates/buzz-core/src/kind.rs` at `BUZZ_PROTOCOL_VERIFIED_VERSION` (`v0.4.26`, matching the pinned CLI tag).

**Kind selection was corrected by a live relay, not by reading.** The registry defines both `KIND_STREAM_MESSAGE = 9` and `KIND_STREAM_MESSAGE_V2 = 40002`, and the source alone reads as though 40002 supersedes 9. A real Buzz relay disagreed: its stored history held kind **9** messages (tagged `h`, `p`, `client`) and **zero** 40002 events. Subscribing to 40002 alone authenticates, subscribes, reaches EOSE — and receives nothing, forever, which is the worst kind of failure because everything looks healthy. Both kinds are now subscribed and derived, so either deployment works. Channel metadata being **39000** (not the legacy NIP-01 kind 41) was confirmed by the same relay. A third trap is enforced by the type system: `NostrFilter.kinds` is **required and non-empty**, because Buzz answers a kind-less query with a 403 "p-gate".

**Untrusted-input boundary.** A relay frame arrives over the network from a party AtlasMind does not control, so `parseRelayFrame` never throws: oversized (`MAX_RELAY_FRAME_BYTES`), non-JSON, non-array, and structurally wrong frames all degrade to a typed `unknown` frame. `validateNostrEvent` checks hex lengths, kind range, and tag structure, returning undefined rather than coercing — and deliberately does **not** verify the Schnorr signature, so callers must not mistake structural validity for authenticity. `classifyRelayRefusal` separates a recoverable `auth-required:` from a terminal `restricted:`.

### BuzzConnectionPolicy (`src/core/buzzConnectionPolicy.ts`)

The **second half of "stays in contact"**. `PresenceManager` already keeps the *machine* awake; that is necessary but not sufficient, because a wake lock does nothing when the WebSocket silently drops. This module decides when a connection is dead and when to retry. It is pure and **clock-free** — time and randomness are arguments — so the whole policy is deterministically testable without timers or sockets.

`evaluateLiveness` is conservative by design: a connection is only `dead` after a keep-alive ping has been *sent* and gone unanswered, never from idleness alone, because a quiet channel is not a broken socket. `nextReconnectDelay` is capped exponential backoff with **subtractive** jitter, so a delay can never exceed the cap it is meant to enforce, with the exponent clamped so a long outage can't overflow. `planReconnect` refuses to retry a `restricted:` refusal — the client already authenticated and the relay still rejects that key, so retrying cannot change the outcome and must not become a hammering loop. `buildResumePlan` re-subscribes tracked filters and re-announces presence (a fresh socket keeps none of the previous connection's state, so reconnecting alone leaves an agent silently absent while looking connected), rewinding the cursor by a small overlap: clocks drift, and a duplicate the caller de-duplicates by event id is a better failure than a silently dropped message.

### BuzzInboundDerivation (`src/core/buzzInboundDerivation.ts`)

Enforces the roadmap's load-bearing inbound rule, **derive, don't mirror**. An event becomes a `FollowUp`-shaped work item carrying a **pointer back to the Buzz thread** and a short, sanitised title — never the message body. This is a privacy boundary as much as a storage one: SSOT files are git-tracked, so mirroring a channel would commit colleagues' chat into the repository. Buzz stays the message system-of-record; the pointer is the deliverable.

`sanitizeDerivedText` redacts secret-shaped material (`nsec…`, 64-char hex, `sk-`/`ghp_`/`xoxb-` tokens), strips control characters so a crafted message can't corrupt a Markdown mirror, and clamps to a title length. Derivation is total — underivable kinds and empty text return a reason instead of throwing — and never invents a linked entity the event doesn't support. `deriveWorkItems` de-duplicates by event id, which is what makes the reconnect replay overlap safe. `buildBuzzThreadLink` applies the same `https`-only allowlist as Director contact deep links and percent-encodes the channel id, so a crafted pointer can neither produce a launchable non-https URI nor traverse the path.

### BuzzClient (`src/core/buzzClient.ts`, `src/core/buzzSocket.ts`)

The inbound subscription itself — the piece that *drives* the three modules above. It owns the state machine (connect → authenticate → subscribe → receive → drop → back off → resume) and nothing else: it parses no frames, invents no delays, and stores no conversation.

**Transport-agnostic on purpose.** The socket arrives through an injected `BuzzSocketFactory`, the same idiom `PresenceManager` uses for `spawn`, so `buzzClient.ts` imports neither `ws` nor `vscode`. That keeps the whole machine unit-testable against a fake socket *and* testable against a real in-process WebSocket server (`tests/core/buzzClient.integration.test.ts`), which covers what a fake cannot: the genuine handshake, `ws`'s Buffer→string delivery, real ping/pong, and a hard TCP drop with no closing handshake. `createBuzzWebSocketFactory` (`buzzSocket.ts`) supplies the real transport; `ws` was already a dependency, so inbound sync adds none. `toWebSocketUrl` maps the CLI-style `http(s)` relay base onto `ws(s)`, so a single `atlasmind.buzz.relayUrl` setting serves both the outbound CLI bridge and the inbound socket.

**Signing is a seam, not an implementation.** NIP-42 needs a Schnorr signature over a kind-22242 event, requiring a secp256k1 backend AtlasMind does not yet depend on. `BuzzEventSigner` is that seam. With no signer configured, a relay demanding auth produces a typed, explained stop — never a silent failure and never a reconnect loop.

**Safety.** Deny-by-default: constructing a client connects nothing, and `start()` is explicit. **Read-only by construction** — it sends only `REQ`, `CLOSE`, `AUTH`, and keep-alive pings, never an `EVENT`, so an inbound subscription cannot write to Buzz (asserted in tests). Every frame passes through `parseRelayFrame`, so malformed input is counted and ignored rather than acted on. A socket that cannot even be created is treated as a failed attempt and backed off, not an exception escaping into the extension host.

**Hosted relays.** A Buzz workspace need not be local. `toWebSocketUrl` therefore refuses an **unencrypted socket to a remote host** — plaintext to a hosted relay would expose colleagues' message content and the NIP-42 challenge/response in transit. Loopback is exempt because it never leaves the machine. The rule lives at the transport rather than in a policy caller, so no future wiring can reintroduce a plaintext remote connection, and it matches what the outbound `BuzzCliBridge` already enforces.

### BuzzAgentBindings + BuzzInboundService (`src/core/buzzAgentBindings.ts`, `src/core/buzzInboundService.ts`)

The wiring that turns the Tier-3 modules into a running feature, plus the mapping that gives inbound work an owner.

**Assigning AtlasMind agents to Buzz agents.** Buzz gives every participant — human or agent — a Nostr keypair; AtlasMind has its own roster of specialists. `atlasmind.buzz.agentBindings` maps one to the other, so a message from a Buzz build-bot lands with the DevOps agent instead of arriving unattributed. A binding holds a *list* of agents rather than one: a correspondent who raises both API defects and design feedback belongs to two specialists, and forcing a choice between them discards something the user actually knows. The **first is the owner**, because a follow-up has exactly one, and picking among a set by inference would be a claim the binding does not make; the rest ride along as also-relevant. A single binding is still serialised as a plain string, so a hand-authored record does not sprout arrays because one unrelated entry gained a second agent. It stays on AtlasMind's side of the governing contract: a **local routing preference**, not identity. Buzz still owns the keypair, the directory, and the authorship ledger; nothing is minted, mirrored, or verified here. Keys accept `npub…` or hex and are normalised through the bech32 decoder, so the two forms are interchangeable and a **mistyped npub is rejected rather than binding to a different identity** — silently routing work to the wrong agent would be worse than failing. An `nsec` is refused outright. Unusable bindings are *reported*, never dropped silently, and an unbound author stays unassigned because inferring an agent would be a claim the event doesn't support.

**Deny-by-default, two gates deep.** `BuzzInboundService` connects nothing unless both `atlasmind.buzz.enabled` and `atlasmind.buzz.inboundEnabled` are on, so upgrading never starts a network subscription. Persistence is a *third* gate: `autoCreateFollowUps` defaults off, because `project_memory/` is git-tracked and writing to it from a network event is something to opt into rather than inherit. While off, inbound activity is reported without being written.

### BuzzDirectory (`src/core/buzzDirectory.ts`)

The identities AtlasMind has *observed*, so a Buzz handle can be picked rather than typed.

**Nothing here derives a key from a person.** There is no function from "Jane Doe" to a public key; constructing one would produce a plausible key belonging to a **different real person**, silently routing a colleague's work to a stranger's identity. The module only records keys that arrived on the wire, from two evidence sources: a message event proves an identity is active in a channel, and a kind-0 profile event supplies that identity's own published name. An identity with no profile is labelled with a truncated key — honest — rather than an invented name.

**Kind 0 was verified, not assumed.** It is the standard NIP-01 metadata kind and is **absent from Buzz's kind registry**, so whether a Buzz relay serves it was an open question — the same shape of question that produced the kind-9/40002 mistake. A live relay confirmed every observed author had one, carrying `display_name`. It is deliberately excluded from `BUZZ_INBOUND_KINDS`: a profile is not work, so it is fetched as its own author-scoped filter rather than derived into a follow-up.

**Names are untrusted input.** A display name is remote-controlled text rendered in AtlasMind's UI, so it is secret-redacted, control-character-stripped, and length-clamped *on the way in* — never on the way out, where a single missed call site would be a hole. Malformed profile JSON yields no name rather than an error.

**Enough evidence to recognise a stranger.** A truncated hex key and "seen in 1 channel" cannot tell three unnamed identities apart, which makes the picker useless for exactly the people it exists to help you find — and most Buzz identities publish no profile at all. So each identity also carries how many messages it has sent, when it was last seen, and a short excerpt of its most recent message. The excerpt goes through the same sanitiser as every other remote-authored string here, and only the newest message wins, so an out-of-order replay after a reconnect cannot overwrite it with something older. It is a recognition aid, not a message store — `BuzzConversation` is that.

**Nothing is persisted.** A roster of who spoke and when is exactly what `project_memory/` must not accumulate, being git-tracked. The directory lives in memory for the session, on `BuzzInboundService`, and is rebuilt from the subscription.

`BuzzClient` gained two capabilities for this: an `onEvent` hook delivering every validated event before derivation (kept separate from `onWorkItems`, so widening what is *observed* can never widen what becomes a follow-up), and `updateFilters()`, which re-subscribes on the live connection. Profile lookups are debounced and author-capped, and re-issue the message filter alongside the profile filter so inbound work never stops. Re-subscribing on the existing socket reuses the completed NIP-42 handshake rather than authenticating a second time for a read the relay already trusts.

Your own identity is the one handle that needs no lookup: `deriveBuzzPublicKey` computes it from the agent key already in SecretStorage. It is read only when Buzz is enabled, only the public half is returned, and failure is silent so an unusable key can never surface inside an error message.

**Editing a binding by clicking.** `writeAgentBinding` is the pure add/replace/remove over the raw setting value, shared by every surface that edits one. It exists so a UI cannot invent its own merge rules: the same validation that guards a hand-edited setting guards a click. An empty agent id means *unbind* and is therefore not an error; a key that will not normalise is refused **with a reason** rather than coerced; every other binding is preserved untouched; and the value is written back in whichever shape the user already had, so a hand-authored record does not silently become an array.

Two surfaces call it. **Settings → Buzz** (the `buzz` page in `src/views/settingsPanel.ts`) lists the current bindings and any rejected ones, alongside every `atlasmind.buzz.*` switch grouped as Connection / Inbound / Persistence / Routing; because the gates are nested, a control whose parent switch is off renders dimmed and disabled while still showing its stored value — an inert setting is shown as inert, not as absent. **Project Dashboard → Director** offers the binding per person: the "Add / Edit person" form holds as many communication channels as someone has (`DirectorContact.links` was always a list; only the editor insisted on one), and reveals the AtlasMind agent checklist while any of them is `buzz` — scanned across every row rather than read off whichever happens to be first. Rows are added and removed in the DOM rather than by re-rendering, since a re-render would discard everything else typed into the form but not yet saved, which is precisely when someone is adding a second channel. The agent choices are sent from `agentChoices` in the snapshot so the client never guesses an agent id, and **every** chosen id is checked against the registry rather than only the first — a rename that broke the second of three would otherwise save silently and route nothing. `ProjectDashboardPanel.handleSetBuzzAgentBinding` additionally rejects an agent id with no matching agent, so a rename cannot leave a binding pointing at nothing. The binding posts as its own message rather than riding on `saveDirectorConfig`: it belongs in settings, not in git-tracked project memory, and a refused binding must not block saving the person.

**Lifecycle.** `sync()` reconciles the subscription with current settings — start, stop, or restart when the relay or channels change — and is re-run on any `atlasmind.buzz.*` configuration change. It holds `PresenceManager`'s `buzz` keep-awake reason only while a subscription is genuinely live, releasing on stop; the lock is itself deny-by-default, so holding a reason does nothing unless the user enabled `presence.keepAwake`. Derived follow-ups merge by deterministic id, so the reconnect replay overlap and repeat sightings update nothing rather than duplicating, and a batch cap keeps a busy channel from flooding memory.

### BuzzChannelCatalog (`src/core/buzzChannelCatalog.ts`)

Turning `buzz channels list` into a list a person can tick.

**Why it exists.** A channel id that does not match the channel you actually posted in is the most common reason a correctly configured Buzz subscription receives nothing — and it is undiagnosable from inside AtlasMind, because a wrong id, a wrong relay, and a quiet day all present identically as a connection that receives nothing. The only remedy used to be "go and copy the id out of the Buzz app". The CLI already knows the real ids, so `atlasmind.buzz.fetchChannels` asks it and offers the answer as a multi-select, pre-ticked with what is already watched.

**The field names are verified, not guessed.** `channels list --format compact` emits an array of `{ channel_id, name }` — read from the compact projection written out literally in `crates/buzz-cli/src/commands/channels.rs` at the pinned release, not inferred from a jq example. The parser still accepts `channelId`, `id`, and `uuid`, because tolerating a rename costs nothing while failing closed on one costs a user their channel list.

**The output is untrusted.** Channel names are written by whoever created the channel and are rendered in a picker; the id is written into a settings array AtlasMind later subscribes with. So parsing never throws (a response of an unexpected shape yields an empty catalog rather than an error), ids are constrained to a printable-safe identifier charset rather than accepted as arbitrary text — whitespace, control characters, and shell-shaped strings are refused — names are secret-redacted, control-stripped, and clamped, the list is capped and de-duplicated, and entries with no usable id are **counted rather than hidden**, because "6 of 8 channels" matters when the two that vanished may be the ones being looked for.

**The write is entirely the user's.** This is the one Buzz control that changes a setting, and it changes only the channel list — never a gate, never a key. The user presses the button, ticks the channels, and nothing is stored if the picker is dismissed. It runs under the same validated configuration as the outbound bridge: `loadBuzzCliBridgeConfig` normalises the relay URL and enforces remote consent, the key comes from SecretStorage as an environment variable, and the binary is executed directly rather than through a shell.

**An unlisted channel is kept.** `resolveWatchedChannels` stores exactly what was ticked, so unticking removes — but a watched id absent from the relay's listing is preserved. A channel the CLI could not see is far more likely a permissions or paging gap than a deliberate removal, and dropping it would unsubscribe someone from a channel they never touched.

The setup walkthrough points at the button from both the subscribe step and the "prove a message arrives" step, but **only when the CLI is actually on PATH** — naming a button that needs a binary you never installed is how a guide teaches people to distrust it.

### BuzzSigner (`src/core/buzzSigner.ts`)

BIP-340 Schnorr signing for NIP-42, filling the `BuzzEventSigner` seam. A real Buzz relay refuses to serve a subscription until the client authenticates (`auth-required: authenticate before subscribing`, observed against a live relay), so inbound sync cannot work without this.

**Bundled but lazily loaded.** `@noble/secp256k1` is a normal dependency — fixed at build time, covered by the lockfile's integrity hash, auditable in the repo — chosen over the full `@noble/curves` suite because it is **170 KB with zero transitive dependencies** versus 1.87 MB plus an 889 KB dependency, for the one curve Nostr uses. It is imported only the first time a signature is needed, so a user who never touches Buzz pays nothing at activation. Node's built-in `crypto` supplies SHA-256, so nothing else is pulled in.

**Module-format care.** The package is ESM-only, and `require()`-ing ESM throws on Node before 22.12 — which the VS Code extension host can be. A plain `await import()` would be downlevelled to `require()` by the CommonJS emit, so the import is constructed through `Function` to survive transpilation, with a `require` fallback for hosts that cannot resolve a bare specifier that way. The dependency's surface is declared as a local structural interface rather than a type import, which both avoids the ESM/CJS type friction and documents exactly how little of the library is used.

**Correctness and safety.** `parseBuzzSecretKey` accepts a bech32 `nsec…` or bare 64-char hex — the two forms Buzz documents — and **validates the bech32 checksum**, so a mistyped key fails loudly rather than silently authenticating as a different identity; an `npub` is rejected with that named explicitly, since it is the likely mistake. Key validation happens when the signer is *created*, not mid-handshake. Every signature is verified against the derived public key before the event is returned, so a miswired hash backend cannot emit a bad signature. Secret material never appears in a log, an error message, or a serialised value. The hand-written bech32 decoder and the library are cross-validated in tests against the **published NIP-19 nsec/npub vector pair**: decoding one and deriving the other must reproduce the spec's values.

**Scope.** It signs *authentication* events only. `BuzzClient` stays read-only — the sole event this produces is the ephemeral kind-22242 auth event, which relays never store.

**Still owed.** Validation against a real Buzz relay rather than a NIP-01-shaped stand-in, and the deny-by-default inbound toggle plus follow-up persistence.

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
  → Planner.plan()          (reasoning LLM decomposes goal → ProjectPlan DAG)
  → normalize execution skills (ground non-synthesis tasks with enabled evidence tools)
  → onProgress({ type: 'planned' })
  → TaskScheduler.execute()
      for each dependency batch (in parallel):
        → Orchestrator.executeSubTask()
            → ephemeral AgentDefinition (from SubTask.role)
            → route to function-calling executor; hand off explicit tool-unavailable refusals
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
- Website Studio persists only bounded, sanitized planning data and provider-prefixed secret references; it server-locks the Develop/Staging/Production access policies, validates loopback/HTTPS/review-subdomain readiness, redacts recognized secrets/n8n webhook URLs, and exposes no direct deploy or workflow-trigger message.
- Future orchestrator execution should preserve the same rule: validate inputs, redact secrets, and prefer explicit user confirmation for risky actions.

## Quality Gates

- Local quality loop: `npm run lint`, `npm run test`, `npm run compile`.
- CI pipeline (`.github/workflows/ci.yml`) enforces compile, lint, test, and coverage for pushes and pull requests to `main`.
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
  │     ├── views/websiteStudioPanel.ts
  │     │     └── core/websiteWorkspaceManager.ts
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
        │     ├── mcp/mcpClient.ts
        │     ├── mcp/mcpRuntime.ts
        │     └── mcp/mcpEnvironmentScanner.ts
        ├── mcp/buzzCommsServer.ts
        │     └── mcp/buzzCliBridge.ts
        ├── skills/index.ts
        │     ├── skills/dockerCli.ts
        │     └── skills/gitApplyPatch.ts
        └── providers/index.ts
              ├── providers/anthropic.ts
              ├── providers/claude-cli.ts
              ├── providers/copilot.ts
              ├── providers/acp.ts
              │     ├── providers/acpProtocol.ts     (wire framing, pure)
              │     ├── providers/acpPermission.ts   (authorization policy, pure)
              │     └── providers/acpInstaller.ts    (install planning, pure)
              └── providers/localModelRecommendationRegistry.ts

tests/core/
  ├── modelRouter.test.ts
  ├── costTracker.test.ts
  ├── websiteWorkspaceManager.test.ts
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
| `AgentDefinition` | Agent identity, role, system prompt, allowed models, cost limit, skills, and optional completion rubric/incomplete-response gates |
| `SkillDefinition` | Skill identity, JSON Schema for tool params, handler path |
| `ModelInfo` | Model identity, provider, pricing, context window, capabilities, reasoning depth, latency class, and prompt-cache support (`supportsPromptCaching`, `cachedInputPricePer1k`) |
| `ProviderConfig` | Provider identity, API key setting key, enabled flag, model list |
| `RoutingConstraints` | Budget mode, speed mode, max cost, preferred provider, preferred model (role pin), parallel slots, cacheable-prefix ratio |
| `TaskProfile` | Inferred task phase, modality, reasoning intensity, and capability preferences |
| `ModelStruggleKind` | A way a model under-performed on a turn: `timeout`, `empty`, `tool-call-as-text`, `error-finish`, `user-correction` |
| `ModelStruggleState` | Persistent decaying de-weight for a model on a task signature: `penalty`, `lastUpdated`, `hits`, `lastKind` |
| `SubTask` | Unit of work in a project plan: id, title, role, skills, `dependsOn` edges |
| `SubTaskResult` | Execution outcome: `status` (`completed` / `failed` / `needs-input`), output, costUsd, durationMs, error, and (when capped) `iterationLimitHit` + suggested raised limits |
| `ProjectPlan` | Decomposed goal: id, goal, `subTasks[]` DAG |
| `ProjectResult` | Full execution outcome: subtask results, synthesis, totals |
| `ProjectProgressUpdate` | Discriminated progress event: `planned \| subtask-start \| subtask-done \| synthesizing \| error` |
| `TaskRequest` | User message, context, constraints, timestamp |
| `TaskResult` | Agent ID, model used, response, cost, duration |
| `CostRecord` | Per-request token counts and cost |
| `MemoryEntry` | Path, title, tags, last modified, snippet |
| `McpServerConfig` | MCP server id, name, transport (stdio/http), command/args/env or url, enabled, `secretEnvKeys` (env var names whose values live in SecretStorage) |
| `McpConnectionStatus` | `'disconnected' \| 'connecting' \| 'connected' \| 'error'` |
| `McpToolInfo` | Server id, tool name, description, input JSON Schema |
| `McpServerState` | Live snapshot: config + status + error + discovered tools |
| `PromotionPlan` | Assembled promotion: ordered guarded steps, preflight `checks`, blockers, gate flags, and an optional `remediation` |
| `PromotionRemediation` | "Resolve & run" offer for fixable failing checks: `resolves`, assessed `targetVersion`/`bumpLevel`/`bumpReason`, `editsChangelog`, `commits`, `summary` |

## Detailed Architecture Subdocs

| Document | Description |
|---|---|
| `architecture/boundaries-and-seams.md` | Explicit review of all integration seams — contracts, protocols, and security rules for each crossing |
| `architecture/runtime-and-surfaces.md` | Runtime environment and UI surface overview |
| `docs/architecture/orchestrator-flow.md` | `processTaskWithAgent` and `runAgenticLoop` internal flow with Mermaid diagrams |
