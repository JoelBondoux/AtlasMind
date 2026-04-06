<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind (Beta)</h1>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind">
    <img src="https://img.shields.io/visual-studio-marketplace/v/JoelBondoux.atlasmind?label=marketplace" alt="Latest published VS Code Marketplace version" />
  </a>
</p>

<p align="center"><sub>Badge shows the latest published Marketplace release. Branch contents may be ahead of or behind that version.</sub></p>

<p align="center">
  <strong>A multi-agent AI orchestrator that lives inside VS Code.</strong><br/>
  Route tasks across models, maintain long-term project memory, and let specialised agents handle the work — without leaving your editor.
</p>

<p align="center">
  <a href="#what-is-atlasmind">Overview</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#core-workflows">Workflows</a> ·
  <a href="#how-it-compares">Comparison</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="#support-atlasmind">Support</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

## What is AtlasMind?

AtlasMind turns VS Code into a full agentic development environment. Instead of a single chatbot, you get an **orchestrator** that picks the right agent, the right model, and the right tools for every task — then tracks cost and remembers decisions across sessions.

- **Multi-agent** — define specialised agents (architect, refactorer, tester, etc.) and let the orchestrator route work automatically.
- **Multi-provider model routing** — Claude, GPT, Gemini, Azure OpenAI, Bedrock, DeepSeek, Mistral, z.ai, xAI, Cohere, Perplexity, Hugging Face Inference, NVIDIA NIM, Copilot, or a local model. Budget and speed preferences steer selection.
- **31 built-in skills** — file read/write/edit, git operations, diagnostics, code navigation, test running, web fetch, VS Code extensions/ports, terminal inspection, and more. The Skills sidebar now groups bundled skills by category and lets custom skills live inside persistent nested folders.
- **Shared runtime plugin API** — the extension and CLI expose an explicit runtime plugin contract for registering agents, skills, providers, and lifecycle listeners without patching core bootstrap code.
- **Long-term project memory (SSOT)** — decisions, architecture notes, domain knowledge, and lessons learned persist in a structured memory folder that agents can query and update.
- **Project planner** — decompose goals into parallel subtasks, preview impact, gate execution with approvals, and review results.
- **Cost tracking** — real-time per-session spend with budget guardrails.

| At a Glance | |
|---|---|
| Best for | VS Code users who want agentic workflows without leaving the editor |
| Core strengths | Multi-agent orchestration, model routing, project memory, approval-gated execution |
| Learn next | [Quick Start](#quick-start), [Core Workflows](#core-workflows), [Documentation](#documentation) |

---

## Quick Start

1. Install **AtlasMind** from the VS Code Marketplace.
2. Open **AtlasMind: Manage Model Providers** and configure your first model provider.
3. Start AtlasMind against your workspace:
   For a new project, run `@atlas /bootstrap`.
   For an existing project, run `@atlas /import`.
4. Ask AtlasMind to help with the next task in your editor.

That is the minimum setup path. AtlasMind stores provider credentials in VS Code SecretStorage and will auto-load the configured SSOT path or default `project_memory/` folder when present. If imported SSOT memory has drifted behind the current workspace, AtlasMind now warns on startup, exposes an update action in the Memory view title bar, and pins a warning row at the top of the Memory tree until the import is refreshed.

For day-to-day control, AtlasMind exposes dedicated surfaces for provider setup, agent toggling, safety settings, run inspection, and failure review: **Manage Model Providers**, **Manage Agents**, **Open Settings Panel**, **Open Project Dashboard**, the embedded **Chat** view, and the **Project Run Center**. The Chat, Sessions, and Memory sidebar views also keep quick title-bar shortcuts for settings, the project dashboard, the cost dashboard, and SSOT import/update so those controls stay local to the views operators are already using. For headless use, the CLI now exposes validated `--help` and `--version` flows and rejects malformed flags instead of silently treating them as prompt text.

If you want deeper setup, provider-specific notes, CLI usage, or development workflows, continue with [wiki/Getting-Started.md](wiki/Getting-Started.md), [wiki/CLI.md](wiki/CLI.md), [docs/model-routing.md](docs/model-routing.md), and [docs/development.md](docs/development.md).

For repository development, CI still compiles, lints, and tests on Ubuntu, Windows, and macOS, while the coverage artifact is generated and uploaded from the Ubuntu leg only.

Repository automation now also monitors dependency and integration drift: Dependabot watches npm packages and GitHub Actions, a scheduled integration-monitor workflow tracks curated VS Code Marketplace extensions and emits a review issue when their versions move, and CI now fails if a future third-party provider, specialist integration, or recommended extension is added without corresponding monitoring coverage.

For Atlas-built projects, the Settings workspace now also lets operators define default dependency-governance scaffolding. Bootstrap can generate Dependabot, Renovate, Snyk, or Azure DevOps-oriented review scaffolds plus SSOT policy templates so downstream repos start with a reviewable update process instead of ad hoc dependency drift.

Repository workflow note: `develop` is now the default branch for routine work, and `master` is updated only by promoting `develop` for a pre-release publish. See [docs/github-workflow.md](docs/github-workflow.md).

AtlasMind's routed provider list focuses on chat-capable model backends. Specialist speech, search, image, and video APIs live behind the Specialist Integrations panel and existing Voice/Vision surfaces rather than being treated as drop-in chat providers.

---

## Core Workflows

| Workflow | What it covers | Read more |
|---|---|---|
| Chat and slash commands | Direct work through `@atlas`, plus `/bootstrap`, `/import`, `/project`, `/runs`, `/agents`, `/skills`, `/memory`, `/cost`, `/voice`, and `/vision`; short continuation prompts can also escalate into autonomous project execution | [wiki/Chat-Commands.md](wiki/Chat-Commands.md) |
| Model routing | Budget, speed, capability, provider-health-aware model selection, and persistent per-provider/per-model availability controls | [docs/model-routing.md](docs/model-routing.md) |
| Agents, skills, and MCP | Custom agents, built-in skills, imported skills, and MCP server extensions | [docs/agents-and-skills.md](docs/agents-and-skills.md) |
| Interactive operations | Agent Manager, Model Providers, Settings, and an AtlasMind sidebar whose default tree order is Project Runs, Sessions, Memory, Agents, Skills, MCP, then Models, with VS Code persisting each user's later reordering and open-state choices | [docs/development.md](docs/development.md) |
| Project memory | SSOT storage for architecture notes, decisions, and reusable project context | [docs/ssot-memory.md](docs/ssot-memory.md) |
| Safety controls | Approval gating, sandboxing, memory scanning, and tool/webhook safety | [SECURITY.md](SECURITY.md) |

### Extension Commands

#### Command Palette

AtlasMind’s palette-driven operational surfaces are:

| Command | What it does |
|---|---|
| `AtlasMind: Open Project Dashboard` | Opens the cross-cutting command center for repo health, runtime state, SSOT, security, delivery workflow, and review-readiness signals |
| `AtlasMind: Open Project Run Center` | Reviews autonomous runs, approvals, pauses, retries, and generated reports |
| `AtlasMind: Update Project Memory` | Re-runs AtlasMind's import pipeline for the current workspace so stale imported SSOT entries are refreshed from the latest codebase snapshot |
| `AtlasMind: Manage Model Providers` | Configures routed providers and refreshes model availability |
| `AtlasMind: Manage Agents` | Edits custom agents and reviews current assignments |
| `AtlasMind: Open Settings Panel` | Opens the multi-page configuration workspace for routing, safety, chat, and project controls |

The sidebar info actions now route summaries back into Atlas chat: Agent, Skill, Memory, Model, and MCP Server info buttons post a concise assistant-style summary into the active session and focus the chat view on that note.

#### Sidebar Actions

These stay local to their owning views instead of appearing in the Command Palette:

| Action | Where it appears | What it does |
|---|---|---|
| `Summarize Agent In Chat` | Agents row inline action | Posts a concise summary of the selected agent into the active Atlas chat session |
| `Toggle Agent Enabled` | Agents row inline action | Enables or disables the selected agent |
| `Add Skill` | Skills view title bar or folder row | Starts a new custom skill inside the selected folder context |
| `Create Skill Folder` | Skills view title bar or folder row | Creates a persistent custom folder for nested skill grouping |
| `Configure Scanner Rules` | Skills view title bar | Opens the skill security scanning rules |
| `Summarize Skill In Chat` | Skills row inline action | Posts a concise summary of the selected skill into the active Atlas chat session |
| `Scan Skill` | Skills row inline action | Runs a security scan for the selected skill |
| `Toggle Skill Enabled` | Skills row inline action | Enables or disables the selected skill |
| `Show Scan Details` | Skills row context action | Opens the latest scan details for the selected skill |
| `Summarize MCP Server In Chat` | MCP Servers row inline action | Posts a concise summary of the selected MCP server into the active Atlas chat session |
| `Toggle Model Enabled` | Models row inline action | Enables or disables a provider or individual model |
| `Summarize Model In Chat` | Models row inline action | Posts a concise summary of the selected provider or model into the active Atlas chat session |
| `Configure Model Provider` | Provider row action | Prompts for provider credentials or opens local model configuration |
| `Refresh Available Models` | Configured provider row action | Refreshes the routed provider catalog after credential or upstream changes |
| `Assign To Agents` | Model row inline action | Assigns a provider's models or an individual model to selected agents |
| `Rename Session` | Sessions row inline action and `F2` | Renames the selected chat thread |
| `Create Session Folder` | Sessions view title bar | Creates a persistent folder for filing related chat threads |
| `Move Session To Folder` | Sessions row context action | Files the selected chat thread into an existing folder, a new folder, or back to the top level |
| `Archive Session` | Sessions row context action | Moves the selected chat thread out of the active Sessions list |
| `Restore Session` | Archived Sessions row context action | Returns the selected archived thread to the active Sessions list |
| `Edit Memory File` | Memory row inline action | Opens the selected SSOT entry in the editor |
| `Summarize Memory In Chat` | Memory row inline action | Posts a concise summary of the selected SSOT entry into the active Atlas chat session |

---

## How it Compares

| Capability | AtlasMind | Claude Code | Cursor | GitHub Copilot | Aider | Open Hands |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Runs inside VS Code | ✅ | ✅ | ✅ (fork) | ✅ | ❌ | ❌ |
| Multiple AI agents | ✅ | ✅ | ❌ | ⚠️ | ❌ | ✅ |
| Multi-provider routing | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | ✅ |
| Long-term project memory | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | ❌ |
| Approval gating and checkpoints | ✅ | ✅ | ✅ | ⚠️ | ✅ | ❌ |
| Cost-aware planning | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

> **Note**: Capability comparisons are approximate and reflect the state of each tool as of early 2026. Check each project's docs for the latest.

The full comparison matrix and product notes live in [wiki/Comparison.md](wiki/Comparison.md).

---

## Support AtlasMind

AtlasMind remains fully open source under the MIT license. There is no paywall, no feature gating, and no commercial-only edition.

If AtlasMind saves you time or helps your team, you can support ongoing development through [GitHub Sponsors](https://github.com/sponsors/JoelBondoux).

Sponsorship details, suggested levels, and team-oriented support notes live in [wiki/Funding-and-Sponsorship.md](wiki/Funding-and-Sponsorship.md).

---

## Configuration

AtlasMind is configured through VS Code settings (`atlasmind.*`). The most important settings to start with are:

Every AtlasMind setting now includes a detailed hover tooltip in the VS Code Settings UI, with extra guidance and examples for local, team, and larger-scale automation setups.

| Setting | Default | What it controls |
|---|---|---|
| `budgetMode` | `balanced` | Model cost preference: `cheap` · `balanced` · `expensive` · `auto` |
| `speedMode` | `balanced` | Model speed preference: `fast` · `balanced` · `considered` · `auto` |
| `feedbackRoutingWeight` | `1` | How strongly stored thumbs-up or thumbs-down feedback nudges future model routing. `0` disables feedback-weighted routing while higher values keep the effect capped but more noticeable |
| `dailyCostLimitUsd` | `0` | Daily spend cap in USD. `0` disables it; AtlasMind warns at 80% and blocks new requests at the limit |
| `toolApprovalMode` | `ask-on-write` | When to prompt before tool execution; approval dialogs also support `Allow Once`, task-scoped `Bypass Approvals`, and session-wide `Autopilot` |
| `showImportProjectAction` | `true` | Whether the Memory sidebar shows the Import Existing Project toolbar action |
| `projectDependencyMonitoringProviders` | `["dependabot"]` | Which dependency-update services AtlasMind scaffolds for project governance baselines. Supports Dependabot, Renovate, Snyk, and Azure DevOps pipeline scaffolding |
| `projectDependencyMonitoringSchedule` | `weekly` | The default cadence AtlasMind writes into generated dependency-monitoring automation |
| `azureOpenAiEndpoint` | `""` | Azure OpenAI resource URL used with deployment-based routing |
| `bedrock.region` | `""` | AWS region for Amazon Bedrock routing |
| `ssotPath` | `project_memory` | Where project memory lives. On startup AtlasMind only auto-loads this configured path or the default `project_memory/` folder when it already exists |

See [docs/configuration.md](docs/configuration.md) for the full settings reference.

---

## Project Structure

The repository is organized around a few major areas:

- `src/core` — orchestration, planning, routing, checkpoints, cost tracking
- `src/runtime`, `src/cli` — shared runtime construction plus the Node-hosted CLI surface
- `src/chat`, `src/views`, `src/voice` — chat and UI surfaces, including the session-aware chat workspace, folder-aware Skills tree, Project Dashboard, Sessions sidebar, and specialist integration panels
- `src/providers`, `src/skills`, `src/mcp` — model adapters and execution tools, including the shared provider registry/local adapter, Azure routing, and Bedrock routing
- `src/memory`, `src/bootstrap` — SSOT memory and project onboarding/import flows
- `.github` — CI, Dependabot, curated integration drift tracking, and scheduled repository automation
- `tests`, `docs`, `wiki` — automated verification, including CLI/runtime coverage, and deeper documentation

See [docs/architecture.md](docs/architecture.md) for the full dependency graph and [docs/development.md](docs/development.md) for the complete project structure.

---

## Documentation

Use the README for the short overview, then go deeper as needed:

- [Architecture Overview](docs/architecture.md)
- [Model Routing](docs/model-routing.md)
- [SSOT Memory System](docs/ssot-memory.md)
- [Agents & Skills](docs/agents-and-skills.md)
- [Development Guide](docs/development.md)
- [Configuration Reference](docs/configuration.md)
- [GitHub Workflow Standards](docs/github-workflow.md)
- [Wiki Home](wiki/Home.md)
- [Comparison Matrix](wiki/Comparison.md)
- [Funding and Sponsorship](wiki/Funding-and-Sponsorship.md)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, conventions, and how to add providers, agents, or skills.

---

## License

MIT — see [LICENSE](LICENSE)

<!-- atlasmind-import
entry-path: architecture/project-overview.md
generator-version: 2
generated-at: 2026-04-06T07:08:53.338Z
source-paths: README.md
source-fingerprint: 09ed1337
body-fingerprint: 252c2536
-->
