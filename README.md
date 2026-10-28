<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind</h1>

<p align="center"><sub> · <strong>Current source version: 0.511.0</strong> · </sub></p>


<p align="center">
  <strong>BETA</strong><br />
  <strong>Your AI project manager, inside VS Code — with a delivery team attached.</strong><br />
  <em>Roadmap, risk, compliance and release, tracked from your own repository.<br />
  Bring the AI coding tool you already use, or use the team built in.</em>
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

**AtlasMind manages your project. It can also do the work.**

Most AI coding tools give you an assistant in a chat box. That solves *writing code*. It doesn't
tell you what to build next, what's blocking it, who owns it, what you deferred three weeks ago and
why, whether your tests actually cover what you claim, or whether you're fit to release.

That's the job AtlasMind does. A **27-page project dashboard** built entirely from your own
repository: roadmap and dependency graph, issues and pull requests, people and follow-ups, risk,
compliance, technical debt, defects, testing evidence, documents, delivery and release readiness. Nothing is
a form you fill in twice — it reads git, GitHub, your files and your project memory, then grades
what it finds against rules it **publishes on the card**, so you can see the reasoning and disagree
with it.

Attached to that is a team of **27 AI specialists** that can pick the work up and carry it out. Ask
in plain English; AtlasMind routes to the right specialist and a model that suits the task and your
budget, does the work, verifies it, and shows you what changed and what it cost.

**That second half is optional.** If you already have a favourite AI coding tool, keep it — see
below.

**You stay in charge throughout.** Nothing risky happens without your approval. Every automatic
step is one you switched on, and you can switch it off again.

---

## Who it's for

- **Solo developers and freelancers** carrying the project-management load themselves, on top of the code.
- **Small teams** who need a shared, reviewable way of working rather than everyone prompting differently.
- **Anyone already happy with their AI coding tool** who wants the management layer around it, not a replacement for it.
- **People learning professional practice** — the guided workflow explains *why* each step exists, not just what to click.

You do not need to be an AI expert. You do need a project you care about getting right.

---

## Use the AI coding tool you already have

**The management side doesn't need AtlasMind's chat.** Work the dashboard, keep the registers, run
the workflow — and let Copilot, Claude Code, Cursor, Codex, Gemini CLI or Windsurf write the code.

AtlasMind writes what it knows into the instruction files those tools already read —
`.github/copilot-instructions.md`, `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `GEMINI.md`,
`.windsurfrules` — as a **managed block** it maintains and you can delete: the canonical AtlasMind
roadmap and same-change synchronization rule, your enabled testing methodologies, the technical-debt
markers it scans for, and the stage-by-stage rules of your declared GitHub workflow. Whatever agent
you use gets told the same rules AtlasMind holds itself to,
and the registers keep working because they read your repository rather than your chat history.

Its own agents are there when you want them. They are not a prerequisite. Full setup in
[Bring Your Own AI Tool](wiki/Bring-Your-Own-AI-Tool.md).

---

## What you can actually do with it

**Run the project.** The dashboard is the point: what needs a person right now, what changed since
you last looked, what's blocking the roadmap, what you owe, and whether you can ship. Every number
links to the page that owns it, and every grade names the rule that produced it.

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

**Design an interface, then carry it into the project.** UI Studio works with websites, web and mobile
apps, desktop tools, editor extensions, embedded interfaces, and custom surfaces. It keeps screens,
flows, wireframes, content rules, real Markdown copy, UI-system decisions, and source-code handoff
guidance together. Its full preview opens in VS Code's built-in browser and combines the saved
wireframe, UI tokens, and exact Markdown copy; a separate responsive lab checks fixed device widths.
Website projects additionally retain the guarded sitemap, stack, hosting, and delivery workflow.
Select any block and describe it in plain English; every profile can generate a reviewable HTML visual
guide even when the eventual implementation is native rather than HTML.

---

## Get started in five minutes

1. [Install AtlasMind from the Marketplace](https://marketplace.visualstudio.com/items?itemName=JoelBondoux.atlasmind).
2. Run **AtlasMind: Manage Model Providers** from the Command Palette (`Ctrl+Shift+P`) and connect one provider.
   Already pay for Claude, ChatGPT, Copilot or Qwen? You can use that subscription instead of an API key.
3. Open your project.
4. Tell AtlasMind about it — `@atlas /bootstrap` for a brand-new project (it asks first for the project in your own words), `@atlas /import` for an existing one.
5. Ask for something.

That's it. The [Getting Started guide](wiki/Getting-Started.md) covers the longer version.

**Only want the management layer?** Steps 3 and 4 are enough — run **AtlasMind: Open Project
Dashboard** and it reads your repository from there. A model provider is only needed for the parts
that ask a model to do something.

---

## Bring the models you already pay for

AtlasMind does not sell you tokens. Connect whatever you already have:

- **Cloud providers** — Anthropic, OpenAI, Google Gemini, Azure OpenAI, Amazon Bedrock, DeepSeek, Mistral, z.ai.
- **Subscriptions you already own** — a Claude, ChatGPT, Copilot or Qwen plan, or an eligible Gemini Code
  Assist licence, used as routable capacity with **no per-token cost**.
- **Local models** — Ollama, LM Studio, Unsloth Studio, or anything else that speaks the OpenAI API. No bill;
  only Unsloth Studio needs a key, and AtlasMind keeps it for that endpoint alone.

AtlasMind then chooses between them per task, based on what the task needs, what's healthy, what's fast
enough, what it costs, and what has actually worked well for you before. Set a daily spending cap and it
will respect it.

See [Model Routing](wiki/Model-Routing.md) for how the choice is made.

---

## Safety you can see

Ambitious automation is only worth having if you can trust it. AtlasMind is built so you can check it:

- **Nothing risky happens silently.** Writes, external calls, and destructive actions ask first — and you
  choose how often it asks.
- **Your keys stay in the OS keychain.** Never in settings files, never in your repository. Credentials
  found in what a tool read — a `.env`, a config file, a CI log — are pattern-matched and replaced
  before the result reaches a model. Pattern matching catches known shapes, not novel ones; the
  [Data privacy guide](wiki/Data-Privacy-and-GDPR.md) covers classifying what those patterns cannot see.
- **Model-written code does not run unless you say so.** When the model calls a tool that does not exist,
  AtlasMind can write one — but `atlasmind.skillAutoSynthesisEnabled` is off by default, and with it on
  every generated skill is scanned and shown to you before it executes.
- **Work gets verified.** Configured checks run after changes, and a run cannot report success while its
  own verification failed.
- **Production is protected.** Promoting to production is deny-by-default until the backups and approvals
  you required are actually there.
- **Everything untrusted is treated as untrusted** — issue text, web pages, model output, files. None of it
  can quietly become an instruction.

Full detail in the [Security model](wiki/Security.md), the [prompt-injection threat model](wiki/Prompt-Injection-Threat-Model.md)
and [Tool Execution](wiki/Tool-Execution.md).

Personal and classified project context has a separate, opt-in boundary. The
[Data privacy and GDPR guide](wiki/Data-Privacy-and-GDPR.md) explains the detector pack, trusted-model
allow-list, redaction and file-withholding behaviour, retained metadata, provider references, and the
important limits on overrides and compliance claims.

---

## What's new in 0.511.0

**Know who authorised a Buzz agent, and cut one off.** When a Buzz agent's message carries its owner's
attestation, AtlasMind now checks it, and shows the agent as *authorised by* that person. **AtlasMind:
Revoke a Buzz Identity** stops a person's or an agent's messages, and those of every agent a revoked
person authorised, from becoming work, and shows the owner the Buzz-side command to run. A repository
can add a revocation and can never lift yours.

## What's new in 0.510.0

**Hand a step to Codex or Claude, and keep the record.** With ACP tools on, a step routed to a
subscription agent is now handed over whole: the agent does the work in the step's own folder, each
file it edits is snapshotted before AtlasMind approves the edit, and the files it changed are read
from git afterwards, not from its own description. The Project Run Center shows what changed, what
the agent did not mention, what has no rollback point, and the agent's plan. Codex's approval prompts
now name the files. A step an agent has already acted on is never retried automatically.

## What's new in 0.509.3

**ACP agents ask before they act.** Codex's default ACP mode edits files and runs commands without
asking, so AtlasMind's approval gate never saw them, even with ACP tools switched off. Every Claude
and Codex session now runs in the agent's verified asking mode, checked before every turn. A turn
routed to a named model now runs on that model, a model your plan refuses is dropped after the first
refusal, Codex warnings stay out of answers, and a stale `CODEX_PATH` is reported as a settings
problem. See [ACP troubleshooting](docs/model-routing.md#acp-runtime-and-sign-in-checks).

Only the three newest releases are summarised here. The last Marketplace publication, **v0.509.0**, is
the build the Marketplace serves; every release, older ones included, is written up in full in
[CHANGELOG.md](CHANGELOG.md).

---

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
| **A 27-page project dashboard** | Overview, project score, gap analysis, workflow, roadmap, issues, pull requests, approvals, people & follow-ups, branches, repository, pipeline, testing, tech debt, defects, security, privacy, risk, compliance, planned editions and tiers, public versions, release, delivery, documents, project memory, runtime and ideation. Built from your repository, not from data you re-enter. |
| **Registers that don't forget** | Approvals, defects, test cases, tech debt, risk, compliance and research findings *transition* rather than vanish — resolved stays distinct from obsolete, accepted from dismissed — each graded by a published rule table so two people reading the same project get the same answer in March and in July. |
| **A roadmap that knows what blocks what** | A dependency graph beside the prioritised backlog: readable tree layout, release gates, owners, estimates, routes to any item, and honest "not assessed" instead of a confident zero. |
| **A team of specialists** | 27 built-in agents — debugger, frontend, backend, reviewer, security, testing, docs, performance, DevOps, dependencies, SEO, UX, release and CI, plus ethics, legal, commercial and market oversight. Add your own. Optional: bring your own AI tool instead. |
| **50 built-in skills** | File edits, the full local git lifecycle (branches, worktrees, fetch/pull, merge, stash), terminal, Docker, test runners, code navigation, debugging, web fetch, and more. Extend with your own or connect MCP servers. |
| **Smart model routing** | Cloud, local, or your existing subscription — chosen per task by fit, cost, speed, health, and past results. |
| **Project memory** | Architecture, decisions, roadmap, lessons and operations kept as readable Markdown in your repo, retrieved when relevant. |
| **A guided GitHub workflow** | Ideation → issues → branches → development → pull requests → CI → release → tech debt, each with its own automation level from *watch* to *act*. |
| **Reviewed-PR local CI** | Patch a repository once, inspect and approve one exact same-repository PR SHA, then run its declared checks on AtlasMind's one-job Docker runner. Codex, Claude, other agents and humans share the same boundary. |
| **Project planning & Mission Control** | Dependency-aware task plans, previews, checkpoints, resumable runs, and goal evaluation inside limits you set. |
| **Ideation board** | Visual thinking that reaches the backlog — cards become roadmap items, roadmap items become issue drafts. |
| **Tech debt register** | Deferred work found from your own code markers, graded by a published rule you can read, tracked rather than forgotten. |
| **Testing strategy** | 69 configurable methodologies — including data & schema, AI-specific and compliance families — with owners, tooling, evidence checks, scaffolding, and sync to other AI tools. |
| **Works with your existing AI tool** | The roadmap SSOT rule, testing methodologies, debt markers and workflow rules are synced into Copilot, Claude Code, Cursor, Codex, Gemini CLI and Windsurf instruction files as managed blocks. The management layer needs no chat of its own. |
| **UI Studio** | Pick up the UI files already in the project or draw new surfaces, design them beside the canvas with a built-in-browser preview, brand them from named presets, and hand off to the implementation. Screens, flows, content, wireframes, tokens, components and responsive inspection are all here. Website delivery — the stack, the three hosting environments, the platform targets and the n8n map — lives on the Project Dashboard's Delivery page. |
| **Voice, vision & remote** | Local or hosted speech, image analysis, opt-in remote control, and a keep-awake lock for long runs. |
| **Lenses over your code — and your services** | Eleven read-only views built from what your project declares: flow, change impact, test evidence, state lifecycle, config precedence, field wiring, branch change story — plus three that compare your declared schemas against what a live API or database actually serves. Shape only: never a row, never a write, off by default. |
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
| `/bootstrap` | Set up project memory and foundations — asks first for the project in your own words (kept verbatim, skippable); declare Shopify composition or choose a game architecture seed |
| `/import` | Build project memory from an existing repository |
| `/project <goal>` | Plan and run a coordinated piece of multi-step work |
| `/loop <goal>` | Chase a goal inside cost, time and iteration limits |
| `/ideate` | See what's on the ideation board and what needs attention |
| `/research` | What the research scans found outside your repository |
| `/agents` · `/skills` | List your agents and skills (edit them in the Agent Manager) |
| `/discover <query>` | Find MCP servers, agents, skills and APIs to add |
| `/memory <query>` | Query project memory (browse and edit it in the Memory view) |
| `/cost` | Running spend for this workspace across all sessions (each reply's own cost is in its footer) |
| `/runs` | Recent autonomous runs and checkpoints |
| `/director` · `/followups` | People, responsibilities, assignments and what's overdue |
| `/setup` · `/acp` · `/buzz` · `/lens` · `/localci` · `/portal` | Guided setup walkthroughs |
| `/localci patch` · `/localci-patch` | Preview and write the three AtlasMind-managed files that opt the current repository into reviewed-PR local CI |
| `/localci review` · `/localci-review` | Select an eligible PR, inspect and approve its exact head SHA, then start the one-job runner |
| `/compliance` | What evidences each governance regime, control by control; `/compliance next` for the next control needing a decision |
| `/ship [routine]` | Run a saved project routine |
| `/sync-instructions` | Keep every AI tool's instruction file in agreement |
| `/voice` · `/vision` | Speech and image analysis panels |

The same reviewed-PR operations are also available as **AtlasMind: Patch This Repository for Local CI** and **AtlasMind: Run a Reviewed Pull Request on Local CI** in the Command Palette.

**AtlasMind: Describe the Project in Your Own Words** (Command Palette, and a Get Started walkthrough step) asks who the project is for, what it should do and what should be true once it works, and saves the answer exactly as written to `project_memory/project-brief.md`. It asks before replacing a brief that already exists; reading the brief into cards is a separate step on the Ideation board.

**AtlasMind: Prepare Sandbox Dependencies** (Command Palette) installs the open folder's lockfile (npm, pnpm or Yarn 1) into a dependency volume, so that under `atlasmind.sandbox.mode = require` commands that load installed packages can run in the sandbox — your own `node_modules` is never used there. It is the sandbox's one network-on step: it runs only when you ask, in a trusted workspace, shows every engine command and what network access means first, mounts only `package.json` and the lockfile read-only, writes only into the volume, and skips install scripts unless you confirm a second warning. **AtlasMind: Remove Sandbox Dependency Volumes** lists the volumes AtlasMind prepared and removes the ones you pick.

**AtlasMind: Connect Unsloth Studio** (Command Palette, or *Connect Unsloth Studio…* in Settings → Models & Integrations) adds Unsloth Studio as a local endpoint. It asks for the address, checks the server answers as Unsloth Studio before asking for anything else, asks for an `sk-unsloth-` API key (create one in Studio under Settings → API Access), tries it, and only then stores it in the OS keychain for that endpoint alone. Plain HTTP to another machine asks first, because the key would cross the network unencrypted. **AtlasMind: Manage Unsloth Models** lists what Studio has loaded and downloaded, discovers Unsloth's chat-model GGUF builds on Hugging Face, and loads a model at a quantisation you pick (size, on disk or not, fits your VRAM or not, with a suggestion and the rule that made it). It can also unload or delete; downloading and deleting ask first, and a dry run holds all of it. Downloads are done by Studio itself — AtlasMind sends only the repository id and quant.

**AtlasMind: Check Execution Sandbox** (Command Palette) reads your container engine on request and opens a report: every sandbox rule with its result and reason, what the probe ran, and what to do about the rule that failed. It never pulls an image; in a dry run it reads the engine but does not start the canary container. It says what the mode makes of the result: under `require` agent commands run in the sandbox or are refused, under `off` they still run on your machine.

**AtlasMind: Toggle Dry Run** (Command Palette, or the *Dry run* status bar item while it is on) switches dry run on and off — tool calls that would write, run commands or reach the network are described instead of run, and AtlasMind's own actions outside a turn (routines and `/ship`, promotions, dashboard git and GitHub writes, messages, terminal sends, installers, automatic memory writes) are recorded instead of done. On applies at once; off from the next turn.

Full behaviour and the Command Palette list are in [Chat Commands](wiki/Chat-Commands.md).

---

## A few settings worth knowing

Everything is in the AtlasMind Settings panel, or under `atlasmind.*` in VS Code settings.

| Setting | Default | What it does |
|---|---:|---|
| `budgetMode` | `balanced` | How much you're willing to spend per task |
| `speedMode` | `balanced` | Fast answers versus more considered ones |
| `reasoningMode` | `auto` | How hard the model should think — `minimal`, `standard`, `deep`, or `auto` from the task. Sent only to models with a verified reasoning control |
| `dailyCostLimitUsd` | `0` | Daily spending cap; `0` means no cap |
| `memory.backgroundSummarizationMode` | `off` | Whether a background timer may summarise project memory with a model. Off by default — nothing is sent on a timer unless you enable it |
| `memory.selfHealingMode` | `report-only` | What background memory maintenance may do to your files. The default reports and never writes |
| `cost.comparisonModel` | *(empty)* | Re-price your spend against this model to see what the same work would have cost. Empty by default — the choice decides what the saving is measured against |
| `cost.historyLocation` | `machine-private` | Where this project's spend history lives. `repository` makes it diffable and report-readable; changing it moves what's already there |
| `producerReport.publishEnabled` | `false` | Allow the producer report to be prepared for GitHub Pages. A Pages site is public **even from a private repository** |
| `producerReport.publishRisks` · `publishCost` | `false` | Add the risk register or cost to the published page. Off separately, because each is a disclosure |
| `toolApprovalMode` | `ask-on-write` | How often AtlasMind asks before acting |
| `allowTerminalWrite` | `false` | Whether approved terminal commands may change things |
| `security.untrustedEscalationScope` | `third-party` | After a task reads untrusted content, writes and network calls need a fresh approval Autopilot cannot answer. Reads stay free; there is no off |
| `dryRun.enabled` | `false` | Dry run: every tool call that would write, run a subprocess or reach the network is described instead of run, and AtlasMind's own actions outside a turn — routines, promotions, dashboard git and GitHub writes, messages, terminal sends, installers, automatic writes — are recorded instead of done; only reads run. Model calls still run. On applies at once, off from the next turn. User settings only |
| `security.quarantineReader` | `on` | A third-party result over 8,000 characters is read by a separate tool-less model; the agent gets a checked extract, and the full text only after you approve releasing it. The reader counts toward the task's cost cap and the daily limit |
| `skillAutoSynthesisEnabled` | `false` | Let a model write a new skill and run it when a tool does not exist. Off; every synthesis is scanned and shown to you first |
| `cli.addToTerminalPath` | `false` | Put the `atlasmind` launchers on the PATH of new integrated terminals. Off, because it persistently changes your shell |
| `autoVerifyAfterWrite` | `true` | Run your checks automatically after a change |
| `ssotPath` | `project_memory` | Where project memory lives in your repo |
| `chatSessionTurnLimit` | `6` | How much recent conversation carries forward |
| `dashboard.chatDestination` | `atlasmind` | Where Project Dashboard Atlas actions submit: AtlasMind, the current VS Code Chat target, or an installed prompt-capable chat extension. Settings shows the matching prompt button; click it to send a live route test. Internal participant routes are collapsed to one choice per extension. A stale Extension Development Host retains the validated workspace choice until its settings registry reloads |
| `lens.live.enabled` | `false` | Let the live lenses read the schema a running service serves. Shape only, never a row |
| `ci.localRunner.enabled` | `false` | Permit one confirmed ephemeral runner for an already-queued trusted job; machine-scoped |
| `ci.localRunner.shutdownPolicy` | `ifStartedByAtlasMind` | Keep Docker open, close it only when AtlasMind opened it, or always close when no other container runs |
| `testing.resourceShare` | `50` | Sliding scale for local test execution: the percentage of this computer tests may use, across every path AtlasMind runs or composes; the OS always keeps ≥25% (≥2 CPUs / 8 GB); machine-scoped |
| `execution.worktreeIsolation` | `false` | Give each file-writing step of a job its own git worktree so a batch can write in parallel. Off means writers run one at a time — this setting buys back speed, it is not what makes the run safe |
| `sandbox.mode` | `off` | Whether agent commands must run in the container sandbox. Under `require` a command runs in it or is refused with the rule that stopped it — never on your machine instead; check availability with *Check Execution Sandbox*. The tightest scope wins, so a repository can ask for it but never switch it off |
| `sandbox.image` | *(empty)* | The sandbox image, pinned as `name@sha256:<digest>`; a tag is refused and nothing is pulled. Machine-scoped, so a repository cannot choose it |
| `sandbox.relaxTerminalApprovals` | `false` | Let a terminal write skip its approval prompt when it will run in a confirmed sandbox under `require`. Never after untrusted content, never past `allowTerminalWrite`, never for anything but a terminal write the sandbox would run; every skipped prompt is recorded with its attestation. Machine-scoped: a repository cannot loosen your approvals |
| `terminal.passEnvironment` | `[]` | Exact names of credential-shaped environment variables to pass to agent commands anyway. Everything credential-shaped is otherwise withheld from what an agent runs; machine-scoped, so a repository cannot add a name |
| `routines.scheduling.enabled` | `false` | Let routines that declare a `schedule:` run on their own while the editor is open, each in its own worktree, once you approve their exact steps. Never pushes, merges or installs unattended |
| `buzz.revokedIdentities` | `[]` | Buzz identities AtlasMind no longer trusts. Their messages, and those of any agent they authorised, never become work. Read from every scope, so a repository can revoke but never un-revoke |

All 177 settings are documented in the [Configuration reference](wiki/Configuration.md).

---

## Extension commands

**AtlasMind: Set Approval Mode** selects Ask, Auto or Bypass for this extension session. The same
selector is in chat and Project Dashboard → Workflow. **AtlasMind: Toggle Autopilot** remains the
shortcut for the existing session Bypass grant. **AtlasMind: Revoke a Buzz Identity** stops AtlasMind
turning a Buzz identity's messages — and those of any agent it authorised — into work, and shows the owner
the Buzz-side command to run. See the full [command reference](wiki/Chat-Commands.md).

## Where things live

| Path | What's in it |
|---|---|
| `src/core/approvalModes.ts` | Eligible actions, bounded model review and strict reply validation; runtime grants live in `toolApprovalManager.ts` |
| `src/core/` | Declared game-debt derivation/collection (`gameDebt.ts`), Bounded project-produced performance evidence (`performanceReport.ts`), Orchestration, routing (with the reasoning axis — how hard to think, sent only to models with a declared control, `reasoningBudget.ts`), planning, safety, cost, project composition, opt-in workspace scope, read-only upstream distance, game-engine identity, bounded asset inventory, pure engine-fork interpretation, hostile-input build-log reading, and the declared game profile (`projectComposition.ts`, `workspaceScope.ts`, `upstreamDivergence.ts`, `gameEngineIdentity.ts`, `gameAssetInventory.ts`, `gameEngineDivergence.ts`, `gameBuildLog.ts`, `gameProfile.ts`), UI Studio's graph/edit/live-preview/repository core (`uiDesignGraph.ts`, `uiEditCommands.ts`, `uiPreviewRuntime.ts`, `uiRepositoryMapping.ts`, `uiRepositoryImport.ts`, `uiSurfaceScan.ts`), brand presets — one named token set applied to many surfaces by alias, extracted from a stylesheet with a citation (`brandPresets.ts`) — and the engine emitters with anchored, patch-by-anchor content write-back and constant-argv launch plans (`uiSurfaceEmit.ts`), what a found surface can honestly be rendered as — a real static file, the project's own dev server, or not here and why (`uiSurfaceRender.ts`), element editing in a found static page — a tolerant parser whose output is source offsets, a declared table of where an element may go, and each edit as one splice refused against a changed file (`htmlSourceMap.ts`, `uiSurfaceElementEdit.ts`, `uiSurfaceEditDocument.ts`), CI inspection/scaffolding (`ciManager.ts`, `trustedLocalCiStarter.ts`), the CI route model, routing policy, build ledger and act adapter (`ciRoutes.ts`, `ciRoutingPolicy.ts`, `ciCreditMeter.ts`, `ciBuildLedger.ts`, `ciActRoute.ts`), the local CI guide, GitHub CLI installer and remembered machine inspection (`localCiSetupPlan.ts`, `localCiInstaller.ts`, `localCiInspectionMemory.ts`), the provider-neutral reviewed-PR contract, exact-SHA policy and repository patcher (`localCiRepositoryPatch.ts`, `reviewedPrLocalCi.ts`), who may start a local-CI job — the repository owner, or the one account an organisation-owned repository pins by id (`localCiActorGuard.ts`), confirmed-write echo (`trackerWriteOutcome.ts`), the register-to-work hand-off (`registerHandoff.ts`), the personal-vs-project split behind the two sidebar people views (`directorPriority.ts`), the semver primitives and branch-to-channel versioning policy (`semver.ts`, `versioningPolicy.ts`), the shell-free Windows shim bypass shared by the extension host, the CLI and the ACP launcher (`windowsShimBypass.ts`), the pure core of sandboxed execution — digest-pinned image, Linux engine, one mount, no network, and `require` never falling back to the host; (`sandboxPlan.ts`), the probe that reads the engine for it — engine, pinned image present locally, a canary in the real argv, never a pull (`sandboxProbe.ts`), and the runner that under `require` runs an agent's command in the container or refuses it, never on the host (`sandboxRunner.ts`), and the opt-in that lets a terminal write bound for a confirmed sandbox skip its prompt, decided on the session that will run it (`sandboxApprovalRelaxation.ts`), the dependency volume a sandboxed command loads installed packages from — keyed to the lockfile, prepared only on request in the one network-on container, never unattended (`sandboxDependencies.ts`), the environment an agent's command gets on the host — every credential-shaped variable withheld by a declared rule, a named one passed only when you list it (`hostCommandEnvironment.ts`), parallel-write placement, worktree plumbing, merge-back and the run that ties them together (`worktreeIsolation.ts`, `worktreeManager.ts`, `worktreeMerge.ts`, `worktreeRun.ts`), the live security advisory feed and the per-turn context breakdown and the producer-portal hosting guide (`advisoryFeed.ts`, `contextBudget.ts`, `producerPortalPlan.ts`), the defect register — what is broken, graded by a published table rather than asked for (`defectRegister.ts`), the approval register — who agreed, to which version, and what goes stale when it changes (`changeApprovals.ts`), the test-case register — the manual half of testing, its owners and the assets it needs (`testCaseRegister.ts`), the ambient event bus — what may wake AtlasMind up, how far it may go, and why it stayed quiet (`ambientTriggers.ts`), the six cross-cutting utility decisions with their verified vendor facts (`utilityPacks.ts`), the searchable codebase index — what may be indexed, what is stale, and what a result may be taken to mean (`codebaseIndex.ts`, `codebaseIndexStore.ts`), where the producer portal is hosted and who may read it, and what one press to publish would actually do (`portalHosting.ts`, `portalPublishPlan.ts`), golden cases for an agent and the gate on an unattended prompt rewrite (`agentEvalHarness.ts`), what each person has been asked to do against the capacity they declared, and declared absence read out of an exported calendar (`teamWorkload.ts`, `rotaImport.ts`), baselines you can name so "what changed" can be asked about a moment you chose (`baselineRegister.ts`), the project in your own words and the grounding rule for anything read out of it (`projectBrief.ts`), the chain from that brief to board, roadmap, plans and soul, planned from the files (`projectBriefChain.ts`), handing a subtask to an ACP agent — the working tree read from git before and after, a rollback point taken when each edit is approved, the agent's own account kept as a cross-check (`acpDelegation.ts`), owner attestations on Buzz agents' events checked against the published NIP-OA rules, and AtlasMind's own Buzz revocation list (`buzzOwnerAttestation.ts`, `buzzRevocation.ts`), the roadmap dependency graph, its overlay store, the chain the finish rests on and the plan against time (`roadmapGraph.ts`, `roadmapGraphStore.ts`, `roadmapCriticalPath.ts`, `roadmapTimeline.ts`, `roadmapBoard.ts`), which backlog items may belong on a release gate, from a published rule table (`roadmapGateCandidates.ts`), whether the configured team can work and how much of it is used (`agentCapacity.ts`), and the git trailers that link a commit to the work it was for (`commitTrailers.ts`), and the evidence-triggered MCP capability offer (`capabilityOffer.ts`), release-gate destinations and urgency ordering (`releaseGateNavigation.ts`), roadmap ingestion from markdown, issues, Projects and spreadsheets (`roadmapImport.ts`, `roadmapReconcile.ts`) plus the guarded `localCiRunner.ts` executor, the governance-compliance stack — the control catalog, evidence register and readiness grader (`complianceControlCatalog.ts`, `complianceEvidenceRegister.ts`, `complianceReadiness.ts`) the per-methodology standard editions (`testingStandards.ts`), the Compliance page's view builder (`complianceDashboard.ts`), its walkthrough (`complianceSetupPlan.ts`), the shared stack-signal gatherer (`complianceStackSignals.ts`) and the mapping importer (`complianceMarkdownImport.ts`) — and project services |
| `src/core/releaseMatrix.ts` | Pure schema, sanitization, mutation and metrics for the planned Editions feature-by-offering matrix; filesystem writes stay in the Project Dashboard host |
| `src/core/releaseMatrixImport.ts` | Pure, bounded design-document discovery, Markdown/JSON parsing, conservative roadmap/Issue matching, and reviewed non-destructive merge planning for Editions |
| `src/core/contextProvenance.ts` | What a task has read, and what that means for the next thing it asks to do: a provenance class for every message and tool result, the shared REPORTED CONTENT fence the content cannot close, and the published table deciding which writes and network calls need a fresh approval Autopilot cannot answer |
| `src/core/egressDestinationPolicy.ts` | Where a model-initiated fetch may go: the URL screen, the published private and reserved address ranges judged by numeric value, and the rule that every address a name resolves to must pass |
| `src/core/egressFetch.ts` | The connection that honours that decision: pinned to the vetted addresses so DNS cannot change the answer, redirects followed by hand and screened hop by hop, credentials dropped across origins |
| `src/core/dryRun.ts` | Dry run: the published table grading every built-in skill as a local read, an argument-dependent one or an effect, the rules deciding execute-or-simulate, the context backstop that refuses every method able to change something, the simulated result the model gets, and the session ledger behind the output channel |
| `src/core/dryRunHost.ts` | Dry run outside the tool loop: the host every routine, promotion, dashboard write, message, terminal send, installer and automatic write asks before acting, which records what it stopped in the same ledger and tells the person who pressed the button |
| `src/core/quarantinedReader.ts` | The quarantined reader: a third-party tool result over 8,000 characters is read by a separate, tool-less model, and the agent gets a schema-checked extract and a handle instead of the raw text — the routing rules, the extraction prompt, the validator, the fallbacks and the approval-gated release |
| `src/core/capabilitySearch.ts` | When `find-tool` finds no installed skill: sends the redacted, clamped query to the Agent Finders you enabled and returns up to five candidates to review and install — searching installs and grants nothing |
| `src/runtime/` | Built-in agents and runtime composition |
| `src/bootstrap/` | `/bootstrap` and its intake (`bootstrapper.ts`), and the question asked first — the project in your own words, kept verbatim and skippable, shared with the Describe the Project command (`projectBriefOnboarding.ts`) |
| `src/providers/` | Model provider adapters (the ACP bridge's launch-path checks live in `acpAgentEnvironment.ts`), catalogs, health, `modelRole.ts` (what a model is *for*), the local-GPU support layer — `gpuProbe.ts`, `localFootprint.ts`, `localRuntimeClient.ts` — and Unsloth Studio's native API, read from its source: identity before the key, server-side tools off, quant suggestion and its own GGUF catalogue (`unslothStudio.ts`) |
| `src/skills/` | Built-in tools and skill handlers |
| `src/memory/` | Project memory: retrieval, scanning, redaction, persistence |
| `src/chat/` | The chat participant and interaction protocol |
| `src/views/` | Settings, dashboards, editors and sidebar surfaces, the Buzz revoke/restore commands (`buzzRevocationCommands.ts`), the Check Execution Sandbox report (`sandboxCheckCommand.ts`), the Connect Unsloth Studio and Manage Unsloth Models commands — the quant picker, confirmed download-and-load with cancel, unload and delete, each held by dry run (`unslothModelCommands.ts`), including the shared reviewed-PR local-CI action allowlist and host commands (`localCiSurfaceActions.ts`, `reviewedPrLocalCiCommands.ts`) and UI Studio's render host — a found surface shown as itself in a scripts-off panel or through the project's confirmed dev server (`uiSurfaceRenderHost.ts`) and its element-edit host — the page made selectable under AtlasMind's own nonce script, every edit confirmed before and after and held by dry run (`uiSurfaceEditHost.ts`) |
| `src/utils/workspaceRoots.ts` | The one place AtlasMind asks VS Code which folders are open. Its default is exactly the first folder, as before; every other direct read is ceilinged per file by a ratchet test so the single-root tail can only shrink |
| `src/acp/` and `src/cli/` | Subscription-agent sessions and the headless CLI |
| `src/mcp/` and `src/ard/` | MCP servers and agentic resource discovery, including tool pinning and the tool-description scan — what a tool looked like when you agreed to it, and what happens when it changes (`mcpToolPins.ts`) |
| `src/voice/` and `src/remote/` | Voice backends and opt-in remote control |
| `.github/workflows/` | Hosted release CI plus the separately gated trusted local-runner workflow |
| `tests/` | Unit, integration, webview, security and regression coverage |
| `docs/` and `wiki/` | Developer reference, user guides, and the approved UI Studio and Chat reliability plans |

The full service map is in [Architecture](docs/architecture.md).

Source debugging uses two F5 profiles. Both run a finite full compile before launch and disable the JavaScript
debugger's experimental Node network inspection; this avoids retaining a large `tsc -watch` process and the
`Missing dataLength in event` inspector failure observed on VS Code 1.137.0. **Run Extension** is the stable
default and also disables built-in GitHub Copilot Chat. **Run Extension (Copilot integration)** is the opt-in
profile for testing AtlasMind's Copilot-provider path. See the [development guide](docs/development.md#run).

---

## Documentation

**Start here:** [Getting Started](wiki/Getting-Started.md) · [FAQ](wiki/FAQ.md) · [Chat Commands](wiki/Chat-Commands.md) · [Configuration](wiki/Configuration.md)

**Using it well:** [Agents](wiki/Agents.md) · [Skills](wiki/Skills.md) · [Model Routing](wiki/Model-Routing.md) · [Memory System](wiki/Memory-System.md) · [Project Planner](wiki/Project-Planner.md) · [Ideation](wiki/Ideation.md) · [GitHub Workflow](wiki/GitHub-Workflow.md) · [Delivery](wiki/Delivery.md) · [UI Studio](wiki/Website-Studio.md) · [UI Studio builder plan](wiki/UI-Studio-Builder-Plan.md) · [CLI](wiki/CLI.md)

**Trust and safety:** [Security](wiki/Security.md) · [Prompt-injection threat model](wiki/Prompt-Injection-Threat-Model.md) · [Tool Execution](wiki/Tool-Execution.md)

**Under the hood:** [Architecture](docs/architecture.md) · [Development](docs/development.md) · [Prompt-injection threat model (engineering)](docs/threat-model-prompt-injection.md) · [Chat reliability and capability broker plan](docs/chat-reliability-capability-broker-plan.md) · [Local CI and safe runners](docs/local-ci-and-safe-runners.md) · [Roadmap](docs/roadmap.md) · [Contributing](CONTRIBUTING.md)

---

## Open source, and the Maintenance Fee

**The source code is freely available under the [MIT licence](LICENSE)** — clone it, compile it,
modify it, redistribute it, no fee and no agreement. That does not change and is not going to.

This project participates in the [Open Source Maintenance Fee](https://opensourcemaintenancefee.org).
**From v1.0.0**, organizations with annual gross revenue of **US$10,000 or more** that use
AtlasMind's official releases as part of revenue-generating activities pay a monthly fee — **$10**
under 20 employees, **$40** to 100, **$60** above — through
[GitHub Sponsors](https://github.com/sponsors/JoelBondoux). The terms are
[OSMFEULA.txt](OSMFEULA.txt), and they cover the **official binary release**: the `.vsix` on the
Marketplace. Self-compiled builds are MIT and always will be.

**No fee is payable before v1.0.0.** AtlasMind is in Beta, and until then the MIT licence is the only
agreement that applies to any release. Nobody owes anything today. It's published now so it arrives
as a plan rather than a surprise, and 1.0.0 is the trigger because that's when the configuration and
memory formats freeze — a Beta that may still move under you hasn't earned it.

**Nobody outside that scope pays anything, ever.** Individuals, students, hobby projects,
non-profits, open source projects, and any organization under the revenue floor. There's a voluntary
$5 Supporter tier for them, and it is not the fee.

**No tier buys a feature, a vote, priority triage, a service level or a logo.** Every user gets the
same software. The fee funds maintenance — issue triage, releases, dependency and security updates —
not position in the queue.

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Full detail in
[MAINTENANCE_FEE.md](MAINTENANCE_FEE.md) and
[Funding and sponsorship](wiki/Funding-and-Sponsorship.md).
