<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind</h1>

<p align="center"><sub> · <strong>Current source version: 0.257.5</strong> · </sub></p>


<p align="center">
  <strong>BETA</strong><br />
  <strong>Your AI delivery team, inside VS Code.</strong><br />
  <em>Describe what you want built. Watch it get done. Keep every decision.</em>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind"><strong>Install from the VS Code Marketplace</strong></a>
  ·
  <a href="wiki/Getting-Started.md">Get started</a>
  ·
  <a href="wiki/FAQ.md">FAQ</a>
</p>

---

## What is AtlasMind?

Most AI coding tools give you one assistant in one chat box. AtlasMind gives you a **team**.

Ask for what you want in plain English. AtlasMind picks the right specialist for the job, picks a
model that suits the task and your budget, reads what it needs from your project, does the work,
checks it, and shows you exactly what changed and what it cost.

The important part is what happens next. Your decisions, architecture notes, lessons learned, and
run history stay with the **project** — not in a chat window you'll close and never find again.

**You stay in charge throughout.** Nothing risky happens without your approval. Every automatic
step is one you switched on, and you can switch it off again.

---

## Who it's for

- **Solo developers and freelancers** who want the coordination of a bigger team without hiring one.
- **Small teams** who need a shared, reviewable way of working rather than everyone prompting differently.
- **People learning professional practice** — the guided workflow explains *why* each step exists, not just what to click.

You do not need to be an AI expert. You do need a project you care about getting right.

---

## What you can actually do with it

**Fix or build something.** Ask in chat like you'd ask a colleague. AtlasMind looks at your code,
picks a specialist, makes the change, verifies it, and reports back.

**Run a whole piece of work.** `/project Add Stripe checkout` produces a reviewable plan — the steps,
what depends on what, what it will touch, where it will pause for you — before anything happens.

**Chase a goal on its own.** `/loop` and Mission Control keep working towards an outcome inside limits
you set: how much it may spend, how long it may run, how many attempts it gets, and where it must stop
and ask.

**Think before you build.** The Ideation board lets you lay out problems, requirements, risks and
evidence, argue with yourself visually, and then turn the cards that survived into real roadmap items.

**Ship properly.** A guided eight-stage GitHub workflow takes you from an idea to a released version —
issues, branches, pull requests, review, CI, release — with a clear explanation at every step.

**Deliver a client website.** Website Studio carries a site from the client brief through sitemap,
wireframes, design system, hosting choice, and a protected path to production.

---

## Get started in five minutes

1. [Install AtlasMind from the Marketplace](https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind).
2. Run **AtlasMind: Manage Model Providers** from the Command Palette (`Ctrl+Shift+P`) and connect one provider.
   Already pay for Claude, ChatGPT, Copilot or Qwen? You can use that subscription instead of an API key.
3. Open your project.
4. Tell AtlasMind about it — `@atlas /bootstrap` for a brand-new project, `@atlas /import` for an existing one.
5. Ask for something.

That's it. The [Getting Started guide](wiki/Getting-Started.md) covers the longer version.

---

## Bring the models you already pay for

AtlasMind does not sell you tokens. Connect whatever you already have:

- **Cloud providers** — Anthropic, OpenAI, Google Gemini, Azure OpenAI, Amazon Bedrock, DeepSeek, Mistral, z.ai.
- **Subscriptions you already own** — a Claude, ChatGPT, Copilot or Qwen plan, or an eligible Gemini Code
  Assist licence, used as routable capacity with **no per-token cost**.
- **Local models** — Ollama, LM Studio, or anything else that speaks the OpenAI API. No key, no bill.

AtlasMind then chooses between them per task, based on what the task needs, what's healthy, what's fast
enough, what it costs, and what has actually worked well for you before. Set a daily spending cap and it
will respect it.

See [Model Routing](wiki/Model-Routing.md) for how the choice is made.

---

## Safety you can see

Ambitious automation is only worth having if you can trust it. AtlasMind is built so you can check it:

- **Nothing risky happens silently.** Writes, external calls, and destructive actions ask first — and you
  choose how often it asks.
- **Your keys stay in the OS keychain.** Never in settings files, never in your repository, and redacted
  before anything is sent to a model.
- **Work gets verified.** Configured checks run after changes, and a run cannot report success while its
  own verification failed.
- **Production is protected.** Promoting to production is deny-by-default until the backups and approvals
  you required are actually there.
- **Everything untrusted is treated as untrusted** — issue text, web pages, model output, files. None of it
  can quietly become an instruction.

Full detail in the [Security model](wiki/Security.md) and [Tool Execution](wiki/Tool-Execution.md).

---

## What's new in 0.257.5

Since the last Marketplace publication, **v0.256.0**, source builds have added the following. The full
history is in [CHANGELOG.md](CHANGELOG.md).

- **Atlas Lenses has a front door.** **AtlasMind: Lens: Open Atlas Lenses Dashboard** opens one page for
  all eight lenses: what each one reads, the question it answers, whether it can answer it right now, and
  why not. A flow map draws the links between evidence, lens and question, and hovering any card follows
  its connections. Every lens, evidence source and suggested action is clickable, and a ⓘ on each explains
  it in plain language — including what that lens *cannot* prove. A **Do this next** band lists only what
  needs a person, and is empty when nothing does. Opening it runs no model and writes no file.

- **The eight Lens surfaces now look like one product.** Possible Flow, Change Impact, Test Evidence, State
  Lifecycle, Configuration Resolution, Change Story and Field Wiring were written weeks apart and looked
  it. Relationships that used to be listed as text are now drawn: state transitions curve between the
  states they connect, impact links point *into* a symbol from its callers and *out of* it to its callees,
  and a configuration chain shows which source the value actually reaches.

- **The README and the whole wiki have been rewritten for people, not maintainers.** Every page now opens
  by saying what the feature is, who it's for, and what it does for you, before it gets into detail. The
  stale competitor comparison table is gone for good — it made claims about other people's software that
  nobody was keeping true.

- **The reader-facing docs now agree with the runtime.** `wiki/Home.md` says 27 built-in agents, the
  Remote Control page names the gateway enable command, and its safety copy no longer contradicts the
  settings table.

## Recently shipped

Highlights from the last few releases. Everything here is already in the published build.

- **One request now finishes in one turn.** Ask AtlasMind to commit, push, promote or publish and it follows
  your project's declared route without stopping to ask you to repeat yourself. Approvals and release gates
  are unchanged.
- **Branches became a decision dashboard.** Every branch shows a plain verdict — *Ready for review*, *Needs
  attention*, *Blocked* — built from real pull request, review, CI and roadmap evidence. Compare any two
  branches, see who owns the changed code, and clean up merged branches through a guarded queue that never
  force-deletes.
- **Your subscription agents can do real work.** Claude Code, Codex and friends can now be given tool access
  for a task, with each operation logged. Off by default; one clearly-labelled switch turns it on.
- **Research scans that look outside your repository.** Seven questions — competition, customers, technology,
  feature gaps, market, funding, regulation — recorded as evidence your ideation board can use. Every finding
  carries a source, or it isn't recorded as a finding.
- **Testing stopped being a checkbox.** The methodologies you enable are now told to the agent writing the
  code, checked against what's actually in your repository, and counted in your project score — with an honest
  "nobody has looked yet" instead of a fake pass.

---

## What's included

| | |
|---|---|
| **A team of specialists** | 27 built-in agents — debugger, frontend, backend, reviewer, security, testing, docs, performance, DevOps, dependencies, SEO, UX, release and CI, plus ethics, legal, commercial and market oversight. Add your own. |
| **43 built-in skills** | File edits, git, terminal, Docker, test runners, code navigation, debugging, web fetch, and more. Extend with your own or connect MCP servers. |
| **Smart model routing** | Cloud, local, or your existing subscription — chosen per task by fit, cost, speed, health, and past results. |
| **Project memory** | Architecture, decisions, roadmap, lessons and operations kept as readable Markdown in your repo, retrieved when relevant. |
| **A guided GitHub workflow** | Ideation → issues → branches → development → pull requests → CI → release → tech debt, each with its own automation level from *watch* to *act*. |
| **Project planning & Mission Control** | Dependency-aware task plans, previews, checkpoints, resumable runs, and goal evaluation inside limits you set. |
| **Ideation board** | Visual thinking that reaches the backlog — cards become roadmap items, roadmap items become issue drafts. |
| **Tech debt register** | Deferred work found from your own code markers, graded by a published rule you can read, tracked rather than forgotten. |
| **Testing strategy** | 23 configurable methodologies with owners, tooling, evidence checks, scaffolding, and sync to other AI tools. |
| **Project dashboard** | Roadmap, issues, branches, delivery, documents, risk, privacy, stakeholders and follow-ups in one place. |
| **Website Studio** | Client intake through to a protected Develop → Staging → Production path. |
| **Voice, vision & remote** | Local or hosted speech, image analysis, opt-in remote control, and a keep-awake lock for long runs. |
| **Honest cost tracking** | Per-session and per-model spend in your own currency, with model comparison and routing evidence. |

---

## Make it work the way you do

The **Personality Profile** shapes Atlas's role, tone, reasoning style, memory habits and boundaries. Save a
global baseline, then override it per project when a repository needs something different.

**Settings → Agents** shows the guardrails that apply to every agent, and opens the Agent Manager where you can
review the built-in agents or create your own with their own instructions, tools, models, budget and testing role.

More in [Agents](wiki/Agents.md) and [Skills](wiki/Skills.md).

---

## Chat commands

Type these in the AtlasMind chat panel as `/<command>`, or in the VS Code chat view as `@atlas /<command>`.

| Command | What it does |
|---|---|
| `/bootstrap` | Set up project memory and foundations for a new project |
| `/import` | Build project memory from an existing repository |
| `/project <goal>` | Plan and run a coordinated piece of multi-step work |
| `/loop <goal>` | Chase a goal inside cost, time and iteration limits |
| `/ideate` | See what's on the ideation board and what needs attention |
| `/research` | What the research scans found outside your repository |
| `/agents` · `/skills` | List and manage your agents and skills |
| `/discover <query>` | Find MCP servers, agents, skills and APIs to add |
| `/memory` | Query or manage project memory |
| `/cost` | Current session spend |
| `/runs` | Recent autonomous runs and checkpoints |
| `/director` · `/followups` | People, responsibilities, assignments and what's overdue |
| `/setup` · `/acp` · `/buzz` | Guided setup walkthroughs |
| `/ship [routine]` | Run a saved project routine |
| `/sync-instructions` | Keep every AI tool's instruction file in agreement |
| `/voice` · `/vision` | Speech and image analysis panels |

Full behaviour and the Command Palette list are in [Chat Commands](wiki/Chat-Commands.md).

---

## A few settings worth knowing

Everything is in the AtlasMind Settings panel, or under `atlasmind.*` in VS Code settings.

| Setting | Default | What it does |
|---|---:|---|
| `budgetMode` | `balanced` | How much you're willing to spend per task |
| `speedMode` | `balanced` | Fast answers versus more considered ones |
| `dailyCostLimitUsd` | `0` | Daily spending cap; `0` means no cap |
| `toolApprovalMode` | `ask-on-write` | How often AtlasMind asks before acting |
| `allowTerminalWrite` | `false` | Whether approved terminal commands may change things |
| `autoVerifyAfterWrite` | `true` | Run your checks automatically after a change |
| `ssotPath` | `project_memory` | Where project memory lives in your repo |
| `chatSessionTurnLimit` | `6` | How much recent conversation carries forward |

All 114 settings are documented in the [Configuration reference](wiki/Configuration.md).

---

## Where things live

| Path | What's in it |
|---|---|
| `src/core/` | Orchestration, routing, planning, safety, cost, and project services |
| `src/runtime/` | Built-in agents and runtime composition |
| `src/providers/` | Model provider adapters, catalogs and health |
| `src/skills/` | Built-in tools and skill handlers |
| `src/memory/` | Project memory: retrieval, scanning, redaction, persistence |
| `src/chat/` | The chat participant and interaction protocol |
| `src/views/` | Settings, dashboards, editors and sidebar surfaces |
| `src/acp/` and `src/cli/` | Subscription-agent sessions and the headless CLI |
| `src/mcp/` and `src/ard/` | MCP servers and agentic resource discovery |
| `src/voice/` and `src/remote/` | Voice backends and opt-in remote control |
| `tests/` | Unit, integration, webview, security and regression coverage |
| `docs/` and `wiki/` | Developer reference and user guides |

The full service map is in [Architecture](docs/architecture.md).

---

## Documentation

**Start here:** [Getting Started](wiki/Getting-Started.md) · [FAQ](wiki/FAQ.md) · [Chat Commands](wiki/Chat-Commands.md) · [Configuration](wiki/Configuration.md)

**Using it well:** [Agents](wiki/Agents.md) · [Skills](wiki/Skills.md) · [Model Routing](wiki/Model-Routing.md) · [Memory System](wiki/Memory-System.md) · [Project Planner](wiki/Project-Planner.md) · [Ideation](wiki/Ideation.md) · [GitHub Workflow](wiki/GitHub-Workflow.md) · [Delivery](wiki/Delivery.md) · [Website Studio](wiki/Website-Studio.md) · [CLI](wiki/CLI.md)

**Trust and safety:** [Security](wiki/Security.md) · [Tool Execution](wiki/Tool-Execution.md)

**Under the hood:** [Architecture](docs/architecture.md) · [Development](docs/development.md) · [Roadmap](docs/roadmap.md) · [Contributing](CONTRIBUTING.md)

---

## Open source, and staying that way

AtlasMind is MIT licensed. There is no paid tier, no feature gate, and no plan to add one.

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). If AtlasMind saves you time,
[sponsorship](wiki/Funding-and-Sponsorship.md) helps keep it going.

MIT License — see [LICENSE](LICENSE).
