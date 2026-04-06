# Product Capabilities

Imported from `README.md`.

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

## Core Workflows

| Workflow | What it covers | Read more |
|---|---|---|
| Chat and slash commands | Direct work through `@atlas`, plus `/bootstrap`, `/import`, `/project`, `/runs`, `/agents`, `/skills`, `/memory`, `/cost`, `/voice`, and `/vision`; `/project` now plans and executes code-changing work with a tests-first autonomous delivery bias, blocks non-test implementation writes until Atlas has observed a failing test signal, and exposes per-subtask TDD telemetry in the Project Run Center | [wiki/Chat-Commands.md](wiki/Chat-Commands.md) |
| Model routing | Budget, speed, capability, provider-health-aware model selection, and persistent per-provider/per-model availability controls | [docs/model-routing.md](docs/model-routing.md) |
| Agents, skills, and MCP | Custom agents, built-in skills, imported skills, and MCP server extensions | [docs/agents-and-skills.md](doc
…(truncated)

<!-- atlasmind-import
entry-path: domain/product-capabilities.md
generator-version: 2
generated-at: 2026-04-06T11:14:21.330Z
source-paths: README.md | package.json
source-fingerprint: ce5cf972
body-fingerprint: 57d84398
-->
