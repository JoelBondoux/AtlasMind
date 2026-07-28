# AtlasMind — Claude Code Instructions

You are working on **AtlasMind**, a VS Code extension providing a multi-agent orchestrator with model routing, long-term memory (SSOT), and a skills registry.

## Critical Rules

### Safety-First
- AtlasMind defaults to the safest reasonable behavior, not the most permissive one.
- Treat every boundary as untrusted: chat input, webview messages, workspace files, model output, and tool parameters.
- Validate before executing, redact before sending, confirm before destructive changes, deny by default when behavior is ambiguous.
- Security-sensitive regressions are treated as correctness bugs, not polish items.

### Version and Changelog
- Current version is in `package.json` → `"version"`.
- Every commit (not just PRs) must include a version bump in `package.json` and a matching `CHANGELOG.md` entry.
- This applies to all code, doc, and config changes. The version bump and changelog update must be in the same commit as the change.
- Never remove the `# Changelog` title or its Keep a Changelog preamble; new release notes must be appended beneath that header.
- The README version banner must always match `package.json`.
- When release notes or user-facing docs change, update `README.md` and the matching wiki pages in the same commit.
- Versioning follows SemVer:
  - **PATCH** (0.0.x): bug fixes, docs, refactors.
  - **MINOR** (0.x.0): new features, new commands, new UI.
  - **MAJOR** (x.0.0): breaking changes to config, agent definitions, or memory format.

### Documentation Maintenance
When you make any of the following changes, update the corresponding documentation **in the same pass and the same commit**. Do not defer doc updates to a follow-up commit.

**End-of-response checklist:** Before reporting a task complete, verify every row below whose trigger applies. If a row applies, its listed files must have been updated (or explicitly confirmed unchanged) before the response ends.

| Change | Files to update |
|---|---|
| Add/remove/rename a source file | `README.md` (Project Structure), `docs/architecture.md`, `docs/development.md`, `wiki/Architecture.md` |
| Add/modify a VS Code command | `README.md` (Extension Commands), `package.json`, `wiki/Chat-Commands.md` |
| Add/modify a chat slash command | `README.md` (Slash Commands), `package.json`, `wiki/Chat-Commands.md` |
| Add/modify a configuration setting | `README.md` (Configuration), `package.json`, `docs/configuration.md`, `wiki/Configuration.md` |
| Add/modify a type in `types.ts` | `docs/architecture.md`, `wiki/Architecture.md` |
| Add/modify a core service (Orchestrator, Planner, Router, Registry, etc.) | `docs/architecture.md`, `wiki/Architecture.md` |
| Add/modify the Planner or task scheduler | `docs/agents-and-skills.md`, `wiki/Project-Planner.md`, `wiki/Architecture.md` |
| Add/modify an agent definition or agent-routing logic | `docs/agents-and-skills.md`, `wiki/Agents.md` |
| Add/modify a skill (built-in or scaffold) | `docs/agents-and-skills.md`, `wiki/Skills.md` |
| Add/modify `builtinWorkspaceTools.ts` (subtask tool set) | `docs/agents-and-skills.md`, `wiki/Skills.md`, `wiki/Project-Planner.md` |
| Add/modify the model router | `docs/model-routing.md`, `wiki/Model-Routing.md` |
| Add/modify a provider adapter | `docs/model-routing.md`, `CONTRIBUTING.md`, `wiki/Model-Routing.md` |
| Add/modify the SSOT/memory system | `docs/ssot-memory.md`, `wiki/Memory-System.md` |
| Add/modify MCP server registry or MCP tools | `docs/agents-and-skills.md`, `wiki/Skills.md`, `wiki/Architecture.md` |
| Add/modify tool approval, safety policy, or security boundary | `wiki/Tool-Execution.md`, `wiki/Security.md`, `docs/agents-and-skills.md` |
| Add/modify webview panels | `docs/development.md`, `wiki/Architecture.md` |
| Add/modify tree views | `README.md`, `docs/architecture.md`, `wiki/Architecture.md` |
| Add/modify project routines or `/ship` | `wiki/Project-Planner.md`, `wiki/Chat-Commands.md` |
| Change build config, scripts, or dependencies | `docs/development.md`, `README.md`, `wiki/Contributing.md` |
| Ship a new version (any commit) | `CHANGELOG.md`, `package.json` (version bump), `README.md` (version banner), `wiki/Changelog.md` |

### Branching
- **`develop`** is the default branch for all implementation work and the normal push target.
- **`main`** is protected — updated only by intentional Marketplace release promotion from `develop`.
- Never push directly to `main`. Always push to `origin/develop`.

### Publishing Routine
When asked to publish or ship a release, follow these steps in order:

1. **Commit** all changes to the current working branch with a conventional commit message and version bump.
2. **Merge to `develop`**: `git checkout develop && git pull origin develop && git merge <branch> --no-ff && git push origin develop`
3. **Compile**: `npm run compile` — must produce zero TypeScript errors.
4. **Package**: `npm run package` — produces `atlasmind-<version>.vsix`. Fix any packaging errors before proceeding.
5. **Open PR to `main`**: `gh pr create --base main --head develop` — main is protected and requires a PR; never force-push.
6. **Wait for PR merge**: do NOT publish until the PR has been merged into `main` and CI checks pass. Confirm the merge before continuing.
7. **Publish**: `NODE_OPTIONS="--use-system-ca" npm run publish:release` — publishes to the VS Code Marketplace via `vsce`, then automatically creates and pushes the `v<version>` git release tag (`.github/scripts/tag-release.mjs`, idempotent). Only run this after step 6 is complete. If the tag push fails after a successful publish, re-run `npm run tag:release`.

## Architecture Quick Reference

### Entry Point
`src/extension.ts` — `activate()` creates all core services and registers commands/views, bundled into `AtlasMindContext`.

### Core Services
| Service | File | Purpose |
|---|---|---|
| `Orchestrator` | `src/core/orchestrator.ts` | Task routing: agent → memory → model → execute → cost |
| `AgentRegistry` | `src/core/agentRegistry.ts` | CRUD for `AgentDefinition` objects |
| `SkillsRegistry` | `src/core/skillsRegistry.ts` | CRUD for `SkillDefinition` + agent-skill resolution |
| `ModelRouter` | `src/core/modelRouter.ts` | Budget/speed-aware model selection |
| `CostTracker` | `src/core/costTracker.ts` | Per-session cost accumulation |
| `MemoryManager` | `src/memory/memoryManager.ts` | SSOT folder read/write/search |
| `VoiceManager` | `src/voice/voiceManager.ts` | TTS/STT bridge: ElevenLabs → OS host engine → Web Speech API |
| `HostSpeechSynthesizer` | `src/voice/hostSpeechSynthesizer.ts` | On-device OS TTS (Windows SAPI / macOS `say` / Linux `espeak-ng`) |
| `LocalTranscriber` | `src/voice/localTranscriber.ts` | On-device Whisper STT via local `whisper-cli`; SHA-256-verified model/binary download |
| `CurrencyFormatter` | `src/core/currencyFormatter.ts` | Locale-aware cost formatting with live exchange rates |
| `CopilotMultiplierSync` | `src/providers/copilotMultiplierSync.ts` | Syncs Copilot premium-request multipliers from GitHub docs |
| `LocalModelSync` | `src/providers/localModelSync.ts` | Queries Ollama/LM Studio for live local model metadata |
| `TaskProfiler` | `src/core/taskProfiler.ts` | Infers task complexity profile for routing |
| `CheckpointManager` | `src/core/checkpointManager.ts` | Conversation checkpoint save/restore |
| `ProjectRunHistory` | `src/core/projectRunHistory.ts` | Persists per-project task run records |
| `SkillScanner` | `src/core/skillScanner.ts` | Auto-discovers workspace tool definitions |
| `TestingScaffolder` | `src/core/testingScaffolder.ts` | Constructs a stack-aware starter testing framework from enabled methodologies (non-destructive) |
| `RoadmapGates` | `src/core/roadmapGates.ts` | Release milestones a roadmap item can be tagged for (`#mvp` built-in + up to 12 user-declared), persisted as a managed `roadmap-gates` markdown block in `improvement-plan.md`. Only **declared** tags are read as gates (so "#2" in an item stays text) with a tag-boundary check (`#v1` ≠ `#v10`); ids slug-validated and refused rather than coerced (a gate becomes a `#tag` in a tracked file); MVP always survives an edit; removing a gate strips its tag and never deletes an item; heuristic MVP suggestions stay MVP-only. Pure + unit-tested |
| `TestingPolicyCoverage` | `src/core/testingPolicyCoverage.ts` | Per-enabled-policy evidence for the Testing dash (`covered` / `tooling-only` / `missing`, plus `not-file-evident` for practices, which are never gaps). Failures read **only** from a JUnit report the project already wrote — never runs a test command; no report ⇒ "no verdict" + the command to make one, never "0 failing". Untrusted-report boundary: regex attribute reads (no XML parser/DTD), size + case caps, control-stripped, counted failures beat asserted totals, failure messages deliberately not extracted. Pure + unit-tested |
| `DeliveryManager` | `src/core/deliveryManager.ts` | Models deployment stages (Local → Staging → Production) + promotion ("push") edges; seeds from repo branches, persists `project_memory/operations/delivery.json` + `delivery.md` runbook mirror; safety-first (production protected, deny-by-default backup gate) |
| `PromotionRunner` | `src/core/promotionRunner.ts` | Guarded promotion engine: builds the preflight→backup→deploy→verify→record plan, enforces the authorization gate (auto/manual checks, approval, protected type-to-confirm), executes user-authored commands with live progress + rollback hint; never force-pushes, commands sourced server-side only |
| `ProjectDirectorManager` | `src/core/projectDirectorManager.ts` | Models the *people* around a project (stakeholders, team, responsibilities, human assignments, follow-ups); persists `project_memory/operations/project-director.json` + `project-director.md` mirror + capped history, `fs`-only; GDPR-first (prefers M365/Slack/Google system-of-record refs over raw PII, `piiStored` consent flag, deep-link scheme allowlist, sanitize-at-boundary); pure follow-up urgency derivations; surfaced on the Project Dashboard → Director page |
| `DirectorCommsRunner` | `src/core/directorCommsRunner.ts` | Pure detect/arg-map layer for the Director's opt-in guarded outbound messaging: finds a connected MCP tool that can email/schedule/message and maps a draft onto its input schema. Dispatch + `{modal:true}` auth gate + deny-by-default (`outboundEnabled`) live in the dashboard panel; runs via the `mcp:` skill wrapper; deep-link fallback when no connector matches |
| `BuzzProtocol` | `src/core/buzzProtocol.ts` | Verified Nostr wire framing for Tier-3 **inbound** (pure/`vscode`-free + unit-tested). NIP-01 frames + NIP-42 auth (kind 22242) read from published spec; kind numbers from `buzz-core/src/kind.rs` at `BUZZ_PROTOCOL_VERIFIED_VERSION`. Kind selection **corrected against a live relay**: channel messages are kind **9** (registry also defines V2 40002, which the relay had none of) — both now subscribed, since the wrong one alone reaches EOSE and receives nothing forever; channel metadata **39000** not 41; `kinds` required non-empty (kind-less query ⇒ relay 403 p-gate). Untrusted boundary: `parseRelayFrame`/`validateNostrEvent` never throw, degrade to typed `unknown`/undefined, no signature verification implied |
| `BuzzConnectionPolicy` | `src/core/buzzConnectionPolicy.ts` | The connection half of presence (`PresenceManager` is the OS half; a wake lock can't save a dropped socket). Pure + clock-free ⇒ deterministic tests, no timers. `dead` only after an unanswered ping (never from idleness); capped backoff with **subtractive** jitter so the cap holds; `restricted:` refusal stops rather than retries; resume plan re-subscribes + re-announces and rewinds by an overlap (duplicate > dropped message) |
| `BuzzInboundDerivation` | `src/core/buzzInboundDerivation.ts` | Enforces **derive, don't mirror** — event ⇒ `FollowUp` + thread pointer, never the message body (SSOT is git-tracked, so mirroring would commit colleagues' chat). Secret redaction + control-char stripping + length clamp on anything crossing the boundary; total derivation (reason, never throw); de-dupe by event id makes the reconnect replay overlap safe; `https`-only, path-encoded thread links |
| `BuzzClient` | `src/core/buzzClient.ts` + `src/core/buzzSocket.ts` | The Tier-3 inbound subscription driving the three modules above; owns only the state machine (connect → auth → subscribe → receive → drop → back off → resume). Transport injected via `BuzzSocketFactory` (the `PresenceManager` `spawn` idiom) ⇒ no `ws`/`vscode` import, unit-tested on a fake socket **and** integration-tested against a real in-process WS server (handshake, Buffer→string, ping/pong, hard TCP drop). `BuzzEventSigner` is a seam — no signer ⇒ typed explained stop, never a retry loop. **Read-only by construction:** only `REQ`/`CLOSE`/`AUTH`/pings, never `EVENT` (asserted). `toWebSocketUrl` maps the CLI's `http(s)` base to `ws(s)` so one `relayUrl` serves both halves |
| `BuzzConversation` | `src/core/buzzConversation.ts` | **In-memory, session-only** view of a Buzz channel so it can be read and replied to. Never persisted — "derive, don't mirror" governs what reaches git-tracked `project_memory/`, not whether a message may be *looked at*. Emoji treated as correctness: code-point truncation that backs off trailing ZWJ/variation-selector/skin-tone so a trim never breaks a glyph; reactions compared on the full sequence (👍 ≠ 👍🏽). Outbound refuses a secret rather than redacting it — a silently-redacted send means you believe you sent something you didn't. Pure + unit-tested |
| `BuzzSendPolicy` | `src/core/buzzSendPolicy.ts` | When a Buzz send needs a `{modal:true}` confirmation. Moves the gate from *every send* to *every send AtlasMind had a hand in*: human-composed + human-aimed + already-confirmed target ⇒ no dialog (composition **is** the confirmation); agent-drafted, agent-chosen target, or first message to a target ⇒ always confirm. Deny-by-default in shape (every non-ideal branch confirms, pinned by an exhaustive test); grant is per-recipient and session-scoped. Pure + unit-tested |
| `BuzzDocsSource` | `src/core/buzzDocsSource.ts` | Reads **Buzz's own documentation** for the setup steps that involve things outside AtlasMind, so hand-written prose cannot go stale as Buzz ships. Split by consequence: facts about *your machine* stay computed (`BuzzSetupPlan`), facts about *Buzz* are fetched and **cited** with source + fetch age. Fetched docs are untrusted input — commands surface as quoted, attributed suggestions AtlasMind never runs, prose is redacted/control-stripped/clamped, markdown links flattened so a label can't misrepresent its target. Origin **pinned** to the Buzz repo (not a general fetcher) and SSRF-screened; offline degrades to built-in guidance. Section scoring **verified against the live README** — heading-only matching found nothing, and frequency alone picked marketing prose over the line naming `BUZZ_PRIVATE_KEY`, so specific markers are weighted above repetition. Pure + unit-tested |
| `BuzzChannelCatalog` | `src/core/buzzChannelCatalog.ts` | Turns `buzz channels list` into a tickable list of real ids — a channel id that quietly doesn't match the channel you posted in is the usual reason a working subscription receives nothing, and it's indistinguishable from a wrong relay or a quiet day. Field names **read from the CLI source** (`channels.rs` compact projection ⇒ `{ channel_id, name }`), other spellings tolerated. Untrusted: never throws, ids constrained to an identifier charset (not arbitrary text — this lands in a settings array), names redacted/control-stripped/clamped, capped + de-duped, unreadable entries counted. `resolveWatchedChannels` **keeps** an unlisted watched id (permissions gap ≫ deliberate removal). Driven by `atlasmind.buzz.fetchChannels`: the one Buzz control that writes a setting, and only the channel list, only after the user ticks and confirms. Pure + unit-tested |
| `BuzzSetupPlan` | `src/core/buzzSetupPlan.ts` | Ordered Buzz setup checklist (done/todo/blocked/optional) driving the `/buzz` chat walkthrough. **A plan, never an installer** — every action *opens a surface*; nothing enables a gate, writes a setting, or stores a secret, because a setup assistant that flipped the deny-by-default switches to be helpful would remove the property they exist to provide (allowlist pinned by test). **Derived, not model-generated** — a hallucinated setup step is worse than none. Two step sets, deliberately different: `REQUIRED_BUZZ_STEP_IDS` is what `isBuzzInboundReady` means (inbound works unbound and un-proven), while `BUZZ_WALKTHROUGH_STEP_IDS` adds **prove one message arrives** (subscribed ≠ receiving — wrong channel id, wrong relay, and a quiet day are indistinguishable) and **bind the people in the Director roster** (else work arrives unassigned). `nextBuzzSetupStep` is scoped to the walkthrough set, so a step blocked only by an *optional* prerequisite is never nominated. Pure + unit-tested |
| `BuzzDirectory` | `src/core/buzzDirectory.ts` | The Buzz identities AtlasMind has **observed**, so a handle can be picked not typed. **Never derives a key from a person** — a constructed key belongs to a *different real person*; only keys seen on the wire, named only by kind-0 profiles their owners published. Kind 0 **verified against a live relay** (standard NIP-01, absent from Buzz's registry) and excluded from `BUZZ_INBOUND_KINDS` — a profile is not work. Names are untrusted text: redacted/control-stripped/clamped on the way *in*. **Never persisted** (a roster of who spoke vs. git-tracked `project_memory/`); in-memory on `BuzzInboundService`. Pure + unit-tested |
| `BuzzAgentBindings` | `src/core/buzzAgentBindings.ts` | Maps a **Buzz identity → one or more AtlasMind agents** (`atlasmind.buzz.agentBindings`), so inbound work lands with the right specialist; the **first owns it** (a follow-up has one owner), the rest are also-relevant. A local *routing preference*, not identity — Buzz keeps the keypair/directory/ledger. `npub`/hex both accepted and normalised via the bech32 decoder; a mistyped npub is **rejected** rather than binding elsewhere; `nsec` refused. Bad bindings reported not dropped; unbound author ⇒ unassigned, never guessed. Pure + unit-tested |
| `BuzzInboundService` | `src/core/buzzInboundService.ts` | Wiring that makes Tier 3 run. Deny-by-default **two gates** (`buzz.enabled` + `buzz.inboundEnabled`); persistence a **third** (`autoCreateFollowUps`, off — `project_memory/` is git-tracked). `sync()` reconciles on any `atlasmind.buzz.*` change; holds `PresenceManager` `buzz` reason only while live; merges follow-ups by deterministic id (reconnect replay can't duplicate) with a per-batch cap |
| `BuzzSigner` | `src/core/buzzSigner.ts` | BIP-340 Schnorr signing for NIP-42 (fills the `BuzzEventSigner` seam; a real relay refuses to subscribe until authenticated). **Bundled + lazily loaded:** `@noble/secp256k1` (170 KB, zero transitive deps — picked over the 1.87 MB `@noble/curves`), imported on first signature only; Node `crypto` supplies SHA-256. ESM-only package ⇒ import built via `Function` to survive CJS emit (`require(esm)` throws before Node 22.12), with a `require` fallback. `nsec` bech32 **checksum-validated** (mistype fails loudly, never signs as another identity); `npub` rejected by name; key validated at creation not mid-handshake; signature self-verified before return; secrets never logged. Cross-validated against published NIP-19 vectors. Auth events only — the client stays read-only |
| `FollowUpScheduler` | `src/core/followUpScheduler.ts` | In-process follow-up reminder engine (pure eval + thin timer). Throttled once/day in-editor nudge (opens the Director tab) when follow-ups are overdue/due-soon; notification-only, deny-by-default (never auto-sends on a timer); gated by `nudgeOnActivation` (startup) / `remindersEnabled` (recurring). Paired with the `atlasmind.projectDirectorView` sidebar tree (overdue badge) + `/director`/`/followups` chat |
| `DocumentsManager` | `src/core/documentsManager.ts` | Models a project's document filing system (folder "shelves" + optional glob) and the docs kept updated automatically; persists `project_memory/operations/documents.json` + `documents.md` runbook mirror, `fs`-only + unit-tested; safety-first (never rewrites docs on a timer — tracks freshness from mtime vs. review baseline, offers explicit Update-with-Atlas / Mark-reviewed), `sanitizeDocumentsConfig`/`normalizeRelPath` reject path traversal at the boundary; saving a shelf creates its folder (`newShelfPaths` + `createShelfFolders`, create-only: existing dir = no-op, file at that path reported not touched); surfaced on the Project Dashboard → Documents page |
| `RiskOversightManager` | `src/core/riskOversightManager.ts` | Risk register raised by the three read-only oversight advisors (ethics/legal/commercial); persists `project_memory/operations/risk-oversight.json` + `.md` mirror + capped append-only `-history.json`, `fs`-only + unit-tested; a record not a gate (nothing blocks a commit/release), findings transition rather than delete; untrusted-model-output boundary (`parseRiskFindings` never throws, `sanitizeRiskFindings` coerces enums safely and rejects path traversal); pure `computeRiskScore` (likelihood × impact, confidence-discounted, coverage-scaled, staleness-decayed) feeds a 15-pt score component that is omitted until assessed; surfaced on the Project Dashboard → Risk page |
| `PresenceManager` | `src/core/presenceManager.ts` | Cross-platform OS keep-awake wake lock so a connected Buzz presence, a Remote Control gateway session, or a long Mission Loop run isn't killed by system sleep; spawns an OS helper tied to the extension-host lifetime (Windows `SetThreadExecutionState` via PowerShell + parent-PID orphan guard, macOS `caffeinate`, Linux `systemd-inhibit`) since an extension can't use Electron `powerSaveBlocker`; `vscode`-free + unit-tested; deny-by-default (`atlasmind.presence.*`), AC-power-gated, `maxAwakeMinutes` auto-release backstop, sleep detector, no untrusted input in commands; surfaced as a click-to-stop status-bar item + `atlasmind.togglePresence` |
| `TestingProtocolSync` | `src/utils/testingProtocolSync.ts` | Outbound sync of enabled testing protocols into external agent instruction files via a managed, path-safe block |
| `ModelEvalHarness` | `src/core/modelEvalHarness.ts` | Scored-replay model comparison (`compareModelsOnPrompt`); ranks models by graded quality/cost and records outcomes to calibrate routing |
| `ProviderRegistry` | `src/providers/index.ts` | Maps provider IDs to adapter instances |
| `McpServerRegistry` | `src/mcp/mcpServerRegistry.ts` | Manages MCP server connections and tool dispatch |
| `McpEnvironmentScanner` | `src/mcp/mcpEnvironmentScanner.ts` | Discovers MCP setup signals for the Add-Server flow: imports server defs from other tools' config files (Claude Desktop/Cursor/VS Code/Windsurf/repo `.mcp.json`), probes PATH launchers, reads `.env*`/`wrangler.toml` var *names*; cached in `project_memory/operations/mcp-environment.json` (+ `.md` mirror), Rescan + workspace-config watcher; `fs`-only + unit-tested; redaction-safe (names only cached/shown — secret values re-read live on import → SecretStorage) |
| `ArdClient` | `src/ard/ardClient.ts` | Agentic Resource Discovery client: registry `POST /search` (bounded federation) + static `ai-catalog.json` fetch, with untrusted-input validation and SSRF screening |
| `ArdRegistry` | `src/ard/ardRegistry.ts` | Persists ARD Agent Finders (seeded disabled) and caches recent results |
| `ArdInstaller` | `src/ard/ardInstaller.ts` | Maps a discovered resource to a non-destructive install (MCP→disabled server, catalog→finder, else reference) |

### UI Surfaces
| Surface | File | Description |
|---|---|---|
| `@atlas` chat participant | `src/chat/participant.ts` | Chat bar with slash commands |
| Sidebar tree views | `src/views/treeViews.ts` | Agents, Skills, Memory, Models trees |
| Model Provider panel | `src/views/modelProviderPanel.ts` | API key management and quota display webview |
| Settings panel | `src/views/settingsPanel.ts` | Budget/speed sliders webview |
| Cost Dashboard panel | `src/views/costDashboardPanel.ts` | Per-session and per-model cost breakdown |
| Model Comparison panel | `src/views/modelComparisonPanel.ts` | Run a prompt across models; ranked quality/cost/latency comparison |
| Project Run Center panel | `src/views/projectRunCenterPanel.ts` | Task run history and checkpoint browser |
| Agent Editor panel | `src/views/agentEditorPanel.ts` | Create/edit agent definitions |
| Skill Editor panel | `src/views/skillEditorPanel.ts` | Create/edit skill definitions |
| Memory Browser panel | `src/views/memoryBrowserPanel.ts` | Browse and edit SSOT memory entries |
| Personality Profile panel | `src/views/personalityProfilePanel.ts` | Agent personality configuration |
| Project Planner panel | `src/views/projectPlannerPanel.ts` | Multi-step project planning UI |
| Risk Oversight tab | `src/views/projectDashboardPanel.ts` (`risk` page) | Runs the ethics/legal/commercial advisors, records findings, risk matrix + trend charts, feeds the operational score — a tab inside the Project Dashboard |
| Resource Discovery tab | `src/views/settingsPanel.ts` (`discovery` page) | Search ARD Agent Finders, install discovered resources, manage finders, export catalog — a tab inside the Settings dashboard |
| Status bar items | `src/extension.ts` | Provider health, cost, model, remote-control, and keep-awake/presence indicators |

### Type System
- All shared interfaces live in `src/types.ts`.
- Provider adapters are defined in `src/providers/adapter.ts`.
- Never duplicate type definitions across files.

### SSOT Memory Layout
```
project_memory/
  project_soul.md, architecture/, roadmap/, decisions/, misadventures/,
  ideas/, domain/, operations/, agents/, skills/, index/
```
Defined as `SSOT_FOLDERS` in `src/types.ts`.

## Coding Standards

### TypeScript
- **Strict mode** is enabled — no implicit `any`.
- Use `.js` extension on all relative imports (Node16 module resolution).
- Prefer `type` imports for types only used in type positions.
- One class per file for core services.

### Security
- API keys go in VS Code `SecretStorage`, never in settings or source.
- Webview HTML must use `escapeHtml()` from `webviewUtils.ts`.
- Webview scripts must be nonce-protected; do not use inline event handlers (`onclick`, etc.).
- All webview messages must be validated before mutating configuration, touching secrets, or invoking commands.
- File-system features must reject path traversal and default to non-destructive behavior.
- Memory retrieval and model execution must preserve a redaction boundary for secrets and sensitive project data.

### Commits
- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- Include doc updates in the same commit as the code change.
- Include a SemVer version bump in `package.json` and a matching `CHANGELOG.md` entry in every commit.

## Documentation Files
| File | Contents |
|---|---|
| `README.md` | User-facing overview, commands, config, structure |
| `CHANGELOG.md` | Version history in Keep a Changelog format |
| `CONTRIBUTING.md` | Dev setup, conventions, how to add providers/agents/skills |
| `docs/architecture.md` | System diagram, activation flow, data flow, dependency graph |
| `docs/model-routing.md` | Routing algorithm, budget/speed modes, provider list |
| `docs/ssot-memory.md` | SSOT folder details, retrieval, bootstrapping, security |
| `docs/agents-and-skills.md` | Agent and skill definitions, selection, context bundles |
| `docs/development.md` | Build, lint, run, test, package, TypeScript conventions |

## Wiki Pages (`wiki/`)

The GitHub Wiki is published from the `wiki/` directory. When any docs-level change is made, the corresponding wiki page **must** also be updated and pushed to the wiki repo.

| Wiki Page | Mirrors |
|---|---|
| `wiki/Home.md` | Project overview, navigation |
| `wiki/Getting-Started.md` | Installation, first steps |
| `wiki/Architecture.md` | `docs/architecture.md` |
| `wiki/Chat-Commands.md` | Slash commands and extension commands from `README.md` / `package.json` |
| `wiki/Agents.md` | Agent features from `docs/agents-and-skills.md` |
| `wiki/Skills.md` | Skill features from `docs/agents-and-skills.md` |
| `wiki/Model-Routing.md` | `docs/model-routing.md` |
| `wiki/Memory-System.md` | `docs/ssot-memory.md` |
| `wiki/Project-Planner.md` | Planner, scheduler, run history |
| `wiki/Tool-Execution.md` | Approval, safety, webhooks |
| `wiki/Configuration.md` | All `atlasmind.*` settings from `package.json` |
| `wiki/Security.md` | Security boundaries, threat model |
| `wiki/Contributing.md` | `CONTRIBUTING.md` |
| `wiki/FAQ.md` | Troubleshooting, common questions |
| `wiki/Changelog.md` | `CHANGELOG.md` highlights |
| `wiki/_Sidebar.md` | Wiki navigation sidebar |
