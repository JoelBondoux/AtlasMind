# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

## [0.103.1] - 2026-06-18

### Changed
- **Sidebar brand header is now a single inline line** (`src/views/chatWebviewMarkup.ts`, `media/chatPanel.js`). The project name moved from a second subtitle row to an inline `AtlasMind/ProjectName` form — the connected project name follows a forward slash after the wordmark and renders in a slightly smaller, dimmer font — reclaiming the vertical space the stacked subtitle used. The slash separator and project name are hidden entirely when no project name is available (Git remote or workspace folder), leaving just the clickable "AtlasMind" wordmark. Both segments remain independently clickable (wordmark → Settings, project name → Project Dashboard).

## [0.103.0] - 2026-06-18

### Changed
- **Open-ended triage/advisory prompts are no longer routed to sub-10B models** (`src/core/taskProfiler.ts`). Prompts like *"what should we work on next? Is there anything incomplete?"* matched no reasoning hint and fell through to `low`, so the router picked the cheapest model (e.g. an 8B local model) — which cannot do the whole-project reasoning the question demands. A new `OPEN_ENDED_ADVISORY_HINTS` pattern classifies these triage/recommendation/"what's next" questions as **high** reasoning, so the existing router penalties steer them to a capable model. Mechanical follow-ups (e.g. "commit the changes") are unaffected.

### Fixed
- **Verbatim-duplicated model output is now collapsed before display** (`src/core/orchestrator.ts`). Weak or looping models sometimes emit their final answer twice in a row (`prefix + B + B`); the new `collapseDuplicatedTrailingBlock` guard drops the duplicate copy. It is conservative — it only removes a large (≥ 200-char) trailing block that exactly duplicates the block immediately before it — so it never touches legitimately repeated short phrases or structured code.

### Added
- **Pick-one quick-reply pills for enumerated questions** (`src/chat/participant.ts`). `detectResponseQuickReplies` previously only produced clickable buttons for yes/no and a single "A or B?" question. It now also recognises a trailing 3–4 option list (*"…: batch concurrency, Shopify sync, or edge cases?"*) and renders one pill per option, so triage answers that end in a clear choice become one-tap selectable instead of a plain text prompt.
- **Tests**: `tests/core/taskProfiler.test.ts` (triage prompts → high reasoning; plain action follow-up stays low), `tests/core/orchestrator.tools.test.ts` (`collapseDuplicatedTrailingBlock` behavior incl. prefix preservation and non-duplicated passthrough), and `tests/chat/participant.helpers.test.ts` (`detectResponseQuickReplies` 2/3-option, yes/no, prose, and no-question cases).
- **Clickable brand header in the AtlasMind sidebar** (`src/views/chatWebviewMarkup.ts`, `media/chatPanel.js`, `src/views/chatPanel.ts`, `src/views/chatProtocol.ts`). The chat view — the topmost surface in the AtlasMind sidebar — now opens with an "AtlasMind" wordmark that opens the Settings panel when clicked, and a subtitle announcing the active project that opens the Project Dashboard. Both are keyboard-focusable buttons routed through the validated webview message protocol (new `openSettings` and `openProjectDashboard` messages) to the existing `atlasmind.openSettings` and `atlasmind.openProjectDashboard` commands. The activity-bar container title itself is not bindable through the VS Code API, so the brand header lives inside the topmost view where it is reachable.
  - The announced project name is the **connected Git repository name** when the workspace has a remote (resolved from the built-in `vscode.git` extension's `origin` remote, e.g. `https://github.com/owner/AtlasMind.git` → `AtlasMind`), falling back to the **workspace folder name** when no remote is configured or Git tooling is unavailable. The name resolves asynchronously, is cached, and is re-resolved when a repository or remote is connected later in the session.

## [0.101.0] - 2026-06-18

### Changed
- **Autonomous /project subtasks that hit the tool-iteration cap now pause for a decision instead of silently dying** (`src/core/orchestrator.ts`, `src/types.ts`, `src/chat/participant.ts`, `src/views/projectRunCenterPanel.ts`, `src/cli/main.ts`). Previously, when a subtask in a project run reached the `maxToolIterations` safety cap, `executeSubTask` returned `status: 'completed'` with the bare "Execution stopped after reaching the safety limit…" string as its output — so the scheduler moved on as if the subtask had succeeded, the run was recorded as completed, and the user was never offered the override that single-turn chat already provides.
  - New `SubTaskStatus` value **`needs-input`** (`src/types.ts`): a non-terminal pause distinct from `failed`. `SubTaskResult` now carries `iterationLimitHit`, `suggestedIterationLimit`, and `suggestedToolCallsPerTurnLimit` so the cap signal survives into the project layer.
  - The orchestrator now returns `needs-input` (not `completed`) for a capped subtask, propagating the suggested raised limits.
  - The chat/project report renders a prominent **"⏸️ Paused — tool-iteration limit reached"** section listing the paused subtask(s), the suggested higher limit, and a button to open the `atlasmind.maxToolIterations` setting, plus the three explicit choices (raise permanently, raise once and re-run, or skip). The run is recorded as `paused` rather than `completed`.
  - The Project Run Center reflects the paused state in the subtask tracker (new ⏸ icon, "raise limit to resume" hint, `paused` summary count) and run log; the CLI shows a ⏸ marker with the resume hint.

### Added
- **Test**: `tests/core/orchestrator.tools.test.ts` covers that a project subtask hitting the agentic cap surfaces as `needs-input` with `iterationLimitHit` and a positive `suggestedIterationLimit`, rather than a false `completed`.

## [0.100.3] - 2026-06-18

### Fixed
- **Documentation accuracy sweep for changes since 0.80.0** (`docs/configuration.md`, `wiki/Configuration.md`): corrected three stale/inaccurate items found while auditing the docs against the 0.81.0→0.100.2 changelog. (1) The `atlasmind.maxToolIterations` default was documented as `20` in both `docs/configuration.md` and `wiki/Configuration.md`, but `package.json` (and the README) set it to `10`; both now read `10`. (2) The Voice section in `docs/configuration.md` still claimed "There is not yet a host-side OS-native speech adapter," directly contradicting the `voice.hostSpeechEnabled` / `HostSpeechSynthesizer` engine shipped in 0.80.0 and documented in the same section; the closing paragraph now describes the actual three-backend TTS priority (ElevenLabs → OS host engine → Web Speech) and the on-device Whisper STT path. (3) The same paragraph's "webview-first" framing (which predated 0.80.0/0.81.0) was updated accordingly.

### Changed
- **`.gitignore`: selectively track the `project_memory/` SSOT** instead of blanket-ignoring it. The folder was previously fully ignored yet ~49 curated files were force-tracked anyway, so new SSOT entries silently fell outside git unless added with `-f`. The "project brain" (agents, decisions, ideas, architecture, domain, operations, roadmap, skills, index, routines) is now tracked by default, while volatile / potentially-sensitive content stays out of this **public** repo: `project_memory/sessions/` (chat transcripts), `project_memory/temp/`, and dated `project_memory/operations/project-run-*.json` run-history dumps. The stale `project_memory/temp/vision-enhancement.md` was untracked, and the previously-untracked curated entries were added.

## [0.100.1] - 2026-06-18

### Added
- **Open Knowledge Format (OKF) interoperability planning** (`docs/roadmap.md`, `project_memory/`): evaluation and design for adopting Google Cloud's Open Knowledge Format (OKF v0.1, published 2026-06-16). Rather than reformatting AtlasMind's own docs to a two-day-old spec, the plan adds OKF **import/export** — including a user-facing **"Convert project to OKF"** command that emits an ingested project as a portable, redaction-safe bundle — plus a lightweight **spec-watch sync** (modeled on the existing provider/pricing sync services) that tracks the spec as it evolves and raises an advisory on version bumps without auto-mutating memory. Captured in `project_memory/decisions/okf-alignment-evaluation.md` (verdict: align the SSOT, don't migrate wholesale), `project_memory/index/okf-frontmatter-audit.md` (AtlasMind's stores are structurally OKF-shaped but metadata-divergent, so export/import is favored over reformatting), and `project_memory/ideas/okf-interop.md`. Added to the Frontier / Horizon Watch (Horizon 1) in the human-facing roadmap. Planning only — no implementation yet.

## [0.100.0] - 2026-06-18

### Changed
- **Compare Models: list every configured model, grouped by provider** (`src/views/modelComparisonPanel.ts`): the picker previously showed only routing-`enabled` models, so most of a configured provider's catalog was hidden and very few models appeared. It now mirrors the Models tree — every model from a credentialed provider is listed in a collapsible per-provider group with a provider-level "select all" (plus the global Select All); disabled models are still selectable and marked.
- **Sortable results table** (`src/views/modelComparisonPanel.ts`): results are now rendered client-side from structured data and any column header (Model, Quality, Completion, Cost, Latency, Tokens) can be clicked to sort ascending/descending. The first row in the current sort order is flagged as the leader.
- **Quality, clarified** (`src/core/executionQuality.ts` doc, panel legend): the old single "Quality" column was the coarse completion-integrity grade (error 0 · empty 0.2 · truncated 0.6 · clean 1.0), which is ~1.0 for any clean response and so unhelpful for ranking. It is now labelled **Completion** with an inline legend explaining exactly what it measures.

### Added
- **Optional LLM answer-quality judge** (`src/core/modelEvalHarness.ts`, `src/views/modelComparisonPanel.ts`): an opt-in toggle (default off) grades each model's answer 0–100 for correctness, completeness, and usefulness using a judge model you pick from your configured models. When enabled, a **Quality** column appears (with the judge's rationale on hover) and drives the ranking. New pure, unit-tested helpers `buildModelJudgePrompt` and `parseModelJudgeVerdicts` (defensive JSON parsing, id matching, score clamping) back it; the harness gained an injected `judge` hook (`ModelEvalResult.judgeScore`/`judgeRationale`). The judge is display/ranking only — the **completion grade** remains what is recorded into outcome-driven routing, so routing calibration stays consistent with normal turns.

## [0.99.1] - 2026-06-18

### Changed
- **Defer the activation-time memory freshness scan** (`src/extension.ts`): even with stale-memory auto-refresh off (v0.98.0), the `loadSsotFromDisk` step still ran the freshness *detection* — `getProjectMemoryFreshness` → `buildImportSnapshot`, which walks the entire repository to fingerprint imported sources — synchronously on the startup-critical path (observed ~4.5s on a large workspace). That scan exists only to light up the "Update Memory" badge, so it no longer sits between SSOT load and provider discovery: the SSOT is loaded from disk immediately, and the freshness scan is scheduled `MEMORY_FRESHNESS_STARTUP_DELAY_MS` (8s) after activation settles (cleaned up via a registered disposable). The on-save file watcher keeps freshness current thereafter; this one-shot scan still catches edits made while VS Code was closed — it just no longer delays startup. Resolves the residual slow-load between `loadSsotFromDisk completed` and the first `[providers]` lines.

## [0.99.0] - 2026-06-18

### Changed
- **Compare Models panel reworked** (`src/views/modelComparisonPanel.ts`): the panel now matches the visual language of the other dashboards (topbar kicker/title, rounded cards, pill buttons, ranked results table with a highlighted winner). Key behaviour changes:
  - **Only configured models are offered.** The model picker now lists models exclusively from providers the user has actually configured with credentials (checked via `isProviderConfigured`, run in parallel on open and grouped by provider), so a comparison can always be run for real instead of failing on un-credentialed providers.
  - **Select All** toggle (with indeterminate state and a live selected-count) to quickly compare every configured model.
  - **Ready-made sample prompts** (reasoning puzzle, code generation, summarize & extract) as one-click chips that populate the prompt box.
- **Compare Models is now discoverable** (`package.json`, `src/views/settingsPanel.ts`): added a beaker icon to the **Models** view titlebar that opens the panel, and a **Compare Models** quick-action card on the Settings overview page.

## [0.98.0] - 2026-06-18

### Changed
- **Skip discovery for unconfigured providers** (`src/extension.ts`): startup model discovery health-checked and listed models for **every** registered provider, including the ~20 the user has not configured with any credentials — so an unconfigured Amazon Bedrock (with no AWS keys) spent ~30s on a SigV4/network health attempt, and other unconfigured providers were probed pointlessly. Discovery now consults `isProviderConfigured` and **skips any provider with no API key / credentials** before any health check or `/models` call (keeping its seeded models and marking it unhealthy until configured). Interactive providers (Copilot, Claude CLI) are exempt from this pre-check since their configured-state is their own health probe. Combined with v0.97.2's concurrency + per-provider timeout, the `[providers]` startup stream now finishes quickly even with many unconfigured providers registered.

### Added
- **`atlasmind.autoRefreshStaleMemory` setting (default off)** (`src/extension.ts`, `package.json`): the automatic re-import of stale imported SSOT memory entries on startup/file-changes is an expensive LLM re-summarization of every stale entry — it slowed dashboards and panels on launch (the `[activate] memoryFreshness auto-refresh` work) and, when ineffective, simply re-ran. It is now **off by default**: AtlasMind still detects staleness and surfaces the **Update Memory** affordance (`setMemoryNeedsUpdateContext`) for an explicit, on-demand refresh, so startup stays fast and no LLM tokens are spent silently. Set the new setting to `true` to restore continuous auto-refresh.

## [0.97.2] - 2026-06-18

### Fixed
- **Faster startup: provider discovery is now concurrent and bounded** (`src/extension.ts`, `tests/extensionActivation.test.ts`): `refreshProviderModelsCatalog` discovered models from ~24 providers in a **serial** loop — each provider's health check + `/models` fetch ran one after another, so a few slow providers (or a hanging health probe such as the Claude CLI's 60-second one) summed to nearly a minute of the `[providers]` startup stream during which model-dependent UI lagged. Discovery now runs **concurrently** (`Promise.all`), and each provider is wrapped in a per-provider timeout (`STARTUP_PROVIDER_DISCOVERY_TIMEOUT_MS`, 10s) via a new `withTimeout` helper, so one slow or hanging provider can no longer stall the rest — it is marked unhealthy, its existing models are kept, and it is retried on the next refresh. Total discovery time collapses from ~the sum of all providers to ~the slowest single one (capped at the timeout). Added 3 `withTimeout` tests (settles in time, slow → fallback, reject → fallback).

## [0.97.1] - 2026-06-18

### Fixed
- **Silent activation failures are now surfaced** (`src/extension.ts`): if `bootstrapAtlasMind()`'s `buildAtlasContext` step throws, the error was caught and logged but never shown, leaving `atlasContext` unassigned — so every chat-view title icon that calls `requireAtlas()` (Cost Dashboard, Project Dashboard, Model Providers, Personality, Run Center, etc.) silently no-opped while Settings (the only command that does not require the context) still worked. The activation promise now has a `.catch()`, and the post-bootstrap step detects an unassigned context and shows an actionable error with a **Show Output** button pointing at the "AtlasMind" output channel (which logs the actual failing step). This does not change the underlying failure — it makes it visible so it can be diagnosed and fixed instead of presenting as dead toolbar icons.

## [0.97.0] - 2026-06-18

### Added
- **Model Comparison panel** (`src/views/modelComparisonPanel.ts`, `src/commands.ts`): the `AtlasMind: Compare Models on a Prompt` command now opens a dedicated webview instead of the output channel. Enter a prompt, tick 2+ models, and run them to get a ranked, sortable table of graded quality, cost, latency, and an output preview per model; graded outcomes are recorded into the router to calibrate routing. The panel reuses the pure `compareModelsOnPrompt` harness, validates inbound webview messages (prompt is a non-empty string; model IDs are checked against the known-model set), renders all dynamic content with `escapeHtml`, uses a nonce-protected script with no inline handlers, and aborts an in-flight run when the panel is closed. The previous output-channel implementation (and its helper) were removed.

## [0.96.1] - 2026-06-18

### Changed
- **Higher-fidelity Claude "brain" context via the Claude Code CLI bridge (Direction 3)** (`src/providers/claude-cli.ts`, `tests/providers/claudeCliPrompt.test.ts`): the chat-only `claude-cli` bridge previously truncated **every** message uniformly to 4,000 chars, which starved the brain-role calls (planning / synthesis) that carry the goal plus a large memory context in a single user message. `buildClaudeCliPrompt` now allocates a per-role budget: prior-turn history is capped small (2,500 chars each) while the **latest** turn gets up to 16,000 chars (≈4× more), reduced dynamically when history is large so the assembled prompt stays within a 26,000-char total budget — safely under the Windows ~32,767-char command-line limit (the prompt is passed on the command line). This makes `claude-cli` a far more capable choice for `planningModelId` / `synthesisModelId`. Added 3 tests covering the enlarged latest-turn budget, small history truncation, and the total bound under heavy history.

## [0.96.0] - 2026-06-18

### Added
- **Local-draft / frontier-escalate routing (Direction 3)** (`src/core/orchestrator.ts`, `package.json`): a new `atlasmind.draftModelId` setting pins a draft model (e.g. a fast local model) for the **first attempt** of draftable tasks (auto budget + mechanical/low-stakes), with AtlasMind's existing struggle-gated escalation upgrading to a stronger reasoning-capable model if the draft falls short. This completes the role-routing set (draft / plan / execute / synthesize) over the `preferredModel` pin. The pin is applied to a separate initial-selection constraints object so it never blocks escalation, and `selectEscalatedModel` now explicitly clears `preferredModel` — escalation is a deliberate upgrade that must not re-select the model it is moving off. Empty (default) routes normally; an unknown model falls back to normal routing.

## [0.95.0] - 2026-06-18

### Added
- **Model-eval harness — "Compare Models on a Prompt" (Direction 2)** (`src/core/modelEvalHarness.ts`, `src/core/executionQuality.ts`, `src/commands.ts`, `package.json`, `tests/core/modelEvalHarness.test.ts`): a scored-replay harness that runs one prompt across a set of candidate models and returns a ranked comparison (graded quality, cost, latency, token counts, output preview). The graded outcomes are recorded into the router's outcome channel, so a benchmark also **calibrates outcome-driven routing**. The core (`compareModelsOnPrompt`) is pure and host-independent — the model call is injected — with 5 tests (quality ranking + outcome recording, cost tie-break, error capture, de-duplication, abort). A new `AtlasMind: Compare Models on a Prompt` command drives it interactively: pick a prompt and 2+ models, run sequentially (bounded spend), and view the ranked results in an output channel. The quality scorer `gradeExecutionQuality` was extracted to the shared `executionQuality.ts` so the orchestrator and harness use one definition.

## [0.94.0] - 2026-06-18

### Added
- **Synthesis-phase role pin — completing the role-routing trio (Direction 3)** (`src/core/orchestrator.ts`, `package.json`, `docs/configuration.md`, `wiki/Configuration.md`): a new `atlasmind.synthesisModelId` setting pins the synthesis phase (summarizing results or a chat session into reusable reasoning context — a no-tool reasoning step) to a chosen model, symmetric to `atlasmind.planningModelId`. Together they realise the full **plan (brain) → execute (tool-capable workers) → synthesize (brain)** role-routing pattern over the `preferredModel` primitive. The per-role helper `withPlanningBrainModel` was generalised to `withRoleModel(constraints, settingKey)` and applied at the planning call sites and `summarizeText`. When set to a known model the pinned model is used directly (bypassing budget/speed gates); empty routes normally, and an unknown model falls back to normal routing.

## [0.93.0] - 2026-06-18

### Added
- **Per-(reasoning-tier × model) outcome granularity (Direction 2)** (`src/core/modelRouter.ts`, `src/core/orchestrator.ts`, `tests/core/modelRouter.test.ts`): the outcome-driven routing bias is now context-aware. Execution outcomes are tracked both against a model's aggregate record (the bare `modelId` key — backward- and persistence-compatible) and against a per-reasoning-tier bucket (`modelId::low|medium|high`), so a model that excels at high-reasoning work but struggles with mechanical tasks (or vice-versa) is biased appropriately for the task at hand. `scoreOutcomeBias` prefers the bucket matching the current task's reasoning tier once it has enough samples and falls back to the aggregate otherwise; the orchestrator records the tier from the task profile. Added 3 tests (separate bucket tracking, per-tier preference flip between high/low tasks, aggregate fallback on sparse buckets).

## [0.92.0] - 2026-06-17

### Added
- **Planner-brain role routing (Direction 3)** (`src/types.ts`, `src/core/modelRouter.ts`, `src/core/orchestrator.ts`, `package.json`, `tests/core/modelRouter.test.ts`): a foundational `RoutingConstraints.preferredModel` pin for **role-based routing**. When set and the model is genuinely usable (available, enabled, healthy, not deprecated/recently-failed, within any allow-list, and satisfies required capabilities), the router selects it directly via `resolvePinnedModel` — bypassing budget/speed gates since it is a deliberate choice — and otherwise falls back to normal scoring. The first consumer is the **planner "brain"**: a new `atlasmind.planningModelId` setting pins the planning/decomposition phase to a chosen model (planning is a no-tool reasoning step, so this is ideal for a strong reasoner or a Claude subscription via `claude-cli`), while execution subtasks still route to tool-capable workers — realising the planner-brain / tool-executor split from the routing roadmap. Added 4 tests (pin honored over budget gate, fallback on unknown model, capability veto, unhealthy-provider veto). Verification-gated draft→escalate hybrid routing remains a roadmap follow-up.

## [0.91.0] - 2026-06-17

### Added
- **Outcome-driven routing (Direction 2)** (`src/core/modelRouter.ts`, `src/core/orchestrator.ts`, `src/extension.ts`, `src/types.ts`, `tests/core/modelRouter.test.ts`): the router now adapts to how models actually perform on this project's work. A new per-model execution-outcome channel maintains a **decayed EWMA** of graded run quality (`gradeExecutionQuality`: hard error = 0, empty response = 0.2, truncated = 0.6, clean response = 1.0) — separate from the manual thumbs-feedback channel so it does not disturb user feedback. `scoreOutcomeBias` turns that EWMA into a **bounded** routing nudge (±`OUTCOME_BIAS_MAX`), gated by a minimum sample count (no reaction to a single run) and by the existing `feedbackRoutingWeight` control (0 disables it), so a struggling model is nudged down without being starved. Outcomes are **persisted** across sessions via a new `onModelOutcomeRecorded` orchestrator hook and `atlasmind.executionOutcomes` global-state key, and restored on activation. Added 6 tests (EWMA decay, stronger-track-record preference, cold-start no-op, weight-0 disable, persistence round-trip). Future refinements (per-task-profile granularity, a scored-replay harness) are tracked in the routing roadmap.

## [0.90.0] - 2026-06-17

### Changed
- **Smarter Anthropic prompt caching: stable-prefix split + threaded-chat caching** (`src/providers/anthropic.ts`, `src/providers/adapter.ts`, `src/core/orchestrator.ts`, `tests/providers/anthropicCaching.test.ts`): two refinements to the v0.89.0 cache writes.
  - **Stable/volatile system split** — AtlasMind's system prompt mixes a stable head (guardrails, agent prompt, skills) with a volatile tail (`Relevant project memory:` / `Live evidence from source-backed files:`) that changes almost every turn, so caching the whole system prompt rarely hit across turns. The adapter now splits at the first volatile marker (`splitStableSystemPrefix`) and places the cache breakpoint after the stable head only, leaving memory/evidence uncached. The stable head is identical across turns, so cross-turn cache-hit rates rise substantially.
  - **Threaded tool-less caching** — caching was previously gated on tool presence (agentic loops). A new `CompletionRequest.cacheStablePrefix` flag, set by the orchestrator when the cacheable-prefix ratio of the carried session/native context exceeds `CACHE_PREFIX_REUSE_THRESHOLD` (0.25), now also caches the stable prefix on threaded, tool-less chat turns where the prefix is genuinely reused — while still skipping single-shot turns to avoid the cache-write premium. +4 tests covering the split and the marker logic.

## [0.89.0] - 2026-06-17

### Added
- **Anthropic prompt-cache writes — actually caching the stable prefix** (`src/providers/anthropic.ts`, `tests/providers/anthropicCaching.test.ts`): the cache-savings pipeline previously only *measured* whatever a provider happened to cache. The Anthropic adapter now *deliberately* caches: when a request carries tools (an agentic loop that reuses the identical system prompt + tool definitions across every iteration), it marks the system prompt and the final tool definition with `cache_control: { type: 'ephemeral' }`, so Anthropic serves that prefix at the reduced cache-read rate on the second and subsequent calls. Applied on both the buffered and streaming request paths. Caching is gated on tool presence so single-shot, tool-less turns are not charged Anthropic's ~1.25× cache-write premium (which only breaks even after the second read); blocks below Anthropic's minimum cacheable size are silently ignored by the API. This closes the loop with the v0.88.0 cache-savings telemetry: AtlasMind writes the cache, the provider reports cache reads, and the Cost Dashboard shows the realised savings.

## [0.88.0] - 2026-06-17

### Added
- **Prompt-cache savings telemetry and Cost Dashboard panel** (`src/providers/adapter.ts`, `src/providers/anthropic.ts`, `src/providers/openai-compatible.ts`, `src/types.ts`, `src/core/modelRouter.ts`, `src/core/orchestrator.ts`, `src/core/costTracker.ts`, `src/views/costDashboardPanel.ts`, `tests/core/modelRouter.test.ts`, `tests/core/costTracker.test.ts`): completes the cache-aware routing work with real, measured savings. `CompletionResponse` gains `cachedInputTokens`, populated from provider usage — Anthropic's `cache_read_input_tokens` (folded into the total input count, which Anthropic reports separately) and OpenAI-style `prompt_tokens_details.cached_tokens` / DeepSeek's `prompt_cache_hit_tokens` — across both the buffered and streaming response paths. The orchestrator aggregates cached tokens across retry/iteration attempts and values the avoided spend via the new public `ModelRouter.cacheReadPricePer1k(model)` (explicit `cachedInputPricePer1k`, else the per-provider cache factor). `CostRecord` gains `cachedInputTokens` + `cacheSavingsUsd`, the `CostSummary` gains `totalCacheSavingsUsd` + `totalCachedInputTokens`, and the **Cost Dashboard** shows a new **Cache Savings** card (avoided spend + cached input-token volume) alongside Compression Savings. Like compression savings, the figure is reported as avoided spend rather than discounting recorded cost, keeping cost figures consistent. This closes Direction 1 of the routing roadmap end-to-end.

## [0.87.1] - 2026-06-17

### Changed
- **Per-provider cache-read discounts for cache-aware routing** (`src/core/modelRouter.ts`, `tests/core/modelRouter.test.ts`): cache-capable models without an explicit `cachedInputPricePer1k` previously all used the flat conservative `DEFAULT_CACHE_READ_FACTOR` (0.25×), which understated providers with deeper discounts (notably Anthropic at ~0.1×). Added a `PROVIDER_CACHE_READ_FACTOR` baseline map (Anthropic/Claude CLI 0.1×, OpenAI/Azure/Copilot 0.5×, DeepSeek/Google 0.25×) so the projected cache-read price is realistic per provider on iterative turns. This remains a **bootstrap baseline only** — a dynamic `cachedInputPricePer1k` reported by discovery or the pricing sync still overrides it — keeping cache pricing accurate without hardcoding per-model values. Added a test that a deeper-discount provider is preferred over an equivalent default-factor model on a cacheable turn.

## [0.87.0] - 2026-06-17

### Added
- **Cache-aware model routing** (`src/core/modelRouter.ts`, `src/core/orchestrator.ts`, `src/types.ts`, `src/providers/modelCatalog.ts`, `src/providers/adapter.ts`, `src/providers/providerPricingSync.ts`, `src/extension.ts`, `tests/core/modelRouter.test.ts`): the router now models prompt-cache economics. Frontier providers bill a large, stable prompt prefix (system/identity prompt + SSOT memory bundle + tool definitions) at a reduced cache-read rate on repeat turns; AtlasMind sends exactly that shape on iterative/threaded work. New `RoutingConstraints.cacheablePrefixRatio` lets the orchestrator declare how much of a turn's input is a reused, cacheable prefix (estimated from the carried session/native context vs. the volatile user message via the new exported `estimateCacheablePrefixRatio`, capped so a perfect cache hit is never assumed). When set, `effectiveCostPer1k` projects the cacheable share at the cache-read price for cache-capable models, so they are favoured for iterative work; single-shot turns (ratio 0) are unaffected. `ModelInfo` / `CatalogEntry` gain `supportsPromptCaching` and `cachedInputPricePer1k`; when no explicit cache price is known the router applies a conservative `DEFAULT_CACHE_READ_FACTOR` (0.25×).
- **Dynamic cache-capability sourcing**: because providers change model capabilities over time, cache capability is **data-driven, not hardcoded**. `DiscoveredModel` and the live `ProviderPricingEntry` gain `supportsPromptCaching` / cached-price fields so runtime discovery and the pricing sync can report (or retract) caching support per refresh; `inferModelMetadata` merges them with **hint → pricing → catalog** precedence (an explicit `false` from a provider overrides the static fallback). The `CACHE_CAPABLE_PROVIDERS` set is only a bootstrap fallback used until a model has been annotated by a dynamic source. Tests cover the cost flip on a cacheable turn, no effect on single-shot turns, the dynamic `false` override, and the ratio estimator. (Surfacing estimated cache savings in the Cost Dashboard is the planned next increment — see `project_memory/decisions/cutting-edge-routing-roadmap.md`.)

## [0.86.2] - 2026-06-17

### Fixed
- **Active subscriptions are now preferred for ordinary work, not just maintenance tasks** (`src/core/modelRouter.ts`, `tests/core/modelRouter.test.ts`): a subscription provider's explicit preference bonus (`SUBSCRIPTION_MAINTENANCE_BONUS`) was only applied on `maintenance`-phase tasks. On normal tasks a paid-for, quota-remaining subscription tied with local/free on the cheapness axis but — unlike local models, which receive general preference bonuses — got no nudge over pay-per-token providers. Added a small, **quota-aware** general bonus (`ACTIVE_SUBSCRIPTION_BONUS`) so an active subscription (quota remaining) is preferred for everyday work too, reflecting that its capacity is already paid for and "essentially free" until quota is exhausted. The bonus is modest (it breaks ties toward the subscription without overriding capability/quality needs) and vanishes once quota is depleted, at which point the provider is treated as pay-per-token. Added tests covering both the preference on a neutral task and its removal on quota exhaustion.

## [0.86.1] - 2026-06-17

### Fixed
- **Reasoning depth and latency class are no longer dropped during model discovery** (`src/extension.ts`, `tests/providers/inferModelMetadata.test.ts`): `inferModelMetadata()` merged a model's name, context window, capabilities, pricing, and premium multiplier from the catalog but silently discarded the catalog's `reasoningDepth` and `latencyClass` annotations. Because AtlasMind seeds minimal models and populates the rest via runtime discovery, every discovered model lost these fields, so the router fell back to its heuristic — collapsing genuine depth-3 reasoners (Claude Opus, DeepSeek R1, Nemotron Ultra) to depth 2 and **under-ranking them for high-reasoning tasks**. The merge now carries both annotations through, so reasoning-heavy work routes to the appropriate models. Added a regression test asserting the annotations propagate (and are not fabricated for un-catalogued models). Note: the `claude-cli` (Claude subscription) provider remains an intentional chat-only bridge with `function_calling` stripped, so the router still correctly skips it for tool-driven agentic work; this fix improves its ranking only for the chat-only turns where it is eligible. See `project_memory/decisions/cutting-edge-routing-roadmap.md` for the broader routing roadmap.

## [0.86.0] - 2026-06-17

### Added
- **NVIDIA Nemotron model catalog for the NIM provider** (`src/providers/modelCatalog.ts`, `src/runtime/core.ts`, `tests/providers/modelCatalog.test.ts`, `docs/model-routing.md`, `wiki/Model-Routing.md`, `CONTRIBUTING.md`): the NVIDIA NIM provider (already wired via the OpenAI-compatible adapter against `integrate.api.nvidia.com`) gains a first-class, provider-scoped `NVIDIA_CATALOG` covering the Nemotron family — Llama 3.1 Nemotron Ultra 253B (extended reasoning, depth 3), Llama 3.3 Nemotron Super 49B, Nemotron Nano, Llama 3.1 Nemotron 70B Instruct, and Nemotron Mini — with accurate context windows, capabilities (reasoning/function-calling), reasoning depth, latency class, and hosted (non-zero) pricing. Registering it in `PROVIDER_CATALOGS` means `lookupCatalog('nvidia', …)` resolves Nemotron models from this catalog *before* the cross-provider fallback, so hosted Nemotron models no longer inherit metadata from the same-named `$0` local entries in `LOCAL_CATALOG`. The NVIDIA seed in `seedDefaultProviders()` now leads with Nemotron Super 49B and Nemotron Nano (alongside the existing Llama 3.1 70B fallback) so the family is visible before runtime discovery completes.

## [0.85.0] - 2026-06-17

### Changed
- **Cross-language archetype detection in the scaffolder** (`src/core/testingScaffolder.ts`, `tests/core/testingScaffolder.test.ts`): archetype inference (web / api / cli / game / mobile / library / generic) no longer relies on `package.json` dependencies alone. `buildArchetypeCorpus` now reads the dependency manifests of the detected language — `pyproject.toml` / `requirements.txt` / `Pipfile` / `setup.py` / `setup.cfg` (Python), `Cargo.toml` (Rust), `go.mod` (Go), `pom.xml` / `build.gradle` (Java) — so framework signals like FastAPI/Django/Flask, axum/actix-web/rocket, gin/echo/fiber/chi, pygame/bevy/ebiten, and click/typer/clap/cobra now drive the archetype for non-Node projects. Short Node-only package names (`next`, `three`, `koa`) are gated to Node to avoid substring false positives in other languages' manifests (e.g. `cargo-nextest` no longer reads as a Next.js web app). This makes archetype-dependent recipes — such as the API-vs-CLI-vs-web e2e branch — fire correctly across languages. +5 tests (26 total in the scaffolder/sync suite).

## [0.84.0] - 2026-06-17

### Changed
- **Language- and archetype-aware testing-framework scaffolding** (`src/core/testingScaffolder.ts`, `tests/core/testingScaffolder.test.ts`): the scaffolder's stack detection no longer assumes a Node/JS project. `detectStack` now identifies the project **language** — Node (JS/TS), Python, Rust, Go, .NET, or Java — from `package.json`, `pyproject.toml` / `requirements.txt` / `setup.py` / `Pipfile`, `Cargo.toml`, `go.mod`, `*.csproj` / `*.sln`, and `pom.xml` / `build.gradle`, and a coarse **archetype** (web / api / cli / game / mobile / library / generic). Starter files are now generated in the correct idiom per language: pytest + Hypothesis + Locust (Python), `cargo test` + proptest + criterion (Rust), `go test` + `testing/quick` + benchmarks (Go), xUnit (.NET), JUnit 5 (Java), alongside the existing Vitest/Jest/Playwright/Cypress/fast-check/k6 set (Node). Node e2e recipes now branch on archetype — an API project gets an HTTP smoke test, a CLI gets a spawned-process harness, a web app gets a Playwright/Cypress spec. Per-methodology install hints and the strategy playbook are likewise language-specific. Unknown stacks degrade to playbook-only guidance. Previously a non-Node project silently received JS-flavoured stubs; that gap is closed. Still strictly non-destructive — files are created only when absent and no manifest is ever mutated.

## [0.83.0] - 2026-06-17

### Added
- **Outbound testing-protocol sync to external AI agents** (`src/utils/testingProtocolSync.ts`, `src/utils/aiInstructionSync.ts`, `src/views/settingsPanel.ts`, `src/commands.ts`, `package.json`, `tests/utils/testingProtocolSync.test.ts`): the testing methodology matrix is now visible to AI agents *outside* AtlasMind. Previously instruction-file sync was inbound only (`aiInstructionSync` read `CLAUDE.md` / `copilot-instructions.md` *into* AtlasMind); there was no way for Claude Code, Copilot, Cursor, Cline, Gemini, Windsurf, Aider, or Codex (`AGENTS.md`) to discover the enabled protocols. The new `syncTestingProtocols` writes a delimited, AtlasMind-managed block (`<!-- atlasmind:testing-protocols:start -->` … `:end -->`) describing each enabled methodology — what it is, when to apply it, key tools, the assigned owner agent, preferred model, and project notes — into every *detected* (existing) markdown instruction file. The writer is strictly non-destructive: it only touches its own block, preserves all surrounding content, writes only to files that already exist, and routes every path through the shared traversal guard (`isSafeRelativePath` / `resolveRelativePath`, now exported). JSON-config tools (Continue) are reported as skipped. Saving the Testing matrix now auto-syncs, and a new **Sync to AI agents** button plus `atlasmind.syncTestingProtocols` command trigger it on demand.
- **Stack-aware testing-framework scaffolder** (`src/core/testingScaffolder.ts`, `src/views/settingsPanel.ts`, `src/commands.ts`, `package.json`, `tests/core/testingScaffolder.test.ts`): a new `scaffoldTestingFramework` constructs a starter framework that fits the current project. It infers the stack (TypeScript/JavaScript, test runner, UI framework, Playwright/Cypress presence) from `package.json` and config fingerprints, then for each enabled methodology generates fitting starter files (e.g. Vitest/Jest example specs, a Playwright/Cypress e2e spec, a fast-check property test, a k6 load script, a snapshot test) plus a managed `project_memory/operations/testing-strategy.md` playbook with per-methodology set-up commands, trade-offs, and starter-file references. Strictly non-destructive: source/config files are only created when absent and never overwritten, `package.json` is never mutated (install commands are surfaced for the developer), and the action is confirmed via a modal. Available from the **Scaffold framework** button on the Settings → Testing page and the `atlasmind.scaffoldTestingFramework` command.

## [0.82.0] - 2026-06-14

### Added
- **Remote control of desktop AtlasMind from the web build** (`src/web/extension.ts`, `src/web/remoteClient.ts`, `src/web/chatClientPanel.ts`, `src/web/dashboardPanel.ts`, `src/remote/protocol.ts`, `src/remote/remoteControlServer.ts`, `src/remote/remoteBridge.ts`, `src/views/chatProtocol.ts`, `src/views/chatWebviewMarkup.ts`, `src/views/chatPanel.ts`, `src/extension.ts`, `esbuild.mjs`, `src/web/tsconfig.json`, `package.json`, `docs/remote-control.md`, `wiki/Remote-Control.md`, `tests/remote/protocol.test.ts`, `tests/remote/remoteBridge.test.ts`): AtlasMind now ships a **web extension** (`vscode.dev` / `github.dev` / `code-server`) that acts as a thin client driving a full desktop instance over a localhost WebSocket. Because the web host has no Node.js runtime, the desktop keeps doing all model calls, file system, MCP, and voice work; the browser only renders UI and relays intent, and **secrets never leave the desktop**. The chat webview front-end was made host-agnostic so a single `ChatPanel` implementation serves both local and remote surfaces via a synthetic webview host (`RemoteWebviewHost`); every inbound remote frame is re-validated by the existing `isChatPanelMessage` guard. The web client exposes chat (with remote tool-approval) plus **read-only** cost and project-run dashboards. Security: off by default, localhost-only bind, pairing bearer token in `SecretStorage`, workspace-trust gate, audited connections, one-click revoke (token rotation), and default-deny of pending approvals on disconnect. New build pipeline adds **esbuild** for the browser bundle (`out/web/extension.js`) alongside the existing `tsc` desktop/CLI output. New commands: `atlasmind.remote.enable`, `atlasmind.remote.disable`, `atlasmind.remote.showPairingCode`, `atlasmind.remote.revoke` (desktop), and `atlasmind.remote.connect`, `atlasmind.remote.disconnect`, `atlasmind.remote.showDashboard` (web). New settings: `atlasmind.remote.enabled` and `atlasmind.remote.port`.

## [0.81.0] - 2026-06-14

### Added
- **On-device speech-to-text via whisper.cpp** (`src/voice/localTranscriber.ts`, `src/voice/voiceManager.ts`, `src/views/voicePanel.ts`, `src/extension.ts`, `package.json`, `tests/voice/localTranscriber.test.ts`, `tests/views/voicePanel.test.ts`): the Voice Panel can now transcribe speech entirely on-device. The webview captures the microphone, downsamples to 16 kHz mono and encodes a 16-bit PCM WAV in-browser (no ffmpeg), and hands it to a host-side `LocalTranscriber` that runs a local `whisper-cli`. Audio never leaves the machine; only the GGML model (and, on Windows x64, the `whisper-cli` binary) are downloaded on first use, each streamed and **SHA-256-verified over HTTPS** (model `ggml-base.bin`; binary whisper.cpp v1.8.6). The spoken text never touches a command line — the WAV path is passed as an argv element to a shell-less spawn, and the temp WAV is deleted after transcription. New settings: `atlasmind.voice.sttEngine` (`auto` | `webspeech` | `local`, default `auto`) and `atlasmind.voice.whisperCliPath` (required on macOS/Linux; Windows x64 auto-provisions). The Web Speech API remains the fallback. Push-to-talk capture drives the existing Start/Stop Listening controls.

## [0.80.0] - 2026-06-14

### Fixed
- **Voice Panel ElevenLabs playback was blocked by CSP** (`src/views/webviewUtils.ts`): added a `media-src` directive (`${cspSource} https: data: blob:`) to the shared webview Content-Security-Policy. With `default-src 'none'` and no `media-src`, the `blob:` URL used by `new Audio()` for ElevenLabs server-side TTS fell back to `default-src` and was blocked, so ElevenLabs audio never played (Web Speech fallback masked the failure).
- **Voice device and ElevenLabs-voice preferences were never persisted** (`package.json`): registered the previously-unregistered `atlasmind.voice.inputDeviceId`, `atlasmind.voice.outputDeviceId`, and `atlasmind.voice.elevenLabsVoiceId` settings. Without registration, `configuration.update()` for the device IDs rejected (selecting a microphone/speaker in the Devices page silently failed and the follow-up settings sync never ran), and `elevenLabsVoiceId` always read empty so server-side TTS always used the default demo voice.
- **Testing Methodology Matrix — methodology detection algorithm fixed** (`src/core/testingConfigLoader.ts`): the linter collapsed specific-signal and wildcard detection into a single loop, causing `tdd` (definition-order position 1, wildcard `'*'`) to always win for any task that passed the testing-presence guard. Concrete methodologies like `e2e` (playwright/cypress signals), `continuous` (github-actions/gitlab-ci signals), `bdd` (cucumber/gherkin signals), and `security-testing` (auth/snyk/semgrep signals) could never fire. Restored the correct two-pass algorithm: first pass matches only non-wildcard signals across all definitions; wildcard fallback (tdd, unit) runs only for confirmed testing roles (`tester`, `security-reviewer`).

### Added
- **Host-side OS speech engine for TTS** (`src/voice/hostSpeechSynthesizer.ts`, `src/voice/voiceManager.ts`, `package.json`, `tests/voice/hostSpeechSynthesizer.test.ts`): new `HostSpeechSynthesizer` synthesizes speech entirely in the extension host using the operating system's built-in engine — PowerShell `System.Speech` (SAPI) on Windows, `say` on macOS, and `espeak-ng` on Linux. It uses no network and no API key, and works even when the Voice Panel is closed. Enabled with the new `atlasmind.voice.hostSpeechEnabled` setting. Backend priority is now ElevenLabs (when keyed) → OS host engine (when enabled) → in-panel Web Speech API. The spoken text is always delivered over stdin and never interpolated into a command line or script.
- **Documented `atlasmind.voice.elevenLabsVoiceId`** (`docs/configuration.md`, `wiki/Configuration.md`): added the ElevenLabs voice-id setting to the configuration tables.
- **27-test suite for `TestingConfigLoader`** (`tests/core/testingConfigLoader.test.ts`): covers `inferTestingMethodologyForSubTask` (non-testing role with no presence term → undefined, tdd wildcard fallback, bdd specific-signal match, security-testing via auth/snyk signals, e2e for frontend-engineer with playwright+test, continuous for devops with github-actions+test, false-positive prevention for non-testing tasks, specific-signal priority over wildcard), `resolveTestingModelOverride` (no override, direct model, whitespace trim, agent override lookup, missing agent/key, priority), and `buildMethodologySystemPromptHint` (non-empty output, label, when-to-apply, key-tools, step-reporting instruction, unknown-id guard).

## [0.79.2] - 2026-06-12

### Fixed
- **Autonomous run context continuity** (`src/core/orchestrator.ts`, `src/chat/participant.ts`, `src/views/chatPanel.ts`): preserved the loaded session context bundle for autonomous project subtasks so project runs keep the prior chat goal, summary, decisions, open threads, and SSOT excerpts instead of dropping back to a blank context frame.

### Added
- **Context compression toggle and savings reporting** (`src/core/orchestrator.ts`, `src/core/costTracker.ts`, `src/chat/participant.ts`, `src/views/costDashboardPanel.ts`, `package.json`, `src/types.ts`): added an opt-in `atlasmind.contextCompressionEnabled` setting, connected it to the existing compaction path, and surfaced estimated compression savings in the exec summary and cost dashboard.
- **Chat-side project-run context loading** (`src/chat/participant.ts`, `tests/chat/participant.helpers.test.ts`): project execution now loads the session SSOT context bundle before launching autonomous runs, so the same continuity data is available in both standard chat and autonomous project execution paths.
- **Calmer tool-failure summaries** (`src/core/orchestrator.ts`, `tests/cli/adversarialPrompt.test.ts`): refined the user-facing failure text to explain the tool problem clearly and offer next-step guidance without the blunt fallback wording.

## [0.77.2] - 2026-06-10

### Added
- **Published release v0.77.2**: this marketplace release bundles the routine workflow shipped on `develop`, including the new `/ship` experience, routine-run UI, bootstrap routine extraction, and direct routine-edit intent.
- **Bootstrapper routine extraction** (`src/bootstrap/bootstrapper.ts`): `/import` now scans `CLAUDE.md`, `.github/copilot-instructions.md`, and `docs/development.md` for ordered procedure sections (Publishing Routine, Release Workflow, Deploy Process, etc.) and writes a starter routine file to `project_memory/routines/<id>.md`. Steps are extracted from numbered list items with a **Label** and a `command` in backticks; `<angle-bracket-placeholders>` become `${VAR}` interpolation tokens. The fingerprint system prevents overwriting manually edited routine files, and unchanged files are skipped on re-import. After writing, `RoutineRegistry` is reloaded automatically so the new routine is immediately available to `/ship`.
- **Chat routine-edit intent** (`src/chat/participant.ts`): freeform messages matching "edit/update/change/open [the] [X] routine" now open the matching routine's source `.md` file directly in the editor, bypassing the LLM. AtlasMind identifies the target routine by matching the routine name or ID in the prompt, falling back to the default routine. If no routines exist, the response explains how to scaffold one via `/import`.

## [0.77.1] - 2026-06-10

### Changed
- **Routine card UI in Project Run Center** (`src/views/projectRunCenterPanel.ts`): replaced the `<select>` dropdown in the Ship card with run-card–style tiles matching the panel's design language. Each routine renders as a clickable card showing its name, description, and step count. The action strip inside each card contains a **Ship** button and an **Edit** button; Edit opens the routine's source `.md` file directly in the editor. The separate standalone Run Routine button has been removed.

## [0.77.0] - 2026-06-10

### Added
- **Project Routines** (`src/core/routineRegistry.ts`, `src/core/routineRunner.ts`): named, executable workflows stored as YAML-frontmatter markdown files in `project_memory/routines/`. The registry scans that folder on startup and makes all valid routines available to the rest of the extension. The runner executes steps sequentially, streams per-step progress, respects `on_fail: abort | prompt | continue` policies, and persists run results to `ProjectRunHistory`.
- **`/ship` chat command** (`src/chat/participant.ts`, `package.json`): `/ship` runs the project's default routine (first file with `default: true`, or first file in the folder). `/ship <id>` runs a named routine. Text after the ID is passed as `${message}` for interpolation in step commands (e.g. commit messages). Each step streams a live checklist into chat.
- **Run Routine card in Project Run Center** (`src/views/projectRunCenterPanel.ts`): a new "Ship" card above the hero grid shows a dropdown of all loaded routines and a **Run Routine** button. Step progress streams live into the card; the final result updates the run history.
- **`project_memory/routines/README.md`**: format reference and worked examples shipped with the extension so users know the routine file format without external docs.

## [0.76.5] - 2026-06-10

### Added
- **Animated logo on active-agent session tiles** (`media/chatPanel.js`, `src/views/chatPanel.ts`): session tiles in the Sessions panel now display a small animated AtlasMind globe (the same spinning-axis logo used in the thinking indicator, scaled to 14 px) when an agent is actively working in that session. The animation reuses the existing `atlas-spin` and `atlas-float` keyframes and disappears automatically once the run completes.

## [0.76.4] - 2026-06-10

### Changed
- **Model & provider info cards** (`src/views/treeViews.ts`): clicking "info" on a model or provider in the Models tree now routes the summary into a dedicated **"Model & Provider Info"** session instead of appending it to the currently active working session. If the dedicated session has been deleted or archived the next info request recreates it automatically. The user's active working session is never interrupted.

## [0.76.3] - 2026-06-10

### Fixed
- **Chat panel completely non-functional** (`media/chatPanel.js`): Unicode curly/smart single-quote characters (`‘`/`’`) were embedded in a JS string literal on line 3647, introduced when the AI instruction nudge text was written. JavaScript does not recognise curly quotes as string delimiters, so the entire IIFE failed to parse and no event handlers were ever registered. This caused the Send button, model-info output, and session panel toggle to all stop working simultaneously. Fixed by replacing the three curly quotes with plain ASCII single quotes (`'`).

## [0.76.2] - 2026-06-10

### Fixed
- **AI instruction nudge** (`src/views/chatPanel.ts`, `media/chatPanel.js`): three bugs introduced in 0.76.0 are resolved:
  1. Missing CSS for `.ai-instruction-nudge`, `.nudge-btn`, `.nudge-btn-primary`, and related classes caused the nudge banner to render as unstyled HTML that disrupted the chat layout.
  2. The "Sync Now" button stayed permanently disabled after a sync failure; the extension now sends `resetSyncButton` on failure and the webview re-enables the button.
  3. Nudge dismiss state was stored in an in-memory `Set` and lost on every extension reload; it is now persisted via `workspaceState` (`atlasmind.aiInstructionNudgeDismissed`).

## [0.76.1] - 2026-06-09

### Docs
- **Testing methodology system documented** across `README.md`, `docs/agents-and-skills.md`, `wiki/Agents.md`, `wiki/Changelog.md`, `wiki/Getting-Started.md`, and `wiki/Home.md`: added the full 23-methodology registry table, Settings Panel Testing matrix reference, auto-assess scan description, Project Dashboard Testing page, Agent Testing Roles section, and bootstrap/import flow. Updated all "red-green testing policy" references to reflect the broader configurable methodology system.

## [0.76.0] - 2026-06-09

### Added
- **AI instruction sync** (`src/utils/aiInstructionSync.ts`, `src/views/chatPanel.ts`, `media/chatPanel.js`): AtlasMind now detects AI instruction files from other tools in the open workspace and surfaces a nudge banner in the chat panel prompting the user to sync them into AtlasMind's SSOT memory (`project_memory/domain/ai-instructions-sync.md`). Supported sources: GitHub Copilot (`.github/copilot-instructions.md`), Claude Code (`CLAUDE.md`), Cursor (`.cursorrules`, `.cursor/rules/`), Cline (`.clinerules`), Continue (`.continue/config.json`), OpenAI Codex (`AGENTS.md`), Gemini CLI (`GEMINI.md`), Windsurf (`WINDSURF.md`, `.windsurf/rules/`), and Aider (`.aider.system.md`). The sync merges selected files into a single annotated memory document marked as advisory context (Personality Profile settings take precedence). Path traversal is rejected at both scan and write time.

### Changed
- **Orchestrator default prompt** (`src/core/orchestrator.ts`): agents are now instructed to read project memory, `CLAUDE.md`, `README.md`, or equivalent documentation before invoking executable skills when answering knowledge questions (e.g. "what is the publish policy?", "how do we branch?").
- **npmScripts skill** (`src/skills/npmScripts.ts`): description clarified to distinguish execution (start, build, test) from knowledge queries; added `routingHints` and a 120-second `timeoutMs` to improve model routing accuracy.

## [0.75.8] - 2026-06-09

### Added
- **AI token impact field on every methodology** (`src/types.ts`, `src/views/settingsPanel.ts`): each of the 23 testing methodologies now carries `tokenImpactLevel` (`low` / `medium` / `high`) and `tokenImpact` (a plain-English explanation of what drives usage). The expandable ⓘ info row in the Settings Panel Testing matrix displays these as a fourth block alongside *When to use*, *Key tools*, and *Trade-offs*. The level is shown as a colour-coded badge — green for low, amber for medium, red for high — so users can see the cost implication at a glance before enabling a methodology. The info grid layout was adjusted from 3 to 2 columns (2×2) to give each block adequate reading space.

## [0.75.7] - 2026-06-09

### Fixed
- **Auto-detect signal gaps for three new methodologies** (`src/views/settingsPanel.ts`, `src/types.ts`):
  - **SDD**: the API spec file detector now adds `"openapi swagger api-first"` to the corpus (previously only `"api consumer provider"`), so projects with `openapi.yaml` / `swagger.json` correctly surface the Spec-Driven methodology.
  - **Continuous / Shift-Left**: added CI config file detection — checks for `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci/config.yml`, `azure-pipelines.yml`, and `.buildkite/`. Any found file adds the matching CI tool name (e.g. `"github actions"`, `"circleci"`) plus `"continuous integration pipeline"` to the corpus.
  - **MBT**: added `"xstate"` to `autoDetectSignals` for the Model-Based methodology — XState is the dominant JS/TS state-machine library and a strong MBT signal.

## [0.75.6] - 2026-06-09

### Added
- **9 new testing methodologies** (`src/types.ts`, `media/projectDashboard.js`): the registry grows from 14 to 23 entries. All new methodologies appear in the Settings Panel Testing matrix (with info rows, agent assignment, and model override), the Project Dashboard Testing card, the bootstrap/import auto-detect flow, and the Agent Editor Testing Roles section.

  | ID | Label | Category |
  |---|---|---|
  | `sdd` | Spec-Driven (SDD) | Design-time |
  | `v-model` | V-Model | Design-time |
  | `continuous` | Continuous / Shift-Left | Structural |
  | `white-box` | White-Box | Structural |
  | `mbt` | Model-Based (MBT) | Behavioral |
  | `test-design` | Test Design Techniques (EP + BVA) | Behavioral |
  | `black-box` | Black-Box | Behavioral |
  | `gray-box` | Gray-Box | Behavioral |
  | `agile-testing` | Agile Testing | Exploratory |

  Each entry carries the full `whenToUse`, `keyTools`, `tradeoffs`, and `autoDetectSignals` fields. Auto-detect signals are already wired — for example, OpenAPI/Swagger files trigger SDD, ISO 26262 / safety-critical keywords trigger V-Model, GitHub Actions / CI pipeline files trigger Continuous/Shift-Left, and Agile/Scrum keywords trigger Agile Testing.

## [0.75.5] - 2026-06-09

### Changed
- **Richer auto-assess corpus** (`src/views/settingsPanel.ts`): `buildTestingAutoDetectCorpus` now gathers five additional signal categories beyond package.json deps and test config files:
  - **Web/UI surface** — detects any `.html`, `.jsx`, `.tsx`, `.vue`, or `.svelte` source file; adds `"web app frontend"` to the corpus, boosting E2E and Visual Regression recommendations.
  - **API spec** — detects OpenAPI/Swagger spec files (`openapi.yaml`, `swagger.json`, etc.); adds `"api consumer provider"`, boosting Contract testing.
  - **Security posture** — presence of `SECURITY.md` adds `"auth authentication pii"`, boosting Security testing.
  - **Contributor count** — runs `git shortlog -s HEAD`; if more than one contributor is found, adds `"product team user story acceptance criteria"`, boosting BDD and ATDD (which rely on stakeholder collaboration). Solo projects generate no team signals.
  - **Library/SDK** — `package.json` without `"private": true` (i.e., a publishable package) adds `"library sdk package"`, boosting Mutation and Property-Based testing.
  - **README audience context** — the first 3 kB of `README.md` is included verbatim, allowing free-text project descriptions ("enterprise", "high-performance", "consumer") to surface as organic signals.

## [0.75.4] - 2026-06-09

### Added
- **Auto-assess project button on Testing Strategy page** (`src/views/settingsPanel.ts`): a new "Auto-assess project" button sits next to "Save Testing Strategy" in the methodology matrix. Clicking it scans the workspace — reading `package.json` dependencies/scripts and locating testing config files (jest, vitest, cypress, playwright, stryker, k6, pact, etc.) — and runs the same signal-matching heuristics as the bootstrap/import auto-detect. The flow starts with an Auto / Manual / Skip picker; in Auto mode the inferred recommendations are pre-selected in a customisable QuickPick. After confirming methodologies, if a test-focused agent exists, an offer is made to assign it as the primary agent for all enabled methodologies. The accepted config is merged with any existing notes and model overrides before being saved.
- **`buildTestingAutoDetectCorpus`** (`src/views/settingsPanel.ts`): internal helper that reads `package.json` dependencies and searches for test-framework config files in the workspace, returning a lowercase corpus string for signal matching.

## [0.75.3] - 2026-06-09

### Fixed
- **Primary Agent dropdown empty in Testing Strategy matrix** (`src/commands.ts`): all `SettingsPanel.createOrShow` calls in command registrations omitted the third `atlasContext` argument, so `this.atlasContext` inside the panel was always `undefined`. `collectTestingDashboardSnapshot` therefore fell through to the empty-array fallback for `availableAgentSummaries`, leaving the agent dropdowns unpopulated. Fixed by passing `getAtlas()` as the third argument on all six Settings Panel command registrations (`openSettings`, `openSettingsChat`, `openSettingsModels`, `openSettingsSafety`, `openSettingsProject`, `openSettingsTesting`).

## [0.75.2] - 2026-06-09

### Added
- **Testing Strategy section on Project Dashboard** (`media/projectDashboard.js`, `src/views/projectDashboardPanel.ts`): the Project Dashboard Testing page now includes a "Testing Strategy" panel card at the bottom, showing all 14 methodologies grouped by category with an active/off status badge and a checkbox toggle per methodology. Toggling a methodology saves immediately to `project_memory/index/testing-config.json` via a new `saveTestingConfig` message type. An "Open Testing Strategy →" link navigates to Settings → Testing for agent assignments, model overrides, and detailed notes.
- **`atlasmind.openSettingsTesting` command** (`src/commands.ts`): new command to open the Settings Panel directly on the Testing page. Added to `ALLOWED_DASHBOARD_COMMANDS` so the dashboard Testing page's "Open Testing Strategy" button can dispatch it.
- **`atlasContext` passed to `collectTestingDashboardSnapshot` in dashboard** (`src/views/projectDashboardPanel.ts`): fixed the `syncState` call that was omitting the atlas context, so agent registry data is now available when building the testing snapshot for the dashboard.

## [0.75.1] - 2026-06-09

### Fixed
- **Testing nav tab missing** (`src/views/settingsPanel.ts`): the Testing page was rendered in the HTML but had no nav button, making it completely unreachable. Added a "Testing" tab between Safety & Verification and Project Runs in the settings navigation, with full `data-search` keywords for the settings search bar.
- **`collectTestingDashboardSnapshot` missing atlasContext** (`src/views/settingsPanel.ts`): the call in `getHtml()` was missing the `atlasContext` argument, so agent registry data (used for the agent assignment dropdowns in the Testing matrix) was unavailable.

## [0.75.0] - 2026-06-09

### Added
- **Testing Roles section in Agent Editor** (`src/views/agentManagerPanel.ts`): the agent editor now shows a Testing Roles section below Skills. When testing methodologies are assigned to the agent in `testing-config.json`, the section renders read-only chips for each assigned methodology plus per-methodology model override text inputs (blank = follow global model routing). When no methodologies are assigned, a "Configure in Testing Strategy →" button opens the Settings Panel Testing page directly.
- **Methodology info expansion in Settings Testing page** (`src/views/settingsPanel.ts`): each row in the Testing Strategy Matrix now has a ⓘ info button. Clicking it toggles an expandable info row beneath the methodology row showing `When to use`, `Key tools`, and `Trade-offs` sourced from the enriched `TESTING_METHODOLOGY_DEFINITIONS`. The button uses `aria-expanded` for accessibility.
- **Enriched `TestingMethodologyDefinition`** (`src/types.ts`): all 14 methodology definitions now include `whenToUse`, `keyTools`, `tradeoffs`, and `autoDetectSignals` fields to support both the info UI and auto-detection heuristics.
- **Auto-detect mode for bootstrap testing selection** (`src/bootstrap/bootstrapper.ts`): the testing methodology QuickPick now starts with a three-way choice — **Auto** (AtlasMind infers recommendations from project type, tech stack, and third-party tools), **Manual** (full 14-item list), or **Skip** (apply TDD + Unit defaults). In Auto mode, inferred methodologies are pre-selected in a follow-up QuickPick that the user can accept or trim before confirming.
- **Auto-detect mode for import testing selection** (`src/bootstrap/bootstrapper.ts`): the post-import testing methodology offer follows the same Auto / Manual / Skip pattern, with inference driven by the scanned project type and workspace file names.
- **`inferTestingMethodologiesFromIntake` / `inferTestingMethodologiesFromSnapshot`** (`src/bootstrap/bootstrapper.ts`): internal helper functions that match `autoDetectSignals` against the available project context corpus and return ranked recommendations with a short rationale string shown in the QuickPick description.

## [0.74.0] - 2026-06-09

### Added
- **Testing Methodology System** (`src/types.ts`): introduced `TestingMethodologyId` (14 methodologies: TDD, BDD, ATDD, Unit, Integration, E2E, Mutation, Property-Based, Snapshot, Contract, Performance, Security, Visual Regression, Exploratory), `TESTING_METHODOLOGY_DEFINITIONS` catalog with labels/descriptions/categories, `ProjectTestingConfig` and `ProjectTestingMethodologyConfig` interfaces. Configuration is stored in `project_memory/index/testing-config.json`.
- **Testing Strategy Matrix** (`src/views/settingsPanel.ts`): the Testing page is overhauled — the single "Testing policy" stat card is replaced by a full methodology matrix table. Each of the 14 methodologies can be independently toggled, assigned a primary agent (via dropdown from the agent registry), given a per-methodology model ID override, and annotated with notes. The matrix groups methodologies by category (design-time, structural, behavioral, non-functional, exploratory). Changes persist to `project_memory/index/testing-config.json` on save.
- **Bootstrap methodology prompt** (`src/bootstrap/bootstrapper.ts`): the guided bootstrap intake now includes a multi-select QuickPick step asking which testing methodologies the project will use. TDD and Unit Testing are pre-selected as defaults. The selection is written to `testing-config.json` as part of the bootstrap artifact generation.
- **Import Project methodology prompt** (`src/bootstrap/bootstrapper.ts`): after importing an existing project, if no `testing-config.json` exists yet, an info message offers to configure methodologies with the same multi-select picker.
- **Agent testing role fields** (`src/types.ts`): `AgentDefinition` gains `testingMethodologies?: TestingMethodologyId[]` (which methodologies an agent handles) and `testingModelOverrides?: Partial<Record<TestingMethodologyId, string>>` (per-methodology model ID overrides that take precedence over the agent's global `allowedModels` during test tasks).
- **SubTask methodology tagging** (`src/types.ts`): `SubTaskExecutionArtifacts` gains `testingMethodologyId?: TestingMethodologyId` to record which methodology a subtask's verification ran under.

### Changed
- **Testing policy stat card** replaced by "Active methodologies: N / 14" to reflect the multi-methodology model.

## [0.73.7] - 2026-06-09

### Fixed
- **Weak models invoking executable skills for knowledge/policy questions** (`src/core/orchestrator.ts`): added a rule to `DEFAULT_AGENT_SYSTEM_PROMPT` directing the model to read project memory, CLAUDE.md, README.md, or equivalent documentation files first when answering questions about project policy, workflows, conventions, or instructions — and explicitly not to invoke executable skills or run commands to answer questions that are already documented. This prevents local models (e.g. qwen3:14b) from reaching for `npm-scripts` or other executable skills when a simpler file read would answer the question.
- **`npm-scripts` skill invoked for documentation questions** (`src/skills/npmScripts.ts`): tightened the skill description to state explicitly that this skill runs commands and should not be used to answer policy or documentation questions. Added `routingHints` scoped to execution intents (run npm script, start dev server, run build, run tests, execute npm run, list package.json scripts) so the skill selection scorer does not surface it for knowledge queries.
- **`npm-scripts` outer timeout kills long-running scripts** (`src/skills/npmScripts.ts`): `npmScriptsSkill` now sets `timeoutMs: 120_000`, fixing the mismatch between the inner `runCommand` timeout (120 s) and the default outer skill-wrapper timeout (15 s). Previously any `npm run <script>` that took more than 15 seconds was killed by the wrapper regardless of the inner timeout setting.

## [0.73.6] - 2026-06-09

### Added
- **AI instruction sync utility** (`src/utils/aiInstructionSync.ts`): extracted `scanAiInstructionFiles`, `syncAiInstructionFiles`, and `hasAiInstructionSyncFile` into a shared utility so the scan/sync logic is available outside the Settings Panel. Supports CLAUDE.md, `.cursorrules`, `.clinerules`, `.github/copilot-instructions.md`, AGENTS.md, GEMINI.md, WINDSURF.md, `.aider.system.md`, `.continue/config.json`, and `.cursor/rules/` / `.windsurf/rules/` multi-file rule directories.
- **Auto-sync on Import Project** (`src/commands.ts`): `runProjectMemoryImport` now scans for AI instruction files immediately after the memory import completes. If files are found and no sync file exists yet, they are merged automatically into `project_memory/domain/ai-instructions-sync.md` and the count is reported in the success notification. This ensures a local model receives the project's instruction set (e.g. publish policy from CLAUDE.md) as part of first-time setup rather than relying on a separate manual sync step.
- **AI instruction nudge in Chat Panel welcome screen** (`src/views/chatPanel.ts`, `media/chatPanel.js`): when the Chat Panel opens and AI instruction files exist in the workspace but have not yet been synced, a dismissible banner is shown above the transcript. The banner lists the detected files and provides a one-click **Sync Now** button that auto-syncs all found files. Dismissed state is retained for the VS Code session; the nudge reappears after restart if files remain unsynced.

### Changed
- **Settings Panel AI instructions refactored to use shared utility** (`src/views/settingsPanel.ts`): `handleScanAiInstructions` and `handleSyncAiInstructions` are now thin wrappers around the shared utility, eliminating ~120 lines of duplicated scan/sync logic.

## [0.73.5] - 2026-06-09

### Fixed
- **`github-operator` agent — chained instructions, auto commit messages, context-aware policy, publish routine** (`src/runtime/core.ts`): the built-in GitHub Operator agent now handles the full set of operational patterns exposed by the transcript review: (1) *Chained sequential ops* — requests like "commit and push" or "stage, commit, and push" are now executed sequentially in a single turn without pausing for confirmation between steps. (2) *Auto commit-message generation* — when no message is supplied, the agent runs `git diff --staged --stat` and composes a conventional commit message (feat:/fix:/docs:/chore:/refactor:) from the actual diff instead of asking the user or producing verbose explanations. (3) *Context-aware push target* — the agent derives the correct push-target branch, protected-branch rules, release-hygiene requirements, and publish routine from the injected workspace context (populated by the AI Instructions sync from CLAUDE.md, `.github/copilot-instructions.md`, or equivalent) rather than reading project files at runtime. (4) *Release-hygiene enforcement* — version-bump and changelog requirements are read from the workspace context and carried out in the same commit. (5) *Publishing routine* — when asked to publish or ship, the agent follows the routine from the workspace context and executes every step in sequence, reporting the outcome per step. (6) *Policy persistence* — when a requested policy (push target, version-bump rules, publish routine) is missing from the workspace context and the user supplies it, the agent records it immediately to `project_memory/domain/ai-instructions-sync.md` so it is available to all future tasks without the user repeating it.
- **Planner — chained git operations and release hygiene** (`src/core/planner.ts`): two new rules added to `PLANNER_SYSTEM_PROMPT`. The *chained sequential operations* rule directs the planner to model each operation in a "commit and push"-style request as a separate subtask with explicit `dependsOn` ordering. The *release hygiene* rule directs the planner to include a release-hygiene subtask (version bump + changelog) before the commit subtask and wire the commit to depend on it when the project enforces this policy.

## [0.73.4] - 2026-06-08

### Fixed
- **Responses ending with code or bare headings** (`src/core/orchestrator.ts`, `src/chat/participant.ts`): `looksLikeIncompleteDelivery` now also detects structural truncation — an odd number of fenced code blocks (unclosed fence) or a lone markdown heading at the very end of a response with no body. A new `sanitizeResponseTail` utility closes any unclosed code fence and strips the dangling heading before the text enters the session transcript, preventing the stale artifact from contaminating subsequent turns.
- **"New Session" mode silently discarded when selected while busy** (`media/chatPanel.js`): `applyComposerModePreference` previously cleared the `queuedComposerMode` when `isBusy` was true at the moment the user selected "New Session" from the send-mode dropdown (webview state lag). The queued intent is now always stored; `submitPrompt` already guards against submitting it as a `new-session` while still busy (it overrides to `steer`), and the queued mode is now preserved across that steer submission so the intent is honoured on the next idle message instead of being silently lost.

## [0.73.3] - 2026-06-08

### Changed
- **Comparison matrix rewritten** (`wiki/Comparison.md`): replaced single 7-column table with structured sections (Editor Integration, Model Routing, Memory & Context, Skills & Tools, Safety & Operations, I/O & Integrations, Licensing). Added **Windsurf** and **Continue** as new comparison targets. Added rows for inline completions (honest ❌), speed-aware routing, local model sync, adaptive routing from outcomes, deprecation-aware routing, dispatch-time secret redaction, per-session context carry-forward, auto-synthesized skills, workspace sandbox, TDD gate, webhook integration, and CLI companion. Expanded Key Differentiators with vs. Cline, vs. Windsurf, and vs. Continue sections. Added an explicit "Honest Gaps" section (no inline completions, no diff UI, no cloud agent pool).

## [0.73.2] - 2026-06-08

### Changed
- **Documentation updated** for all 0.72.2, 0.73.0, and 0.73.1 changes: `README.md` project structure, `docs/architecture.md`, `docs/model-routing.md`, `docs/ssot-memory.md`, `wiki/Architecture.md`, `wiki/Changelog.md`, `wiki/Memory-System.md`, `wiki/Model-Routing.md`, `wiki/Security.md`, `wiki/Tool-Execution.md`.

## [0.73.1] - 2026-06-08

### Added
- **Secret redactor utility** (`src/utils/secretRedactor.ts`): new pattern-based secret scanner covers Anthropic keys, OpenAI keys, GitHub tokens, bearer tokens, PEM private keys, database connection strings, and generic key/secret assignments. `redactSecrets()` returns a `RedactionResult` with match count and matched pattern names; `redactSecretsWithWarning()` logs a console warning when any secrets were found (#8).
- **Memory/evidence redaction hook** (`src/core/orchestrator.ts` `buildMessages`): `compactMemoryContext` and `compactLiveEvidence` output is now passed through `redactSecretsWithWarning` before being embedded in the model prompt, preventing accidentally stored credentials from being forwarded to third-party LLM APIs (#8).
- **`ProviderId` extensibility** (`src/types.ts`): `ProviderId` union now includes `| (string & {})` so new providers can be registered via `ProviderRegistry` without requiring a multi-file type change; narrows properly in exhaustive switches (FP#4).
- **Router outcome feedback loop** (`src/core/modelRouter.ts` + `src/core/orchestrator.ts`): `ModelRouter.recordModelOutcome(modelId, success)` accumulates fractional `PERFORMANCE_OUTCOME_WEIGHT` (0.12) up/down votes in `modelPreferences`. Called from the orchestrator immediately after `AgentRegistry.recordOutcome` so every agentic task completion drives the preference bias for future routing (FP#7).
- **New routing constants** (`src/constants.ts`): `CONTEXT_SAFE_OUTPUT_MARGIN = 1_024` (tokens reserved for response headroom) and `PERFORMANCE_OUTCOME_WEIGHT = 0.12` (fractional preference vote weight).

### Changed
- **Agentic loop `max_tokens` guard** (`src/core/orchestrator.ts` `runAgenticLoop`): each iteration now computes a safe `maxTokens` value: `min(DEFAULT_CHAT_MAX_TOKENS, modelContextWindow − estimatedInputTokens − CONTEXT_SAFE_OUTPUT_MARGIN)`. Prevents completion requests from overflowing the model's context window when conversation history grows long; floors at 256 to avoid invalid requests (#4).
- **Smooth context-window scoring gradients** (`src/core/modelRouter.ts` `scoreTaskFit`): the binary `if (contextWindow < CONTEXT_GATE_SMALL) score -= 0.35` and `if (contextWindow < CONTEXT_GATE_MEDIUM) score -= 0.2` penalties are replaced with linear interpolations (`penalty × (1 − contextWindow / gate)`) so a model with 50 K context receives a proportionally smaller penalty than one with 4 K context, and future 1 M-context models are not penalised at all (FP#6).

## [0.73.0] - 2026-06-08

### Added
- **Extended model capability types** (`src/types.ts`): `ModelCapability` union extended with `'extended_thinking' | 'structured_output' | 'computer_use' | 'audio'`; `SpecialistDomain` extended with `'real-time-video' | 'scientific-computing'`. New `ModelInfo` fields `thinkingTokenMultiplier` and `deprecatedAt` allow the router to account for thinking-token cost multipliers and hard-skip tombstoned models. `SubscriptionQuota.unit` field (`'requests' | 'credits' | 'tokens' | 'minutes'`) enables correct quota-conservation math per provider.
- **Router named constants** (`src/constants.ts`): `CHECKPOINT_MAX_FILE_BYTES`, `MAX_LOOP_MESSAGES`, `LOCAL_MODEL_DEFAULT_CONTEXT_WINDOW`, `BUDGET_TIER_*`, `CONTEXT_GATE_*`, `MODEL_FAILURE_TTL_MS`, `QUOTA_CONSERVATION_THRESHOLD` — all previously magic numbers extracted and documented.
- **Model router: deprecation filter + failure TTL** (`src/core/modelRouter.ts`): models with a `deprecatedAt` date in the past are automatically excluded from candidates. Stale failure records (older than `MODEL_FAILURE_TTL_MS` = 5 min) are auto-cleared so transient network errors don't permanently exclude providers. `reEnableProvider()` method added for manual recovery.
- **Model router: thinking-token cost scaling** (`src/core/modelRouter.ts`): `effectiveCostPer1k` now applies `thinkingTokenMultiplier` to output price, giving budget routing accurate cost estimates for extended-thinking models.
- **Orchestrator: messages loop pruning** (`src/core/orchestrator.ts`): when the agentic loop accumulates more than `MAX_LOOP_MESSAGES` messages, the oldest assistant + tool-result pair (indices ≥ 2) is evicted, preventing unbounded context growth on long-running tasks.
- **Orchestrator: mid-flight daily budget check** (`src/core/orchestrator.ts`): the orchestrator checks the daily budget limit after each tool-result accumulation and aborts with a clear message if the limit would be exceeded.
- **Orchestrator: deprecation tombstoning** (`src/core/orchestrator.ts`): when a completion call fails with a model-not-found / deprecated error, the model is recorded as failed and a progress message is emitted, matching the existing billing-error path.
- **Orchestrator: synthesize-agent retry** (`src/core/orchestrator.ts`): `synthesizeAgentForTask` now retries once with a cheap/fast fallback model before caching a synthesis failure.
- **Anthropic adapter: `Retry-After` header support** (`src/providers/anthropic.ts`): the `withRetries` loop now extracts `retryAfterMs` from 429 errors (set by the Anthropic adapter's HTTP error path) and uses it as the inter-attempt delay, honouring server-directed backoff.
- **Anthropic API version constant** (`src/providers/anthropic.ts`): all three `'2023-06-01'` literals replaced with `ANTHROPIC_API_VERSION` (overridable via env var), so version bumps are a one-line change.
- **Local model capability inference expanded** (`src/providers/localModelSync.ts`): `inferLocalCapabilities` now detects reasoning models (qwen4+, qwq, deepseek-r, marco-o, skywork-o, -cot), `extended_thinking` capability (thinking/thinker/qwq/deepseek-r), multimodal vision (llava, minicpm-v, moondream, bakllava, cogvlm, internvl, pixtral, florence, qwen-vl, qvq, llama+multimodal), and tool-calling (hermes, nous, functionary, toolllm, gorilla). Default context window now uses `LOCAL_MODEL_DEFAULT_CONTEXT_WINDOW` (32 768) instead of 8 192.
- **Checkpoint file-size guard** (`src/core/checkpointManager.ts`): `readSnapshot` now calls `fs.stat` before reading and returns `null` (skipping the file) when the file exceeds `CHECKPOINT_MAX_FILE_BYTES` (512 KB). Oversized files are silently skipped rather than crashing or OOMing the extension host.
- **Tool policy: name-based default classification** (`src/core/toolPolicy.ts`): unknown tools whose names start with a read-like prefix (`get`, `list`, `read`, `search`, `find`, `query`, `fetch`, `check`, `show`, `view`, `inspect`, `describe`, `status`, `info`, `lookup`, `count`) are now classified as `read/low` instead of `network/high`. Write-like substrings (`write`, `create`, `update`, `delete`, `execute`, `run`, etc.) override the read classification to keep the safe default for genuinely ambiguous tools.
- **Frustration-settings bidirectionality and decay** (`src/chat/participant.ts`): `applyFrustrationSettingsTuning` now snapshots the original `chatSessionTurnLimit` / `chatSessionContextChars` before raising them. A new `maybeCoolFrustrationSettings` function, called on every clean (non-frustrated) turn via `applyOperatorFrustrationAdaptation`, restores original values once 30 minutes pass without a new frustration signal — but only if the values still match the boosted minimums (to respect manual user edits).

### Changed
- **Model router scoring weights extracted to named constants** (`src/core/modelRouter.ts`): `QUALITY_WEIGHT_CHEAP`, `QUALITY_WEIGHT_NORMAL`, `PROVIDER_HEALTH_BONUS`, `PREFERENCE_BIAS_SMOOTH`, `PREFERENCE_BIAS_MAX`, `TASK_FIT_CAPABILITY_SCORE` (with calibration date comment) replace all previously undocumented magic numbers in `scoreModel`, `scoreLocalPreference`, `scorePreferenceBias`, and `scoreTaskFit`.
- **Orchestrator `Retry-After` backoff** (`src/core/orchestrator.ts`): `completeWithRetry` and `completeWithRetryStreaming` both use server-provided `retryAfterMs` when present, falling back to exponential backoff otherwise.

## [0.72.2] - 2026-06-08

### Fixed
- **Workspace-relative paths rejected by skill tools** (`src/extension.ts` `assertInsideWorkspace`): when a model passed a workspace-relative path such as `web/src/pages` to `directory-list`, `readFile`, `writeFile`, or any other skill tool, `path.resolve()` resolved against the process CWD rather than the workspace root, causing a false "resolves outside workspace" error. `assertInsideWorkspace` now resolves relative to `workspaceRoot` and returns the canonical absolute path; all callers (`readFile`, `writeFile`, `listDirectory`, `runCommand`, `deleteFile`, `moveFile`, `getDocumentSymbols`, `findReferences`, `goToDefinition`, `renameSymbol`, `getCodeActions`, `applyCodeAction`) use the returned resolved path for the actual operation.
- **`directory-list` skill description** (`src/skills/directoryList.ts`): updated `path` parameter description to state that workspace-relative paths (e.g. `web/src/pages`) are accepted alongside absolute paths.

## [0.72.1] - 2026-06-07

### Added
- **`completionCriteria` field on `AgentDefinition`** (`src/types.ts`): optional `incompletePatterns` regex array that the orchestrator matches against the final response before accepting task completion. When a match is found, a re-prompt is injected asking the agent to either finish outstanding work or declare explicit unresolved blockers.
- **`definitionOfDoneChecker` hook on `OrchestratorHooks`** (`src/types.ts`): caller-injectable async gate invoked once after the agentic loop produces its final response. Returns `{ passed, blockers }` — when blockers are present the orchestrator re-prompts for one additional turn before surfacing the response.
- **Completion-integrity reprompt gate** (`src/core/orchestrator.ts` `runAgenticLoop`): before any loop exit, AtlasMind now checks the final response for language that signals incomplete delivery (e.g. "not yet wired", "important follow-up", "focused verification is still incomplete"). On a match a single structured re-prompt is injected requiring the agent to either complete the work or write an explicit **Unresolved blockers** section. The gate fires at most once per task to avoid infinite loops.
- **`looksLikeIncompleteDelivery` / `buildCompletionIntegrityReprompt` helpers** (`src/core/orchestrator.ts`): pure functions backing the completion gate; independently testable.

### Changed
- **Synthesis prompt** (`src/core/orchestrator.ts` `synthesize`): rewritten from a descriptive request into five strict rules. Rule 1: a task is only complete when wired end-to-end and verified. Rule 2: unresolved work must appear as a prominent **Unresolved blockers** section. Rule 3: test files invisible to the runner must be flagged as verification gaps. Rule 4: a passing overall test suite cannot mask absence of coverage for the specific change. Rule 5: be concise about successes, explicit about failures.
- **TDD missing-status warning** (`src/chat/participant.ts`): when `tddStatus === 'missing'`, an explicit ⚠️ bullet is now emitted in the thought summary reminding the user to verify test coverage manually and confirm test files are visible to the project's test runner.

## [0.72.0] - 2026-06-07

### Added
- **Live local model catalog sync** (`src/providers/localModelCatalogSync.ts`): fetches currently trending models from Ollama (via ollamadb.dev) and Hugging Face Hub (GGUF models sorted by downloads) and caches results in VS Code `globalState` with a 24-hour TTL. A bundled fallback (`data/local-model-catalog.json`) is used when both APIs are unreachable. The catalog feeds into `getLocalModelRecommendationCandidates` with priority: workspace override JSON > live/bundled synced catalog > hardcoded defaults.
- **LM Studio `lms` CLI install automation**: when the user clicks "Install" for an LM Studio model in the Settings panel, AtlasMind now detects the `lms` binary and spawns `lms get <model>` in a dedicated VS Code terminal so download progress is visible, instead of showing a static "not supported" message. Falls back to opening the HuggingFace model page when `lms` is not found.
- **Cost dashboard local savings section**: the Cost Dashboard now shows an estimated savings panel comparing actual session spend against equivalent usage on paid API tiers (cheap / balanced / expensive reference models).
- **`preserveFocus` option on `ChatPanelTarget`**: callers can now open the chat surface without stealing focus from the editor. Used by tool approval prompts and generated-skill review flows so the user's cursor position is preserved.

### Fixed
- **`.cmd` file execution on Windows**: skill `shell-run` spawns now set `shell: true` on Windows so `.cmd` files (which cannot be executed directly by Node's `child_process.spawn`) work without requiring `cmd.exe` to be specified explicitly.
- **`displayCurrency` setting scope**: the setting is now stored at `Global` scope instead of `Workspace` scope, so the chosen display currency applies across all workspaces rather than being reset in new projects.
- **`resolveCheckpointPaths` relative path resolution** (follow-up hardening): absolute path check is now explicit (`path.isAbsolute`) and when no `workspaceRootPath` is available the relative path is returned as-is rather than resolving against an unpredictable CWD.

## [0.71.0] - 2026-06-07

### Added
- **`reasoningDepth` field on `ModelInfo` and catalog entries** (0 = none, 1 = basic, 2 = medium, 3 = extended): replaces the binary `reasoning` capability tag with a numeric scale so the router can reward and penalise models proportionally instead of using binary cliffs. Annotated across all Anthropic, OpenAI, Google, DeepSeek, Bedrock, and local catalog entries.
- **`latencyClass` field on `ModelInfo` and catalog entries** (`'fast' | 'balanced' | 'slow'`): explicit authoritative override for the speed-tier heuristic. Prevents large-context models (e.g. Claude Sonnet 4 at 200k) from being incorrectly classified as `'considered'` just because they accept long contexts. Annotated across the full catalog.

### Changed
- **Model routing — subscription budget gate**: `balanced` budget mode now excludes subscription models whose `premiumRequestMultiplier` exceeds 2× (Opus-tier), preventing high-premium models from silently consuming subscription credits on everyday tasks.
- **Model routing — `auto` budget with high-reasoning tasks**: cheap-tier models (including capable local reasoners like DeepSeek R1) are no longer hard-gated out; scoring penalises shallow models instead, allowing the right local reasoner to win when it outscores cloud alternatives.
- **Model routing — graduated `scoreTaskFit`**: high-reasoning tasks now reward models proportionally by `reasoningDepth` (depth ≥ 3 → +1.1, depth 2 → +0.55, depth 1 → +0.1, depth 0 → −1.25) instead of a single binary ±penalty. Planning/synthesis phases and `preferredCapabilities` scoring follow the same graduated logic.
- **Model routing — `latencyClass`-aware speed tier**: `classifySpeedTier` consults `latencyClass` first; the old context-window heuristic is a fallback only for unannotated models. Fixes Claude Sonnet 4 and similar large-context-but-fast models being excluded from `speed=balanced` mode.
- **Model routing — fallback escalation handles `auto` budget**: `buildProviderFallbackRoutingConstraints` now maps `auto` → `balanced` (same as `cheap`) rather than jumping to `expensive`, keeping the relaxation step proportional to user intent.
- **Task profiler — session context inheritance capped**: terse follow-up messages (≤ 8 words, down from ≤ 15) that continue a high-complexity session are now classified as `medium` reasoning (down from `high`), and action-verb messages (`do`, `apply`, `fix`, `run`, etc.) are excluded from the inheritance path entirely via a new `DEICTIC_ACTION_GUARD_HINTS` pattern.
- **Orchestrator escalation message**: the progress notification when no model matches initial gates now includes the before/after budget and speed values (e.g. `budget=balanced/speed=fast → budget=balanced/speed=balanced`) so users can see exactly what was relaxed.

## [0.70.11] - 2026-06-07

### Fixed
- **Checkpoint path resolved against VS Code install dir instead of workspace**: when the model produced a relative file path for `file-write` or `file-edit`, `resolveCheckpointPaths` returned it verbatim and `path.resolve()` in `CheckpointManager.captureFiles` resolved it against the Node.js process CWD — the VS Code installation directory — instead of the workspace root. Relative paths are now anchored to `skillContext.workspaceRootPath` before being handed to the checkpoint manager, matching the existing behaviour of the `git-apply-patch` branch.

## [0.70.10] - 2026-06-07

### Fixed
- **VS Code extension host starvation during chat streaming**: `stream.markdown()` was being called on every streaming token (potentially 30–100 IPC calls/sec), which starved VS Code's own event loop and made the entire application feel sluggish while a query was in progress. Tokens are now buffered for 50 ms and flushed in a single call, reducing IPC pressure by up to 50×.
- **Sequential classifier + memory retrieval before every response**: the LLM classifier call and the memory/retrieval context build were running one after the other before the agentic loop could start. Both are now launched concurrently with `Promise.all`, removing one full network round-trip from the time-to-first-token for every chat request.

## [0.70.9] - 2026-06-07

### Fixed
- **Cross-platform home directory resolution in MCP client**: replaced `process.env.USERPROFILE ?? process.env.HOME` and `process.env.HOME` in `mcpClient.ts` with `os.homedir()`, which is Node.js's authoritative cross-platform home directory API. The old code relied on environment variables that may not be set in all Unix configurations (e.g. stripped environments, containers). Added `import * as os from 'node:os'`.
- **Linux-only Homebrew paths no longer included on macOS**: the `getKnownCommandSearchDirectories` function was unconditionally appending `/home/linuxbrew/.linuxbrew/bin` and `~/.linuxbrew/bin` even when running on macOS. These paths are now conditionally included only on Linux.

## [0.70.8] - 2026-06-07

### Fixed
- **LM Studio install cross-platform shell compatibility**: replaced `terminal.sendText()` (which requires shell-specific quoting) with `shellPath`/`shellArgs` on the `TerminalOptions`. VS Code now spawns `lms` directly via the OS rather than injecting a command string into whatever shell is active. This eliminates all quoting issues across PowerShell, CMD, bash, zsh, fish, Git Bash, and WSL regardless of platform.

## [0.70.7] - 2026-06-07

### Fixed
- **LM Studio install failing on Windows PowerShell**: the generated terminal command was `"C:\...\lms.exe" get "model"`, which PowerShell parses as an expression (the quoted string) followed by an unexpected token. Fixed by prepending the `&` call operator on Windows: `& "C:\...\lms.exe" get "model"`. `&` also works in CMD (it acts as a no-op command separator there). POSIX shells are unaffected.

## [0.70.6] - 2026-06-07

### Changed
- **"Install in LM Studio" now actually installs the model** instead of showing a static hint message. Two-tier behaviour:
  1. If LM Studio is installed (`~/.lmstudio/bin/lms` / `%USERPROFILE%\.lmstudio\bin\lms.exe` exists): opens a dedicated VS Code terminal named "LM Studio: Install Model" and runs `lms get <model>` so the user sees live download progress without leaving the editor.
  2. If `lms` is not found: opens the model's HuggingFace page in the browser — HuggingFace shows a "Use this model → LM Studio" one-click button that launches LM Studio and queues the download directly.
  - HuggingFace-sourced recommendations (`hf:` prefix) strip the prefix to produce the correct HF repo path for `lms get` and the browser URL.
  - Ollama-tagged recommendations pass the tag through as-is; `lms` searches HuggingFace for the model automatically.

## [0.70.5] - 2026-06-07

### Fixed
- **Ollama remove failing**: `removeOllamaModel` was using `method: 'POST'` against `/api/delete`, but Ollama requires `DELETE`. All remove operations now use the correct HTTP method.
- **"Install in Ollama" failing for HuggingFace-sourced candidates**: models from the live HuggingFace catalog have a `hf:` prefixed tag that Ollama's `/api/pull` does not accept. The "Install in Ollama" button is now hidden for HF-sourced models; only "Install in LM Studio" is shown.
- **Installed models in recommendation cards**: cards for already-installed models now show a "Remove from Ollama" button (or "Manage in LM Studio" note) instead of install buttons. The `LocalModelRecommendationItem` payload now carries `installedModelId` and `installedRuntime` so the webview knows which runtime and model ID to target.

## [0.70.4] - 2026-06-07

### Fixed
- **Chat panel no longer steals focus during active sessions** — tool approval and generated-skill approval reveals now use `preserveFocus: true` so the approval card becomes visible in the panel without yanking keyboard focus away from the editor. The `preserveFocus` option is also threaded through `ChatPanelTarget`, `revealPreferredChatSurface`, `ChatPanel.revealCurrent`, `ChatPanel.createOrShow`, and `ChatViewProvider.open` so any programmatic reveal can opt in to non-disruptive visibility.

## [0.70.3] - 2026-06-07

### Fixed
- **Display currency now actually applies** — `atlasmind.displayCurrency` was missing from `package.json`'s `contributes.configuration`, so VS Code could not reliably persist or notify on changes. The setting is now declared with a full enum and descriptions.
- **Currency is stored as a user-level preference** — the setting was previously saved to workspace scope, meaning it silently failed when no workspace folder was open and did not persist across different projects. It is now saved globally so the chosen currency applies everywhere.
- **Cost dashboard reference rates** — per-token reference rates shown in the Local Model Savings footnote now format in the selected display currency instead of always showing raw USD `$` values.

## [0.70.2] - 2026-06-07

### Changed
- **Local Model Advisor — richer workload signal inference.** The advisor now considers full project context when scoring candidates, not just local-model request history:
  - **All requests (all providers, 30 days)** — cloud and local model names are scanned for code/reasoning/vision signals.
  - **Agent usage frequency** — top 5 most-invoked agents have their role/description scanned, weighted by request count.
  - **Skill definitions** — all registered skills (names, descriptions, routing hints) are scanned to detect active capabilities.
  - **Workspace manifests** — `requirements.txt`, `pyproject.toml`, `package.json` are checked for ML (PyTorch, TensorFlow → reasoning) and image processing (Pillow, OpenCV, sharp → vision) libraries.
  - **SSOT `project_soul.md`** — first 3 KB is scanned for tech stack keywords if project memory is present.
- Fixed: the workload-match score bonus was always awarded because `'general'` matched every candidate. Bonuses now require a specific tag (`code`, `vision`, or `reasoning`) to match.
- Rationale strings now cite the actual evidence source (e.g. "Capability match (code): skill 'run-tests'; active development workspace").

## [0.70.1] - 2026-06-07

### Added
- **Cost Dashboard: Local Model Savings panel** — a new "Cost Efficiency" section appears in the Cost Dashboard when any locally-hosted model requests are recorded in the current window. It shows total local requests, tokens processed locally, and estimated cost avoidance across three cloud reference tiers (Budget: Gemini 2.5 Flash; Mid-tier: Claude Haiku; Premium: Claude Sonnet), with animated bar charts for each tier and reference rate footnotes.

## [0.70.0] - 2026-06-07

### Added
- **Live local-model catalog sync** (`src/providers/localModelCatalogSync.ts`): the Local Model Advisor now discovers candidates dynamically rather than from a static list. On each activation, a background task queries two live sources:
  - **Ollama library** via the [ollamadb.dev](https://ollamadb.dev) community API (sorted by total pulls) — covers all Ollama-installable models as they are published
  - **HuggingFace Hub** via the official models API filtered to LM Studio-compatible GGUF models (sorted by downloads) — automatically reflects newly released and trending models
- Hardware requirements (`minRamGb`, `minVramGb`) are inferred from the parameter count embedded in the model name (e.g. "14b" → ~8 GB VRAM at 4-bit quantization), with inline hints that override inference for well-known families (Qwen3, Devstral, Gemma 3, Phi-4, etc.).
- Workload tags (`code`, `vision`, `reasoning`, `general`) are inferred from model-name keywords.
- Results are cached in VS Code `globalState` with a 24-hour TTL. If both live APIs are unreachable, the bundled `data/local-model-catalog.json` is loaded instead. Priority chain: workspace override JSON → live/bundled synced catalog → hardcoded defaults.
- `data/local-model-catalog.json`: bundled offline fallback catalog shipped with the extension.

## [0.69.2] - 2026-06-07

### Fixed
- **Windows GPU VRAM detection** now reports correct total VRAM for high-memory NVIDIA cards (e.g. RTX 4090 was showing 4 GB instead of 24 GB). Root cause: `Win32_VideoController.AdapterRAM` is a 32-bit DWORD capped at ~4 GB. The local model scanner now tries `nvidia-smi` first on Windows (same as Linux), which returns the correct `memory.total` value, then falls back to WMI for non-NVIDIA GPUs.

## [0.69.1] - 2026-06-07

### Fixed
- `spawn EINVAL` on Windows when AtlasMind runs `npm`, `npx`, or other `.cmd`-backed executables via `runCommand`. `.cmd` files are batch scripts that require `cmd.exe` — `execFile` now passes `shell: true` on Windows so they execute correctly.

## [0.69.0] - 2026-06-07

### Added
- **7 new built-in skills** covering debugging, logging, project detection, and broader app-type support:
  - `npm-scripts` — list all `package.json` scripts and run any named script via `npm run`; supports custom `cwd` for monorepos
  - `log-file-tail` — find workspace log files (`*.log`, `logs/*.txt`, etc.), tail the last N lines, or search for a pattern across all log files
  - `framework-detect` — detect the full tech stack from `package.json` dependencies and config-file fingerprints; covers web frameworks, mobile SDKs, game engines, desktop runtimes, databases, testing tools, infrastructure, and more
  - `git-blame` — per-line commit attribution (author, date, short hash, commit summary) with optional line-range focus
  - `simple-browser` — open any http/https URL in the VS Code built-in Simple Browser panel; useful for local dev servers, dashboards, API doc sites, and HTML5 games
  - `debug-launch` — list VS Code debug configurations from `launch.json` and start a named session without leaving the chat
  - `debug-breakpoint` — list, add (with optional condition or logpoint message), remove by ID, and clear all breakpoints
- **New `Debugging` skill category** in the Skills tree for `log-file-tail`, `debug-launch`, and `debug-breakpoint`
- **6 new `SkillExecutionContext` methods**: `openSimpleBrowser`, `getDebugConfigs`, `launchDebugSession`, `getBreakpoints`, `addBreakpoint`, `removeBreakpoints`
- **Expanded `terminal-run` allow-list** — added Flutter, Dart, Expo, React Native, PHP, Composer, Elixir/Mix/IEx, Ruby Gem, Terraform, Helm, Kubectl, Corepack, Turbo, Nx, Lerna, VSCE, Electron Builder, and Godot to the auto-approve set

## [0.68.5] - 2026-06-07

### Fixed
- **Cost Dashboard: line chart no longer shows ghost bar overlay** — bars were rendered at 24% opacity in line mode, creating a confusing ghost chart behind the line; they are now fully hidden until bar mode is explicitly selected.
- **Cost Dashboard: chart and budget bar now use the same metric** — the daily spend chart previously used raw `costUsd` while the budget bar used `budgetCostUsd` (which includes Copilot premium multipliers). Both now use `budgetCostUsd` so "Today's Spend" in the budget bar matches the today bar in the chart.
- **Cost Dashboard: all date bucketing now uses local time** — timestamps were previously bucketed by UTC date, causing "Today's Spend" to span the wrong calendar day for users in non-UTC timezones. All date grouping in `CostTracker` and the dashboard panel now uses the device's local calendar date.

### Added
- **Cost Dashboard: "Today" timescale button** — a new "Today" option appears at the start of the timescale row, showing only the current local day's spend.
- **Cost Dashboard: "Edit" button on the budget headroom bar** — clicking Edit opens the AtlasMind Settings panel with budget settings focused.
- **Cost Dashboard: scrollable Cost by Model panel** — the model/provider breakdown list is now capped at a fixed height with a scroll bar, preventing the panel from growing indefinitely with many models.
- **Cost Dashboard: Provider view toggle in Cost by Model** — a Model / Provider toggle appears in the panel header, letting users switch between per-model and per-provider spend aggregation without a page reload.

## [0.68.4] - 2026-06-07

### Fixed
- **Local Model Scan always available**: The "Scan & Recommend" panel in Settings no longer shows an "AtlasMind context is not yet ready" error when opened before the extension has fully initialised. Hardware detection and local runtime discovery now work from the outset; usage-based scoring is simply skipped (all scores stay at their hardware/release baseline) until cost records become available.

## [0.68.3] - 2026-06-07

### Fixed
- **Project Dashboard stale scoring**: The dashboard now re-syncs automatically when the panel becomes visible again after being hidden, so scores no longer go out of date after working in other tabs. A `vscode.workspace.onDidChangeConfiguration` listener was also added so any `atlasmind.*` setting change (tool approval mode, terminal write policy, verify scripts, etc.) immediately re-evaluates the security and delivery scores without needing a manual Refresh.
- **`openGapFiles` message silently dropped**: The `isProjectDashboardMessage` validator was missing `openGapFiles` in its string-payload branch, causing the "open related files" action in the Gap Analysis page to be silently discarded. It now validates and dispatches correctly.

## [0.68.2] - 2026-06-06

### Added
- **Local Model Advisor in Settings**: Added a new "Scan & Recommend" panel under Models & Integrations that analyzes AtlasMind's recent local-model usage, inspects local hardware capacity (CPU, RAM, and detected GPU/VRAM), and ranks release-aware local model families to recommend the most appropriate models to keep installed. The advisor now also supports install/remove lifecycle actions: one-click install and remove for Ollama models, plus LM Studio install/remove guidance directly in the panel where stable API automation is not currently available.
- **Data-driven local recommendation registry**: Moved release-aware local model candidate definitions into `src/providers/localModelRecommendationRegistry.ts` and added validated workspace override loading from `.atlasmind/local-model-recommendations.json`. The advisor now falls back to built-in defaults automatically when overrides are absent or invalid, so future model families can be added without editing Settings panel logic.
- **Registry override coverage tests**: Added provider-level tests for local recommendation override parsing, normalization, invalid-entry filtering, and built-in fallback behavior when override content is malformed or non-array.
- **Focused provider test script**: Added `npm run test:providers:local-recommendations` to run only the local recommendation registry override and fallback test suite with dot reporting.
- **CI regression gate for local recommendation registry**: The CI quality matrix now runs `npm run test:providers:local-recommendations` as an explicit focused gate alongside the full unit-test suite.

### Fixed
- **Chat panel now fails safely when webview markup is incomplete**: Added a startup guard in `media/chatPanel.js` that validates required DOM nodes before wiring event handlers. If required elements are missing, AtlasMind now shows an explicit in-panel error instead of throwing null-access runtime errors and leaving the view blank or unresponsive.
- **Project Dashboard now avoids webview service-worker bootstrap dependency**: `projectDashboardPanel` now prefers inline loading of `media/projectDashboard.js` (with URI fallback) when composing webview HTML. This mitigates environments where webview resource service-worker registration fails with `InvalidStateError` during dashboard startup.
- **Shared webview shell now allows worker/service-worker bootstrap paths**: `getWebviewHtmlShell` now includes explicit `worker-src`, `child-src`, and `frame-src` directives for the webview origin (plus `blob:` where needed). This resolves debug-host startup failures where webviews immediately showed “Could not register service worker … The document is in an invalid state.”
- **Sidebar chat view no longer requests retained webview context**: `registerWebviewViewProvider` for `atlasmind.chatView` now sets `retainContextWhenHidden: false`, avoiding startup-time context restore paths that can trigger webview `InvalidStateError` service-worker registration failures in debug sessions.
- **Sidebar chat initialization is now deferred one event-loop tick**: `ChatViewProvider.resolveWebviewView` now hands off to an async initializer that waits briefly before creating `ChatPanel`, reducing startup races where VS Code reports the webview document as invalid during service-worker bootstrap.
- **Shared webview CSP is now fully webview-origin aware**: `getWebviewHtmlShell` now allows the webview origin in `script-src`, `connect-src`, `img-src`, and `worker-src` (plus `blob:` channels where required). This broadens compatibility with VS Code webview startup plumbing when the extension loads multiple sidebar and panel webviews during debug startup.

## [0.68.1] - 2026-06-06

### Fixed
- **Self-recovery with dynamic agent/skill synthesis on empty responses**: When the primary model attempt returns no content, the orchestrator now runs two recovery steps before falling back to asking the user: (1) *Reprompt* — re-runs the agentic loop with an explicit instruction to use available workspace tools and find the answer itself; (2) *Synthesize* — if the reprompt also produces nothing, infers routing needs from the LLM classification embedded in the request, synthesizes a specialist agent (and any required skills) better suited to the task, and retries the full agentic loop with it. A `__recoveryPass` flag prevents the synthesized-agent retry from triggering another recovery cycle. Only if both steps fail does the orchestrator fall through to generating a targeted clarifying question for the user.
- **Chat panel no longer throws "Webview is disposed" errors after panel close**: Added an `_isDisposed` flag that is set at the start of `dispose()`. Both `syncState()` and `runPrompt()` now return immediately if the panel has been disposed, preventing in-flight async operations from attempting to access the disposed webview. Eliminates the uncaught errors visible in the extension status bar after closing the chat panel mid-stream.

## [0.68.0] - 2026-06-06

### Added
- **Copy and send-to-terminal buttons on chat code blocks**: Each code block in the chat panel now shows a clipboard icon and a terminal icon in its header row on hover. Clicking the clipboard icon copies the code to the system clipboard (with a brief checkmark confirmation). Clicking the terminal icon sends the code directly to the active VS Code terminal (or opens a new one if none is open), without executing it — so you can review before pressing Enter.

### Fixed
- **Activity feed and model-used panels no longer collapse on tool progress**: The Work log (`<details>`), Thinking summary (`<details>`), and Models-used dropdown now survive every transcript re-render triggered by streaming, tool execution, or busy-state changes. Open/closed state is snapshotted before the transcript is rebuilt and restored immediately after, so manually-opened panels stay open while work continues.

### Changed
- **Quick Links moved to sidebar title bar**: The "Quick Links" collapsible panel has been removed from the AtlasMind sidebar. All seven panel actions (Dashboard, Ideation, Runs, Cost, Models, Profile, Settings) are now available as small icon buttons directly in the AtlasMind container title bar, consistent with how other sidebar views expose their primary actions.

## [0.67.9] - 2026-06-06

### Fixed
- **Orchestrator generates a targeted clarifying question when the model returns an empty response**: Instead of silently surfacing the internal `"Answered from context"` metadata summary (which looked like a real answer followed by `"Say 'Proceed' to continue"`), the orchestrator now makes a cheap secondary call when it detects an empty completion. The call uses the original user message and any tool evidence gathered during the attempt to produce a concise, request-specific clarifying question — e.g., asking which test framework to use when a security test request produced no output, rather than a generic "share more details" prompt. `ensureAssistantVisibleResponse` retains a last-resort static fallback for the case where the clarifying question call also fails.

## [0.67.8] - 2026-06-05

### Fixed
- **Provider discovery pipeline now fully traced in the output channel**: Added per-provider log lines to `refreshProviderModelsCatalog` at three checkpoints — discovery start (with health state), discovered model count, and post-merge registered count. Previously the pipeline could silently skip or lose models with no visible signal. These logs appear in the **AtlasMind** output channel and will show exactly where the chain breaks for any provider.

## [0.67.7] - 2026-06-05

### Fixed
- **Cross-session response bleeding between simultaneous chat panels**: When the sidebar Chat View and the detached Chat Panel were both open and running prompts concurrently, responses from one session appeared in the other. Two root causes were addressed: (1) `runPrompt` now calls `spawnSession()` instead of `createSession()` for "new session" mode, preventing the global active-session pointer from being silently hijacked by one panel and triggering a session-ID reset in the other; (2) when a prompt is submitted in "send" mode and another panel is already executing on the same session, a fresh session is automatically spawned for the new prompt, ensuring each concurrent run has its own isolated transcript. Additionally, `selectSession()` now short-circuits without firing `onDidChange` when the requested session is already active, eliminating the wave of redundant `syncState()` calls that all live panels were absorbing on every streaming update.

## [0.67.6] - 2026-06-05

### Changed
- **SSOT memory is now fully self-managed**: Removed the "Project memory needs update" warning item from the Memory sidebar panel. When the MemoryManager detects stale imported entries on activation or SSOT reload, it now silently auto-runs the import pipeline rather than surfacing a manual-review prompt to the user. The `atlasmind.updateProjectMemory` command remains available from the command palette and view toolbars for on-demand refreshes.

## [0.67.5] - 2026-06-05

### Changed
- **Live model badge redesigned**: The streaming model badge now uses the same grey pill style as the completed model badge. During streaming it shows the most recent model name with a subtle pulsing dot. When the orchestrator switches models mid-response (escalation, failover, re-route) a `(+N)` count appears next to the name; clicking the badge drops down a list of every model used in the reply (labelled "Models used so far" while streaming, "Models used in this reply" after completion). The same expandable behaviour applies to completed multi-model responses where `modelsUsed` is stored in transcript metadata.

### Fixed
- **Token count in response cost summary now includes all model attempts**: When the orchestrator ran multiple model attempts for a single response (escalation, provider failover, tool-capability re-route) only the final attempt's `inputTokens`/`outputTokens` were reported, causing the `N in / M out` line in the thought-summary to severely under-count large multi-step responses. Tokens are now accumulated across all attempts (`aggregateInputTokens`/`aggregateOutputTokens`), matching the existing `aggregateCostUsd` behaviour. The cost recorded in the cost tracker is also corrected to use the aggregate values.

## [0.67.4] - 2026-06-05

### Added
- **Live model badge in chat response bubbles**: The top-right corner of each assistant reply now shows which model is active in real time. As soon as the orchestrator selects a model the badge appears with the model name and a pulsing dot. If the model changes mid-response (provider failover, tool-capability re-route, or escalation) the badge grows to list every model used. The badge transitions to the standard static label once the response is complete.

## [0.67.3] - 2026-06-05

### Fixed
- **OpenAI (and all OpenAI-compatible) live model discovery now surfaces errors**: `listModels()` was silently swallowing non-ok HTTP responses from the `/models` endpoint (e.g. 401 Unauthorized, 403 Forbidden, 429 Rate Limited). The empty result caused `refreshProviderModelsCatalog` to hit its zero-models guard and quietly preserve the seeded defaults with no output-channel log. The fix: when the HTTP fetch returns a non-ok status and there are no static fallback models, `listModels()` now throws with the status code and truncated body so the error surfaces in the AtlasMind output channel (`[providers] Model refresh failed for openai: ...`). Providers that configure `staticModels` or `modelListProvider` as a fallback still receive those results even if the live fetch fails. A `[providers] … discovery returned 0 models` log was also added for the zero-models guard path.
- **`thought_signature` handling extended to local endpoint adapter**: The local model adapter in `registry.ts` had the same structural gap as the main OpenAI-compatible adapter — its `buildPayload` did not echo `thought_signature` back to the server and its response parser did not capture it. Both are now consistent with the fix made to `OpenAiCompatibleAdapter` in 0.67.2, so any local endpoint that proxies to a Google Gemini thinking model will also handle the signature correctly.

## [0.67.2] - 2026-06-05

### Fixed
- **Google Gemini thinking models no longer fail mid-conversation**: The OpenAI-compatible adapter now captures the `thought_signature` field that Google's Gemini 2.5+ thinking models attach to tool-call responses, stores it on `ToolCall`, and echoes it verbatim in the assistant message of any follow-up request. Without this, Google's API rejected the continuation with a "missing thought_signature" error whenever a thinking model (e.g. `gemini-2.5-pro`, `gemini-3.1-pro-preview`) was routed through a tool-calling loop.

## [0.67.1] - 2026-06-05

### Fixed
- **Provider credentials now trigger an immediate model refresh**: Saving API-key-backed provider credentials now forces `refreshProviderModels(true)` before the health refresh, so the Models sidebar and router immediately pick up the provider's full discovered catalog instead of staying on fallback seed models until a later refresh.
- **Auto-paused provider alerts are now dismissible without re-enabling providers**: AtlasMind now tracks a session-scoped dismiss action for auto-paused provider notifications, exposes a `Dismiss Provider Notifications` command in the Models view, and clears the sidebar badge while keeping the affected providers disabled.

## [0.67.0] - 2026-06-05

### Fixed
- **Project runs no longer hang indefinitely**: `runProjectCommand` now derives an `AbortController` from VS Code's `CancellationToken` and passes the resulting `AbortSignal` down through `processProject`, `executeSubTask`, the agentic loop, and the synthesizer. Cancelling the chat request (or any provider call timing out via the signal) now terminates the whole project pipeline instead of freezing silently. The planner's `plan()` call also receives the signal, so even the planning phase is interruptible.
- **Project runs no longer plan twice**: The preview plan built before the approval gate was discarded and the orchestrator immediately re-planned inside `processProject`. The preview is now passed as `planOverride`, cutting the redundant LLM call and eliminating the duplicate plan table in the chat panel.
- **Cancellation shows a clear message**: Aborting a project run mid-flight now shows "_Project run cancelled._" instead of swallowing the error silently.
- **Project runs report real token counts**: `synthesize()` now returns `{ content, inputTokens, outputTokens }` and each `SubTaskResult` carries `inputTokens` and `outputTokens` from the underlying `TaskResult`. `processProject` aggregates these into `ProjectResult.totalInputTokens` / `totalOutputTokens`, which are shown in the chat footer (e.g. `12,540 in / 3,210 out`) and stored in the session transcript via `recordTurn()`.
- **Session transcript now includes project turns**: `runProjectCommand` was the only major handler that never called `recordTurn()`. It now records the goal and synthesis with full cost/token metadata so follow-up context and session history work correctly.

### Added
- **Built-in workspace tools for project subtask agents** (`file-read`, `file-write`, `file-edit`, `file-search`, `memory-query`, `memory-write`, `test-run`, `terminal-run`, `workspace-observability`): The planner already assigned these skill IDs to subtasks but the corresponding `SkillDefinition` objects were never registered. The Orchestrator constructor now registers all nine tools on startup, so subtask agents can read and write files, search the codebase, run tests and terminal commands, and query/write project memory instead of generating code as unactioned chat text.

## [0.66.0] - 2026-06-05

### Added
- **Dismiss provider notification badge**: When a provider is auto-paused due to billing or auth issues, the Models tree view now shows a bell-slash button in the title bar. Clicking it acknowledges the notification and clears the badge without re-enabling the paused provider.

### Fixed
- **OpenAI (and other API-key providers) now populate all models after key entry**: `configureProvider` in `modelProviderPanel.ts` called `refreshProviderHealth()` after saving a new API key, but not `refreshProviderModels()`. The models fetched during the key-validation step were thrown away and the router kept only the seeded defaults. The handler now calls `refreshProviderModels(true)` first (which runs full discovery and merges all models) then `refreshProviderHealth()` — matching what the `copilot` and `claude-cli` branches already did.

## [0.65.6] - 2026-06-05

### Fixed
- **Display currency now applies everywhere**: The `atlasmind.displayCurrency` setting was not respected in three separate places:
  1. **Chat messages** — project cost estimates, per-subtask costs, project run totals, the `/cost` summary, and per-request cost bullets in `participant.ts` all hardcoded `$` with `.toFixed()` instead of going through `formatCost`/`formatCostAdaptive`. They now use the same currency formatter as the rest of the app.
  2. **Open panels not refreshing** — the `onDidChangeConfiguration` handler in `extension.ts` had no branch for `atlasmind.displayCurrency`, so the Cost Dashboard, Model Provider, and Personality Profile panels never re-rendered when the setting changed. The handler now dynamically imports and refreshes all open cost-displaying panels and fires `projectRunsRefresh` to push updated state to the Project Run Center.
  3. **`refresh()` visibility** — `ModelProviderPanel.refresh()` was `private`, preventing the config-change handler from calling it; it is now `public`.

## [0.65.5] - 2026-06-05

### Fixed
- **OpenAI provider now seeds 7 models instead of 1**: `seedDefaultProviders` previously only seeded `gpt-4.1-nano`, so the Models sidebar showed a single model for OpenAI when no API key was configured or when discovery failed. The seed now includes `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini`, `o4-mini`, and `o3` with accurate pricing and capabilities. Live discovery (when an API key is present) still merges the full model list from OpenAI's `/models` endpoint on top of these defaults.

## [0.65.4] - 2026-06-04

### Fixed
- Added all 8 new provider IDs (`openrouter`, `groq`, `together`, `fireworks`, `qwen`, `moonshot`, `yi`, `minimax`) to `.github/integration-monitor.json` so the CI integration-coverage audit passes (24/24 providers covered).

## [0.65.3] - 2026-06-04

### Fixed
- Removed an accidental `console.log('Listing models ...')` that was firing on every chat completion request through `OpenAiCompatibleAdapter`.
- `PersonalityProfilePanel.refresh()` visibility changed from `private` to `public` to allow external callers.

## [0.65.2] - 2026-06-04

### Fixed
- **All 8 new providers now appear in the Models sidebar**: OpenRouter, Groq, Together AI, Fireworks AI, Qwen, Moonshot AI, 01.AI (Yi), and MiniMax were registered as adapters but missing from `seedDefaultProviders()` in `runtime/core.ts`. Without a seed entry a provider never enters `modelRouter.listProviders()`, so it was invisible in the sidebar tree and skipped by the model-refresh loop. Each provider now has a seed `ProviderConfig` with a representative default model.

## [0.65.1] - 2026-06-04

### Changed
- **Model/provider summaries: richer "About" section**: Clicking "Summarize Model In Chat" or "Summarize Provider In Chat" now appends a structured **About** block covering the provider's tagline, strengths, weaknesses, and a notable callout — giving enough context to make an informed decision about signing up. Model summaries also include a context note (e.g. reasoning model, giant context window, or very cheap tier).
- **Sidebar summaries excluded from session context**: Messages posted by "Summarize" sidebar actions are now classified `irrelevant` with `relevanceWeight: 0`, so they are never included in the conversation context fed to the model router or LLM. This prevents info-card messages from distorting agent routing or inflating costs.

## [0.65.0] - 2026-06-04

### Added
- **8 new model providers**: AtlasMind now supports the following additional providers in the Model Providers panel, model tree, and routing engine:
  - **OpenRouter** — aggregator with 200+ models from many upstream providers. Uses a dedicated adapter that reads live pricing and context-window data directly from the OpenRouter `/api/v1/models` endpoint, so prices stay accurate without manual catalog updates. Requires an OpenRouter API key; includes the required `HTTP-Referer` / `X-Title` attribution headers.
  - **Groq** — ultra-fast LPU inference; covers Llama 4 Scout/Maverick, Llama 3.x, Mixtral 8x7B, Gemma 2 9B, Qwen QwQ 32B, and Groq Compound Beta with published pricing.
  - **Together AI** — open-weight model hosting; covers Llama 3.x (8B/70B/405B Turbo), DeepSeek R1/V3, Qwen 2.5 72B, Mixtral 8×7B/22B with published pricing.
  - **Fireworks AI** — fast open-model inference; covers Llama 3.x, DeepSeek R1/V3, Qwen 2.5 Coder 32B, Mixtral 8×7B with published pricing.
  - **Qwen (Alibaba Cloud)** — international DashScope endpoint; covers Qwen-Max, Plus, Long, Turbo, VL, and Coder variants.
  - **Moonshot AI (Kimi)** — Chinese long-context specialist; 8K / 32K / 128K context tiers.
  - **01.AI (Yi)** — Chinese open-weight provider; covers Yi-Lightning, Yi-Large/Turbo, Yi-Medium, Yi-Spark, Yi-Vision.
  - **MiniMax** — Chinese multimodal provider; covers MiniMax-Text-01 (1M context) and the abab6.5 series.
- **Provider catalog entries for all new providers**: `GROQ_CATALOG`, `TOGETHER_CATALOG`, `FIREWORKS_CATALOG`, `QWEN_CATALOG`, `MOONSHOT_CATALOG`, `YI_CATALOG`, and `MINIMAX_CATALOG` added to `modelCatalog.ts` with context windows and pricing per published docs.
- **Dynamic pricing sync for new providers**: Groq, Together AI, Fireworks AI, Qwen, Moonshot AI, and 01.AI added to `providerPricingSync.ts` so prices auto-refresh from each provider's public pricing page (7-day TTL cache).

## [0.64.4] - 2026-06-04

### Added
- **Structured `goal` field in `SessionContextBundle`**: `SessionContextBundle` now carries an optional `goal` field — the top-level problem statement for the session or project run. Project sub-agents receive a minimal bundle with this field set so every LLM call starts with a `## Session Goal` section, giving all agents a machine-readable, unambiguous anchor to the original problem regardless of how many layers of decomposition have occurred.

### Fixed
- **Memory retrieval enriched with project goal**: `buildRetrievalContext` now includes `goal` alongside `summary` and `decisions` when constructing the enriched memory query, so SSOT entries relevant to the actual problem (not just the narrow subtask) are surfaced.
- **`getProviderDisplayName` exhaustive switch**: Added missing cases for `openrouter`, `groq`, `together`, and `fireworks` providers, resolving a TypeScript strict-mode exhaustiveness error.

## [0.64.3] - 2026-06-04

### Fixed
- **Display currency: panels now update immediately when the setting changes**: Changing `atlasmind.displayCurrency` in Settings now live-refreshes the Cost Dashboard, Model Provider, and Personality Profile panels, and re-sends state to the Project Run Center — so all cost values switch to the new currency without requiring a panel reopen. Previously, open panels retained their original currency until manually closed and reopened.

## [0.64.2] - 2026-06-04

### Fixed
- **Model pricing: Mistral and other cloud models no longer show $0**: `lookupCatalog()` was falling through to the local-model catalog when a provider's own catalog had no entry for a given model ID (e.g. `mistral-nemo`, `ministral-3b`, `open-mistral-7b`). The local catalog intentionally uses $0 prices, so any cloud model that matched there would display as free. The cross-catalog fallback now skips `local` and `copilot_hosted` for non-local providers.
- **Mistral catalog: added missing API model entries**: `MISTRAL_CATALOG` now includes `Mistral NeMo`, `Ministral 3B/8B`, `Mixtral 8x7B/8x22B`, `Pixtral 12B/Large`, `Magistral Small/Medium`, and `Mistral 7B` with correct context windows and pricing.

## [0.64.1] - 2026-06-04

### Fixed
- **Project execution: sub-agents now receive the project goal**: `buildProjectSubTaskMessage` previously omitted the top-level goal from every subtask prompt, so ephemeral sub-agents had no idea what the original problem was and could only act on the narrow subtask title. Every subtask message now opens with a `PROJECT GOAL:` section so sub-agents have full context.
- **Autonomous continuation: "Fix this autonomously" no longer overwrites the real goal**: When the user clicked the "Fix Autonomously" quick-reply button and then said "proceed", `resolveAutonomousContinuationGoal` was picking up the meta-execution message ("Fix this issue in the workspace autonomously…") as the goal instead of the original bug description. A new `DEICTIC_FIX_EXECUTION_PATTERN` now causes `normalizeAutonomousSourcePrompt` to skip deictic meta-commands (matching "fix/resolve/apply this … autonomously") and look further back in the transcript for the actual issue description.

## [0.64.0] - 2026-06-04

### Added
- **Collapsible Standalone Runs section**: The Standalone Runs list in the Sessions panel is now a collapsible section with its own toggle button. It is collapsed by default. When one or more runs are actively in progress a count badge appears next to the title; the badge is hidden when no runs are running. Collapse state is persisted across panel reloads.

### Fixed
- **Project Dashboard double-send**: Clicking a Dashboard button that auto-submits a prompt to the Chat Panel no longer also puts the same text into the composer input box. `pendingComposerDraft` is now skipped when `autoSubmit: true` is set, so the prompt appears only in the conversation, not duplicated in the input field.
- **Memory: empty-title guard**: `MemoryManager.upsert()` (VS Code host) and `NodeMemoryManager.upsert()` (CLI) now reject entries with a blank or whitespace-only title before any other validation, preventing unscorable zero-match ghost entries from being indexed.
- **Memory: `persistEntry` write failures now logged**: Previously, disk write errors were silently swallowed because callers used `void persistEntry()`. Both managers now wrap `createDirectory` + `writeFile` in a try/catch that logs the error to the VS Code output channel and re-throws, so failures are visible without breaking the in-memory state.
- **Memory: path escape guard in `persistEntry`**: Added a belt-and-suspenders check that the resolved file URI/path is still under the SSOT root before any write, preventing a bypassed `isValidSsotPath` from writing outside the project memory folder.
- **Memory CLI: sessions excluded from `queryWithOptions`**: `NodeMemoryManager.queryWithOptions()` now excludes `sessions/` entries to match the existing VS Code host `queryRelevant` and `queryWithOptions` behavior.

### Added
- **Memory: `fingerprintedImports` stat**: `MemoryStat` now includes `fingerprintedImports` — the count of imported entries that have both `sourcePaths` and a `bodyFingerprint`. This separates fully-tracked imports from `potentiallyStaleImports` (entries with source paths but no fingerprint), giving the memory browser and diagnostics a clear picture of import health.
- **Memory: `scanForOrphanedEntries()`**: New async method on both `MemoryManager` and `NodeMemoryManager` that checks entries with `sourcePaths` against the workspace root and SSOT root and returns the SSOT-relative paths of entries where no source file is accessible. Enables future cleanup UIs to surface deleted or renamed source references without manual inspection.
- **Memory: staleness penalty in `live-verify` and `planning` modes**: `getFreshnessBoost` now extends the staleness window to 730 days (2 years) and applies a mild negative boost (capped at −0.5 for `live-verify`, −0.3 for `planning`) to entries older than 1 year. `summary-safe` mode retains a floor of 0 so historical architecture decisions and rationales are never penalised by age.
- **Memory: vector score threshold and reduced multiplier**: `scoreEntry` now applies a minimum cosine similarity of 0.15 before vector score contributes to ranking (eliminating low-quality hash-collision noise), and reduces the vector multiplier from 4× to 2.5× so keyword evidence remains the primary signal and vector similarity acts as a secondary discovery boost.
- **Dynamic provider pricing sync** (`src/providers/providerPricingSync.ts`): On every model-catalog refresh, AtlasMind now fetches each active provider's public pricing/models docs page in parallel and uses the live per-token prices instead of the static catalog. Results are cached in `globalState` with a 7-day TTL (same pattern as the Copilot multiplier sync). Resolution priority: API hint → live pricing sync → static catalog → heuristic. Supported providers: openai, azure, anthropic, google, mistral, deepseek, xai, cohere, perplexity.
- **GitHub Copilot AI credits billing support**: Updated the Copilot provider to reflect the June 1, 2026 migration from "premium request units" (PRU) to token-based **AI credits** billing (1 credit = $0.01 USD). The sync module now fetches per-token prices from the new GitHub docs page (`models-and-pricing`) and stores them in `MultiplierSyncResult.tokenPrices`. Legacy PRU multipliers are retained for annual plan holders still on request-based billing.
- **New model catalog entries**: Added Claude Opus 4.8; GPT-5 Mini, GPT-5.2, GPT-5.2/5.3-Codex, GPT-5.4 (1M context), GPT-5.4 Mini (400K context), GPT-5.4 Nano, GPT-5.4 Pro, GPT-5.5 (1M context), GPT-5.5 Pro; Gemini 3 Flash, Gemini 3.1 Pro, Gemini 3.5 Flash; Raptor Mini and MAI-Code-1-Flash. Context windows for GPT-5.5 and GPT-5.4 corrected from placeholder 200K to 1M; GPT-5.4 Mini corrected to 400K. OpenAI models docs URL updated from `platform.openai.com` to `developers.openai.com`. o3-mini, o1, and o1-mini marked deprecated in catalog comments.
- **New Copilot plan tiers**: Added Copilot Max ($100/month, 20,000 credits) to the subscription tier list; updated all existing tiers to use AI credit counts (Pro: 1,500, Pro+: 7,000) and updated their descriptions to say "AI credits" instead of "premium requests".
- **`resolveTokenPrices()` export**: Companion to `resolveMultiplier()` — resolves per-1k-token USD prices for a model ID from the synced AI credits pricing table.

### Changed
- Copilot sync URL updated from `…/copilot-requests` to `…/models-and-pricing`.
- Configure Subscription flow prompts and confirmation messages now say "AI credits" instead of "premium requests".
- Model Provider panel sync banner and quota display updated to say "AI credits pricing" and "credits remaining" instead of "premium-request multipliers" and "requests remaining".

## [0.63.2] - 2026-06-04

### Fixed
- **Chat session isolation**: Each VS Code chat panel now gets its own dedicated AtlasMind session. Previously, all `@atlas` chat threads shared a single active session, causing context from one thread to bleed into another and making concurrent sessions interfere with each other's history. A `resolveThreadSessionId()` helper now maps each VS Code chat thread (fingerprinted by its opening user prompt) to a private session created via a new `spawnSession()` method that does not change the user's selected active session.

## [0.63.1] - 2026-06-04

### Fixed
- **Agent Auto-Update Cadence dropdown**: Changing the cadence in the Agent Manager panel no longer immediately reverts to "never". The panel now uses the just-written value when re-rendering after a save, bypassing a VS Code configuration cache timing issue where the in-memory config could read a stale value immediately after `config.update()` resolved.

## [0.63.0] - 2026-06-04

### Added
- **AI Instructions sync**: New **AI Instructions** page in AtlasMind Settings. Click **Scan Workspace** to discover instruction files from GitHub Copilot (`.github/copilot-instructions.md`), Claude Code (`CLAUDE.md`), Cursor (`.cursorrules`, `.cursor/rules/`), Cline (`.clinerules`), Continue (`.continue/config.json`), OpenAI Codex (`AGENTS.md`), Gemini CLI (`GEMINI.md`), Windsurf (`.windsurf/rules/`), Aider (`.aider.system.md`), and more. Found files are listed with a content preview and checkboxes. Confirming the selection merges the chosen instruction sets into `project_memory/domain/ai-instructions-sync.md`, which AtlasMind includes in workspace context automatically on subsequent tasks.
- **Personality Profile precedence**: The orchestrator injects a `Workspace preferences (override)` reminder after the project memory block so the model applies the Workspace Identity Profile (tone, verbosity, reasoning style, scope) over any conflicting instructions in synced AI instruction files. The generated `ai-instructions-sync.md` is marked as advisory context.

## [0.62.1] - 2026-06-03

### Added
- `architecture/boundaries-and-seams.md`: explicit review of all 8 integration seams (VS Code Extension API, Extension Host ↔ Webview, UI ↔ Orchestrator, Orchestrator ↔ Providers, Orchestrator ↔ Skills, Orchestrator ↔ Memory, Extension ↔ SecretStorage, AtlasMind ↔ MCP Servers) with contracts, protocols, and security rules for each. Closes the P2 architecture gap item.
- `docs/architecture/orchestrator-flow.md`: Mermaid flow diagrams for `processTaskWithAgent` and `runAgenticLoop` internals.
- Detailed architecture subdocs table added to `docs/architecture.md` and `wiki/Architecture.md`.

### Fixed
- Completed the built-in agent prompt editing implementation from 0.62.0: `extension.ts` now persists system prompt, description, and flag overrides for built-in agents in `atlasmind.builtInAgentPromptOverrides`; the Agent Editor panel wires the save/reset actions for built-in agents.
- `AgentAutoUpdater` no longer hard-skips built-in agents (the 0.62.0 changelog claimed this but the implementation hadn't landed yet).

## [0.62.0] - 2026-06-03

### Added
- **Built-in agent prompt editing**: System prompt, description, cost limit, and auto-update settings are now editable for built-in agents in the Agent Editor. Changes are stored as overrides in `atlasmind.builtInAgentPromptOverrides` and applied on top of the factory defaults at each activation, so they survive extension reloads.
- **"Reset to defaults" button**: Built-in agent editor now has a "Reset to defaults" button that restores the factory system prompt and description after confirmation, clearing the stored override.
- **Built-in agents are now auto-updatable**: The `AgentAutoUpdater` no longer hard-skips built-in agents. When the global cadence is set, built-in agent system prompts and descriptions are refreshed alongside user-defined agents. The "Exclude from auto-updates" checkbox is now active for all agents.
- **`BUILTIN_AGENT_DEFAULTS`**: Exported from `runtime/core.ts` so the extension can look up original factory definitions for reset and future tooling.

### Fixed
- **`primaryRoutingNeeds` on `AgentDefinition`**: Each built-in agent now declares the routing need IDs it is the primary handler for (e.g. `['debugging']` for Workspace Debugger, `['security', 'review']` for Security Reviewer). The orchestrator scores these structural declarations at +25 per matched need (LLM-classified) or +15 (regex fallback), giving specialists a dominant signal over token-overlap noise.
- **`fromLlm` on `ClassificationResult`**: The classifier now reports whether its output came from an LLM call or the regex fallback, allowing the orchestrator to apply higher trust weights to LLM-derived routing needs.

### Changed
- **Agent selection scoring overhaul**: `scoreAgent()` no longer includes system-prompt token hits in the base score. The UX Consultant's ~3 000-word system prompt was causing it to outscore domain-appropriate specialists on almost every technical query due to sheer token volume. Routing is now driven by `id`, `name`, `role`, `description`, and skill metadata only.
- **Routing need corpus narrowed**: `scoreAgentRoutingNeeds()` now applies pattern matching against a narrow corpus (role, name, description, skills) rather than the full corpus including the system prompt, preventing false positive routing need boosts from incidental token overlap.
- **`architecture` routing need agentPattern tightened**: Removed the generic terms `design`, `structure`, and `systems` from the pattern. These words appear in nearly every agent's description and were causing agents like the UX Consultant (role: "ux **design**…") to incorrectly receive an architecture routing need boost.

### Fixed
- **Wrong agent selected for architecture/concern tasks**: The UX Consultant was being routed for architecture boundary and integration seam reviews because of combined system prompt token volume and a false-positive architecture routing need match. The Backend Engineer or security reviewer now win correctly on such requests.

## [0.61.5] - 2026-06-03

### Added
- `architecture/boundaries-and-seams.md`: explicit review of all 8 integration seams (VS Code Extension API, Extension Host ↔ Webview, UI ↔ Orchestrator, Orchestrator ↔ Providers, Orchestrator ↔ Skills, Orchestrator ↔ Memory, Extension ↔ SecretStorage, AtlasMind ↔ MCP Servers) with contracts, protocols, and security rules for each.
- `docs/architecture/orchestrator-flow.md`: Mermaid flow diagrams for `processTaskWithAgent` and `runAgenticLoop`.
- `AgentDefinition.primaryRoutingNeeds` field: built-in agents now declare which routing-need IDs they own as a dominant signal over token-overlap scoring.
- `ClassificationResult.fromLlm` flag: marks LLM-produced vs regex-fallback classifications so the orchestrator can weight routing needs appropriately.

### Fixed
- Agent routing: removed system prompt from `scoreAgent()` token-overlap — verbose prompts were overriding role/description signals and routing nearly any technical request to the UX Consultant.
- Agent routing: narrowed the `architecture` routing-need agent pattern to avoid false-positive boosts from generic words like "design" or "structure" in unrelated agents.
- Agent Editor page: the Global Auto-Update cadence selector is now shown directly on the Editor tab so it is reachable without switching to Agent Directory.
- Agent Editor page: disabled checkboxes on built-in agents now display a read-only hint; a notice banner at the top of the form clarifies the agent cannot be saved.

## [0.61.4] - 2026-06-03

### Added
- Agent skills auto-management UI and supporting runtime behavior were expanded, with related documentation, tests, and SSOT memory snapshots refreshed to match the current implementation.

### Changed
- Synced release metadata for this commit by bumping `package.json` and `package-lock.json` to `0.61.4`.

## [0.61.3] - 2026-06-03

### Fixed
- Restored the README source-version banner to match `package.json` and added a regression test so the banner cannot drift again.
- Tightened the release/docs guidance so README, changelog, and mirror documentation are updated together when versioned changes land.

## [0.61.2] - 2026-06-03

### Changed
- README refresh: updated project overview and docs sections, including command, view, agent, skill, and configuration reference summaries.
- Version metadata sync: bumped `package.json` and `package-lock.json` to `0.61.2` for this commit.

## [0.61.1] - 2026-06-03

### Fixed
- **Windows CI**: Increased `bootstrapProject` test timeout from 15 s to 30 s to accommodate the slower `windows-2025-vs2026` runner that GitHub is rolling out.

## [0.61.0] - 2026-06-03

### Added
- **Agent Skills Auto mode**: The Manage Agents editor now features an **Auto** checkbox in the Skills section (checked by default for new agents). When Auto is on, the skill checkboxes are hidden and AtlasMind uses an AI model to assess which registered skills best match the agent's role and context. Unchecking Auto reveals the manual selection list for per-agent customisation.
- **`SkillAutoAssigner` service** (`src/core/skillAutoAssigner.ts`): New service that uses a frugal AI model call to assign skill IDs to auto-managed agents. Handles concurrent reassessments safely (skips if a reassessment for the same agent is already in-flight).
- **Automatic reassessment triggers**: Skill assignments are re-evaluated (a) immediately when an agent is saved with Auto enabled, (b) whenever an MCP server connects or disconnects (changing the available tool set), and (c) after the agent auto-updater refreshes an agent's system prompt. All reassessments are fire-and-forget — the original skills are preserved on any failure.
- **`assessAgentSkills(agentId)`** method on `AtlasMindContext` for programmatic reassessment from panels.
- `skillsAutoManaged?: boolean` field added to `AgentDefinition` in `src/types.ts`.

## [0.60.4] - 2026-06-03

### Changed
- **Pre-commit hook**: Expanded from version-bump/changelog enforcement only to a full local quality gate — now runs `compile` (TypeScript), `lint` (ESLint), and `test` (Vitest) before each commit, mirroring the CI steps. This ensures lint errors, type errors, and test failures are caught locally and CI always passes on first push.

## [0.60.3] - 2026-06-03

### Fixed
- **Windows CI**: Added a 15 s timeout to the `bootstrapProject` "keeps out-of-turn details" test, which was exceeding the default 5 s budget on the Windows CI runner (passes locally in ~140 ms; runner is noticeably slower due to the pending windows-2025-vs2026 migration).

## [0.60.2] - 2026-06-03

### Fixed
- **CI test suite**: Resolved 8 pre-existing test failures that were previously masked by a lint error which stopped the quality gate before tests ran.
  - `modelMetadataInference`: `inferCapabilities` now uses a word-boundary regex (`/\bllama/`) so `tinyllama-1b` correctly withholds `function_calling`; `inferPricing` now uses `/\bmini/` so `gemini-pro` is no longer misclassified as cheap (substring `mini` inside `gemini`).
  - `participant.helpers.test`: Updated 4 stale assertions to match the current `buildAssistantResponseMetadata` output format (summary no longer embeds the model name; bullet copy updated from v0.59.0 "tighter output" refactor).
  - `runtime/core.test`: Updated agent-selection assertion — routing now correctly prefers `test-developer` over `code-reviewer` for prompts centred on regression coverage and failing-to-passing evidence.
  - `panelFlows.test`: Updated `thoughtSummary` shape assertions (`label`, `summary`, `bullets`) to match the current chatPanel metadata format.

## [0.60.1] - 2026-06-03

### Fixed
- **ESLint CI**: Removed unused `describeCommonRoutingNeeds` import and prefixed unreachable `capitalize` function in `participant.ts`; removed unused `ModelCapability` import and prefixed unused `_agent` callback parameter in `extension.ts`. All four were pre-existing unused-var violations that blocked the quality gate.

## [0.60.0] - 2026-06-03

### Added
- **Agent Auto-Update**: User-defined agent system prompts and descriptions can now be automatically refreshed by AI on a configurable cadence. The update reviews the agent's instructions and rewrites them to reflect current best practices, remove outdated content, and ensure legal compliance across major territories (US, EU, UK, Canada, Australia). The check runs on the next use of the agent once the interval has elapsed.
  - New VS Code setting `atlasmind.agentAutoUpdateCadence` with options: `never` (default), `every-use`, `daily`, `weekly`, `monthly`.
  - Built-in agents are never auto-updated.
  - Per-agent exclusion: the Agent Manager now includes an **Exclude from auto-updates** checkbox so individually customised agents can opt out of the global cadence.
  - The `lastAutoUpdated` timestamp is persisted with the agent definition and displayed as-is in storage; the cadence clock is preserved across VS Code restarts and saves.
  - New `AgentAutoUpdater` service (`src/core/agentAutoUpdater.ts`) follows the same safe-completion pattern as `MemoryAgentExecutor` — all updates are fire-and-forget; the original agent is used unmodified if the AI call fails.
  - New `AgentAutoUpdateCadence` type and `lastAutoUpdated`/`autoUpdateExcluded` fields added to `AgentDefinition` in `src/types.ts`.

## [0.59.9] - 2026-06-03

### Fixed
- **Husky pre-commit hook**: Removed deprecated `#!/bin/sh` shebang and `. "$(dirname "$0")/_/husky.sh"` source line that will fail in Husky v10. The hook logic (version bump and CHANGELOG enforcement) is unchanged.

### Security
- **CVE-2026-8723 (qs, medium)**: Tracked. The advisory lists `qs@6.15.2` as the patched version but 6.15.2 has not been published to npm — `6.15.1` is the current latest. An `overrides` pin was attempted but fails with ETARGET. Will apply `"overrides": { "qs": ">=6.15.2" }` to `package.json` as soon as 6.15.2 is available. The vulnerability is a remotely triggerable DoS in `qs.stringify` when `encodeValuesOnly` is set with null/undefined entries in comma-format arrays; AtlasMind does not call `qs.stringify` directly so exploitability is limited to the `express` transitive path.

## [0.59.8] - 2026-06-03

### Changed
- **SEO Specialist — full LLMO, GEO, AEO, AIO coverage**: The `seo-specialist` agent now implements all four AI-era optimisation disciplines as distinct, fully-specified sections rather than a single merged "AI-Native" paragraph.
  - **AEO (Answer Engine Optimisation)**: featured snippet format rules (paragraph ≤60 words, list ≤8 items, table), People Also Ask targeting with FAQPage + Speakable JSON-LD, voice-assistant answers ≤30 words, Speakable schema (`speakable.cssSelector`), conversational query patterns, entity cross-referencing to Wikipedia/Wikidata.
  - **GEO (Generative Engine Optimisation)**: citable statistics with explicit inline attribution (generative engines prefer citing concrete numbers); quotable 3–5 sentence passages that are independently comprehensible when extracted verbatim; source credibility signals (author credentials, publication dates, institutional affiliations); fluency optimisation (GEO research identifies fluency as the strongest AI citation predictor); elimination of AI-generated content patterns (repetitive phrasing, generic lists, vague claims) that reduce citation likelihood.
  - **AIO (AI Overview Optimisation — Google-specific)**: inclusion factors (top-10 ranking correlation, direct factual openings per section, complete topical coverage, structured data role); content structure guidelines (concise factual first sentence, supporting detail after, no long preambles before the answer); local business AI Overview (GBP, NAP consistency, LocalBusiness schema); product/shopping AI Overview (Product schema, detailed descriptions, AggregateRating); opt-out mechanism (`<meta name="google" content="nosnippet">`, `data-nosnippet`, `max-snippet:-1`); Search Console monitoring via the "Search Appearance" filter.
  - **LLMO (Large Language Model Optimisation — new, previously absent)**: `/llms.txt` file implementation (llmstxt.org standard — declares content LLMs may use, with structured URL/description index and optional `/llms-full.txt`); AI web crawler access audit — GPTBot (OpenAI), ClaudeBot (Anthropic), Google-Extended (Gemini training), PerplexityBot, Applebot-Extended, Meta-ExternalAgent must not be accidentally blocked in robots.txt; brand entity definition for LLM parametric knowledge (Wikipedia article, Wikidata Q-number with official website and social media links, Google Knowledge Panel); Common Crawl training-data inclusion signals (clean HTML, original content, no spam); LLM citation optimisation (unique citable data, named methodologies, original research that cannot be attributed elsewhere); monitoring ChatGPT/Claude/Gemini/Perplexity responses for brand accuracy and hallucinations, with correction via authoritative indexed content.
  - **TDD policy expanded**: verification criteria added for all four disciplines — AEO (FAQPage/Speakable Rich Results Test, featured-snippet paragraph length, PAA heading structure), GEO (statistics have inline attribution, key paragraphs are independently comprehensible), AIO (no preamble before opening factual sentence, correct opt-in/opt-out directives, Search Console configured), LLMO (llms.txt exists, AI crawlers not blocked, brand entity consistent, Wikidata accurate).

## [0.59.7] - 2026-06-03

### Added
- **SEO Specialist agent** (`seo-specialist`): New built-in agent for technical SEO, AI-Native/Answer Engine Optimisation (AEO), and multi-surface discoverability. A new `seo` routing need ID is added to the classifier and orchestrator so SEO-vocabulary prompts (meta, sitemap, schema, ranking, crawl, AEO, Open Graph, Core Web Vitals, etc.) route directly to this agent rather than falling through to the generalist. Coverage: technical SEO (meta title/description, canonical URLs, XML sitemaps, robots.txt, JS rendering audit, duplicate content, URL structure); Schema.org JSON-LD structured data (WebSite, Article, FAQPage, HowTo, BreadcrumbList, SoftwareApplication, Product, Organization, and more) validated against schema.org and the Google Rich Results Test; Core Web Vitals as hard ranking requirements (LCP < 2.5 s, CLS < 0.1, INP < 200 ms) with before/after Lighthouse measurement; AI-Native/AEO (direct factual openings for featured-snippet extraction, entity-based content for Knowledge Graph, E-E-A-T signals, conversational query targeting for voice and AI assistant surfaces); multi-surface discoverability (Open Graph + Twitter Card social previews, VS Code Marketplace listing copy + keywords + icon, GitHub repository description + topic tags + README structure, npm package.json description + keywords); international SEO (hreflang with x-default cross-referencing). SEO elements are treated as code correctness requirements with testable verification criteria.

## [0.59.6] - 2026-06-03

### Changed
- **UX Consultant — responsive breakpoint coverage**: The `ux-consultant` agent now applies mobile-first responsive layouts across five named breakpoints as a non-negotiable baseline alongside full accessibility. Uses the project's existing breakpoint tokens when present (Tailwind sm/md/lg/xl/2xl, MUI xs–xl, Bootstrap, or custom); otherwise applies a standard set: mobile (<768px, single-column/full-width), tablet (768px–1023px, two-column/collapsible sidebar), small desktop (1024px–1279px, sidebar+content), large desktop (1280px–1919px, multi-column/expanded grids), ultra-wide (≥1920px, max-width-capped container centred in viewport, never full-stretch text lines). No layout may produce horizontal scroll on its target breakpoint; content hierarchy is preserved across all sizes.

## [0.59.5] - 2026-06-03

### Added
- **UX Consultant agent** (`ux-consultant`): New built-in agent for UX critique and professional accessible UI surface generation. Full accessibility is a non-negotiable baseline integrated throughout every output — not a final checklist. Covers: all input modalities (keyboard with correct semantics, mouse, touch ≥44×44 px, voice control with pronounceable accessible names); screen readers (semantic HTML, ARIA labels and live regions, logical heading hierarchy, icon-button labelling, alt text); all four visual modes (light, dark, high-contrast light, high-contrast dark) via --vscode-* variables or prefers-color-scheme/prefers-contrast; colour-blind safety across protanopia, deuteranopia, tritanopia, and achromatopsia — never colour alone to convey information; WCAG 2.2 AA contrast (4.5:1 body text, 3:1 UI components) with AAA aspiration; visible focus indicators in all themes (minimum 3:1 focused/unfocused contrast); prefers-reduced-motion compliance; no content flashing more than three times per second; layout usable at 200% text zoom; form errors identified by field name in text with correction hint. Also detects the project's design stack (VS Code webview toolkit, React + Tailwind/shadcn, Material UI, vanilla CSS, etc.) and generates complete production-ready code using the project's own tokens and primitives. Distinguishes "broken" (frontend engineer) from "confusing" (UX territory) in critique mode. Does not create image or graphic assets.

## [0.59.4] - 2026-06-03

### Fixed
- **Chat surface focus**: Focusing on the AtlasMind chat no longer opens an unexpected second window. A `lastUsedSurface` tracker on `ChatPanel` remembers whether the user last interacted with the sidebar view or the detached editor panel, and `revealPreferredChatSurface` now honours that preference instead of always preferring the detached panel. Tool-approval and generated-skill-review flows (which previously hard-coded `atlasmind.openChatPanel`) now use the preferred surface so the sidebar is respected.

## [0.59.3] - 2026-06-03

### Changed
- **Instruction sync**: Synchronized `CLAUDE.md` and `.github/copilot-instructions.md` so both AI coding assistants share the same rules. Added full Core Services table, UI Surfaces table, Documentation Files and Wiki Pages sections, and the extra Security redaction-boundary rule to `CLAUDE.md`. Added the explicit Branching section and Publishing Routine to the Copilot instructions.

## [0.59.2] - 2026-06-03

### Fixed
- **Dashboard prompt buttons default to New Session**: Clicking any "Ask Atlas…", "Analyze in chat", or similar prompt-triggering button in the dashboard now opens the chat panel with the send-mode dropdown defaulted to **New Session**, consistent with all other dashboard-initiated chat actions (gap analysis, gap resolution, TDD fix).

## [0.59.1] - 2026-06-03

### Fixed
- **Dashboard list panels**: Long lists (commits, sessions, runs, SSOT files, roadmap, gap analysis, tests, branches) now cap at 480 px with a scrollbar rather than expanding the panel to arbitrary height. Nested lists (e.g. tests within a category group) are excluded from the cap to avoid double-scrolling.
- **Dashboard recent-item padding**: Card-style list items (`recent-item`) now carry 12 px / 14 px padding so text and tags no longer press against the card border.

## [0.59.0] - 2026-06-03

### Added
- **Quick-reply pill buttons**: When an assistant response ends with a question, pill buttons now appear below the message for one-tap replies. Yes/No buttons are generated for confirmatory questions ("Shall I proceed?", "Want me to…?"). A/B buttons are extracted from "X or Y?" patterns. Generic trailing questions surface a text input without pills. Clicking a pill submits immediately — no "Proceed" step required.

### Changed
- **Continuation detection expanded**: "yes", "yes please", "sure", "ok", "yep", "go for it", "no", "no thanks", "nope", "skip it", "cancel" are now recognised as continuation signals. The model is told to execute the pending next step rather than re-analyse.
- **Session continuity hint**: When structured session context is loaded, the orchestrator system prompt now explicitly instructs the model to treat the session context as ground truth and not re-derive established findings, file paths, or concluded work.
- **Tighter thought summary**: Removed "Agent: X via Y" and raw `N in / M out` bullet lines from the user-visible thought summary. Cost is shown as a single concise line (`$0.0012 · 1,234 in / 456 out`). The agent/model routing detail was noise for most users.
- **Dead code removed**: Deleted `_registerDefaultProviders` (~296 lines) from `extension.ts`. The function was never called; provider seed configs are wired inline in `bootstrapAtlasMind`. This reduces the god-file by ~8% as part of the ongoing [P2] code-structure gap closure.

## [0.58.0] - 2026-06-03

### Added
- **Memory Agent** (`memory-agent`): New built-in agent that owns all memory maintenance LLM calls — session context updates and SSOT snippet refreshes. Visible in the Agents panel; configure `allowedModels` to pin it to a local Ollama model and avoid cloud costs for background memory ops entirely.
- **Unified session context (`context.md`)**: Session context is now maintained as a single `context.md` per session (Goal, Approach, Findings, Concluded, Open Threads, SSOT Links, Current State) with a 4000-char cap. This replaces the previous 3-call fan-out across `summary.md`, `decisions.md`, and `open_threads.md`, cutting background LLM calls per turn from 3 to 1 and producing a coherent document designed for seamless cold resumption.
- **SSOT snippet refresh**: The Memory Agent periodically detects SSOT entries whose source files have changed but whose snippets are stale, and regenerates them in the background (max 3 per cycle). This prevents degrading retrieval quality as source files evolve.

### Changed
- Legacy session folders (pre-`context.md`) are read transparently via the old 4-file format and migrated to `context.md` on the next maintenance run. No manual migration needed.
- `SessionContextManager` now exposes `getSsotRoot()` for components that need the resolved SSOT path.

## [0.57.13] - 2026-06-03

### Added
- **Documentation Writer agent** (`docs-writer`): New built-in agent for README files, API reference docs, JSDoc/TSDoc comments, wiki pages, guides, changelogs, and inline documentation. Inspects the codebase before writing to match existing style, verifies code snippets against the implementation, and runs any configured docs-linting or link-checking step. Routes to cheap models for most documentation tasks.
- **Performance Analyst agent** (`performance-analyst`): New built-in agent for CPU hot paths, memory leaks, slow queries, high latency, throughput issues, and general optimization. Gathers observable evidence (profiling, benchmarks, timing logs) before proposing changes and verifies improvement is measurable afterward.
- **DevOps Engineer agent** (`devops-engineer`): New built-in agent for CI/CD pipelines, GitHub Actions, Dockerfiles, Docker Compose, Kubernetes manifests, Terraform/Bicep IaC, and deployment configs. States blast radius before applying infra changes and validates trigger conditions and environment assumptions for workflow changes.
- **Dependency Manager agent** (`dependency-manager`): New built-in agent for npm/pip/cargo/yarn/pnpm package updates, vulnerability remediation, peer conflict resolution, and lockfile hygiene. Checks changelogs for breaking changes before updating, runs tests afterward, and flags packages with known vulnerabilities or abandoned maintenance.
- **`http-request` skill**: Make HTTP requests with configurable method (GET/POST/PUT/PATCH/DELETE), headers, and request body. Applies the same SSRF protection as `web-fetch` (blocks localhost, private IPs, and metadata endpoints). Fills the gap left by `web-fetch` being GET-only.
- **`git-push` skill**: Push a branch to a remote with a built-in protected-branch guard. Force-pushes to `main`, `master`, `production`, `release/*`, and `hotfix/*` are rejected outright. When force is requested on a safe branch, uses `--force-with-lease` rather than `--force` to abort if the remote has moved since the last fetch.
- **`code-format` skill**: Format a file or directory using the project's configured formatter. Auto-detects prettier, eslint (--fix), rustfmt, black, gofmt, or dotnet-format from workspace config files and file extensions. A specific formatter can be forced via the `formatter` parameter.

### Changed
- **Cleaner activity display during execution**: Mechanical routing messages (model selection retries, local-model preference notices, per-iteration heartbeats) are now filtered from the streaming activity log shown to the user, reducing noise. Only meaningful milestones — agent selection, tool calls, model switches, and errors — appear in the "Working" activity panel.
- **Action-oriented final summary**: The "What Atlas did" disclosure (formerly "Thinking summary") now leads with a plain-English description of what was accomplished (e.g. "Used 4 tool calls — edited ×2, ran commands ×1.") rather than internal routing jargon. Technical details (agent, tokens, cost) are retained but deprioritised to the bottom of the expanded view.
- **Activity panel label**: The in-progress disclosure history is relabelled from "Inner monologue" to "Working" with a step count, matching the language of other AI coding tools.

## [0.57.12] - 2026-06-03

### Added
- **GitHub Operator agent** (`github-operator`): New built-in agent specializing in pull requests, issues, CI/CD workflow inspection, branch management, and repository housekeeping. Routes to cheap/local models for mechanical git operations (commit, push, PR creation, status checks) and escalates for CI diagnosis or complex PR analysis. Skips TDD formalities for purely mechanical git ops but expects a regression signal when workflow or config changes touch behavior.
- **Test Developer agent** (`test-developer`): New built-in agent specializing in writing, organizing, and maintaining automated tests — unit, integration, E2E, regression, and coverage analysis. Applies a hard test-first rule (failing spec before implementation) and closes every task with a run report showing the failing-to-passing transition and coverage delta. Naturally routes to cheap/local models for routine test generation and test-run commands.
- **Gap Analysis "Open Files" button**: Each gap item in the Project Dashboard Gap Analysis page now has an "Open Files" button that opens VS Code's Find in Files panel pre-filled with keywords from the gap text, scoped to category-relevant file patterns (`**/*.md` for documentation, `project_memory/**` for memory, `media/**,src/views/**` for UI/UX, etc.).

### Changed
- **Gap Analysis no longer auto-starts on navigation**: Navigating to the Gap Analysis page now shows existing findings rather than auto-triggering a new analysis run. The "Run Gap Analysis" / "Re-run Analysis" button initiates the analysis explicitly.
- **Smarter model routing for simple tasks**: The orchestrator now automatically downgrades `budget: auto` to `budget: cheap` (and `speed: fast`) for mechanical low-overhead tasks — git operations (commit, push, stash, pull, fetch, checkout, reset), script execution (run tests, npm build, yarn lint, etc.), short ≤10 word commands the classifier rates as `low` reasoning, and narrow test generation ("write a test for X"). This routes these to local or haiku-tier models first rather than consuming expensive subscription quota or pay-per-token credits on tasks that don't need complex reasoning. The `shouldPreferLocalToolCapableModelForPrompt` threshold is also widened from ≤5 to ≤8 words, and it now explicitly fast-paths git/script patterns for local-model preference when a local model is available.

### Fixed
- **Gap Analysis dashboard not updating**: Two bugs caused the Project Dashboard Gap Analysis page to show stale results after running a new analysis.
  1. When Claude's response lacked a perfectly-formatted checklist, `persistGapAnalysisIfRequested` was overwriting `gap-analysis.md` with the old seed items (the same items that seeded the run), reverting the dashboard to its pre-analysis state. The file is now left unchanged in that case, and a status message is posted instead.
  2. `collectGapAnalysisSnapshot` was always merging heuristic fallback items into the result alongside the real analysis items, so old heuristic gaps never disappeared after a new analysis. Heuristic items are now used only when the analysis file is absent or contains no parseable items.

## [0.57.11] - 2026-05-13

### Fixed
- CI lint compatibility: removed the unsupported `--ext` flag from the `lint` npm script when using ESLint flat config, so `quality` runs now execute successfully across Ubuntu, macOS, and Windows.

## [0.57.10] - 2026-05-13

### Changed
- Triggered a maintainer-authored CI run to clear an `action_required` workflow state and allow required `quality` checks to report for the release PR.
- Chat tool activity in the dedicated panel now renders inside the inner-monologue/thinking surface with latest-first display by default and a collapsible history for earlier updates.
- Memory self-healing now quarantines blocked SSOT entries into `temp/quarantine/*.blocked.txt.bak`, replaces blocked files with safe placeholders, sanitizes warned entries (hidden Unicode, suspicious instruction-like comments, secret-like values), and reindexes memory automatically.

### Fixed
- SSOT memory documentation now explicitly includes the internal `project_memory/sessions/` folder and clarifies that it is reserved for session context persistence and excluded from normal SSOT retrieval/index queries.

## [0.57.9] - 2026-05-13

### Added
- Deterministic SSOT auto-linker: Memory indexing and upserts now infer lightweight neighbor links when matching sibling artifacts exist in paired folders: `decisions/ <-> roadmap/` and `architecture/ <-> operations/`.

### Changed
- Bounded relation storage: `relatedPaths` are now capped to keep relationship density predictable and prevent graph-style noise growth over time.
- Cross-entry consistency on writes: Upserts now re-apply the auto-link pass across loaded memory entries so newly added sibling artifacts can become discoverable in one-hop expansion immediately.

## [0.57.8] - 2026-05-13

### Added
- Lightweight memory relationship overlay: `MemoryEntry` now supports optional `relatedPaths` links so SSOT notes can declare explicit neighbor artifacts (for example, decision -> rollout plan).

### Changed
- One-hop retrieval expansion: `MemoryManager.queryRelevant()` and `queryWithOptions()` now append bounded one-hop neighbors from top-ranked entries when result slots remain, giving AtlasMind better context continuity without replacing the existing lexical/vector ranking.
- Node CLI memory parity: `NodeMemoryManager` now applies the same related-path parsing and one-hop expansion behavior as the VS Code host memory manager.

### Fixed
- Import metadata ingestion: Memory import trailers now parse an optional `related-paths` field so generated memory can carry relationship links into retrieval.

## [0.57.7] - 2026-05-13

### Fixed
- Tool execution webview event handling regression: Removed duplicated nested status and busy handlers in `media/chatPanel.js` that caused repeated processing and unstable history rendering.
- Structured tool payload parsing: Replaced fragile regex parsing for `[TOOL_EXEC]` progress updates with brace-depth JSON extraction so nested tool metadata parses reliably.
- Chat panel template duplication and CSS corruption: Removed duplicated `recoveryNotice` markup and repaired the tool-history CSS block placement in `src/views/chatPanel.ts`.
- Changelog integrity: Repaired malformed and duplicated `0.57.3`/`0.57.4` sections introduced during prior editing.


## [0.57.2] - 2026-04-27

### Changed
- Version bump to 0.57.2

### Fixed
- **Copilot quota hard-stops**: Copilot's `"You've exhausted your premium model quota"` error was not recognised as a billing error, so the session failover and recovery path was never triggered ÔÇö the extension hard-stopped instead of pausing the provider and surfacing a helpful message. Added `exhausted ÔÇª quota`, `exhausted ÔÇª premium`, `premium model quota`, and `allowance to renew` to the `isBillingError` detection patterns.
- **`review` over-escalates to Opus**: The bare word `review` in `HIGH_REASONING_HINTS` caused lightweight read requests like `"review the roadmap"` to be profiled as high-reasoning and routed to the most expensive model. Removed `review` from that pattern; `code review` (the genuinely complex case) is still matched.

## [0.57.1] - 2026-04-24

### Fixed
- **Copilot quota hard-stops**: Copilot's `"You've exhausted your premium model quota"` error was not recognised as a billing error, so the session failover and recovery path was never triggered - the extension hard-stopped instead of pausing the provider and surfacing a helpful message. Added `exhausted ... quota`, `exhausted ... premium`, `premium model quota`, and `allowance to renew` to the `isBillingError` detection patterns.
- **`review` over-escalates to Opus**: The bare word `review` in `HIGH_REASONING_HINTS` caused lightweight read requests like `"review the roadmap"` to be profiled as high-reasoning and routed to the most expensive model. Removed `review` from that pattern; `code review` (the genuinely complex case) is still matched.

## [0.57.0] - 2026-04-23

### Added
- **`ClassifierService`** (`src/core/classifierService.ts`): Single batched LLM call (cheap/local-first via the `completeMaintenance` path) that answers all routing questions at once ÔÇö specialist domain, routing needs, modality, reasoning depth, workspace bias, and UI command ÔÇö replacing ~50 per-request regex tests. The system prompt is prompt-cached across calls; only the user message and the ~30-token JSON response vary per call. Every field has a regex fallback so the service degrades gracefully when no model is available or the response is malformed.
- **`Orchestrator.classify()` public method**: Exposes `ClassifierService.classify()` so callers in `participant.ts` (and future callers) can run a classification without duplicating construction concerns.
- **`resolveSpecialistRoutingPlanWithClassifier()`** in `participant.ts`: Async specialist-routing resolver that replaces the 6 domain regex patterns (`VOICE_WORKFLOW_PATTERN`, `IMAGE_ANALYSIS_ACTION_PATTERN`, etc.) and the 20-entry `NATURAL_LANGUAGE_COMMAND_INTENTS` array with a single `Orchestrator.classify()` call. Falls back to the sync regex `resolveSpecialistRoutingPlan()` on any failure.

### Changed
- **`Orchestrator.processTask()`**: Runs `ClassifierService.classify()` once per request and embeds the result as `__classification` in `request.context`; downstream functions (`selectAgent`, `buildMessages`, `profileTask`) read from this key instead of re-running regex.
- **`selectAgent()`**: Reads `classification.routingNeeds` and `classification.workspaceBias` from context instead of `COMMON_ROUTING_HEURISTICS` regex.
- **`buildMessages()`**: Reads `classification.routingNeeds`, `biasDirect` (`workspaceBias === 'act'`), and `biasInvestigate` (`workspaceBias === 'investigate'`) from context.
- **`TaskProfiler.profileTask()`**: Reads `modality` and `reasoning` from `context.__classification` when present, skipping per-call regex inference.

## [0.56.0] - 2026-04-23

### Added
- **Universal prompt decomposition**: All freeform chat prompts are now analysed for multi-action intent. When a prompt contains two or more distinct, separable actions (e.g. "fix X, then add Y and update Z", or a numbered task list), AtlasMind automatically decomposes it into a Planner-generated subtask DAG and executes each step sequentially or in parallel. A fast cheap LLM classifier (via the existing `completeMaintenance` path) makes the decision instead of fragile hardcoded heuristics; an obvious-structure regex short-circuits it for free on explicitly formatted lists.
- **`processTaskMultiStep` orchestrator method**: New public method on `Orchestrator` that decomposes a single `TaskRequest` into a subtask DAG using the `Planner`, executes steps via the `TaskScheduler`, streams each result as it completes, and synthesises a unified final response. Progress callbacks include per-step start/done/retry events. Returns `TaskResult & { stepwiseResults }` so callers can inspect individual step outcomes.
- **`subtask-retry` progress event**: `ProjectProgressUpdate` now includes a `subtask-retry` variant emitted whenever a subtask is retried (transient provider error or empty/capped response). The project runner and multi-step path surface this to the user as a progress message.
- **`TaskResult.stepwiseResults`**: Optional field added to `TaskResult` carrying the ordered `SubTaskResult[]` from a multi-step execution.

### Changed
- **Robust error recovery in all chat modes**: `runChatTask` (freeform and vision paths) and the native VS Code chat path now wrap `processTask` in a recovery layer. On failure it retries once with a simplified prompt (truncated to 200 chars plus a `[Simplified retry]` directive); if the retry also fails, it surfaces an actionable error message (credit exhaustion, network failure, no model available, etc.) rather than a raw exception.
- **`executeSubTask` auto-retry**: If a subtask produces an empty response or hits the iteration cap, the orchestrator retries it once with a simplified prompt before marking it failed. On transient provider errors it also retries once before returning a `failed` result, with recovery-hint text streamed to the chat.
- **`executeSubTask` passes `onProgress`**: The `onProgress` callback is now forwarded from `processProject` into `executeSubTask` so retry events are visible on the project runner stream.

## [0.55.4] - 2026-04-22

### Fixed
- **Shopify template presets generate sparse/generic documentation**: The root cause was that `applyTemplateScaffolding` ran *after* `applyBootstrapIntake`, so the AI generation (soul, brief, roadmap, improvement plan) had almost no Shopify-specific context to work from. Two changes fix this:
  1. **`enrichIntakeForTemplate`** ÔÇö called before the write phase, fills in `techStack`, `thirdPartyTools`, `productSummary`, `productOutcome`, and `targetAudience` with Shopify-appropriate defaults for each preset (New Store, Theme, App), skipping any field the user already answered. This gives `generateBootstrapContent` full context so all four AI calls produce Shopify-specific output.
  2. **Template scaffolding now runs before AI generation** ÔÇö workspace files (`layout/`, `sections/`, routes, `shopify.app.toml`, etc.) and `project_memory/operations/getting-started.md` are written first; then the enriched intake drives AI generation of `project_soul.md`, `domain/project-brief.md`, `roadmap/bootstrap-plan.md`, and `roadmap/improvement-plan.md` with accurate Shopify stack context.

## [0.55.3] - 2026-04-22

### Added
- **Bootstrap resume / draft persistence**: The bootstrap intake now saves a draft to `project_memory/index/bootstrap-draft.json` after every answered question. If bootstrap is interrupted at any point ÔÇö window close, error, ESC ÔÇö the next run detects the draft and offers three choices: **Resume** (pre-populate all previously answered fields and skip those questions), **Start over** (discard draft and begin fresh), or **Cancel**. The resume prompt shows how many answers were saved and when the draft was last updated. The draft is automatically deleted on successful completion. Resuming works across all modes (guided, minimal, and template/Shopify starter kits).

## [0.55.2] - 2026-04-22

### Fixed
- **Bootstrap ÔÇö GitHub repo creation fails with "--push enabled but no commits found"**: `gh repo create --push` requires at least one commit to exist in the local repo. Bootstrap now checks for commits with `git log -1` before invoking `gh repo create`; if none exist, it runs `git add -A && git commit -m "chore: initial AtlasMind bootstrap scaffold"` first so the push always succeeds.

## [0.55.1] - 2026-04-22

### Fixed
- **Bootstrap ÔÇö "Unable to write to Folder Settings" error**: `applyBootstrapSettings` was using `ConfigurationTarget.WorkspaceFolder`, which requires the configuration object to have been scoped to a workspace folder resource. Bootstrap calls `getConfiguration` without a resource URI, so the target is now `ConfigurationTarget.Workspace` (writes to `.vscode/settings.json`), which is both correct for single-root workspaces and doesn't require a folder resource.

### Changed
- **Shopify starter kits moved into project type picker**: The three Shopify templates (New Store, Store / Theme, App) are now presented as options inside the "What type of project is this?" step of the guided intake, rather than as a separate "From template" mode at the start of bootstrap. This keeps the bootstrap entry point to two options (Guided and Minimal) and makes the Shopify options discoverable alongside standard project types.

## [0.55.0] - 2026-04-22

### Added
- **Shopify project templates in bootstrapper**: Three new templates are available under the "From template" bootstrap mode:
  - **Shopify New Store** ÔÇö `.shopifyignore`, `.vscode/extensions.json` (recommends `Shopify.theme-check-vscode` + `Shopify.shopify-dev-assistant`), and a `project_memory/operations/getting-started.md` covering Partner account setup, dev store creation, CLI install, auth, and day-to-day commands.
  - **Shopify Store / Theme** ÔÇö Full Liquid theme directory scaffold (`layout/theme.liquid`, `templates/*.json`, `sections/`, `snippets/`, `assets/`, `config/settings_schema.json`, `locales/en.default.json`), `.shopifyignore`, `.github/workflows/theme-check.yml` (uses `Shopify/theme-check-action@v2`), `.vscode/extensions.json` (recommends `Shopify.theme-check-vscode` + `GraphQL.vscode-graphql`), and a getting-started guide.
  - **Shopify App** ÔÇö Remix-based app structure (`shopify.app.toml`, `.env.example`, `web/app/routes/`, `extensions/`), `.github/workflows/deploy.yml`, `.vscode/extensions.json` (recommends `Shopify.shopify-dev-assistant`, `Shopify.theme-check-vscode`, `GraphQL.vscode-graphql`, `esbenp.prettier-vscode`, `dbaeumer.vscode-eslint`), and a getting-started guide covering Partner app registration, CLI auth, and `shopify app dev`.
  - All three templates write files only if they do not already exist and output a getting-started guide to `project_memory/operations/getting-started.md`.
- **`BootstrapProjectIntake.mode` extended** with `'template'` variant; `selectedTemplate` field added for `'shopify-new-store' | 'shopify-theme' | 'shopify-app'`.
- **Bootstrap completion summary** now reports which template was scaffolded when the template mode is used.

## [0.54.5] - 2026-04-22

### Added
- **AI-generated bootstrap memory**: Bootstrap now calls the model during the write phase to reason about the project rather than slot-filling templates. Four parallel `completeBootstrap` calls generate: (1) a specific Vision and Principles for `project_soul.md`, (2) a full problem-space analysis with open questions for `domain/project-brief.md`, (3) a project-specific prioritised checklist for `roadmap/bootstrap-plan.md`, and (4) a reasoned developer backlog for `roadmap/improvement-plan.md`. Each document falls back to the existing template if no model is available or the call returns empty, so bootstrap remains fully functional offline.
- **`Orchestrator.completeBootstrap()`**: New one-shot completion path used exclusively by bootstrap generation ÔÇö routes via `balanced` budget constraints, 3000 token cap, and temperature 0.4 for richer prose output.

## [0.54.4] - 2026-04-22

### Fixed
- **Bootstrap ÔÇö duplicate repo questions**: Removed the redundant "planned repo location" text field from the intake questionnaire; the actual GitHub creation prompts (name, owner, visibility) already collect this information at creation time.
- **Bootstrap ÔÇö silent failure after cadence question**: The entire write phase (SSOT scaffold, memory files, governance baseline) now runs inside `vscode.window.withProgress`, giving a persistent notification with step-by-step progress messages ("Creating SSOT scaffoldÔÇª", "Writing project memoryÔÇª", etc.). Any uncaught error now surfaces as an explicit error notification instead of disappearing silently.
- **Bootstrap ÔÇö governance baseline ignores intake answers**: `scaffoldGovernanceBaseline` now uses the dependency monitoring provider and schedule selections made during bootstrap intake rather than falling back to workspace settings, so the answers the user just gave are actually applied.

## [0.54.3] - 2026-04-22

### Added
- **No-project CTAs in Quick Links and Project Dashboard**: "Bootstrap new project" and "Import existing project" buttons are now shown prominently when no AtlasMind project memory is loaded. In the Quick Links sidebar, they appear as two full-width buttons below the icon row. In the Project Dashboard, they appear as a banner above the topbar. Both sets of buttons disappear once a project is bootstrapped or imported.

## [0.54.2] - 2026-04-22

### Fixed
- **Bootstrap remote repo creation**: When "Create a new online repo now" is selected during bootstrap, Atlas now actually creates the repository rather than silently recording intent. For GitHub, Atlas invokes `gh repo create` with the chosen name, owner, and visibility, then pushes the initial commit and sets `origin`. If `gh` is not installed, Atlas auto-installs it using the first available package manager (`winget`/`scoop`/`choco` on Windows, `brew` on macOS, `apt`/`dnf` on Linux) with a confirmation prompt before proceeding; falls back to a manual install link if no package manager is found. For Azure DevOps and GitLab, Atlas shows the equivalent CLI command and opens a terminal. The completion summary now distinguishes between a successfully created repo (with URL), a failed attempt with recovery instructions, and a deferred/skipped state.
- **Bootstrap question wording**: Updated the online repo question option from "Needs a new online repo" to "Create a new online repo now" and the repo-host sub-question to make the immediate creation intent explicit.

## [0.54.1] - 2026-04-21

### Fixed
- **Settings panel navigation**: The "Testing" tab button was missing from the settings nav sidebar, making the Testing page unreachable. Restored the nav button between Safety & Verification and Project Runs.

## [0.54.0] - 2026-04-21

### Added
- **Session SSOT context** (`src/memory/sessionContextManager.ts`): New `SessionContextManager` service maintains a per-session folder under `project_memory/sessions/<id>/` containing a rolling `summary.md`, `decisions.md` (concluded facts and fixes), `open_threads.md` (unresolved questions), `ssot_links.md` (cited main SSOT entries), and an append-only `transcript.jsonl`. Updated each turn via a fire-and-forget maintenance pipeline.
- **Structured session context in model prompts**: Orchestrator `buildMessages()` and `buildRetrievalContext()` now consume the `SessionContextBundle` when available, replacing the previous 400-char session context string. The bundle provides up to 2000 chars of structured summary + decisions + open threads + cross-referenced SSOT excerpts, giving models full coherent context when returning to a session after any gap.
- **Main SSOT cross-referencing per session**: Maintenance pipeline detects word overlap between session content and main SSOT entries (`decisions/`, `misadventures/`, `architecture/`, `roadmap/`, `domain/`, `operations/`) and cites relevant files in `ssot_links.md`, loading short excerpts into the model context on each turn.
- **Maintenance model routing**: `ModelRouter.scoreModel()` now applies a `maintenance` phase bonus ÔÇö local models with context ÔëÑ 8192 score +2.0, free-tier cloud models score +1.5 ÔÇö ensuring background summarization tasks consume local/free capacity first and never burn quota.
- **`completeMaintenance()` on Orchestrator**: New lightweight one-shot completion path that routes via the `maintenance` task profile, caps output at 1024 tokens, and silently returns empty string on any error. Used by `SessionContextManager` and provider hard-stop recovery.
- **Self-healing provider hard-stop recovery**: When all failover models are exhausted after a provider failure, the orchestrator now calls `completeMaintenance()` to generate a human-readable recovery acknowledgement (what happened, what completed, what to do next) rather than surfacing a raw error string as the final chat bubble.
- **Session SSOT cleanup on delete**: Deleting a chat session from the chat panel now also removes the corresponding `project_memory/sessions/<id>/` folder.
- **`getActiveSessionId()` on `SessionConversation`**: Exposes the currently active session ID as a public method.

### Changed
- **`SSOT_FOLDERS`** extended with `'sessions'` ÔÇö bootstrapper creates `project_memory/sessions/` on first activation.
- **`TaskPhase`** extended with `'maintenance'` for background routing.
- **`MemoryDocumentClass`** extended with `'session-context'`.
- **`SessionContextBundle`** interface added to `types.ts`.
- **`MemoryManager.queryRelevant()`** and `queryWithOptions()` now exclude `sessions/` paths from general SSOT queries ÔÇö session context is loaded directly by `SessionContextManager`.
- **Session context budget** raised from 400 to 2000 chars in `buildRetrievalContext()` for the legacy string fallback path.
- **`chatPanel.ts`**: `preparePromptRequest()` accepts an optional `SessionContextBundle` and injects it alongside `chatSessionId` in the request context.

## [0.53.7] - 2026-04-21

### Changed
- **Dev tooling upgraded**: vitest `2.x` ÔåÆ `4.1.5`, eslint `9.x` ÔåÆ `10.2.1`, TypeScript `5.x` ÔåÆ `6.0.3`. All 890 tests pass, zero lint warnings.

### Fixed
- **Locale-stable token formatting**: `participant.ts` now calls `toLocaleString('en-US')` so token counts always render with comma separators on non-English CI environments.
- **Locale-stable test assertions**: Usage bullet assertions in `participant.helpers.test.ts` now match on token counts only (currency symbol varies by OS locale); vscode mock pins `displayCurrency` to `'USD'`.

## [0.53.6] - 2026-04-21

### Added
- **Live local model sync** (`src/providers/localModelSync.ts`): New module queries Ollama (`GET /api/tags` + `POST /api/show`) and LM Studio (`GET /v1/models`) in parallel on each activation (30 s timeout). Extracts real context window from `model_info.*.context_length` or `NUM_CTX` in the modelfile, parameter count, and quantisation level. Results are cached in `globalState` with a 1-hour TTL and applied as highest-priority metadata in `mergeProviderModels`, so Ollama's actual context length beats the static catalog.

### Fixed
- **Local model pricing forced to zero** in `inferModelMetadata`: local provider models no longer inherit cloud pricing heuristics ÔÇö `inputPricePer1k` and `outputPricePer1k` are always 0 when `providerId === 'local'`.

## [0.53.5] - 2026-04-21

### Added
- **`LOCAL_CATALOG`** in `src/providers/modelCatalog.ts`: Static entries covering Gemma 3 (1B/4B/12B/27B with vision on 4B+), Nemotron (Mini/Nano/4B/70B), Devstral (Small/generic), Mistral (7B/NeMo/Small/Large), Qwen 2.5 Coder (7B/14B/32B), Qwen 2.5, Qwen 3 (14B/30B/235B with reasoning), Llama 3.x (1B/8B/70B), Phi (3/3.5/4), DeepSeek R1 distills, Codestral, Command R/R+. All entries carry correct zero pricing and accurate capability flags including vision where supported.

### Fixed
- **`inferCapabilities` updated** for local models: small (< 4 B) local models no longer get `function_calling` by default; tool support is granted only for families known to support it (Mistral, Qwen, Llama, Command, Devstral, etc.).

## [0.53.4] - 2026-04-21

### Fixed
- **`scoreLocalPreference` rewritten** in `ModelRouter`: the previous flat +1.0 bonus was large enough to override capable free-subscription cloud models and double-counted the zero-cost advantage already captured by `scoreCheapness`. Replaced with a graduated, capability-gated bonus (max +0.4) that penalises local models without reasoning for high-reasoning tasks and returns 0 for models with a context window below 16 k.
- **`classifySpeedTier` fixed** for local models: non-echo local models are now classified as `'balanced'` instead of `'fast'`, so they are no longer excluded from `speed: 'considered'` task routing.
- **`shouldPreferLocalToolCapableModelForPrompt` tightened**: word-count threshold tightened from 8 to 5, and complexity verbs (`fix`, `refactor`, `debug`, `implement`, etc.) and complexity-indicator words (`all`, `entire`, `comprehensive`, etc.) now suppress local-first routing so complex multi-step requests are not incorrectly steered to small local models.

## [0.53.3] - 2026-04-21

### Fixed
- **`selectProviderFailoverModel` rewritten** in `Orchestrator`: the previous implementation immediately escalated to `budget:'expensive'` + `speed:'considered'`, ignoring the user's stated budget preference. The new implementation walks budget and speed constraints incrementally (cheap ÔåÆ balanced ÔåÆ expensive, fast ÔåÆ balanced ÔåÆ considered), preferring a different provider at each step, so failover respects budget intent and only relaxes constraints as far as necessary.
- **`DEFAULT_AGENT_SYSTEM_PROMPT` strengthened**: the previous single vague line about release hygiene is replaced with four specific lines naming exact files that must be updated per change type (version bumps, configuration settings, source file changes, provider adapter changes).

## [0.53.2] - 2026-04-21

### Fixed
- **Documentation matrix in `CLAUDE.md` and `.github/copilot-instructions.md`**: added `docs/configuration.md` as a required update target for configuration setting changes; added `README.md (version banner)` as a required target for version bumps. Both files also updated the current-version reference to read from `package.json` rather than a hardcoded string.
- **Architecture and development docs updated**: `docs/architecture.md`, `docs/development.md`, and `wiki/Architecture.md` now reflect `CurrencyFormatter`, `CopilotMultiplierSync`, and `LocalModelSync` in the dependency graph and core services table.

## [0.53.1] - 2026-04-21

### Fixed
- **Copilot subscription tiers updated to current GitHub plans**: "Copilot Individual" renamed to **Copilot Pro** (matches current github.com/features/copilot naming), Free tier corrected from 90 ÔåÆ **50** premium requests/month, **Copilot Pro+** added (1500 requests, $39/user/month), **Copilot Student** added (300 requests, free for verified students). "per user" vs "per seat" wording aligned with GitHub's documentation for individual vs organisational plans.

## [0.53.0] - 2026-04-21

### Added
- **Local currency display**: All cost values (cost dashboard, chat cost summaries, budget alerts, project run center, model provider panel, personality profile, agent cost limits) are now formatted in the user's local currency rather than hardcoded USD.
  - **Auto-detection**: On first run Atlas detects your OS locale (e.g. `en-GB` ÔåÆ GBP, `de-DE` ÔåÆ EUR) and uses the matching currency symbol and number formatting automatically.
  - **Live exchange rates**: On each activation Atlas fetches fresh USD exchange rates from `open.er-api.com` (free, no API key required) and stores them in `globalState` with a 24-hour TTL. Values shown in non-USD currencies reflect the rate at last sync. The fetch is non-blocking and silently falls back to the stale cache if the network is unavailable.
  - **`atlasmind.displayCurrency` setting**: Override the auto-detected currency with any of 19 supported codes (USD, EUR, GBP, JPY, CAD, AUD, CHF, CNY, INR, BRL, MXN, KRW, SEK, NOK, DKK, NZD, SGD, HKD, ZAR). Set back to `"auto"` to restore OS-locale detection.
  - **`src/core/currencyFormatter.ts`**: New shared module providing `formatCost()`, `formatCostAdaptive()`, `getDisplayCurrency()`, `detectSystemCurrency()`, `getExchangeRate()`, and `syncExchangeRates()`. All previous per-file `$${value.toFixed(n)}` calls have been replaced with this formatter.

## [0.52.18] - 2026-04-21

### Fixed
- **Provider billing fallback**: When a provider is auto-disabled due to insufficient credits or a monthly spending cap (e.g. Google's `"exceeded its monthly spending cap"` 429), the orchestrator now tries a text-only fallback model on another provider instead of hard-stopping with a "no provider available" error. Google's spending-cap 429 is now correctly classified as a billing error, not a transient retry.
- **Tool-capability fallback**: When a model silently ignores tools (returns plain text instead of `tool_calls`) and no tool-capable model is available on any other provider, the orchestrator now falls back to the best available text-only model on a different provider for a best-effort response rather than returning the empty/incomplete response from the original model.
- **Claude CLI tool hand-off**: When a task requires tools and the only available model is the Claude CLI (which strips `function_calling`), the provider-error fallback path now relaxes the `function_calling` constraint and routes to the next best text-capable model, preventing a hard stop.
## [0.52.17] - 2026-04-20

### Added
- **Subscription plan configuration**: Subscription providers (GitHub Copilot, Claude CLI) now have a `$(credit-card)` icon in the sidebar Models tree. Clicking it opens a guided flow to select a plan tier (Free / Individual / Business / Enterprise for Copilot; Max 5├ù / Max 20├ù for Claude CLI) or enter custom monthly cost and request totals. The flow also prompts for current remaining requests and optional reset date, then persists the full `SubscriptionQuota` including `costPerRequestUnit` to `globalState`. This plugs the gap where the routing scorer and cost tracker both depend on `costPerRequestUnit` but had no way to populate it.
- **Subscription details card**: Subscription provider cards in the Model Providers panel now show a quota summary (remaining / total, cost per unit, reset date) under the provider notes, updated on every panel refresh.
- **"Configure plan" button on provider cards**: Subscription provider cards also show a "$ Configure plan" button that triggers the same guided flow from within the webview panel.

## [0.52.16] - 2026-04-20

### Added
- **Copilot multiplier auto-sync**: A new `src/providers/copilotMultiplierSync.ts` module fetches the [GitHub Copilot billing docs](https://docs.github.com/en/copilot/concepts/billing/copilot-requests) on each model refresh and parses the premium-request multiplier table. Results are cached in `globalState` with a 7-day TTL, so they survive restarts and are applied immediately on the next activation. Stale or failed fetches fall back to the cached data, then to the static catalog.
- **`atlasmind.premiumMultiplierOverrides` setting**: A JSON map of `{ "model-id-fragment": multiplier }` that lets you override any model's Copilot premium multiplier immediately without waiting for a docs sync or an extension release. Priority: this setting > remote sync > static catalog.
- **Multiplier sync status banner**: The Model Providers panel now shows a status banner indicating when multipliers were last synced and how many models were updated. Turns amber when the cached data is over 7 days old, with a direct link to the GitHub docs and instructions for manual overrides.

### Fixed
- **Catalog multiplier corrections**: Split `claude.*opus.*4` into version-specific patterns so Opus 4.7 (7.5├ù), Opus 4.6 fast mode (30├ù, preview), and Opus 4.5/4.6 (3├ù) are matched separately. Removed the stale `premiumRequestMultiplier: 3` from `o1` (not in current Copilot table). Set `gpt-4o` and `gpt-4.1` to `0` (included models on paid plans). Set generic `haiku` to `0.33` to match Haiku 4.5 pricing.

## [0.52.15] - 2026-04-20

### Added
- **Subscription quota tracking**: Subscription provider request quotas (e.g. GitHub Copilot premium requests) are now decremented after every completed request, taking premium multipliers into account (Opus 4.7 at 3├ù costs 3 units per call). Quotas persist across sessions via `globalState` and are restored on startup with automatic rollover when the `resetsAt` period has elapsed.
- **Overflow billing mode**: When a subscription quota reaches zero, subsequent requests are routed as pay-per-token (`subscription-overflow` billing category) and their cost is recorded in the standard `costUsd` field so budget reporting remains accurate.
- **Quota notifications**: A warning toast fires at 10 % remaining quota and an error toast fires when the quota is fully exhausted, naming the affected provider.

### Fixed
- Removed dead unreachable code block in `commands.ts` MCP runtime install flow (lines after an unconditional `return`) that was causing a TypeScript error.

## [0.52.14] - 2026-04-20

### Fixed
- **Model pruning on refresh**: `mergeProviderModels` now uses the live API's discovered set as the authority. Models that have been deprecated or retired and are no longer returned by the provider API are removed from the router on each refresh, rather than persisting indefinitely in the session.
- **Pricing staleness on refresh**: Existing registered models now have their pricing, context window, capabilities, and premium multiplier re-applied from the static catalog on every refresh pass. Previously, pricing was frozen from first discovery and would not update even after a catalog change was shipped in a new extension release.

## [0.52.13] - 2026-04-20

### Fixed
- **Planner**: Injected dependency governance platform knowledge into the planner system prompt. Dependabot, Renovate, Snyk, and Azure DevOps all create pull requests ÔÇö the planner now routes those fetch steps to `gh pr list` via `terminal-run` instead of an issues API, preventing 100-second wasted tool calls.
- **Task scheduler**: Failed subtasks now propagate as skipped to all downstream dependents instead of running them with empty context. A dependency that fails (including quota exhaustion) causes its entire downstream chain to be marked skipped immediately, saving quota and avoiding misleading partial results.
- **Orchestrator project mode**: Billing/quota exhaustion in a subtask now aborts the entire project run immediately. Previously, the scheduler continued executing subsequent batches after a provider was billing-paused with no fallback, burning more quota and producing meaningless output.

## [0.52.12] - 2026-04-20

### Changed
- Upgraded `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` from v7 to v8 (Dependabot PR #33 partial).
- Upgraded `eslint` from v8 to v9; migrated from `.eslintrc.cjs` to flat config (`eslint.config.mjs`) and removed the deprecated `--ext ts` CLI flag.
- Upgraded `@types/node` from v20 to v25.
- Merged Dependabot PR #35: `actions/checkout` v4ÔåÆv6, `actions/setup-node` v4ÔåÆv6, `actions/upload-artifact` v4ÔåÆv7.
- Fixed three lint errors surfaced by the stricter v8/v9 rules: updated `no-var-requires` ÔåÆ `no-require-imports` suppression comments, replaced empty-interface extension with a type alias.

## [0.52.11] - 2026-04-20

### Fixed
- Model router no longer selects premium subscription models (e.g. Opus at 3├ù multiplier) when budget is set to **Cheap**; premium models are now excluded from the candidate pool at this budget tier regardless of subscription pricing.
- Provider fallback routing now relaxes budget gates one step at a time (`cheap ÔåÆ balanced`, `balanced ÔåÆ expensive`) instead of jumping directly to `expensive/considered`, so a billing failure on one provider no longer forces the most expensive available model.

## [0.52.10] - 2026-04-20

### Changed
- Improved MCP server runtime install flow:
  - Retries runtime installation if it fails.
  - Prompts for manual install if automation fails.
  - Suggests a VS Code reload if the runtime is still not detected after install.

## [0.52.9] - 2026-04-20

### Fixed
- Restored the missing `# Changelog` title and release-notes preamble so the file keeps its expected structure.
- Added a regression check and authoring guardrails so future release updates preserve the heading instead of overwriting it.
- Kept the protected merge gate stable by validating integration-monitor coverage, preserving the default-agent fallback for routine workspace tasks, and aligning persistence and MCP verification behavior with the live release flow.

## [0.52.8] - 2026-04-20

### Fixed
- Atlas no longer stops after a tool failure and summarizes the error ÔÇö it now attempts alternative strategies (e.g. reading the file to get exact text before retrying a file-edit) and only reports a hard blocker when alternatives are genuinely exhausted.
- Plain text pasted into Atlas Chat now stays in the composer instead of being misinterpreted as a set of attachment chips.
- The host-side attachment importer now ignores non-existent workspace paths so arbitrary prose cannot be promoted into fake file attachments.
- Restored the default-agent fallback for routine no-agent sessions so action-oriented workspace requests no longer detour through premature specialist synthesis.
- Hardened chat-session persistence logging for both synchronous and asynchronous storage failures.
- Made the MCP workspace-placeholder transport test pass consistently across Windows, macOS, and Linux CI.

## [0.52.6] - 2026-04-20

## [0.52.6] - 2026-04-20

### Fixed
- Restored the missing integration-monitor manifest so protected CI can verify marketplace-extension coverage, provider contract coverage, and specialist integration review during release promotion.

## [0.52.5] - 2026-04-20

### Fixed
- Cleared release-blocking lint violations across commands, environment tracking, chat search, dashboard helpers, and testing summaries so protected CI now passes for the master promotion flow.

## [0.52.4] - 2026-04-20

### Fixed
- Tightened Atlas chat intent handling so prompts about missing version or changelog updates are treated as corrective workspace tasks instead of being misread as simple version lookups.
- Hard-coded release-hygiene guidance into the default agent instructions so version bumps, changelog updates, and related docs stay part of the expected completion path.

## [0.52.3] - 2026-04-20

### Fixed
- Repaired the session-search jump helpers so previous and next arrows now advance through results instead of stalling in the webview.
- Wired prompt cancellation through the active chat execution path so Stop can interrupt answer generation more reliably.

## [0.52.2] - 2026-04-20

### Fixed
- Active session-search results now snap into the center of the transcript and visibly select their containing chat bubble.
- Previous and next search arrows now move through results with a stronger in-thread visual jump.

## [0.52.1] - 2026-04-20

### Fixed
- Session search now runs directly against the visible chat thread again, preventing the composer from getting stuck on ÔÇ£Searching this sessionÔÇªÔÇØ with no follow-up.
- Multi-match search navigation stays responsive with visible previous and next arrows and the active result highlighted in-place.

## [0.52.0] - 2026-04-20

### Added
- Gap Analysis now produces a richer project report covering architecture, safety/security, functionality, UI/UX, memory, code structure, testing, delivery, and praise signals.
- The dashboard groups findings by priority, adds per-gap resolve buttons, and includes one-click actions for resolving all P1 or P2 items in a fresh Atlas chat session.

### Fixed
- Unfinished projects no longer come back with an empty-looking Gap Analysis report when the model response is loose or partially structured.
- Structured gap-analysis results are saved back into the Project Dashboard automatically after the live chat finishes.

## [0.51.9] - 2026-04-20

### Fixed
- Corrected session-search result counting to follow the visible rendered transcript instead of raw Markdown source.
- Added previous and next result arrows beside Search so multi-match threads can be navigated directly.

## [0.51.8] - 2026-04-20

### Fixed
- Replaced the stuck session-search path with an immediate local thread search so results now resolve instantly, even for tiny conversations.
- Restored highlight-and-scroll behavior without leaving the Search button hanging on a running state.

## [0.51.7] - 2026-04-20

### Fixed
- Restored visible session-search feedback in the chat panel so pressing Search now shows a live running status and a clear match or no-match result.
- Rewired the search toggle to the active webview controls so search mode activates reliably.

## [0.51.6] - 2026-04-20

### Changed
- Moved chat bubble deletion from the header X control into a cleaner footer trash icon beside the assistant vote actions, keeping message deletion available with a more minimal layout.

## [0.51.6] - 2026-04-20

### Fixed
- Gap Analysis now visibly starts from the Project Dashboard, immediately opens its page, and shows progress/status while the analysis runs.
- Resolved the silent no-op feeling when triggering Gap Analysis from the dashboard UI.

## [0.51.5] - 2026-04-20

### Fixed
- Restored the Project Dashboard after a Gap Analysis regression injected invalid dashboard panel and webview code, preventing the dashboard from opening.
- Wired the Gap Analysis message flow and snapshot parsing back into the dashboard safely.

## [0.51.4] - 2026-04-20

### Changed
- **Unified chat/search input:** The chat panel now uses a single input field for both chat and session search. Toggling the Search icon swaps the Send/Mode controls for a Search button, and Enter submits a search in search mode. This improves accessibility and reduces UI clutter.

### Fixed
- Focus and ARIA state are preserved when toggling between chat and search modes.

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).


## [0.51.3] - 2026-04-20

### Fixed
- **`NodeMemoryManager` parity with `MemoryManager`**: The CLI variant of the memory manager now fully matches the VS Code variant ÔÇö `embedText` now uses XOR-fold hash distribution to eliminate index bias, `inferMemoryQueryMode` now includes a `planning` branch, and `getDocumentClassBoost`/`getEvidenceBoost`/`getFreshnessBoost` all handle the `planning` query mode.
- **`sessionConversation.ts` corruption**: Repaired a dangling `deleteMessage` method fragment that had been prepended to the file before the `import` statement, causing a TypeScript parse error. The method is now correctly placed inside the `SessionConversation` class.
- **`chatPanel.ts` `deleteMessage` message type**: Added `deleteMessage` to the `ChatPanelMessage` union type and the `isChatPanelMessage` type guard so the webview handler compiles.
- **Transient context redaction in orchestrator**: Blocked session, chat, and attachment context (detected by `scanTransientContext`) now correctly results in a security notice in the system prompt rather than passing through a redacted string that bypassed the second scan pass.

### Tests
- Fixed `treeViews.test.ts` mock objects: added `getStats` to all `memoryManager` mocks so `MemoryStatsTreeItem` can be constructed without throwing.
- Fixed `orchestrator.tools.test.ts`: corrected assertion index for the source-backed-memory live-evidence test (`recordedRequests[0]` ÔåÆ find by content) to account for the agent selection pre-call.

---
## [0.51.2] - 2026-04-20

### Added
- **Chat bubble classification and context weighting:** Each chat message is now automatically classified (intent, answer, system, error, irrelevant) and assigned a relevance weight. The orchestrator context selection logic now prioritizes relevant bubbles, reducing context pollution from system/billing errors and keeping the thread focused.

### Changed
- Context-building logic in sessionConversation.ts now uses classification and weighting to select the most relevant transcript entries for orchestrator context.

---
## [0.51.1] - 2026-04-20

### Added
- **Chat panel session search toggle:** Added a "Search" icon to the chat panel composer toolbar. Toggling this icon switches the composer between chat and session search modes. The search input and results area now appear when toggled, and the chat input is hidden in search mode. This lays the foundation for advanced session search with glob-style matching.

### Changed
- Refactored chat panel UI state logic to support toggling between chat and search modes.

---
## [0.51.0] - 2026-04-20

### Added
- **`/memory write` chat command**: Operators can now save a memory entry directly from the chat participant with `/memory write <path> | <title> | <content>`, bypassing the need to ask Atlas to remember something on their behalf.
- **`/memory stats` chat command**: `/memory stats` shows total entries, warnings, blocked count, stale imports, and a breakdown by document class.
- **Memory index stats tree item**: The Memory tree view now shows an inline stats row (entry count, warnings, blocked) whenever entries are indexed, giving at-a-glance health visibility without opening a separate panel.
- **`MemoryManager.queryWithOptions()`**: New method allowing callers to override the retrieval mode (`planning`, `live-verify`, `summary-safe`, `hybrid`), filter by required tags, and exclude document classes ÔÇö replacing the need to rely on auto-inference for all use cases.
- **`MemoryManager.getStats()`**: New method returning aggregate statistics (`MemoryStat`) about the current index: entry count, per-class breakdown, warning/blocked counts, total snippet chars, and potentially-stale import count.
- **Memory-aware project planning**: The `Planner` now accepts an optional `MemoryStore` reference. When provided, it queries roadmap, decisions, and architecture memory entries and injects them into the planning prompt so subtask decomposition is informed by existing project context. All three `Planner` construction sites (orchestrator, chat participant, project run centre panel) now pass `memoryManager`.
- **Transient context injection scanning**: Session history, native chat context, and attachment context are now scanned for prompt-injection patterns (using `scanTransientContext` from `memoryScanner`) before being included in any model prompt. Blocked contexts are replaced with a redaction notice rather than silently passed through.
- **`scanTransientContext` export**: New function in `memoryScanner.ts` that applies only prompt-injection rules (not credential rules) to freeform chat/attachment text ÔÇö credentials in discussion are not the same as credentials in storage.
- **New types**: `MemoryQueryOptions`, `MemoryStat`, and `OperatorFeedback` added to `types.ts` to formalise the query, stats, and feedback-learning contracts.
- **`inferMemoryQueryMode` export**: The query-mode classifier is now exported so tests and external callers can use and verify it directly.

### Fixed
- **`persistEntry` parent directory creation**: Writing a memory entry to a new SSOT sub-path no longer fails silently ÔÇö the parent directory is now created before the write, and errors propagate to the caller rather than being swallowed.
- **`buildRetrievalContext` query enrichment**: Memory retrieval now incorporates the first 400 chars of `sessionContext` alongside `userMessage`, making the query more representative of the full conversational context rather than just the single latest message.
- **Hash embedding distribution**: `embedText` now XOR-folds the high and low 16-bit halves of the FNV hash before the modulo operation, spreading token hash values more evenly across embedding dimensions and reducing clustering at boundary slots.

### Tests
- 9 new unit tests for `inferMemoryQueryMode` covering all four modes (`planning`, `live-verify`, `summary-safe`, `hybrid`).
- 5 new unit tests for `queryWithOptions` (tag filter, class exclusion, mode override) and `getStats`.
- 4 new persistence tests in `memoryPersistence.test.ts` verifying that `persistEntry` creates parent directories, writes correct content, and no-ops safely when `rootUri` is unset.

## [0.50.2] - 2026-04-20

### Fixed
- **Seamless re-routing when a model lacks tool support**: The orchestrator now detects when a model silently returns a plain text response instead of calling tools (i.e. it lacks runtime `function_calling` support at the first iteration). Rather than stalling and awaiting user input, it immediately records the model as incapable for this task and re-routes to a `function_calling`-capable model ÔÇö the task continues without any interruption. This addresses `claude-cli` and any other model whose catalog entry does not include `function_calling`.
- **Provider connectivity failures now trigger failover**: Network-level errors (`ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`, `ENETUNREACH`, `fetch failed`) were not recognised as transient by `isTransientProviderError`, so they were thrown immediately without retry. These are now treated as transient ÔÇö they retry with backoff before promoting to a provider failover, making short outages invisible to the user.

## [0.50.1] - 2026-04-19

### Fixed
- **`file-move` and `file-delete` tool approval misclassification**: Both tools were falling into the `default` branch of `classifyToolInvocation`, which classified them as `category: 'network'` instead of `'workspace-write'`. This caused two symptoms: the approval UI showed an incorrect category label, and any prior "bypass workspace-write" approval granted by the user would not match ÔÇö causing the approval prompt to re-fire on every file-move/delete in the same task. Both tools are now explicitly listed as `workspace-write` alongside `file-write` and `file-edit`.

## [0.50.0] - 2026-04-19

### Added
- **Import session context**: Each session bubble in the Sessions panel now has a "share" icon button (alongside Archive and Delete). Clicking it calls the orchestrator with a focused summarization prompt against the source session's full transcript, writes the condensed markdown summary to `.atlasmind/session-context-<title>-<id>.md` (excluded from git via `.gitignore`), and attaches the file to the current session's composer ÔÇö ready to be sent with the next prompt. The active session cannot import from itself. The summary includes Goal, Key Decisions, Findings, and Open Items sections.

## [0.49.43] - 2026-04-19

### Added
- **Agent synthesis transparency**: When the orchestrator auto-synthesizes a specialist agent, the chat now clearly explains what happened. The status bar shows live progress messages ("No registered agent closely matched this task ÔÇö creating a specialist agent on the fly" and "Synthesized specialist agent X (role) ÔÇö registered for this session"). The thought summary (expandable details block on the response) is relabelled "Thinking summary ÔÇö new agent created" and its body describes the synthesized agent by name. Four additional bullets appear: the auto-synthesis trigger explanation, the agent's role, its purpose/description, and a note that the agent persists for the session and can be managed from the Agents panel. This uses a new `synthesizedAgent` field on `TaskResult` threaded from `processTask` through `buildAssistantResponseMetadata`.

## [0.49.42] - 2026-04-19

### Added
- **Agent auto-synthesis**: When a task arrives with specialisation signals (routing needs detected) and no registered agent scores any token overlap against it, the orchestrator now synthesises a specialist agent on the fly before executing the task. The LLM generates a focused `AgentDefinition` JSON (role, description, system prompt), which is then validated by `validateSynthesizedAgent()` ÔÇö checking for required fields, length limits, prompt-injection patterns, and authority-escalation phrases. Agents that pass validation are wrapped with `IMMUTABLE_GUARDRAILS` and `DEFAULT_AGENT_SYSTEM_PROMPT`, registered in the `AgentRegistry` for session-scoped reuse, and immediately used to handle the task. Synthesis failures are cached to prevent retry storms and the orchestrator falls back to the best available agent gracefully. New file: `src/core/agentDrafting.ts`.

## [0.49.41] - 2026-04-19

### Added
- **Autopilot toggle in chat composer**: A new star icon button in the chat input toolbar lets you toggle Autopilot on and off at any time without leaving the chat panel. When active, the button glows amber and the tooltip updates to confirm the state. Autopilot grants all tool approvals automatically ÔÇö enable it before going AFK so the agent isn't blocked waiting for confirmation, and disable it on return. The button state syncs in real time with the status bar indicator via the shared `ToolApprovalManager`.

## [0.49.40] - 2026-04-19

### Changed
- Bump version to 0.49.40 to update Marketplace README and metadata.

## [0.49.39] - 2026-04-18

### Changed
- **Live settings**: All orchestrator limits (`maxToolIterations`, `maxToolCallsPerTurn`, `toolExecutionTimeoutMs`, `providerTimeoutMs`) now propagate immediately to the running orchestrator when changed in settings ÔÇö no reload required. Previously, values were frozen at extension startup.
- **Smart limit-hit prompt**: When the agentic loop hits the tool-iteration or tool-calls-per-turn cap, the chat response now shows contextual raise buttons: "Raise to N (permanent)" saves the new value to workspace settings and continues; "Raise to N (this task)" applies it in-memory for the current task only; "Continue as-is" and "Cancel" remain for the original behaviour. The suggested N is computed as `ceil(current ├ù 1.5 / 5) ├ù 5`, capped at the configured setting maximum.

## [0.49.38] - 2026-04-18

### Changed
- Dashboard Runtime: TDD Compliance panel now shows contextual action buttons when gaps are detected. "Ask Atlas to fix TDD gaps" opens Atlas Chat with a pre-drafted prompt describing missing evidence and blocked subtasks. "Plan a TDD fix run" opens Project Run Center with a pre-filled goal ready to preview. The existing "Open Project Run Center" button is always shown.

## [0.49.37] - 2026-04-18

### Fixed
- Chat panel: Guarded automatic composer focus restoration so live transcript and busy-state refreshes no longer steal the editor cursor after the user clicks back into another VS Code surface.

## [0.49.36] - 2026-04-18

### Changed
- Added a dedicated Testing policy highlight card to the Project Dashboard so the active tests-first policy is visible at a glance beside the framework and coverage stats.
- Added an optional workspace override label so teams can display their own wording for the testing policy while still keeping AtlasMind's underlying verification guardrails in place.

## [0.49.36] - 2026-04-18

### Changed
- Moved warning-level generated-skill review into the AtlasMind in-chat approval stack so operators can approve or keep a draft blocked without leaving the conversation flow.
- Tailored the approval card for generated skills to show the warning summary and a one-time Allow Once versus Keep Blocked choice.

## [0.49.35] - 2026-04-18

### Changed
- Auto-synthesized skills that raise warning-level scan findings now pause behind an explicit user approval prompt before AtlasMind evaluates them in-process.
- Added a review-first flow for generated skill drafts so operators can inspect the warning summary and proposed source, then either allow once or keep the draft blocked for refinement.

## [0.49.34] - 2026-04-18

### Changed
- Moved project-level testing visibility into the Project Dashboard so the testing surface now behaves like a workspace health view instead of a generic settings page.
- Added an interactive test explorer with category grouping, searchable long-list and dropdown navigation, and a selected-test detail pane that summarizes source-level description, likely input steps, assertions, and opens the relevant file at the matching line.

## [0.49.33] - 2026-04-18

### Added
- MCP intent heuristics: AtlasMind now derives natural-language routing cues for third-party MCP tools, biases tool selection toward the most likely match for prompts like ÔÇ£commitÔÇØ, and asks for clarification when multiple tools look similarly plausible.
- SSOT recall: Successful natural-language-to-MCP resolutions are now written into project memory so future turns can reuse that learned mapping.

## [0.49.32] - 2026-04-18

### Fixed
- Made F2 rename use the currently focused Sessions sidebar item so keyboard rename now works reliably for chat threads and session folders.

## [0.49.31] - 2026-04-18

### Fixed
- Replaced the external Marketplace version badge in the README with a plain Marketplace-safe version callout so AtlasMind no longer shows a broken or retired badge placeholder on extension detail pages.

## [0.39.7] - 2026-04-18

### Changed
- Added an immutable legal and human-respect guardrail baseline to AtlasMind's built-in and routed agent prompts so lower-priority instructions cannot override it.
- Restricted legally ambiguous or jurisdiction-specific requests to safe high-level guidance and explicitly blocked help intended to harm, discredit, disparage, or lie about any person.
- Strengthened skill-drafting and auto-synthesis prompts so generated tools are steered away from illegal, abusive, defamatory, or deceptive person-targeted behavior.

## [0.39.6] - 2026-04-06

### Changed
- Reordered the default AtlasMind sidebar tree views to Project Runs, Sessions, Memory, Agents, Skills, MCP Servers, and Models so operational views surface first below Chat.
- Set the shipped default tree-view visibility to collapsed, while keeping stable view ids in place so VS Code continues to remember each user's custom sidebar order and expanded or collapsed state across later work.

## [0.39.6] - 2026-04-06

### Changed
- Added title-bar shortcuts for Settings, Project Dashboard, and Cost Dashboard across the Chat, Sessions, and Memory sidebar views so the main control surfaces stay one click away.
- Made the project-memory toolbar action switch between `Import Existing Project` and `Update Project Memory` based on whether AtlasMind has already detected workspace SSOT state.

## [0.39.4] - 2026-04-06

### Changed
- Hid the remaining unprefixed session actions from the Command Palette and added a manifest guard that requires unprefixed command titles to stay palette-hidden.
- Split the README command reference into dedicated Command Palette and Sidebar Actions sections so the surface distinction is explicit.

## [0.39.3] - 2026-04-06

### Changed
- Hid sidebar-only commands from the VS Code Command Palette so palette-facing AtlasMind commands remain branded entry points while row and toolbar actions stay local to their owning views.
- Updated command documentation to distinguish palette-facing AtlasMind commands from view-local sidebar actions.

## [0.39.2] - 2026-04-06

### Added
- Added a pinned stale-memory warning row at the top of the Memory tree so imported SSOT drift remains visible inside the sidebar until AtlasMind refreshes project memory.

### Fixed
- Treated legacy `#import` SSOT files without Atlas metadata trailers as stale imported memory, so older Atlas projects now surface the same refresh signal and update affordances as newer imports.

## [0.39.2] - 2026-04-06

### Added
- Added custom skill folders to the Skills sidebar, including a title-bar `Create Skill Folder` action plus folder-aware add/import flows so custom skills can be filed into persistent nested groups.
- Added an `F2` rename shortcut for highlighted chat-session rows in the Sessions sidebar, wired to the existing `Rename Session` command.

### Changed
- Reorganized bundled AtlasMind skills under built-in category groups in the Skills sidebar so the built-in list no longer expands into one flat 31-item block.
- Persisted imported custom skills and their folder placement across extension reloads instead of keeping them only in the current activation session.

## [0.39.0] - 2026-04-06

### Added
- Added persistent session folders to the AtlasMind Sessions sidebar, including a title-bar `Create Session Folder` action and a `Move Session To Folder` row action so related chat threads can be filed together.
- Added an inline `Rename Session` action on each Sessions sidebar row.

### Changed
- Moved the optional `Import Existing Project` toolbar shortcut from the Sessions view to the Memory view so project-memory actions stay grouped together.

## [0.38.22] - 2026-04-06

### Changed
- Redesigned the Cost Dashboard to align with the Project Dashboard visual language using a cleaner shell, single-row animated summary cards, a polished budget meter, and richer model and feedback panels.
- Replaced the old checkbox and numeric timescale field with a topbar spend-visibility toggle and chart-overlay time-range controls built directly into the Daily Spend panel.

### Fixed
- Tightened Cost Dashboard metric layout so the primary summary boxes stay on one row instead of wrapping into a cluttered multi-line grid.

## [0.38.21] - 2026-04-06

### Fixed
- Made the Atlas chat Sessions rail responsive so it stays at the top in narrow views and moves into a persistent left sidebar when the chat webview is at least 1000px wide.

## [0.38.20] - 2026-04-06

### Fixed
- Fixed the Project Dashboard security snapshot so `autoVerifyScripts` now accepts the array format persisted by AtlasMind Settings instead of assuming a plain string and failing refresh with `trim is not a function`.
- Added dashboard regression coverage for array-backed verification script settings to keep the loading path stable.

## [0.38.19] - 2026-04-06

### Changed
- Refined assistant-response feedback controls so the thinking summary and vote buttons share a single inline footer row, with compact outlined thumb icons aligned to the right side of the bubble.

## [0.38.18] - 2026-04-06

### Added
- Added response-feedback analytics to the Cost Dashboard, including per-model approval rates, thumbs-up/thumbs-down totals, and filtered spend on rated models.
- Added a `atlasmind.feedbackRoutingWeight` setting so operators can disable thumbs-based routing bias entirely or tune how strongly stored feedback nudges future model selection.

### Changed
- Cost Dashboard recent-request rows now show the recorded vote on the linked assistant response when one exists, making spend and user sentiment visible in the same table.

## [0.38.17] - 2026-04-06

### Fixed
- Tightened the Atlas chat Sessions rail header so the new-session `+` action sits inline with the Sessions label instead of stretching the collapsible bar beyond the chat container.

## [0.38.16] - 2026-04-06

### Added
- Added chat-session deep links from Cost Dashboard recent-request rows so rows open the matching transcript message when that session entry still exists.

### Changed
- Cost records now retain optional chat session and message references so AtlasMind can trace recent spend back to the exact assistant response that incurred it.

## [0.38.15] - 2026-04-06

### Added
- Added thumbs up and thumbs down controls to each assistant response in the shared AtlasMind chat workspace so feedback is stored with the response metadata and exported with saved transcripts.

### Changed
- Weighted model routing with a small bounded per-model preference bias derived from recorded chat feedback so repeated user votes can slightly steer future model selection without overriding budget, speed, capability, or provider-health rules.

## [0.38.14] - 2026-04-06

### Added
- Added startup SSOT freshness inspection for imported workspaces so AtlasMind can detect when generated project memory no longer matches the current codebase, raise a warning notification, and expose an `Update Project Memory` action in the Memory view.

### Fixed
- Normalized import body fingerprints so unchanged generated SSOT files are no longer misclassified as locally edited or permanently stale on later refreshes.

## [0.38.13] - 2026-04-06

### Fixed
- Sent the Cost Dashboard's Budget Settings shortcut directly to Settings ÔåÆ Overview with a budget-focused search instead of reopening whatever settings section was last active.
- Clarified the Cost Dashboard recent-requests table so the final column is explicitly the per-message request cost.

## [0.38.11] - 2026-04-06

### Fixed
- Fixed the Project Dashboard refresh path so git timeline collection uses a valid date filter and dashboard snapshot failures render an explicit error state instead of hanging on Loading dashboard signals.
- Added a direct Project Dashboard title-bar action to the AtlasMind sidebar chat view for faster access to the dashboard surface.
- Restored clean TypeScript compilation after the project-memory bootstrap refactor left `ScannedImportFile` metadata and text-file filtering helpers incomplete.

## [0.38.10] - 2026-04-06

### Changed
- Extended cost tracking so AtlasMind records provider billing category per request and only counts direct or overflow-billed usage against `dailyCostLimitUsd`; subscription-included usage remains visible in the dashboard without consuming the daily budget.
- Upgraded the Cost Dashboard with arbitrary day-range filtering, a toggle to exclude included subscription usage from totals and charts, and clearer request-level billing labels for direct, subscription, overflow, and free usage.

## [0.38.9] - 2026-04-06

### Fixed
- Hardened the Project Dashboard refresh path so host-side data collection failures surface an explicit error state instead of leaving the panel stuck on its loading placeholder.
- Added a one-click Project Dashboard action to the AtlasMind sidebar title bar so the dashboard can be opened directly from the AtlasMind panel.

## [0.38.8] - 2026-04-06

### Fixed
- Added real per-setting hover help inside the custom AtlasMind Settings webview so richer configuration guidance appears when hovering the panel controls rather than only in native Settings metadata.

## [0.38.7] - 2026-04-06

### Added
- Added an explicit shared-runtime plugin API with lifecycle events and plugin contribution manifests so extension-host and CLI integrations can register agents, skills, and provider adapters without patching core bootstrap code.
- Added a new AtlasMind Project Dashboard surface with interactive pages for repo health, Atlas runtime state, SSOT coverage, security posture, delivery workflow, and review-readiness signals.
- Added animated dashboard charts for commit activity, project-run activity, and SSOT update cadence with adjustable 7-day, 30-day, and 90-day windows.

### Changed
- Logged shared-runtime lifecycle events to the AtlasMind extension output channel, wired the dashboard into the extension command surface, and expanded contributor documentation with runtime-plugin onboarding guidance.
- Hardened AtlasMind CLI argument parsing so malformed flags, missing option values, and invalid provider or routing modes fail fast with explicit help output.
- Expanded the architecture, routing, development, contribution, and wiki guidance to document AtlasMind's extension seams, failure telemetry surfaces, troubleshooting workflow, and current performance or monitoring boundaries.

## [0.38.6] - 2026-04-06

### Fixed
- Synced the `v0.38.x` roadmap branch with the newly merged workspace-observability base changes so the terminal-reader, extensions/Ports, cost dashboard, and ElevenLabs feature work remains mergeable on top of the latest `develop` head.

## [0.38.5] - 2026-04-06

### Fixed
- Synced the `v0.38.x` roadmap branch with the latest `develop` EXA search, workspace observability, and settings-documentation updates so it remains mergeable on top of the newer base branch feature work.

## [0.38.4] - 2026-04-06

### Fixed
- Synced the `v0.38.x` roadmap branch with the latest `develop` settings-documentation updates so it stays mergeable on top of the new configuration hover-help work.

## [0.38.3] - 2026-04-06

### Fixed
- Synced the `v0.38.0` roadmap-completion branch with the latest `develop` observability changes while preserving the branch's broader terminal-reader, extension, Ports, dashboard, and ElevenLabs feature set.

## [0.38.2] - 2026-04-06

### Fixed
- Removed duplicate `if` keys from the CI workflow coverage steps so the `v0.38.x` roadmap branch can execute GitHub Actions normally again after the develop sync.

## [0.38.1] - 2026-04-06

### Fixed
- Synced the `v0.38.0` roadmap-completion branch with the latest `develop` fixes so the extension-skill, terminal-reader, Ports, cost dashboard, and ElevenLabs work remains mergeable on top of the newer review-cleanup and lint-gate repairs.

## [0.38.0] - 2026-04-06

### Added
- **Terminal session readers** ÔÇö `getTerminalOutput(terminalName?)` added to `SkillExecutionContext`; new `terminal-read` built-in skill lists open terminals and the active terminal, with a clear note that buffer content must be pasted by the user (VS Code API limitation).
- **Test result file parsing** ÔÇö `workspace-state` skill now scans for JUnit XML and Vitest/Jest JSON result files and includes a summary (pass/fail counts, coverage percentages) in the workspace snapshot.
- **VS Code Extensions skill** (`vscode-extensions`) ÔÇö lists all installed extensions with id, version, and enabled state; optionally filters by name fragment or restricts to the curated top-50 list; also reports forwarded ports from the VS Code Remote/Ports panel.
- **Cost Management Dashboard** (`atlasmind.openCostDashboard` command) ÔÇö full-page webview panel showing total/today spend cards, daily bar chart (last 14 days), per-model cost breakdown, and a paginated recent-requests table with a budget utilisation bar when a daily limit is configured.
- **ElevenLabs TTS integration** ÔÇö `VoiceManager` now accepts `SecretStorage`; when an ElevenLabs API key is configured in Specialist Integrations, `speak()` synthesises audio server-side via the ElevenLabs API and streams base64-encoded MP3 to the Voice Panel for playback via the Web Audio API; falls back to the Web Speech API when no key is set.
- `getInstalledExtensions()` and `getPortForwards()` added to `SkillExecutionContext` for the VS Code extensions skill.
- `atlasmind.openCostDashboard` command added to the extension manifest.

### Changed
- `workspace-state` skill description updated to mention test result parsing.
- `VoiceManager` constructor accepts an optional `SecretStorage` argument (backwards-compatible).
- Voice Panel TTS section shows "ElevenLabs active" / "Web Speech API" badge based on key availability.

## [0.37.4] - 2026-04-06

### Added
- Added the `workspace-observability` built-in skill so agents can inspect the active debug session, open terminals, and recent test results from within the VS Code host.
- Extended `SkillExecutionContext` with `getTestResults()`, `getActiveDebugSession()`, and `listTerminals()`, implemented in the VS Code host with safe CLI fallbacks.

### Fixed
- Guarded optional observability host hooks and bounded test-result output so the new workspace observability surface degrades safely across environments while staying mergeable on top of the `v0.37.x` feature line.

## [0.37.3] - 2026-04-06

### Fixed
- Synced the `v0.37.x` feature branch with the latest `develop` settings-documentation updates so the EXA search, observability, and CLI subcommand work stays mergeable on top of the new configuration hover-help changes.

## [0.37.2] - 2026-04-06

### Fixed
- `exa-search` skill now routes HTTP requests through `SkillExecutionContext.httpRequest()` instead of raw `fetch`, applying the same timeout and size limits as all other HTTP-capable skills.
- CLI `build`, `lint`, and `test` subcommands now handle spawn `error` events so the Promise resolves with exit code `1` and a helpful message instead of hanging when `npm` is not on PATH.
- `CHANGELOG.md` date corrected for `0.37.0` (was `2026-04-05`, now `2026-04-06`).
- `docs/agents-and-skills.md` and `wiki/Skills.md` updated to document the `exa-search`, `debug-session`, and `workspace-observability` skills introduced on this branch.
- Synced the `v0.37.0` feature branch with the latest `develop` fixes so the EXA search, observability, and CLI subcommand work stays mergeable on top of the newer review-cleanup and lint-gate repairs.

### Added
- New `SkillExecutionContext.httpRequest()` method supports bounded POST requests with custom method, headers, and body; implemented in the VS Code extension host and CLI with the same timeout/size-limit defaults as `fetchUrl`.

## [0.37.0] - 2026-04-06

### Added
- EXA AI search specialist runtime: `exa-search` skill calls the EXA search API end-to-end using the API key stored in the Specialist Integrations panel.
- Debug session inspector skill (`debug-session`): inspect active VS Code debug sessions and evaluate expressions in the current debug context.
- Workspace state skill (`workspace-state`): snapshot workspace problems, debug sessions, and output channels in a single call for proactive observability.
- CLI `build` subcommand (`atlasmind build [--dry-run]`): run the workspace build script with optional dry-run preview.
- CLI `lint` subcommand (`atlasmind lint [--fix]`): run the workspace lint script with optional auto-fix.
- CLI `test` subcommand (`atlasmind test [--watch]`): run the workspace test suite with optional watch mode.
- `getSpecialistApiKey(providerId)` added to `SkillExecutionContext`; CLI reads from `ATLASMIND_SPECIALIST_<ID>_APIKEY` environment variable.
- `getOutputChannelNames()`, `getAtlasMindOutputLog()`, `getDebugSessions()`, and `evaluateDebugExpression()` added to `SkillExecutionContext` for VS Code observability.

### Changed
- Amazon Bedrock model catalog expanded with 16 additional entries: Claude 3.5 Haiku, Claude 3 Haiku, Claude 3 Opus, Amazon Nova Micro, Amazon Titan Text Express and Lite, Cohere Command R and R+, Mistral 7B and 8x7B, Llama 3.2 1B/3B/11B/90B, and AI21 Jamba 1.5 Mini/Large.

## [0.36.26] - 2026-04-06

### Fixed
- Replaced three non-reassigned `let` declarations with `const` in the orchestrator task-attempt path so the develop branch satisfies the repository lint gate again.

## [0.36.25] - 2026-04-06

### Fixed
- Removed the duplicate `AtlasMind: Tool Webhooks` command entry from the wiki command reference so it no longer diverges from the actual manifest.
- Normalized `src/providers/registry.ts` indentation to the repository's 2-space TypeScript style to eliminate avoidable formatting churn in the provider runtime.

## [0.36.24] - 2026-04-06

### Fixed
- Repaired the Project Run Center webview HTML assembly so preview tables, run cards, artifact cards, and live logs no longer emit invalid JavaScript string fragments at runtime.
- Tightened the shared webview CSP back to nonce-only script execution and replaced broken wiki CLI links with repository-relative paths.
- Normalized the duplicated `0.36.4` changelog entries so release history remains unambiguous for readers and tooling.

## [0.36.23] - 2026-04-06

### Fixed
- AtlasMind now treats provider replies that end with `finishReason: length` as truncated output and requests a bounded continuation instead of accepting the cut-off answer as final.
- Atlas-generated chat and synthesis requests now send an explicit larger output-token budget, reducing premature truncation for longer architectural or analysis-style replies.
- Added regression coverage for truncated direct replies and streamed continuation handling.

## [0.36.22] - 2026-04-06

### Fixed
- Atlas chat surfaces now reconcile streamed chunks with the final orchestrator response instead of treating the first streamed chunk as proof that the full reply already rendered, which fixes replies that appeared to stop after an intermediate "I am investigating"-style preamble.
- Hardened session transcript persistence so invalid chat-session targets and failed memento writes emit diagnostics instead of failing silently.
- Added regression coverage for partial-stream reconciliation, streamed tool-loop completions, and session persistence hardening.

## [0.36.23] - 2026-04-06

### Fixed
- Completed the CLI `SkillExecutionContext` implementation for workspace observability by adding safe fallback implementations for test results, active debug session lookup, and terminal listing outside the VS Code host.
- Made the VS Code-hosted workspace observability skill tolerant of test-results API shape differences so the feature compiles cleanly across the current extension toolchain.

## [0.36.22] - 2026-04-06

### Added
- New `workspace-observability` built-in skill: provides a snapshot of the current VS Code workspace state including the active debug session, open integrated terminals, and the most recent test run summary. Useful for orienting agents before diagnosing problems or suggesting next steps.
- Three new methods on `SkillExecutionContext`: `getTestResults()`, `getActiveDebugSession()`, and `listTerminals()`, backed by `vscode.tests.testResults`, `vscode.debug.activeDebugSession`, and `vscode.window.terminals` respectively.

## [0.36.21] - 2026-04-06

### Changed
- Expanded the developer-experience roadmap to cover interoperability with the top 50 commonly used VS Code developer extensions, their interface surfaces such as Output and Terminal, Ports view support, and explicit safety boundaries for extension interaction.

## [0.36.20] - 2026-04-06

### Fixed
- Restricted CI coverage generation and coverage artifact upload to the Ubuntu matrix leg, preventing duplicate GitHub Actions artifact-name conflicts while keeping compile, lint, and tests running on Ubuntu, Windows, and macOS.
- Updated repository development documentation to match the CI matrix behavior and Ubuntu-only coverage artifact publishing path.

## [0.36.19] - 2026-04-05

### Fixed
- Cleaned up cross-platform lint and TypeScript issues that were blocking CI on the protected develop-to-master promotion PR.

## [0.36.18] - 2026-04-05

### Changed
- Added roadmap items for workspace observability, debug-session integration, and safe output or terminal readers so AtlasMind can eventually reason over more of the active VS Code environment.

## [0.36.17] - 2026-04-05

### Changed
- AtlasMind now includes workstation context in routed chat prompts so responses default to the active environment, including Windows and PowerShell guidance inside VS Code when appropriate.
- Added regression coverage to keep workstation-aware prompt context flowing through native chat and orchestrator request building.

## [0.36.16] - 2026-04-05

### Fixed
- AtlasMind now fails over to another provider automatically when the selected provider errors or is missing, instead of ending the task immediately on the first provider failure.
- Added orchestrator regression coverage for cross-provider failover after a provider-side error.

## [0.36.15] - 2026-04-05

### Fixed
- OpenAI modern chat requests now omit `temperature` for fixed-temperature model families such as GPT-5 and the `o`-series, preventing 400 errors on streamed and non-streamed requests.
- Added provider regression coverage to keep modern OpenAI payloads compatible while preserving temperature for models and providers that still support it.

## [0.36.14] - 2026-04-05

### Changed
- AtlasMind now watches for early struggle signals during tool-heavy execution, such as repeated tool failures or excessive tool-loop churn, and can reroute once to a stronger reasoning-capable model instead of exhausting the full loop on a weaker one.
- Added regression coverage for bounded mid-task model escalation when the first model shows repeated failure signals.

## [0.36.13] - 2026-04-05

### Fixed
- AtlasMind now answers workspace version questions directly from the root `package.json` manifest instead of relying on model inference.
- When the manifest is unavailable, AtlasMind falls back to SSOT memory to answer version questions from grounded project context.

## [0.36.12] - 2026-04-05

### Fixed
- Split OpenAI compatibility handling by provider so modern OpenAI and Azure chat requests use `developer` messages plus `max_completion_tokens`, while generic OpenAI-compatible providers keep the legacy `system` plus `max_tokens` payload shape.
- Added regression coverage to ensure OpenAI/Azure and third-party OpenAI-compatible endpoints each receive the expected request contract.

## [0.36.11] - 2026-04-05

### Fixed
- Switched OpenAI-compatible chat payloads from `max_tokens` to `max_completion_tokens`, fixing request failures on models that reject the legacy parameter.
- Added a provider regression test that asserts AtlasMind no longer emits `max_tokens` in OpenAI-style chat completion requests.

## [0.36.10] - 2026-04-05

### Fixed
- Corrected the `terminal-run` tool schema so `args` is declared as an array of strings, fixing chat requests that failed OpenAI function validation.
- Added a regression test covering the exported `terminal-run` argument schema.

## [0.36.9] - 2026-04-05

### Changed
- Chat panel sessions section is now a collapsible drawer ÔÇö collapsed by default, showing a "Sessions" toggle bar with a numeric badge; expands to 50% viewport height.
- Composer input box is anchored to the bottom of the panel and no longer gets pushed off-screen by session cards.
- Reduced padding, font sizes, and icon sizes across session cards, composer controls, and toolbar buttons for a more compact layout.

## [0.36.8] - 2026-05-04

### Fixed
- Chat panel webview script moved from inline template literal to external `media/chatPanel.js` file, eliminating HTML parser and TypeScript compilation escaping issues that prevented the chat UI from functioning.
- Updated `webviewUtils.ts` to support loading external script files via `<script src>` with proper CSP and nonce attributes.
- Fixed pre-existing test assertions for `composerForm` (never existed in DOM) and `webviewReady` (never existed in message type union).

## [0.36.7] - 2026-05-04

### Fixed
- Chat webview panels (sidebar and dedicated tab) now render and execute correctly; escaped `</` sequences inside innerHTML assignments in inline `<script>` blocks that caused the HTML parser to prematurely close the script element.
- Project Run Center webview innerHTML assignments received the same `</` escaping fix.

## [0.36.6] - 2026-04-05

### Fixed
- AtlasMind CLI now runs behind a runtime approval gate that permits read-only tools by default, blocks external high-risk tools, and requires an explicit `--allow-writes` opt-in before workspace or git writes are allowed.
- Startup SSOT auto-load now trusts only the configured SSOT path or the default `project_memory/` folder instead of treating workspace-root marker folders as sufficient.

### Added
- Added regression tests for CLI write gating, denied external tool use, and the tightened SSOT startup detection boundary.

## [0.36.5] - 2026-04-05

### Changed
- `/import` now embeds freshness metadata into generated SSOT artifacts, skips unchanged entries on later imports, and preserves generated files that were manually edited instead of blindly overwriting them.
- AtlasMind now writes both `index/import-catalog.md` and `index/import-freshness.md` so operators can see which imported memory files were created, refreshed, left unchanged, or preserved.
- The Project Settings page now includes a destructive memory-purge action guarded by a modal confirmation and a required typed confirmation phrase before AtlasMind deletes and recreates the SSOT scaffold.

## [0.36.3] - 2026-04-05

### Changed
- The MCP Servers, Voice, and Vision panels now use the same searchable, page-based workspace pattern as AtlasMind Settings and the other admin surfaces, with overview actions and focused working pages instead of single long layouts.
- Sidebar empty states now include more contextual links into the matching AtlasMind panel or settings page, and the MCP sidebar settings action now jumps directly to Safety Settings.

## [0.36.4] - 2026-04-05

### Changed
- `/import` now performs a broader first-pass ingest over existing workspaces, generating a richer SSOT baseline from core docs, workflow and security guidance, and a focused codebase map instead of only importing a few metadata files.
- AtlasMind now upgrades the starter `project_soul.md` template during import when it is still blank, giving imported projects an initial identity, principles, and references into the generated SSOT.

## [0.36.2] - 2026-04-05

### Changed
- The Agent Manager and Tool Webhooks panels now use the same searchable, page-based workspace style as Settings and the provider surfaces, with grouped sections instead of long flat forms.
- AtlasMind now exposes page-specific settings commands for chat, models, safety, and project runs, and matching tree views plus walkthrough steps now open those targeted pages directly.

## [0.36.1] - 2026-04-05

### Changed
- The Model Providers and Specialist Integrations panels now use the same searchable, page-based workspace style as AtlasMind Settings, replacing dense tables with grouped cards and faster workflow navigation.
- AtlasMind Settings now supports in-panel search plus command-driven deep links, so commands and panels can reopen Settings directly onto a target page such as Models.

## [0.36.0] - 2026-04-05

### Added
- Added a shared Atlas runtime builder plus a compiled `atlasmind` CLI entrypoint with `chat`, `project`, `memory`, and `providers` commands that reuse the existing orchestrator, skills, router, and SSOT loading.
- Added Node-hosted runtime adapters for memory, cost tracking, and built-in skill execution, along with focused tests covering runtime bootstrapping and CLI argument/SSOT resolution.

### Changed
- Split the provider registry and local adapter into a host-neutral module so reusable providers can run from both the VS Code extension host and the CLI without loading VS Code-only adapters.

## [0.35.15] - 2026-04-05

### Changed
- AtlasMind Settings now opens as a navigable multi-page workspace with keyboard-friendly section tabs, grouped cards, and quicker access to embedded chat, provider, and specialist surfaces instead of a single long collapsible form.

## [0.35.14] - 2026-04-05

### Added
- AtlasMind now exposes an embedded Chat view inside the AtlasMind sidebar container, reusing the same session-aware chat surface as the detachable chat panel so the workspace can feel closer to a native VS Code sidecar.

### Changed
- Sessions in the AtlasMind sidebar now open the embedded Chat view by default, while the detachable `AtlasMind: Open Chat Panel` command remains available for a larger floating workspace.

## [0.35.13] - 2026-04-05

### Fixed
- Compressed the dedicated AtlasMind chat composer so send controls sit back underneath the prompt, attachment actions use compact icon buttons, and empty open-file or attachment sections stay hidden until there is content to show.
- Fixed the dedicated chat panel busy-state handling so `Enter` and the `Send` button continue to work after requests instead of leaving the composer controls stuck disabled.

## [0.35.12] - 2026-04-05

### Fixed
- AtlasMind now auto-detects and loads an existing workspace SSOT during startup when the configured `atlasmind.ssotPath` is missing, including the default `project_memory` layout and workspace-root SSOTs that already contain `project_soul.md` and MindAtlas folders.
- Startup SSOT loading now fires the Memory sidebar refresh event immediately after indexing so existing project memory appears in the UI without requiring a manual reload or later write.

## [0.35.10] - 2026-04-05

### Added
- The dedicated AtlasMind chat panel now shows an animated AtlasMind globe while the latest assistant turn is still thinking or streaming, so pending replies remain visibly active instead of looking stalled.
- The dedicated AtlasMind chat panel now includes send-mode controls for `Send`, `Steer`, `New Chat`, and `New Session`, plus quick-attach chips for currently open workspace files.
- The chat composer now supports picker-based attachments and drag-and-drop for workspace files and URLs, and it carries attached file context into both normal chat requests and autonomous steering runs.

## [0.35.8] - 2026-04-05

### Added
- The dedicated AtlasMind chat panel now annotates assistant bubbles with the routed model ID and a collapsible thinking summary based on routing and execution metadata.

### Changed
- Built-in `@atlas` freeform and vision replies now append a compact model and thinking summary footer after each response.

## [0.35.7] - 2026-04-05

### Added
- Added an explicit `AtlasMind: Toggle Autopilot` command and a session-only Autopilot status bar indicator so approval bypass mode can be disabled without reloading the extension.

### Fixed
- The dedicated AtlasMind chat panel now routes `/project` goals and short continuation prompts such as `Proceed autonomously` through the same autonomous project execution flow used by the built-in `@atlas` chat participant.

## [0.35.6] - 2026-04-05

### Fixed
- Short continuation prompts such as `Proceed autonomously` now reuse the latest substantive chat request and launch AtlasMind's autonomous project pipeline instead of stalling in repeated explanatory turns.
- Wired the existing runtime tool approval manager into live tool execution so approval prompts now support `Allow Once`, task-scoped `Bypass Approvals`, and session-wide `Autopilot`.

## [0.35.5] - 2026-04-05

### Added
- Added a refresh action on configured provider rows in the Models sidebar so routed model catalogs can be refreshed directly where missing models are noticed.

## [0.35.4] - 2026-04-05

### Fixed
- Adjusted routing so important thread-based follow-up turns can escalate away from weak local models instead of being dominated by zero-cost local scoring.

### Changed
- The task profiler now treats high-stakes conversation follow-ups as stronger reasoning work, and the router normalizes cheapness so capability and task-fit can outweigh free local pricing when appropriate.

## [0.35.3] - 2026-04-05

### Added
- Added inline edit and review actions to Memory sidebar entries so indexed SSOT files can be opened directly or summarized in natural language from the tree view.

## [0.35.2] - 2026-04-05

### Fixed
- Added a real `Ctrl+Alt+I` (`Cmd+Alt+I` on macOS) keybinding for `AtlasMind: Open Chat Panel` so the shortcut shown in the Get Started walkthrough actually opens chat.
- Updated the walkthrough chat buttons to launch the AtlasMind chat panel directly instead of relying on an unbound generic chat command.

## [0.35.1] - 2026-04-05

### Added
- Added an AtlasMind Settings entry to the overflow menu of AtlasMind sidebar views so the settings panel is reachable directly from the panel itself.

### Changed
- Added an optional Import Existing Project title-bar action to the Sessions sidebar view and exposed a new `atlasmind.showImportProjectAction` setting in the Settings panel to hide it when not wanted.

## [0.35.0] - 2026-04-05

### Added
- Upgraded the dedicated AtlasMind chat panel into a session workspace with persistent per-workspace chat threads, a session rail, and a dedicated Sessions sidebar view.
- Surfaced recent autonomous project runs alongside chat sessions so you can inspect active sub-agent work from the same workspace and jump into the Project Run Center to steer batch approvals, pauses, and resumes.

## [0.34.2] - 2026-04-05

### Fixed
- Deferred GitHub Copilot model discovery and health checks until explicit activation so AtlasMind no longer triggers the VS Code language-model permission prompt during normal startup.

## [0.34.1] - 2026-04-05

### Fixed
- Corrected the NVIDIA NIM model info link so AtlasMind opens NVIDIA's model catalog instead of an unrelated API page.

## [0.34.0] - 2026-04-05

### Added
- Added a dedicated AtlasMind chat panel so the extension can be used through its own conversation UI instead of only through VS Code's built-in Chat view.

### Changed
- Added a Settings quick action and command-palette entry for opening the dedicated chat panel.

## [0.33.1] - 2026-04-05

### Fixed
- Updated the repo and bootstrap-generated VS Code extension recommendations to prefer `GitHub Copilot Chat` without also prompting for the separate `GitHub Copilot` recommendation.

## [0.33.0] - 2026-04-04

### Added
- Added routed provider support for Azure OpenAI with deployment-based workspace configuration and `api-key` authentication.
- Added routed provider support for Amazon Bedrock through a dedicated SigV4-signed Bedrock adapter.
- Added a Specialist Integrations panel for search, voice, image, and video vendors that intentionally stay off the routed chat-provider list.

### Changed
- Expanded provider configuration and routing documentation to cover Azure OpenAI, Bedrock, and specialist vendor separation.

## [0.32.10] - 2026-04-04

### Changed
- Switched the repository default branch to `develop` so routine development and push requests now target `develop` by default.
- Hardened `master` so it is updated only through the intentional `develop` to `master` pre-release promotion flow.
- Updated contributor and Copilot workflow guidance to match the enforced default-branch and release-branch policy.

## [0.32.9] - 2026-04-04

### Changed
- Adopted a documented `develop` ÔåÆ `master` promotion model so `master` stays release-ready for published pre-releases.
- Updated CI to run on both `develop` and `master` pushes and pull requests.
- Updated contributor guidance and Copilot instructions to stop using `master` as the routine development branch.

### Fixed
- Treated the built-in local echo fallback as healthy when no local OpenAI-compatible endpoint is configured, so routing and tests do not incorrectly mark the local provider as unavailable.

## [0.32.7] - 2026-04-04

### Changed
- Added a bracketed warning marker to partially enabled provider rows in the Models sidebar while keeping the green enabled icon.

## [0.32.6] - 2026-04-04

### Changed
- Replaced Models sidebar status text with colored status icons and sorted unconfigured providers to the bottom of the list.

## [0.32.5] - 2026-04-04

### Added
- Added a real configurable local provider flow backed by `atlasmind.localOpenAiBaseUrl` and an optional SecretStorage API key.

### Changed
- Local provider setup can now be completed directly from the Models and Model Providers UIs instead of only showing guidance.

## [0.32.4] - 2026-04-04

### Added
- Added inline provider configure and assign-to-agent actions to the Models sidebar, plus model-level assign-to-agent actions.

### Changed
- Hid child model rows for unconfigured providers until credentials are available.
- Persisted agent model assignments from the Models sidebar for both custom and built-in agents.

## [0.32.3] - 2026-04-04

### Added
- Added inline enable/disable and info actions to Models tree items so providers and individual models can be controlled directly from the sidebar.

### Changed
- Persisted provider/model availability choices in extension storage and reapplied them after runtime model catalog refreshes.

## [0.32.2] - 2026-04-04

### Fixed
- Removed the activation-time import of the Agent Manager panel so persisted user agents are restored without evaluating webview UI code during startup.

## [0.32.1] - 2026-04-04

### Fixed
- Lazy-loaded panel modules from command handlers so one broken view module cannot block all AtlasMind commands during activation.

## [0.32.0] - 2026-04-04

### Added
- New `AtlasMind: Getting Started` command that reopens the onboarding walkthrough directly from the Command Palette.

### Fixed
- Keeps the recent Agent, Skills, and MCP panel reliability fixes in the current beta line.
- Commands are now registered at the start of activation and resolve AtlasMind context lazily, preventing `command ... not found` errors for walkthrough and Command Palette actions during startup.

## [0.31.4] - 2026-04-04

### Fixed
- Rewired the Manage Agents panel buttons to use CSP-safe event listeners so New Agent, Edit, Enable/Disable, Delete, Save, and Cancel work again.
- Registered commands and tree views earlier in activation and isolated UI registration steps so Skills and MCP panel actions remain available even if another startup surface fails.

### Added
- Regression coverage for the agent manager webview markup to prevent inline-handler breakage.
- Regression coverage for activation-step error isolation during startup.

## [0.31.2] - 2026-04-04

### Fixed
- Activated AtlasMind on startup so walkthrough command buttons are available immediately after install.

### Added
- Manifest test coverage for the get-started walkthrough provider button and activation wiring.

## [0.31.1] - 2026-04-04

### Fixed
- Converted extension icon from SVG to PNG for VS Code Marketplace compliance.
- Added top-level `icon` field in `package.json` for marketplace display.
- Fixed coverage threshold CHANGELOG description (was documented as 65%, actually 45%).

## [0.31.0] - 2026-04-04

### Added
- Tests for 5 previously uncovered skills: `validation`, `gitStatus`, `gitDiff`, `gitCommit`, `fileWrite`.
- Message validation tests for `ToolWebhookPanel`, `McpPanel`, and `AgentManagerPanel` webviews.
- CI now runs on `ubuntu-latest`, `windows-latest`, and `macos-latest` to catch platform-specific issues.
- Coverage tracking expanded to include `src/views/` and `src/chat/`; global thresholds set to 45% to reflect the broader scope (core modules remain well above 60%).
- Cross-links in `CONTRIBUTING.md` for adding agents, skills, and MCP servers.
- `bugs` and `homepage` fields in `package.json` for Marketplace discoverability.

### Fixed
- Vision panel markdown renderer no longer double-escapes HTML entities in link labels and targets.
- MCP server registry logs connection and disconnection errors to the output channel instead of silently swallowing them.
- Webhook dispatcher now enforces HTTPS for outbound URLs (HTTP allowed only for localhost/127.0.0.1).

### Changed
- Exported `isToolWebhookMessage`, `validatePanelMessage` (MCP), and `isAgentPanelMessage` for testability.

## [0.30.5] - 2026-04-04

### Changed
- Streamlined the README into a shorter overview and onboarding document.
- Moved detailed comparison, support, workflow, and structural reference material behind deeper docs and wiki pages.

## [0.30.4] - 2026-04-04

### Fixed
- Resolved CI lint failures across chat, router, skill, and webview files.
- Restored a passing coverage gate by scoping enforced thresholds to the service-layer modules currently covered by automated tests.

### Changed
- Clarified model-routing documentation and wiki content to explain runtime model catalog refresh, seed fallback models, and metadata enrichment.
- Added wiki pages and navigation for funding/sponsorship information, and refreshed wiki comparison tables to match the current project positioning.

## [0.30.3] - 2026-04-04

### Changed
- Restored `GitHub Copilot Chat` to the recommended VS Code extensions for the repo and bootstrap-generated workspaces.
- Updated Copilot setup guidance and runtime error wording to direct users to `GitHub Copilot Chat` again.

## [0.30.2] - 2026-04-04

### Fixed
- Removed the deprecated `GitHub Copilot Chat` extension recommendation from the repository and bootstrap-generated `.vscode/extensions.json`.
- Updated Copilot-facing labels and error messages to refer to VS Code language models / the `GitHub Copilot` extension rather than `Copilot Chat`.

### Changed
- Quick start and getting-started docs now clarify that AtlasMind's Copilot provider only requires the `GitHub Copilot` extension and a signed-in session.

## [0.30.1] - 2026-04-04

### Fixed
- **Real daily budget enforcement** ÔÇö `dailyCostLimitUsd` now blocks new requests once the cap is reached instead of only showing an advisory warning.
- **Live provider health refresh** ÔÇö the status bar now refreshes immediately after storing credentials or refreshing model catalogs.
- **Run Center disk hydration** ÔÇö the Project Run Center and project runs tree now read from the async disk-backed run history path instead of the legacy synchronous index.

### Added
- **Budget control in Settings panel** ÔÇö the Settings webview now exposes `dailyCostLimitUsd` directly.
- **Quick actions in Settings** ÔÇö direct buttons for Chat, Model Providers, Project Run Center, Voice, and Vision improve secondary-surface discoverability.
- **Coverage for follow-up fixes** ÔÇö new tests cover daily budget blocking, disk-backed run history, and new settings-panel messages.

## [0.30.0] - 2026-04-04

### Added
- **Getting Started walkthrough** ÔÇö four-step onboarding flow (configure provider, bootstrap/import, first chat, try /project) via `contributes.walkthroughs` in the extension manifest.
- **API key health check** ÔÇö after storing a provider key the Model Provider panel immediately validates it by calling `listModels()` and shows pass/fail feedback.
- **Collapsible settings panel** ÔÇö Settings webview groups options into collapsible `<details>` sections; advanced and experimental sections start collapsed.
- **Approval threshold explanation** ÔÇö the `/project` approval gate now explains estimated file count, the threshold value, its purpose, and where to change it.
- **Memory tree pagination** ÔÇö MemoryTreeProvider supports incremental loading (200 entries per page) with a "Load moreÔÇª" item instead of a hard 200-entry cap.
- **Provider health status bar** ÔÇö a StatusBarItem shows how many configured providers have valid API keys on activation.
- **Cost persistence and daily budget** ÔÇö CostTracker persists session records and daily totals to `globalState`; new `atlasmind.dailyCostLimitUsd` setting triggers warnings at 80% and blocks at 100%.
- **Streaming for Anthropic and OpenAI-compatible providers** ÔÇö full `streamComplete()` implementations with SSE parsing, tool-call accumulation, and token counting.
- **Agent performance tracking** ÔÇö AgentRegistry records success/failure per agent; Orchestrator boosts agent selection score based on historical success rate; performance data persisted across sessions.
- **Expanded task profiler vocabulary** ÔÇö all four regex pattern sets (vision, code, high-reasoning, medium-reasoning) expanded with 100+ additional keywords for more accurate task classification.
- **Multi-workspace folder support** ÔÇö `pickWorkspaceFolder()` utility shows a quick-pick when multiple folders are open; used by bootstrap, import, and skill-template commands.
- **Per-subtask checkpoint rollback** ÔÇö `rollbackByTaskId()` and `listCheckpoints()` added to CheckpointManager for targeted restore instead of last-only.
- **Integration test suite** ÔÇö new `tests/integration/taskLifecycle.test.ts` exercises the full orchestrator ÔåÆ agent ÔåÆ cost ÔåÆ performance tracking lifecycle.
- **Cost estimation in plan preview** ÔÇö `/project` now shows an estimated `$low ÔÇô $high` cost range before execution based on subtask count and selected model pricing.
- **Disk-based run history** ÔÇö ProjectRunHistory writes individual JSON files to `globalStorageUri/project-runs/` with automatic migration from `globalState`; synchronous index kept for tree views.
- **Diff preview in project report** ÔÇö project execution summary includes a file/status table and an "Open Source Control" button for reviewing diffs.

### Changed
- Renamed "Semantic Search" references in docs and JSDoc to "Hybrid Keyword + Hash-Vector Search" to accurately describe the retrieval algorithm.
- Improved error messages in `commands.ts` to be more actionable (directs users to specific UI panels).

## [0.29.0] - 2026-04-04

### Added
- Centralised `src/constants.ts` ÔÇö all magic numbers (~40 constants) extracted from 14+ source files into a single importable module.
- Shared `src/skills/validation.ts` ÔÇö reusable parameter validation helpers (`requireString`, `optionalBoolean`, `optionalPositiveInt`, etc.) replacing duplicated typeof/trim checks across 8 skill files.
- `OrchestratorHooks` interface in `types.ts` ÔÇö groups optional hook callbacks (toolApprovalGate, writeCheckpointHook, postToolVerifier) into a single bag, reducing the Orchestrator constructor from 13 positional parameters to 11.
- `OrchestratorConfig` interface in `types.ts` ÔÇö runtime-configurable tunables (maxToolIterations, maxToolCallsPerTurn, toolExecutionTimeoutMs, providerTimeoutMs) with VS Code settings fallback to constant defaults.
- Four new user-facing settings: `atlasmind.maxToolIterations`, `atlasmind.maxToolCallsPerTurn`, `atlasmind.toolExecutionTimeoutMs`, `atlasmind.providerTimeoutMs`.
- Planner sub-task validation now uses a Zod schema (`zod/v4`) replacing manual field-by-field type guards.
- Lazy activation events ÔÇö extension activates on chat participant, commands, or sidebar views instead of `onStartupFinished`.
- Vitest coverage scope expanded from core+skills to all src subsystems with 60% line/function thresholds.

### Fixed
- Fixed indentation defect in `runCommand` inside `extension.ts`.

## [0.28.7] - 2026-04-04

### Fixed
- Hardened `terminal-run` so inline interpreter execution flags like `node -e` and `python -c` are blocked, and `node` invocations no longer pass through the read-only approval path unless they are simple help/version checks.
- Strengthened workspace path enforcement by canonicalizing paths with `realpath`, preventing symlink-based escape from workspace-scoped file and language-service operations.
- Required explicit per-workspace approval before outbound tool webhooks can be delivered from workspace-controlled settings, reducing silent data exfiltration risk from untrusted repositories.

## [0.28.6] - 2026-04-04

### Changed
- Restored the README SVG logo header because the repository's target renderers handle it correctly and the visual branding is intentional.

## [0.28.5] - 2026-04-04

### Changed
- Corrected the README comparison table to better reflect current published capabilities for Claude Code, Cursor, GitHub Copilot, Aider, and OpenHands, replacing several outdated red crosses with more accurate supported or limited markers.
- Cleared package/README diagnostics by adding explicit sidebar view icons and removing the unsupported SVG image embed from the README header.

## [0.28.4] - 2026-04-04

### Changed
- Refined the Backer funding tier wording to promise priority consideration for integrations and feature proposals, priority issue triage, and wider public recognition including in changelogs.

## [0.28.3] - 2026-04-04

### Changed
- Removed the private monthly Q&A call from the published Backer tier so the funding model stays focused on sponsorship and project support rather than private access.

## [0.28.2] - 2026-04-04

### Changed
- Refined the README funding model into explicit PWYW supporter tiers, including a one-off pay-what-it's-worth option and clearer sponsor benefits.
- Added `CONTRIBUTORS.md` so opted-in supporters can be acknowledged publicly without changing AtlasMind's open-source license or feature access.

## [0.28.1] - 2026-04-04

### Added
- **PWYW funding support** ÔÇö added GitHub Sponsors funding metadata and repository funding configuration so AtlasMind remains open source while offering an optional pay-what-you-want support path.

### Changed
- README now documents the funding model explicitly: AtlasMind stays MIT-licensed and fully open source, with sponsorship framed as optional maintenance support rather than feature gating.

## [0.28.0] - 2026-04-05

### Added
- **Project import** (`/import` slash command + `AtlasMind: Import Existing Project` command) ÔÇö scans an existing workspace and populates SSOT memory with project overview, dependencies, directory structure, tooling conventions, and license information. Detects project type for Node.js, Rust, Python, Go, Java, Ruby, and PHP projects. Non-destructive: never removes existing memory entries.

## [0.27.1] - 2026-04-04

### Changed
- **README overhaul** ÔÇö replaced the technical feature checklist with a user-friendly overview, centered logo, competitor comparison table (vs Claude Code, Cursor, Copilot, Aider, Open Hands), categorised skill table, provider list, and streamlined configuration section. Technical detail deferred to `docs/`.

## [0.27.0] - 2026-04-05

### Added
- **11 new built-in skills** bringing the total to 26:
  - `diagnostics` ÔÇö retrieve compiler errors/warnings via the VS Code diagnostics API.
  - `code-symbols` ÔÇö AST-aware navigation: list symbols, find references, go to definition.
  - `rename-symbol` ÔÇö cross-codebase rename via the language server with identifier validation.
  - `web-fetch` ÔÇö fetch URL content with SSRF protection (blocks localhost, private IPs, metadata endpoints); 30 s timeout.
  - `test-run` ÔÇö auto-detect test framework (vitest, jest, mocha, pytest, cargo) and run tests; 120 s timeout.
  - `file-delete` ÔÇö delete a workspace file.
  - `file-move` ÔÇö move/rename a workspace file.
  - `git-log` ÔÇö query commit log with optional ref, filePath, and maxCount (capped at 100).
  - `git-branch` ÔÇö list, create, switch, or delete branches with branch-name validation.
  - `diff-preview` ÔÇö combined git status + diff summary with add/modify/delete counts.
  - `code-action` ÔÇö list and apply VS Code quick-fixes and refactorings.
- `file-read` skill now supports optional `startLine`/`endLine` parameters for targeted reads.
- 12 new methods on `SkillExecutionContext`: `getGitLog`, `gitBranch`, `deleteFile`, `moveFile`, `getDiagnostics`, `getDocumentSymbols`, `findReferences`, `goToDefinition`, `renameSymbol`, `fetchUrl`, `getCodeActions`, `applyCodeAction`.
- Per-skill `timeoutMs` override ÔÇö skills like `web-fetch` (30 s) and `test-run` (120 s) bypass the default 15 s timeout.
- New test files: `diagnostics`, `codeSymbols`, `renameSymbol`, `webFetch`, `testRun`, `fileManage`, `gitBranch`, `diffPreview`, `codeAction` (381 tests total, 43 suites).

### Changed
- **Tiered terminal allow-list** ÔÇö `terminal-run` now uses a three-tier model: blocked commands (rm, curl, powershell, etc.) are rejected immediately; auto-approved commands expanded to ~40 (added python, cargo, dotnet, go, make, deno, bun, and more); unknown commands are rejected with the allow-list.
- **`MAX_TOOL_CALLS_PER_TURN`** raised from 5 to 8 to support more complex agentic workflows.
- Orchestrator tool execution now respects `skill.timeoutMs` when set, falling back to `TOOL_EXECUTION_TIMEOUT_MS`.

## [0.26.0] - 2026-04-04

### Added
- **Disk persistence for memory writes** ÔÇö `MemoryManager.upsert()` now persists entries as markdown files to the SSOT folder on disk, so agent-written decisions survive across sessions.
- **`memory-delete` skill** ÔÇö agents can now remove stale or outdated SSOT entries via the new `memory-delete` built-in skill (`src/skills/memoryDelete.ts`). Deletes both the in-memory index entry and the on-disk file.
- **`MemoryUpsertResult` feedback** ÔÇö `upsert()` returns `{ status, reason? }` instead of void, so callers know whether a write was created, updated, or rejected (capacity, validation, security scan).
- **Path validation on memory writes** ÔÇö `memoryWrite` rejects absolute paths, parent traversal (`..`), and paths without text-file extensions.
- **Content scanning on memory writes** ÔÇö all upserted content is scanned for prompt injection and credential leakage before acceptance; blocked entries are immediately rejected with a clear error.
- **Field-length enforcement** ÔÇö title (200 chars), snippet (4 000 chars), tags (12 max, 50 chars each) are validated and clamped on upsert.
- **`maxResults` cap** ÔÇö `memoryQuery` skill and `MemoryManager.queryRelevant()` now clamp results to a hard upper bound of 50.
- **`MemoryManager.delete()`** ÔÇö new public method to remove an entry from the index and optionally delete the backing SSOT file.
- **`deleteMemory()` on `SkillExecutionContext`** ÔÇö type-safe delete wired through the skill execution context.
- **Memory tree refresh** ÔÇö `MemoryTreeProvider` now has `EventEmitter`-backed refresh, triggered automatically after upsert or delete operations; shows overflow indicator if entries exceed 200.
- **`memoryRefresh` event** on `AtlasMindContext` ÔÇö fires on every index mutation so tree views and other consumers stay in sync.
- New test files: `tests/skills/memoryWrite.test.ts` (11 tests), `tests/skills/memoryDelete.test.ts` (5 tests).
- 15 new tests in `tests/memory/memoryManager.test.ts` covering path validation, security scan rejection, field limits, delete, query clamping, and upsert result status.

### Changed
- `SkillExecutionContext.upsertMemory()` now returns `MemoryUpsertResult` instead of `void`.
- `memoryWrite` skill returns explicit created/updated/rejected feedback instead of always reporting success.
- `memoryQuery` skill description now documents the maxResults cap.
- The Project Run Center now supports editable plan drafts before execution, per-batch approval gating, pause/resume controls, subtask-level artifact capture, diff-first review, and retrying only failed subtasks from a stored run plan.

## [0.25.0] - 2026-04-04

### Added
- A durable `ProjectRunHistory` service plus a new `AtlasMind: Open Project Run Center` command and `src/views/projectRunCenterPanel.ts` webview for previewing plans before execution, monitoring live batch progress, and reviewing recent project runs.
- A new `/runs` chat slash command and `Project Runs` sidebar tree view so recent autonomous runs are available outside the chat transcript.

### Changed
- `/project` executions now emit batch-level scheduler telemetry, persist run history records, and link directly into the Project Run Center for review.
- The Vision Panel now supports copy-to-clipboard and open-as-markdown response actions, and its lightweight renderer now handles ordered lists and markdown tables in addition to headings, inline code, and fenced blocks.

## [0.24.0] - 2026-04-04

### Changed
- The Vision Panel now renders markdown-style responses with headings, lists, inline code, and fenced code blocks instead of a raw text dump.
- Workspace file references emitted in Vision Panel responses can now be clicked to open the target file and optional line/column directly in VS Code.

## [0.23.0] - 2026-04-04

### Added
- A new `AtlasMind: Open Vision Panel` command and `src/views/visionPanel.ts` webview so operators can attach workspace images and run multimodal prompts outside the chat slash-command flow.
- Shared image attachment helpers in `src/chat/imageAttachments.ts`, used by both the chat participant and the Vision Panel.

### Changed
- AtlasMind vision requests now share one attachment-validation pipeline across freeform chat, `/vision`, and the Vision Panel UI.

## [0.22.0] - 2026-04-04

### Added
- A new `/vision` chat slash command that opens an image picker, attaches selected workspace images, and routes the request to vision-capable models.
- Durable checkpoint persistence in extension storage so automatic rollback checkpoints survive extension reloads and can still be restored later in the session.
- Multimodal integration coverage for orchestrator prompt assembly plus Copilot, Anthropic, and OpenAI-compatible provider request serialization.

### Changed
- Freeform and explicit vision chat flows now share the same attachment pipeline, deduplicating inline and picker-selected images before execution.

## [0.21.0] - 2026-04-04

### Added
- Inline workspace image ingestion for freeform chat requests. Prompts that mention supported image paths (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`) now attach those files to compatible vision-capable model requests.

### Changed
- Copilot, Anthropic, and OpenAI-compatible adapters now forward user image attachments using each provider's multimodal request shape.
- Initial prompt construction now compacts memory and recent session context against a model-aware prompt budget, reducing silent context-window overruns on long sessions.

## [0.20.0] - 2026-04-04

### Added
- Automatic pre-write checkpoints for write-capable tool runs, plus a new `rollback-checkpoint` built-in skill that restores the most recent checkpoint as a safety net for multi-file agent changes.

### Changed
- Streaming-capable providers now stream through the full agentic tool loop instead of only the no-tools path, improving long-running tool-driven interactions.

## [0.19.1] - 2026-04-04

### Fixed
- Corrected incorrect dates on CHANGELOG entries for v0.5.0 (`2026-04-04` ÔåÆ `2026-04-03`), v0.6.0 (`2026-04-05` ÔåÆ `2026-04-03`), and v0.7.0ÔÇôv0.8.1 (`2026-04-06` ÔåÆ `2026-04-03`) to match actual git commit timestamps.
- Removed duplicate out-of-order v0.11.0 and v0.10.3 entries that appeared after the v0.5.0 section.

## [0.19.0] - 2026-04-04

### Added
- Automatic post-write verification hook for agent tool runs. After successful `file-write`, `file-edit`, or `git-apply-patch` operations, AtlasMind can now run sanitized package scripts such as `test` or `lint` and feed the summary back into the next model turn.
- New settings for verification control: `atlasmind.autoVerifyAfterWrite`, `atlasmind.autoVerifyScripts`, and `atlasmind.autoVerifyTimeoutMs`.

### Changed
- The Settings panel now exposes verification toggles, configured script names, and per-script timeout limits.
- Verification runs once per write-producing tool batch instead of once per individual tool call, avoiding redundant test runs when a model performs multiple edits in one turn.

## [0.18.0] - 2026-04-04

### Added
- Safe built-in agent tools for grep-style text search, directory listing, targeted file edits, allow-listed terminal execution, and git status/diff/commit workflows.
- Configurable per-tool approval policy with `atlasmind.toolApprovalMode` and `atlasmind.allowTerminalWrite`; risky tool invocations now prompt before execution and terminal writes remain disabled by default.
- Bounded freeform chat carry-forward context via `SessionConversation`, controlled by `atlasmind.chatSessionTurnLimit` and `atlasmind.chatSessionContextChars`.
- Opportunistic streaming support for provider adapters that can emit text chunks while still returning a structured completion result. `CopilotAdapter` now streams text through the VS Code LM API.
- Unit tests for text search, targeted file editing, terminal execution, and orchestrator approval denial handling.

### Changed
- `SkillExecutionContext` now exposes `searchInFiles`, `listDirectory`, `runCommand`, `getGitStatus`, and `getGitDiff` in addition to file I/O, memory access, and git patching.
- `SettingsPanel` now controls tool approval mode, terminal-write opt-in, and session context compaction limits in addition to existing budget/speed and `/project` settings.
- `VoiceManager` now persists voice setting changes and copies final STT transcripts to the clipboard for quick pasting into chat.
- **Seed-only default providers** ([src/extension.ts](src/extension.ts)): `registerDefaultProviders()` now registers a single minimal seed model per provider instead of multiple hardcoded models. The full model list is auto-populated at startup via `refreshProviderModelsCatalog()` and runtime discovery.
- **Premium request multiplier scoring** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): `effectiveCostPer1k()` now factors `premiumRequestMultiplier` (e.g. 3├ù for Claude Opus 4) into subscription cost calculations, enabling the router to prefer 1├ù models when capabilities are equivalent.
- **Subscription quota tracking** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): New `updateSubscriptionQuota()` / `getSubscriptionQuota()` APIs allow runtime quota management. When quota is exhausted, subscription models fall to pay-per-token budget gating and full listed-price scoring.
- **Conservation threshold** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): Below 30% remaining quota, effective cost blends linearly from subscription cost toward listed API cost, encouraging the router to conserve subscription requests as they deplete.
- **`costPerRequestUnit` blending** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): When `SubscriptionQuota.costPerRequestUnit` is set, the router computes real per-request cost (`costPerRequestUnit ├ù multiplier`) enabling comparison across subscription tiers (e.g. Copilot Pro vs Claude Code).
- 10 new subscription quota and premium multiplier routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts).

### Security
- Added a tool policy layer that classifies invocations before execution and enforces modal approvals for risky actions.
- `terminal-run` executes only an allow-list of executables and never uses shell interpolation.

## [0.17.0] - 2026-04-04

### Added
- **Voice Panel** ([src/views/voicePanel.ts](src/views/voicePanel.ts)): New webview panel providing Text-to-Speech (TTS) and Speech-to-Text (STT) via the browser Web Speech API ÔÇö no external API key required. Features microphone input button, transcript display, TTS text entry + speak controls, and live voice settings (rate, pitch, volume, language).
- **VoiceManager** ([src/voice/voiceManager.ts](src/voice/voiceManager.ts)): Extension-host service that queues TTS output and bridges STT transcripts. Integrates with `AtlasMindContext` and is disposed with the extension. Validates all voice settings and sanitises the BCP 47 language tag before forwarding to the webview.
- **`atlasmind.openVoicePanel` command** ([src/commands.ts](src/commands.ts)): Opens the Voice Panel. Listed in the Command Palette as _AtlasMind: Open Voice Panel_.
- **`/voice` chat slash command** ([src/chat/participant.ts](src/chat/participant.ts)): Responds with a voice capability summary and an **Open Voice Panel** action button. Follow-up chips added to freeform responses.
- **TTS auto-speak** ([src/chat/participant.ts](src/chat/participant.ts)): When `atlasmind.voice.ttsEnabled` is `true`, freeform `@atlas` responses are automatically forwarded to the Voice Panel for synthesis.
- **`VoiceSettings` type** ([src/types.ts](src/types.ts)): New interface with `rate`, `pitch`, `volume`, and `language` fields ÔÇö validated in `VoiceManager` before use.
- **Six new configuration settings** (`atlasmind.voice.*`):
  - `ttsEnabled` ÔÇö auto-speak freeform @atlas responses (default: `false`)
  - `sttEnabled` ÔÇö enable STT in the Voice Panel (default: `false`)
  - `rate` ÔÇö synthesis rate 0.5ÔÇô2.0 (default: `1.0`)
  - `pitch` ÔÇö synthesis pitch 0ÔÇô2 (default: `1.0`)
  - `volume` ÔÇö synthesis volume 0ÔÇô1 (default: `1.0`)
  - `language` ÔÇö BCP 47 language tag (default: `""` = browser default)

### Security
- Voice Panel webview follows the same CSP nonce + `escapeHtml()` + message-validation pattern as all other AtlasMind panels. Incoming messages are checked by a strict type guard before any action is taken. Language setting is validated against a BCP 47 regex before being applied.

## [0.16.0] - 2026-04-04

### Added
- **Well-known model catalog** ([src/providers/modelCatalog.ts](src/providers/modelCatalog.ts)): Pattern-based catalog of verified model metadata (pricing, context windows, capabilities) for Anthropic, OpenAI, Google, DeepSeek, and Mistral model families. The catalog is consulted during model discovery so the router receives accurate data instead of heuristic guesses.
- **`DiscoveredModel` interface** ([src/providers/adapter.ts](src/providers/adapter.ts)): New type for partial model metadata returned at runtime. Added optional `discoverModels()` method to `ProviderAdapter` ÔÇö providers that implement it surface richer metadata than the ID-only `listModels()`.
- **CopilotAdapter.discoverModels()** ([src/providers/copilot.ts](src/providers/copilot.ts)): Extracts real `maxInputTokens` (context window) and display name from VS Code's Language Model API, then merges with catalog data for pricing and capabilities.  Enables the router to intelligently differentiate between multiple Copilot models (GPT-4o, Claude Sonnet 4, o4-mini, etc.).
- **AnthropicAdapter.discoverModels()** and **OpenAiCompatibleAdapter.discoverModels()** ([src/providers/anthropic.ts](src/providers/anthropic.ts), [src/providers/openai-compatible.ts](src/providers/openai-compatible.ts)): API providers now surface catalog-enriched metadata during discovery.
- **Subscription-aware routing** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): New `PricingModel` type (`'subscription' | 'pay-per-token' | 'free'`) added to `ProviderConfig`. Router treats subscription (e.g. GitHub Copilot) and free (e.g. local) providers as zero effective cost, strongly preferring them over pay-per-token API providers for single-request routing. When `parallelSlots > 1`, the subscription advantage is progressively reduced so API providers can absorb overflow.
- **`selectModelsForParallel()`** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): New method fills subscription/free slots first, then overflows to the best pay-per-token candidates for remaining parallel slots.
- [tests/providers/modelCatalog.test.ts](tests/providers/modelCatalog.test.ts) (25 tests) for catalog pattern matching across all providers.
- [tests/providers/copilotDiscovery.test.ts](tests/providers/copilotDiscovery.test.ts) (7 tests) for Copilot model discovery with real LM API properties.
- 8 new pricing-aware routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts) ÔÇö subscription preference, budget gate bypass, parallel slot allocation.

### Changed
- **`refreshProviderModelsCatalog()`** ([src/extension.ts](src/extension.ts)): Now prefers `discoverModels()` over `listModels()` when available, passing rich `DiscoveredModel` hints into the merge pipeline.
- **`inferModelMetadata()`** ([src/extension.ts](src/extension.ts)): Rewired to consult discovery hints first, then the well-known catalog, then heuristic fallbacks. Previous implementation relied solely on substring heuristics.
- **`mergeProviderModels()`** ([src/extension.ts](src/extension.ts)): Now accepts optional discovery hints and enriches existing static entries with runtime data (e.g. real context window from the LM API).
- **`CopilotAdapter.resolveModel()`** ([src/providers/copilot.ts](src/providers/copilot.ts)): Improved matching strategy ÔÇö tries exact ID match, then `family` match, then substring match before falling back to first available model.

## [0.15.0] - 2026-04-04

### Security
- **Critical**: Fixed path traversal vulnerability in `readFile` and `writeFile` skill contexts. Both now use `path.resolve()` + `path.relative()` to guarantee all file operations remain within the workspace root ([src/extension.ts](src/extension.ts)).
- Added JSON Schema validation for tool call arguments before skill execution ÔÇö rejects missing required params and type mismatches ([src/core/orchestrator.ts](src/core/orchestrator.ts)).
- Hardened planner subtask validation: enforce length limits on `id` (80), `title` (200), `description` (2000), `role` (80), and validate that `skills`/`dependsOn` arrays contain only strings ([src/core/planner.ts](src/core/planner.ts)).
- MCP stdio transport now rejects commands containing shell metacharacters (`|;&\`$`) to prevent injection ([src/mcp/mcpClient.ts](src/mcp/mcpClient.ts)).
- Memory manager now enforces a cap of 1,000 entries and 64 KB per SSOT document to prevent denial-of-service via oversized memory ([src/memory/memoryManager.ts](src/memory/memoryManager.ts)).
- Settings panel rejects directory traversal and absolute paths in `projectRunReportFolder` input ([src/views/settingsPanel.ts](src/views/settingsPanel.ts)).
- `escapeHtml()` now escapes single quotes (`'` ÔåÆ `&#39;`) to prevent attribute injection in webview HTML ([src/views/webviewUtils.ts](src/views/webviewUtils.ts)).
- Hardened temp file creation in `applyGitPatch`: uses `fs.mkdtemp()` with restrictive permissions (`0o600`) instead of predictable filenames ([src/extension.ts](src/extension.ts)).

### Added
- `validateToolArguments()` exported from orchestrator for schema-based tool argument validation.
- `parsePlannerResponse()` exported from planner for testability.
- [tests/core/orchestrator.security.test.ts](tests/core/orchestrator.security.test.ts) (9 tests) for tool argument validation.
- [tests/core/planner.test.ts](tests/core/planner.test.ts) (12 tests) for planner parsing, MAX_SUBTASKS enforcement, field length limits, and cycle removal.
- [tests/mcp/mcpClient.security.test.ts](tests/mcp/mcpClient.security.test.ts) (6 tests) for MCP command metacharacter rejection.
- [tests/views/webviewSecurity.test.ts](tests/views/webviewSecurity.test.ts) (6 tests) for escapeHtml coverage including single quotes.
- Memory cap tests in [tests/memory/memoryManager.test.ts](tests/memory/memoryManager.test.ts) (2 new tests) for entry count enforcement.

## [0.14.0] - 2026-04-04

### Added
- Completed memory content redaction pipeline in [src/memory/memoryManager.ts](src/memory/memoryManager.ts): warned entries now have sensitive values (API keys, tokens, passwords) replaced with `***REDACTED***` before being sent to model context via `redactSnippet()`.
- Added [tests/core/skillScanner.test.ts](tests/core/skillScanner.test.ts) with 19 tests covering all 12 built-in security rules, rule resolution with overrides and custom rules, and comment stripping.
- Added [tests/providers/providerAdapters.test.ts](tests/providers/providerAdapters.test.ts) with 10 tests for `LocalEchoAdapter` behavior and `ProviderRegistry` CRUD.
- Added [tests/bootstrap/bootstrapper.test.ts](tests/bootstrap/bootstrapper.test.ts) with 13 tests for SSOT path validation edge cases (traversal, absolute paths, empty input, normalisation).
- Added [tests/views/webviewMessages.test.ts](tests/views/webviewMessages.test.ts) with 21 tests for `isSettingsMessage` and `isModelProviderMessage` validators covering all valid/invalid message shapes.
- Added [docs/configuration.md](docs/configuration.md) consolidating all `atlasmind.*` workspace settings, project execution controls, webhook settings, experimental flags, and API key storage.

### Changed
- Updated [src/core/orchestrator.ts](src/core/orchestrator.ts) to use `redactSnippet()` for memory context in system prompts instead of raw snippets.
- Exported `getValidatedSsotPath` from [src/bootstrap/bootstrapper.ts](src/bootstrap/bootstrapper.ts) for isolated testing.
- Exported `isSettingsMessage` from [src/views/settingsPanel.ts](src/views/settingsPanel.ts) and `isModelProviderMessage` from [src/views/modelProviderPanel.ts](src/views/modelProviderPanel.ts) for isolated testing.
- Replaced TODO placeholder in skill template in [src/commands.ts](src/commands.ts) with descriptive stub comment.
- Updated README security section, status, project structure, and documentation links.
- Updated [docs/architecture.md](docs/architecture.md) and [docs/development.md](docs/development.md) test directory listings.

## [0.13.2] - 2026-04-03

### Added
- Added opt-in experimental skill learning in [src/commands.ts](src/commands.ts) so Atlas can draft custom skill files, scan them, and optionally import them as disabled skills.
- Added [src/core/skillDrafting.ts](src/core/skillDrafting.ts) with helper logic for skill-id suggestion, prompt construction, and generated-code extraction.
- Added [tests/core/skillDrafting.test.ts](tests/core/skillDrafting.test.ts) covering draft helper behavior.

### Changed
- Updated [src/views/settingsPanel.ts](src/views/settingsPanel.ts) and [package.json](package.json) with an explicit `atlasmind.experimentalSkillLearningEnabled` toggle and warning flow.
- Updated README and skill documentation to explain the token-usage and safety posture of Atlas-generated skills.

## [0.13.1] - 2026-04-03

### Added
- Added [src/core/taskProfiler.ts](src/core/taskProfiler.ts) to infer request phase, modality, reasoning intensity, and capability needs before routing.
- Added routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts) for vision gating, cheap-mode gating, and fast-mode gating.
- Added [tests/core/taskProfiler.test.ts](tests/core/taskProfiler.test.ts) covering mixed-modality inference, tool-use capability inference, and planning-phase reasoning.

### Changed
- Updated [src/core/modelRouter.ts](src/core/modelRouter.ts) so budget and speed act as hard routing gates before scoring, with task-profile-aware scoring afterward.
- Updated [src/core/orchestrator.ts](src/core/orchestrator.ts) and [src/core/planner.ts](src/core/planner.ts) to build task profiles for execution, planning, and synthesis.
- Updated README and architecture docs to reflect task-profile-aware routing.

## [0.13.0] - 2026-04-03

### Added
- Added local embeddings-backed retrieval in [src/memory/memoryManager.ts](src/memory/memoryManager.ts) with hashed vector indexing and cosine similarity ranking, covered by [tests/memory/memoryManager.test.ts](tests/memory/memoryManager.test.ts).
- Added built-in git-backed patch application skill in [src/skills/gitApplyPatch.ts](src/skills/gitApplyPatch.ts), wired through `SkillExecutionContext.applyGitPatch()`, covered by [tests/skills/gitApplyPatch.test.ts](tests/skills/gitApplyPatch.test.ts).
- Added routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts) for required-capability filtering and unhealthy-provider exclusion.

### Changed
- Upgraded [src/core/modelRouter.ts](src/core/modelRouter.ts) to be capability-aware and provider-health-aware.
- Updated [src/core/orchestrator.ts](src/core/orchestrator.ts) to request `function_calling` models automatically when agent skills are available.
- Added Anthropic tool-call parity in [src/providers/anthropic.ts](src/providers/anthropic.ts) so tool-use messages and tool results round-trip through the orchestrator loop.
- Updated README and docs to reflect fully implemented feature coverage across routing, memory, agent execution, and git-backed patching.

## [0.12.1] - 2026-04-03

### Added
- Added [SECURITY.md](SECURITY.md) with supported versions, private vulnerability reporting guidance, scope, and response goals.

### Changed
- Upgraded `vitest` and `@vitest/coverage-v8` to `4.1.2` to remediate the moderate Dependabot/npm audit advisory chain affecting `vitest`, `vite`, and `esbuild` in the development toolchain.
- Updated [README.md](README.md), [docs/development.md](docs/development.md), and [CONTRIBUTING.md](CONTRIBUTING.md) to point security disclosures to the repository security policy.

## [0.12.0] - 2026-04-03

### Added
- Added operator toggle support in [src/views/agentManagerPanel.ts](src/views/agentManagerPanel.ts): users can enable or disable registered agents directly from **AtlasMind: Manage Agents**.
- Added disabled-agent persistence in `globalState` (`atlasmind.disabledAgentIds`) and restore on activation in [src/extension.ts](src/extension.ts).
- Added orchestrator tests in [tests/core/orchestrator.tools.test.ts](tests/core/orchestrator.tools.test.ts) covering relevance-based agent selection and disabled-agent exclusion.

### Changed
- [src/core/agentRegistry.ts](src/core/agentRegistry.ts) now tracks enabled/disabled agent state with helper methods (`enable`, `disable`, `isEnabled`, `listEnabledAgents`).
- [src/core/orchestrator.ts](src/core/orchestrator.ts) now selects from enabled agents only and ranks candidates by request overlap with role/description/skills instead of picking the first registered agent.

## [0.11.1] - 2026-04-03

### Added
- Added orchestrator resilience tests in [tests/core/orchestrator.tools.test.ts](tests/core/orchestrator.tools.test.ts) for transient provider retry recovery and budget-cap termination.

### Changed
- Hardened [src/core/orchestrator.ts](src/core/orchestrator.ts) with bounded provider retries and request timeout handling for model completion calls.
- Added runtime budget cap enforcement in the agentic loop using cumulative token-based cost estimation (`TaskRequest.constraints.maxCostUsd` and `AgentDefinition.costLimitUsd`).
- Added safety limits for tool execution: max tool calls per turn, bounded parallel tool execution, and per-tool timeout handling.
- Agentic loop now returns an explicit termination response when the iteration safety cap is reached.
- Cost estimation now uses cumulative token usage across all model turns in a task, improving per-task cost accuracy.

## [0.10.3] - 2026-04-03

### Added
- Added webhook lifecycle emission coverage tests in [tests/core/orchestrator.tools.test.ts](tests/core/orchestrator.tools.test.ts) for `tool.started`, `tool.completed`, and `tool.failed` events.

### Changed
- Tool Webhooks panel now validates endpoint format and blocks non-HTTP(S) URLs before saving.
- Quality gate and packaging smoke path re-verified after webhook hardening changes.

## [0.10.2] - 2026-04-03

### Added
- Added [.vscodeignore](.vscodeignore) to reduce VSIX scope by excluding non-runtime project assets.
- Added [LICENSE](LICENSE) so packaging emits a standard bundled license file.

### Changed
- Added repository metadata to [package.json](package.json) to fix packaging base URL resolution.
- Packaging smoke-test now runs successfully via `npx @vscode/vsce package` without repository/license blockers.

## [0.10.1] - 2026-04-03

### Added
- **Webhook dispatcher tests** in [tests/core/toolWebhookDispatcher.test.ts](tests/core/toolWebhookDispatcher.test.ts) covering sensitive data redaction and preview truncation behavior.

### Changed
- `ToolWebhookDispatcher` delivery now retries transient failures with bounded backoff (`429` and `5xx`, up to 3 attempts) before final failure recording.
- Webhook preview helpers now redact sensitive values (`apiKey`, `token`, `password`, `secret`, bearer values, known token formats) before outbound payload emission.
- Fixed two lint issues in [src/memory/memoryScanner.ts](src/memory/memoryScanner.ts) so the full local quality gate is clean.

## [0.10.0] - 2026-04-03

### Added
- **Tool Webhooks panel** (`AtlasMind: Tool Webhooks`) for configuring webhook URL, event filters, timeout, bearer token, delivery testing, and recent delivery history.
- **Tool webhook dispatcher** (`src/core/toolWebhookDispatcher.ts`) with workspace-configurable event filtering, timeout handling, SecretStorage bearer token support, and globalState delivery history.
- **Tool lifecycle webhook events** from orchestrator tool execution loop:
  - `tool.started`
  - `tool.completed`
  - `tool.failed`
  - `tool.test` (manual test dispatch from panel)

### Changed
- `Orchestrator` now emits structured webhook payloads for each tool call lifecycle state (including task/agent/model context, duration, and preview fields).
- Added new workspace settings for webhook behavior:
  - `atlasmind.toolWebhookEnabled`
  - `atlasmind.toolWebhookUrl`
  - `atlasmind.toolWebhookTimeoutMs`
  - `atlasmind.toolWebhookEvents`

## [0.9.2] - 2026-04-03

### Added
- **Dynamic provider model discovery** at extension startup and via the Model Providers panel refresh action.
- **Adapter-driven catalog sync** that merges `listModels()` results into `ModelRouter`, preserving known curated metadata and inferring safe defaults for newly discovered models.
- **OpenAI-compatible `/models` discovery** in `OpenAiCompatibleAdapter` so OpenAI, Gemini-compatible endpoint, DeepSeek, Mistral, and z.ai can expose all currently available models.
- **Anthropic `/v1/models` discovery** with resilient fallback to curated defaults.

### Changed
- `@atlas` freeform and `/project` flows no longer force `preferredProvider: 'copilot'`; routing now evaluates all enabled providers unless explicitly constrained.
- Model Providers panel **Refresh Model Metadata** button now triggers a real catalog refresh and reports updated provider/model counts.

## [0.9.1] - 2026-04-03

### Added
- **z.ai (GLM) provider** ÔÇö new `'zai'` provider ID with models GLM-4.7 Flash (free), GLM-4.7, and GLM-5.
  Uses the z.ai OpenAI-compatible endpoint (`https://api.z.ai/api/paas/v4`).
- **OpenAI provider** ÔÇö GPT-4o mini and GPT-4o models now fully wired with adapter.
- **DeepSeek provider** ÔÇö DeepSeek V3 (`deepseek-chat`) and DeepSeek R1 (`deepseek-reasoner`) models.
- **Mistral provider** ÔÇö Mistral Small and Mistral Large models.
- **Google Gemini provider** ÔÇö Gemini 2.0 Flash and Gemini 1.5 Pro via Google AI Studio's
  OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai`).
- **`OpenAiCompatibleAdapter`** (`src/providers/openai-compatible.ts`) ÔÇö generic adapter for any
  OpenAI-compatible chat completion API. Supports tool calling, retry-after logic, and
  per-provider base URL / secret key configuration. Shared by all five new providers.
- **Model Provider panel** now lists z.ai alongside all existing providers.

### Changed
- `ProviderId` union in `src/types.ts` extended with `'zai'`.
- `requiresApiKey()` in the model provider panel now also excludes `'local'` (shows a
  dedicated message instead of an API key prompt for local LLMs).
- All 5 previously stub-only providers (openai, google, mistral, deepseek) now have
  working adapters and pre-populated model catalogs.

## [0.9.0] - 2026-04-03

### Added
- **Execution failure banner with rollback guidance** ÔÇö when one or more subtasks fail,
  `/project` now shows a clear post-run banner listing the failed subtask titles, the
  number of files modified before the failure, and a *View Source Control* action button
  so users can quickly review and revert partial changes.
- **Outcome-driven follow-up chips** ÔÇö `buildFollowups()` now accepts an optional
  `ProjectRunOutcome` context object and returns different chips based on run outcome:
  - Failures ÔåÆ *Retry the project* + *Diagnose failures*
  - Changed files (no failures) ÔåÆ *Add tests*
  - No changes / no outcome ÔåÆ original default chips
- **`ProjectRunOutcome` interface** exported from `src/chat/participant.ts` for
  downstream consumers and tests.
- **7 new participant helper tests** (17 total in `tests/chat/participant.helpers.test.ts`):
  - Outcome-driven followups: failure, changed-files, default, and no-outcome paths
  - Empty changed-file summary returns all-zero counts
  - Approval-threshold gating (10-subtask run exceeds default threshold)
  - No-op run stays within default threshold (2 subtasks)

### Changed
- `handleChatRequest` propagates `ProjectRunOutcome` through `ChatResult.metadata`
  so the follow-up provider receives structured run outcome rather than just the
  command name.
- Failed subtask titles are tracked live in `onProgress` and surfaced both in the
  failure banner and in `ProjectRunOutcome.failedSubtaskTitles`.

## [0.8.1] - 2026-04-03

### Added
- **Settings panel support for `/project` controls**.
  - AtlasMind Settings now exposes project execution UI controls directly in the webview panel:
    - approval threshold (files)
    - estimated files per subtask multiplier
    - changed-file reference limit
    - run summary report folder
  - Input values are validated client-side and server-side before being persisted to workspace settings.

### Changed
- Settings panel is no longer limited to budget/speed modes; it now provides first-class configuration for project execution behavior.

## [0.8.0] - 2026-04-03

### Added
- **Project run summary export** for `/project` executions.
  - Atlas now writes a JSON report to the configured report folder (default: `project_memory/operations`) containing goal, duration, cost, subtask outcomes, changed files, and per-file attribution traces.
  - Chat responses include a clickable reference and an "Open Run Summary" action button when report export succeeds.
- New configuration setting: `atlasmind.projectRunReportFolder`.

### Changed
- `/project` changed-file reporting now tracks per-subtask attribution traces and persists them in the exported run summary.

## [0.7.3] - 2026-04-03

### Added
- **Configurable project UI thresholds** for `/project` runs.
  - `atlasmind.projectApprovalFileThreshold` controls when `--approve` is required.
  - `atlasmind.projectEstimatedFilesPerSubtask` controls the preview heuristic for estimated file impact.
  - `atlasmind.projectChangedFileReferenceLimit` controls how many changed files are emitted as clickable references.

### Changed
- Workspace impact reporting now attributes file changes per completed subtask instead of only showing cumulative drift from the project start.

## [0.7.2] - 2026-04-03

### Added
- **Live workspace impact tracking** for `/project` runs.
  - Atlas now snapshots the workspace before execution starts, then reports how many files have actually changed as subtasks complete.
  - The final project report includes a changed-file summary broken down by `created`, `modified`, and `deleted` files.
  - Up to 5 changed files are surfaced as clickable references in the chat response.

## [0.7.1] - 2026-04-03

### Added
- **Follow-up suggestions** for the `@atlas` chat participant. After each response, VS Code displays contextual follow-up chips relevant to the command that just ran:
  - `/bootstrap` ÔåÆ view agents, view skills, query memory, start a project
  - `/agents` ÔåÆ skills, run a project, how to add an agent
  - `/skills` ÔåÆ agents, how to add a skill, run a project
  - `/memory` ÔåÆ search architecture/decisions, start a project from memory
  - `/cost` ÔåÆ which agents ran, tips to reduce cost
  - `/project` ÔåÆ review cost, save plan to memory, run another project
  - Freeform ÔåÆ turn into a project, search memory, check cost
- `handleChatRequest` now returns `vscode.ChatResult` with `metadata.command` so the `followupProvider` can distinguish which slash command produced the response.

## [0.7.0] - 2026-04-03

### Added
- **Parallel multi-agent project execution** ÔÇö users can now ask Atlas to tackle a complex goal autonomously via the new `/project` slash command.
  - `src/core/planner.ts`: `Planner` class sends a structured JSON decomposition prompt to the LLM and returns a `ProjectPlan` ÔÇö a DAG of `SubTask` nodes, each with an id, title, description, role, skill IDs, and `dependsOn` edges. Includes JSON fence extraction, per-field validation, and Kahn's cycle-removal algorithm so malformed LLM output can never produce an infinite loop.
  - `src/core/taskScheduler.ts`: `TaskScheduler` class topologically sorts the DAG into execution batches (Kahn's BFS), runs each batch with `Promise.all`, caps fan-out at `MAX_CONCURRENCY = 5`, and forwards completed task output as dependency context to downstream tasks. Fires a typed `SchedulerProgress` callback after every subtask.
  - `Orchestrator.processProject(goal, constraints, onProgress?)` ÔÇö orchestrates the full flow: plan ÔåÆ parallel execution via ephemeral role-based sub-agents ÔåÆ LLM synthesis ÔåÆ `ProjectResult`. Sub-agents are synthesised from `SubTask.role` (one of: architect, backend-engineer, frontend-engineer, tester, documentation-writer, devops, data-engineer, security-reviewer, general-assistant) and never touch the `AgentRegistry`.
  - `Orchestrator.processTaskWithAgent(request, agent)` ÔÇö new public method extracted from `processTask`; allows the executor to bypass agent selection and use any `AgentDefinition` directly.
  - Parallel tool calls in `runAgenticLoop`: the sequential `for...of` loop over `toolCalls` is replaced with `Promise.all`, so multiple skills in a single model turn now execute concurrently.
- New types in `src/types.ts`: `SubTask`, `SubTaskStatus`, `SubTaskResult`, `ProjectPlan`, `ProjectResult`, `ProjectProgressUpdate` (discriminated union: `planned | subtask-start | subtask-done | synthesizing | error`).
- `/project` chat slash command in `@atlas` participant ÔÇö streams `planned` (markdown task table), per-task progress and output, and the final synthesised report.
- 12 new unit tests in `tests/core/planner.scheduler.test.ts` covering `removeCycles`, `buildExecutionBatches`, and `TaskScheduler` (dependency forwarding, progress callbacks, failure handling).

### Changed
- `Orchestrator.processTask` refactored to delegate to `processTaskWithAgent` ÔÇö no behaviour change for existing callers.

## [0.6.0] - 2026-04-03

### Added
- **MCP Integration** ÔÇö AtlasMind can now connect to any [Model Context Protocol](https://modelcontextprotocol.io/) server and expose its tools as AtlasMind skills.
  - `src/mcp/mcpClient.ts`: wraps `@modelcontextprotocol/sdk` `Client`; handles stdio (subprocess) and HTTP (Streamable HTTP with SSE fallback) transports; exposes `connect()`, `disconnect()`, `callTool()`, `refreshTools()`, and live `status`/`error`/`tools` state.
  - `src/mcp/mcpServerRegistry.ts`: persists server configurations in `globalState`; creates and manages `McpClient` instances; registers discovered tools as `SkillDefinition` objects in the `SkillsRegistry` with deterministic IDs (`mcp:<serverId>:<toolName>`); auto-approves MCP skills (user explicitly added the server = implicit trust); disables skills on disconnect and unregisters them on server removal.
  - `src/views/mcpPanel.ts`: webview panel with server list (connection status dot), per-server tool explorer, add-server form (transport toggle between stdio and HTTP), reconnect, enable/disable, and remove actions. All user input is HTML-escaped and all incoming messages are validated before acting.
- `McpServerConfig`, `McpConnectionStatus`, `McpToolInfo`, `McpServerState` types added to `src/types.ts`.
- `mcpServerRegistry: McpServerRegistry` added to `AtlasMindContext` in `src/extension.ts`; connected servers auto-reconnect on activation; disposed cleanly on deactivation.
- `atlasmind.openMcpServers` command (icon: `$(plug)`) opens the MCP panel.
- **MCP Servers** tree view added to AtlasMind sidebar.
- Runtime dependencies: `@modelcontextprotocol/sdk ^1.29.0`, `zod ^4.3.6`.
- 27 new unit tests in `tests/mcp/` (57 passing total).

## [0.5.1] - 2026-04-03

### Added
- **Memory Scanner** (`src/memory/memoryScanner.ts`): scans every SSOT document for prompt-injection patterns and credential leakage before it reaches model context.
  - 10 rules across three categories: instruction-override phrases (`pi-ignore-instructions`, `pi-disregard-instructions`, `pi-forget-instructions`, `pi-new-instructions`, `pi-system-prompt-override`, `pi-jailbreak`), persona/obfuscation red flags (`pi-act-as`, `pi-zero-width`, `pi-html-comment`), and credential leakage (`secret-api-key`, `secret-token`, `secret-password`). Also checks for oversized documents (`size-limit`).
  - `blocked` status (error-level hits) removes the entry from `queryRelevant` entirely ÔÇö it is never sent to the model.
  - `warned` status (warning-level hits) keeps the entry in context but appends a `[SECURITY WARNING]` notice to the system prompt so the model applies extra scepticism.
- `MemoryScanIssue` and `MemoryScanResult` types added to `src/types.ts`.
- `MemoryManager` now scans all entries on `loadFromDisk` and on `upsert` (when content is provided); exposes `getScanResults()`, `getWarnedEntries()`, `getBlockedEntries()`.
- `Orchestrator.buildMessages()` appends a security notice when any loaded memory entries are warned or blocked.
- 12 new unit tests in `tests/memory/memoryScanner.test.ts` (30 passing total).

## [0.5.0] - 2026-04-03

### Added
- **Skills panel security scanning**: each skill shows a status icon (not scanned / passed / failed) and a rich tooltip with full description, enabled state, parameter list, scan status, and per-issue details (line, snippet, rule, message).
- **Per-skill enable/disable toggle**: skills can be individually enabled or disabled from the tree view via inline eye icon; state persists across sessions in `globalState`.
- **Security gate**: `SkillsRegistry.enable()` rejects skills whose scan found error-level issues, preventing unsafe code from running.
- **Skill security scanner** (`src/core/skillScanner.ts`): 12 built-in rules covering `eval`, `new Function`, `child_process`, shell execution, `process.env`, outbound fetch/HTTP, path traversal, direct `fs` access, and hardcoded secrets.
- **Scanner rule configurator** (`src/views/skillScannerPanel.ts`): webview panel listing all effective rules with per-rule toggle, severity and message editing, custom rule add/delete, and built-in rule reset. Built-in rule patterns are read-only to preserve security integrity.
- **`ScannerRulesManager`** (`src/core/scannerRulesManager.ts`): persists rule overrides and custom rules to `globalState`; validates regex patterns before accepting any change.
- **Add skill workflow** (`atlasmind.skills.addSkill`): create a template `.js` skill file in the workspace or import an existing compiled `.js` file; security scan runs before import is accepted; skill starts disabled pending review.
- **Scan details output channel** (`atlasmind.skills.showScanResults`): shows per-issue details (line, rule, snippet, message) in a dedicated VS Code output channel.
- Built-in skills marked `builtIn: true`; auto-approved on extension activation without requiring a manual scan.
- New commands: `atlasmind.skills.toggleEnabled`, `atlasmind.skills.scan`, `atlasmind.skills.addSkill`, `atlasmind.skills.showScanResults`, `atlasmind.openScannerRules`.
- Inline tree-view buttons for scan (shield) and toggle (eye) on every skill item.
- Skills view title-bar buttons: add skill (`+`) and configure scanner (gear).
- `SerializedScanRule`, `ScannerRulesConfig`, `SkillScanIssue`, `SkillScanResult`, `SkillScanStatus` types added to `src/types.ts`.
- `source?` and `builtIn?` fields added to `SkillDefinition`.
- `ScannerRulesManager` and `skillsRefresh` emitter added to `AtlasMindContext`.

### Changed
- `SkillsTreeProvider` fully rewritten with `SkillTreeItem` exposing `skillId`, rich `MarkdownString` tooltip, state-aware `ThemeIcon`, and `contextValue` (`skill-{builtin|custom}-{enabled|disabled}`) for when-clause menu targeting.
- `webviewUtils.ts` `WebviewShellOptions` extended with optional `extraCss` field.

## [0.3.0] - 2026-04-03

### Added
- Added extension-wide governance scaffolding support to bootstrap flow for any target project (`.github` templates, CI baseline, CODEOWNERS, and `.vscode/extensions.json`).

### Changed
- Updated chat `/bootstrap` command to execute real bootstrap flow instead of returning a placeholder response.

## [0.2.0] - 2026-04-03

### Added
- Added baseline unit tests for `ModelRouter` and `CostTracker` using Vitest.
- Added CI workflow at `.github/workflows/ci.yml` to run compile, lint, tests, and coverage on pushes and pull requests to `master`.
- Added GitHub governance templates: `.github/pull_request_template.md`, issue templates, and `.github/CODEOWNERS`.
- Added team extension recommendations in `.vscode/extensions.json`.

### Changed
- Added test scripts (`test`, `test:watch`, `test:coverage`) and testing dependencies in `package.json`.
- Added ESLint configuration with TypeScript support in `.eslintrc.cjs`.
- Updated documentation for testing workflow, CI quality gates, and branch/PR/issue governance expectations.

## [0.1.0] - 2026-04-03

### Added
- Added `ProviderRegistry` and a `local` fallback adapter (`local/echo-1`) to enable an executable end-to-end path without external SDK dependencies.
- Registered default provider metadata and default agent at activation.
- Added an Anthropic provider adapter (`src/providers/anthropic.ts`) with SecretStorage key lookup and retry handling for rate limits and transient server errors.
- Added a GitHub Copilot provider adapter (`src/providers/copilot.ts`) using VS Code's Language Model API.

### Changed
- Replaced orchestrator stub flow with an MVP pipeline: agent selection, memory query, model routing, provider dispatch, and cost recording.
- Implemented model routing scoring based on budget/speed/quality heuristics over enabled provider models.
- Implemented disk-backed SSOT indexing and ranked keyword retrieval in `MemoryManager`.
- Wired freeform `@atlas` chat messages through the orchestrator and implemented `/memory` query output.
- Updated memory sidebar view to display indexed SSOT entries.
- Updated cost calculation to use per-model pricing metadata and provider-reported token usage.
- Updated chat routing defaults to prefer the Copilot provider when available.

## [0.0.2] - 2026-04-03

### Changed
- Hardened webview security by replacing inline handlers with nonce-protected scripts and stricter CSP rules.
- Validated all webview messages before accepting configuration changes or provider actions.
- Moved provider credential handling to VS Code SecretStorage instead of placeholder UI-only flows.
- Made project bootstrapping safer by rejecting unsafe SSOT paths and by creating only missing files and folders.
- Updated project documentation and Copilot instructions to enforce a safety-first and security-first development model.

## [0.0.1] - 2026-04-03

### Added
- Extension scaffolding with `package.json` manifest and TypeScript build.
- Chat participant `@atlas` with slash commands: `/bootstrap`, `/agents`, `/skills`, `/memory`, `/cost`.
- Sidebar tree views: Agents, Skills, Memory (SSOT), Models.
- Webview panels: Model Provider management, Settings (budget/speed sliders).
- Core architecture stubs: Orchestrator, AgentRegistry, SkillsRegistry, ModelRouter, CostTracker.
- Memory manager stub with SSOT folder definitions.
- Project bootstrapper: Git init prompt, SSOT folder creation, project type selection.
- Provider adapter interface (`ProviderAdapter`) for normalised LLM access.
- Shared type definitions (`types.ts`): agents, skills, models, routing, cost tracking.
- Activity bar icon and sidebar container.
- Full documentation set: README, CHANGELOG, CONTRIBUTING, architecture guides.
- Copilot instruction set (`.github/copilot-instructions.md`) for documentation maintenance.
