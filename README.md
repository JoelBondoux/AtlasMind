<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind</h1>

<p align="center"><sub> · <strong>Current source version: 0.171.1</strong> · </sub></p>

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

## What's new in 0.171.1

Since the last Marketplace publication, **v0.145.3**, source builds have added:

- **Every setup process now works the way the Buzz one does.** `/acp` walks you through ACP setup a step at a time — name an agent, install it, sign in, enable the provider, and then **prove a completion actually comes back**, because configured and working are different things the settings screen cannot tell apart. `/setup` lists every guide with how far along it is, so a feature that needs configuring is discoverable before you hit the failure it causes. The two guides share their mechanics rather than resembling each other, so they cannot drift — and neither installs or enables anything for you: every button opens the screen where you decide.
- **Use your Claude or Codex subscription as routable capacity.** AtlasMind can now drive coding agents over the [Agent Client Protocol](https://agentclientprotocol.com) — the emerging standard that is to coding agents what LSP is to language servers. Point it at an agent you have installed (`claude-agent-acp`, `codex-acp`) and its subscription becomes another model the router can choose. It replaces the old Claude CLI bridge on every axis that mattered: replies **stream** instead of arriving in one lump, the **~26,000-character prompt ceiling is gone** (prompts travel over a pipe, not a command line, so long context arrives intact rather than silently truncated), and **images** are sent when the agent accepts them. Agents run with no filesystem, no terminal, and no tools — they answer, they do not act — and if one asks for permission to do something, AtlasMind refuses rather than granting it. Nothing is installed for you, and nothing is enabled until you name a command yourself.
- **Your issue tracker, inside the dashboard.** A new **Issues** tab reads the repository's GitHub issues: what is open, what nobody has picked up, and what has gone quiet for a month, with charts by label and assignee. You can comment, close, reopen, or open a new issue without leaving the editor — each one shown to you in full and confirmed before it is sent, because a tracker is public. **Work on it with Atlas** hands the issue to chat as a *report to check*, explicitly not as instructions, since an issue is written by whoever filed it.
- **The dashboard opens with charts of who did the work and how far each release has to go.** A donut of **commits by contributor** (click a name to scope the commit timeline to that person), a **route to release** ring for whichever gate the Roadmap card is showing, and a bar of **outstanding objectives by release gate** — so the first screen answers who, what is left, and how far, not just how busy the repo has been. Everything is drawn from git history and the roadmap you already keep: no new scan, no model call, and author names only.
- **When Atlas asks a question, you can answer it with one tap — everywhere.** One-tap reply pills existed only in the main Chat panel, which made them look like a feature of that panel rather than of Atlas asking. The Ideation panel and the Vision panel now show them too: click **Yes**, or the option you want, and it runs. Where a question has no clean options you still get the text box rather than invented buttons, which is exactly how chat has always behaved.
- **The roadmap plans more than one release.** MVP was the only milestone the Roadmap tab could track, which stops being useful the day you ship it. You can now declare your own **release gates** — a public beta, v1.0, v2 — and switch the "Road to…" card between them; each shows its own progress, milestone track, best route, and plan-with-Atlas prompt. An item can sit on more than one release. Gates are stored as readable markdown in the roadmap file, so they diff and review like the backlog does, and removing a gate removes a *label*, never any work.
- **The Testing tab says which policies are actually tested — and what's failing.** A **Policy coverage** board gives every methodology you switched on its own card: does anything in the tree test it, is its tooling merely installed with nothing written yet, how many of its cases are skipped, and which of its tests failed in the newest test report. Practices that leave no file behind — exploratory, black-box, V-model — are labelled as practices instead of being counted as gaps, because a panel that flags everything gets ignored. And when your project has never written a test report, the page says it has **no verdict** and shows the command that would produce one, rather than displaying a reassuring "0 failing" that nothing measured. It never runs your tests to find out.
- **A document shelf creates its folder.** Adding a shelf on the Documents tab now makes the folder it names, so you can design a filing system before the files exist instead of describing one against folders that aren't there. Shelves still pointing at a missing folder get a **Create folder** button. It only ever creates: a folder that already exists is left alone, and a file sitting where the shelf points is reported rather than touched.
- **One person, several ways to reach them.** The Director's Add / Edit person form now holds as many communication channels as someone actually has — email *and* Slack *and* Buzz — rather than the one it used to allow. The first is the preferred channel; the rest sit under it, added and removed without losing anything else you have typed. The roster's data model always stored a list; only the editor insisted on one.
- **Bind a Buzz identity to more than one agent.** The AtlasMind agent picker is a checklist, because a colleague who raises both API defects and design feedback belongs to two specialists and being made to choose throws away something you know. The first ticked owns the work — a follow-up has exactly one owner — and the rest are recorded as also-relevant rather than picked between by inference.
- **An observed Buzz identity you can actually recognise.** The picker used to offer three rows reading `dcbe44bf896f… (no published name) · seen in 1 channel`, which is a list nobody can choose from knowingly. Most Buzz identities publish no profile, so the evidence now comes from behaviour instead: what they last said, how much they have said, and when.
- **The walkthrough says where the Buzz desktop app fits.** Proving a message arrives is the one step that needs it — AtlasMind can read Buzz but cannot post, so the test message has to come from somewhere — and it now says so, with the download link and the warning that the app and AtlasMind must share a relay.
- **Fetch your Buzz channels instead of copying ids by hand.** A **Fetch my channels** button on Settings → Buzz asks the Buzz CLI which channels your key can actually see, and offers them as a ticklist with the ones you already watch pre-ticked. A channel id that quietly does not match the channel you posted in is the most common reason a correctly configured subscription receives nothing — and it is undiagnosable from inside AtlasMind, because the wrong id, the wrong relay, and a quiet day look identical. Nothing is written unless you tick and confirm, and a channel you watch that the relay did not list is kept rather than silently dropped.
- **The Buzz walkthrough now finishes the job.** It used to stop at "subscribed", which is the point where every remaining problem looks identical: a wrong channel id, a wrong relay, and a quiet Tuesday all present as a connection that receives nothing. Two steps follow it now. **Prove one message arrives** — post in Buzz, run `/buzz read`, and see it — with the two things that actually go wrong named and fixed on the spot. Then **put the Buzz people in the Director roster**, so what arrives reaches an agent instead of sitting unassigned. Neither is required for the subscription to work, so neither is reported as a fault; they are simply things nobody was ever told to do.
- **MCP servers are visible in Settings.** A new **Settings → MCP Servers** page lists every server with its live connection status, tool count, and any error, and lets you enable, connect, or disconnect each one — so you can see what AtlasMind can actually reach without opening a separate panel. Adding and editing servers stays in the dedicated manager, which the page links to.
- **Buzz setup is a walkthrough, not a wall of text.** `/buzz` takes you one step at a time, asks whether you are running Buzz locally or connecting to a hosted relay, and then shows only that path — with the exact terminal commands written out and a button that loads them into a terminal ready to run (it never presses Enter for you). It covers the Buzz desktop app and the MCP bridge too, and opens in AtlasMind's own chat rather than Copilot's.
- **A blocked run no longer looks like a hung one.** When a tool approval is waiting and the AtlasMind panel is not on screen, the panel comes forward and a notification names what needs an answer — because the approval bar lives in that panel, and you might be in VS Code's own chat, an editor, or another window. It stays quiet when the panel is already visible.
- **DM people from chat, and let agents talk to each other.** `/buzz dm <name> <message>` messages someone straight from your Director roster. And `atlasmind.buzz.autonomousReplies` (off by default) lets an AtlasMind agent hold a loop with a Buzz agent without a dialog per message — scoped only to identities you explicitly bound to an agent, rate-capped per recipient, and still confirming for anyone unbound, who is treated as a person.
- **Talk to Buzz from AtlasMind chat.** `/buzz read` shows the conversation with real names and emoji reactions; `/buzz send <message>` replies through the guarded bridge. Confirmation now fires where it earns its place — anything AtlasMind drafted, any recipient it picked, and the first message to anyone in a session — rather than on every message you type yourself, because a dialog you always click through protects nothing.
- **The Buzz setup guide reads Buzz's own docs.** Rather than hand-written instructions that go stale every time Buzz ships, `/buzz` quotes the current Buzz README for the parts outside AtlasMind — running a relay, installing the CLI, setting a key — with a source link and how recently it was read. Assessing *your* setup stays a deterministic check; only claims about Buzz are fetched, and anything quoted is clearly somebody else's text that AtlasMind will not run for you.
- **A "Guide me through Buzz setup" button** on Settings → Buzz opens the walkthrough in chat, now with real how-to for the parts outside AtlasMind — including that a local relay is something *you* have to run (normally via Docker), since a valid `localhost` URL is not the same as a relay actually listening.
- **`/buzz` sets Buzz up with you.** Ask `@atlas /buzz` and AtlasMind reads your actual configuration and tells you what is done, what is left, and what to click next — with a button for each gap. It will not switch anything on for you: every Buzz gate is off by default so that enabling it stays your call, and each button opens the relevant screen rather than changing state behind you. AtlasMind can now also tell you whether the Buzz CLI is installed, instead of letting you find out when a send fails.
- **Pick a Buzz handle instead of pasting one.** Adding a person on the Director tab now offers the Buzz identities AtlasMind has actually seen, by the name each one published for itself — and your own identity, derived from the key already in secure storage. Nothing is ever guessed from a person's name: every option is a key that arrived on the wire, because a fabricated key would belong to somebody else.
- **Buzz is configurable by clicking.** A new **Settings → Buzz** page surfaces every Buzz switch — enable it, point it at a relay, allow a remote one, subscribe to inbound, choose channels, and decide whether follow-ups are recorded — with each nested switch shown dimmed while its parent is off, so the three gates read as the three gates they are. And in **Project Dashboard → Director**, adding or editing a person with a `buzz` channel now offers an **AtlasMind agent** picker, so you can say "route their messages to this specialist" while adding them rather than by hand-editing settings JSON.
- **Buzz activity can become AtlasMind work.** Switch on inbound and AtlasMind holds a live, read-only subscription to your Buzz relay, turning channel activity into follow-ups with a pointer back to the thread. You can also **assign AtlasMind agents to specific Buzz agents**, so work from a known Buzz bot lands with the right specialist. Three separate opt-ins gate it — enabling Buzz, subscribing, and recording — because project memory is committed to your repository.
- **Buzz inbound can now authenticate.** AtlasMind signs the NIP-42 challenge a real Buzz relay demands, so a live subscription is possible at all — a relay refuses to serve one otherwise. The signing library is tiny (170 KB, no dependencies of its own) and is loaded only the first time a signature is needed, so if you never use Buzz it costs you nothing. Your agent key stays in the OS secret store, is checksum-validated so a mistyped key fails loudly instead of signing as someone else, and never reaches a log or an error message.
- **Hosted Buzz workspaces are handled safely.** A Buzz relay doesn't have to be local. Connecting to a **remote** one now requires an encrypted connection — plaintext to a hosted relay would expose colleagues' messages in transit — matching the rule the outbound path already applied.
- **Reading Buzz activity back in.** AtlasMind can now hold a live subscription to a Buzz relay: it authenticates, subscribes, keeps itself genuinely in contact (a wake lock can't save a dropped socket, so there's a keep-alive with backoff reconnect), and turns activity into follow-ups. External conversations are **derived, never mirrored** — a message becomes a follow-up with a pointer back to the thread, never the message body, because project memory is committed to your repository and a mirrored channel would put colleagues' chat in your git history. The subscription is **read-only by construction**: it can never publish to Buzz. Authentication and the message contract are now verified against a real Buzz relay; what remains before it is switched on is the wiring — an opt-in toggle and follow-up persistence.
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

Project Dashboard brings roadmap, issues, documents, delivery stages, privacy, risk, stakeholders, assignments, and follow-ups into one operational surface.

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
