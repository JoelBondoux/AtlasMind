<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind (Beta)</h1>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind">
    <img src="https://img.shields.io/visual-studio-marketplace/v/JoelBondoux.atlasmind?label=marketplace%20release" alt="Latest published VS Code Marketplace release" />
  </a>
</p>

<p align="center"><sub>Badge shows the published Marketplace release. The source version for the branch you are viewing lives in <a href="package.json">package.json</a>.</sub></p>

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
- **Multimodal project ideation board** — the Project Dashboard now includes a collaborative ideation whiteboard where you and Atlas can add cards, connect themes, attach images, capture voice prompts, and iterate on ideas together.
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

That is the minimum setup path. AtlasMind stores provider credentials in VS Code SecretStorage and will auto-load the configured SSOT path or default `project_memory/` folder when present. If imported SSOT memory has drifted behind the current workspace, AtlasMind now warns on startup, exposes an update action in the Memory view title bar, and pins a warning row at the top of the Memory tree until the import is refreshed. The Memory tree is also folder-aware, so SSOT storage folders such as `architecture`, `decisions`, and `operations` remain visible and expandable as the document set grows.

For day-to-day control, AtlasMind exposes dedicated surfaces for provider setup, agent toggling, safety settings, run inspection, and failure review: **Manage Model Providers**, **Manage Agents**, **Open Settings Panel**, **Open Project Dashboard**, **Open Project Ideation**, the embedded **Chat** view, and the **Project Run Center**. The Project Dashboard now also includes a guided ideation workspace with a whiteboard canvas, Atlas facilitation history, queued follow-up prompts, image attachments, and browser-side voice input/output, alongside the existing repo, runtime, SSOT, security, delivery, and `/project` TDD signals. The Chat and Project Runs sidebar views now expose a direct ideation shortcut in the title bar, while the Chat, Sessions, and Memory sidebar views still keep quick title-bar shortcuts for settings, the project dashboard, the cost dashboard, and SSOT import/update so those controls stay local to the views operators are already using. For headless use, the CLI now exposes validated `--help` and `--version` flows and rejects malformed flags instead of silently treating them as prompt text.

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
| Chat and slash commands | Direct work through `@atlas`, plus `/bootstrap`, `/import`, `/project`, `/runs`, `/agents`, `/skills`, `/memory`, `/cost`, `/voice`, and `/vision`; `/project` now plans and executes code-changing work with a tests-first autonomous delivery bias, blocks non-test implementation writes until Atlas has observed a failing test signal, and exposes per-subtask TDD telemetry in the Project Run Center | [wiki/Chat-Commands.md](wiki/Chat-Commands.md) |
| Model routing | Budget, speed, capability, provider-health-aware model selection, and persistent per-provider/per-model availability controls | [docs/model-routing.md](docs/model-routing.md) |
| Agents, skills, and MCP | Custom agents, built-in skills, imported skills, and MCP server extensions | [docs/agents-and-skills.md](docs/agents-and-skills.md) |
| Interactive operations | Agent Manager, Model Providers, Settings, the Project Dashboard ideation whiteboard, and an AtlasMind sidebar whose default tree order is Project Runs, Sessions, Memory, Agents, Skills, MCP, then Models, with VS Code persisting each user's later reordering and open-state choices | [docs/development.md](docs/development.md) |
| Project memory | SSOT storage for architecture notes, decisions, and reusable project context | [docs/ssot-memory.md](docs/ssot-memory.md) |
| Safety controls | Approval gating, sandboxing, memory scanning, and tool/webhook safety | [SECURITY.md](SECURITY.md) |

### Commands and Actions

The README stays at the overview layer. Detailed command, palette, and sidebar-action reference material lives in [wiki/Chat-Commands.md](wiki/Chat-Commands.md).

| Surface | What to expect | Canonical reference |
|---|---|---|
| `@atlas` slash commands | Bootstrap and import flows, tests-first autonomous project execution, run inspection, agent and skill management, memory queries, cost, voice, and vision entry points | [wiki/Chat-Commands.md](wiki/Chat-Commands.md) |
| Command Palette | Top-level AtlasMind surfaces such as Settings, Model Providers, Agents, MCP Servers, Project Dashboard, Project Ideation, Project Run Center, Voice, Vision, and Cost | [wiki/Chat-Commands.md](wiki/Chat-Commands.md) |
| View-local sidebar actions | Inline actions for Agents, Skills, Sessions, Memory, Models, and MCP Servers that stay attached to the tree rows and title bars where they make sense | [wiki/Chat-Commands.md](wiki/Chat-Commands.md) |

The rule of thumb is simple: palette commands open AtlasMind surfaces, while row actions stay local to the sidebar view that owns them.

The sidebar info actions now route summaries back into Atlas chat, so Agent, Skill, Memory, Model, and MCP Server info buttons post a concise assistant-style note into the active session instead of sending you elsewhere.

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

AtlasMind is configured through VS Code settings under the `atlasmind.*` namespace. The README keeps the shape of the configuration surface, while the full reference lives in [docs/configuration.md](docs/configuration.md) and [wiki/Configuration.md](wiki/Configuration.md).

| Configuration area | What it covers |
|---|---|
| Model routing | Budget and speed mode, thumbs-feedback weighting, local/OpenAI-compatible endpoints, Azure OpenAI deployments, and Bedrock region/model IDs |
| Safety and verification | Tool approval mode, terminal-write approval, automatic post-write verification, and webhook delivery controls |
| Chat and memory | Session carry-forward limits, SSOT path selection, and Memory view affordances |
| Project execution | Approval thresholds, report locations, and bootstrap governance scaffolding defaults |
| Voice and spend limits | Speech controls plus daily cost guardrails |

Every AtlasMind setting includes a detailed hover tooltip in the VS Code Settings UI, and the AtlasMind Settings workspace groups the same settings into searchable pages for chat, models, safety, and project execution.

If you only need a starting point, begin with `atlasmind.budgetMode`, `atlasmind.speedMode`, `atlasmind.toolApprovalMode`, `atlasmind.dailyCostLimitUsd`, and `atlasmind.ssotPath`, then use the full configuration reference for the rest.

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
