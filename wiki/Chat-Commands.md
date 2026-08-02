---

## Composer Input & Search Toggle (v0.51.4)

- The chat panel composer uses a single input field for both chat and session search. Toggling the Search icon swaps the Send/Mode controls for a Search button. In search mode, Enter triggers a session search instead of sending a chat message.
# Chat Commands

AtlasMind registers the native VS Code chat participant under the id `atlasmind` and exposes it in chat as `@atlas`. Type `@atlas` followed by a slash command or a freeform question.

**Both chat surfaces accept the same commands.** The AtlasMind chat panel takes them without the `@atlas` prefix — just type `/acp`. It runs the *same* handlers the participant does rather than its own copies, so the two cannot answer `/agents` differently, and any button a command offers appears as a clickable chip. Two behaviours are worth knowing: a command that is not recognised is corrected rather than answered by a model (`/agent` names `/agents`), and a prompt that merely starts with a slash is still a question — `/usr/local/bin/thing is missing` is read as prose, because asking about a file by absolute path is not a failed command lookup. Before v0.209.1 the panel had no slash handling at all: every command reached a model as prose, which on an unconfigured machine meant the built-in echo adapter replying "Answered from context."

Short continuation prompts such as `Proceed`, `Continue`, or `Proceed autonomously` now reuse the latest substantive user request in the active session and escalate it into the same autonomous project execution flow as `/project`. When the VS Code Chat view includes attached references or earlier participant turns, AtlasMind also folds that native chat context into the orchestrator request before routing the model.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/bootstrap` | Initialize SSOT memory structure and optionally scaffold governance files |
| `/import` | Scan an existing project and populate memory with metadata |
| `/project` | Decompose a goal into subtasks, preview impact, and execute autonomously |
| `/loop` | Run an autonomous goal-seeking **Mission Loop** within a closed budget envelope; pauses for approval at configurable checkpoints |
| `/runs` | Open the Project Run Center to review recent autonomous runs |
| `/director` | Project Director status: stakeholders, team, responsibilities, assignments, and follow-ups (open/overdue) |
| `/buzz read` | Recent Buzz messages with authors resolved to their published names and emoji reactions aggregated. Session-scoped; never written to project memory. |
| `/buzz send <message>` | Post to your watched Buzz channel. Refuses to guess when more than one channel is configured. |
| `/buzz dm <name> <message>` | DM a Director contact using the Buzz key on their card. An ambiguous name is refused, not guessed. |
| `/buzz` | Guided Buzz setup, six required walkthrough steps: enable it → have a relay → store the connector identity key → subscribe → **prove a message actually arrives** → **put the Buzz people in the Director roster**. Each is reported as done / to do / blocked / optional from observed state. The guide now says explicitly that a Director Person/binding routes inbound work but is not a running Buzz managed agent; automatic replies are the separate optional **Run AtlasMind as a Buzz managed agent** step. **It never switches a Buzz gate on for you.** |
| `/setup` | Every setup guide with how far along it is, so a feature that needs configuring is discoverable *before* you hit the failure it causes. `/setup acp` or `/setup buzz` jumps straight into one. |
| `/acp` | Guided ACP setup, six steps: name an agent → **choose Windows console behaviour before the first probe** → install it → sign in → enable the provider → **prove a completion comes back**. Visible launching explains the possible terminal pop-ups; the private-desktop choice explains the hVNC/EDR trade-off and remains a Settings checkbox. Same mechanics as `/buzz`, with state derived from real configuration. Suggests Claude, Codex, Gemini, Copilot and Qwen with the exact command and install package derived from the same list the adapter spawns; Gemini also states that an assigned Code Assist Standard or Enterprise license is required before setup begins. **Nothing is installed or enabled for you, and dismissing the console picker stores nothing.** |
| `/followups` | List open follow-ups grouped by overdue / due soon / upcoming |
| `/ideate` | Read the active board's state and readiness observations, then open the Ideation overview or canvas. Read-only: it does not scan, invoke a model, or change the board. |
| `/research` | Open findings, what is due, what is blocked, and — always — what has never been assessed. Read-only: running a scan stays behind its own confirmation |
| `/ship` | Run the project's default publish/release routine. `/ship <id>` runs a named routine |
| `/sync-instructions` | Two-way sync AI instruction sets across tools and AtlasMind, resolving significant conflicts in chat |
| `/agents` | List and manage registered agents |
| `/skills` | List and manage registered skills |
| `/discover` | Discover external agentic resources (MCP servers, agents, skills, APIs) via [[Resource Discovery]] (ARD), with one-click install of the results |
| `/memory` | Query the SSOT memory system |
| `/cost` | Show session cost summary |
| `/voice` | Open the Voice Panel for text-to-speech and speech-to-text |
| `/vision` | Pick workspace images and ask a multimodal question |

---

## `/bootstrap`

Creates the SSOT memory folder structure and offers optional CI/CD governance scaffolding.

```
@atlas /bootstrap
```

**What happens:**
1. Creates `project_memory/` with all SSOT sub-folders
2. Prompts for project type → populates `project_soul.md`
3. Optionally scaffolds `.github/workflows/ci.yml`, PR template, issue templates, `CODEOWNERS`, `.vscode/extensions.json`
4. Non-destructive — never overwrites existing files

Choosing **Website / Marketing Site** also seeds the dedicated Website Studio at `project_memory/domain/website.json` plus a review-friendly `website.md` mirror. It carries the captured outcome, audience, constraints, timing, budget, metrics, and likely platform into the first draft. Existing website Studio files are never overwritten.

---

## `/import`

Scans the current workspace and auto-populates SSOT memory.

```
@atlas /import
```

**What it scans:**
- Manifests: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Gemfile`, `composer.json`
- README files
- Config: `tsconfig.json`, ESLint, Prettier, `.editorconfig`, `Dockerfile`, `docker-compose.yml`, `Makefile`, `.gitignore`
- License files

**What it creates:**
- `architecture/project-overview.md` — from README
- `architecture/dependencies.md` — from manifest
- `architecture/project-structure.md` — from directory listing
- `domain/conventions.md` — from config files
- `domain/license.md` — detected license type

**Detected project types:** VS Code Extension, API Server, Web App, Library, CLI Tool, Rust/Python/Go/Java/Ruby/PHP Project.

---

## `/project`

Decomposes a goal into subtasks and executes them autonomously.

```
@atlas /project Refactor the auth module to use JWT tokens
@atlas /project Add comprehensive unit tests for the API layer
@atlas /project Set up a CI/CD pipeline with Docker deployment
```

**Flow:**
1. LLM breaks the goal into a DAG of subtasks
2. Preview shows estimated file impact
3. If changes exceed the approval threshold (default: 12 files), you must approve
4. Subtasks execute in parallel batches with ephemeral agents
5. Final synthesis report streamed to chat
6. Run saved to Project Run History

If AtlasMind has already discussed a concrete implementation request, a short follow-up such as `Proceed autonomously` can be used instead of repeating the full `/project <goal>` prompt.

When a reply ends by **offering** an autonomous project run, interactive chat shows **Start run**, **Save for later**, and **Cancel**. Saving creates a reviewed preview in Project Run Center; starting reuses the exact goal `Proceed` would have run, and large runs still hit the file-count gate. Autopilot may start immediately when `atlasmind.autoStartProposedProjectRuns` is enabled; set it to `false` to require the card under Autopilot too. See [[Project Planner#starting-a-run-from-chat--proposal-decisions|proposal decisions]].

See [[Project Planner]] for full details.

---

## `/loop`

Runs an autonomous, goal-seeking **Mission Loop**. Where `/project` is a single pass (plan → execute → synthesize), `/loop` adds an outer loop: it plans the next increment, executes it, re-evaluates progress against the goal, and keeps going until the goal is met **or** a guardrail confines progress.

```
@atlas /loop Get the test suite to 90% coverage
@atlas /loop Migrate the settings panel to the new design system
```

**Flow:**
1. Preview shows the goal and the **closed parameter envelope** (max iterations, cost cap, token cap, time cap, no-progress stop) plus the checkpoint policy and an estimated cost range.
2. Re-run with `--approve` to start (an autonomous loop always requires approval to begin).
3. Each iteration: plan increment (grounded in SSOT memory + guardrails + the latest progress evaluation) → execute → a validated **goal evaluator** verdict (`achieved` / `progressing` / `stalled` / `blocked`) is streamed.
4. **Checkpoints** pause for a modal approval at the configured triggers (every N iterations, a budget-fraction crossing, or before write batches); declining stops the loop (deny-by-default).
5. The loop stops at the goal (verified, confident) or with a typed reason (`budget-exhausted`, `max-iterations`, `no-progress`, `time-exhausted`, `token-exhausted`, `blocked`, `cancelled`). A final report is streamed and the full run is saved to `project_memory/operations/missions.md`.

Discovery is prefer-existing and gated; deployments route through the guarded delivery pipeline, never run directly. Configure defaults under `atlasmind.loop.*` (see [[Configuration]]) or fine-tune per run in **Mission Control** (`AtlasMind: Open Mission Control`). See [[Project Planner]] for how the loop relates to the planner and scheduler.

In the **chat panel** you can also pick **New Loop** from the composer's send-mode dropdown (after *New Session*): it starts a **fresh session** (like *New Session*) and runs whatever you've typed as the mission goal — auto-approved on send — streaming the loop's iterations and verdicts into that new thread, isolated from your current conversation.

---

## `/runs`

Opens the Project Run Center to review, re-run, or inspect past autonomous runs.

```
@atlas /runs
```

---

## `/ship`

Runs a project routine — a saved sequence of shell commands (test, commit, push, deploy, etc.) defined in `project_memory/routines/`.

```
@atlas /ship                          # runs the default routine
@atlas /ship publish                  # runs the routine with id: publish
@atlas /ship publish fix: auth bug    # runs publish, sets ${message}
```

Routines are defined as markdown files with YAML frontmatter in `project_memory/routines/`. See `project_memory/routines/README.md` for the format and examples.

Each step streams a live checklist into chat. If a step fails and `on_fail: abort` is set, execution stops and the stderr output is shown. The run is recorded in Project Run History.

---

## `/sync-instructions`

Two-way sync of AI instruction sets. Where the **Settings → AI Instructions** "Scan & import" flow only pulls other tools' instructions *into* AtlasMind, `/sync-instructions` reconciles **every** detected tool's instructions (GitHub Copilot, Claude Code, Cursor, Cline, OpenAI Codex/AGENTS.md, Gemini CLI, Windsurf, Aider) **plus AtlasMind's own** into one unified set, then mirrors that set **back into each tool's file** so they all share the same guidance.

```
@atlas /sync-instructions            # start: gather, reconcile, surface conflicts
@atlas /sync-instructions choose 1 2 # override conflict #1 with option #2
@atlas /sync-instructions apply      # write the unified set back to every tool
@atlas /sync-instructions reset      # discard the in-progress sync
```

How it works:

1. **Gather + reconcile.** AtlasMind reads each tool's full instructions (ignoring its own previously-written managed block) and uses the model to build a unified, de-duplicated directive set. Trivial/compatible differences are merged automatically and reported as a count.
2. **Resolve conflicts in chat.** Only *genuinely contradictory* rules (e.g. tabs vs spaces) are surfaced as numbered conflicts with a recommended pick and one button per option. **Nothing is written until you resolve them** — click a recommendation, override with `choose <conflict #> <option #>`, then **Apply**.
3. **Mirror back.** The resolved set is re-expressed in each tool's native format and written into an AtlasMind-managed, delimited block (`<!-- atlasmind:shared-instructions:start … -->`) in each detected file — non-destructive and reversible; content outside the block is preserved. JSON-config tools (Continue) are reported as skipped. The unified set is also saved to `project_memory/domain/ai-instructions-sync.md` so AtlasMind loads it as context.

The **Settings → AI Instructions → "Align all instruction sets (two-way)"** button is a shortcut that opens chat and runs this command.

---

## `/agents`

Lists all registered agents with their roles and enabled status.

```
@atlas /agents
```

Output includes agent name, role, description, and whether the agent is currently enabled.

---

## `/skills`

Lists all registered skills (built-in + custom + MCP) with their enabled status.

```
@atlas /skills
```

---

## `/discover`

Searches every enabled [[Resource Discovery]] (ARD) Agent Finder for external agentic resources and prints a ranked table with one-click install buttons.

```
@atlas /discover book a flight
@atlas /discover query a Postgres database
@atlas /discover an MCP server for Jira
```

Agent Finders ship **disabled**; enable one in the Resource Discovery tab in Settings first (`AtlasMind: Resource Discovery`). The relevance score is a semantic match indicator — **not** a trust or safety rating. Installing an MCP server adds it disabled, behind the existing MCP trust gate. The related commands are `AtlasMind: Resource Discovery`, `AtlasMind: Discover Resources (ARD)`, and `AtlasMind: Export Resource Catalog (ai-catalog.json)`.

---

## `/memory`

Queries the SSOT memory system by keyword.

```
@atlas /memory authentication decisions
@atlas /memory project architecture
@atlas /memory deployment runbooks
```

Returns matching entries ranked by relevance (title, path, tag, and snippet matches).

---

## `/cost`

Shows the current session's cost summary.

```
@atlas /cost
```

Displays total cost in USD, total requests, and per-provider breakdown.

---

## `/voice`

Opens the Voice Panel for text-to-speech (TTS) and speech-to-text (STT).

```
@atlas /voice
```

---

## `/vision`

Opens an image picker for workspace images and submits a multimodal prompt.

```
@atlas /vision Describe what's in these screenshots
```

---

## Freeform Chat

Any message without a slash command is treated as a freeform request:

```
@atlas How is error handling done in this codebase?
@atlas Write a function to parse CSV files with proper error handling
@atlas Explain the model routing algorithm
```

**What happens behind the scenes:**
1. Orchestrator selects the most relevant agent
2. Memory manager fetches related SSOT entries
3. Task profiler infers phase, modality, and reasoning needs
4. Model router picks the best model (within budget/speed preferences)
5. Agent executes with available skills
6. Response streamed to chat with cost tracking

**Multimodal:** Freeform messages auto-detect image paths in the workspace and attach them to the prompt.

**Session context:** The last N turns (configurable, default: 6) are carried forward for conversational continuity.

---

## Extension Commands

These are also available from the Command Palette (`Ctrl+Shift+P`):

| Command | What it does |
|---------|-------------|
| `AtlasMind: Getting Started` | Opens the AtlasMind onboarding walkthrough |
| `AtlasMind: Open Settings` | Budget/speed sliders, approval policies, verification config |
| `AtlasMind: Open Chat Settings` | Opens the AtlasMind Settings workspace directly on the chat-focused page |
| `AtlasMind: Open Model Settings` | Opens the AtlasMind Settings workspace directly on the models page |
| `AtlasMind: Open Safety Settings` | Opens the AtlasMind Settings workspace directly on the safety page |
| `AtlasMind: Open Project Settings` | Opens the AtlasMind Settings workspace directly on the project-runs page |
| `AtlasMind: Focus Chat View` | Reveals the embedded Atlas chat workspace inside the AtlasMind sidebar container; active request status names the currently routed model |
| `AtlasMind: Open Chat Panel` | Opens a dedicated AtlasMind conversation panel outside the built-in VS Code Chat view. Active request status names the currently routed model. Shortcut: `Ctrl+Alt+I` (`Cmd+Alt+I` on macOS) |
| `AtlasMind: Lens: Refresh Active Outline` | Refreshes **Lens — Code Explorer** from the active editor's installed language service. It does not invoke a model |
| `AtlasMind: Lens: Filter Symbols` | Remembers whether Code Explorer shows all symbols or focuses on types, callables, data, or containers. Filtering invokes no model |
| `AtlasMind: Lens: Review Contract Wiring` | Scans a bounded set of supported TypeScript, OpenAPI, JSON Schema, and SQL declarations, asks for an ordered same-root pair, applies `.atlasmind/lens-mappings.json` plus explicit `.atlasmind/lens-data-trust.json` metadata, and opens Field Wiring with drift, schema-impact, SQL relationship, and Data Trust views. It imports/executes no project module, reads no data/secret values, and runs no SQL, database connection, or model |
| `AtlasMind: Lens: Review State Lifecycle` | Chooses a workspace and explicit `.atlasmind/lens-state.json` machine, then visualizes declared transition depth, unreachable states, terminal states, dead ends, events, guards, and effects. Optional source anchors offer exact Open/Ask actions. It imports/executes no project module and does not claim declared flow is observed runtime behaviour |
| `AtlasMind: Lens: Review Configuration Resolution` | Chooses an explicit `.atlasmind/lens-config.json` setting and shows its low-to-high default/file/environment/VS Code/flag/runtime precedence, winner, shadowed, and inactive sources. Masked settings cannot contain values; Ask targets never carry values, and the view reads no live environment, SecretStorage, remote flag service, or runtime memory |
| `AtlasMind: Lens: Review Branch Change Story` | Chooses a Git-reported base and turns the committed merge-base-to-HEAD history into a bounded commit/component/path story. Existing files offer exact Open/Ask; deleted paths stay visible without invalid navigation. Fixed read-only shell-free Git calls read no patch/remote PR/CI/runtime data, exclude named uncommitted work, and never replace the actual diff |
| `AtlasMind: Open a Setup Guide` | Starts a setup walkthrough — `acp`, `buzz`, or the `/setup` index — **always in a new chat session**, auto-submitted. Every surface that offers a guide routes through this one command, so a walkthrough can never land in an unrelated conversation and inherit its context. An unrecognised name falls back to `/setup` |
| `AtlasMind: Toggle Autopilot` | Enables or disables the session-wide tool approval bypass without reloading the extension |
| `AtlasMind: Set Buzz Agent Key` | Stores the Nostr secret key (`nsec…`) AtlasMind signs Buzz relay authentication with, in VS Code **SecretStorage**. Submitting an empty value removes it; cancelling leaves it untouched. Never written to settings or project memory. Falls back to an ambient `BUZZ_PRIVATE_KEY` when nothing is stored |
| `AtlasMind: Fetch My Buzz Channels` | Asks the Buzz CLI which channels your key can see and offers them as a ticklist, pre-ticked with what you already watch. The only Buzz control that writes a setting, and it writes only the channel list — never a gate, never a key — and only after you tick and confirm. Needs the CLI installed and an agent key stored. CLI output is treated as untrusted: ids are constrained to an identifier charset, names redacted and clamped, the list capped and de-duplicated. A watched channel the relay did not list is kept rather than dropped |
| `AtlasMind: Copy Buzz ACP Agent Setup` | Creates/refreshes the extension-managed `atlasmind-acp` launcher and copies a credential-free JSON recipe for Buzz **Provider → Custom command**. The recipe is locked to the selected workspace and includes the command, comma-separated arguments, and provider environment-variable names. It does not edit Buzz, create an identity, or export SecretStorage values |
| `AtlasMind: Run a Research Scan` | Runs one of the seven research scans — competition, customer, technology, feature gap, market, funding, regulatory. Confirms modally first, naming the scan, the source it will use and the fact that it reaches the network and spends model budget. **A scan with no usable source never reaches the model**: it records that it could not look rather than answering from what a model already believed. Findings land as open and need your triage; nothing is written to the roadmap |
| `AtlasMind: Open the Research Register` | Opens `project_memory/analysis/research.md` — the open findings with their sources, the declared rule that graded each, what has never been assessed, and the rule table itself. Uncited claims are listed separately as questions to research, never as evidence |
| `AtlasMind: Open the Research Digest` | Writes and opens `project_memory/analysis/research-digest.md`: what changed outside, what it means for what you are building, and what is still unassessed. Deterministic — no model writes any of it — and the third section always renders. The baseline it compares against is stored per developer, never in the tracked project memory |
| `AtlasMind: Toggle Keep Computer Awake` | Toggles `atlasmind.presence.keepAwake` — keep this computer awake (prevent system sleep) while an activity needs the agent online (Mission Loop / Remote Control gateway / Buzz presence). Deny-by-default, AC-power-gated, and auto-releasing |
| `AtlasMind: Manage Model Providers` | Add routed provider credentials, configure Azure/Bedrock/local providers, refresh models, health checks |
| `AtlasMind: Choose ACP Console Window Behaviour` | Windows only: explicitly choose ordinary ACP launching (possible brief terminal pop-ups, best compatibility) or the opt-in private desktop (no focus-stealing consoles, possible Defender/EDR scrutiny). The same value is the `atlasmind.acp.hideConsoleWindows` checkbox, on Settings → Safety & Verification as well as in VS Code's settings editor |
| `AtlasMind: Dismiss Provider Notifications` | Clears the Models view auto-paused badge for the current session without re-enabling paused providers |
| `AtlasMind: Specialist Integrations` | Store search, voice, image, and video provider credentials on dedicated non-routing surfaces |
| `AtlasMind: Manage Agents` | Create and configure custom agents in the page-based agent workspace |
| `AtlasMind: Tool Webhooks` | Configure webhook delivery, authentication, and recent delivery history in the page-based webhook workspace |
| `AtlasMind: Scaffold Testing Framework` | Construct a stack-aware starter framework (config, example tests, strategy playbook) for the enabled testing methodologies |
| `AtlasMind: Sync Testing Protocols to AI Agents` | Mirror the enabled testing protocols into detected external agent instruction files (`CLAUDE.md`, `copilot-instructions.md`, `AGENTS.md`, etc.) |
| `AtlasMind: Compare Models on a Prompt` | Run one prompt across your configured models (grouped by provider, with Select All and ready-made sample prompts) and view a sortable comparison. An optional LLM **judge** scores each answer 0–100; click any column header to sort. Graded outcomes calibrate outcome-driven routing. Open it from the Models view titlebar (beaker icon) or the Settings overview. |
| `AtlasMind: Open Project Dashboard` | Opens the interactive command center for repo health, runtime state, SSOT coverage, security posture, and delivery or PR-readiness signals |
| `AtlasMind: Open Project Director` | Opens the Project Dashboard on the Director tab — stakeholders, team, responsibilities, assignments, and follow-ups |
| `AtlasMind: Open Website Studio` | Opens six website dashboards for client intake, sitemap, wireframes and visual design, UI system, platform readiness, and n8n workflow mapping |
| `AtlasMind: Open Project Run Center` | Review, approve, pause, resume autonomous runs |
| `AtlasMind: Open Mission Control` | Define, launch, watch, checkpoint, and audit autonomous Mission Loop (`/loop`) runs |
| `AtlasMind: Manage MCP Servers` | Connect external tool servers |
| `AtlasMind: Update Project Memory` | Re-runs the workspace import pipeline to refresh stale imported SSOT entries from the latest codebase state |
| `AtlasMind: Open Voice Panel` | TTS and STT |
| `AtlasMind: Open Vision Panel` | Image-based multimodal prompts |
| `AtlasMind: Bootstrap Project` | Same as `/bootstrap` |
| `AtlasMind: Import Existing Project` | Same as `/import` |
| `AtlasMind: Show Cost Summary` | Same as `/cost` |
| `AtlasMind: Open Cost Dashboard` | Full cost management dashboard with a collapsible time-period picker, subscription-aware totals, budget utilisation, recent requests, and per-local-model cloud-equivalent savings estimates |
| `AtlasMind: Enable Remote Control` | (desktop) Start the localhost server so the web build can drive this instance — prompts for workspace trust and shows the pairing code |
| `AtlasMind: Enable Remote Control (Gateway)` | (desktop) Switch to `gateway` mode and start the server behind an SSO-gated Cloudflare Worker + tunnel for cross-machine access; shows the origin secret and local tunnel target |
| `AtlasMind: Disable Remote Control` | (desktop) Stop the remote-control server and drop all sessions |
| `AtlasMind: Show Remote Pairing Code` | (desktop) Re-display the pairing URL and token |
| `AtlasMind: Revoke Remote Access` | (desktop) Rotate the pairing token and disconnect all clients |
| `AtlasMind: Connect to Desktop Instance` | (web) Pair the web build with a desktop instance |
| `AtlasMind: Disconnect from Desktop Instance` | (web) Disconnect the web client |
| `AtlasMind: Open Remote Dashboard` | (web) Read-only cost and project-run dashboard |

See [[Remote Control]] for details.

## Sidebar Actions

These remain available inside their owning views and do not appear in the Command Palette:

| Action | Where it appears | What it does |
|---------|------------------|-------------|
| `Open Lens Target` | Selecting a Lens file or symbol | Opens the target's validated workspace URI and exact source range |
| `Ask Atlas About This` | Lens file or symbol inline action | Opens an editable chat draft with a one-shot, source-backed target context. It never auto-submits and carries no source text or absolute path |
| `More Target Actions…` | Lens file or symbol context menu | Offers Explain as an editable draft. Symbols also offer **Trace possible flow**, a bounded **Show impact** map, and a conservative **Find tests** evidence map from call-hierarchy/reference evidence, all with exact source and Ask Atlas actions; file-level impact/test actions remain drafts until file/diff adapters land. Drafts never auto-submit |
| `Show Agent Details` | Agents row inline action | Opens the selected agent's details panel |
| `Toggle Agent Enabled` | Agents row inline action | Enables or disables the selected agent |
| `Add Skill` | Skills view title bar or folder row | Starts a new custom skill inside the selected folder context |
| `Create Skill Folder` | Skills view title bar or folder row | Creates a persistent custom folder for nested skill grouping |
| `Configure Scanner Rules` | Skills view title bar | Opens the skill security scanning rules |
| `Scan Skill` | Skills row inline action | Runs a security scan for the selected skill |
| `Toggle Skill Enabled` | Skills row inline action | Enables or disables the selected skill |
| `Show Scan Details` | Skills row context action | Opens the latest scan details for the selected skill |
| `Toggle Model Enabled` | Models row inline action | Enables or disables a provider or individual model |
| `Hide from Models Sidebar` | Provider, subscription route, or model row eye-closed action | Hides only that row from the current VS Code user profile. It does not disable or remove anything; restore entries individually under Settings → Models & Integrations → Sidebar visibility |
| `Open Model Info` | Models row inline action | Opens the provider's model documentation |
| `Configure Model Provider` | Provider row action | Prompts for provider credentials or opens local model configuration |
| `Refresh Available Models` | Configured provider row action **and the Models view title bar** | Refreshes the routed provider catalog after credential or upstream changes. It always refreshed every provider, whichever row it was invoked from, so the title bar is its honest home. |
| `Configure Subscription Plan` | Subscription provider row inline action | Sets the plan tier and monthly allowance for a subscription-backed provider (ACP, Copilot). Registered since the subscription tracking shipped, but declared in no manifest entry and attached to no menu — working and unreachable until v0.212.0. A plan is keyed **per provider**, so it sits on the provider row rather than on the per-vendor ACP rows beneath it, where it would imply a per-agent plan that does not exist. |
| `Assign To Agents` | Model row inline action | Assigns a provider's models or an individual model to selected agents |
| Rename | Sessions row or session-folder row inline action and F2 | Renames the selected chat thread or session folder |
| `Create Session Folder` | Sessions view title bar | Creates a persistent folder for filing related chat threads |
| `Move Session To Folder` | Sessions row context action | Files the selected chat thread into an existing folder, a new folder, or back to the top level |
| `Archive Session` | Sessions row context action | Moves the selected chat thread out of the active Sessions list |
| `Restore Session` | Archived Sessions row context action | Returns the selected archived thread to the active Sessions list |
| `Edit Memory File` | Memory row inline action | Opens the selected SSOT entry in the editor |
| `Review Memory File` | Memory row inline action | Shows a natural-language review of the selected SSOT entry and can jump into the file |

---

## Follow-up Suggestions

After each command, AtlasMind suggests relevant next steps:

| After | Suggested follow-ups |
|-------|---------------------|
| `/bootstrap` | View agents, View skills, Query memory, Start a project |
| `/import` | View imported overview, View dependencies, View agents, Start a project |
| `/project` | Review cost, Save plan to memory, Run another project |
| `/agents` | View skills, Run a project, How to add an agent |
| `/skills` | View agents, How to add a skill, Run a project |
| Freeform | Turn into a project |
