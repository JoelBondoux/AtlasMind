<p align="center">
  <!-- SVG works on GitHub and VS Code Marketplace renderers -->
  <img src="media/icon.svg" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind</h1>

<p align="center">
  <strong>A multi-agent AI orchestrator that lives inside VS Code.</strong><br/>
  Route tasks across models, maintain long-term project memory, and let specialised agents handle the work — without leaving your editor.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#what-can-it-do">Features</a> ·
  <a href="#how-it-compares">Comparison</a> ·
  <a href="#support-atlasmind">Support</a> ·
  <a href="docs/">Full Docs</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

## What is AtlasMind?

AtlasMind turns VS Code into a full agentic development environment. Instead of a single chatbot, you get an **orchestrator** that picks the right agent, the right model, and the right tools for every task — then tracks cost and remembers decisions across sessions.

- **Multi-agent** — define specialised agents (architect, refactorer, tester, etc.) and let the orchestrator route work automatically.
- **Multi-provider model routing** — Claude, GPT, Gemini, DeepSeek, Mistral, z.ai, Copilot, or a local model. Budget and speed preferences steer selection.
- **26 built-in skills** — file read/write/edit, git operations, diagnostics, code navigation, test running, web fetch, and more. Extend with custom skills or MCP servers.
- **Long-term project memory (SSOT)** — decisions, architecture notes, domain knowledge, and lessons learned persist in a structured memory folder that agents can query and update.
- **Project planner** — decompose goals into parallel subtasks, preview impact, gate execution with approvals, and review results.
- **Cost tracking** — real-time per-session spend with budget guardrails.

## How it Compares

| Capability | AtlasMind | Claude Code | Cursor | GitHub Copilot | Aider | Open Hands |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Runs inside VS Code | ✅ | ✅ | ✅ (fork) | ✅ | ❌ (terminal) | ❌ (browser/GUI) |
| Multiple AI agents | ✅ | ✅ | ❌ | ⚠️ sessions and agent types | ❌ | ✅ |
| Custom agent definitions | ✅ | ✅ | ❌ | ✅ | ❌ | ⚠️ limited |
| Multi-provider model routing | ✅ | ⚠️ third-party providers | ✅ | ⚠️ built-in and third-party agents | ✅ | ✅ |
| Budget-aware model selection | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Long-term project memory | ✅ (SSOT) | ⚠️ (CLAUDE.md + memory) | ❌ | ⚠️ custom instructions/context | ❌ | ❌ |
| Memory security scanning | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Built-in skills / tools | 26 | ~15 | ~10 | ~8 | ~6 | ~20 |
| MCP server integration | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Custom skill import | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Autonomous project planner | ✅ | ⚠️ agent workflows | ⚠️ plan mode | ⚠️ plan agent | ❌ | ✅ |
| Per-tool approval gating | ✅ | ✅ | ✅ | ⚠️ varies by agent/tool | ✅ | ❌ |
| Real-time cost tracking | ✅ | ❌ | ❌ | ❌ | ⚠️ basic | ❌ |
| Rollback checkpoints | ✅ | ❌ | ❌ | ❌ | ✅ (git) | ❌ |
| Voice input/output | ✅ | ❌ | ❌ | ❌ | ⚠️ voice input | ❌ |
| Vision / image input | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Open source | ✅ MIT | ❌ | ❌ | ❌ | ✅ Apache | ⚠️ core MIT |

> **Note**: Capability comparisons are approximate and reflect the state of each tool as of early 2026. Check each project's docs for the latest.

## What Can It Do?

### Chat with `@atlas`

Type `@atlas` in the VS Code chat panel. The orchestrator selects the best agent and model, then executes with the right tools.

| Slash Command | What it does |
|---|---|
| `/bootstrap` | Set up SSOT memory structure and optional CI/governance scaffolding |
| `/import` | Scan an existing project and populate memory with dependencies, structure, conventions |
| `/project` | Decompose a goal into subtasks, preview impact, and execute with approvals |
| `/runs` | Review, edit, and re-run autonomous project plans |
| `/agents` | List and manage agents |
| `/skills` | List and manage skills |
| `/memory` | Query project memory |
| `/cost` | Show session spend |
| `/voice` | Open the Voice Panel (TTS/STT) |
| `/vision` | Attach images for multimodal prompts |

### Extension Commands

Open the Command Palette (`Ctrl+Shift+P`) and search **AtlasMind** for one-click access to:

- **Settings Panel** — budget/speed sliders, approval policies, verification config
- **Model Providers** — add API keys, refresh model lists, manage providers
- **Manage Agents** — create and configure custom agents
- **Project Run Center** — review, approve, pause, and resume autonomous runs
- **MCP Servers** — connect external tool servers
- **Tool Webhooks** — forward tool events to external endpoints
- **Voice / Vision Panels** — TTS, STT, and image-based prompts

See the full command list in the [Development Guide](docs/development.md).

### Skills (26 Built-in)

AtlasMind ships with 26 built-in skills that agents can call during execution:

| Category | Skills |
|---|---|
| **Files** | `file-read` (with line ranges), `file-write`, `file-edit`, `file-search`, `file-delete`, `file-move`, `directory-list` |
| **Git** | `git-status`, `git-diff`, `git-commit`, `git-log`, `git-branch`, `git-apply-patch`, `diff-preview`, `rollback-checkpoint` |
| **Code Intelligence** | `diagnostics`, `code-symbols`, `rename-symbol`, `code-action` |
| **Search & Fetch** | `text-search`, `memory-query`, `web-fetch` |
| **Memory** | `memory-write`, `memory-delete` |
| **Execution** | `terminal-run` (tiered allow-list), `test-run` (vitest/jest/mocha/pytest/cargo) |

You can also import custom skills or connect MCP servers for unlimited extensibility. See [Agents & Skills](docs/agents-and-skills.md) for details.

### Supported Providers

| Provider | Models |
|---|---|
| Anthropic | Claude 4, Sonnet, Haiku |
| OpenAI | GPT-4o, o1, o3 |
| Google | Gemini 2.5 Pro, Flash |
| DeepSeek | DeepSeek-V3, R1 |
| Mistral | Large, Medium, Small |
| z.ai | Grok |
| GitHub Copilot | Copilot models |
| Local (Ollama, LM Studio, etc.) | Any OpenAI-compatible endpoint |

The model router picks the best available model based on your **budget** and **speed** preferences. See [Model Routing](docs/model-routing.md).

### Security

AtlasMind defaults to the safest reasonable behaviour:

- API keys stored in VS Code SecretStorage — never on disk or in settings
- Webviews are nonce-protected with validated message handling
- Memory writes are scanned for prompt injection and credential leakage
- File operations are workspace-sandboxed with path traversal rejection
- Terminal execution uses a tiered allow-list with blocked dangerous commands
- Per-tool approval gating with configurable policies

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Support AtlasMind

AtlasMind remains fully open source under the MIT license. There is no paywall, no feature gating, and no commercial-only edition.

If AtlasMind saves you time or helps your team, you can support ongoing development on a pay-what-you-want basis through [GitHub Sponsors](https://github.com/sponsors/JoelBondoux).

Suggested tiers:

| Tier | Suggested Amount | What They Get |
|---|---|---|
| Supporter | £3-£5/mo | A thank-you and an optional name listing in [CONTRIBUTORS.md](CONTRIBUTORS.md) |
| Sustainer | £10-£20/mo | Early access to roadmap discussions and voting on priorities |
| Backer | £50+/mo | Priority consideration for integrations and feature proposals, priority issue triage, and wider public recognition including in changelogs |
| Sponsor | £100-£500/mo | Logo on the README, listed as a sponsor, and direct async access for questions |
| One-Off PWYW | Any amount | A one-time pay-what-it's-worth contribution with no ongoing commitment |

Support is still support, not product access. Funding helps sustain work on:

- maintenance and bug fixes
- new providers, skills, and agent capabilities
- documentation, testing, and release hygiene

If you choose public recognition, sponsor acknowledgements can be added to [CONTRIBUTORS.md](CONTRIBUTORS.md).

## Quick Start

**Prerequisites:** VS Code ≥ 1.95.0 · Node.js ≥ 18

```bash
npm install
npm run compile
```

Press **F5** to launch the Extension Development Host, then type `@atlas` in the chat panel.

To configure a model provider, run **AtlasMind: Manage Model Providers** from the Command Palette and add your API key.

For watch mode, tests, CI coverage scope, and packaging see the [Development Guide](docs/development.md).

## Configuration

AtlasMind is configured through VS Code settings (`atlasmind.*`). Key settings:

| Setting | Default | What it controls |
|---|---|---|
| `budgetMode` | `balanced` | Model cost preference: `cheap` · `balanced` · `expensive` · `auto` |
| `speedMode` | `balanced` | Model speed preference: `fast` · `balanced` · `considered` · `auto` |
| `dailyCostLimitUsd` | `0` | Daily spend cap in USD. `0` disables it; AtlasMind warns at 80% and blocks new requests at the limit |
| `toolApprovalMode` | `ask-on-write` | When to prompt before tool execution |
| `ssotPath` | `project_memory` | Where project memory lives |
| `maxToolIterations` | `10` | Maximum tool-call loop iterations per agent turn |
| `maxToolCallsPerTurn` | `8` | Maximum parallel tool calls per model turn |
| `toolExecutionTimeoutMs` | `15000` | Per-tool execution timeout (ms) |
| `providerTimeoutMs` | `30000` | Model provider response timeout (ms) |

See [all settings](docs/development.md#configuration) for the complete reference.

## Project Structure

```
src/
├── extension.ts          Entry point — creates services, registers commands/views
├── types.ts              Shared interfaces (OrchestratorHooks, OrchestratorConfig, etc.)
├── constants.ts          Centralised tunable constants (~40 values)
├── chat/                 @atlas chat participant and session context
├── core/                 Orchestrator, planner, agents, skills, model router, cost tracker
├── memory/               SSOT memory manager and scanner
├── providers/            Model provider adapters (Anthropic, OpenAI, Copilot, etc.)
├── skills/               26 built-in skill implementations + shared validation helpers
├── views/                Webview panels and sidebar tree views
├── mcp/                  MCP client and server registry
├── voice/                TTS/STT bridge
├── bootstrap/            Project initialisation, import, and templates
└── utils/                Shared utilities (workspace picker, etc.)

media/
└── walkthrough/          Getting Started walkthrough content (4 steps)

tests/                    Vitest test suites (46 files, 399 tests)
  └── integration/        Multi-component integration tests
docs/                     Technical documentation
```

See [Architecture Overview](docs/architecture.md) for the full dependency graph and data flow.

## Documentation

Full documentation lives in [`docs/`](docs/):

- [Architecture Overview](docs/architecture.md)
- [Model Routing](docs/model-routing.md)
- [SSOT Memory System](docs/ssot-memory.md)
- [Agents & Skills](docs/agents-and-skills.md)
- [Development Guide](docs/development.md)
- [Configuration Reference](docs/configuration.md)
- [GitHub Workflow Standards](docs/github-workflow.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, conventions, and how to add providers, agents, or skills.

## License

MIT — see [LICENSE](LICENSE)
