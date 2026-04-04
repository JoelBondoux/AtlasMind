# Comparison

How AtlasMind compares to other AI coding tools.

## Feature Matrix

| Feature | AtlasMind | Claude Code | Cursor | GitHub Copilot | Aider | OpenHands |
|---------|-----------|-------------|--------|----------------|-------|-----------|
| **Multi-agent orchestration** | ✅ Custom agents with roles, prompts, skill/model constraints | ❌ | ❌ | ❌ | ❌ | ✅ Agents |
| **Persistent project memory** | ✅ SSOT folder with 11 categories | ❌ | ❌ | ❌ | ✅ Repo map | ❌ |
| **Multi-model routing** | ✅ 8 providers, budget/speed-aware | ❌ Anthropic only | ✅ Multiple | ❌ Copilot only | ✅ Multiple | ✅ Multiple |
| **Budget/speed control** | ✅ 4 budget × 4 speed modes | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Subscription quota tracking** | ✅ Conservation at 30% | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Autonomous multi-step execution** | ✅ DAG planner with parallel batches | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Tool approval gating** | ✅ 4 configurable modes | ✅ | ✅ | ✅ | ❌ | ✅ |
| **Pre-write checkpoints** | ✅ Automatic snapshots | ❌ | ❌ | ❌ | ✅ Git-based | ❌ |
| **Post-write verification** | ✅ Auto-run tests/lint | ❌ | ❌ | ❌ | ✅ Lint/test | ❌ |
| **Custom skills (plugins)** | ✅ JS skills + MCP servers | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Skill security scanner** | ✅ 12 rules, error/warning | ❌ | ❌ | ❌ | ❌ | ❌ |
| **MCP integration** | ✅ stdio + HTTP | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Code intelligence (LSP)** | ✅ Symbols, refs, rename, actions | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Vision / multimodal** | ✅ Image analysis | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Voice (TTS/STT)** | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Tool webhooks** | ✅ Outbound HTTPS | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Cost tracking** | ✅ Per-session, per-provider | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Project run history** | ✅ Persistent run center | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Works inside VS Code** | ✅ Native extension | ❌ CLI | ✅ Fork | ✅ Extension | ❌ CLI | ❌ Browser |
| **Open source** | ✅ MIT | ✅ MIT | ❌ | ❌ | ✅ Apache 2.0 | ✅ MIT |
| **Free to use** | ✅ (API costs apply) | ❌ Subscription | ❌ Subscription | ❌ Subscription | ✅ (API costs) | ✅ (API costs) |

## Key Differentiators

### vs. Claude Code
Claude Code is a powerful CLI tool from Anthropic. AtlasMind differs by living inside VS Code with a native chat experience, supporting 8+ model providers (not just Anthropic), offering persistent project memory, custom agents, and a full skill registry with security scanning.

### vs. Cursor
Cursor is a VS Code fork with built-in AI. AtlasMind runs as an extension in standard VS Code — no fork required. It adds multi-agent orchestration, persistent memory, autonomous project execution, and MCP integration that Cursor doesn't offer.

### vs. GitHub Copilot
AtlasMind complements Copilot. Use Copilot for inline completions and AtlasMind for orchestrated multi-step tasks, project memory, multi-model routing, and autonomous execution. AtlasMind can even route through Copilot's models.

### vs. Aider
Aider is a CLI tool focused on pair programming. AtlasMind provides a richer experience inside VS Code with multiple agents, persistent memory, vision/voice, MCP tools, and budget-aware routing.

### vs. OpenHands
OpenHands (formerly OpenDevin) focuses on autonomous coding via a browser UI. AtlasMind provides a native VS Code experience with project memory, budget control, and enterprise safety features (approval gating, security scanning, checkpoints).
