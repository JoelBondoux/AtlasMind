# AtlasMind

> Developer-centric multi-agent orchestrator that runs entirely inside VS Code.

AtlasMind provides a unified interface for coordinating multiple AI agents, routing requests across model providers, maintaining long-term project memory, and tracking costs — all from within your editor.

## Security First

AtlasMind is being built with a safety-first and security-first default posture:

- Provider credentials are stored in VS Code SecretStorage, never in workspace settings or the SSOT.
- Webviews use nonce-protected scripts and validate all incoming messages before acting on them.
- SSOT bootstrapping rejects unsafe paths and avoids overwriting existing content by default.
- Memory retrieval includes content-level redaction of sensitive values (API keys, tokens, passwords) before model context inclusion.
- Vulnerability reporting expectations and supported versions are documented in [SECURITY.md](SECURITY.md).

## Status

**v0.25.0** — AtlasMind now includes a Project Run Center with durable run history, review-before-execute workflow, and live batch telemetry for autonomous project runs.

## Features (planned)

| Feature | Status |
|---|---|
| Chat participant (`@atlas`) | ✅ Registered |
| Sidebar tree views (Agents, Skills, Memory, Models, Project Runs) | ✅ Registered |
| Model Provider webview panel | ✅ Implemented (API key management + model refresh) |
| Tool Webhooks webview panel | ✅ Implemented (URL validation + delivery history) |
| Settings panel (budget/speed + project execution controls) | ✅ Implemented |
| Project Run Center | ✅ Implemented (review/apply workflow, live execution telemetry, durable run history) |
| Project bootstrapper (SSOT + Git init) | ✅ Implemented (SSOT + optional governance scaffolding) |
| Orchestrator core | ✅ Implemented (bounded tool loop, retries, budget guards, project execution) |
| Model routing (budget/speed/auto) | ✅ Implemented (task-profile-aware gating, modality inference, capability-aware filtering) |
| SSOT memory with embeddings | ✅ Implemented (local vector index + lexical ranking) |
| Agent execution pipeline | ✅ Implemented (relevance-based selection, operator toggles, subtask execution) |
| Provider adapters (Claude, OpenAI, Gemini, DeepSeek, Mistral, z.ai, Copilot, Local) | ✅ Implemented |
| Cost tracking with token usage | ✅ Implemented (provider-native counts with local fallback estimation) |
| Skills security scanning + enable/disable | ✅ Implemented |
| Scanner rule configurator UI | ✅ Implemented |
| Custom skill import | ✅ Implemented |
| Atlas-drafted skill scaffolding | ✅ Implemented (opt-in, scanned, imported disabled) |
| SSOT memory prompt-injection scanner | ✅ Implemented |
| MCP server integration | ✅ Implemented |
| Unit test baseline | ✅ Vitest tests + coverage command |
| CI quality gates | ✅ Compile + lint + test + coverage in GitHub Actions |
| PR/Issue governance templates | ✅ Added |
| Git-backed patch application | ✅ Implemented (workspace-safe git apply skill) |
| Grep-style text search | ✅ Implemented (workspace-safe line search across UTF-8 files) |
| Directory listing | ✅ Implemented |
| Targeted file editing | ✅ Implemented (literal search/replace with match-count guards) |
| Safe terminal execution | ✅ Implemented (allow-listed, no-shell subprocess execution) |
| Git inspection skills | ✅ Implemented (`status`, `diff`, `commit`) |
| Per-tool approval gating | ✅ Implemented |
| Session carry-forward context | ✅ Implemented (bounded / compacted) |
| Streaming responses | ✅ Implemented for streaming-capable adapters, including tool-driven agentic runs |
| Automatic post-write verification | ✅ Implemented (sanitized package scripts, batch-level execution) |
| Rollback checkpoints | ✅ Implemented (automatic pre-write snapshots + durable rollback skill state) |
| Image / vision input | ✅ Implemented for workspace image paths in freeform chat |
| Explicit image attachment UX | ✅ Implemented (`/vision` picker-backed flow) |
| Context window management | ✅ Implemented (bounded session context + model-aware prompt compaction) |

## Quick Start

### Prerequisites

- VS Code ≥ 1.95.0
- Node.js ≥ 18
- npm ≥ 9

### Build & Run

```bash
npm install
npm run compile
```

Press **F5** to launch the Extension Development Host.

### Watch Mode

```bash
npm run watch
```

### Tests

```bash
npm run test
npm run test:coverage
```

## Chat Participant

Type `@atlas` in the VS Code chat panel to interact with the orchestrator.

### Slash Commands

| Command | Description |
|---|---|
| `/bootstrap` | Initialise a new project with SSOT memory structure and optional governance baseline scaffolding |
| `/agents` | List or manage registered agents |
| `/skills` | List or manage registered skills |
| `/memory` | Query the SSOT memory system |
| `/cost` | Show cost summary for the current session |
| `/project` | Decompose a goal into parallel subtasks, preview impact, require `--approve` for high-impact runs, report per-subtask file impact, and export a JSON run summary |
| `/runs` | Open the Project Run Center to review recent autonomous runs and preview the next one before execution |
| `/voice` | Open the Voice Panel for TTS/STT; shows capability summary and action button |
| `/vision` | Pick workspace images and run an explicit multimodal chat request against vision-capable models |

## Extension Commands

| Command | Description |
|---|---|
| `AtlasMind: Open Settings Panel` | Budget/speed sliders and global config |
| `AtlasMind: Manage Model Providers` | API keys, provider model refresh, and provider setup |
| `AtlasMind: Manage Agents` | Create, edit, enable/disable, and delete custom agents via a webview panel |
| `AtlasMind: Bootstrap Project` | Create SSOT folder structure |
| `AtlasMind: Show Cost Summary` | Session cost at a glance |
| `AtlasMind: Add Skill` | Create a template skill or import a `.js` skill file |
| `AtlasMind: Configure Scanner Rules` | Open the scanner rule configurator webview |
| `AtlasMind: Manage MCP Servers` | Add, remove, and manage MCP server connections |
| `AtlasMind: Tool Webhooks` | Configure outbound tool-use webhook delivery |
| `AtlasMind: Open Voice Panel` | Open the Voice Panel for TTS and STT |
| `AtlasMind: Open Vision Panel` | Open the Vision Panel to attach images and run multimodal prompts |
| `AtlasMind: Open Project Run Center` | Preview, execute, and review autonomous project runs from one panel |

## Security Baseline

Current safeguards built into the scaffold:

| Area | Current safeguard |
|---|---|
| Provider secrets | Stored in VS Code SecretStorage |
| Webviews | CSP with nonce-protected scripts; no inline handlers; single-quote escaping |
| Webview messages | Explicit runtime validation before state changes |
| SSOT bootstrap | Safe relative-path validation and non-destructive creation |
| Memory | SSOT scanning with redaction pipeline; 1,000-entry / 64 KB-per-doc caps |
| File skills | `readFile` and `writeFile` reject paths outside the workspace via `path.resolve()` |
| Tool approvals | Configurable per-tool approval policy with modal confirmation for risky actions |
| Terminal execution | Allow-listed executables only, no shell interpolation, workspace-only CWD, terminal writes disabled by default |
| Tool arguments | JSON Schema validation for required params and type constraints before execution |
| Planner | Subtask field length limits and array type enforcement |
| MCP | Shell metacharacter rejection for stdio commands; HTTP URL scheme validation |
| Settings | Path traversal rejection for folder configuration inputs |
| Temp files | Secure creation via `fs.mkdtemp()` with restrictive permissions |

## Configuration

| Setting | Default | Description |
|---|---|---|
| `atlasmind.budgetMode` | `balanced` | `cheap` · `balanced` · `expensive` · `auto` |
| `atlasmind.speedMode` | `balanced` | `fast` · `balanced` · `considered` · `auto` |
| `atlasmind.ssotPath` | `project_memory` | Relative path to the SSOT folder |
| `atlasmind.toolApprovalMode` | `ask-on-write` | Approval policy for tool execution: `always-ask` · `ask-on-write` · `ask-on-external` · `allow-safe-readonly` |
| `atlasmind.allowTerminalWrite` | `false` | Permit write-capable subprocesses such as installs and commits after approval |
| `atlasmind.autoVerifyAfterWrite` | `true` | Run configured verification scripts after successful workspace-write tool batches |
| `atlasmind.autoVerifyScripts` | `test` | Package scripts invoked after verified writes; sanitized and executed without shell interpolation |
| `atlasmind.autoVerifyTimeoutMs` | `120000` | Maximum time allotted to each automatic verification script |
| `atlasmind.chatSessionTurnLimit` | `6` | Number of recent turns carried forward into freeform chat context |
| `atlasmind.chatSessionContextChars` | `2500` | Maximum compacted character budget for session carry-forward context |
| `atlasmind.projectApprovalFileThreshold` | `12` | Estimated changed-file threshold that triggers `/project` approval gating |
| `atlasmind.projectEstimatedFilesPerSubtask` | `2` | Heuristic files-per-subtask multiplier used in the `/project` preview |
| `atlasmind.projectChangedFileReferenceLimit` | `5` | Maximum number of changed files shown as clickable references after `/project` |
| `atlasmind.projectRunReportFolder` | `project_memory/operations` | Relative folder where `/project` run summary JSON reports are saved |
| `atlasmind.toolWebhookEnabled` | `false` | Enables outbound webhook delivery for tool execution events |
| `atlasmind.toolWebhookUrl` | `""` | Webhook endpoint URL for tool lifecycle payloads |
| `atlasmind.toolWebhookTimeoutMs` | `5000` | Timeout for webhook HTTP POST requests |
| `atlasmind.toolWebhookEvents` | `tool.started, tool.completed, tool.failed` | Selected tool event names to emit |
| `atlasmind.experimentalSkillLearningEnabled` | `false` | Enables Atlas-generated skill drafts with explicit warning and disabled-by-default import |
| `atlasmind.voice.ttsEnabled` | `false` | Auto-speak `@atlas` freeform responses via the Voice Panel |
| `atlasmind.voice.sttEnabled` | `false` | Enable STT in the Voice Panel (requires microphone permission) |
| `atlasmind.voice.rate` | `1.0` | Speech synthesis rate (0.5–2.0) |
| `atlasmind.voice.pitch` | `1.0` | Speech synthesis pitch (0–2.0) |
| `atlasmind.voice.volume` | `1.0` | Speech synthesis volume (0–1.0) |
| `atlasmind.voice.language` | `""` | BCP 47 language tag for TTS/STT (e.g. `en-US`); empty = browser default |

## GitHub Workflow Standards

- Work on feature branches and open pull requests into `master`.
- Require CI checks to pass before merge (`compile`, `lint`, `test`, `coverage`).
- Link pull requests to issues and use templates for consistency.
- Use labels and project boards for prioritization and delivery visibility.
- Keep CODEOWNERS review coverage for core runtime and docs.

## Bootstrap Defaults

AtlasMind bootstrap now supports extension-wide governance scaffolding for any target project:

- `.github/workflows/ci.yml`
- `.github/pull_request_template.md`
- `.github/ISSUE_TEMPLATE/*`
- `.github/CODEOWNERS`
- `.vscode/extensions.json`

The scaffold is non-destructive: existing files are preserved and only missing files are created.

## Project Structure

```
src/
├── extension.ts              Extension entry point
├── commands.ts               Command handler implementations
├── types.ts                  Shared interfaces and type definitions
├── chat/
│   ├── participant.ts        VS Code chat participant (@atlas)
│   ├── imageAttachments.ts   Shared workspace image attachment resolution helpers
│   └── sessionConversation.ts Bounded carry-forward chat context
├── core/
│   ├── orchestrator.ts       Multi-agent task orchestration
│   ├── checkpointManager.ts  Automatic pre-write checkpoints and rollback state
│   ├── planner.ts            LLM-based goal decomposition into SubTask DAG
│   ├── projectRunHistory.ts  Durable project run history persistence
│   ├── skillDrafting.ts      Helpers for Atlas-generated custom skill drafts
│   ├── toolPolicy.ts         Tool risk classification and approval policy helpers
│   ├── taskProfiler.ts       Phase/modality/reasoning inference for routing
│   ├── taskScheduler.ts      Parallel execution with Kahn's topological batching
│   ├── toolWebhookDispatcher.ts  Outbound tool lifecycle webhook delivery
│   ├── agentRegistry.ts      Agent CRUD and persistence
│   ├── skillsRegistry.ts     Skill CRUD and persistence
│   ├── modelRouter.ts        Budget/speed-aware model selection
│   └── costTracker.ts        Per-session cost accounting
├── mcp/
│   ├── mcpClient.ts          MCP SDK client wrapper (stdio/HTTP transports)
│   └── mcpServerRegistry.ts  MCP server config persistence + skill registration
├── memory/
│   └── memoryManager.ts      SSOT folder CRUD and search
├── providers/
│   ├── adapter.ts            ProviderAdapter interface and DiscoveredModel type
│   ├── anthropic.ts          Anthropic provider adapter
│   ├── copilot.ts            GitHub Copilot provider adapter
│   ├── modelCatalog.ts       Well-known model metadata catalog
│   ├── openai-compatible.ts  Shared OpenAI-compatible provider adapter
│   └── index.ts              Provider barrel exports
├── views/
│   ├── treeViews.ts          Sidebar tree data providers
│   ├── mcpPanel.ts           MCP server management webview
│   ├── modelProviderPanel.ts Model provider webview
│   ├── toolWebhookPanel.ts   Tool webhook management webview
│   ├── settingsPanel.ts      Settings webview
│   ├── voicePanel.ts         Voice Panel (TTS/STT webview)
│   ├── visionPanel.ts        Vision Panel (multimodal prompt webview)
│   ├── projectRunCenterPanel.ts Project Run Center (review/apply + run history webview)
│   └── webviewUtils.ts       Shared webview HTML helpers
├── skills/
│   ├── directoryList.ts      Directory listing skill
│   ├── fileEdit.ts           Targeted search/replace edit skill
│   ├── fileRead.ts           File read skill
│   ├── fileSearch.ts         File search by glob pattern skill
│   ├── gitCommit.ts          Git commit skill
│   ├── gitDiff.ts            Git diff inspection skill
│   ├── gitStatus.ts          Git status inspection skill
│   ├── memoryDelete.ts       Delete an SSOT memory entry (index + disk)
│   ├── memoryQuery.ts        Search SSOT memory entries
│   ├── memoryWrite.ts        Add/update SSOT entries with validation & persistence
│   ├── rollbackCheckpoint.ts Roll back the most recent automatic checkpoint
│   ├── terminalRun.ts        Allow-listed subprocess execution skill
│   └── textSearch.ts         Grep-style text search skill
├── voice/
│   └── voiceManager.ts       TTS queue + STT bridge (extension host side)
└── bootstrap/
    └── bootstrapper.ts       Project init (Git, SSOT, templates)

tests/
├── bootstrap/                Bootstrapper path validation tests
├── core/                     Unit tests for core services
├── mcp/                      Unit tests for MCP client and registry
├── memory/                   Memory manager and scanner tests
├── providers/                Provider adapter and registry tests
├── skills/                   Unit tests for built-in skills (read/search/edit/git/terminal)
└── views/                    Webview message validation tests

.github/
├── workflows/ci.yml          CI quality gate pipeline
├── ISSUE_TEMPLATE/           Structured issue intake
├── pull_request_template.md  PR checklist and quality gate prompts
└── CODEOWNERS                Review ownership rules
```

## Recommended VS Code Extensions

- GitHub Copilot
- GitHub Copilot Chat
- ESLint
- GitHub Pull Requests and Issues
- GitLens
- EditorConfig
- Prettier
- YAML

## SSOT Memory Structure

When bootstrapped, AtlasMind creates:

```
project_memory/
├── project_soul.md       Living project identity
├── architecture/         System design and diagrams
├── roadmap/              Feature plans and milestones
├── decisions/            Architecture Decision Records
├── misadventures/        Failed approaches and lessons
├── ideas/                Unstructured brainstorms
├── domain/               Domain knowledge and glossary
├── operations/           Runbooks, deploy procedures
├── agents/               Per-agent config and prompts
├── skills/               Skill definitions and schemas
└── index/                Embeddings and search index
```

## Documentation

Full documentation lives in [`docs/`](docs/):

- [Architecture Overview](docs/architecture.md)
- [Model Routing](docs/model-routing.md)
- [SSOT Memory System](docs/ssot-memory.md)
- [Agents & Skills](docs/agents-and-skills.md)
- [Development Guide](docs/development.md)
- [Configuration Reference](docs/configuration.md)
- [GitHub Workflow Standards](docs/github-workflow.md)

## Versioning

AtlasMind follows [Semantic Versioning](https://semver.org/). The version is tracked in `package.json` and recorded in [CHANGELOG.md](CHANGELOG.md). Every commit should be pushed.

## License

MIT
