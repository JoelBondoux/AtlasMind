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

Repository checks also have one declared boundary with three execution locations. The quick and complete
local npm gates need no GitHub capacity. A separate workflow may send only the repository owner's
`develop` push or exact-ref manual dispatch to an isolated Linux runner. The provider-hosted
Linux/Windows/macOS matrix is
reserved for pull requests into protected `main`, where it supplies release evidence. The trusted runner
never substitutes its one operating system for those three required release checks and never accepts a
public pull-request event.

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
| **Local GPU arbiter** | Decides which local model requests may run, so several at once cannot over-fill one graphics card |

**About that last one.** If you run local models, AtlasMind can ask for several at once from places
that don't know about each other — the subtask scheduler, project bootstrap, background maintenance.
Ollama and LM Studio each decide what fits without knowing the other exists, and neither leaves
anything for your desktop; on a 24 GB card with no model loaded at all, Windows and a browser were
already using 9.2 GB.

The arbiter measures what's actually free, charges a model's weights once however many requests share
it, loads one new model at a time, and moves a turn to another provider rather than over-filling the
card. Two rules keep it honest: it **only unloads models it loaded itself** — and only when idle, out of
cooldown, and when releasing it would actually free enough — so a model you loaded by hand is never
taken away from you; and a request refused for lack of room is recorded as *the GPU was
busy*, never as *the model failed* — otherwise a working model would be marked unreliable for being
popular.

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
`project_memory/domain/website.json` path for compatibility. Format v6 added a revisioned,
target-independent `UiDesignGraph` behind the explicit interface profile. Website, web-app, mobile,
desktop, editor-extension, embedded and other profiles share screens,
flows, content design, Markdown copy, wireframes, design-system decisions and an implementation guide.
Only a website profile renders SEO, stack setup, hosting, Delivery comparison and n8n. Content writes
carry no path: the host resolves a bounded screen id through `WebsiteContentManager`, derives the file,
and refuses a save when its expected body no longer matches disk. Missing files are create-only and
placeholder-only.

Format v7 adds bounded typed colour, typography, spacing, radius, shadow, motion, and breakpoint tokens to
that graph. Definitions remain target-independent structured values. Aliases may only resolve through the
same kind to a direct value; the host refuses missing targets, cross-kind links, cycles, invalid values,
duplicates, and excess definitions. The v6 → v7 migration adds an empty collection and never invents a
design system.

Format v8 adds reusable component definitions and explicit node instances to that same revision boundary.
Definitions declare a closed root kind, typed properties, variants, bounded slots, and supported states; they
contain no markup, CSS, source path, or executable value. Instance resolution applies defaults, then variant
values, then bounded overrides and retains the source of each property. The v7 → v8 migration adds an empty
collection and invents no component or instance.

Format v9 adds optional node-owned empty/loading/error/success presentations with bounded title, body, action
label, and visible maturity. One declared state may be selected for design review. These facts complement the
screen Markdown file and remain separate from component interaction appearance. The 8 → 9 migration changes
only the version and invents no copy; approved copy containing an unresolved placeholder is refused/downgraded.

Format v10 adds bounded preview-only content collections and explicit node bindings for title, body, and action
slots. Field schemas and sample records are target-independent graph facts, never production data or connector
configuration. Safe editor commands refuse removing a collection, record, or field used by a node; sanitation
retains well-shaped stale references so owning-node diagnostics can report missing collections, records, fields,
values, and empty/loading/error/success designs. The 9 → 10 migration adds an empty authority and invents no data.

Format v11 adds bounded asset metadata and stable node assignments. Each record declares a closed media kind,
positive intrinsic dimensions, crop mode, 0–100 focal point, alt/decorative intent, maturity, and either a
normalized workspace-relative reference or credential/query/fragment-free HTTPS reference. Asset create,
replace, delete, and assignment use exact revisioned commands; in-use deletion is refused. Stale ids and missing
alt text remain owning-node diagnostics. The 10 → 11 migration adds an empty library and never scans files or
invents assignments or copy.

Format v12 adds a separate revisioned repository-mapping authority to the implementation guide. One mapping
names a component, token, or node, a closed adapter, a normalized workspace-relative source file, an optional
symbol, declared coverage/limitations, and—for components—bounded prop/slot correspondences. The 11 → 12
migration adds revision zero and an empty collection; it scans no source and invents no relationship.

`uiRepositoryMapping.ts` owns those declarations and their read-only divergence checks. Verification is an
exact mapping-revision command handled by the extension host: real paths must remain inside the workspace,
the target must be a regular file no larger than 2 MiB, and only SHA-256 target/source fingerprints plus graph
revision/time are retained. Source content never enters `website.json`, its Markdown mirror, the webview, or a
model prompt. Target-scoped design hashes distinguish design-only, code-only, and conflicting changes without
making unrelated graph edits look like drift. No assessment chooses a winner or grants source-write authority.

Format v13 adds an optional adapter import report to each mapping. `uiRepositoryImport.ts` conservatively
recognizes React exports/simple props/slots, literal HTML/CSS selectors/custom properties, and VS Code webview
host exports/literal web facts; custom reports unsupported. Every built-in report is partial and carries a
closed loss finding. Facts (200), findings (40), and exact-name suggestions are bounded and deterministic.
The report stores adapter, graph revision, design/source fingerprints, and time, but no source excerpt or
executable value. The 12 → 13 migration adds only `lastImport: null` to existing mappings.

The webview's exact import command carries only mapping id and expected revision. The host resolves and reads
the already mapped 2 MiB-contained source snapshot, selects the mapping's adapter, and creates the report.
Copying suggestions edits only the visible form; a separate revisioned Apply action is required. Import never
executes source, resolves dependencies, mutates the graph, accepts a browser-authored report, or writes code.

`websiteWireframePreview.ts` is the target adapter, not another authority. A closed semantic-id map supplies
colour, typography, spacing, radius, and breakpoint roles to Studio canvas and Full Preview; every other
resolved token is emitted under a hex-encoded-id custom property so punctuation cannot become CSS syntax or
collapse two graph identities onto one name.

`uiDesignGraph.ts` is the graph's untrusted-input boundary and derives the legacy page wireframe while
existing readers migrate; a valid graph is the declared winner. `uiEditCommands.ts` is the pure closed
mutation path for canvas, form, future preview, and model-proposed edits. Drawing, frame/reparent, deletion,
kind, label, intent, visibility, viewport geometry/visibility override set/reset, undo, and redo commands
name the revision they read and pass an exact parser; the webview never submits a graph patch. Invalid
targets refuse, and bounded undo/redo never rewinds revision. Typed token add/set/delete uses that same exact
path and history: the host validates the whole dependency graph and protects a direct token while an alias
uses it. Component definition add/set/delete and node instance/slot assignment use the same boundary. The host
refuses in-use deletion and incompatible root-kind changes, bounds property/slot/state vocabularies, and
reconciles removed values deterministically. Node content-state add/update/remove and preview selection are
also exact revisioned commands; an absent presentation cannot be previewed. UI System sends definitions,
never graph patches. Collection add/set/delete and node-binding assignment use that same exact revision/history
boundary; Full Preview renders declared fixtures without a network request. Asset edits and assignments use
the same exact boundary; Full Preview projects
aspect ratio, crop, focal point, source provenance, and alt status as inert markup without fetching media or
widening its CSP. Responsive resolution applies desktop →
tablet → mobile inheritance and reports the source breakpoint for every computed property; clearing an
override restores that inherited value. A migrated tablet/mobile base changes at a wider viewport only
through an exact override, so the resolver does not turn absent intent into a design decision.
`resolveUiScreenLayout()` then projects direct children for stack, grid, and overlay containers using bounded
direction, gap, padding, columns, alignment, distribution, and size modes. A computed child rectangle names
its container in provenance and never replaces the stored free-layout fallback. Fill claims the available
axis; hug keeps the stored intrinsic rectangle until content measurement is implemented.
The 5 → 6 migration preserves every prior wireframe fact and the untouched-versus-empty distinction while
inventing no responsive, token, component, or source-mapping intent.

The Studio webview does not reproduce responsive inheritance. `websiteStudioPanel.ts` resolves every node
at all three breakpoints on the extension host and sends bounded layout/provenance plus override flags. The
override properties. The canvas can select hidden nodes and submit exact geometry/visibility set or reset
requests. Reset names `rect` or `hidden`, so the reducer preserves the other property and removes an empty
breakpoint record. Every result returns a fresh host projection. Drag, resize, and keyboard nudge at a
non-base breakpoint project the resolved rectangle optimistically, then submit it through the same exact
override command. Drawing, deletion, nesting, and parent changes remain confined to the base breakpoint.
Multi-selection alignment, distribution, and group nudge use one `set-node-frames` command containing only
bounded unique node ids and rectangles. The reducer validates the whole batch first, then advances one
revision and undo entry; multi-delete remains refused rather than inheriting new cascade semantics.
Container behaviour uses `set-node-layout`: closed enums, gap/padding 0–500, columns 1–12, nullable width
bounds 1–1000, nullable height bounds 1–4000, ordered min/max pairs, and an optional non-base breakpoint.
The Studio and Full Preview consume the same complete-screen projection; the webview can request settings
but cannot submit CSS or implement placement. Constraints retain the original rectangle and report their own
responsive provenance, so reset/undo reveals the prior drawn or intrinsic size.
Wrap is a closed `nowrap|wrap` value and sibling order is a bounded -1000…1000 integer. The resolver sorts
container children by order plus stable geometry/id tie-breakers and wraps stack runs without changing stored
array order, hierarchy, or rectangles.
Subtree duplication is one reducer command with a complete host-validated old→new identity map; it remaps
parents and offsets base plus explicit responsive rectangles before one commit. Node locks live in the graph
and are enforced by the reducer, including atomic frame batches and structural deletion that would otherwise
reparent a locked child. The browser's disabled controls are only feedback for that host-owned rule.
Multi-selection pointer drag computes one on-canvas delta, excludes the selection from snap candidates, and
submits every resulting rectangle through one `set-node-frames` command. Base and responsive moves are
therefore atomic, revision-checked, undoable, and unable to alter hierarchy.
`diagnoseUiScreenLayout()` runs over the same projected rectangles at all three breakpoints. It reports canvas
overflow, parent clipping, unintended overlap (excluding ancestors and overlay siblings), and interactive
nodes below 44px using the preview's actual fixed widths. The browser renders closed host findings and can
select their graph identities; it cannot submit or redefine a diagnostic.

Full Preview is the shared design feedback loop. `websiteWireframePreview.ts` deterministically combines
wireframe geometry, sanitized colour/type tokens, resolved component variant/state labels, selected authored
content-state copy/maturity, and escaped Markdown content. The pure renderer remains
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

The **trusted workflow** — the file deciding which GitHub jobs may run on your own machine — is both
generated and reviewed by AtlasMind (`trustedLocalCiStarter.ts` and `LocalCiRunnerManager.reviewWorkflow`).
Every rule the runner enforces was previously applied to a file only a person could write, from a template
that had drifted out of compliance with three of those rules, and only at the moment of lending the
machine. Reviewing is now a filesystem read available before Docker, a GitHub sign-in or a queued job
exists, and generation derives the file from the repository's own remote, branch, expanded runner label and
declared package scripts, with action pins held as reviewed module constants rather than parsed from
anywhere. A property test asserts every generated workflow passes the runner's own validator, so prose and
policy cannot separate again. `missing`, `unreadable`, `blocked` and `ok` stay distinct outcomes — only an
absent file may be scaffolded — and a failure is rendered as one item per failed rule rather than a single
sentence. An unreviewed file reports as *not checked*, never as passing.

`act` is the first alternative executor with a real adapter: any workflow on the map can be run locally
with it. What AtlasMind adds is the part that decides whether the result means anything — it reads the
workflow first and says which parts `act` will not reproduce, and refuses outright where a faithful run is
impossible rather than running something else under the same job name. It plans the command and hands it to
your terminal; it does not run `act` for you, because `act` executes arbitrary workflow content with
container access, and the borrowed-machine route exists for the case where a reviewed workflow should
actually be executed.

The **Builds** view puts every route in one list, newest first. What makes it trustworthy rather than merely
useful is that it records *how closely each build was watched*. The one-job runner streams its output, so
AtlasMind can report a real verdict. GitHub is polled, because its CLI has no push channel, and running
builds say so instead of pretending to stream. And the run-here route is `unobserved`: AtlasMind typed those
commands into your terminal and does not read it, so it shows a question mark and says why. A tick there
would be an invented pass on the page people check before shipping, so the rule is enforced where the record
is created and again when it is read back.

The list holds no log output — only a pointer to where the detail already lives — and local history is
per-developer, kept in workspace state rather than the committed project memory.

Which route each kind of check *should* use is recorded in a committed file, `ci-routing.json`, with a
markdown mirror beside it — a team decision arrives as a reviewed diff rather than a habit nobody wrote
down. Every decision names the rule that made it and explains why the other candidates lost.

One rule in that file is not the file's to change. **Code nobody has reviewed never falls back to a local
route, whatever the budget says.** That filter runs before the hosted allowance is even consulted and
applies to every fallback, so running out of minutes produces a refusal rather than moving somebody else's
pull request onto your computer — otherwise "fall back to local when credit runs out" would be a mechanism
by which running out of money routes hostile code onto a developer's machine. A file demanding otherwise is
reported as an error and refused at routing time, and a property test walks the guarantee over hundreds of
generated combinations.

AtlasMind can read the Actions allowance so budget-aware rules act on a real number. When it cannot — an
endpoint that needs a scope nobody granted, most often — it says *unknown* and keeps using the preferred
route. An unreadable meter is not an empty one, and treating it as one would relocate work whenever
GitHub's billing API had a bad afternoon.

The Pipeline page also models **where** a check runs, rather than assuming. Three routes are implemented —
run the project's checks here, lend this computer to one queued GitHub job, or let GitHub's own runners do
it — and each states what a pass on it actually proves. That last part is the point: a Linux container is
not evidence about Windows however green it is, so evidence class is a property of the route fixed at
declaration and no amount of passing promotes it. `act`, Buildkite and Woodpecker are listed as declared
adapter boundaries, visible so the page does not claim three routes are all there is, and never selectable
because a route with no adapter reporting itself usable would be a button that cannot work. A capability
AtlasMind has not established shows as its own mark rather than a blank, since a blank reads as "no".

The simplest route finally has a button. It resolves the project's own check scripts by a published rule —
a declared aggregate wins over guessing at its parts — shows them in a confirmation, and types them into a
terminal without pressing Enter. It refuses outright if one of those scripts would leave the machine: a
button labelled "run here" must not publish, and commands that do reach outside stay on the Delivery
runbook where that is expected.

Local CI also has a guide of its own, `/localci`, listed beside Buzz, ACP and Lens in `/setup`. It has more
external prerequisites than anything else in AtlasMind, and was the only feature of that shape without one —
so the way you found a missing prerequisite was by hitting the failure it caused. Every step is derived from
your machine rather than asked for, and nothing in it installs or enables anything: each action opens the
screen where you decide, and a test asserts that. Its last step is proving a job has actually run, which is
kept out of the readiness check on purpose — a runner set up correctly and never used is ready, not faulty.
A missing GitHub CLI can be installed from the Runner view, from commands held as constants in the extension
host, shown in full before anything runs and confirmed afterwards by re-checking PATH rather than by an exit
code. Docker is deliberately not installed that way, and neither is `gh` on Debian and Ubuntu, where the
reliable route means adding a repository and keyring that AtlasMind will not script.

The same Pipeline page now has a separate **execution fabric** backed by `localCiRunner.ts`. GitHub Actions
is the connected provider and Docker is the current executor; Buildkite, Semaphore and other systems are
shown as adapter positions, not as completed runs. Opening the page remains local and passive. An explicit
inspection checks GitHub CLI availability/authentication and reads host CPU/RAM/GPU capability plus
Docker-engine CPU, memory, OS, architecture and advertised runtimes. Unchecked prerequisites stay “Not
checked” rather than becoming false missing-tool claims. Capacity planning preserves at least 25% for the
desktop, applies machine-scoped ceilings, and publishes
the exact calculation and Linux-container evidence boundary on the card. GPU identity and trustworthy
VRAM are capability evidence only: the access policy remains disabled and Docker receives no `--gpus`.

Starting is a one-job transaction. AtlasMind reads and deduplicates GitHub's `pending` and `queued` workflow
states and requires exactly one waiting owner-authored run in total at current HEAD. A current run alongside
a stale run refuses because GitHub may assign either job sharing the label. Queue absence or mismatch returns
to a retryable ready state and carries the local/waiting SHAs for explanation. AtlasMind then re-validates
the committed workflow's trigger, repository, branch, actor, read-only permissions,
secret/OIDC absence, immutable action pins, checkout credential handling and unique dedicated label. Only
then does a modal name the run, image, resource limits and cleanup effect. The registration token streams
from GitHub CLI directly into Docker stdin; it never enters browser state or AtlasMind text. The ephemeral
container has no host mounts, Docker socket, GPU, persistent volume, ports or default labels and is bounded
by CPU, memory, swap, process, capability and privilege-escalation controls.

Docker Desktop cleanup records who opened it. The default stops it only when AtlasMind did; the operator
may keep it open or request an always-close policy, but an unreadable inventory or unrelated running
container inhibits shutdown. Linux system services are outside this lifecycle. Windows, macOS and Linux
can host the control plane, while native Windows/macOS evidence still requires native executors.

The dashboard re-reads the effective runner permission before every snapshot. The manager remembers the
last configuration so identical reads do not reset an inspected runner, while a profile/extension-host
change invalidates readiness and requires inspection again. The webview receives the effective setting
source for explanation only and cannot submit a replacement value.

The surrounding **Pipeline Studio** is a progressive webview over those host-owned services. A four-decision
beginner route follows the real order—choose checks, prepare the computer, queue GitHub, lend one temporary
runner—then presents result reading as the follow-up. Start here derives the first incomplete decision and
shows one primary action with a compact progress strip; the full step list, specialist shortcuts, and recent
history begin collapsed. Six local subviews cover workflow, runner, tests,
analytics, and packages/monorepo context around the Start view. Runner setup explicitly says no permanent
daemon is required and separates permission, Docker, GitHub CLI/sign-in and pinned-image readiness.
The current runner action and critical blockers precede the setup disclosure. Missing prerequisites expand
that disclosure automatically; completed diagnostics collapse, while hardware, GPU, providers, resource
limits, lifecycle and evidence remain available in a separate technical disclosure.
Installation help appears only for a missing item and opens a host-allowlisted official page from an opaque
webview id; raw machine installer commands are not presented as repository steps. The page explicitly
distinguishes operating-system applications from project dependencies.
Queue guidance renders the trusted branch as prose and only complete `gh` commands as code. Standard Copy
and Send controls post no queue command string; the host rebuilds it from validated configuration. Cancel
posts only a positive run id that must still belong to the current waiting-run issue. Send writes without a
newline into a workspace-rooted terminal using the configured Windows, macOS, or Linux shell.
Accessible information disclosures reuse persisted open/focus state;
measured dials, test cells and charts have reduced-motion final states. The draggable workflow graph saves
only presentation coordinates in webview state and cannot edit or supply workflow YAML.

Workspace topology is derived from declared Node workspaces or a bounded first-level manifest scan, with
candidate paths constrained under the workspace. “Affected” means a current worktree path falls inside a
unit; it is not dependency-graph evidence. The package inventory checks only manifest, lockfile, dependency
monitor and registry-configuration presence. It never reads registry values, and external cache, approval,
vulnerability or publication state stays unconfigured until a provider adapter supplies it.

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
| `src/core/` | Orchestration, routing, planning, safety, cost, project services, and CI inspection, trusted-workflow generation, the route model, routing policy, build ledger, act adapter and local CI setup guidance (`ciManager.ts`, `trustedLocalCiStarter.ts`, `ciRoutes.ts`, `ciRoutingPolicy.ts`, `ciCreditMeter.ts`, `ciBuildLedger.ts`, `ciActRoute.ts`, `localCiSetupPlan.ts`, `localCiInstaller.ts`), the guarded local CI executor (`localCiRunner.ts`) |
| `src/runtime/` | The built-in agents and how the runtime is composed |
| `src/providers/` | Provider adapters, catalogues, health, local model discovery, `modelRole.ts` (what a model is *for*), and the local-GPU support layer that measures VRAM and reads what each runtime has loaded |
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
