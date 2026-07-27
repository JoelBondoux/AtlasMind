<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind</h1>

<p align="center"><sub> · <strong>Current source version: 0.148.1</strong> · </sub></p>

<p align="center">
  <strong>BETA</strong><br />
  <strong>Your AI delivery team, inside VS Code.</strong><br />
  <em>Turn an idea into coordinated, verified work without losing the decisions that got you there.</em>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind"><strong>Install from the VS Code Marketplace</strong></a>
  ·
  <a href="wiki/Getting-Started.md">Getting Started</a>
  ·
  <a href="docs/architecture.md">How it works</a>
</p>

---

## Build with a team, not another tab

AtlasMind gives solo developers, freelancers, and small teams the coordination of a larger engineering organisation without making them leave the editor.

Describe the outcome you want. AtlasMind selects an appropriate specialist, routes the task to a suitable configured model, gathers project evidence, carries the work through tools, and shows you what changed. Decisions, architecture, lessons, and run history remain attached to the project instead of disappearing with the chat.

You stay in charge. Approval gates, budgets, verification, protected delivery stages, and visible guardrails make ambitious automation reviewable rather than mysterious.

### Move from intent to finished work

Use a focused chat turn for a small fix, `/project` for a coordinated delivery plan, or Mission Control for a goal-seeking run bounded by cost, time, tokens, iterations, and approval checkpoints.

### Bring the models you already trust

Connect cloud providers, subscription-backed models, or local OpenAI-compatible runtimes such as Ollama and LM Studio. AtlasMind routes by task fit, capability, health, budget, speed, and observed outcomes.

### Keep your project's brain

The structured SSOT memory records architecture, decisions, roadmap context, operations, lessons learned, agents, and skills. AtlasMind can retrieve that context later while still checking live source files for claims that need current evidence.

### See the work, not just the answer

Project Dashboard, Project Run Center, Cost Dashboard, Mission Control, Website Studio, and the Personality Profile turn hidden orchestration state into something you can inspect and steer.

### Grow the team around the project

Start with 18 built-in agents and 43 built-in skills. Add custom agents, assign models and testing responsibilities, connect MCP servers, or discover new agentic resources when the project needs more.

---

## From idea to delivery

1. **Connect your models.** Bring one provider or several; AtlasMind can also use local models.
2. **Give AtlasMind the project context.** Bootstrap a new project or import an existing repository into structured project memory.
3. **Choose the level of autonomy.** Ask for one task, preview a multi-step project run, or launch a bounded Mission Loop.
4. **Review the evidence.** Inspect agent choice, model choice, tool activity, verification, cost, changed files, and unresolved blockers.
5. **Promote deliberately.** Move work through guarded delivery stages with preflight, backup, approval, and verification gates.

AtlasMind is designed to carry work forward while keeping the operator informed enough to intervene.

---

## What's new in 0.148.1

Since the last Marketplace publication, **v0.145.3**, source builds have added:

- **Reading Buzz activity back in.** AtlasMind can now hold a live subscription to a Buzz relay: it authenticates, subscribes, keeps itself genuinely in contact (a wake lock can't save a dropped socket, so there's a keep-alive with backoff reconnect), and turns activity into follow-ups. External conversations are **derived, never mirrored** — a message becomes a follow-up with a pointer back to the thread, never the message body, because project memory is committed to your repository and a mirrored channel would put colleagues' chat in your git history. The subscription is **read-only by construction**: it can never publish to Buzz. Two pieces remain before it's switched on — Schnorr signing for authenticating relays, and validation against a real Buzz instance.
- **Buzz can now send for real through the guarded connector path.** A bundled communication-only MCP bridge wraps the pinned official Buzz CLI for channel posts, thread reads, and DMs; it stores the agent key in SecretStorage, passes message bodies over stdin, enforces local/remote relay policy, and keeps Buzz traffic from being misrouted through Slack or Teams.
- **Workspace memory stays out of source and release archives.** Git ignores the local memory backup, while VSIX packaging excludes every `project_memory*` directory before Marketplace publication.
- **Model refreshes now remove what providers removed.** Successful empty catalogs prune stale entries, and provider-confirmed deprecated or missing models cannot be resurrected by a later stale refresh.
- **Assessment handoffs are actionable.** Proposed autonomous work ends with a chat card offering **Start run**, **Save for later**, or **Cancel**; only Autopilot may auto-start a proposal.
- **Reasoning plans now hand off to tooling models.** Non-synthesis project steps are grounded with live workspace evidence skills, and a model that says its tools are disabled is rerouted instead of being counted as a successful executor.
- **Execution limits end with a decision, not an inert warning.** When a chat or project run reaches its tool cap, AtlasMind asks whether to use the suggested limit for this run, save it permanently, or keep the partial result; the one-run choice restores the prior setting afterward.
- **Local savings are visible at a glance.** The Cost Dashboard’s Efficiency summary now includes the estimated cloud spend avoided by local-model requests, backed by the detailed per-model comparison.
- **Security reviews can be recorded consistently.** A new service provides the persistence, audit history, freshness, and scoring foundation for reviews of secrets, runtime boundaries, dependencies, and permissions.
- **Review evidence is handled defensively.** Malformed model output is ignored safely, cited paths cannot escape the workspace, and unresolved findings cannot be silently marked closed. This release supplies the data layer for future dashboard wiring; it does not add an automated vulnerability scanner or a release gate.

---

## What is included

- **Multi-agent orchestration** — debugger, frontend and backend engineers, reviewer, security specialist, testing, documentation, performance, DevOps, dependency, SEO, UX, and ethics/legal/commercial oversight.
- **Outcome-aware model routing** — configurable provider choice with budget, speed, capability, health, feedback, and task-profile signals.
- **Project planning and Mission Control** — dependency-aware subtasks, previews, checkpoints, resumable runs, and goal evaluation inside a closed operating envelope.
- **Long-term project memory** — structured SSOT files, security-scanned writes, secret redaction, and source-backed retrieval.
- **Agent and skill workspaces** — create custom agents, define completion criteria, assign tools and models, scan custom skills, and extend through MCP.
- **Testing strategy** — 23 configurable methodologies with per-agent ownership, model overrides, project notes, scaffolding, and protocol sync to other AI tools.
- **Project operations** — roadmap, delivery, privacy, risk, documents, stakeholders, assignments, and follow-ups in one project dashboard.
- **Website Studio** — move a client site from intake through sitemap, wireframes, UI system, platform readiness, and a protected Develop → Staging → Production path.
- **Voice, vision, and remote workflows** — local or hosted speech options, multimodal image analysis, and opt-in remote control.
- **Transparent cost and quality signals** — per-session and per-model spend, model comparison, feedback, verification evidence, and routing outcomes.

---

## Built for trust

AtlasMind treats chat input, workspace files, retrieved memory, model output, webview messages, URLs, and tool parameters as trust boundaries.

- Global immutable guardrails are visible from **Settings → Agents** and apply to every routed agent.
- Write, external, and destructive actions pass through configurable approval policy.
- Secrets are kept in VS Code SecretStorage and redacted before model dispatch where required.
- Workspace paths and webview payloads are validated before they can mutate state.
- Verification can run automatically after writes, and project runs surface their evidence rather than silently claiming success.
- Production promotion remains protected and deny-by-default when required backup or approval evidence is missing.

Read the full [security model](wiki/Security.md) and [tool-execution policy](wiki/Tool-Execution.md).

---

## Make Atlas work like you do

The Personality Profile lets you shape Atlas's role, tone, reasoning posture, memory preferences, and working boundaries. Save a global baseline, then layer project-specific preferences on top when a repository needs a different style.

Open it from the Command Palette, **Settings Overview**, or **Settings → Models & Integrations**.

Agent behavior is equally inspectable. **Settings → Agents** shows the global guardrails and a direct path into the Agent Manager, where built-in agents can be reviewed and custom agents can be created with their own instructions, completion rubric, skills, models, budget, testing role, and maintenance policy.

Learn more in [Agents & Skills](docs/agents-and-skills.md).

---

## Quick Start

1. [Install AtlasMind from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind).
2. Run **AtlasMind: Manage Model Providers** and connect your first provider.
3. Open a project in VS Code.
4. Give AtlasMind context:

   - For a new project, run `@atlas /bootstrap`.
   - For an existing repository, run `@atlas /import`.

5. Ask AtlasMind to investigate, build, review, plan, or ship your next outcome.

New to the workflow? Follow the [Getting Started guide](wiki/Getting-Started.md). Provider setup and routing details live in [Model Routing](docs/model-routing.md).

---

## Popular workflows

### Fix or build something

Ask in Atlas chat as you would ask a teammate. AtlasMind can inspect the workspace, choose a specialist, use the available tools, make the change, verify it, and report the result.

### Run a coordinated project

Use `/project <goal>` to create a reviewable task plan with dependencies, expected impact, approval gates, checkpoints, and a final synthesis.

### Pursue a bounded goal

Use `/loop <goal>` or open Mission Control. Each iteration plans the next increment, executes it, evaluates measurable progress, and stops when the goal is achieved or a configured guardrail confines the run.

### Shape an idea before implementation

Open Project Ideation to build a visual decision board, explore constraints and relationships, then hand a focused result into Project Run Center.

### Deliver a website

Website Studio connects client intake, information architecture, design review, platform readiness, and delivery planning. See the [Website Studio guide](docs/website-studio.md).

### Keep the project organised

Project Dashboard brings roadmap, documents, delivery stages, privacy, risk, stakeholders, assignments, and follow-ups into one operational surface.

---

## Chat Slash Commands

Use these in AtlasMind chat as `@atlas /<command>`.

| Command | Outcome |
|---|---|
| `/bootstrap` | Create project memory and guided foundations for a new project |
| `/import` | Build project memory from an existing repository |
| `/project <goal>` | Preview and execute a coordinated multi-step project run |
| `/loop <goal>` | Pursue a goal inside bounded cost, token, time, iteration, and checkpoint limits |
| `/agents` | List and manage registered agents |
| `/skills` | List and manage registered skills |
| `/discover <query>` | Find agentic resources such as MCP servers, agents, skills, and APIs |
| `/memory` | Query or manage SSOT project memory |
| `/cost` | Show the current session cost summary |
| `/runs` | Open recent autonomous runs and checkpoints |
| `/director` | Review stakeholders, team, responsibilities, assignments, and follow-ups |
| `/followups` | Group open follow-ups by urgency |
| `/ship [routine]` | Run the default or named project routine from project memory |
| `/sync-instructions` | Reconcile and mirror supported AI instruction files |
| `/voice` | Open the Voice Panel |
| `/vision` | Open multimodal image analysis |

The complete behavior and continuation syntax is documented in [Chat Commands](wiki/Chat-Commands.md).

---

## Extension Commands

Open the Command Palette with `Ctrl+Shift+P`.

| Command | Purpose |
|---|---|
| `AtlasMind: Getting Started` | Open the guided onboarding walkthrough |
| `AtlasMind: Open Chat Panel` | Open the larger detached Atlas chat |
| `AtlasMind: Focus Chat View` | Return focus to the sidebar chat |
| `AtlasMind: Open Settings Panel` | Open the multi-page AtlasMind settings workspace |
| `AtlasMind: Manage Model Providers` | Connect providers, credentials, and quotas |
| `AtlasMind: Manage Agents` | Search agents and edit grouped agent definitions |
| `AtlasMind: Open Personality Profile` | Configure global and project-specific working preferences |
| `AtlasMind: Bootstrap Project` | Create SSOT memory for a new project |
| `AtlasMind: Import Existing Project` | Build SSOT memory from the open repository |
| `AtlasMind: Update Project Memory` | Refresh project memory from current source |
| `AtlasMind: Open Project Dashboard` | Open project health, roadmap, operations, and governance |
| `AtlasMind: Open Project Director` | Open stakeholder, team, assignment, and follow-up management |
| `AtlasMind: Open Project Ideation` | Open the visual ideation workspace |
| `AtlasMind: Open Website Studio` | Open the website planning and delivery workspace |
| `AtlasMind: Open Project Run Center` | Review plans, runs, approvals, checkpoints, and artifacts |
| `AtlasMind: Open Mission Control` | Configure and operate bounded autonomous loops |
| `AtlasMind: Open Cost Dashboard` | Inspect spend, cache/compression efficiency, and estimated local-model savings |
| `AtlasMind: Compare Models on a Prompt` | Run a controlled prompt across configured models |
| `AtlasMind: Manage MCP Servers` | Connect and manage MCP tool servers |
| `AtlasMind: Resource Discovery` | Search, install, manage, and export agentic resources |
| `AtlasMind: Specialist Integrations` | Configure specialist search and media providers |
| `AtlasMind: Tool Webhooks` | Configure guarded outbound tool-event webhooks |
| `AtlasMind: Open Voice Panel` | Configure TTS and STT interaction |
| `AtlasMind: Open Vision Panel` | Ask multimodal questions about workspace images |
| `AtlasMind: Scaffold Testing Framework` | Create a stack-aware testing starter |
| `AtlasMind: Sync Testing Protocols to AI Agents` | Mirror enabled testing protocols into supported instruction files |
| `AtlasMind: Toggle Keep Computer Awake` | Opt into an AC-aware wake lock for long-running activity |

Settings-specific, sidebar, remote-control, and resource-action commands are listed in [Chat Commands](wiki/Chat-Commands.md) and [Remote Control](docs/remote-control.md).

---

## Configuration

AtlasMind's main settings are available in its Settings panel and under `atlasmind.*` in VS Code settings.

| Setting | Default | What it controls |
|---|---:|---|
| `budgetMode` | `balanced` | Cost preference used during model routing |
| `speedMode` | `balanced` | Latency/reasoning preference used during routing |
| `dailyCostLimitUsd` | `0` | Daily spend ceiling; `0` disables the limit |
| `toolApprovalMode` | `ask-on-write` | When tools require operator approval |
| `autoStartProposedProjectRuns` | `true` | Permit proposal auto-start only under Autopilot; otherwise show Start, Save for later, and Cancel |
| `allowTerminalWrite` | `false` | Whether approved terminal subprocesses may mutate state |
| `autoVerifyAfterWrite` | `true` | Whether configured verification runs after writes |
| `agentAutoUpdateCadence` | `never` | Optional AI refresh cadence for custom agent definitions |
| `ssotPath` | `project_memory` | Workspace-relative project-memory location |
| `localOpenAiEndpoints` | `[]` | Labeled local OpenAI-compatible endpoints |
| `loop.enabled` | `true` | Whether Mission Loop can run |
| `feedbackRoutingWeight` | `1` | Strength of saved response feedback in routing |
| `remote.enabled` | `false` | Whether desktop remote control is available |

See the [Configuration Reference](docs/configuration.md) or [wiki Configuration](wiki/Configuration.md) for every setting, accepted value, security implication, and provider-specific option.

---

## Project Structure

The README keeps the map short; implementation details and data flows belong in the technical docs.

| Path | Responsibility |
|---|---|
| `src/core/` | Orchestration, routing, planning, safety and security registers, cost, and project services |
| `src/runtime/` | Built-in agents and runtime composition |
| `src/providers/` | Provider adapters, catalogs, health, and local-model discovery |
| `src/skills/` | Built-in tools and skill handlers |
| `src/memory/` | SSOT retrieval, scanning, redaction, and persistence |
| `src/chat/` | Chat participant and shared interaction protocol |
| `src/views/` | Settings, dashboards, editors, and sidebar surfaces |
| `src/mcp/` and `src/ard/` | MCP connectivity—including the bundled Buzz communications bridge—and Agentic Resource Discovery |
| `src/voice/` and `src/remote/` | Voice backends and opt-in remote control |
| `tests/` | Unit, integration, webview, security, and regression coverage |
| `docs/` and `wiki/` | Developer architecture and user-facing guides |

Start with [Architecture](docs/architecture.md), [Development](docs/development.md), and [Agents & Skills](docs/agents-and-skills.md) for the detailed service map.

---

## Technical documentation

- [Getting Started](wiki/Getting-Started.md)
- [Architecture](docs/architecture.md)
- [Agents & Skills](docs/agents-and-skills.md)
- [Model Routing](docs/model-routing.md)
- [Configuration Reference](docs/configuration.md)
- [SSOT Memory](docs/ssot-memory.md)
- [Website Studio](docs/website-studio.md)
- [Remote Control](docs/remote-control.md)
- [Security](wiki/Security.md)
- [Tool Execution](wiki/Tool-Execution.md)
- [Development Guide](docs/development.md)
- [Roadmap](docs/roadmap.md)
- [CLI Usage](wiki/CLI.md)

---

## Open source and support

AtlasMind is open source under the permissive MIT License. There are no feature-gated commercial editions.

Contributions are welcome—see [CONTRIBUTING.md](CONTRIBUTING.md). If AtlasMind saves you time, [funding and sponsorship](wiki/Funding-and-Sponsorship.md) help sustain its development.

MIT License — see [LICENSE](LICENSE).
