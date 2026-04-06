# Project Overview

Tags: #import #overview #readme #vscode #extension

# Project Overview

Tags: #import #overview #readme

<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind (Beta)</h1>

## What is AtlasMind?

AtlasMind turns VS Code into a full agentic development environment. Instead of a single chatbot, you get an **orchestrator** that picks the right agent, the right model, and the right tools for every task — then tracks cost and remembers decisions across sessions.

## Key Features

- **Multi-agent** — define specialised agents (architect, refactorer, tester, etc.) and let the orchestrator route work automatically
- **Multi-provider model routing** — Claude, GPT, Gemini, Azure OpenAI, Bedrock, DeepSeek, Mistral, z.ai, xAI, Cohere, Perplexity, Hugging Face Inference, NVIDIA NIM, Copilot, or local models. Budget and speed preferences steer selection
- **26 built-in skills** — file read/write/edit, git operations, diagnostics, code navigation, test running, web fetch, and more. Extend with custom skills or MCP servers
- **Long-term project memory (SSOT)** — decisions, architecture notes, domain knowledge, and lessons learned persist in a structured memory folder that agents can query and update
- **Project planner** — decompose goals into parallel subtasks, preview impact, gate execution with approvals, and review results
- **Cost tracking** — real-time per-session spend with budget guardrails

## Core Information

| Property | Value |
|---|---|
| **Extension Name** | AtlasMind |
| **Package** | atlasmind |
| **Current Version** | 0.36.21 |
| **Publisher** | JoelBondoux |
| **License** | MIT |
| **Repository** | https://github.com/JoelBondoux/AtlasMind.git |
| **Marketplace** | https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind |
| **VS Code Requirement** | ^1.95.0 |

## Quick Start

1. Install **AtlasMind** from the VS Code Marketplace
2. Open **AtlasMind: Manage Model Providers** and configure your first model provider
3. Start AtlasMind against your workspace:
   - For a new project, run `@atlas /bootstrap`
   - For an existing project, run `@atlas /import`
4. Ask AtlasMind to help with the next task in your editor

## Development Stack

- **Language**: TypeScript
- **Platform**: VS Code Extension
- **Test Framework**: Vitest
- **Linting**: ESLint
- **Package Manager**: npm
- **Build System**: TypeScript Compiler (tsc)

## Categories & Keywords

**Categories**: AI, Chat, Other
**Keywords**: ai, agents, orchestrator, multi-agent, llm, copilot

## Project Type

VS Code Extension - Developer-centric multi-agent orchestrator that lives inside VS Code with model routing, long-term memory, and skills registry.
