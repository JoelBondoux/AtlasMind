# AtlasMind Wiki

Welcome to the **AtlasMind** wiki — a comprehensive guide to the multi-agent AI orchestrator for VS Code.

This wiki is the deeper reference layer behind the streamlined repository README.

<p align="center">
  <img src="https://raw.githubusercontent.com/JoelBondoux/AtlasMind/master/media/icon.svg" width="100" alt="AtlasMind logo" />
</p>

---

## What is AtlasMind?

AtlasMind turns VS Code into a full agentic development environment. Instead of a single chatbot, you get an **orchestrator** that picks the right agent, the right model, and the right tools for every task — then tracks cost and remembers decisions across sessions.

**Key highlights:**

- **Multi-agent** — define specialised agents (architect, tester, security reviewer, etc.) and let the orchestrator route automatically
- **Multi-provider model routing** — Claude, GPT, Gemini, DeepSeek, Mistral, z.ai, GitHub Copilot, or local models. Budget and speed preferences steer selection
- **26 built-in skills** — file I/O, git operations, diagnostics, code navigation, test running, web fetch, and more
- **Long-term project memory (SSOT)** — decisions, architecture notes, domain knowledge, and lessons persist in a structured memory folder
- **Autonomous project planner** — decompose goals into parallel subtasks, preview impact, gate with approvals, and review results
- **Real-time cost tracking** — per-session spend with budget guardrails

---

## Quick Navigation

| Page | Description |
|------|-------------|
| [[Getting Started]] | Install, configure, and run your first command |
| [[Architecture]] | System design, core services, data flow |
| [[Chat Commands]] | All `@atlas` slash commands with usage examples |
| [[Agents]] | Built-in and custom agent definitions |
| [[Skills]] | 26 built-in skills, custom skill import, MCP tools |
| [[Model Routing]] | Provider setup, budget/speed modes, routing algorithm |
| [[Memory System]] | SSOT folder structure, retrieval, bootstrapping, import |
| [[Project Planner]] | Autonomous task decomposition and parallel execution |
| [[Tool Execution]] | Approval gating, terminal allow-list, checkpoints, webhooks |
| [[Configuration]] | All extension settings with defaults |
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

> Capability comparisons are approximate and reflect the state of each tool as of early 2026. Check each project's docs for the latest.

---

## License

AtlasMind is open-source under the [MIT License](https://github.com/JoelBondoux/AtlasMind/blob/master/LICENSE).
