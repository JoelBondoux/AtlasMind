<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind</h1>

<p align="center"><sub> · <strong>Current source version: 0.447.0</strong> · </sub></p>


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

That's the job AtlasMind does. A **23-page project dashboard** built entirely from your own
repository: roadmap and dependency graph, issues and pull requests, people and follow-ups, risk,
compliance, technical debt, testing evidence, documents, delivery and release readiness. Nothing is
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
`.windsurfrules` — as a **managed block** it maintains and you can delete: your enabled testing
methodologies, the technical-debt markers it scans for, and the stage-by-stage rules of your
declared GitHub workflow. Whatever agent you use gets told the same rules AtlasMind holds itself to,
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
4. Tell AtlasMind about it — `@atlas /bootstrap` for a brand-new project, `@atlas /import` for an existing one.
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

Full detail in the [Security model](wiki/Security.md) and [Tool Execution](wiki/Tool-Execution.md).

Personal and classified project context has a separate, opt-in boundary. The
[Data privacy and GDPR guide](wiki/Data-Privacy-and-GDPR.md) explains the detector pack, trusted-model
allow-list, redaction and file-withholding behaviour, retained metadata, provider references, and the
important limits on overrides and compliance claims.

---

## What's new in 0.447.0

The last Marketplace publication, **v0.420.4**, brought the changes below. Every release is written
up in full in [CHANGELOG.md](CHANGELOG.md).

- **The dashboard says when your providers are in trouble.** It already counted them — `4/9 providers
  healthy` sat in a stat card's subtitle, in the same grey as everything else, on the page whose job
  is to tell you what needs a person. No enabled model anywhere now leads the *Needs you* band, above
  a red pipeline: a failing test is something you can work on, and no routable model is not. The
  score also reflects how much of your configured team actually gets used — silently, until there's
  enough run history to mean anything.
- **Roadmap work assigned to an AI agent is estimated in minutes, not working days.** If your agents
  do the coding, an item can be planned and finished inside an afternoon — and the roadmap couldn't
  say so, because every estimate was in working days with a half-day floor. Worse, the arithmetic
  rounded to the nearest half-day, so a plan run entirely by agents reported *no work left at all*.
  Mark a contact as an AI agent on the Director page and their roadmap work is graded in wall-clock
  instead. The size of the job is judged the same way; what a unit of it costs is not.
- **The roadmap now says which chain of work the finish date rests on.** The backlog could tell you
  what mattered most and the dependency canvas could tell you what waited on what. Neither said
  *which chain actually decides when this lands* — so a plan could be correctly prioritised,
  correctly sequenced, and still have everyone working on the items that were never the constraint.
  The canvas now names the critical path and the days along it, and a lens highlights it while
  leaving everything else drawn and dimmed, because the items with slack are the comparison that
  makes the answer worth having.
- **Closing or hiding a chat no longer stops it.** Clicking another view in the sidebar threw the
  chat's window away mid-answer — VS Code disposes a hidden view's webview — and that killed the run.
  The sidebar now keeps its contents when hidden, and a chat that genuinely loses its window keeps
  going: your answer is written to the session as it arrives, so reopening the chat shows the
  finished result. A run that outlives its window is still spending money, so a status-bar item names
  what's running and lets you read or stop any of it — closing the window is no longer how you stop a
  run, so that is. Reopen the chat and it picks the run back up: the answer streams in, the stop
  button is back where you'd look for it, and asking something else starts a fresh conversation
  rather than mixing two answers into one.
- **Two steps of a job can no longer overwrite each other's edits.** When AtlasMind broke work into
  steps it ran up to five of them at once against one copy of your files, with nothing keeping two of
  them from editing the same file — and when that happened, one of the two changes simply wasn't
  there afterwards, with both steps reported as finished. Steps that write now run one at a time.
  That is slower, and it is the correct behaviour. Turn on `execution.worktreeIsolation` and the
  parallelism comes back: each writing step gets its own git worktree, and its changes are applied to
  your files as its batch finishes. A step whose changes won't apply cleanly keeps its worktree and
  tells you where it is, rather than being forced in or thrown away. The second time a run queues
  writers behind each other, AtlasMind offers you the setting — once, never modally, and never when
  turning it on wouldn't have changed the run you just watched.
- **Select several items and move them together, on both canvases.** Shift-drag on the roadmap or
  the ideation board draws a selection box; dragging any selected item moves the whole group. Plain
  dragging still pans, because panning is how you read a plan that doesn't fit on screen. On the
  ideation board the box shares the selection that links cards, so selecting more than two now asks
  you to choose the pair rather than guessing at it.
- **"Read-only" now holds for the whole job, not just the first step.** Asking AtlasMind to work
  read-only was enforced properly on the turn you typed — but if that turn became a multi-step project
  run, each step re-read its own instructions and found no restriction in them. The limit you set now
  travels with the work and can only narrow, never widen. Separately, an MCP server that asked for one
  environment variable used to receive every credential the editor was started with; it now gets a
  filtered set plus what it declared.
- **Supply chain tightened.** Every CI action is now pinned to an exact commit rather than a movable
  tag, the project bootstrapper no longer starts a shell for anything, and the Debian install path
  that piped a download into `sudo` has been removed in favour of the manual instructions. There is a
  written [dependency review](docs/dependency-security-review.md) and an SBOM command.
- **Starting the editor contacts nobody.** AtlasMind loads when VS Code starts, and two things
  reached third parties from there that your settings never asked for: an exchange-rate lookup that
  ran even though costs display in USD by default and needed no conversion, and a downloadable-model
  catalogue fetched from two sites even on machines with no local model runtime installed. Both are
  now gated on your own configuration actually needing them. There is no telemetry and never has
  been.
- **Model-written skills no longer run beside the extension.** AtlasMind can write a small skill for
  itself mid-task — off by default, and never without you reading the code and approving it. Until now
  that code was evaluated in the extension's own scope: eight ways of reaching the filesystem were
  tried against it and seven worked. It now evaluates somewhere with none of that in reach, and all
  eight are refused. It is containment rather than a sandbox, the remaining gap is written down, and a
  test asserts we never call it the stronger word.
- **Routines show you the commands before they run, and Autopilot has a ceiling.** `/ship` and the
  Run Center now list the exact shell commands a routine will run, in order, and say which ones reach
  outside your machine — a routine file is an ordinary workspace file, so the moment before it runs is
  the moment worth reading it. A placeholder with no value is refused rather than quietly becoming an
  empty string. And Autopilot can no longer approve an outward change that cannot be undone — a push,
  a remote branch delete, or a tool AtlasMind does not recognise.
- **Nothing reaches a model without saying what it is.** Every prompt-bearing call in AtlasMind now
  clears its context through one boundary first, which redacts repository-derived text, holds each
  kind of content to its own size limit, and never silently rewrites what you typed. Direct calls
  that skipped it: 11 → 0, with an architectural test that fails when a new one appears. If a
  credential turns up in your own prompt on its way to an external provider, AtlasMind asks — *send
  redacted* or *send as typed* — and dismissing the dialog sends nothing.
- **AtlasMind follows the Open Source Maintenance Fee model.** The source code stays MIT permanently,
  and compiling it yourself is free for everyone, always. From **v1.0.0** the official Marketplace
  build carries a maintenance fee for organizations with annual gross revenue of US$10,000 or more
  that use it in revenue-generating work — $10–$60 a month by headcount. Nothing is payable before
  v1.0.0, nobody outside that scope ever pays, and no amount of money buys a feature, a vote or
  priority. See [MAINTENANCE_FEE.md](MAINTENANCE_FEE.md).
- **A command injection on Windows, found and closed.** Starting a tool through a shell concatenated
  model-generated arguments into one unescaped command line, so `&` followed by anything ran as a
  command of its own while the approval dialog showed something harmless. Commands now resolve to a
  real executable and start without a shell; where that cannot be done, the run is refused rather
  than falling back to the hazard.
- **The roadmap became a dependency canvas.** The prioritised backlog is unchanged and still the only
  place drag-reorder sets what comes next. Beside it, the plan now draws as a graph of what blocks
  what: a readable tree layout, search that frames what it matched, highlighting by release gate or
  owner, click-to-zoom, and edge hints when the plan continues past the frame. A roadmap AtlasMind
  did not write is reconciled instead of duplicated, and any item can file its own plan document.
- **An autonomous run refuses work your own workflow forbids, before spending anything.** The stage
  ceilings you declared are checked up front rather than discovered mid-run, so a run that was never
  permitted to open a pull request stops at the plan instead of at the attempt.
- **Delivery, people and interfaces.** The dashboard's version pills switch your checkout to the
  stage you clicked; the two people views in the sidebar stopped reporting the same number twice; and
  UI Studio can locate the interface in your repository rather than asking you to point at it.

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
| **A 23-page project dashboard** | Overview, project score, gap analysis, workflow, roadmap, issues, pull requests, people & follow-ups, branches, repository, pipeline, testing, tech debt, security, privacy, risk, compliance, release, delivery, documents, project memory, runtime and ideation. Built from your repository, not from data you re-enter. |
| **Registers that don't forget** | Tech debt, risk, compliance and research findings *transition* rather than vanish — resolved stays distinct from obsolete, accepted from dismissed — each graded by a published rule table so two people reading the same project get the same answer in March and in July. |
| **A roadmap that knows what blocks what** | A dependency graph beside the prioritised backlog: readable tree layout, release gates, owners, estimates, routes to any item, and honest "not assessed" instead of a confident zero. |
| **A team of specialists** | 27 built-in agents — debugger, frontend, backend, reviewer, security, testing, docs, performance, DevOps, dependencies, SEO, UX, release and CI, plus ethics, legal, commercial and market oversight. Add your own. Optional: bring your own AI tool instead. |
| **50 built-in skills** | File edits, the full local git lifecycle (branches, worktrees, fetch/pull, merge, stash), terminal, Docker, test runners, code navigation, debugging, web fetch, and more. Extend with your own or connect MCP servers. |
| **Smart model routing** | Cloud, local, or your existing subscription — chosen per task by fit, cost, speed, health, and past results. |
| **Project memory** | Architecture, decisions, roadmap, lessons and operations kept as readable Markdown in your repo, retrieved when relevant. |
| **A guided GitHub workflow** | Ideation → issues → branches → development → pull requests → CI → release → tech debt, each with its own automation level from *watch* to *act*. |
| **Project planning & Mission Control** | Dependency-aware task plans, previews, checkpoints, resumable runs, and goal evaluation inside limits you set. |
| **Ideation board** | Visual thinking that reaches the backlog — cards become roadmap items, roadmap items become issue drafts. |
| **Tech debt register** | Deferred work found from your own code markers, graded by a published rule you can read, tracked rather than forgotten. |
| **Testing strategy** | 69 configurable methodologies — including data & schema, AI-specific and compliance families — with owners, tooling, evidence checks, scaffolding, and sync to other AI tools. |
| **Works with your existing AI tool** | Testing methodologies, debt markers and workflow rules synced into Copilot, Claude Code, Cursor, Codex, Gemini CLI and Windsurf instruction files as a managed block. The management layer needs no chat of its own. |
| **UI Studio** | Design websites, apps, extensions, desktop tools, and other interfaces through screens, flows, content, wireframes, tokens, components, full built-in-browser preview, responsive inspection, and implementation handoff. Website profiles also keep protected Develop → Staging → Production delivery. |
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
| `/bootstrap` | Set up project memory and foundations; declare Shopify composition or choose a game architecture seed |
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
| `/setup` · `/acp` · `/buzz` · `/lens` · `/localci` | Guided setup walkthroughs |
| `/compliance` | What evidences each governance regime, control by control; `/compliance next` for the next control needing a decision |
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
| `memory.backgroundSummarizationMode` | `off` | Whether a background timer may summarise project memory with a model. Off by default — nothing is sent on a timer unless you enable it |
| `memory.selfHealingMode` | `report-only` | What background memory maintenance may do to your files. The default reports and never writes |
| `cost.comparisonModel` | *(empty)* | Re-price your spend against this model to see what the same work would have cost. Empty by default — the choice decides what the saving is measured against |
| `cost.historyLocation` | `machine-private` | Where this project's spend history lives. `repository` makes it diffable and report-readable; changing it moves what's already there |
| `producerReport.publishEnabled` | `false` | Allow the producer report to be prepared for GitHub Pages. A Pages site is public **even from a private repository** |
| `producerReport.publishRisks` · `publishCost` | `false` | Add the risk register or cost to the published page. Off separately, because each is a disclosure |
| `toolApprovalMode` | `ask-on-write` | How often AtlasMind asks before acting |
| `allowTerminalWrite` | `false` | Whether approved terminal commands may change things |
| `skillAutoSynthesisEnabled` | `false` | Let a model write a new skill and run it when a tool does not exist. Off; every synthesis is scanned and shown to you first |
| `cli.addToTerminalPath` | `false` | Put the `atlasmind` launchers on the PATH of new integrated terminals. Off, because it persistently changes your shell |
| `autoVerifyAfterWrite` | `true` | Run your checks automatically after a change |
| `ssotPath` | `project_memory` | Where project memory lives in your repo |
| `chatSessionTurnLimit` | `6` | How much recent conversation carries forward |
| `lens.live.enabled` | `false` | Let the live lenses read the schema a running service serves. Shape only, never a row |
| `ci.localRunner.enabled` | `false` | Permit one confirmed ephemeral runner for an already-queued trusted job; machine-scoped |
| `ci.localRunner.shutdownPolicy` | `ifStartedByAtlasMind` | Keep Docker open, close it only when AtlasMind opened it, or always close when no other container runs |
| `testing.resourceShare` | `50` | Sliding scale for local test execution: the percentage of this computer tests may use, across every path AtlasMind runs or composes; the OS always keeps ≥25% (≥2 CPUs / 8 GB); machine-scoped |
| `execution.worktreeIsolation` | `false` | Give each file-writing step of a job its own git worktree so a batch can write in parallel. Off means writers run one at a time — this setting buys back speed, it is not what makes the run safe |

All 154 settings are documented in the [Configuration reference](wiki/Configuration.md).

---

## Where things live

| Path | What's in it |
|---|---|
| `src/core/` | Orchestration, routing, planning, safety, cost, project composition, opt-in workspace scope, read-only upstream distance, game-engine identity, bounded asset inventory, pure engine-fork interpretation, and hostile-input build-log reading (`projectComposition.ts`, `workspaceScope.ts`, `upstreamDivergence.ts`, `gameEngineIdentity.ts`, `gameAssetInventory.ts`, `gameEngineDivergence.ts`, `gameBuildLog.ts`), UI Studio's graph/edit/live-preview/repository core (`uiDesignGraph.ts`, `uiEditCommands.ts`, `uiPreviewRuntime.ts`, `uiRepositoryMapping.ts`, `uiRepositoryImport.ts`, `uiSurfaceScan.ts`), CI inspection/scaffolding (`ciManager.ts`, `trustedLocalCiStarter.ts`), the CI route model, routing policy, build ledger and act adapter (`ciRoutes.ts`, `ciRoutingPolicy.ts`, `ciCreditMeter.ts`, `ciBuildLedger.ts`, `ciActRoute.ts`), the local CI guide, GitHub CLI installer and remembered machine inspection (`localCiSetupPlan.ts`, `localCiInstaller.ts`, `localCiInspectionMemory.ts`), confirmed-write echo (`trackerWriteOutcome.ts`), the register-to-work hand-off (`registerHandoff.ts`), the personal-vs-project split behind the two sidebar people views (`directorPriority.ts`), the semver primitives and branch-to-channel versioning policy (`semver.ts`, `versioningPolicy.ts`), the shell-free Windows shim bypass shared by the extension host, the CLI and the ACP launcher (`windowsShimBypass.ts`), parallel-write placement, worktree plumbing, merge-back and the run that ties them together (`worktreeIsolation.ts`, `worktreeManager.ts`, `worktreeMerge.ts`, `worktreeRun.ts`), the roadmap dependency graph and its overlay store (`roadmapGraph.ts`, `roadmapGraphStore.ts`, `roadmapCriticalPath.ts`), whether the configured team can work and how much of it is used (`agentCapacity.ts`), release-gate destinations and urgency ordering (`releaseGateNavigation.ts`), roadmap ingestion from markdown, issues, Projects and spreadsheets (`roadmapImport.ts`, `roadmapReconcile.ts`) plus the guarded `localCiRunner.ts` executor, the governance-compliance stack — the control catalog, evidence register and readiness grader (`complianceControlCatalog.ts`, `complianceEvidenceRegister.ts`, `complianceReadiness.ts`) the per-methodology standard editions (`testingStandards.ts`), the Compliance page's view builder (`complianceDashboard.ts`), its walkthrough (`complianceSetupPlan.ts`), the shared stack-signal gatherer (`complianceStackSignals.ts`) and the mapping importer (`complianceMarkdownImport.ts`) — and project services |
| `src/runtime/` | Built-in agents and runtime composition |
| `src/providers/` | Model provider adapters, catalogs, health, `modelRole.ts` (what a model is *for*), and the local-GPU support layer — `gpuProbe.ts`, `localFootprint.ts`, `localRuntimeClient.ts` |
| `src/skills/` | Built-in tools and skill handlers |
| `src/memory/` | Project memory: retrieval, scanning, redaction, persistence |
| `src/chat/` | The chat participant and interaction protocol |
| `src/views/` | Settings, dashboards, editors and sidebar surfaces |
| `src/acp/` and `src/cli/` | Subscription-agent sessions and the headless CLI |
| `src/mcp/` and `src/ard/` | MCP servers and agentic resource discovery |
| `src/voice/` and `src/remote/` | Voice backends and opt-in remote control |
| `.github/workflows/` | Hosted release CI plus the separately gated trusted local-runner workflow |
| `tests/` | Unit, integration, webview, security and regression coverage |
| `docs/` and `wiki/` | Developer reference, user guides, and the approved UI Studio and Chat reliability plans |

The full service map is in [Architecture](docs/architecture.md).

---

## Documentation

**Start here:** [Getting Started](wiki/Getting-Started.md) · [FAQ](wiki/FAQ.md) · [Chat Commands](wiki/Chat-Commands.md) · [Configuration](wiki/Configuration.md)

**Using it well:** [Agents](wiki/Agents.md) · [Skills](wiki/Skills.md) · [Model Routing](wiki/Model-Routing.md) · [Memory System](wiki/Memory-System.md) · [Project Planner](wiki/Project-Planner.md) · [Ideation](wiki/Ideation.md) · [GitHub Workflow](wiki/GitHub-Workflow.md) · [Delivery](wiki/Delivery.md) · [UI Studio](wiki/Website-Studio.md) · [UI Studio builder plan](wiki/UI-Studio-Builder-Plan.md) · [CLI](wiki/CLI.md)

**Trust and safety:** [Security](wiki/Security.md) · [Tool Execution](wiki/Tool-Execution.md)

**Under the hood:** [Architecture](docs/architecture.md) · [Development](docs/development.md) · [Chat reliability and capability broker plan](docs/chat-reliability-capability-broker-plan.md) · [Local CI and safe runners](docs/local-ci-and-safe-runners.md) · [Roadmap](docs/roadmap.md) · [Contributing](CONTRIBUTING.md)

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

