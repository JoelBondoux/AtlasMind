# Game Engine Integration — Phased Roadmap

> **Status:** Phase 1 complete; Phase 2 in progress through C2.4; C2.5 next. **Owner:** AtlasMind core. **Created:** 2026-07-30. **Baseline:** v0.213.0.
> This is the SSOT implementation plan. Its normative specifications are
> [`docs/project-composition.md`](../../docs/project-composition.md) (v0.213.1) and
> [`docs/game-engine-integration.md`](../../docs/game-engine-integration.md) (v0.213.2), both written
> — **C0.1 is complete**. Where a specification and this file disagree, the specification wins and
> this file is wrong.
>
> Nothing here overrides AtlasMind's safety-first defaults: deny-by-default, sanitize-at-boundary,
> confirm-before-destructive-action. Build incrementally, respecting the entry criteria between phases.

## Decisions taken at kickoff

| Question | Decision | Consequence |
|---|---|---|
| Which engines | Unreal, Unity, **Godot** (engine, not the GOG storefront) | Three adapters behind one identity module. Stores are a separate axis, deferred to Phase 4. |
| How deep | **Phased** — read project files first, in-engine bridge second | Reading needs zero install and ships value alone. The bridge is never a prerequisite for the dashboards. |
| Lead engine | **Unreal** | The hardest surface goes first, so Unity and Godot are simplifications rather than surprises. |
| Driver | **Product capability**, no game project yet | Optimise for generality and testability. Validate against fixture projects, not one real game. |
| Project layout | **Four topologies, first-class** — single-repo, multi-repo, multi-root, hybrid | Single-repo is the *simplest* case, not the assumed one. Forces a composition model before anything reads a file. |
| Where composition lives | **`projectComposition.ts` — general, not game-specific** | Games are the forcing function, not the owner. See "Why this is not a game module" below. |

## Context — why

`game` has been a first-class `ProjectArchetype` since v0.185.0, and `archetypePacks.ts` already ships
a game pack with a CI shape, a release model, a testing model, documentation expectations, refactor
heuristics and watch paths. `projectArchetype.ts` opens with the admission that games were "the
clearest casualty — detected from `phaser`/`bevy`/`pygame`, never acted on".

That was fixed one level up and not at all one level down. Today AtlasMind can tell you a project is
a game. It cannot tell you which engine, which version, what it builds, what it ships, or whether any
of its assets are tracked properly. Neither `.uproject` nor `ProjectSettings/ProjectVersion.txt`
appears anywhere in `src/` — a UE or Unity project currently reports as `generic`.

**And a second, larger gap sits underneath that one.** A professional game is rarely one repository:

- an engine fork, carrying local modifications against upstream;
- gameplay systems — character controllers, AI, inventory, quests, combat;
- shared libraries — math, networking, serialization;
- a rendering and shader pipeline — HLSL/GLSL, material graphs, post-processing;
- backend services — matchmaking, leaderboards, analytics, player profiles;
- tools and build systems — custom editors, asset pipelines, CI/CD.

AtlasMind cannot see any of that. **130 `workspaceFolders` references in `src/`, 123 of which take
`[0]`** — it is single-root by construction, in every surface, with one comment acknowledging
multi-root ([`workflowAutomation.ts:101`](../../src/core/workflowAutomation.ts)) and no handling
behind it. `docs/roadmap.md:53` lists "monorepo / multi-root workspace awareness" as an open gap.
**Perforce, `p4` and "depot" appear zero times** across `src/`, `docs/` and `wiki/`.

So the goal is not "add a game feature". It is **make the archetype that already exists actually
specialise**, and — first — teach AtlasMind that a project can be more than one thing in more than
one place. Games are simply where that gap is impossible to work around.

## Architecture profiles — the model

The six components above and the four layouts are **two orthogonal axes**, and collapsing them into
one enum would produce 24 combinations that multiply again with every new role or storage system.
That is the mistake `projectArchetype.ts` avoided with archetype-plus-traits, and the same answer
applies: compose, do not enumerate.

### Axis 1 — component role (what a unit *is*)

| Role | Nearest archetype | What makes it distinctive |
|---|---|---|
| `engine` | none — new | **Distance from upstream is the dominant risk.** Nothing else in the project has a merge burden that grows silently with time. |
| `gameplay` | `game` | The systems the pack already describes: frame budget, simulation/render coupling, tuning values. |
| `shared-library` | `library` | Semver and API surface genuinely matter, because the consumers are siblings that will break. |
| `rendering` | none — new | Shaders compile per platform and per permutation. Not unit-testable in the usual sense; the gate is compilation across targets. |
| `backend` | `api` | Carries `has-server` and usually `handles-personal-data`. Real deploys, real GDPR surface — the existing Delivery and Privacy pages apply here and nowhere else in the project. |
| `tools` | `cli` / `desktop` | Internal consumers. Breakage blocks the team rather than players, which changes its severity, not its priority. |
| `content` | none — new | Assets, no code. Usually the Perforce half of a hybrid layout. |

The `backend`, `shared-library` and `tools` rows are the point: **a game project is a composite of
archetypes, not one archetype.** AtlasMind's archetype is single-valued per project today, so a game
with a matchmaking service currently gets either game advice for its backend or backend advice for
its game — never both, correctly, at once.

### Axis 2 — topology (where components *live*)

| Topology | Definition | What AtlasMind must not assume |
|---|---|---|
| `single-repo` | One git repo, one root | — this is today's assumption |
| `multi-repo` | N git repos, one per component | That one `git status` describes the project |
| `multi-root` | N folders in one VS Code workspace | That `workspaceFolders[0]` is the project |
| `hybrid` | Git for code, Perforce depot for content | That everything is under git at all |

The axes compose: multi-repo is usually *also* multi-root in the editor, and hybrid is multi-root
with one root under a different VCS. So topology is derived from the component set, not declared
alongside it — a project is `hybrid` because one of its components says `vcs: perforce`, not because
somebody ticked a box that could disagree with the components.

### Why this is not a game module

`projectComposition.ts` is **general**. Game profiles are declared presets over it, the way
`archetypePacks.ts` holds per-archetype data rather than branching code.

Building this game-only would guarantee a second, disagreeing answer the moment the monorepo roadmap
item lands — which is precisely the failure `projectArchetype.ts` was written to fix ("three answers
in the codebase and they disagreed"). Repeating it one release after documenting it would be hard to
defend.

### The other consumers — who else this serves

Composition introduces four reusable mechanisms. Candidates earn inclusion by hitting them, not by
resembling a game:

| Candidate | Composition | Upstream divergence | Large binaries | Non-git storage |
|---|---|---|---|---|
| **Shopify** — theme + app + extensions | ✅ already two archetypes in `fromBootstrapLabel` | — | — | — |
| **ML / AI** — train, serve, data, eval | ✅ | ✅ fine-tune from a base model | ✅ weights, checkpoints | ✅ DVC, S3, HF Hub |
| **Embedded / IoT** — firmware + app + cloud | ✅ | ✅ vendor BSP or SDK fork | ~ blobs | — |
| **Fork-based products** — Chromium, Postgres, Odoo | ~ | ✅ | — | — |
| **Mobile / DevOps monorepos** | ✅ | — | — | — |
| **VFX / virtual production** | ✅ | — | ✅ | ✅ Perforce |

**Shopify is the Phase 1 validation case.** The bootstrapper's project-type picker is a single-select
`showQuickPick` writing one `intake.projectType` string, and it offers *Shopify Store / Theme* and
*Shopify App* as mutually exclusive options — while a real Shopify build is routinely both, plus
extensions, in separate repos or roots. The composite gap therefore already exists in the domain this
repository has invested most heavily in. Validating composition there costs no new domain knowledge
and fixes a live defect; if the model cannot express "theme + app + extension", it will not express
"engine fork + gameplay + backend".

**ML/AI is the intended second consumer**, already on `docs/roadmap.md`'s prefab list. It is the only
candidate hitting all four mechanisms, and it is what makes `external` storage general rather than a
Perforce special case — model weights under DVC pose the same question as maps under a depot.

**Embedded and fork-based products need no new code**, only packs, provided `upstreamDivergence.ts`
stays engine-agnostic. Do not build those packs speculatively: the pack rule is that nothing is
recommended which the shape cannot produce evidence for, and a pack nobody asked for cannot be
validated against a real project.

**VFX and virtual production are the closest architectural match and are deliberately out of scope** —
identical tooling, but an audience AtlasMind is not positioned for.

### Version control is a component property, not a project property

Every component carries `vcs: 'git' | 'perforce' | 'external' | 'none' | 'unknown'`. Every
git-assuming surface must **ask the component** rather than assume the project.

`external` is deliberately not `dvc` or `s3`. A component whose contents live outside version control
entirely — model weights in DVC, datasets on S3, assets in an artifact store — poses AtlasMind the
*same* question as a Perforce depot: content it cannot see, whose absence must not be reported as
emptiness. Enumerating each storage product would grow the field forever and force a schema migration
the first time a new one appears.

The honesty rule is inherited directly from `ObservedDelta`: **unknown is not zero.** A component
whose version control AtlasMind cannot read reports *"not visible"*, never a count. A dashboard
telling a Perforce studio it has "0 pending changes" is worse than one admitting it cannot see their
depot — and it is the single most likely way this feature would lose a professional team's trust.

### Where the SSOT lives

**One `project_memory/`, in a declared home component.** The game is one project even when it is six
repositories: the roadmap, the debt register, the risk register and the decision log are all about
the game, and splitting them per repo would fragment the one thing SSOT exists to unify.

Facts that genuinely *are* per-component — git status, pull requests, CI runs, build results — are
scoped to their component and labelled with it. That distinction is the whole design: shared
reasoning, scoped evidence.

### Migrating 123 call sites without a 123-file commit

Introduce a `WorkspaceScope` resolver whose **default resolution is today's `workspaceFolders[0]`**,
so existing behaviour is preserved byte-for-byte until a surface opts in. Migrate by consequence, not
by count: the surfaces where single-root is actively wrong (asset inventory, build, git status, debt
scan, CI) move first; the rest follow when touched for other reasons. A sweeping mechanical rewrite
of 123 sites would be unreviewable and would land its bugs everywhere at once.

## Separation of concerns — the governing contract

| Concern | Owner | Never |
|---|---|---|
| What the project is composed of | `projectComposition.ts`, declared in `workflow.json` | Inferred from folder names alone |
| Which topology applies | Derived from the component set | Declared separately, where it could disagree |
| Which engine and version | `gameEngineIdentity.ts`, read from the project's own files | Inferred from a dependency name, or guessed |
| Version control per component | The component's declared `vcs` | Assumed to be git |
| What command builds the game | User-authored config, or a constant in source | A path parsed out of a `.uproject` and executed |
| Engine binary location | User-authored setting, resolved and validated host-side | Discovered from a project file and spawned |
| Whether the bridge may run | Two settings gates, both defaulting closed | A plugin's presence enables anything |
| Engine output (logs, asset names, console) | Untrusted input — sanitized, clamped, control-stripped, fenced | Passed to a model unfenced, or trusted as instruction |
| Writing engine content | The engine | AtlasMind writes a `.uasset`, `.umap`, or any binary asset |
| Companion plugin distribution | Source the engine itself compiles or interprets | A compiled binary shipped into a user's engine |

The last two rows are load-bearing. **AtlasMind proposes; the engine writes.** And **no compiled
artifact ships** — the UE companion is Python, the Unity companion is C# the editor compiles, the
Godot companion is GDScript. That is a security property (we never place a binary inside someone's
toolchain) and a maintenance property (a C++ UE plugin would need rebuilding for every engine
version, an unbounded commitment we would fail to keep).

## Engine surface — ground truth (verify per engine release)

Every version-specific fact below is a **claim to be verified at implementation time**, then pinned in
a constant, following the `ACP_SPEC_VERIFIED_AT` / `BUZZ_PROTOCOL_VERIFIED_VERSION` precedent. Engine
CLIs change between major versions and a remembered flag is how this feature would rot.

| Engine | Decisive project file | Version source | Headless/CLI surface | Companion form |
|---|---|---|---|---|
| Unreal | `*.uproject` (JSON) | `EngineAssociation`, plus `Config/DefaultEngine.ini` | `RunUAT` `BuildCookRun`; commandlets; Python Editor Script Plugin | Python (no compilation) |
| Unity | `ProjectSettings/ProjectVersion.txt` | `m_EditorVersion` — authoritative and exact | `-batchmode -quit -executeMethod` | C# editor script in a UPM package |
| Godot | `project.godot` (INI-like) | `config/features` (Godot 4); absent implies Godot 3 | `--headless --export-release` | GDScript editor addon |

Two facts already in the tree: `projectArchetype.ts` detects `project.godot` and the token `godot`,
and `terminalRun.ts` allow-lists the `godot` command. Unreal and Unity are detected nowhere.

An **engine fork** is identified separately from an engine *installation* — a fork is a component
whose upstream is Epic's or Unity's source, and its distinguishing fact is its distance from that
upstream, not its version string.

`RunUAT` and Unity's `-batchmode` are deliberately **not** added to the `terminalRun` auto-approve
tier. They take arbitrary arguments, run for tens of minutes, and write build output — they belong in
the ask tier permanently.

## The problems this plan must not pretend away

**1. Perforce is not optional once hybrid is a first-class profile.** Hybrid is the standard
mid-size and AAA layout. Phase 2 does **not** integrate with `p4` — it *models* the depot and is
honest about the boundary: which components AtlasMind can see, which it cannot, and what that means
for every count on every page. Actual `p4` reads are Phase 4, behind the same argv-array, no-shell
boundary as `ghClient`.

**2. Git is a poor fit for the content half regardless.** Binary assets do not diff or merge; Unreal's
own answer is exclusive locking. For git-tracked content components, Phase 2 ships **LFS honesty** —
binary assets not covered by `.gitattributes`, reported — because it is the highest-value early
finding and the cheapest to compute.

**3. `TestingPolicyCoverage` currently creates a permanent false gap.** The game pack recommends
`performance`, nothing reads a profiler capture, so declaring the archetype produces a gap that can
never close — exactly what `archetypePacks.ts` warns against.

**4. An engine fork's merge burden is invisible and compounding.** Nothing in AtlasMind models
distance-from-upstream, and no competing tool tracks it. This is the clearest differentiating surface
in the whole plan and it is cheap: it is a git computation, not an engine one.

**5. Console platforms are under NDA.** Switch, PlayStation and Xbox SDKs cannot be bundled, required,
probed for, or documented from sources we may not hold. Modelled as **declared targets with
user-authored commands only**; AtlasMind never asserts a console fact.

**6. A wrong engine is worse than `unknown`.** Same honesty rule as `projectArchetype.ts`. A
misdetected engine produces build commands that do not exist and asks for evidence the project can
never produce — which teaches people to ignore the dashboard.

---

## Phase 0 — Specification and decisions

**Exit:** the spec exists, the persisted schemas are agreed, and nothing downstream is blocked on an
unmade decision.

- **C0.1a** — ✅ `docs/project-composition.md` (v0.213.1). Composition and topology rules, the
  version-control boundary, honesty rules, `WorkspaceScope` resolution, and a conformance checklist.
- **C0.1b** — ✅ `docs/game-engine-integration.md` (v0.213.2). Engine identity and version rules, the
  `game.json` schema, asset and log reading, the bridge protocol, the security boundary, a
  degradation table covering every "we cannot tell", and a conformance checklist.
- **C0.2** — ✅ Both schemas registered with `SchemaMigration` at v1 *before* anything writes a file.
  Composition remains part of the existing `workflow` kind; the game profile is registered as `game`.
  A focused migration test pins current v1 reads and future-version refusal.
- **C0.3** — ✅ Fixtures under `tests/fixtures/game-engines/`: a minimal `.uproject` tree, a Unity `ProjectSettings`
  tree, Godot 3 and 4 projects, **and one multi-root composite with a simulated Perforce component**.
  An executable fixture contract proves the engine markers, exact version evidence, one-home invariant,
  hybrid VCS boundary, and absence of stored topology or prohibited secrets/SDK paths. Everything
  downstream is unit-testable without an engine or a depot, and this is what makes that true.

## Phase 1 — Composition and topology (general, not game-specific)

**Entry:** Phase 0 complete. **Exit:** a multi-root workspace resolves to a declared component set
with per-component VCS, and no existing single-root behaviour has changed.

- **C1.1** — ✅ `src/core/projectComposition.ts` — pure, `vscode`-free, unit-tested. Component roles,
  per-component archetype and `vcs`, derived topology, the declared home component. Detection
  suggests, declaration decides; a proposal can never become effective state by inference. A malformed
  component invalidates the declaration rather than disappearing, and unreadable state stays unknown.
- **C1.2** — ✅ `src/core/workspaceScope.ts` — the pure resolver. **Default resolution is today's
  `workspaceFolders[0]`**, without consulting composition, so nothing changes until a surface opts in.
  Home, component and all-component requests retain missing, unreadable and ambiguous roots as unknown.
- **C1.3** — ✅ Composition is persisted in `workflow.json` (committed, reviewed, owned by the team)
  rather than settings. Unknown fields survive; an invalid/future nested shape is retained opaquely
  instead of partially activated; the Markdown mirror publishes the declared component boundary.
- **C1.4** — ✅ Git status, local CI, debt scan and observed-delta resolve declared components and
  **label their scope on screen**. The detailed legacy GitHub reading remains explicitly scoped to the
  home component while the component inventory names every exclusion.
- **C1.5** — ✅ `ObservedDelta`, `DebtRegister` and `IssueTracker` carry `not-visible` as distinct from
  zero for non-Git, missing, unreadable, or unsupported components. Debt reconciliation is keyed by
  component plus path, and observed baselines refuse cross-scope comparison.
- **C1.6** — ✅ **Shopify composition — the validation case.** Guided bootstrap offers an explicit
  multi-select for composable shapes, so *theme + app + extension* is expressible and persisted in the
  workflow JSON/Markdown pair. The canonical builder uses only generic roles, archetypes, traits,
  locations, VCS and one home; the tested write preserves existing or newer workflow data and executes
  no Shopify command. The model is proven with no game code or new domain vocabulary.
- **C1.7** — ✅ Game architecture presets — guided bootstrap offers declared compositions for
  single-repo indie, multi-repo studio, hybrid Git + Perforce, and engine-fork studio layouts.
  Presets **seed and do not govern**: only fresh editable components are persisted, never the preset id
  or derived topology. Perforce carries no depot/credential and an engine fork receives no invented
  upstream coordinates; selection executes no command.
- **C1.8** — ✅ `upstreamDivergence.ts` is built here rather than in Phase 2. It is pure Git and
  engine-agnostic: an injected argv runner reads one declared remote-tracking ref without fetching,
  derives commits ahead/behind, the exact changed-path union and overlap, and like-for-like trend
  snapshots. Non-Git, unresolved, undeclared, failed, malformed, and over-bound evidence remain
  explicit unknowns. Phase 2 consumes it; it does not own it.

## Phase 2 — Read the project (no install, no bridge)

**Entry:** Phase 1 complete. **Exit:** a UE project — single-repo *or* multi-root hybrid — shows a
correct engine, version, build targets, asset inventory, LFS verdict and fork distance, with no
plugin installed and no engine running.

- **C2.1** — ✅ `src/core/gameEngineIdentity.ts` mirrors `projectArchetype.ts` in structure and
  discipline. `GAME_ENGINES = ['unreal','unity','godot','custom','unknown']`; bounded decisive-file
  evidence reads exact declarations without filesystem/editor access or dependency inference.
  Cross-engine and invalid inventories remain unconfident `unknown`; an identified engine with an
  unreadable version withholds dependent surfaces. Declaration wins, and primary-source dates plus
  narrow verified ranges prevent newer versions from being extrapolated.
- **C2.2** — ✅ `src/core/gameAssetInventory.ts` performs an explicit-confirmation bounded walk over
  declared component content roots. One shared file/byte/time budget covers the request; counts and
  sizes are grouped by a closed type catalog; import evidence keeps no raw line; metadata orphans stay
  candidates and are withheld after truncation. Git components receive conservative root/nested LFS
  coverage, while unsupported rules and Perforce/external/unknown boundaries remain unreadable or
  `not-visible` instead of becoming zero. Symlinks are never followed.
- **C2.3** — ✅ `src/core/gameEngineDivergence.ts` applies the generic C1.8 report only to a matching
  declared `engine` component and upstream. It preserves exact commits behind/ahead, files diverged,
  conflict-prone candidates, and trend, then adds descriptive burden shapes with no hard-coded
  threshold. Version-pinned Unreal 5.8, Unity 6000.2.0b4, and Godot 4.6 layouts interpret only the
  bounded displayed paths; truncation remains explicit and unverified/custom/unknown engines retain
  generic facts without guessed path meaning. The collector remains pure Git and engine-agnostic, so
  vendor BSP, Chromium, and Postgres forks can reuse it unchanged.
- **C2.4** — ✅ `src/core/gameBuildLog.ts` parses only the complete report a caller already supplied and
  performs no discovery or execution. Character, line, diagnostic, path, and field caps bound hostile
  input; retained findings are control-stripped and shared-secret-redacted, while the raw log is never
  returned. Only a captured exit code or version-pinned completion marker establishes the overall
  verdict, with conflicts and weak evidence withheld. Missing evidence yields **"no verdict"** plus a
  verified display-only command where available — never "0 errors" and never an extrapolated command.
- **C2.5** `src/core/gameProfile.ts` — `project_memory/domain/game.json` plus a `game.md` mirror,
  following `websiteWorkspaceManager`. Declared engine, platform targets, build configurations,
  performance budgets, content roots, discipline ownership. Seeding never overwrites a newer file.
- **C2.6** `TestingPolicyCoverage` reads a **performance report the project already wrote**, closing
  the false gap. Never runs a profiler; no report means no verdict.
- **C2.7** `DebtRegister` gains game-shaped derived signals — assets outside LFS, unresolved import
  errors, tuning values in code, **fork distance past a declared threshold** — graded by the *same*
  rule table.
- **C2.8** `projectArchetype.ts` detection gains `.uproject` and `ProjectSettings/ProjectVersion.txt`.

### The Game Studio surface

- **C2.9** `src/views/gameStudioPanel.ts` + `src/core/gameWorkspaceManager.ts`, mirroring
  `WebsiteStudioPanel`. **A separate panel, not pages inside `projectDashboardPanel.ts`** — that file
  is already 14,335 lines, and a domain studio owns its own panel by precedent.

  | Page | Shows | Source |
  |---|---|---|
  | **Production** | Milestone / vertical-slice state, feature status by discipline, what blocks the next build | `game.json` + roadmap |
  | **Architecture** | The component map — role, archetype, VCS, visibility, upstream divergence. The answer to "what is this project made of?" | `projectComposition` + `upstreamDivergence` |
  | **Build & Cook** | Platform × configuration matrix, last result per cell, cook and package durations, size trend | `gameBuildLog` |
  | **Assets** | Inventory by type and size, LFS coverage and the uncovered set, import errors, budget vs. declared | `gameAssetInventory` |

- **C2.10** Commands and settings: `atlasmind.openGameStudio`, `atlasmind.game.scanAssets` (a
  filesystem walk, so explicit request behind a confirmation), `atlasmind.gameEngine.*` — all
  deny-by-default.
- **C2.11** A game agent pack: technical artist, level designer, gameplay engineer, audio, narrative,
  producer, playtest lead. `AgentDefinition` + `SkillDefinition` records, **not** new core services.
- **C2.12** New read-tier skills: `engine-project-read`, `asset-inventory`, `engine-log-read`,
  `fork-distance`. Classified explicitly in `toolPolicy.ts` rather than left to the unknown-tool
  fallback, which would label them `network`.

## Phase 3 — The Unreal bridge (read-only)

**Entry:** Phase 2 shipped, UE fixtures green. **Exit:** a running UE editor streams state into the
Game Studio, and a test asserts the bridge cannot send a command.

- **C3.1** `src/core/gameBridgeProtocol.ts` — pure, versioned, mirroring `remote/protocol.ts`.
  AtlasMind **hosts**, the plugin **connects**: loopback bind only, token auth as the mandatory first
  frame, token in `SecretStorage`.
- **C3.2** `src/core/gameBridgeServer.ts` — transport injected, so it is unit-testable on a fake
  socket and integration-tested against a real in-process server, following `buzzClient`/`buzzSocket`.
- **C3.3** **Read-only by construction**, asserted by a test the way `buzzClient` asserts it never
  sends `EVENT`. The Phase 3 protocol has no command frame at all — not a disabled one.
- **C3.4** Two gates, both closed by default: `atlasmind.gameEngine.enabled` and
  `atlasmind.gameEngine.bridgeEnabled`. Persisting anything the bridge observes is a **third**.
- **C3.5** The UE companion — Python, via the Editor Script Plugin. Ships as source in the repo with
  install instructions; **never installed by AtlasMind**, quoted the way `buzzDocsSource` quotes
  Buzz's own commands.
- **C3.6** Everything crossing the boundary is untrusted — asset names, blueprint node names, log
  lines, console output. Redacted, control-stripped, clamped, fenced as REPORTED CONTENT before
  reaching a model: the `buildIssueWorkPrompt` rule applied to a far noisier source.
- **C3.7** A **Performance** page fed by live captures, budgets declared in `game.json`. Frame budget
  as a correctness gate — what the game pack already claims and nothing yet delivers.
- **C3.8** `PresenceManager` holds a `game-bridge` reason only while a session is live.

## Phase 4 — Breadth, action, and shipping

**Entry:** Phase 3 shipped and stable across at least two UE versions.

- **C4.1** Unity companion — C# editor script in a UPM package, same protocol.
- **C4.2** Godot companion — GDScript addon, same protocol.
- **C4.3** Perforce reads — `p4` behind an argv-array, no-shell boundary mirroring `ghClient`.
  Changelists, pending changes, and who holds a lock, which is the question a hybrid team actually
  asks. Read-only; no submit, no revert, no unlock.
- **C4.4** Agent-invoked engine commands — the first write path, every one through
  `toolApprovalManager` at the `terminal-write` tier. Commands from user-authored config or constants
  in source; a webview supplies data only, never a command string.
- **C4.5** **Playtest** page — sessions, findings, tester bug intake, feeding `FollowUp` and issues.
- **C4.6** **Content & Design** page — design document shelf via `DocumentsManager`, tuning and
  balance tables, narrative and localisation state.
- **C4.7** **Ship** page — store and certification checklists (Steam, GOG, Epic, itch), age ratings,
  store page assets, submission state. Consoles as declared targets only. The storefront axis lands
  here, deliberately separate from the engine axis.

---

## Non-goals

- Replacing the engine editor, or rendering anything in VS Code.
- Asset generation — that belongs to the Vision panel and specialist integrations, where Ludus AI is
  already tracked.
- Bundling, requiring, or probing for console SDKs.
- Shipping any compiled artifact into a user's engine installation.
- Perforce **writes**, at any phase. Reads are Phase 4; submit, revert and unlock are out of scope
  entirely — an agent that can revert an artist's unsubmitted work is not a tool anyone will install.
- A mechanical rewrite of all 123 `workspaceFolders[0]` sites.

## Documentation obligations

Per the CLAUDE.md maintenance table, each phase's commits carry their doc updates in the same commit:

| Trigger | Files |
|---|---|
| New core services (C1.1–C1.2, C2.1–C2.5, C3.1–C3.2) | `README.md` (Project Structure), `docs/architecture.md`, `docs/development.md`, `wiki/Architecture.md` |
| Composition model (Phase 1) | New `docs/project-composition.md`; `docs/configuration.md`; `wiki/Architecture.md`. **`docs/roadmap.md:53` closes** — the multi-root gap is delivered here. |
| New panel (C2.9) | `docs/development.md`, `wiki/Architecture.md`, plus `docs/game-studio.md` mirroring `docs/website-studio.md` |
| New commands (C2.10) | `README.md`, `package.json`, `wiki/Chat-Commands.md` |
| New settings (C2.10, C3.4) | `README.md`, `package.json`, `docs/configuration.md`, `wiki/Configuration.md` |
| New agents and skills (C2.11–C2.12) | `docs/agents-and-skills.md`, `wiki/Agents.md`, `wiki/Skills.md` |
| Bridge and Perforce boundaries (C3.1–C3.6, C4.3) | `wiki/Tool-Execution.md`, `wiki/Security.md`, `docs/agents-and-skills.md` |
| Every commit | `CHANGELOG.md`, `package.json` version bump, `README.md` banner, `wiki/Changelog.md` |

`docs/roadmap.md` already lists "**Game Dev:** Unity, Unreal, Godot, Web-based" under Prefab
Architecture Packs and "monorepo / multi-root workspace awareness" under professional developers.
Both lines point here once Phase 1 lands, so the three do not drift.
