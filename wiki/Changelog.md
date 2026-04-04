# Changelog

This page highlights major releases. For the complete changelog, see [CHANGELOG.md](https://github.com/JoelBondoux/AtlasMind/blob/master/CHANGELOG.md) in the repository.

---

## v0.28.x — Project Import & Stability

- **`/import` command** — Scan existing workspaces and auto-populate SSOT memory from manifests, READMEs, configs, and license files
- **TypeScript fixes** — Added `"types": ["node"]` to tsconfig for full Node.js global support
- **Documentation overhaul** — Comprehensive README rewrite with logo, comparison table, and complete feature coverage

## v0.27.x — Skills Gap Analysis & README

- **11 new skills** — `code-symbols`, `rename-symbol`, `code-action`, `web-fetch`, `diff-preview`, `rollback-checkpoint`, `test-run`, `diagnostics`, `file-move`, `file-delete`, `git-branch`
- **README overhaul** — Logo, competitor comparison table, comprehensive feature documentation

## v0.26.x — MCP Integration

- **MCP client** — Connect external tool servers via stdio or HTTP transport
- **MCP server registry** — Persistent server configs with auto-reconnect
- **MCP tools as skills** — External tools seamlessly appear in the skill registry

## v0.25.x — Project Planner

- **`/project` command** — Decompose goals into DAGs of subtasks
- **TaskScheduler** — Topological sort into parallel batches
- **Ephemeral agents** — Role-specific agents for each subtask
- **Project Run History** — Persistent run records with the Run Center

## v0.24.x — Skill Security Scanner

- **Static analysis** — 12 built-in rules for custom skill validation
- **Scanner Rules Manager** — Configure rules via webview panel
- **Pre-enablement gate** — Custom skills must pass scanning before use

## v0.23.x — Voice & Vision

- **Voice Panel** — TTS and STT via Web Speech API
- **Vision Panel** — Image picker for multimodal prompts
- **`/voice` and `/vision` commands**

## v0.22.x — Tool Webhooks

- **Outbound webhooks** — Forward tool lifecycle events to external HTTPS endpoints
- **Configurable events** — tool.started, tool.completed, tool.failed
- **Webhook management panel**

## v0.21.x — Cost Tracking & Budget Control

- **CostTracker** — Per-session, per-provider cost accumulation
- **Budget modes** — cheap, balanced, expensive, auto
- **Speed modes** — fast, balanced, considered, auto
- **`/cost` command**

## v0.20.x — Multi-Agent Orchestration

- **AgentRegistry** — Custom agents with roles, prompts, and constraints
- **Agent selection** — Token overlap scoring for best-fit selection
- **Agent Manager Panel** — Create and configure agents via webview

## Earlier Releases

See [CHANGELOG.md](https://github.com/JoelBondoux/AtlasMind/blob/master/CHANGELOG.md) for the complete version history.
