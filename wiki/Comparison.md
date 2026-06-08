# Comparison

How AtlasMind compares to other AI coding tools.

> Capability comparisons are approximate and reflect the state of each tool as of mid-2025. Features evolve quickly — check each project's official docs for the latest. Entries marked ⚠️ indicate partial or limited support.

## Feature Matrix

### Editor Integration & Agents

| Capability | AtlasMind | Cline | Cursor | Windsurf | Continue | GitHub Copilot | Claude Code | Aider |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Runs inside VS Code (native extension) | ✅ | ✅ | ⚠️ fork | ⚠️ fork + extension | ✅ | ✅ | ⚠️ extension + CLI | ❌ CLI only |
| Inline code completions | ❌ | ❌ | ✅ | ✅ | ✅ tab autocomplete | ✅ | ❌ | ❌ |
| Multiple AI agents / orchestration | ✅ custom roles + routing | ⚠️ plan/act modes | ✅ background cloud agents | ✅ Cascade flows | ⚠️ tool-backed agent | ✅ Agent mode | ✅ subagents | ⚠️ architect/editor pair |
| Custom agent definitions | ✅ full CRUD + system prompt | ⚠️ custom modes/rules | ❌ | ❌ | ❌ | ❌ | ✅ CLAUDE.md per project | ❌ |
| Autonomous project planner | ✅ DAG decomposition + parallel batches | ⚠️ sequential plan/act | ✅ Composer + background | ✅ Cascade multi-step | ⚠️ agent tool loop | ✅ multi-step agent | ✅ agentic loop | ⚠️ architect mode |

### Model Routing

| Capability | AtlasMind | Cline | Cursor | Windsurf | Continue | GitHub Copilot | Claude Code | Aider |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Multi-provider model routing | ✅ 12+ providers | ✅ 8+ providers | ✅ 4+ providers | ✅ multiple | ✅ configurable | ✅ Claude/Gemini/GPT | ⚠️ primarily Claude | ✅ 8+ providers |
| Budget-aware model selection | ✅ cheap/balanced/expensive/auto modes | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Speed-aware model selection | ✅ fast/balanced/considered/auto modes | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Local model support (Ollama / LM Studio) | ✅ live catalog sync + lms install | ✅ via API base | ⚠️ via custom API | ❌ | ✅ | ❌ | ❌ | ✅ Ollama |
| Adaptive routing from task outcomes | ✅ fractional vote feedback loop | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Deprecation-aware routing | ✅ auto-excludes deprecated models | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Memory & Context

| Capability | AtlasMind | Cline | Cursor | Windsurf | Continue | GitHub Copilot | Claude Code | Aider |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Long-term project memory | ✅ structured SSOT folder | ⚠️ rules / workspace context | ⚠️ codebase index + .cursorrules | ⚠️ Memories auto-context | ⚠️ @docs + codebase index | ⚠️ custom instructions | ✅ CLAUDE.md + memory | ❌ |
| Per-session context carry-forward | ✅ compact session context.md | ⚠️ task history | ✅ conversation history | ✅ Cascade context | ⚠️ per-session chat | ✅ | ✅ | ❌ |
| Memory write-gate security scanning | ✅ 10-rule scanner | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Dispatch-time secret redaction | ✅ pattern registry, 7 patterns | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Skills & Tools

| Capability | AtlasMind | Cline | Cursor | Windsurf | Continue | GitHub Copilot | Claude Code | Aider |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Built-in skills / tools | 32 | ~20 | ~12 | ~10 | ~15 | ~10 | ~15 | ~6 |
| MCP server integration | ✅ stdio + HTTP/SSE | ✅ first-class marketplace | ✅ | ⚠️ via Cascade | ✅ | ✅ | ✅ | ❌ |
| Custom skill import + security scan | ✅ import + 12-rule scan | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Auto-synthesize new skills | ✅ on-the-fly synthesis | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Safety & Operations

| Capability | AtlasMind | Cline | Cursor | Windsurf | Continue | GitHub Copilot | Claude Code | Aider |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Per-tool approval gating (tiered modes) | ✅ 4 modes + task-scoped bypass + autopilot | ✅ per-step confirm | ⚠️ diff review | ⚠️ action confirm | ⚠️ tool confirm | ⚠️ per-tool confirm | ✅ permission modes | ⚠️ diff review |
| Pre-write rollback checkpoints | ✅ in-memory snapshots | ✅ task-level | ⚠️ history panel | ⚠️ limited | ❌ | ❌ | ✅ /rewind | ✅ git commits |
| Real-time cost tracking + dashboard | ✅ per-request + per-model dashboard | ⚠️ session cost shown | ❌ | ❌ | ❌ | ❌ | ⚠️ token usage shown | ❌ |
| Workspace file-system sandbox | ✅ path canonicalization | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ | ✅ |
| TDD red-green gate for writes | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### I/O & Integrations

| Capability | AtlasMind | Cline | Cursor | Windsurf | Continue | GitHub Copilot | Claude Code | Aider |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Vision / image input | ✅ | ✅ | ✅ | ⚠️ | ⚠️ via chat | ✅ | ✅ | ✅ |
| Voice input / TTS output | ✅ Web Speech + ElevenLabs | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| CLI companion | ✅ Atlas CLI (Node) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ primary | ✅ primary |
| Webhook integration for tool events | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Licensing & Philosophy

| Capability | AtlasMind | Cline | Cursor | Windsurf | Continue | GitHub Copilot | Claude Code | Aider |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Open source | ✅ MIT | ✅ Apache 2.0 | ❌ proprietary | ❌ proprietary | ✅ Apache 2.0 | ❌ proprietary | ❌ proprietary | ✅ Apache 2.0 |
| Works without an internet connection | ⚠️ local models required | ⚠️ local models required | ❌ | ❌ | ⚠️ local models required | ❌ | ❌ | ⚠️ local models required |

---

## Honest Gaps

AtlasMind is an orchestration and memory layer, not a completion engine. Features it intentionally does not provide:

- **Inline code completions / tab autocomplete** — pair AtlasMind with GitHub Copilot, Continue, or Windsurf if you want ghost-text suggestions in the editor.
- **Diff-based code review UI** — edits are made through tool calls; AtlasMind does not present a side-by-side diff panel natively.
- **Cloud-hosted background agents** — project planner runs execute locally in the extension host; there is no cloud-side agent pool.

---

## Key Differentiators

### vs. Cline

Cline is the closest open-source alternative — both run natively in VS Code with multi-provider routing, task approval, MCP, and checkpoints. AtlasMind goes further with:

- **Explicit budget/speed routing modes** with multi-tier model scoring instead of per-request API key usage.
- **Structured SSOT memory** (folder hierarchy, security-scanned writes, source-backed retrieval, dispatch-time secret redaction) instead of workspace rules files.
- **Full custom agent definitions** with system prompt, skill assignment, and allowed model whitelists.
- **Auto-synthesized skills** — when Atlas lacks a tool for a request it synthesizes one on the fly; Cline uses its built-in toolkit only.
- **Cost dashboard** with per-model and per-session breakdown and thumbs-feedback integration.
- **TDD red-green gate** — blocks non-test writes until a failing test signal exists.

### vs. Cursor

Cursor is a VS Code fork with strong inline completions and background cloud agents. AtlasMind runs in standard VS Code and emphasizes:

- **Budget-aware cross-provider routing** — Cursor locks you to its model list at subscription tiers; AtlasMind routes across any configured provider using cost, speed, and task profile signals.
- **Persistent SSOT memory** with security scanning, secret redaction, and source-backed live evidence retrieval.
- **Custom agent and skill registry** — Cursor has no equivalent to AtlasMind's agent/skill CRUD.
- **Adaptive routing from outcomes** — task success/failure feeds fractional preference votes back into future model selection.

### vs. Windsurf

Windsurf (Codeium's VS Code fork) offers Cascade flows and automatic memory context. AtlasMind differs by:

- Running as a standard VS Code extension (no fork required).
- Providing explicit budget/speed routing instead of a fixed model tier.
- Structured, security-scanned SSOT memory rather than opaque automatic context.
- MCP integration with first-class stdio and HTTP/SSE transports.
- Full local model support with live Ollama and LM Studio catalog sync.

### vs. Continue

Continue is a strong open-source extension focused on tab autocomplete and configurable chat. AtlasMind differs by:

- Having **no inline completions** — pair them for best of both worlds.
- Adding an autonomous project planner, structured SSOT memory, skill registry with security scanning, and budget-aware multi-provider routing that Continue does not provide.

### vs. GitHub Copilot

AtlasMind complements Copilot rather than replacing it — Copilot is even a supported provider in AtlasMind's router. Use Copilot for inline suggestions; use AtlasMind for multi-step orchestration, persistent project memory, and cross-provider model routing that includes Copilot-backed models when quota allows.

### vs. Claude Code

Claude Code is Anthropic's own agentic CLI with strong tool use, MCP, and `/rewind` checkpoints. AtlasMind runs alongside it (Claude CLI is a registered provider) and adds:

- **Multi-provider budget routing** across 12+ providers, not just Claude.
- **Structured SSOT memory** vs. CLAUDE.md flat files.
- **Custom skill registry with security scanning** and on-the-fly synthesis.
- **VS Code-native UI** — agent panel, skill editor, cost dashboard, project run center.
- **Adaptive routing** from task outcome feedback.

### vs. Aider

Aider is a terminal-first, git-native pair programmer. AtlasMind offers a native VS Code experience with structured project memory, multi-provider budget routing, a skill ecosystem, approval gating, cost tracking, voice/vision, and project planner execution that Aider's CLI model does not support.
