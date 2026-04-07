# AtlasMind Wiki

AtlasMind is a VS Code extension for developers who want AI help with more control: model choice, persistent project memory, approvals, cost visibility, and extensibility through custom skills or MCP servers.

It is built for teams that want autonomy without hand-waving. AtlasMind keeps safety and security controls visible, prefers evidence over blind execution, and is designed to support red/green TDD-style delivery instead of implementation-first guesswork.

This wiki is the reference layer behind the shorter repository README. Use it for setup details, command reference, architecture notes, and configuration depth.

Current repository workflow: `develop` is the default branch for routine integration, and `master` is reserved for release-ready pre-release promotions from `develop`.

Marketplace publication remains pre-release only until AtlasMind reaches `1.0.0`.

Published Marketplace version numbers appear in the Marketplace badge and changelog highlights. The source version for the branch you are currently viewing always comes from that branch's `package.json`.

<p align="center">
  <img src="https://raw.githubusercontent.com/JoelBondoux/AtlasMind/master/media/icon.svg" width="100" alt="AtlasMind logo" />
</p>

---

## What is AtlasMind?

AtlasMind turns VS Code into an agentic development environment. Instead of a single chat surface, it gives you an **orchestrator** that selects the right agent, the right model, and the right tools for each task, then keeps project context and execution state visible.

**Key highlights:**

- **Multi-agent** — define specialised agents (architect, tester, security reviewer, etc.) and let the orchestrator route automatically
- **Multi-provider model routing** — Claude, GPT, Gemini, Azure OpenAI, Bedrock, DeepSeek, Mistral, z.ai, GitHub Copilot, or local models. Budget and speed preferences steer selection
- **31 built-in skills** — file I/O, git operations, diagnostics, code navigation, test running, web fetch, VS Code surfaces, and more
- **Shared runtime plugin API** — register agents, skills, providers, and lifecycle listeners without patching core bootstrap code
- **Long-term project memory (SSOT)** — decisions, architecture notes, domain knowledge, and lessons persist in a structured memory folder
- **Autonomous project planner** — decompose goals into parallel subtasks, preview impact, gate with approvals, and review results
- **Safety-first execution** — approval gates, memory scanning, verification hooks, and explicit operator controls are built in from the start
- **Red/green development bias** — AtlasMind is designed to support tests-first autonomous execution instead of opaque one-shot code generation
- **Real-time cost tracking** — per-session spend with budget guardrails
- **Operator surfaces** — dedicated Model Providers, Agents, Settings, Project Dashboard, Project Ideation, Sessions, and Project Run Center views for configuration, approvals, diagnostics, and failure review

For headless workflows, the CLI now rejects malformed flags instead of treating them as prompt text and exposes first-class `--help` and `--version` flows.

---

## Quick Navigation

| Page | Description |
|------|-------------|
| [[Getting Started]] | Install, configure, and run your first command |
| [[CLI]] | Use AtlasMind from the terminal with the shared runtime and safety model |
| [[Architecture]] | System design, core services, data flow |
| [[Chat Commands]] | Slash commands, Command Palette surfaces, and view-local sidebar actions |
| [[Agents]] | Built-in and custom agent definitions |
| [[Skills]] | 31 built-in skills, custom skill import, and MCP tools |
| [[Model Routing]] | Provider setup, budget/speed modes, routing algorithm |
| [[Memory System]] | SSOT folder structure, retrieval, bootstrapping, import |
| [[Project Planner]] | Autonomous task decomposition and parallel execution |
| [[Tool Execution]] | Approval gating, terminal allow-list, checkpoints, webhooks |
| [[Configuration]] | All extension settings with defaults and recommended starting points |
| [[Funding and Sponsorship]] | How to support ongoing AtlasMind development |
| [[Security]] | Security model, boundaries, vulnerability reporting |
| [[Contributing]] | Dev setup, coding conventions, PR checklist |
| [[FAQ]] | Common questions and troubleshooting |
| [[Comparison]] | How AtlasMind compares to Claude Code, Cursor, Copilot, Aider, and Open Hands |
| [[Changelog]] | Version history and release notes |

---

## How It Compares

| Capability | AtlasMind | Claude Code | Cursor | Copilot | Aider | Open Hands |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Runs inside VS Code | ✅ | ✅ | ✅ (fork) | ✅ | ❌ (terminal) | ❌ (browser/GUI) |
| Multiple AI agents | ✅ | ✅ | ❌ | ⚠️ sessions and agent types | ❌ | ✅ |
| Custom agent definitions | ✅ | ✅ | ❌ | ✅ | ❌ | ⚠️ limited |
| Multi-provider model routing | ✅ | ⚠️ third-party providers | ✅ | ⚠️ built-in and third-party agents | ✅ | ✅ |
| Budget-aware model selection | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Long-term project memory | ✅ (SSOT) | ⚠️ (CLAUDE.md + memory) | ❌ | ⚠️ custom instructions/context | ❌ | ❌ |
| Memory security scanning | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Built-in skills / tools | 31 | ~15 | ~10 | ~8 | ~6 | ~20 |
| MCP server integration | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Custom skill import | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Autonomous project planner | ✅ | ⚠️ agent workflows | ⚠️ plan mode | ⚠️ plan agent | ❌ | ✅ |
| Per-tool approval gating | ✅ | ✅ | ✅ | ⚠️ varies by agent/tool | ✅ | ❌ |
| Real-time cost tracking | ✅ | ❌ | ❌ | ❌ | ⚠️ basic | ❌ |
| Rollback checkpoints | ✅ | ❌ | ❌ | ❌ | ✅ (git) | ❌ |
| Voice input/output | ✅ | ❌ | ❌ | ❌ | ⚠️ voice input | ❌ |
| Vision / image input | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Open source | ✅ MIT | ❌ | ❌ | ❌ | ✅ Apache | ⚠️ core MIT |

> Capability comparisons are approximate and reflect the state of each tool as of early 2026. Check each project's docs for the latest.

---

## License

AtlasMind is open-source under the [MIT License](https://github.com/JoelBondoux/AtlasMind/blob/master/LICENSE).
