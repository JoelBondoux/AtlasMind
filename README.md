<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind</h1>

<p align="center"><sub> · <strong>Current source version: 0.209.3</strong> · </sub></p>

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

Connect cloud providers, local OpenAI-compatible runtimes such as Ollama and LM Studio, or **the subscription you already pay for** — a Claude, ChatGPT, Gemini, Copilot or Qwen plan becomes routable capacity over the Agent Client Protocol, with no per-token cost. AtlasMind routes by task fit, capability, health, budget, speed, and observed outcomes.

### Work the way your repository already works

An opt-in guided GitHub workflow runs from an idea on the ideation board through issues, branches, pull requests, review, CI, release, and the debt you chose to defer. You decide how far AtlasMind may go at each stage — observe, draft, propose, or act — and the ceiling is yours to lower at any time. The workflow itself is a **committed file**, so a change to how your team works arrives as a diff with a reviewer rather than a habit nobody wrote down.

### Keep your project's brain

The structured SSOT memory records architecture, decisions, roadmap context, operations, lessons learned, agents, and skills. AtlasMind can retrieve that context later while still checking live source files for claims that need current evidence.

### See the work, not just the answer

Project Dashboard, Project Run Center, Cost Dashboard, Mission Control, Website Studio, and the Personality Profile turn hidden orchestration state into something you can inspect and steer.

### Grow the team around the project

Start with 21 built-in agents and 43 built-in skills. Add custom agents, assign models and testing responsibilities, connect MCP servers, or discover new agentic resources when the project needs more.

---

## From idea to delivery

1. **Connect your models.** Bring one provider or several; AtlasMind can also use local models.
2. **Give AtlasMind the project context.** Bootstrap a new project or import an existing repository into structured project memory.
3. **Choose the level of autonomy.** Ask for one task, preview a multi-step project run, or launch a bounded Mission Loop.
4. **Review the evidence.** Inspect agent choice, model choice, tool activity, verification, cost, changed files, and unresolved blockers.
5. **Promote deliberately.** Move work through guarded delivery stages with preflight, backup, approval, and verification gates.

AtlasMind is designed to carry work forward while keeping the operator informed enough to intervene.

---

## What's new in 0.209.3

Since the last Marketplace publication, **v0.208.0**, source builds have added the following. Everything earlier is already in the published build — the full history is in [CHANGELOG.md](CHANGELOG.md).

- **The subscription you already pay for actually works as capacity.** ACP has been in AtlasMind since v0.170.0 as "use your Claude or ChatGPT subscription", and on Windows nobody could have used it. Four faults, each fatal on its own, all found by running it against live agents rather than reading the code.

  AtlasMind **told you to install the wrong package** — it spawned `claude-agent-acp` while the install command it displayed provided a binary called `claude-code-acp`, so following AtlasMind's own instructions produced something it then could not find. The Codex path was worse: `cargo install codex-acp` asked you to install Rust in order to fetch a crate **that does not exist.**

  Even with the right binary, **Windows could not start it.** These adapters install as npm commands, and an npm command on Windows is a small script rather than a real program — so the spawn failed with `ENOENT`, which reads as "you haven't installed it" to somebody who just did. AtlasMind now finds the entry point the package itself declares and runs that, and a failure explains itself.

  And **an agent that listed its sign-in options was declared signed out.** Codex advertises "API key" and "ChatGPT" on every startup whether you are logged in or not, so AtlasMind refused every working ChatGPT subscription with a message you could not clear. It now decides by opening a real session and reading the answer — so it tells you the agent *works*, not merely that it started.

  Separately, **every ACP reply was recorded as free.** Token counts were read from a field no agent sends. Real counts now reach the Cost Dashboard, and the context-size figure is deliberately not billed — charging it would re-bill your whole conversation on every message.

- **Three more subscriptions joined: Gemini CLI, GitHub Copilot CLI, and Qwen Code.** Gemini was previously left out because its ACP launch command was unpublished, and guessing one would have been a button that cannot work. It is published now, so "Use my Gemini subscription" appears on the Google card. goose, OpenCode, Cursor and Kimi are named with their commands too — AtlasMind will not download and unpack an archive for you, so it tells you the command rather than offering a button that would fail.

- **Slash commands work in the AtlasMind chat panel.** They never had. The panel passed whatever you typed straight through as ordinary prose, so all nineteen commands — declared in the manifest, listed in the docs, autocompleted by the composer — did nothing. With no model provider set up, `/acp` came back from the built-in echo adapter as *"Answered from context."*

  Silence was the real problem. A command that visibly fails gets reported; one that returns a plausible answer teaches you the feature works and you are using it wrong. And `/acp` and `/buzz` are *setup* commands you run precisely because nothing is set up — so the fall-through handed those questions to an agent holding every connected tool.

  The panel now runs the **same handlers** the `@atlas` chat surface does, rather than its own copies, so the two cannot answer `/agents` differently. Buttons a command offers appear as clickable chips. A typo like `/agent` names the real command instead of guessing. And a path stays a path: `/usr/local/bin/thing is missing` is still a question about a file, not a failed command lookup.

- **The Project Dashboard's tabs look like tabs again.** Every unselected tab had been rendering as a light grey pill with grey text on a dark panel. A selector had quietly changed which style rule it belonged to, so the tabs kept a layout and lost their appearance — and because the *selected* tab sets its own colours, exactly one tab looked correct and the row read as intentional.

- **The Marketplace publish no longer uses a stored secret.** Releases now authenticate through Microsoft Entra ID with GitHub OIDC, so there is no publishing credential in the repository to expire or leak — and the release pipeline checks its own rights *before* packaging rather than discovering a dead credential mid-upload. Promotion also merges rather than squashes, which was making every release after the first conflict on the four files every release touches.

---

## What is included

- **Multi-agent orchestration** — debugger, frontend and backend engineers, reviewer, security specialist, testing, documentation, performance, DevOps, dependency, SEO, UX, and ethics/legal/commercial oversight. Agents can hand a question to a better-placed specialist, and a handoff transfers the question without widening the caller's permissions.
- **Outcome-aware model routing** — cloud providers, local runtimes, or a Claude/ChatGPT/Gemini/Copilot/Qwen **subscription** used as capacity, chosen by budget, speed, capability, health, feedback, and task-profile signals.
- **A guided GitHub workflow** — ideation, issues, branches, pull requests, review, pipeline, release, and tech debt, each with its own automation level from *observe* to *act*. Specialised by your project's shape and traits, and written to a file your team owns.
- **Ideation that reaches the backlog** — cards become roadmap items carrying the connections that argued for them, and a roadmap item becomes a GitHub issue draft with labels drawn only from your repository's real taxonomy.
- **A tech-debt register** — deferred work found by scanning your own markers, graded by a **published rule table** rather than a model's opinion, with entries that transition instead of disappearing. Any entry can be handed to an agent as a proposal, never a mandate.
- **Delivery measurement** — deployment frequency, lead time, change failure rate, and time to restore, each computed from a declared rule you can read, alongside release gates and notes taken verbatim from your changelog.
- **Project planning and Mission Control** — dependency-aware subtasks, previews, checkpoints, resumable runs, and goal evaluation inside a closed operating envelope.
- **Long-term project memory** — structured SSOT files, security-scanned writes, secret redaction, source-backed retrieval, and a migration path so a newer format is never overwritten by an older build.
- **Agent and skill workspaces** — create custom agents, define completion criteria, assign tools and models, scan custom skills, and extend through MCP.
- **Testing strategy** — 23 configurable methodologies with per-agent ownership, model overrides, project notes, scaffolding, and protocol sync to other AI tools.
- **Project operations** — roadmap, delivery, privacy, risk, documents, stakeholders, assignments, and follow-ups in one project dashboard, with each page linking through to the GitHub page it is about.
- **Website Studio** — move a client site from intake through sitemap, wireframes, UI system, platform readiness, and a protected Develop → Staging → Production path.
- **Voice, vision, and remote workflows** — local or hosted speech options, multimodal image analysis, opt-in remote control, and a keep-awake lock so a long run is not killed by system sleep.
- **Transparent cost and quality signals** — per-session and per-model spend in your own currency, model comparison, feedback, verification evidence, and routing outcomes.

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

### Follow a professional GitHub workflow — and learn it

Project Dashboard → **Workflow** is the guided eight-stage workflow: ideation, issue intake, branch naming, development, pull requests and review, CI, release, and the tech debt you chose to defer — with an automation layer above them all. Every stage and step carries a **?** explaining why it exists, how to do it, and what people usually get wrong — so it works as a teaching surface for someone learning professional practice, not only as a checklist for someone who already knows it. It adapts to the testing protocols your project has enabled, and charts delivery health alongside the guidance. See the [workflow specification](docs/guided-github-workflow.md).

### Keep the project organised

Project Dashboard brings roadmap, issues, documents, delivery stages, privacy, risk, stakeholders, assignments, and follow-ups into one operational surface.

---

## Chat Slash Commands

Type these in the AtlasMind chat panel as `/<command>`, or in the VS Code chat view as `@atlas /<command>`. Both surfaces run the same handlers, so they cannot answer differently.

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
| `/buzz` | Walk through Buzz setup: what is done, what is left, and what to click next |
| `/setup` | List every setup guide and how far along each one is |
| `/acp` | Walk through ACP agent setup: name it, install it, sign in, enable it, prove it answers |
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
| `AtlasMind: Open a Setup Guide` | Start a setup walkthrough (`acp`, `buzz`) in a fresh chat session |
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
| `AtlasMind: Set Buzz Agent Key` | Store or remove the Buzz agent key in the OS secret store (empty value removes it) |
| `AtlasMind: Fetch My Buzz Channels` | Ask the Buzz CLI which channels your key can see, and tick the ones to watch. Writes nothing unless you confirm |

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
| `buzz.enabled` | `false` | Master switch for the Buzz integration (Settings → Buzz) |
| `buzz.inboundEnabled` | `false` | Hold a read-only subscription to a Buzz relay |
| `buzz.autoCreateFollowUps` | `false` | Record derived Buzz follow-ups into git-tracked project memory |
| `buzz.agentBindings` | `{}` | Route a Buzz identity's work to an AtlasMind agent (edited per person on Dashboard → Director) |

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
- [The Guided GitHub Workflow](docs/guided-github-workflow.md)
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
