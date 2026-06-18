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
- **`master`** is protected — updated only by intentional Marketplace release promotion from `develop`.
- Never push directly to `master`. Always push to `origin/develop`.

### Publishing Routine
When asked to publish or ship a release, follow these steps in order:

1. **Commit** all changes to the current working branch with a conventional commit message and version bump.
2. **Merge to `develop`**: `git checkout develop && git pull origin develop && git merge <branch> --no-ff && git push origin develop`
3. **Compile**: `npm run compile` — must produce zero TypeScript errors.
4. **Package**: `npm run package` — produces `atlasmind-<version>.vsix`. Fix any packaging errors before proceeding.
5. **Open PR to `master`**: `gh pr create --base master --head develop` — master is protected and requires a PR; never force-push.
6. **Wait for PR merge**: do NOT publish until the PR has been merged into `master` and CI checks pass. Confirm the merge before continuing.
7. **Publish**: `NODE_OPTIONS="--use-system-ca" npm run publish:release` — publishes to the VS Code Marketplace via `vsce`. Only run this after step 6 is complete.

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
| `TestingProtocolSync` | `src/utils/testingProtocolSync.ts` | Outbound sync of enabled testing protocols into external agent instruction files via a managed, path-safe block |
| `ModelEvalHarness` | `src/core/modelEvalHarness.ts` | Scored-replay model comparison (`compareModelsOnPrompt`); ranks models by graded quality/cost and records outcomes to calibrate routing |
| `ProviderRegistry` | `src/providers/index.ts` | Maps provider IDs to adapter instances |
| `McpServerRegistry` | `src/mcp/mcpServerRegistry.ts` | Manages MCP server connections and tool dispatch |

### UI Surfaces
| Surface | File | Description |
|---|---|---|
| `@atlas` chat participant | `src/chat/participant.ts` | Chat bar with slash commands |
| Sidebar tree views | `src/views/treeViews.ts` | Agents, Skills, Memory, Models trees |
| Model Provider panel | `src/views/modelProviderPanel.ts` | API key management and quota display webview |
| Settings panel | `src/views/settingsPanel.ts` | Budget/speed sliders webview |
| Cost Dashboard panel | `src/views/costDashboardPanel.ts` | Per-session and per-model cost breakdown |
| Project Run Center panel | `src/views/projectRunCenterPanel.ts` | Task run history and checkpoint browser |
| Agent Editor panel | `src/views/agentEditorPanel.ts` | Create/edit agent definitions |
| Skill Editor panel | `src/views/skillEditorPanel.ts` | Create/edit skill definitions |
| Memory Browser panel | `src/views/memoryBrowserPanel.ts` | Browse and edit SSOT memory entries |
| Personality Profile panel | `src/views/personalityProfilePanel.ts` | Agent personality configuration |
| Project Planner panel | `src/views/projectPlannerPanel.ts` | Multi-step project planning UI |
| Status bar items | `src/extension.ts` | Provider health, cost, and model indicators |

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
| `wiki/Comparison.md` | Feature comparison table |
| `wiki/Changelog.md` | `CHANGELOG.md` highlights |
| `wiki/_Sidebar.md` | Wiki navigation sidebar |
