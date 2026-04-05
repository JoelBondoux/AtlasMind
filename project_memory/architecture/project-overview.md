# Project Overview

Tags: #import #overview #readme

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

Press **F5** to launch the Extension Development Host, then type `@atlas` in the chat panel.

Recommended first steps:

1. Open **AtlasMind: Manage Model Providers** and add at least one provider.
  The Local provider can also be configured here for Ollama, LM Studio, Open WebUI, or another OpenAI-compatible local endpoint.
  Azure OpenAI and Amazon Bedrock are configured here too, with deployment and AWS-region specific setup.
2. If you want to use the Copilot provider, install the `GitHub Copilot Chat` extension and sign in.
3. If you prefer a dedicated assistant surface, open **AtlasMind: Open Chat Panel**.
4. Use the new **Sessions** sidebar to reopen chat threads and inspect autonomous project runs from one place.
5. Run `/bootstrap` for a new project or `/import` for an existing one.
6. Try `@atlas /project` on a smal
…(truncated)
