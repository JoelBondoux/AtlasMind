<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind</h1>

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
- **Multi-provider model routing** — Claude, GPT, Gemini, DeepSeek, Mistral, z.ai, Copilot, or a local model. Budget and speed preferences steer selection.
- **26 built-in skills** — file read/write/edit, git operations, diagnostics, code navigation, test running, web fetch, and more. Extend with custom skills or MCP servers.
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

**Prerequisites:** VS Code >= 1.95.0 · Node.js >= 18

```bash
npm install
npm run compile
```

Press **F5** to launch the Extension Development Host, then type `@atlas` in the chat panel.

Recommended first steps:

1. Open **AtlasMind: Manage Model Providers** and add at least one provider.
2. If you want to use the Copilot provider, install the `GitHub Copilot Chat` extension and sign in.
3. Run `/bootstrap` for a new project or `/import` for an existing one.
4. Try `@atlas /project` on a small task to see planning, approvals, and execution end to end.

Useful command palette shortcuts:

- **AtlasMind: Getting Started** opens the onboarding walkthrough directly.
- **AtlasMind: Manage Model Providers** opens provider setup.
- **AtlasMind: Manage Agents** opens the custom agent editor.

For setup details, provider notes, and development workflows, see [docs/development.md](docs/development.md), [docs/model-routing.md](docs/model-routing.md), and [wiki/Getting-Started.md](wiki/Getting-Started.md).

---

## Core Workflows

| Workflow | What it covers | Read more |
|---|---|---|
| Chat and slash commands | Direct work through `@atlas`, plus `/bootstrap`, `/import`, `/project`, `/runs`, `/agents`, `/skills`, `/memory`, `/cost`, `/voice`, and `/vision` | [wiki/Chat-Commands.md](wiki/Chat-Commands.md) |
| Model routing | Budget, speed, capability, and provider-health-aware model selection across supported providers | [docs/model-routing.md](docs/model-routing.md) |
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

| Setting | Default | What it controls |
|---|---|---|
| `budgetMode` | `balanced` | Model cost preference: `cheap` · `balanced` · `expensive` · `auto` |
| `speedMode` | `balanced` | Model speed preference: `fast` · `balanced` · `considered` · `auto` |
| `dailyCostLimitUsd` | `0` | Daily spend cap in USD. `0` disables it; AtlasMind warns at 80% and blocks new requests at the limit |
| `toolApprovalMode` | `ask-on-write` | When to prompt before tool execution |
| `ssotPath` | `project_memory` | Where project memory lives |

See [docs/configuration.md](docs/configuration.md) for the full settings reference.

---

## Project Structure

The repository is organized around a few major areas:

- `src/core` — orchestration, planning, routing, checkpoints, cost tracking
- `src/chat`, `src/views`, `src/voice` — chat and UI surfaces
- `src/providers`, `src/skills`, `src/mcp` — model adapters and execution tools
- `src/memory`, `src/bootstrap` — SSOT memory and project onboarding/import flows
- `tests`, `docs`, `wiki` — automated verification and deeper documentation

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
