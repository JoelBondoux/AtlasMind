<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind (Beta)</h1>

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

For a local installable extension package, use `npm run package:vsix`.
AtlasMind has runtime dependencies, so do not package or publish with `--no-dependencies` unless those dependencies are bundled into `out/` first.

After compiling, the same shared runtime is also available from the terminal:

```bash
npm run cli -- providers list
npm run cli -- chat "Summarise the current project memory"
```

The CLI reuses AtlasMind's orchestrator, routing, skills, and SSOT loading against the current workspace. Credentials come from environment variables derived from the VS Code secret keys, for example `ATLASMIND_PROVIDER_OPENAI_APIKEY`, `ATLASMIND_PROVIDER_ANTHROPIC_APIKEY`, `ATLASMIND_AZURE_OPENAI_ENDPOINT`, `ATLASMIND_AZURE_OPENAI_DEPLOYMENTS`, and `ATLASMIND_LOCAL_OPENAI_BASE_URL`.

CLI safety defaults are stricter than the extension host: AtlasMind CLI allows read-only tools by default, blocks external high-risk tools, and requires an explicit `--allow-writes` flag before workspace or git writes are permitted.

Press **F5** to launch the Extension Development Host, then type `@atlas` in the chat panel.

Recommended first steps:

1. Open **AtlasMind: Manage Model Providers** and add at least one provider.
  The Local provider can also be configured here for Ollama, LM Studio, Open WebUI, or another OpenAI-compatible local endpoint.
  Azure OpenAI and Amazon Bedrock are configured here too, with deployment and AWS-region specific setup.
2. If you want to use the Copilot provider, install the `GitHub Copilot Chat` extension and sign in.
3. If you prefer a dedicated assistant surface inside VS Code chrome, use the embedded **Chat** view in the AtlasMind sidebar container. It reuses the same session-aware Atlas chat surface as the detachable panel, so you can drag the view within VS Code layouts while keeping Atlas threads and runs close by.
4. If you want a larger detached workspace, open **AtlasMind: Open Chat Panel** or use `Ctrl+Alt+I` (`Cmd+Alt+I` on macOS). Assistant bubbles in that panel now show the routed model, a collapsible thinking summary for each reply, and an animated AtlasMind globe while the latest reply is still in progress; the composer also includes `Send` / `Steer` / `New Chat` / `New Session` modes, and you can attach open files or drag workspace files and URLs directly into the prompt area.
5. Use the **Sessions** sidebar to reopen chat threads and inspect autonomous project runs from one place.
6. Run `/bootstrap` for a new project or `/import` for an existing one. Import now builds a richer SSOT baseline from the workspace README, manifests, core docs, workflow guidance, security docs, and a focused codebase map so Atlas starts with materially better project context. Repeat imports track freshness metadata, skip unchanged generated entries, and preserve manually edited import artifacts instead of overwriting them. If the configured SSOT path or the default `project_memory/` folder already exists, AtlasMind auto-loads it on startup without requiring a manual import.
7. Try `@atlas /project` on a small task to see planning, approvals, and execution end to end. Short follow-ups such as `Proceed autonomously` or `Continue` can now promote the latest substantive request into an autonomous project run without repeating the full goal.

Useful command palette shortcuts:

- **AtlasMind: Getting Started** opens the onboarding walkthrough directly.
- **AtlasMind: Focus Chat View** reveals the embedded Atlas chat workspace inside the AtlasMind sidebar container.
- **AtlasMind: Open Settings Panel** opens a navigable AtlasMind settings workspace with dedicated pages for chat, models, safety, project runs, and experimental features, including a double-confirmed project-memory purge action on the Project page.
- **AtlasMind: Open Chat Settings / Open Model Settings / Open Safety Settings / Open Project Settings** jump directly into the matching AtlasMind settings page from the Command Palette.
- **AtlasMind: Open Chat Panel** opens a dedicated AtlasMind session workspace with persistent chat threads, per-reply model badges, collapsible thinking summaries, send-mode switching, queued attachments, open-file quick links, and direct visibility into recent autonomous runs. Shortcut: `Ctrl+Alt+I` (`Cmd+Alt+I` on macOS).
- **AtlasMind: Toggle Autopilot** toggles session-wide tool approval bypass from the Command Palette and pairs with a dedicated status bar indicator while Autopilot is enabled.
- **AtlasMind: Manage Model Providers** opens a searchable provider workspace with grouped pages for routed APIs and platform-backed providers.
- **AtlasMind: Specialist Integrations** opens a searchable specialist workspace that separates active workflow surfaces from future adapters.
- **AtlasMind: Manage Agents** opens a searchable agent workspace with overview, directory, and editor pages.
- **AtlasMind: Tool Webhooks** opens a searchable webhook workspace with overview, delivery, and history pages.
- The **Skills** sidebar keeps each row compact by showing only the skill name and action icons; descriptions remain available in the hover tooltip.
- The **Chat** and **Sessions** views in the AtlasMind sidebar now work together as an embedded Atlas workspace: the chat surface stays docked inside VS Code chrome, and sessions reopen directly into that view while autonomous runs remain one click away.
- The **Settings**, **Model Providers**, **Specialist Integrations**, **Manage Agents**, and **Tool Webhooks** panels now share the same page-based navigation model, and relevant surfaces can deep-link back into the matching Settings page.
- The **Memory** sidebar now exposes inline **Edit** and **Review** actions for each indexed SSOT entry so you can open the underlying file directly or get a natural-language summary before editing.
- The **Models** sidebar now exposes inline enable/disable, configure, refresh, info, and assign-to-agent actions for provider and model rows. Status is shown with colored icons, partially enabled providers get an extra bracketed warning marker, and unconfigured providers are grouped at the bottom while keeping their child models hidden until credentials are set.

For setup details, provider notes, and development workflows, see [docs/development.md](docs/development.md), [docs/model-routing.md](docs/model-routing.md), and [wiki/Getting-Started.md](wiki/Getting-Started.md).

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
