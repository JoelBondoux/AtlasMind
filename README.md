<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind</h1>

<p align="center"><sub> · <strong>Current source version: 0.64.1</strong> · </sub></p>


<p align="center">
  <strong>AtlasMind is your AI teammate for solo and small dev teams.</strong><br/>
  <em>Ship faster, automate the boring parts, and keep your project's brain in one place — all inside VS Code.</em>
</p>


---


AtlasMind is built for indie developers, freelancers, and small teams who want to get more done without context switching or tool overload. It's not just a chatbot — it's a multi-agent orchestrator that routes your tasks to the right AI, remembers your decisions, and helps you focus on what matters most.

**Why solo and small devs love AtlasMind:**

- **No more context switching:** Everything happens in your editor — chat, code, memory, and planning.
- **Automate the grind:** Refactoring, testing, docs, and more — handled by specialized agents.
- **Bring your own models:** Use Local LLM, OpenAI, Claude, Gemini, Azure, or your favorite provider. Mix and match for cost, speed, or quality.
- **Project memory that sticks:** AtlasMind remembers your architecture, decisions, and lessons learned, so you don't have to.
- **Stay in control:** Approvals, cost tracking, and safety guardrails keep you in the driver's seat.
- **Secure and reliable by default:** Strong security guardrails and a default red-green testing policy, so you can build with confidence from day one.
- **Everything at a glance:** Project, run, personality, and cost dashboards keep you in control — review agent runs, memory, and spend in one place.

---




## What Makes AtlasMind Different?




| Feature | AtlasMind | Copilot | Claude Code | Cline | Cursor |
|---|:---:|:---:|:---:|:---:|:---:|
| Multi-agent workflow | ✅ | <span title="Copilot supports some agent-like flows but not true multi-agent orchestration.">⚠️</span> | ✅ | <span title="Cline is a single agent with a plan/act loop, not multi-agent orchestration.">⚠️</span> | <span title="Cursor supports some agent-like flows but not true multi-agent orchestration.">⚠️</span> |
| Model provider choice | ✅ | <span title="Copilot supports only GitHub-hosted models, not bring-your-own.">⚠️</span> | <span title="Claude Code supports only Anthropic models.">⚠️</span> | <span title="Cline supports OpenAI-compatible providers and configurable endpoints.">✅</span> | ✅ |
| Project memory (SSOT) | ✅ | <span title="Copilot has session memory but not persistent project SSOT.">⚠️</span> | <span title="Claude Code has session memory but not persistent project SSOT.">⚠️</span> | <span title="Cline can use rules and context, but not AtlasMind-style persistent project SSOT.">⚠️</span> | <span title="Cursor has session memory but not persistent project SSOT.">⚠️</span> |
| Approval/safety gates | ✅ | <span title="Copilot has some safety checks but not approval gating.">⚠️</span> | ✅ | ✅ | <span title="Cursor has some safety checks but not approval gating.">⚠️</span> |
| Cost tracking | ✅ | ❌ | ❌ | <span title="Cline shows usage and token costs, but not AtlasMind-style cost dashboards.">⚠️</span> | ❌ |
| VS Code native | ✅ | ✅ | ✅ | ✅ | ✅ |
| Built-in dashboards | ✅ | <span title="Copilot has some usage stats but not full dashboards.">⚠️</span> | <span title="Claude Code has some usage stats but not full dashboards.">⚠️</span> | <span title="Cline surfaces usage and settings views, but not AtlasMind-style project/run/cost dashboards.">⚠️</span> | <span title="Cursor has some usage stats but not full dashboards.">⚠️</span> |
| Extensible with MCP servers | ✅ | ✅ | ✅ | ✅ | ✅ |
| Secure by default | ✅ | <span title="Copilot has security features but not full sandboxing or approval gating.">⚠️</span> | <span title="Claude Code has security features but not full sandboxing or approval gating.">⚠️</span> | <span title="Cline has strong approval controls, but not AtlasMind's full security guardrail stack.">⚠️</span> | <span title="Cursor has security features but not full sandboxing or approval gating.">⚠️</span> |
| Red-green testing policy | ✅ | ❌ | ❌ | ❌ | ❌ |

- **Multi-agent orchestration**: 15 built-in specialized agents — debugger, frontend/backend engineers, reviewer, security, SEO, UX, DevOps, and more — plus instant AI-drafted custom agents on demand.
- **Multi-provider model routing**: Supports GitHub Copilot, Claude, GPT, Gemini, Azure OpenAI, Bedrock, Mistral, and more. Budget and speed preferences steer selection automatically.
- **Built-in skills**: 35 pre-built skills including file editing, git, diagnostics, code navigation, test running, HTTP requests, Docker, web fetch, and more. Skills are grouped by category and support custom folders. Agents use AI-driven auto skill assignment by default.
- **Long-term project memory (SSOT)**: Decisions, architecture notes, and lessons learned persist in a structured memory folder. A dedicated Memory Agent maintains session context and keeps SSOT snippets fresh as source files evolve.
- **Project planner**: Decompose goals into subtasks, preview impact, gate execution, and review results.
- **Cost tracking**: Real-time per-session spend with budget guardrails and a daily cost limit.
- **MCP server support**: Extend AtlasMind with Model Context Protocol (MCP) servers for custom tools, agent extensions, and advanced workflows.
- **Voice & Vision**: Speak your prompts and hear responses via the Voice Panel (TTS/STT). Attach workspace images to any question via the Vision Panel for multimodal analysis.
- **Session management**: Name, organize into folders, archive, and restore chat sessions for long-running projects.

---



## Quick Start

1. Install **AtlasMind** from the VS Code Marketplace.
2. Open **AtlasMind: Manage Model Providers** and configure your first model provider.
3. Start AtlasMind in your workspace:
  - For a new project, run `@atlas /bootstrap`.
  - For an existing project, run `@atlas /import`.
4. Ask AtlasMind to help with your next task.

For advanced setup, provider notes, CLI usage, or development workflows, see:
- [Getting Started](wiki/Getting-Started.md)
- [CLI Usage](wiki/CLI.md)
- [Model Routing](docs/model-routing.md)
- [Development Guide](docs/development.md)

---

## Chat Slash Commands

Use these in the AtlasMind chat panel by typing `@atlas /<command>`.

| Command | Description |
|---|---|
| `/bootstrap` | Initialise a new project with SSOT memory structure |
| `/import` | Import an existing project by scanning files and populating memory |
| `/project <goal>` | Decompose a goal into tests-first subtasks and execute autonomously |
| `/agents` | List or manage registered agents |
| `/skills` | List or manage registered skills |
| `/memory` | Query or manage the SSOT memory system |
| `/cost` | Show cost summary for the current session |
| `/runs` | Open the Project Run Center and inspect recent autonomous runs |
| `/voice` | Open the Voice Panel for TTS and STT |
| `/vision` | Pick workspace images and ask a multimodal question |

---

## Extension Commands

Access these from the VS Code Command Palette (`Ctrl+Shift+P`).

| Command | Description |
|---|---|
| `AtlasMind: Getting Started` | Open the guided walkthrough |
| `AtlasMind: Open Chat Panel` | Open the detached chat panel (`Ctrl+Alt+I`) |
| `AtlasMind: Focus Chat View` | Focus the sidebar chat view |
| `AtlasMind: Manage Model Providers` | Configure API keys and provider quota |
| `AtlasMind: Manage Agents` | Create, edit, and enable/disable agents |
| `AtlasMind: Open Settings Panel` | Open the budget/speed settings panel |
| `AtlasMind: Open Personality Profile` | Configure Atlas's role, tone, and memory posture |
| `AtlasMind: Bootstrap Project` | Create SSOT memory structure for a new project |
| `AtlasMind: Import Existing Project` | Populate memory from an existing project |
| `AtlasMind: Update Project Memory` | Re-scan and refresh the SSOT memory |
| `AtlasMind: Open Cost Dashboard` | Per-session and per-model cost breakdown |
| `AtlasMind: Open Project Dashboard` | Project health, gap analysis, and roadmap |
| `AtlasMind: Open Project Ideation` | Ideation whiteboard before launching a project run |
| `AtlasMind: Open Project Run Center` | Task run history and checkpoint browser |
| `AtlasMind: Show Cost Summary` | Quick cost summary in the chat |
| `AtlasMind: Toggle Autopilot` | Toggle autopilot mode |
| `AtlasMind: Open Voice Panel` | Open TTS/STT voice interaction panel |
| `AtlasMind: Open Vision Panel` | Open multimodal image analysis panel |
| `AtlasMind: Manage MCP Servers` | Configure MCP server connections |
| `AtlasMind: Specialist Integrations` | Configure specialist search and media providers |
| `AtlasMind: Tool Webhooks` | Configure outbound tool execution webhooks |

---

## Sidebar Views

AtlasMind adds a sidebar with the following tree and webview panels:

| View | Description |
|---|---|
| **Quick Links** | Fast access to key panels and actions |
| **Chat** | Inline chat interface within the sidebar |
| **Project Runs** | History of autonomous project runs and checkpoints |
| **Sessions** | Named chat sessions with folder organization and archiving |
| **Memory (SSOT)** | Browse and edit SSOT memory entries |
| **Agents** | Enable/disable and inspect registered agents |
| **Skills** | Enable/disable, scan, and manage skills and custom folders |
| **MCP Servers** | Status and summary of connected MCP servers |
| **Models** | Available models by provider with enable/disable and routing controls |

---

## Built-in Agents

AtlasMind ships 15 specialized agents, automatically routed by task type.

| Agent | Role |
|---|---|
| **Default Assistant** | General-purpose coding and task assistant |
| **Workspace Debugger** | Root-cause diagnosis, error tracing, and fix verification |
| **Frontend Engineer** | UI components, CSS, accessibility, responsive layouts |
| **Backend Engineer** | APIs, services, databases, and server-side logic |
| **Code Reviewer** | Code quality, correctness, and improvement feedback |
| **Security Reviewer** | Threat modelling, vulnerability detection, and remediation |
| **GitHub Operator** | Pull requests, issues, CI/CD workflows, and git housekeeping |
| **Test Developer** | Unit, integration, E2E, regression tests — test-first by default |
| **Documentation Writer** | READMEs, API docs, JSDoc/TSDoc, wikis, and changelogs |
| **Performance Analyst** | CPU hot paths, memory leaks, slow queries, and benchmarks |
| **DevOps Engineer** | CI/CD pipelines, Docker, Kubernetes, Terraform, and IaC |
| **Dependency Manager** | Package updates, vulnerability remediation, and lockfile hygiene |
| **SEO Specialist** | Technical SEO, Core Web Vitals, structured data, AEO, GEO, LLMO |
| **UX Consultant** | UX critique, accessible UI generation, responsive design |
| **Memory Agent** | Background session context and SSOT snippet maintenance |

Agents use **AI-driven skill auto-assignment** by default — AtlasMind selects the best-fit skills for each agent's role automatically. Skills can also be assigned manually per agent.

Agents can be **auto-updated on a configurable cadence** (never/daily/weekly/monthly/every-use) so system prompts stay current with best practices and compliance requirements. Individual agents can opt out of auto-updates.

---

## Built-in Skills

35 built-in skills organized by category. All skills are enable/disable toggleable and undergo security scanning before use.

| Category | Skills |
|---|---|
| **Workspace Files** | file-read, file-write, file-edit, file-search, file-delete, file-move, directory-list |
| **Git & Review** | git-status, git-diff, git-commit, git-push, git-log, git-branch, git-apply-patch, rollback-checkpoint, diff-preview |
| **Execution & Testing** | terminal-run, terminal-read, test-run, debug-session, docker-cli, workspace-observability |
| **Code Intelligence** | diagnostics, code-symbols, rename-symbol, code-action, code-format |
| **Search & Fetch** | text-search, web-fetch, http-request, exa-search |
| **Memory** | memory-query, memory-write, memory-delete |
| **VS Code** | vscode-extensions |

Custom skills can be authored and loaded from any workspace folder. The Skills view supports folder organization and per-skill security scanning.

---

## Configuration

Key settings under `atlasmind.*` in VS Code settings:

| Setting | Default | Description |
|---|---|---|
| `budgetMode` | `balanced` | Model cost preference: `cheap`, `balanced`, `expensive`, `auto` |
| `speedMode` | `balanced` | Model speed preference: `fast`, `balanced`, `considered`, `auto` |
| `toolApprovalMode` | `ask-on-write` | When to prompt for tool approval: `always-ask`, `ask-on-write`, `ask-on-external`, `allow-safe-readonly` |
| `dailyCostLimitUsd` | `0` | Daily spend cap in USD (0 = unlimited) |
| `agentAutoUpdateCadence` | `never` | How often to AI-refresh agent definitions: `never`, `daily`, `weekly`, `monthly`, `every-use` |
| `maxToolIterations` | `10` | Max tool-call loop iterations per agent turn |
| `allowTerminalWrite` | `false` | Allow terminal subprocesses (installs, commits) after explicit approval |
| `autoVerifyAfterWrite` | `true` | Run verification scripts after workspace writes |
| `ssotPath` | `project_memory` | Relative path to the SSOT memory folder |
| `localOpenAiBaseUrl` | `http://127.0.0.1:11434/v1` | Base URL for Ollama or LM Studio |
| `toolWebhookEnabled` | `false` | Send tool execution events to an outbound webhook |

See [Configuration Reference](docs/configuration.md) and [wiki/Configuration.md](wiki/Configuration.md) for the full settings list.

---

## Open Source & Support

AtlasMind is fully open source and available under the permissive MIT license. There are no paywalls, feature gates, or commercial editions—just the full project, free for everyone.

If AtlasMind saves you time or helps your team, consider a pay-what-it's-worth donation to keep the project alive and thriving. Every bit of support helps sustain ongoing development.

See [Funding and Sponsorship](wiki/Funding-and-Sponsorship.md) for details.

---



## Learn More


- [Core Workflows](wiki/Chat-Commands.md)
- [Model Routing](docs/model-routing.md)
- [Agents & Skills](docs/agents-and-skills.md)
- [SSOT Memory System](docs/ssot-memory.md)
- [Configuration Reference](docs/configuration.md)
- [Roadmap](docs/roadmap.md)
- [Comparison Matrix](wiki/Comparison.md)
- [Funding and Sponsorship](wiki/Funding-and-Sponsorship.md)

---

## Contributing & License

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup and contribution guidelines.

MIT License — see [LICENSE]
