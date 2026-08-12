# Architecture

**How AtlasMind is put together, in plain terms.**

This page is the overview. If you're contributing code and need the full service-by-service map, the
developer reference is [`docs/architecture.md`](../docs/architecture.md), and
[[Contributing]] covers setup and conventions.

---

## What it is

AtlasMind is a VS Code extension written in TypeScript. It also ships a **command-line tool** and an
**agent endpoint** that lets other tools drive it.

All three share the same core, so orchestration, model routing, tools, memory and safety behave
identically whichever way you reach them. There's one implementation of "how AtlasMind decides things",
not three.

---

## What happens when you ask a question

```
Your message
  ↓
Pick the right agent          Who's best placed to answer this?
  ↓
Gather context                Relevant project memory, plus live file reads where exactness matters
  ↓
Strip credentials             Anything secret-shaped is removed before it can leave
  ↓
Profile the task              How hard is this, what kind of work, what capabilities are needed
  ↓
Pick the right model          Within your budget and speed preferences
  ↓
Resolve the tools             Only what this task needs, within what you allowed this turn
  ↓
Run it                        Approval gate → snapshot → tool → verification
  ↓
Account for it                Tokens and cost recorded
  ↓
Your answer
```

Two details in there matter more than they look:

**Credentials are stripped before dispatch, not after.** The redaction step sits between gathering
context and sending it.

**A snapshot is taken before every write.** That's what makes a failed step recoverable.

---

## What happens during a project run

```
/project <goal>
  ↓
Plan                  A reasoning model breaks the goal into steps and works out the order
  ↓
Check the tools       A reasoning-only planner can't leave a step unable to do its job
  ↓
Preview + approval    You see the whole thing before anything happens
  ↓
Execute in batches    Independent steps run in parallel, each with a temporary specialist
  ↓
Summarise             One report across every step
  ↓
Save                  Persisted to the Run Center
```

Short follow-ups like *"proceed autonomously"* re-use your last substantial request and go down the same
path — you don't have to retype it.

---

## The main parts

### Deciding and running

| Part | What it does |
|---|---|
| **Orchestrator** | The centre of everything. Routes a task: agent → memory → model → tools → execution → cost |
| **Agent Registry** | Who the specialists are, which are enabled, and how they've performed |
| **Skills Registry** | What tools exist and which an agent may use |
| **Model Router** | Picks a model by budget, speed, capability, health and past outcomes |
| **Task Profiler** | Works out how hard a task really is |
| **Project Vocabulary** | The delivery stages and branches *your project declared*, so "promote to staging" means what you said it means |
| **Planner & Task Scheduler** | Breaks a goal into steps and runs them in dependency order |
| **Mission Runner** | The autonomous loop, and the envelope that contains it |
| **Cost Tracker** | What everything cost, per session and per model |

### Remembering

| Part | What it does |
|---|---|
| **Memory Manager** | Reads, writes and searches your project memory |
| **Memory Scanner** | The gate that decides what may be written |
| **Checkpoint Manager** | Snapshots before writes, so a failure is recoverable |
| **Project Run History** | Every autonomous run, kept per workspace |

### Reaching outside

| Part | What it does |
|---|---|
| **Provider adapters** | One per model provider, behind a shared contract |
| **ACP adapter** | Drives a subscription coding agent as a model provider |
| **MCP registry** | Connects external tool servers and dispatches their tools |
| **Resource discovery** | Finds new servers, agents and skills |
| **Voice** | Speech in and out — cloud, your OS, or fully on-device |

### Reading your code — Lens

**Lens** is eleven views that explain your codebase from what's actually declared in it: possible flow,
change impact, test evidence, state lifecycle, configuration resolution, change story, field wiring,
three live-service lenses, and a dashboard that ties them together.

They share one model and one visual language, which matters for a reason worth stating: **absent input
means *not assessed*, never *empty*.** A lens whose evidence was never inspected says so and raises its
own item, rather than contributing to a page that looks clear because nobody looked. Every verdict names
the declared rule that produced it, and the rule table is printed on the page so you can check the
grading.

The dashboard is read-only by construction — it runs no model, writes no file and scans no workspace.
Its webview sends only a bounded id, and the host resolves that against a catalogue it holds itself, so
no surface can trigger a command the dashboard didn't already offer.

Ten of those eleven read only what's already on your machine. **Three do not**, and they are separated
from the rest by evidence source for exactly that reason — a lens that can reach production should never
sit one row down from one that reads a file, unlabelled. **Live Contract Drift** compares the schema your
repository declares against the one a running API or database actually serves; a field the code declares
and the service doesn't serve is a dead end and a schema failure at once, and it's kept distinct from a
field the service serves that nobody declared, because those need opposite fixes. **Service Reachability**
asks which declared services answered at all. **Live Data Trust** lists the fields a service actually
serves that no classification covers — unknown sensitivity on real data, which the static Data Trust view
can't see because the field was never in a file.

They connect to Postgres and MySQL directly (Neon, Supabase, RDS, Railway, self-hosted), to vendors that expose SQL over HTTPS, or through an MCP server you already approved. The connection string lives in the OS keychain; the committed file only names the key. They read **shape only** and never a row — row counts are planner estimates the database already maintains, not a `COUNT(*)` — they're off by default, production is excluded from the default
allowed stages, and an endpoint that doesn't state its environment is treated as production. Which
services may be reached is a committed file that names a stored secret rather than holding one, and it's
the one declaration kind Atlas refuses to draft. The full boundary is in
[Security](Security.md#lenses-that-reach-a-live-service).

Several of those views read a declaration file you write yourself, and the **declaration guide** is what
tells you how. It derives its walkthrough from the five files on disk — no model, no configuration — so
it reads the same on a fresh install, and it counts only the two files that actually gate a lens, so a
project that has declared its state machines and its configuration precedence reads as finished rather
than as permanently half-done. An optional file that is *broken* is still reported as broken; "optional"
describes absence, not errors.

The guide's **Ask Atlas** drafter is the one place in Lens where a model runs, and it is a proposal path
rather than a write path. A draft is put through the same normalizer the lens itself reads the file with
and **refused whole if it fails**, because repairing it would mean AtlasMind inventing your project's
topology in a shape that then looks derived from it. Every file path the draft claims is **verified
against the workspace and dropped if it doesn't resolve** — a plausible-but-wrong path renders, draws and
leads nowhere. Any value matching a known credential shape is **withheld from the file entirely** rather
than masked at render time, since these files get committed and masking on screen would still put the
secret in the repository. Nothing is written until you've seen the whole draft with every correction
listed, and entries you wrote yourself win every collision.

### The panels

Chat, Settings, Project Dashboard, Project Ideation, Mission Control, Project Run Center, Cost
Dashboard, Model Providers, Agent Manager, UI Studio, Personality Profile, and the Lens surfaces —
plus the sidebar trees for Chat, Lens, Director, Project State, Sessions, Runs, Memory, Models, Agents,
Skills, MCP Servers and Resource Discovery.

UI Studio retains the original `atlasmind.openWebsiteStudio` command id and
`project_memory/domain/website.json` path for compatibility, but format v6 adds a revisioned,
target-independent `UiDesignGraph` behind the explicit interface profile. Website, web-app, mobile,
desktop, editor-extension, embedded and other profiles share screens,
flows, content design, Markdown copy, wireframes, design-system decisions and an implementation guide.
Only a website profile renders SEO, stack setup, hosting, Delivery comparison and n8n. Content writes
carry no path: the host resolves a bounded screen id through `WebsiteContentManager`, derives the file,
and refuses a save when its expected body no longer matches disk. Missing files are create-only and
placeholder-only.

`uiDesignGraph.ts` is the graph's untrusted-input boundary and derives the legacy page wireframe while
existing readers migrate; a valid graph is the declared winner. `uiEditCommands.ts` is the pure closed
mutation path for canvas, form, future preview, and model-proposed edits. Drawing, frame/reparent, deletion,
kind, label, intent, visibility, viewport geometry/visibility override set/reset, undo, and redo commands
name the revision they read and pass an exact parser; the webview never submits a graph patch. Invalid
targets refuse, and bounded undo/redo never rewinds revision. Responsive resolution applies desktop →
tablet → mobile inheritance and reports the source breakpoint for every computed property; clearing an
override restores that inherited value. A migrated tablet/mobile base changes at a wider viewport only
through an exact override, so the resolver does not turn absent intent into a design decision.
The 5 → 6 migration preserves every prior wireframe fact and the untouched-versus-empty distinction while
inventing no responsive, token, component, or source-mapping intent.

The Studio webview does not reproduce responsive inheritance. `websiteStudioPanel.ts` resolves every node
at all three breakpoints on the extension host and sends bounded layout/provenance plus flags for the two
override properties. The canvas can select hidden nodes and submit exact geometry/visibility set or reset
requests. Reset names `rect` or `hidden`, so the reducer preserves the other property and removes an empty
breakpoint record. Every result returns a fresh host projection. Drag, resize, and keyboard nudge at a
non-base breakpoint project the resolved rectangle optimistically, then submit it through the same exact
override command. Drawing, deletion, nesting, and parent changes remain confined to the base breakpoint.
Multi-selection alignment, distribution, and group nudge use one `set-node-frames` command containing only
bounded unique node ids and rectangles. The reducer validates the whole batch first, then advances one
revision and undo entry; multi-delete remains refused rather than inheriting new cascade semantics.

Full Preview is the shared design feedback loop. `websiteWireframePreview.ts` deterministically combines
wireframe geometry, sanitized colour/type tokens, and escaped Markdown content. The pure renderer remains
script-free and now emits static tablet/mobile media rules by resolving the matching authoritative graph
screen, including inherited geometry, explicit visibility, and a visible-content-derived canvas height.
Graph identities used by selectors are escaped and a screen that does not own the page is ignored.
`websitePreviewHost.ts` injects the frozen `uiPreviewRuntime.ts` listener only into the
deterministic `_wireframe/` drafts. One tokenized `127.0.0.1` server exposes exactly that runtime, a
revision/selection event stream capped at eight clients, and one 512-byte selection POST accepting only the
current revision plus bounded screen/node IDs. VS Code's built-in Simple Browser reloads after a newer
successful render and shares selection with Studio after the host resolves the IDs against the saved graph;
the sandboxed desktop/tablet/mobile lab stays scriptless and is refreshed host-side.
Generated visual guides remain uninjected at separate paths and are linked from the draft index rather than
taking over its entry point.

The Project Dashboard's Delivery panel presents two related but deliberately separate views. The stage
pipeline says **where versions move** and owns guarded promotion. The detected shipping guide says **what
this project asks a newcomer to do**: prerequisites, validation, packaging, deployment and publishing,
derived from bounded local manifests, scripts, routines, workflows and the stage model. Exact repository
configuration, runtime conventions, human checks and missing blockers remain visibly different.

Versioning is now explicit in both readings. A production path that requires a bump adds **Prepare
release version** to the Detected Runbook and displays the repository's exact preparation script when it
has one. The promotion resolver applies that same contract atomically across the manifest, npm root
lockfile version, formal changelog, recognised README version markers, and an existing wiki changelog,
then commits only those files. Hook logs are sanitized, secret-redacted and tail-capped before entering
the webview, while Git's capture buffer remains bounded but large enough for the full quality hook.

The Pipeline panel has a third, deliberately separate reading: `ciManager.ts` explains how CI itself
is defined, assigned and enforced. Existing GitHub Actions files are reduced to safe metadata—triggers,
branch scopes, jobs, runners, counts, timeouts, permission/concurrency flags and validation categories;
raw YAML, commands, inputs and environment values never enter the browser snapshot. A starter workflow
is a closed create-only template derived host-side from declared branches and package scripts. The
browser sends no YAML or command, the exact plan is confirmed, and `wx` prevents replacement even if a
file appears between review and write.

The Branches panel follows the same host-authority boundary for daily Git work. An expanded card groups
**Work** separately from **Review**, but a work button sends only the card's opaque inventory id and a
closed action name. The host rebuilds live branch, working-tree, tracking, remote and commit state before
it can switch, prepare a commit, fast-forward pull, non-force push or publish, create a branch at the
selected commit, or open GitHub's pull-request form. The compact surface never performs an automatic
commit, selects merge versus rebase, force-pushes, or bypasses remote branch protection. The owner and
toolbar share one flexible column; daily actions render as fixed-size icons whose native tooltip and
accessible label retain the complete action and safety description at narrow widths.

Branch presentation state is split deliberately: the webview copy makes re-renders immediate, while a
host-validated workspace-state copy restores saved view, sort, direction, grouping, and SCM colours after
the panel is closed and recreated. Folded local/upstream cards derive activity from the newer of their two
visible commits; recency sorting therefore describes the logical branch rather than always describing its
local ref.

Human ownership also follows one contract across the dashboard. Branches, active roadmap items, open
issues and pull requests, unresolved gaps, risks and debt, and documents needing attention all render
the Director's contact picker beside the work; Director → Assignments changes the same records. The
browser submits only a short-lived target token. The host resolves that token from the latest snapshot,
validates the contact, and stores a closed work-kind/id link in the Project Director assignment source
of truth. Branch tokens are checked once more against fresh Git state before saving, so a stale card
cannot assign a renamed or replaced ref.

Project State is the personal ToDo projection of that contract. Active assignments owned by the
Director contact marked as **me** appear one per row under **Waiting on you**, carrying status, priority,
and a link to the work's owning page; due and overdue follow-ups appear individually too. Completed,
cancelled, and colleague-owned assignments are omitted. Project Director's own **Follow-ups** group uses
the same source: those due reminders plus the active assignments owned by **me**.
VS Code treats a native tree view's `badge` as container activity and hides a view's description when
the panel collapses, so AtlasMind projects the same count through the three public channels that own
these locations: `TreeView.badge` on the AtlasMind activity-bar icon, a dynamic
**Project State · N waiting** title that remains visible when closed, and a coloured file-decoration
badge on **Waiting on you**. Project Director repeats those three channels with a dynamic
**Project Director · N follow-ups** title and a coloured Follow-ups row badge. Dashboard owner saves
refresh both trees immediately, and external Project Director file changes follow the same path.

Tree commands use a guarded `ProjectDashboardOpenTarget`: a validated page plus an optional allowlisted
work kind and bounded stable id. Matching focus markers live on branch, roadmap, issue, pull-request,
gap, risk, debt, document, assignment, and follow-up records. The dashboard clears any presentation
filter hiding that record, scrolls and focuses it, and draws a temporary focus outline. A removed or
not-yet-loaded record safely degrades to its owning page.

Detected commands can be copied, typed into a terminal, or run a column at a time, and `deliveryRunPlan.ts`
decides what a terminal is asked to do before anything is sent. The webview posts an opaque step or phase
id and the host rebuilds the guide to resolve the command, so the page can name a step but never supply
one. Send-to-terminal withholds the newline, leaving your keystroke as the last gate on a single command;
a column run confirms every command in order, marks the ones that leave the machine, and states whether
the shell can stop on failure. Guarded promotion is untouched and remains the only path that executes
commands from a reviewed `delivery.json`.

Runbook phases render as collapsed disclosures whose numbered marker reflects the strongest step state.
A non-green step can be handed to Chat through its AtlasMind-logo action, but the browser posts only the
step id: the host rebuilds the guide, refuses a now-green or missing id, and composes the bounded repair
draft from the current record. The same icon-only action is shared by Dashboard, Lens, MCP, Website
Studio, and Project Run surfaces. Its visible label is the logo; a precise `title` and `aria-label`
preserve the action's meaning for hover, keyboard and assistive-technology users.

On the Workflow page, the **Your workflow file** card makes each stage's enablement visible without
tinting its contents: the segment outline and standard **Enabled** status tag carry the colour, while
the larger marker stays neutral. The words **Enabled** / **Disabled** and `aria-pressed` preserve the
same distinction without colour.

**They share one design language.** Each webview is an isolated document, so a panel cannot inherit
another's stylesheet — which is how nineteen panels ended up with nineteen palettes, four of them drifted
copies of the Project Dashboard's. `src/views/dashboardTheme.ts` is now the single definition, and the
shared shell wraps every panel in it: tokens and the page frame *before* the panel's own CSS, and the
surfaces — card, header, nav, button, input, table — *after*. The ordering is the design. A panel keeps
its layout, which it legitimately owns, and loses its private palette, which it never decided on. The
Personality Profile is the one deliberate exception; its warm palette is a choice, not drift.

---

## Some structural rules

These are worth knowing because they explain a lot of AtlasMind's behaviour.

**Selection is not authorisation.** Choosing which tools to offer a model happens *after* eligibility and
*after* your turn's limits, so it can only ever narrow. Approval classification and the execution-time
check still run for every single call.

**A panel supplies data, never a command.** The dashboard can trigger a promotion and attest a check, but
it can never supply the command string that runs. What executes comes from your saved configuration, read
on the extension side. This is why a tampered panel message can't do much.

**Policy is shown, not summarised.** The Settings → Agents page renders the actual immutable guardrail
constant from the runtime, rather than a copy in the panel that could drift from what really happens.

**Registries own their thing.** The agent registry owns agent definitions, the skills registry owns tools,
the orchestrator owns execution. That separation is what lets the number of agents grow without agent
management, execution and logging collapsing into one service.

---

## Other tools driving AtlasMind

AtlasMind can be the agent rather than the client. A local tool can drive it over a standard protocol,
and it keeps agent selection, memory, model routing, tool resolution, approvals and execution on its own
side.

That endpoint opens **no network port**. Sessions are bound to a workspace and bounded. Commands the
client declares are **never launched**. Only one loop runs at a time. Safe reads follow the headless
default; anything risky asks the calling client for a **one-turn** decision — and a permanent grant is
never accepted.

---

## Where the code lives

| Path | What's in it |
|---|---|
| `src/core/` | Orchestration, routing, planning, safety, cost, project services |
| `src/runtime/` | The built-in agents and how the runtime is composed |
| `src/providers/` | Provider adapters, catalogues, health, local model discovery |
| `src/skills/` | Built-in tools and skill handlers |
| `src/memory/` | Memory retrieval, scanning, redaction, persistence |
| `src/chat/` | The chat participant and interaction protocol |
| `src/views/` | Settings, dashboards, editors and sidebar surfaces |
| `src/mcp/` and `src/ard/` | MCP connectivity and resource discovery |
| `src/voice/` and `src/remote/` | Voice backends and remote control |
| `src/cli/` | The command-line tool and the agent endpoint |
| `src/acp/` | Agent-side sessions and permission brokering |
| `tests/` | Unit, integration, webview, security and regression coverage |

Shared types live in one place, and provider adapters implement one shared contract. Type definitions are
never duplicated across files.

---

## Related

- [`docs/architecture.md`](../docs/architecture.md) — the full service map, for contributors
- [[Contributing]] — dev setup, conventions, and how to add things
- [[Model Routing]] — how a model gets chosen
- [[Memory System]] — how memory works
- [[Tool Execution]] — the approval pipeline
- [[Security]] — the boundaries
- [[CLI]] — the terminal host
