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
- **31 built-in skills** — file read/write/edit, git operations, diagnostics, code navigation, test running, web fetch, VS Code extensions/ports, terminal inspection, and more. Extend with custom skills or MCP servers.
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

That is the minimum setup path. AtlasMind stores provider credentials in VS Code SecretStorage and will auto-load the configured SSOT path or default `project_memory/` folder when present.

If you want deeper setup, provider-specific notes, CLI usage, or development workflows, continue with [wiki/Getting-Started.md](wiki/Getting-Started.md), [wiki/CLI.md](wiki/CLI.md), [docs/model-routing.md](docs/model-routing.md), and [docs/development.md](docs/development.md).

For repository development, CI still compiles, lints, and tests on Ubuntu, Windows, and macOS, while the coverage artifact is generated and uploaded from the Ubuntu leg only.

Repository workflow note: `develop` is now the default branch for routine work, and `master` is updated only by promoting `develop` for a pre-release publish. See [docs/github-workflow.md](docs/github-workflow.md).

AtlasMind's routed provider list focuses on chat-capable model backends. Specialist speech, search, image, and video APIs live behind the Specialist Integrations panel and existing Voice/Vision surfaces rather than being treated as drop-in chat providers.

---

## Core Workflows

| Workflow | What it covers | Read more |
|---|---|---|
| Chat and slash commands | Direct work through `@atlas`, plus `/bootstrap`, `/import`, `/project`, `/runs`, `/agents`, `/skills`, `/memory`, `/cost`, `/voice`, and `/vision`; short continuation prompts can also escalate into autonomous project execution | [wiki/Chat-Commands.md](wiki/Chat-Commands.md) |
| Model routing | Budget, speed, capability, provider-health-aware model selection, and persistent per-provider/per-model availability controls | [docs/model-routing.md](docs/model-routing.md) |
| Agents, skills, and MCP | Custom agents, built-in skills, imported skills, and MCP server extensions | [docs/agents-and-skills.md](docs/agents-and-skills.md) |
| Project memory | SSOT storage for architecture notes, decisions, and reusable project context | [docs/ssot-memory.md](docs/ssot-memory.md) |
| Safety controls | Approval gating, sandboxing, memory scanning, and tool/webhook safety | [SECURITY.md](SECURITY.md) |

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
| `dailyCostLimitUsd` | `0` | Daily spend cap in USD. `0` disables it; AtlasMind warns at 80% and blocks new requests at the limit |
| `toolApprovalMode` | `ask-on-write` | When to prompt before tool execution; approval dialogs also support `Allow Once`, task-scoped `Bypass Approvals`, and session-wide `Autopilot` |
| `showImportProjectAction` | `true` | Whether the Sessions sidebar shows the Import Existing Project toolbar action |
| `azureOpenAiEndpoint` | `""` | Azure OpenAI resource URL used with deployment-based routing |
| `bedrock.region` | `""` | AWS region for Amazon Bedrock routing |
| `ssotPath` | `project_memory` | Where project memory lives. On startup AtlasMind only auto-loads this configured path or the default `project_memory/` folder when it already exists |

See [docs/configuration.md](docs/configuration.md) for the full settings reference.

---

## Project Structure

The repository is organized around a few major areas:

- `src/core` — orchestration, planning, routing, checkpoints, cost tracking
- `src/runtime`, `src/cli` — shared runtime construction plus the Node-hosted CLI surface
- `src/chat`, `src/views`, `src/voice` — chat and UI surfaces, including the session-aware chat workspace, Sessions sidebar, and specialist integration panels
- `src/providers`, `src/skills`, `src/mcp` — model adapters and execution tools, including the shared provider registry/local adapter, Azure routing, and Bedrock routing
- `src/memory`, `src/bootstrap` — SSOT memory and project onboarding/import flows
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
