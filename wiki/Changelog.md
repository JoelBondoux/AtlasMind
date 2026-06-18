# Changelog

This page highlights major releases. For the complete changelog, see [CHANGELOG.md](https://github.com/JoelBondoux/AtlasMind/blob/master/CHANGELOG.md) in the repository.

**Note:** Every commit (not just PRs) must include a version bump in `package.json` and a matching `CHANGELOG.md` entry. This applies to all code, doc, and config changes. The version bump and changelog update must be in the same commit as the change.

---

## v0.98.0 — Skip Unconfigured Providers + On-Demand Memory Refresh

- **Unconfigured providers are no longer probed** (`src/extension.ts`): startup discovery skips any provider with no API key/credentials before its health check — so an unconfigured Bedrock (no AWS keys) no longer burns ~30s on a network probe, and the ~20 providers you haven't set up are skipped entirely. Configured ones are unaffected.
- **Stale-memory auto-refresh is now off by default** (`atlasmind.autoRefreshStaleMemory`): re-importing stale imported memory is an expensive LLM re-summarization that slowed dashboard/panel load on launch. AtlasMind now flags stale memory and surfaces **Update Memory** for an on-demand refresh instead; set the new setting to `true` to restore auto-refresh. See [[Configuration]].

## v0.97.2 — Faster, Bounded Startup Discovery

- **No more ~1-minute `[providers]` stall** (`src/extension.ts`): startup model discovery across ~24 providers ran serially, so slow providers (or a hanging Claude CLI health probe with a 60s timeout) summed to nearly a minute. Discovery is now concurrent and each provider is bounded by a 10s timeout, so one slow provider can't stall the rest — total time drops to roughly the slowest single provider. See [[FAQ]].

## v0.97.1 — Surface Silent Activation Failures

- **Dead toolbar icons now explain themselves** (`src/extension.ts`): when a core startup step fails, the context was left unassigned and every chat-view title icon that needs it silently did nothing (only Settings worked). Activation now catches the failure and shows an actionable error with a Show Output button pointing at the "AtlasMind" output channel, where the failing step is logged. See [[FAQ]].

## v0.97.0 — Model Comparison Panel

- **A real UI for model comparison** (`src/views/modelComparisonPanel.ts`): the Compare Models command now opens a webview — enter a prompt, pick 2+ models, and see a ranked table of quality/cost/latency with output previews, instead of plain output-channel text. Graded outcomes still calibrate routing. Nonce-protected, message-validated, output escaped. See [[Architecture]] and [[Chat-Commands]].

## v0.96.1 — Higher-Fidelity Claude Brain

- **More context for the Claude Code CLI bridge** (`src/providers/claude-cli.ts`): instead of truncating every message to 4k chars, the bridge now gives the latest turn up to 16k (≈4×) while keeping history small and the total within the OS command-line limit. This directly benefits brain-role pins (`planningModelId` / `synthesisModelId`) where a single message carries the goal + memory context. See [[Model-Routing]].

## v0.96.0 — Local-Draft / Frontier-Escalate

- **Draft cheap, escalate when needed** (`src/core/orchestrator.ts`): the new `atlasmind.draftModelId` setting pins a draft model (e.g. a fast local model) for the first attempt of mechanical/low-stakes tasks, while the existing struggle-gated escalation upgrades to a stronger model if the draft falls short — completing the draft/plan/execute/synthesize role-routing set. The pin never blocks escalation (which now explicitly clears any model pin). See [[Configuration]] and [[Model-Routing]].

## v0.95.0 — Model Comparison Harness

- **Benchmark models on your own prompt** (`src/core/modelEvalHarness.ts`, `AtlasMind: Compare Models on a Prompt`): run one prompt across selected models and get a ranked comparison (quality, cost, latency, tokens, preview). The graded outcomes feed the outcome-driven routing channel, so benchmarking also calibrates routing. The scoring core is pure and unit-tested; the quality scorer is now shared (`executionQuality.ts`). See [[Model-Routing]] and [[Chat-Commands]].

## v0.94.0 — Synthesis Role Pin

- **Complete the role-routing trio** (`src/core/orchestrator.ts`): a new `atlasmind.synthesisModelId` setting pins the synthesis phase (summarizing results/sessions) to a chosen reasoner, symmetric to `atlasmind.planningModelId`. Together they implement plan-with-the-brain → execute-with-workers → synthesize-with-the-brain over the `preferredModel` pin. See [[Configuration]] and [[Model-Routing]].

## v0.93.0 — Context-Aware Outcome Routing

- **Outcome bias per reasoning tier** (`src/core/modelRouter.ts`): the learned routing bias now tracks each model's outcomes both in aggregate and per reasoning tier (low/medium/high), so a model strong at deep reasoning but weak at mechanical work is preferred only where it actually performs. Falls back to the aggregate when a tier bucket is sparse. See [[Model-Routing]].

## v0.92.0 — Planner-Brain Role Routing

- **Pin a model by role** (`src/core/modelRouter.ts`, `src/core/orchestrator.ts`): a new `RoutingConstraints.preferredModel` pin lets a specific model be chosen for a role, bypassing budget/speed gates when it is genuinely available (still respecting health and required capabilities). Its first use is the **planner brain** — the `atlasmind.planningModelId` setting pins the planning/decomposition phase to a chosen reasoner (or a Claude subscription, since planning needs no tools) while execution still routes to tool-capable workers. See [[Model-Routing]] and [[Configuration]].

## v0.91.0 — Outcome-Driven Routing

- **Routing learns from real outcomes** (`src/core/modelRouter.ts`, `src/core/orchestrator.ts`): a new per-model execution-outcome channel keeps a decayed EWMA of graded run quality (error / empty / truncated / clean) and turns it into a small, bounded routing nudge — so models that consistently do well on this project's work are preferred, and struggling ones are nudged down without being excluded. Separate from the manual thumbs feedback, gated by a minimum sample count and the `feedbackRoutingWeight` control, and persisted across sessions. See [[Model-Routing]].

## v0.90.0 — Smarter Anthropic Caching

- **Stable/volatile system split** (`src/providers/anthropic.ts`): the cache breakpoint now sits after the stable system head (guardrails/agent/skills) and before the volatile memory + evidence tail, so the cached prefix stays identical across turns and hit rates rise. The whole-system approach missed whenever memory/evidence changed.
- **Threaded tool-less caching** (`src/core/orchestrator.ts`): a new `cacheStablePrefix` request flag (set when the carried-context cacheable ratio ≥ 0.25) caches the stable prefix on threaded chat turns too, not just agentic tool loops — while still skipping single-shot turns. See [[Model-Routing]].

## v0.89.0 — Anthropic Prompt-Cache Writes

- **AtlasMind now actively caches the stable prefix on Anthropic** (`src/providers/anthropic.ts`): for agentic (tool-carrying) requests, the system prompt and tool definitions are marked with `cache_control: ephemeral`, so Anthropic bills them at the reduced cache-read rate on repeat calls within a task's tool loop. Gated on tool presence to avoid the cache-write premium on single-shot turns. Closes the loop with the v0.88.0 savings telemetry — AtlasMind writes the cache, the provider reports the reads, the Cost Dashboard shows the realised savings. See [[Model-Routing]].

## v0.88.0 — Prompt-Cache Savings Visibility

- **Measured cache savings in the Cost Dashboard** (`src/providers/*`, `src/core/costTracker.ts`, `src/views/costDashboardPanel.ts`): adapters now read cached input tokens from provider usage (Anthropic `cache_read_input_tokens`, OpenAI `prompt_tokens_details.cached_tokens`, DeepSeek `prompt_cache_hit_tokens`) on both buffered and streaming paths. The orchestrator values the avoided spend (`ModelRouter.cacheReadPricePer1k`), the cost summary aggregates `totalCacheSavingsUsd` + `totalCachedInputTokens`, and a new **Cache Savings** card appears beside Compression Savings. Closes Direction 1 of the routing roadmap end-to-end. See [[Model-Routing]].

## v0.87.1 — Per-Provider Cache Discounts

- **Realistic per-provider cache-read pricing** (`src/core/modelRouter.ts`): cache-aware routing now uses a `PROVIDER_CACHE_READ_FACTOR` baseline (Anthropic/Claude CLI 0.1×, OpenAI/Azure/Copilot 0.5×, DeepSeek/Google 0.25×) instead of a flat 0.25× for cache-capable models without an explicit cached price — so deeper-discount providers like Claude are costed correctly on iterative turns. Still a bootstrap baseline only: a dynamic `cachedInputPricePer1k` from discovery / pricing sync overrides it. See [[Model-Routing]].

## v0.87.0 — Cache-Aware Model Routing

- **Prompt-cache economics in routing** (`src/core/modelRouter.ts`, `src/core/orchestrator.ts`): AtlasMind sends a large, stable prefix (system prompt + memory bundle + tool definitions) every turn, which frontier providers bill at a reduced cache-read rate. The router now projects that saving — a new `cacheablePrefixRatio` (estimated from carried context vs. the new message) makes cache-capable models cheaper on iterative/threaded work, while single-shot turns are unaffected. `ModelInfo`/`CatalogEntry` gain `supportsPromptCaching` + `cachedInputPricePer1k`.
- **Cache capability is dynamic** — providers change model capabilities, so it is data-driven: `DiscoveredModel` and the live pricing sync can report (or retract) caching support per refresh, merged with hint → pricing → catalog precedence; the static provider set is only a bootstrap fallback. See [[Model-Routing]].

## v0.86.2 — Active-Subscription Routing Preference

- **Subscriptions preferred for ordinary work** (`src/core/modelRouter.ts`): the subscription preference bonus previously applied only on maintenance tasks, so on normal work a paid-for, quota-remaining subscription got no nudge over pay-per-token (unlike local models, which do). Added a small, quota-aware general bonus so an active subscription is preferred for everyday work too — vanishing once quota is exhausted (then treated as pay-per-token). See [[Model-Routing]].

## v0.86.1 — Reasoning-Aware Routing Fix

- **Catalog reasoning depth & latency class now reach the router** (`src/extension.ts`): `inferModelMetadata()` was dropping `reasoningDepth` and `latencyClass` when merging discovered models with the catalog. Since most models are populated via discovery, deep reasoners (Opus, DeepSeek R1, Nemotron Ultra) were collapsing to the fallback depth and getting under-ranked for high-reasoning tasks. The annotations now survive the merge. (The `claude-cli` Claude-subscription provider stays chat-only by design, so it remains correctly excluded from tool-driven agentic work.) See [[Model-Routing]].

## v0.86.0 — NVIDIA Nemotron Models (NIM)

- **First-class Nemotron catalog for NVIDIA NIM** (`src/providers/modelCatalog.ts`, `src/runtime/core.ts`): the NVIDIA NIM provider gains a provider-scoped `NVIDIA_CATALOG` for the Nemotron family — Ultra 253B (extended reasoning), Super 49B, Nano, 70B Instruct, and Mini — with accurate context windows, capabilities, reasoning depth, and hosted pricing. Resolving from a provider-scoped catalog means hosted (paid) Nemotron models no longer inherit metadata from the `$0` local Nemotron entries. The default seed now leads with Nemotron Super 49B + Nano so the family appears before runtime discovery. See [[Model-Routing]].

## v0.85.0 — Cross-Language Archetype Detection

- **Archetype detection now spans languages** (`src/core/testingScaffolder.ts`): the scaffolder reads each detected language's dependency manifest (`pyproject.toml`/`requirements.txt`/`Pipfile`, `Cargo.toml`, `go.mod`, `pom.xml`/`build.gradle`) so web/api/cli/game archetypes resolve for Python, Rust, Go, and Java — not just Node. Short Node-only package names are gated to Node to prevent substring false positives (e.g. `cargo-nextest` is no longer mistaken for Next.js). Archetype-dependent recipes like the API/CLI/web e2e branch now fire correctly across stacks.

## v0.84.0 — Multi-Language Testing-Framework Scaffolding

- **Language- and archetype-aware scaffolding** (`src/core/testingScaffolder.ts`): the framework scaffolder no longer assumes Node/JS. It detects the project language (Node/Python/Rust/Go/.NET/Java) from manifest fingerprints and a coarse archetype (web/api/cli/game/mobile/library/generic), then emits idiomatic starter files — pytest + Hypothesis + Locust (Python), `cargo test` + proptest + criterion (Rust), `go test` + `testing/quick` + benchmarks (Go), xUnit (.NET), JUnit 5 (Java), alongside the existing Node toolchain. Node e2e recipes branch on archetype (API smoke test / CLI spawn harness / Playwright web spec). Unknown stacks degrade to playbook-only guidance. Closes the prior gap where non-Node projects received JS-flavoured stubs. Still non-destructive. See [[Agents]] and [[Skills]].

## v0.83.0 — Testing Protocols for External Agents & Framework Scaffolding

- **Outbound testing-protocol sync** (`src/utils/testingProtocolSync.ts`, `src/utils/aiInstructionSync.ts`, `src/views/settingsPanel.ts`): the testing methodology matrix is now visible to AI agents *outside* AtlasMind. Instruction-file sync was previously inbound only; the new `syncTestingProtocols` writes an AtlasMind-managed, delimited block describing each enabled methodology (what, when, key tools, owner agent, preferred model, notes) into every *detected* markdown instruction file — `CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, Cursor, Cline, Gemini, Windsurf, Aider. Strictly non-destructive: only the managed block is touched, only existing files are written, and all paths pass the shared traversal guard. Saving the matrix auto-syncs; a **Sync to AI agents** button and `atlasmind.syncTestingProtocols` command trigger it on demand. See [[Skills]] and [[Security]].
- **Stack-aware framework scaffolder** (`src/core/testingScaffolder.ts`): `scaffoldTestingFramework` infers the project stack (TS/JS, test runner, UI framework, Playwright/Cypress) and generates fitting starter files for each enabled methodology (Vitest/Jest specs, Playwright/Cypress e2e, fast-check property test, k6 load script, snapshot test) plus a managed `project_memory/operations/testing-strategy.md` playbook. Non-destructive — files are created only when absent, `package.json` is never mutated, and the action is modal-confirmed. Available via the **Scaffold framework** button and `atlasmind.scaffoldTestingFramework` command.

## v0.82.0 — Remote Control from the Web Build

- **Drive a desktop instance from vscode.dev** (`src/web/*`, `src/remote/*`, `src/views/chatProtocol.ts`, `src/views/chatWebviewMarkup.ts`): AtlasMind now ships a web extension that acts as a thin client, relaying chat and read-only dashboards to a full desktop instance over a localhost WebSocket. The desktop does all Node-heavy work (models, file system, MCP, voice); the browser only renders UI. **Secrets never leave the desktop.** The chat front-end was made host-agnostic so one `ChatPanel` serves both local and remote surfaces via a synthetic webview host; every inbound remote frame is re-validated by the existing chat-message guard.
- **Security-first by default**: off unless enabled, localhost-only bind, pairing bearer token in `SecretStorage`, workspace-trust gate, audited connections, one-click revoke (token rotation), and default-deny of pending tool approvals on disconnect. See [[Remote Control]] and [[Security]].
- **Dual-target build**: added esbuild for the browser bundle (`out/web/extension.js`) alongside the existing `tsc` desktop/CLI output. New commands `atlasmind.remote.*` and settings `atlasmind.remote.enabled` / `atlasmind.remote.port`.

## v0.81.0 — On-Device Speech-to-Text (Whisper)

- **Local STT via whisper.cpp** (`src/voice/localTranscriber.ts`, `src/voice/voiceManager.ts`, `src/views/voicePanel.ts`): the Voice Panel transcribes speech entirely on-device. The webview captures the mic, encodes a 16 kHz mono WAV in-browser, and a host-side `LocalTranscriber` runs a local `whisper-cli`. Audio never leaves the machine; only the model (and, on Windows x64, the CLI) are downloaded on first use, each SHA-256-verified over HTTPS. New settings `atlasmind.voice.sttEngine` (`auto`/`webspeech`/`local`) and `atlasmind.voice.whisperCliPath`; macOS/Linux need an installed `whisper-cli` (e.g. `brew install whisper-cpp`). Web Speech remains the fallback.

## v0.80.0 — On-Device OS Speech Engine, Voice Panel Fixes, and Testing Matrix Correction

- **Host-side OS speech engine for TTS** (`src/voice/hostSpeechSynthesizer.ts`, `src/voice/voiceManager.ts`): AtlasMind can now speak using the operating system's built-in engine (Windows SAPI via PowerShell, macOS `say`, Linux `espeak-ng`) entirely on-device — no network, no API key — and even when the Voice Panel is closed. Enable it with `atlasmind.voice.hostSpeechEnabled`. Backend priority is ElevenLabs (when keyed) → OS host engine → in-panel Web Speech. Spoken text is delivered over stdin and never placed on a command line.
- **ElevenLabs playback unblocked** (`src/views/webviewUtils.ts`): added a `media-src` directive to the shared webview CSP so the `blob:` audio used for ElevenLabs server-side TTS can actually play. Previously it fell back to `default-src 'none'` and was blocked, with the Web Speech fallback hiding the failure.
- **Voice device and voice-id preferences persisted** (`package.json`, `docs/configuration.md`, `wiki/Configuration.md`): registered the `atlasmind.voice.inputDeviceId`, `atlasmind.voice.outputDeviceId`, and `atlasmind.voice.elevenLabsVoiceId` settings. They were read/written in code but unregistered, so device selections silently failed to save and the ElevenLabs voice id always defaulted to the demo voice.
- **Testing Methodology Matrix detection algorithm fixed** (`src/core/testingConfigLoader.ts`): the single-loop detection that mixed wildcard and specific signals caused `tdd` (first definition, wildcard `'*'`) to shadow all concrete methodologies. Restored two-pass detection: specific signals first, wildcard fallback only for testing roles. `e2e`, `continuous`, `bdd`, `security-testing` and all other specific-signal methodologies now fire correctly.
- **27-test suite for `TestingConfigLoader`** (`tests/core/testingConfigLoader.test.ts`): covers inference for all role types, specific-signal priority over wildcard, false-positive prevention for non-testing tasks, model override resolution, and system-prompt hint generation.

## v0.79.2 — Autonomous Run Context Continuity and Compression Savings

- **Autonomous run context continuity** (`src/core/orchestrator.ts`, `src/chat/participant.ts`): project subtasks now carry the session context bundle so long runs keep goal, summary, decisions, SSOT excerpts, and open threads between subtasks.
- **Context compression toggle** (`package.json`, `src/core/orchestrator.ts`, `src/core/costTracker.ts`): `atlasmind.contextCompressionEnabled` opt-in setting; savings reported in exec summary and cost dashboard.

## v0.78.6 — CI Lockfile and ESLint v10 Fix

- **`npm ci` failure on CI** (`package-lock.json`, `src/types.ts`): lockfile regenerated to match the 0.78.3 tooling upgrades. `@typescript-eslint/ban-types` (removed in v8) replaced with `@typescript-eslint/no-empty-object-type` in `src/types.ts`.

## v0.78.5 — Package Build Fix

- **`engines.vscode` alignment** (`package.json`): bumped `engines.vscode` from `^1.95.0` to `^1.116.0` to match the `@types/vscode` devDependency version and unblock `vsce package`.

## v0.78.4 — Local Provider Panel Refresh Fix

- **Local provider not showing after save** (`src/views/modelProviderPanel.ts`): The Model Providers panel now subscribes to the `modelsRefresh` event, so it reloads automatically when a local endpoint (LM Studio, Ollama, etc.) is saved in the Settings panel. The endpoint was always persisted correctly — the panel just wasn't listening for the update signal.

## v0.78.1 — Documentation Policy in project_soul.md

- **Documentation policy section in `project_soul.md`**: the bootstrap end-of-response checklist directive and documentation maintenance table are now embedded directly in `project_soul.md` as a `## Documentation Policy` section. This makes the policy visible to AtlasMind agents at plan and execution time via the SSOT. `CLAUDE.md` retains the same table for Claude Code users. Manifest file detection (package.json, Cargo.toml, etc.) is inferred from the captured tech stack and shared between both outputs.

## v0.78.0 — Bootstrap CLAUDE.md Generation

- **CLAUDE.md generated on bootstrap**: the `/bootstrap` command now creates a `CLAUDE.md` at the workspace root when none exists. The generated file is populated from intake answers (project name, type, tech stack, audience, timeline, primary outcome) and includes the full documentation maintenance policy: the end-of-response checklist directive and the documentation table. The version manifest row (e.g. `package.json`, `Cargo.toml`, `pyproject.toml`) is inferred from the captured tech stack. Existing `CLAUDE.md` files are never overwritten.

## v0.77.3–0.77.4 — Dynamic Skill Catalog and Git Tool Fixes

- **Dynamic skill catalog in the project planner** (`src/core/planner.ts`): the hardcoded skill whitelist in the planner prompt has been replaced with a live catalog built from the `SkillsRegistry` at plan time. Every enabled skill — all git skills (`git-push`, `git-branch`, `git-log`, `git-status`, `git-diff`, `git-blame`, `git-apply-patch`, `git-commit`), user-registered skills, and connected MCP tools — is now automatically visible to subtask agents. The planner also explicitly instructs agents to prefer dedicated skills over `terminal-run` for operations where a specific skill exists.
- **`git-commit` fixes**: message is now passed as a typed parameter directly to `execFile`, eliminating the "pathspec did not match" errors that occurred when commit messages were routed through `terminal-run`'s naive shell-string parser. Added optional `stage_tracked: true` parameter to run `git add -u` before committing.
- **`terminal-run` quoted-argument parsing**: replaced the naive `split(/\s+/)` splitter with a POSIX-aware tokeniser (`splitShellCommand`) that correctly handles single-quoted, double-quoted, and backslash-escaped arguments — so commands like `gh pr create --body "multi word body"` no longer break.

## v0.77.2 — Bootstrapper Routine Extraction and Chat Routine-Edit Intent

- **Bootstrapper routine extraction**: `/import` now scans `CLAUDE.md`, `.github/copilot-instructions.md`, and `docs/development.md` for ordered procedure sections and writes a starter routine file to `project_memory/routines/<id>.md`. Steps are extracted from numbered list items with a **Label** and a backtick-quoted `command`; `<angle-bracket-placeholders>` become `${VAR}` interpolation tokens. Manual edits to routine files are detected via body fingerprint and preserved — the file is never overwritten. After writing, `RoutineRegistry` is reloaded so the new routine is immediately available to `/ship`.
- **Chat routine-edit intent**: freeform messages like "edit the ship routine" or "update my publish routine" now open the matching routine's source `.md` file directly in the VS Code editor, bypassing the LLM. AtlasMind matches the routine name or ID from the prompt, falls back to the default, and explains how to scaffold one via `/import` if no routines exist.

## v0.77.0–0.77.1 — Project Routines and `/ship` Command

- **Project Routines**: named, executable workflows stored as YAML-frontmatter `.md` files in `project_memory/routines/`. The registry scans on startup; the runner executes steps sequentially with `on_fail: abort | prompt | continue` policies and persists run results to ProjectRunHistory.
- **`/ship` command**: runs the default routine (or a named routine via `/ship <id>`). Trailing text is passed as `${message}` for commit message interpolation. Each step streams a live checklist into chat.
- **Run Routine card in Project Run Center**: routine tiles replace the dropdown, matching the panel's run-card design language. Each tile has a Ship button and an Edit button that opens the source file.

## v0.76.0 — AI Instruction Sync and Agent Quality Improvements

- **AI instruction sync** (`src/utils/aiInstructionSync.ts`): AtlasMind detects AI instruction files from 9 other tools in the open workspace (GitHub Copilot, Claude Code, Cursor, Cline, Continue, OpenAI Codex, Gemini CLI, Windsurf, Aider) and surfaces a nudge banner in the chat panel. Clicking **Sync** merges selected files into `project_memory/domain/ai-instructions-sync.md` as advisory context; Personality Profile settings take precedence. Path traversal is rejected at both scan and write time.
- **Orchestrator default prompt**: agents now read project memory, `CLAUDE.md`, or `README.md` before invoking executable skills when answering knowledge questions ("what is the publish policy?", "how do we branch?").
- **npmScripts skill**: description clarified to distinguish execution from knowledge queries; added routing hints and a 120-second timeout.

## v0.75.x — Testing Methodology Overhaul (0.74.0 → 0.75.8)

AtlasMind's testing system was rebuilt from a single TDD default into a full 23-methodology strategy registry. Changes shipped across eight patch releases:

- **23-methodology registry** (`src/types.ts`): each methodology carries label, description, category, *When to use*, *Key tools*, *Trade-offs*, `autoDetectSignals`, and a new **AI token impact** level (Low / Medium / High) with explanation. Categories: Design-time (TDD, BDD, ATDD, SDD, V-Model), Structural (Unit, Integration, Mutation, Property-Based, Continuous/Shift-Left, White-Box), Behavioral (E2E, Snapshot, Contract, MBT, Test Design Techniques, Black-Box, Gray-Box), Non-functional (Performance, Security, Visual Regression), Exploratory (Exploratory, Agile Testing).
- **Settings Panel → Testing tab**: full 23-row methodology matrix with enable/disable toggles, expandable ⓘ info rows (When to use / Key tools / Trade-offs / **AI token impact** badge), per-methodology agent assignment dropdown, model override input, and notes field. Colour-coded token impact badges: green = Low, amber = Medium, red = High.
- **Auto-assess project button**: scans the workspace (package.json deps, test config files, CI pipeline configs, UI source files, OpenAPI/Swagger specs, `SECURITY.md`, git contributor count, README) and signal-matches against each methodology's `autoDetectSignals` to recommend a pre-selected set via an Auto / Manual / Skip QuickPick.
- **Project Dashboard → Testing page**: live methodology toggle matrix with immediate save to `project_memory/index/testing-config.json`.
- **Agent Editor → Testing Roles section**: read-only methodology chips for assigned methodologies plus per-methodology model override inputs.
- **Bootstrap and import**: Auto / Manual / Skip picker presented before the methodology list; Auto mode pre-selects inferred methodologies; Skip defaults to TDD + Unit.

## v0.73.5 — GitHub Operator: Chained Ops, Auto Commit Messages, Policy Awareness, and Publish Routine

- **`github-operator` system prompt overhaul** (`src/runtime/core.ts`): the built-in GitHub Operator now executes chained git instructions ("commit and push") sequentially in a single turn; auto-generates conventional commit messages from `git diff --staged --stat` when none is supplied; derives push-target branch, protected-branch rules, release-hygiene requirements, and publish routine from the injected workspace context (populated by the AI Instructions sync from CLAUDE.md, `.github/copilot-instructions.md`, or equivalent) rather than reading project files at runtime.
- **Planner chained-op and release-hygiene rules** (`src/core/planner.ts`): two new `PLANNER_SYSTEM_PROMPT` rules direct the planner to model "commit and push" patterns as sequential subtasks with explicit `dependsOn` ordering, and to insert a release-hygiene subtask (version bump + changelog) before commit subtasks in projects that require it.

## v0.73.1 — Audit Gap Resolution: Secret Redaction, Context Guard, Smooth Routing, and Feedback Loop

- **Secret redactor** (`src/utils/secretRedactor.ts`): new pattern-based scanner strips Anthropic/OpenAI/GitHub keys, bearer tokens, PEM private keys, DB connection strings, and generic key/secret assignments from memory context and live evidence before they reach any LLM provider API.
- **`max_tokens` guard**: the agentic loop now clamps `maxTokens` per iteration to `contextWindow − estimatedInputTokens − 1024` so completions can't overflow the model's context window as conversation history grows.
- **`ProviderId` extensibility**: `| (string & {})` appended to the union so new providers register without touching `types.ts`.
- **Outcome feedback loop**: `ModelRouter.recordModelOutcome()` accumulates fractional preference votes from real task outcomes (not only manual thumbs), feeding execution results back into future routing decisions.
- **Smooth context-window gradients**: `scoreTaskFit` context-window penalties now linearly interpolate instead of applying binary cliff penalties, so future large-context models are correctly rewarded.
- **New routing constants**: `CONTEXT_SAFE_OUTPUT_MARGIN` and `PERFORMANCE_OUTCOME_WEIGHT` extracted to `src/constants.ts`.

## v0.73.0 — Chat and Orchestration Audit: 9-Batch Hardening Pass

- **Messages loop pruning**: the agentic loop evicts the oldest assistant + tool-result pair when message count exceeds `MAX_LOOP_MESSAGES`, preventing unbounded context growth.
- **Mid-flight budget check**: the orchestrator checks the daily budget cap after each tool-result accumulation and aborts early with a clear message if the limit would be exceeded.
- **Deprecation tombstoning**: model-not-found / deprecated errors during completion are recorded as model failures and emit a progress message, matching the billing-error path.
- **Synthesize-agent retry**: `synthesizeAgentForTask` retries once with a cheap/fast fallback before caching a synthesis failure.
- **Retry-After header**: Anthropic 429 responses now use the server-provided `Retry-After` delay instead of pure exponential backoff.
- **`ANTHROPIC_API_VERSION` constant**: all three hard-coded API version literals replaced with a single overridable constant.
- **Local capability inference expanded**: `inferLocalCapabilities` now detects extended-thinking, vision, and tool-calling models from name patterns; default context window raised from 8 K to 32 768.
- **Checkpoint size guard**: `readSnapshot` skips files over 512 KB to prevent OOM crashes on large repositories.
- **Tool policy name-based classification**: unknown tools with read-like name prefixes are classified `read/low` rather than defaulting to `network/high`.
- **Frustration settings bidirectionality**: boosted carry-forward settings are automatically restored after 30 minutes if no further frustration signal fires and the user hasn't manually adjusted the values.
- **Named router scoring constants**: all magic numbers in `ModelRouter` scoring are extracted to documented named constants.
- **Extended `ModelCapability` and `SpecialistDomain` unions**: new tags for `extended_thinking`, `structured_output`, `computer_use`, `audio`, `real-time-video`, and `scientific-computing`; new `ModelInfo` fields `thinkingTokenMultiplier` and `deprecatedAt`.

## v0.72.2 — Workspace-Relative Path Fix

- **`assertInsideWorkspace` path resolution** (`src/extension.ts`): relative paths (e.g. `web/src/pages`) passed to skill tools such as `directory-list`, `file-read`, and `file-write` were resolved against the process CWD rather than the workspace root, causing false "outside workspace" rejections. Fixed to resolve relative to `workspaceRoot`; all callers use the returned absolute path for the actual operation.
- **`directory-list` description** (`src/skills/directoryList.ts`): updated `path` parameter description to explicitly state that workspace-relative paths are accepted.

## v0.68.4 — Local Model Scan Always Available

- The "Scan & Recommend" panel in Settings no longer blocks with an error when the extension context has not fully initialised. Hardware detection and local runtime discovery now proceed unconditionally; usage-based scoring is skipped (scores fall back to hardware/release baseline) when no cost records are available yet.

## v0.68.2 — Local Model Advisor And Webview Bootstrap Hardening

- Added the Local Model Advisor in Settings with release-aware local model recommendations, hardware-aware ranking, and install/remove workflows for Ollama plus LM Studio guidance.
- Added a data-driven local recommendation registry with optional `.atlasmind/local-model-recommendations.json` overrides and fallback to built-in candidates.
- Added focused provider tests for registry override parsing and fallback behavior, plus an explicit CI quality gate for `npm run test:providers:local-recommendations`.
- Hardened chat panel startup to fail safely when required webview DOM nodes are missing.
- Updated dashboard and shared webview shell loading/CSP behavior to reduce `InvalidStateError` service-worker bootstrap failures in debug-host startup scenarios.
- Set sidebar chat view webview registration to avoid retained-context restore and deferred chat initialization by one event-loop tick to reduce startup races.

## v0.67.7 — Cross-Session Bleeding Fix

- **Simultaneous chat sessions no longer bleed into each other**: When the sidebar Chat View and the detached Chat Panel were both running prompts concurrently, each session's streaming responses were appearing in the other. The fix ensures each concurrent run gets its own isolated session and eliminates spurious syncState cascades caused by redundant `selectSession` events.

## v0.67.6 — Self-Managing SSOT Memory

- **"Project memory needs update" banner removed**: The Memory sidebar no longer shows a manual-review warning when imported entries go stale. The MemoryManager now auto-runs the import pipeline silently on activation and SSOT reload. The `Update Project Memory` command remains available on-demand from the command palette and view toolbars.

## v0.67.1 — Provider Refresh And Notification Acknowledgement

- **Immediate post-credential model discovery**: Saving API-key-backed provider credentials now forces a provider model refresh before the health pass, so the Models sidebar and router immediately show the provider's discovered catalog instead of waiting for a later refresh.
- **Dismissible auto-paused provider badge**: The Models view now exposes a dismiss action for auto-paused provider notifications. Acknowledging the badge clears the session warning state but leaves the affected providers disabled until the user re-enables them explicitly.

## v0.63.0 — AI Instructions Sync

- **AI Instructions page in Settings**: Scan the workspace for instruction files from GitHub Copilot, Claude Code, Cursor, Cline, Continue, OpenAI Codex, Gemini CLI, Windsurf, Aider, and more. Found files appear with a content preview and checkboxes. Confirming the selection merges chosen sets into `project_memory/domain/ai-instructions-sync.md` for automatic context inclusion.

## v0.62.0 — Dynamic Agent Routing Overhaul

- **`primaryRoutingNeeds`** field on `AgentDefinition`: every built-in specialist now self-declares its domain. The orchestrator gives these declarations +25 pts per matched need (LLM) or +15 pts (regex), making them the dominant selection signal.
- **`fromLlm`** flag on `ClassificationResult`: the classifier now reports whether its output came from an LLM call or the regex fallback, enabling trust-weighted routing need scoring.
- **`scoreAgent()` fixed**: system prompt tokens are no longer included in the base score. The UX Consultant's large prompt was causing it to win on almost every technical query.
- **Routing need corpus narrowed**: pattern matching against agent header only (role, description, skills); system prompt excluded to prevent false positive boosts.
- **`architecture` agentPattern tightened**: removed generic terms `design`, `structure`, `systems` that were causing UX Consultant to incorrectly receive an architecture routing need boost.

## v0.67.0 — Project Run Reliability & File-Writing Agents

- **Project runs no longer hang**: `AbortSignal` from VS Code's `CancellationToken` is now threaded through the full pipeline (planner → subtask execution → synthesizer). Cancellation terminates the pipeline immediately and shows a clear "_Project run cancelled._" message.
- **No more double-planning**: The preview plan is reused as `planOverride` inside `processProject`, eliminating the redundant second LLM call and the duplicate plan table.
- **Real token counts in project footers**: `synthesize()` and every `SubTaskResult` now track `inputTokens`/`outputTokens`. The chat footer shows `N in / M out` and the session transcript is written via `recordTurn()` so follow-up context works.
- **Subtask agents can now edit files**: Nine built-in workspace tools (`file-read`, `file-write`, `file-edit`, `file-search`, `memory-query`, `memory-write`, `test-run`, `terminal-run`, `workspace-observability`) are registered on Orchestrator startup. These are the exact IDs the planner assigns to subtasks, so agents now actually write code to disk instead of printing it as chat text.

## Unreleased

- Added a background SSOT memory self-healing loop that runs during activation and while the workspace remains open, so warned and blocked memory entries can be remediated automatically.
- Updated dedicated chat-panel tool activity to render inside the inner-monologue surface with latest-first display by default and a collapsible history for earlier updates.
- Memory self-healing now quarantines blocked SSOT entries into `temp/quarantine/*.blocked.txt.bak`, replaces blocked files with safe placeholders, sanitizes warned entries (hidden Unicode, suspicious instruction-like comments, secret-like values), and reindexes memory automatically.

## v0.61.4 — Agent Skills Auto-Management Refresh

- Expanded the agent skills auto-management experience and supporting runtime behavior.
- Refreshed related tests, docs, and SSOT memory snapshots so the shipped documentation matches the current implementation.

## v0.61.3 — Documentation Sync Guardrail

- Restored the README source-version banner so it matches `package.json` again
- Added a regression test that enforces the changelog title and README version banner so both docs stay in sync
- Tightened the release/docs guidance so README and mirror documentation are updated together when versioned changes land

## v0.57.10 - SSOT Sessions Folder Documentation Alignment

- Documented the internal `project_memory/sessions/` folder in SSOT structure docs and clarified it stores per-session chat context.
- Clarified that `sessions/` is intentionally excluded from normal SSOT retrieval/index operations to keep ephemeral runtime context separate from durable project memory.

## v0.57.9 — Release Metadata Sync

- Added deterministic SSOT auto-linking between sibling artifacts in paired folders (`decisions/ <-> roadmap/`, `architecture/ <-> operations/`) during memory indexing and upserts.
- Capped `relatedPaths` density and re-applied auto-linking on upserts so new sibling artifacts become discoverable through one-hop expansion immediately.

## v0.57.8 - Memory Relationship Overlay and One-Hop Retrieval

- Added optional `MemoryEntry.relatedPaths` links so SSOT entries can declare explicit neighbor artifacts.
- Added bounded one-hop neighbor expansion in `MemoryManager.queryRelevant()` and `queryWithOptions()` when result slots remain.
- Brought `NodeMemoryManager` behavior in line with VS Code host memory retrieval for related-path parsing and one-hop expansion.
- Fixed memory import trailer parsing for optional `related-paths` metadata.

## v0.57.7 - Chat Tool Execution Rendering and Changelog Integrity Fixes

- Removed duplicated nested busy/status handlers in `media/chatPanel.js` that caused unstable history rendering.
- Replaced regex-based `[TOOL_EXEC]` parsing with brace-depth JSON extraction for nested tool metadata reliability.
- Removed duplicated `recoveryNotice` template markup and repaired tool-history CSS block placement in `src/views/chatPanel.ts`.
- Repaired malformed and duplicated `0.57.3`/`0.57.4` changelog sections from prior edits.

## v0.57.2 ÔÇö Version bump

- **Copilot quota hard-stop fixed**: `"exhausted your premium model quota"` errors are now recognised as billing failures, triggering provider auto-pause and graceful failover instead of a hard error.
- **`review` no longer escalates to Opus**: Removed bare `review` from `HIGH_REASONING_HINTS`; `code review` is still treated as high-reasoning. Lightweight reads like "review the roadmap" now route to a cheap/fast model.

## v0.57.1 - Copilot Quota Failover and Routing Over-Escalation Fix

- **Copilot quota hard-stop fixed**: `"exhausted your premium model quota"` errors are now recognised as billing failures, triggering provider auto-pause and graceful failover instead of a hard error.
- **`review` no longer escalates to Opus**: Removed bare `review` from `HIGH_REASONING_HINTS`; `code review` is still treated as high-reasoning. Lightweight reads like "review the roadmap" now route to a cheap/fast model.

## v0.57.0 ÔÇö ClassifierService: LLM-Backed Routing, Domain Detection, and UI Command Routing

- **`ClassifierService`**: New service (`src/core/classifierService.ts`) that runs a single batched LLM call per request ÔÇö cheap/local-first via the `completeMaintenance` path ÔÇö answering all routing questions at once: specialist domain, routing needs, modality, reasoning depth, workspace bias, and UI command. Replaces ~50 per-request regex tests. Degrades gracefully to regex fallback when no model is available.
- **`Orchestrator.classify()`**: Public method that exposes classification to participant.ts and other extension-layer callers without duplicating construction.
- **`resolveSpecialistRoutingPlanWithClassifier()`**: Async variant of specialist routing in `participant.ts` that replaces 6 domain regex patterns and the 20-entry `NATURAL_LANGUAGE_COMMAND_INTENTS` array with a single classifier call. Falls back to sync regex on failure.
- **Context-aware downstream routing**: `selectAgent`, `buildMessages`, and `TaskProfiler.profileTask` all read the `__classification` result from context instead of re-running regex, ensuring one call per request.

## v0.56.0 ÔÇö Universal Prompt Decomposition, Multi-Step Execution, and Robust Error Recovery

- **Universal prompt decomposition**: All freeform chat prompts are now classified for multi-action intent using a fast cheap LLM (via `completeMaintenance`). When two or more distinct separable actions are detected, AtlasMind decomposes the prompt into a Planner DAG and executes each step with streaming progress ÔÇö no `/project` command required.
- **`processTaskMultiStep`**: New orchestrator method that decomposes, schedules, and streams subtask results incrementally, falling back to a single-step plan on planner failure.
- **Robust error recovery**: All chat modes (freeform, native chat, vision) now retry once with a simplified prompt on failure, then surface actionable feedback (credits, network, no model) instead of raw exceptions.
- **Subtask auto-retry**: `executeSubTask` retries on transient provider errors and empty/capped responses before marking a step failed.

## v0.53.7 ÔÇö Dev Tooling Upgrade

- vitest 2ÔåÆ4, eslint 9ÔåÆ10, TypeScript 5ÔåÆ6 ÔÇö all 890 tests pass, zero lint warnings.
- Token count formatting pinned to `en-US` locale for consistent CI output across all platforms.

## v0.53.6 ÔÇö Live Local Model Sync

- New `src/providers/localModelSync.ts` queries Ollama and LM Studio on activation, extracting real context windows, parameter counts, and quantisation from the live API. Results cached with 1-hour TTL and applied as highest-priority metadata.
- Local provider pricing always forced to zero in `inferModelMetadata` ÔÇö no more cloud pricing heuristics leaking into local models.

## v0.53.5 ÔÇö Local Model Static Catalog

- `LOCAL_CATALOG` added to `modelCatalog.ts` covering 30+ common Ollama model families (Gemma 3, Nemotron, Devstral, Mistral, Qwen 2.5/3, Llama 3, Phi, DeepSeek R1 distills, Codestral, Command R). All entries have zero pricing and accurate capability flags.
- `inferCapabilities` updated so small local models don't get `function_calling` by default.

## v0.53.4 ÔÇö Local Model Routing Fixes

- `scoreLocalPreference` replaced with capability-gated graduated bonus (max +0.4), eliminating over-preference for weak local models.
- `classifySpeedTier` now returns `'balanced'` for local models so they are not excluded from `speed: 'considered'` routing.
- `shouldPreferLocalToolCapableModelForPrompt` tightened: threshold 8 ÔåÆ 5 words, complexity verbs and scope words now suppress local-first routing.

## v0.53.3 ÔÇö Failover And Agent Prompt

- `selectProviderFailoverModel` rewritten to step through budget/speed tiers incrementally rather than immediately jumping to expensive/considered.
- `DEFAULT_AGENT_SYSTEM_PROMPT` now names specific files per change type rather than giving vague release-hygiene guidance.

## v0.53.2 ÔÇö Documentation Matrix Fixes

- `CLAUDE.md` and `.github/copilot-instructions.md` doc matrix now includes `docs/configuration.md` for settings changes and `README.md (version banner)` for version bumps.
- Architecture docs updated for CurrencyFormatter, CopilotMultiplierSync, LocalModelSync.

## v0.52.9 ÔÇö Changelog Guardrail

- Restored the missing CHANGELOG title and intro block so release notes keep their expected structure
- Added an automated regression check and authoring guidance so future edits preserve the heading

## v0.52.9 ÔÇö Release Hygiene And Merge Reliability

- Restored the changelog heading guardrails and kept the protected merge gate stable across integration auditing, default-agent fallback behavior, and cross-platform verification
- Atlas also preserves the recent paste-handling and tool-failure recovery improvements included in this release line

## v0.52.6 ÔÇö Integration Audit Restore

- Restored the missing integration-monitor manifest so the protected CI release gate can validate extension, provider, and specialist coverage again

## v0.52.5 ÔÇö CI Release Cleanup

- Cleared the release-blocking lint issues across the command, environment, chat, dashboard, and testing surfaces so the protected master promotion flow can pass cleanly

## v0.52.4 ÔÇö Intent Routing And Release Hygiene

- Tightened Atlas chat intent handling so prompts about missing version or changelog updates stay on the corrective workspace-action path instead of collapsing into a simple version reply
- Hard-coded release-hygiene guidance into the default agent prompt so version bumps, changelog updates, and related docs are treated as part of completing the work when repo policy requires them

## v0.52.3 ÔÇö Search And Stop Reliability

- Repaired the search jump helpers so previous and next arrows can move through results reliably again
- Wired prompt cancellation through the active chat execution path so Stop can interrupt answer generation more reliably

## v0.52.2 ÔÇö Search Centering And Jump Fix

- Active search results now center themselves in the transcript and outline the containing bubble for clearer orientation
- Previous and next arrows now produce a stronger visual jump between matches

## v0.52.1 ÔÇö Session Search Recovery

- Repaired the in-thread search path so Search no longer stalls on a perpetual running message
- Kept multi-result navigation responsive with visible arrows and active highlight movement inside the transcript


## v0.51.9 ÔÇö Live Gap Analysis Chat Sessions

- Gap Analysis now opens a fresh Atlas chat session and reports progress there while it works
- The completed checklist is saved back into the Project Dashboard automatically

## v0.51.9 ÔÇö Search Navigation And Count Fix

- Session search now counts matches from the visible rendered transcript so totals align with what the operator sees
- Added previous and next result arrows beside Search for direct in-thread navigation across multiple matches

## v0.52.0 ÔÇö Prioritized Gap Analysis Reports

- Gap Analysis now produces a richer project report with grouped P1, P2, and P3 findings across architecture, safety, functionality, UI/UX, memory, code structure, testing, and delivery
- Each gap can now open its own live Atlas chat resolution session, and whole priority groups can be actioned at once

## v0.51.8 ÔÇö Instant Session Search Repair

- Session search now runs immediately against the current in-memory thread so small conversations respond instantly
- Restored match highlighting and transcript scrolling without getting stuck on a perpetual searching state

## v0.51.7 ÔÇö Session Search Feedback Fix

- Pressing Search in the chat panel now immediately shows a running status and a clear found-or-not-found result message
- Reconnected the search toggle to the live webview controls so session search mode behaves reliably

## v0.51.6 ÔÇö Chat Bubble Delete Refresh

- Replaced the header X delete control with a minimalist footer trash icon beside the chat vote actions for a cleaner transcript layout
- Preserved in-thread message deletion while reducing visual clutter in each bubble

## v0.51.7 ÔÇö Live Gap Analysis Sessions

- Gap Analysis now opens a fresh Atlas chat session and reports progress there while it works
- The completed checklist is written back into the Project Dashboard automatically

## v0.51.6 ÔÇö Gap Analysis Trigger Feedback

- Gap Analysis now opens its dashboard page immediately and shows live progress while it runs
- Fixed the silent-looking trigger behavior from the Project Dashboard

## v0.51.5 ÔÇö Project Dashboard Recovery

- Restored the Project Dashboard after the new Gap Analysis work injected broken panel and webview code that stopped the dashboard from opening
- Safely reconnected the Gap Analysis page, actions, and snapshot parsing so the dashboard loads again

## v0.49.37 ÔÇö Chat Focus Guard

- Guarded automatic Atlas chat composer focus restoration so transcript refreshes no longer steal the editor cursor after the user clicks back into another VS Code surface

## v0.49.36 ÔÇö Testing Policy Card

- Added a dedicated Testing policy highlight card to the Project Dashboard beside the framework and coverage stats
- Added an optional workspace override label so teams can show their own tests-first wording without changing AtlasMind's verification safeguards

## v0.49.36 ÔÇö In-Chat Generated Skill Review

- Warning-level generated-skill reviews now appear in the AtlasMind in-chat approval stack instead of a separate modal flow
- The approval card now shows the warning context and a focused one-time Allow Once versus Keep Blocked choice

## v0.49.35 ÔÇö Generated Skill Review Gate

- Auto-generated skills that hit warning-level scanner findings now pause for explicit user approval before AtlasMind evaluates them in-process
- Added a review-first path so operators can inspect the draft and either allow it once or keep it blocked for refinement

## v0.49.34 ÔÇö Project Dashboard Testing Explorer

- Moved the main testing inventory into the Project Dashboard so test health is shown alongside runtime, delivery, and SSOT signals
- Added searchable and category-grouped per-test browsing with a jump dropdown plus a detail inspector that opens the relevant source file at the right line

## v0.49.33 ÔÇö MCP Intent Heuristics And Memory Recall

- AtlasMind now derives natural-language routing cues for third-party MCP tools, biases tool selection toward the most likely match for prompts like ÔÇ£commitÔÇØ, and asks for clarification when multiple tools look similarly plausible
- Successful natural-language-to-MCP resolutions are now written into project memory so future turns can reuse that learned mapping

## v0.49.32 ÔÇö Keyboard Rename In Sessions

- Made F2 rename use the currently focused Sessions sidebar item so keyboard rename now works reliably for chat threads and session folders

## v0.49.31 ÔÇö Marketplace Badge Replacement

- Replaced the external README Marketplace badge with a plain version callout so the extension page no longer shows a broken or retired badge placeholder in VS Code surfaces

## v0.39.7 ÔÇö Immutable Guardrails Baseline

- Added a non-overrideable legal and human-respect baseline to built-in and routed AtlasMind agent prompts
- Restricted jurisdictionally ambiguous legal asks to safe high-level guidance and blocked person-targeted harmful, defamatory, or deceptive assistance in generated tools

## v0.39.6 ÔÇö Sidebar Default Order

- Reordered the default AtlasMind sidebar tree views to Project Runs, Sessions, Memory, Agents, Skills, MCP Servers, and Models
- Set those tree views to ship collapsed by default while keeping stable view ids so VS Code continues remembering each user's custom order and open-state preferences

## v0.39.6 ÔÇö Sidebar Quick Actions

- Added title-bar shortcuts for Settings, Project Dashboard, and Cost Dashboard across the Chat, Sessions, and Memory sidebar views
- Switched the project-memory toolbar action between `Import Existing Project` and `Update Project Memory` based on whether AtlasMind has detected workspace SSOT state

## v0.39.4 ÔÇö Command Naming Guardrails

- Hid the remaining unprefixed session actions from the Command Palette and added a manifest-level guard so unprefixed command titles stay view-local
- Split the README command reference into explicit Command Palette and Sidebar Actions sections

## v0.39.3 ÔÇö Command Surface Cleanup

- Hid sidebar-only actions from the Command Palette so palette-visible AtlasMind commands stay reserved for top-level entry points
- Split the command docs between palette-facing AtlasMind commands and view-local sidebar actions

## v0.39.2 ÔÇö Persistent Memory Drift Signal

- Added a pinned warning row at the top of the Memory tree so stale imported SSOT remains visible while browsing entries
- Treated legacy `#import` SSOT files without Atlas metadata trailers as stale imported memory so older projects also surface the refresh signal

## v0.39.2 ÔÇö Skills Panel Folders

- Grouped built-in skills into sidebar categories so the bundled set no longer expands as one flat list
- Added persistent custom skill folders, including a Skills title-bar `Create Skill Folder` action and folder-aware add/import flows
- Added `F2` rename support for highlighted chat-session rows in the Sessions sidebar

## v0.39.0 ÔÇö Filed Session Sidebar

- Added persistent folders to the Sessions sidebar so related chat threads can be filed together instead of staying in one flat list
- Added an inline rename action on each session row plus move-to-folder and create-folder commands in the Sessions tree
- Moved the optional `Import Existing Project` toolbar shortcut from the Sessions view to the Memory view

## v0.38.22 ÔÇö Cost Dashboard Visual Refresh

- Reworked the Cost Dashboard to share the Project Dashboard's stronger visual language with a cleaner shell, animated metric cards, a more professional budget meter, and upgraded model and feedback panels
- Replaced the old checkbox and numeric day input with a topbar visibility toggle and chart-overlay time-range controls inside the Daily Spend panel
- Tightened summary-card layout so the primary spend metrics stay on one row instead of wrapping into a cluttered grid

## v0.38.21 ÔÇö Responsive Chat Sessions Rail

- Made the shared Atlas chat Sessions area responsive so it remains a top strip in narrow layouts and becomes a persistent left sidebar when the webview reaches 1000px wide

## v0.38.20 ÔÇö Dashboard Settings Compatibility

- Fixed the Project Dashboard refresh path so array-backed `autoVerifyScripts` settings from AtlasMind Settings no longer break the dashboard security snapshot
- Added regression coverage for the dashboard configuration compatibility path

## v0.38.19 ÔÇö Inline Chat Feedback Controls

- Moved assistant-response vote controls onto the same footer row as the thinking summary and aligned them to the right edge of the bubble
- Replaced emoji-style thumbs with compact outlined thumb icons for a quieter chat UI

## v0.38.18 ÔÇö Feedback-Aware Cost Dashboard

- Added Cost Dashboard feedback analytics showing per-model approval rate, thumbs totals, and spend on rated models
- Added `atlasmind.feedbackRoutingWeight` so thumbs-based routing bias can be disabled or tuned without clearing vote history
- Updated recent-request rows to show the recorded feedback state for each linked assistant response

## v0.38.17 ÔÇö Chat Session Header Fit

- Tightened the shared Atlas chat Sessions header so the new-session control stays inline with the label and no longer pushes the collapsible bar partly out of view

## v0.38.16 ÔÇö Cost To Chat Deep Links

- Added session-aware links from Cost Dashboard recent-request rows back to the matching chat transcript entry when the session still exists
- Stored optional chat session and message references with cost records so AtlasMind can reopen the exact assistant response that produced a charge

## v0.38.14 ÔÇö Memory Freshness Signals

- Added startup SSOT freshness checks for imported workspaces so AtlasMind can warn when generated memory has drifted behind the codebase
- Added an `Update Project Memory` Memory-view action that reruns the import pipeline against the latest workspace state
- Fixed import body fingerprint normalization so unchanged generated files are not treated as manually edited or permanently stale on later refreshes

## v0.38.13 ÔÇö Cost Dashboard Polishing

- Sent the Cost Dashboard budget shortcut to Settings ÔåÆ Overview with a budget-focused query instead of reopening the last active settings page
- Clarified the recent-requests table so the final column is explicitly the per-message request cost

## v0.38.11 ÔÇö Dashboard Reliability And Access

- Fixed the Project Dashboard loading path so git timeline collection no longer stalls the panel and failures render a visible error state instead of hanging on the loading screen
- Added a direct Project Dashboard action to the AtlasMind sidebar chat view title bar
- Restored clean TypeScript compilation after the project-memory bootstrap refactor left import-scan metadata incomplete

## v0.38.10 ÔÇö Subscription-Aware Cost Tracking

- Added subscription-aware cost accounting so only direct and overflow-billed requests count toward the daily budget while included subscription usage remains visible for analysis
- Upgraded the Cost Dashboard with adjustable day windows, an exclude-subscriptions toggle, and explicit per-request billing labels

## v0.38.7 ÔÇö Runtime Extensibility And Project Dashboard

- Added an explicit shared-runtime plugin API with lifecycle events and plugin contribution manifests for extension-host and CLI integrations
- Added the AtlasMind Project Dashboard surface with interactive pages for repo health, runtime state, SSOT coverage, security posture, delivery workflow, and review-readiness signals
- Hardened CLI argument parsing and expanded the architecture, development, contribution, and wiki guidance for runtime extensibility, diagnostics, and operational review

## v0.38.6 ÔÇö Final Observability Sync

- Synced the `v0.38.x` roadmap branch with the newly merged workspace-observability base changes so the terminal-reader, extensions/Ports, cost dashboard, and ElevenLabs work remains mergeable on top of the latest `develop` head

## v0.38.5 ÔÇö Final Roadmap Branch Sync

- Synced the `v0.38.x` roadmap branch with the latest `develop` EXA search, workspace observability, and settings-documentation updates while preserving the terminal-reader, extensions/Ports, cost dashboard, and ElevenLabs feature work

## v0.38.4 ÔÇö Settings Docs Sync

- Synced the `v0.38.x` roadmap branch with the latest `develop` settings-documentation updates so it stays mergeable on top of the new configuration hover-help work

## v0.38.3 ÔÇö Roadmap Branch Re-Sync

- Synced the `v0.38.0` roadmap-completion branch with the latest `develop` observability changes while preserving its terminal-reader, extension, Ports, dashboard, and ElevenLabs feature work

## v0.38.2 ÔÇö CI Workflow Repair

- Removed duplicate `if` keys from the CI workflow coverage steps so the `v0.38.x` roadmap branch can execute GitHub Actions normally again after the develop sync

## v0.38.1 ÔÇö Roadmap Branch Sync

- Synced the `v0.38.0` roadmap-completion branch with the latest `develop` fixes so the extension-skill, terminal-reader, Ports, cost dashboard, and ElevenLabs work remains mergeable on top of the newer review-cleanup and lint-gate repairs

## v0.38.0 ÔÇö Roadmap Goals Resolved

- **Terminal session readers** ÔÇö new `terminal-read` skill and `getTerminalOutput()` context method; informs AtlasMind which terminals are open and guides the user to paste content.
- **Test result file parsing** ÔÇö `workspace-state` skill now parses JUnit XML and Vitest/Jest JSON result files and includes pass/fail counts and coverage percentages in the workspace snapshot.
- **VS Code Extensions skill** (`vscode-extensions`) ÔÇö lists installed extensions with version and active state, tags top-50 popular extensions, filters by name, and reports forwarded ports from the VS Code Ports panel.
- **Cost Management Dashboard** (`atlasmind.openCostDashboard`) ÔÇö full-page webview with daily spend bar chart, per-model cost breakdown, budget utilisation bar, and recent-requests table.
- **ElevenLabs TTS integration** ÔÇö Voice Panel now uses ElevenLabs server-side audio synthesis when an API key is configured; falls back to Web Speech API.

## v0.37.4 ÔÇö Workspace Observability

- Added the `workspace-observability` built-in skill plus the supporting debug-session, terminal, and test-result host hooks with safe CLI fallbacks
- Hardened the observability path so missing host hooks degrade safely and test-result output remains bounded

## v0.37.3 ÔÇö Settings Docs Sync

- Synced the `v0.37.x` feature branch with the latest `develop` settings-documentation updates so the EXA search, observability, and CLI subcommand work stays mergeable on top of the new configuration hover-help changes

## v0.37.2 ÔÇö EXA And Observability Branch Sync

- Synced the `v0.37.0` feature branch with the latest `develop` fixes so the EXA search, observability, and CLI subcommand work stays mergeable on top of the newer review-cleanup and lint-gate repairs

## v0.37.0 ÔÇö Observability, EXA Search & CLI Dev Subcommands

- EXA AI search specialist runtime (`exa-search` skill)
- Debug session inspector skill (`debug-session`)
- Workspace state skill (`workspace-state`)
- CLI `build`, `lint`, and `test` subcommands with `--dry-run`, `--fix`, and `--watch` flags
- Amazon Bedrock model catalog expanded with 16 additional entries

## v0.36.26 ÔÇö Lint Gate Repair

- Replaced non-reassigned `let` declarations in the orchestrator task-attempt path so `develop` passes the current lint gate again

## v0.36.25 ÔÇö Review Cleanup Follow-up

- Removed the duplicate Tool Webhooks command entry from the wiki command reference and normalized provider registry indentation to the repo's standard TypeScript style

## v0.36.24 ÔÇö Review Follow-up Fixes

- Repaired the Project Run Center webview string assembly so its preview, run summary, and artifact views no longer generate invalid JavaScript
- Restored a nonce-only script policy for shared webviews, fixed broken CLI wiki links, and normalized the duplicated `v0.36.4` changelog history

## v0.36.23 ÔÇö Workspace Observability Compatibility Fix

- Added safe CLI fallback implementations for workspace observability context methods so the shared `SkillExecutionContext` contract is satisfied outside the VS Code host
- Adjusted workspace observability test-results access so the extension compiles cleanly even when the typed VS Code API surface does not expose a stable `testResults` property

## v0.36.22 ÔÇö Workspace Observability Skill

- Added `workspace-observability` built-in skill: snapshots the active debug session, open integrated terminals, and most recent test run results in one call
- Added `getTestResults()`, `getActiveDebugSession()`, and `listTerminals()` to `SkillExecutionContext`, backed by `vscode.tests`, `vscode.debug`, and `vscode.window.terminals`

## v0.36.21 ÔÇö Extension Interoperability Roadmap

- Expanded the roadmap to cover interoperability with the top 50 commonly used VS Code developer extensions, their interface surfaces such as Output and Terminal, Ports view support, and explicit safety boundaries for extension interaction

## v0.36.20 ÔÇö CI Artifact Upload Fix

- Restricted CI coverage generation and coverage artifact upload to the Ubuntu matrix leg, preventing duplicate artifact-name conflicts while preserving compile, lint, and test coverage across Ubuntu, Windows, and macOS
- Updated the developer-facing docs to reflect the actual CI matrix behavior and Ubuntu-only coverage artifact publishing path

## v0.36.19 ÔÇö CI Repair Follow-up

- Fixed the lint and TypeScript issues that were blocking CI on the protected develop-to-master promotion path

## v0.36.18 ÔÇö Observability Roadmap Additions

- Added roadmap items for workspace observability, debug-session integration, and safe output or terminal readers so AtlasMind can eventually reason over more of the active VS Code environment

## v0.36.17 ÔÇö Workstation-Aware Responses

- AtlasMind now includes workstation context in routed prompts so responses can default to the active environment, including Windows and PowerShell guidance inside VS Code when appropriate
- Added regression coverage for workstation-aware prompt context in native chat and orchestrator message building

## v0.36.16 ÔÇö Provider Failover

- AtlasMind now fails over to another eligible provider when the initially selected provider errors or is missing, instead of ending the task immediately on the first provider failure
- Added orchestrator regression coverage for cross-provider failover after provider-side errors

## v0.36.15 ÔÇö OpenAI Fixed-Temperature Compatibility

- OpenAI modern chat payloads now omit `temperature` for fixed-temperature model families such as GPT-5 and the `o`-series, preventing request failures on models that reject that parameter
- Added regression coverage to keep OpenAI modern, Azure OpenAI, and generic compatible providers on the correct parameter contract

## v0.36.14 ÔÇö Early Difficulty Escalation

- AtlasMind now detects repeated tool-loop struggle signals and can reroute once to a stronger reasoning-capable model instead of spending the full loop budget on a failing route
- Added regression coverage for bounded mid-task model escalation after repeated failed tool calls

## v0.36.13 ÔÇö Grounded Version Answers

- AtlasMind now answers version questions from the root `package.json` manifest instead of depending on model inference
- If the manifest is unavailable, AtlasMind falls back to SSOT memory so repo-fact answers still come from grounded project context

## v0.36.12 ÔÇö Provider-Specific OpenAI Compatibility

- Split OpenAI-family payload handling by provider so OpenAI and Azure use `developer` plus `max_completion_tokens`, while generic OpenAI-compatible endpoints retain `system` plus `max_tokens`
- Added regression tests to lock the expected contract for OpenAI, Azure OpenAI, and third-party OpenAI-compatible providers

## v0.36.11 ÔÇö OpenAI-Compatible Token Parameter Fix

- Updated OpenAI-compatible request payloads to send `max_completion_tokens` instead of `max_tokens`, resolving 400 errors from models that reject the legacy parameter
- Added regression coverage to verify AtlasMind no longer emits `max_tokens` in OpenAI-style chat completion requests

## v0.36.10 ÔÇö Terminal Tool Schema Validation Fix

- Fixed the built-in `terminal-run` tool schema so `args` is declared as an array of strings, resolving chat failures from OpenAI function schema validation
- Added a regression test to keep the terminal tool schema compatible with function-calling providers

## v0.36.6 ÔÇö CLI Safety Gate And Narrower SSOT Auto-Load

- AtlasMind CLI now allows read-only tools by default, requires an explicit `--allow-writes` flag before workspace or git writes are permitted, and blocks external high-risk tools in CLI mode
- Startup SSOT auto-load now trusts only the configured SSOT path or the default `project_memory/` folder instead of treating workspace-root marker folders as sufficient
- Added regression tests covering CLI tool gating and the tightened startup SSOT detection boundary

## v0.36.5 ÔÇö Import Freshness And Memory Purge Safeguards

- `/import` now records generator metadata, skips unchanged generated files on repeat imports, and preserves imported SSOT files that were manually edited
- AtlasMind now generates both `index/import-catalog.md` and `index/import-freshness.md` so memory refresh status stays reviewable
- The Project Settings page now exposes a destructive memory-purge action protected by a modal confirmation plus a required `PURGE MEMORY` confirmation phrase

## v0.36.4 ÔÇö MCP, Voice, And Vision Workspaces

- Reworked the MCP Servers, Voice, and Vision panels into the same searchable multi-page workspace pattern used by AtlasMind Settings and the other admin surfaces
- Added richer sidebar empty-state links so sessions, models, agents, MCP, and project runs can jump directly to the matching panel or settings page

## v0.36.3 ÔÇö Richer Project Import Baseline

- Expanded `/import` so it generates a deeper SSOT baseline from manifests, docs, workflow/security guidance, and a focused codebase map
- Import now upgrades the starter `project_soul.md` template when it is still blank so Atlas begins with a more useful project identity

## v0.36.2 ÔÇö Deep-Linked Panel Workspaces

- Reworked the Agent Manager and Tool Webhooks panels into searchable multi-page workspaces consistent with AtlasMind Settings and the provider surfaces
- Added page-specific settings commands so sidebar actions and walkthrough steps can open the exact chat, models, safety, or project settings page directly

## v0.36.1 ÔÇö Searchable Provider Workspaces

- Reworked the Model Providers and Specialist Integrations panels into searchable multi-page workspaces with grouped cards instead of single dense tables
- Added deep-linkable AtlasMind Settings navigation so provider surfaces can reopen Settings directly on the Models page

## v0.36.0 ÔÇö Shared Runtime And CLI

- Added a compiled `atlasmind` CLI with `chat`, `project`, `memory`, and `providers` commands backed by the same orchestrator and SSOT memory pipeline as the extension
- Introduced a shared runtime builder plus Node-hosted memory, cost, and skill-context adapters so AtlasMind can run outside the VS Code host without forking core logic

## v0.35.15 ÔÇö Accessible Settings Workspace

- Reworked AtlasMind Settings into a multi-page workspace with a persistent section nav instead of a long collapsible form
- Added faster in-panel shortcuts to the embedded Chat view, detached chat panel, provider management, and specialist integrations

## v0.35.12 ÔÇö Startup SSOT Auto-Load

- AtlasMind now auto-detects and loads an existing workspace SSOT during startup when the configured `atlasmind.ssotPath` is missing
- The Memory sidebar now refreshes immediately after startup indexing so existing project memory appears without a manual reload

## v0.35.5 ÔÇö Models Tree Refresh Action

- Added a refresh action on configured provider rows in the Models sidebar so routed model catalogs can be refreshed directly where missing models are noticed

## v0.35.4 ÔÇö Follow-Up Routing Escalation Fix

- Adjusted routing so important thread-based follow-up turns can escalate away from weak local models instead of being dominated by zero-cost local scoring
- Updated the task profiler and router scoring so high-stakes conversation follow-ups can favor stronger reasoning-capable models when appropriate

## v0.35.3 ÔÇö Memory Sidebar Edit And Review Actions

- Added inline edit and review actions to Memory sidebar entries so SSOT files can be opened directly or summarized before editing

## v0.35.2 ÔÇö Get Started Chat Shortcut Fix

- Added a working `Ctrl+Alt+I` (`Cmd+Alt+I` on macOS) shortcut for `AtlasMind: Open Chat Panel`
- Updated the Get Started walkthrough chat buttons to open the AtlasMind chat panel directly

## v0.35.1 ÔÇö Sidebar Settings Shortcut And Optional Import Action

- Added an AtlasMind Settings entry to the overflow menu of AtlasMind sidebar views so the settings panel can be opened directly from the panel itself
- Added an optional Import Existing Project toolbar action to the Sessions view, with a new `atlasmind.showImportProjectAction` setting to hide it when not wanted

## v0.35.0 ÔÇö Session Workspace And Sessions Sidebar

- Upgraded the dedicated AtlasMind chat panel into a session workspace with persistent workspace chat threads and a session rail
- Added a Sessions sidebar view that lists chat sessions and autonomous runs together, with direct handoff into the Project Run Center for live run steering

## v0.34.2 ÔÇö Deferred Copilot Permission Prompt

- Deferred GitHub Copilot model discovery and health checks until explicit activation so AtlasMind no longer prompts for Copilot language-model access during normal startup

## v0.34.1 ÔÇö NVIDIA NIM Model Info Link Fix

- Corrected the NVIDIA NIM model info link so AtlasMind opens NVIDIA's model catalog instead of an unrelated API page

## v0.34.0 ÔÇö Dedicated AtlasMind Chat Panel

- Added a dedicated AtlasMind chat panel for users who want a standalone conversation UI instead of only the built-in VS Code Chat view
- Added a Settings shortcut and command-palette entry for opening the panel

## v0.33.1 ÔÇö Copilot Chat Recommendation Cleanup

- Updated the repo and bootstrap-generated VS Code extension recommendations to prefer `GitHub Copilot Chat` without also prompting for the separate `GitHub Copilot` recommendation

## v0.33.0 ÔÇö Azure OpenAI, Bedrock, And Specialist Integrations

- Added routed provider support for Azure OpenAI with deployment-based workspace configuration and `api-key` authentication
- Added routed provider support for Amazon Bedrock through a dedicated SigV4-signed adapter
- Added a Specialist Integrations panel for non-routing search, voice, image, and video vendors

## v0.32.10 ÔÇö Default Branch And Release Flow Hardening

- Switched the repository default branch to `develop`
- Locked `master` to the `develop` to `master` pre-release promotion flow
- Updated contributor and Copilot guidance to treat `develop` as the normal development push target

## v0.32.9 ÔÇö Branch Strategy Update

- Adopted `develop` for normal integration work and reserved `master` for release-ready pre-release publishing
- Updated CI to validate both `develop` and `master`
- Updated contributing guidance and Copilot instructions to avoid routine direct work on `master`
- Fixed local provider health reporting so the built-in echo fallback remains available even without a configured local endpoint

## v0.32.7 ÔÇö Mixed Provider Status Marker

- Added a bracketed warning marker for partially enabled providers in the Models sidebar while preserving the green enabled status icon

## v0.32.6 ÔÇö Models Status Icon Cleanup

- Replaced visible Models sidebar status text with colored status icons
- Sorted unconfigured providers to the bottom of the Models list

## v0.32.5 ÔÇö Configurable Local Provider

- Added a real configurable local provider path backed by `atlasmind.localOpenAiBaseUrl` and an optional SecretStorage API key
- Local provider setup can now be completed directly from the Models and Model Providers surfaces

## v0.32.4 ÔÇö Provider Configuration And Agent Assignment

- Added inline provider configure and assign-to-agent actions in the Models sidebar
- Added model-level assign-to-agent actions for quick `allowedModels` updates
- Hid child model rows for unconfigured providers until the provider is configured

## v0.32.3 ÔÇö Models Sidebar Controls

- Added inline enable/disable and info actions to provider and model rows in the Models sidebar
- Persisted provider/model availability choices so routing keeps honoring them after restarts and model catalog refreshes

## v0.32.2 ÔÇö Agent Restore Activation Fix

- Removed the activation-time dependency on the Agent Manager webview so persisted user agents can be restored without loading panel UI code during startup

## v0.32.1 ÔÇö Lazy Command Panel Loading

- Changed AtlasMind command handlers to lazy-load panel modules so panel-specific runtime issues cannot block command registration during activation

## v0.32.0 ÔÇö Getting Started Command

- Added `AtlasMind: Getting Started` so the onboarding walkthrough can be reopened directly from the Command Palette
- Carries forward the recent Agent, Skills, and MCP panel reliability fixes in the beta channel

## v0.31.4 ÔÇö Agent & Skills Panel Reliability Fixes

- Replaced CSP-blocked inline button handlers in the Manage Agents panel with explicit event bindings
- Restored the New Agent, edit, enable/disable, delete, save, and cancel actions
- Registered commands and tree views earlier in activation so Skills and MCP panel actions are available sooner
- Isolated startup registration failures so one broken surface cannot prevent command registration for the others

## v0.31.2 ÔÇö Walkthrough Activation Fix

- Activated AtlasMind on startup so getting-started walkthrough buttons are available immediately after install
- Added manifest regression tests covering the provider onboarding button wiring

## v0.31.1 ÔÇö Marketplace Beta Release

- Switched the extension icon from SVG to PNG for Marketplace compatibility
- Added the top-level extension icon field and updated the publisher to `JoelBondoux`
- Published the first live beta release to the VS Code Marketplace

## v0.30.5 ÔÇö README Cleanup

- Streamlined the README into a shorter overview and onboarding page
- Moved detailed inventories and reference material into deeper docs and wiki pages

## v0.30.4 ÔÇö CI Fixes And Wiki Refresh

- Fixed the lint issues that were failing CI and restored a passing coverage gate for the currently tested service-layer modules
- Clarified model-routing documentation around seed models, runtime catalog refresh, and metadata enrichment
- Added a funding and sponsorship wiki page and refreshed the wiki comparison content

## v0.30.3 ÔÇö Copilot Chat Recommendation Restored

- Restored `GitHub Copilot Chat` in extension recommendations for the repo and bootstrap templates
- Updated setup guidance and Copilot runtime wording to point users back to `GitHub Copilot Chat`

## v0.30.2 ÔÇö Copilot Dependency Cleanup

- Removed the deprecated `GitHub Copilot Chat` recommendation from the repo and bootstrap templates
- Updated setup guidance to point to the `GitHub Copilot` extension instead
- Renamed Copilot UI/error wording from `Copilot Chat` to `Copilot language model` / `Copilot Model`

## v0.30.1 ÔÇö Trust & Freshness Fixes

- **Real daily budget enforcement** ÔÇö `dailyCostLimitUsd` now blocks new requests once the cap is reached
- **Live provider health refresh** ÔÇö Status bar updates immediately after key save and model refresh
- **Run Center disk hydration** ÔÇö Project Run Center and project runs tree now consume async disk-backed history
- **Settings quick actions** ÔÇö Direct buttons for Chat, Model Providers, Project Run Center, Voice, and Vision
- **Budget control in Settings** ÔÇö `dailyCostLimitUsd` is now editable in the Settings panel

## v0.30.0 ÔÇö UX & Feature Overhaul

- **Getting Started walkthrough** ÔÇö Four-step guided onboarding for new users
- **API key health check** ÔÇö Immediate validation after storing a provider key
- **Collapsible settings panel** ÔÇö Grouped, collapsible sections replace the flat wall of options
- **Cost persistence and daily budget** ÔÇö Session costs persisted to globalState; `dailyCostLimitUsd` setting with 80%/100% alerts
- **Streaming for Anthropic + OpenAI** ÔÇö Full `streamComplete()` with SSE parsing and tool-call handling
- **Agent performance tracking** ÔÇö Success/failure tracking influences future agent selection
- **Cost estimation in plan preview** ÔÇö `/project` shows estimated $lowÔÇô$high cost before execution
- **Disk-based run history** ÔÇö Individual JSON files replace single-blob globalState storage
- **Diff preview in project report** ÔÇö File/status table and "Open Source Control" button in report
- **Multi-workspace folder support** ÔÇö Quick-pick when multiple folders are open
- **Per-subtask checkpoint rollback** ÔÇö Rollback by task ID instead of last-only
- **Memory tree pagination** ÔÇö Incremental loading with "Load moreÔÇª" instead of hard 200-entry cap
- **Provider health status bar** ÔÇö Shows how many providers have valid API keys
- **Expanded task profiler** ÔÇö 100+ new keywords for more accurate task classification
- **Integration test suite** ÔÇö Full orchestrator ÔåÆ agent ÔåÆ cost ÔåÆ performance lifecycle tests

## v0.29.0 ÔÇö Constants, Shared Validation & Zod

## v0.28.x ÔÇö Project Import & Stability

- **`/import` command** ÔÇö Scan existing workspaces and auto-populate SSOT memory from manifests, READMEs, configs, and license files
- **TypeScript fixes** ÔÇö Added `"types": ["node"]` to tsconfig for full Node.js global support
- **Documentation overhaul** ÔÇö Comprehensive README rewrite with logo, comparison table, and complete feature coverage

## v0.27.x ÔÇö Skills Gap Analysis & README

- **11 new skills** ÔÇö `code-symbols`, `rename-symbol`, `code-action`, `web-fetch`, `diff-preview`, `rollback-checkpoint`, `test-run`, `diagnostics`, `file-move`, `file-delete`, `git-branch`
- **README overhaul** ÔÇö Logo, competitor comparison table, comprehensive feature documentation

## v0.26.x ÔÇö MCP Integration

- **MCP client** ÔÇö Connect external tool servers via stdio or HTTP transport
- **MCP server registry** ÔÇö Persistent server configs with auto-reconnect
- **MCP tools as skills** ÔÇö External tools seamlessly appear in the skill registry

## v0.25.x ÔÇö Project Planner

- **`/project` command** ÔÇö Decompose goals into DAGs of subtasks
- **TaskScheduler** ÔÇö Topological sort into parallel batches
- **Ephemeral agents** ÔÇö Role-specific agents for each subtask
- **Project Run History** ÔÇö Persistent run records with the Run Center

## v0.24.x ÔÇö Skill Security Scanner

- **Static analysis** ÔÇö 12 built-in rules for custom skill validation
- **Scanner Rules Manager** ÔÇö Configure rules via webview panel
- **Pre-enablement gate** ÔÇö Custom skills must pass scanning before use

## v0.23.x ÔÇö Voice & Vision

- **Voice Panel** ÔÇö TTS and STT via Web Speech API
- **Vision Panel** ÔÇö Image picker for multimodal prompts
- **`/voice` and `/vision` commands**

## v0.22.x ÔÇö Tool Webhooks

- **Outbound webhooks** ÔÇö Forward tool lifecycle events to external HTTPS endpoints
- **Configurable events** ÔÇö tool.started, tool.completed, tool.failed
- **Webhook management panel**

## v0.21.x ÔÇö Cost Tracking & Budget Control

- **CostTracker** ÔÇö Per-session, per-provider cost accumulation
- **Budget modes** ÔÇö cheap, balanced, expensive, auto
- **Speed modes** ÔÇö fast, balanced, considered, auto
- **`/cost` command**

## v0.20.x ÔÇö Multi-Agent Orchestration

- **AgentRegistry** ÔÇö Custom agents with roles, prompts, and constraints
- **Agent selection** ÔÇö Token overlap scoring for best-fit selection
- **Agent Manager Panel** ÔÇö Create and configure agents via webview

## Earlier Releases

See [CHANGELOG.md](https://github.com/JoelBondoux/AtlasMind/blob/master/CHANGELOG.md) for the complete version history.
