<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind</h1>

<p align="center"><sub> · <strong>Current source version: 0.235.1</strong> · </sub></p>

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

## What's new in 0.235.1

Since the last Marketplace publication, **v0.235.0**, source builds have added the following. Everything earlier is already in the published build — the full history is in [CHANGELOG.md](CHANGELOG.md).

- **The remaining Dependabot alert is resolved.** Stryker's development-only REST client pins vulnerable `qs@6.15.1`, so npm's normal audit fix cannot move it and upgrading the parent does not help. AtlasMind now forces patched `6.15.2` across the dependency tree; every other consumer already used or accepted that version, and production dependencies were already clean.

- **Personality Profile and Website Studio are one click from Chat.** Their account and globe icons now occupy visible slots in the native AtlasMind Chat title bar. Project Ideation and Cost Dashboard remain in the same title bar’s `…` menu, keeping the five-icon limit intact while putting the two requested managers at the top right.

- **"Installed but not signed in" now names the command that signs you in, and offers a terminal with it typed.** The message used to say to run the agent once in a terminal without naming anything — and the command on screen at that moment is the one that cannot log you in: `gemini --acp`, `copilot --acp` and `qwen --acp` all start a JSON-RPC server, and `claude-agent-acp` uses the Claude CLI's credentials. The sign-in command is recorded separately, read from each vendor's own documentation. **Open a terminal with the command** types it and stops; AtlasMind never presses Enter and never sees the credential. An agent with no documented flow is reported as such rather than handed a guess.

- **The ACP console-window choice is now on a Settings page, and the Settings search finds it.** Settings → Safety & Verification → *Delegated agents (ACP)* carries the Windows private-desktop checkbox with its endpoint-security disclosure and a button that reopens the guided comparison. Searching the panel for `acp: hide console windows` previously found nothing for two reasons: the control existed only in VS Code's own settings editor, and the search compared the whole query as a single substring against keyword lists written as separate words. Multi-word searches now match when every word appears.

- **Website Studio can be reached from the panels it links to.** Project Dashboard → Delivery and the Project Ideation board both offer it now. The Studio pointed at both and neither pointed back, leaving the command palette as the only way in.

- **Tool approvals fail visibly when their arguments cannot be represented.** A non-empty argument object that serializes as `{}` is now labelled **unserializable arguments**, while normal previews retain secret redaction and length limits. The project’s committed testing posture also swaps performance testing for charter-based exploratory testing and keeps the generated strategy and agent instruction blocks synchronized.

- **Project assessments now use the capacity you already have, and empty answers fail visibly.** Whole-project review prompts receive a high-reasoning profile instead of being mistaken for trivial chat. Adequate local or subscription-backed models are preferred over a metered provider that is merely a little faster. If every recovery attempt still produces no answer, Chat says that directly and offers **Retry** and **Provider status** chips instead of claiming it answered from context or asking you to type “Proceed.”

- **Ideation now has a dashboard home.** **Project Dashboard → Where we stand → Ideation** shows what is on the active board, what has not reached work, what is currently on the roadmap, and any unresolved contradiction. It reads the existing Gap Analysis, Security Review, Risk, Tech Debt, and Testing Coverage registers and offers each open record as an evidence card without launching a scan. The dashboard resolves the selected record again before opening the canvas; the canvas owns the write and leaves the new card unconnected until you decide what it supports. **Open canvas** works in both directions, and `/ideate` gives the same model-free board reading in chat.

- **Activated-testing repairs now show their work.** After confirmation, the Testing Dashboard keeps an indeterminate activity bar and a short stream of actual routing and approved-tool updates, then retains the task’s reported output or error. A completed task is not presented as green without test evidence. **Open result in Atlas Chat** creates a reviewable, redacted draft with the output fenced as reported data; it never sends a follow-up automatically.

- **A single button can work through the enabled testing posture.** **Fix activated testing** on the Testing Dashboard gives AtlasMind the current policy coverage and failed-report evidence, then asks it to inspect, repair, and re-run the existing relevant tests. You confirm before it starts and every tool call follows normal approvals. It will not manufacture green by disabling or weakening tests, skipping cases, lowering thresholds, altering runner setup, or treating an unavailable test environment as a pass.

- **Testing guidance now appears where you use it.** The Project Dashboard's Testing page shows the same plain-English protocol descriptions as Settings — what each approach is for, when to use it, familiar tools, and its trade-offs — from one shared catalogue rather than a second, shortened copy.

- **Scaffold Testing Framework can begin the first real test.** It still creates only missing starter files and never alters manifests. It now also synchronises the chosen testing guidance into existing AI-agent instruction files and, if the project already has Vitest or Jest plus a small exported source candidate, asks AtlasMind to author one focused code-specific test. That task follows the normal approval rules, inspects the source first, and makes no dependency or production-code change; if it cannot establish a stable behaviour, it makes no test change at all.

- **ACP subscription plans now follow your installed configuration, not a stale vendor table.** Configure Agent Plan lists every agent in `atlasmind.acp.agents`—including Gemini and custom ACP clients—and records the plan name you enter. ACP does not expose a trustworthy tier or remaining allowance, so AtlasMind no longer asks for, estimates, decrements, or routes on subscription credits. Copilot’s separate credit flow is unchanged.

- **ACP tool permission now stays set.** The Safety & Verification checkbox that lets ACP agents use their own tools is saved to your workspace and remains selected when you return to Settings.

- **The packaged extension now excludes mutation-test sandboxes and all test-only directories.** A local Stryker run can create thousands of temporary files; they remain local rather than inflating a VSIX built from the same workspace.

- **ACP no longer boots a coding-agent process tree for every answer.** The routed adapter keeps a successful session alive for up to 30 idle minutes and sends only the exact transcript suffix the remote session has not seen. Reuse is refused on a branch/edit, agent or cwd change, model/effort change, MCP or isolation change, launch-mode change, instruction/settings-file change, exit, or idle expiry. Identical concurrent calls share one in-flight prompt, and a 15-second result ledger absorbs transport-style retries — an uncertain prompt is never sent twice.

- **Windows console pop-ups are now an informed choice made before the first ACP probe.** Ordinary launching remains the compatibility-first default and may briefly show terminals created by an agent or MCP server. The new **ACP: Hide Console Windows** checkbox instead uses a bundled 120 KB native launcher to put the agent and its descendants on a dedicated private Windows desktop, preserving JSON-RPC stdio without a shell. Missing, modified, or blocked helpers fail visibly; AtlasMind never falls back behind your back.

  While this opt-in path has a routed session alive, the VS Code status bar says **ACP private desktop: _n_**. Click it to open Models & Providers. It provides visible, in-editor evidence of the selected launch mode without another native window, a focus change, or a suggestion that the desktop is a sandbox.

- **ACP setup uses plain language and its Settings link works.** The provider card now says that AtlasMind can use the Claude Code or Codex agent already installed and signed in on your computer; it does not need another AtlasMind API key. Its **Settings → Safety** link opens the switch that lets an agent act, one approval at a time.

- **The test baseline now includes property and mutation checks.** `fast-check` keeps a real property test in the normal Vitest suite, while `npm run test:mutation` runs the slower Stryker check over AtlasMind's criticality, tool-policy, and agent-registry decisions.

- **The EDR trade-off is part of setup, not buried in release notes.** Microsoft Defender exposes processes on hidden desktops because hVNC malware uses the same Windows primitive. AtlasMind does not switch to or remotely control the desktop, pins the helper by SHA-256, passes only stdin/stdout/stderr, and keeps the feature off until selected — but enterprise endpoint security may still flag or block it. The v0.230.0 helper PE is not Authenticode-signed; the hash pin proves AtlasMind received its expected bytes, not Windows publisher reputation.

- **The ideation board is a staged workspace now, not one long page.** Frame → Scaffold → Shape → Decide is a control: pick a stage and only that stage renders. The board still leads, and each stage reports where your board actually is rather than which tab you are reading. An empty board offers starter frames derived from what your project looks like — a game and a command-line tool no longer open the same blank canvas — and every seeded card is a question rather than an answer. The card-kind picker finally says what a kind commits to: choosing **problem** puts "Fix: …" on the roadmap and **risk** puts "Mitigate: …", which was true from the day the board shipped and written down only in the source.

- **Ideation can learn something you did not already type into it.** Seven research scans — competition, customers, technology, feature gaps, market, funding, regulation — ask questions about the world outside your repository and record what they find as evidence the board can use. Gap, security, risk, debt and testing are deliberately *not* among them: AtlasMind already answers those, and a second answer would eventually contradict the first.

  **Every finding carries a source, or it is not a finding.** A model asked about a market will answer, fluently and plausibly, and that answer filed into your project memory is indistinguishable from research six weeks later. An uncited claim is recorded as a *question to research* and never counted as evidence. With no way to search at all, a scan reports that it could not look — it does not report that it found nothing.

- **Scans become due; running one stays your decision.** Each scan has a cadence, and AtlasMind tells you when the world has had time to move. Six weeks away produces one due scan, not six. The research digest then answers three questions in order — what changed outside, what it means for what you are building, and what is *still* unassessed — deterministically, with no model writing any of it. See [the specification](docs/ideation-and-research.md).

- **An empty ideation board is a starting point now.** Eleven starter frames derived from your project's shape, so a game and a command-line tool do not open the same blank canvas, with every seeded card phrased as a question rather than an answer. Plus a readiness reading that says what the board cannot defend — unresolved contradictions first, then problems with nothing behind them, and cards that never reached the backlog. A record, never a gate.

- **Reconcile the testing policy with what is actually in the repository.** A testing matrix drifts one way: enabling a methodology takes a click, noticing months later that it never produced anything takes somebody deliberately looking. **Reconcile with the repository** on the Testing page compares the two and proposes a change for each disagreement - drop what was declared and never started, keep what has tooling underway, adopt what the project practises but never declared. Nothing is written until you approve the exact lines, and dropping is a first-class outcome: a declaration the project has outgrown is a stale statement, not work you failed to do.

- **Every write to the testing matrix now reaches the AI tools that read it.** Three places could change the matrix and only one of them synced. Turning a methodology off from the Project Dashboard left `CLAUDE.md`, `AGENTS.md` and `.github/copilot-instructions.md` still instructing every external agent to follow it - the config said one thing and the tools reading it said another, with nothing on screen to suggest they had diverged. All three go through one path now.

- **Auto-assess proposes rather than decides.** It used to arrive with every match pre-ticked, which is how a single click could enable thirteen methodologies - mutation, contract, model-based and end-to-end testing on a project with none of them - and leave eight permanent gaps that nobody read as gaps. Only methodologies the repository can already show evidence or tooling for arrive ticked. The rest are still offered, one keystroke away, labelled as what they are: an intention rather than a fact.

- **Testing is worth points, and an unevidenced policy costs them.** The project score had eight components and 127 points, and testing was not one of them — so a project with fourteen declared methodologies and evidence for none scored *better* than one that declared nothing, because neither carried a testing number and the first looked more organised everywhere else. There is now a **Testing evidence** component worth 15: ten for the share of enabled methodologies that have evidence, five for having a test report at all. A project with nothing declared scores zero and is told the points are unclaimed, not that it has failed — nobody has looked, which is different from looking and finding it broken.

  The recommendation says *close or retire*. A declaration the project has outgrown is a legitimate thing to withdraw; it is not a failure you must fix by writing tests for it.

- **A release now checks the standard the project set itself.** The release gates covered the changelog, the notes, the version, the tag, the tree, and CI — everything except whether the release meets the testing policy the project declared. A **Declared testing policy met** gate joins them: a failing test fails it, an enabled methodology with no evidence fails it, and coverage that was never gathered reports `unknown`. `unknown` is not a pass, because a published version can never be replaced and *"we did not check"* must stay distinguishable from *"we checked and it was fine"*.

- **A methodology can now hold work back, and only if you say so.** AtlasMind's one real enforcement — the gate that refuses non-test writes until a failing test has been seen — never read the testing matrix at all. It fired on the task's role and wording, so a project that had switched TDD *off* still got the gate, and the thirteen methodologies it had switched *on* got no gate whatsoever. The config governs it now.

  Blocking is **opt-in per methodology**, not a project-wide switch. Enabling a methodology is a statement of intent and should stay safe to make; turning one into a gate changes how every task in the project runs, and that is a decision worth taking one methodology at a time. You can declare fourteen methodologies as the standard you hold yourself to and block on only the one or two you are willing to stop work over. Where AtlasMind cannot read your config at all, the gate stays on: dropping a safety behaviour because a file would not parse is the wrong direction to fail in.

- **A testing config written by a newer AtlasMind is no longer treated as no config at all.** The reader hard-gated on `version === 1`, so a future file read as `undefined` — which every writer in the project takes as licence to persist a fresh default over the top. For a document whose entire content is *which methodologies are on*, that is a silent way to switch a project's testing policy off. It now goes through the same migration ladder as every other persisted document, which keeps *corrupt* (safe to replace) and *newer* (never safe to replace) apart. The two byte-identical copies of that reader, and the three hand-written copies of the file path, are down to one each.

- **A testing methodology you enable is now stated to the agent writing the code.** This is the fix for the failure that started all of this: a project could carry fourteen enabled methodologies, believe them in force, and have tests written for none of them. The policy was never wrong — it was never *shown* to anyone who could act on it. Testing policy reached a prompt through one channel, and that channel required the task to already be classified as testing, or the subtask's own text to already contain a testing word. So the turns implementing features — the only turns that could have written the tests — were exactly the ones told nothing.

  Every turn that could change behaviour now carries the **whole** enabled set, phrased as an obligation rather than a description: a change is not finished until it carries the evidence its policy names, and an agent that cannot produce that evidence must say so and say why. A project that has declared no policy is told nothing at all, because generic advice nobody asked for is how a prompt block becomes something agents learn to skim. Practices such as V-Model and Exploratory are named as context but never requested as files — asking for an artifact they cannot produce invites an invented one.

- **The Testing page can finally report a verdict, because a report now exists.** AtlasMind reads pass/fail from a report your project wrote and never runs your tests to find out — a deliberate boundary. But nothing in this repository ever wrote one, so on its own project the Testing page had shown *"No test report"* since the day it shipped. Every `vitest run` now writes `test-results/junit.xml`, and the pre-commit hook already runs the full suite, so the verdict on screen is never older than your last commit. It is gitignored: it is evidence of *your* run, not of whoever last pushed.

- **A green pipeline no longer reads as a gap.** The `continuous` testing policy had no file markers at all, so a project running its whole suite on every push capped at *"No tests yet"* permanently — a gap it had no way to close. Continuous testing leaves behind a pipeline definition and nothing else, so for this policy the configuration *is* the artifact. Only the pipeline file counts: a `npm run watch` for a bundler matches the same policy's script patterns, and a false *"Tested"* is the one reading this page must never produce.

- **Five test files that had never run once.** Three sat in `src/`, one in a `test/` directory the runner does not look at, and one used a `.spec.ts` suffix the glob does not match. They are now inside the suite — and two of them failed on arrival, having been written against behaviour the code no longer has. A test file that silently does not execute is worse than no test file, because its presence reads as coverage.

- **The Testing page stopped inventing its own denominator.** The badge said *"13 / 14 active"* while the table beneath it listed 23 rows, and both setup pickers offered *"the full list of 14 methodologies"* — the registry grew to 23 and four pieces of copy were never updated. Reading *13 / 14* you would conclude the project has nearly everything switched on, when it has just over half. The count is derived from the registry now, and a test refuses a literal.

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

Project Dashboard brings ideation, roadmap, issues, documents, delivery stages, privacy, risk, stakeholders, assignments, and follow-ups into one operational surface.

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
| `/acp` | Walk through ACP setup: name it, choose Windows console behaviour, install it, sign in, enable it, prove it answers |
| `/followups` | Group open follow-ups by urgency |
| `/ideate` | Read active-board state, what needs attention, and open the overview or canvas |
| `/research` | What research scans found outside this repository, what is due, and what has never been asked |
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
| `AtlasMind: Choose ACP Console Window Behaviour` | Choose ordinary Windows launching or the opt-in private desktop before ACP starts |
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
| `AtlasMind: Scaffold Testing Framework` | Create a stack-aware starter, sync existing AI instructions, and safely start one first-test task when the project is ready |
| `AtlasMind: Sync Testing Protocols to AI Agents` | Mirror enabled testing protocols into supported instruction files |
| `AtlasMind: Toggle Keep Computer Awake` | Opt into an AC-aware wake lock for long-running activity |
| `AtlasMind: Set Buzz Agent Key` | Store or remove the Buzz agent key in the OS secret store (empty value removes it) |
| `AtlasMind: Fetch My Buzz Channels` | Ask the Buzz CLI which channels your key can see, and tick the ones to watch. Writes nothing unless you confirm |
| `AtlasMind: Run a Research Scan` | Ask one research question about the world outside this repository. Confirms first, naming the scan, the source and the cost |
| `AtlasMind: Open the Research Register` | The findings, their sources, and the rule that graded each |
| `AtlasMind: Open the Research Digest` | What changed outside, what it means, and what is still unassessed |

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
| `acp.toolsEnabled` | `false` | **Let subscription agents act**: allow their own tools one approval at a time |
| `acp.hideConsoleWindows` | `false` | Windows only: keep ACP descendants on a private desktop so consoles cannot pop up or steal focus; may be flagged by EDR. Also a checkbox on Settings → Safety & Verification |

See the [Configuration Reference](docs/configuration.md) or [wiki Configuration](wiki/Configuration.md) for every setting, accepted value, security implication, and provider-specific option.

---

## Project Structure

The README keeps the map short; implementation details and data flows belong in the technical docs.

| Path | Responsibility |
|---|---|
| `src/core/` | Orchestration, routing, planning, safety and security registers, cost, and project services |
| `src/runtime/` | Built-in agents and runtime composition |
| `src/providers/` | Provider adapters, catalogs, health, and local-model discovery |
| `native/acp-private-desktop/` | Auditable Rust source for the optional Windows private-desktop launcher; the pinned release binary ships under `media/bin/` |
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
