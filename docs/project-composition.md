# Project Composition

How AtlasMind models a project that is more than one thing, in more than one place.

This is the normative specification. The phased implementation plan lives in
[`project_memory/roadmap/game-engine-integration.md`](../project_memory/roadmap/game-engine-integration.md),
whose Phase 1 delivers this model; where the two disagree, this document wins.

## §0 Status and scope

### 0.1 Normative language

**MUST**, **MUST NOT**, **SHOULD** and **MAY** carry their RFC 2119 meanings. A **MUST** here is a
property a reviewer may reject a change for violating.

### 0.2 Built versus proposed

Phase 1 is built through C1.6: `projectComposition.ts` owns the closed roles/VCS vocabulary, strict
normalization, validation, declaration-over-proposal rule, and derived topology; `workspaceScope.ts`
resolves explicit home/component/all requests while defaulting exactly to the first VS Code workspace
folder; and `workflowConfig.ts` round-trips the declaration and publishes it in the Markdown mirror.
The Project Dashboard now opts Git status, local CI, debt scanning, issue-tracker visibility, and
observed-delta into component scope. Each reports its scope, retains excluded components as
`not-visible`, and never substitutes zero for an unreadable VCS. Guided bootstrap's explicit Shopify
multi-select validates theme + app + extension against the same generic model. Game presets and upstream
divergence remain proposed.

### 0.3 Non-goals

- Replacing VS Code's own multi-root workspace mechanism. AtlasMind reads it; it does not manage it.
- A build system, a task orchestrator, or a dependency graph between components.
- Writing to any version control system other than git, ever. See §6.4.
- Automatic composition. Detection proposes; a human declares. See §7.

## §1 Why composition — the problem, dated 2026-07-30

Three facts about the codebase, verified at v0.213.0.

**1. The archetype is single-valued per project.** `projectArchetype.ts` resolves one
`ProjectArchetype` for the workspace. A project containing a game client *and* a matchmaking service
receives either game advice for its backend or backend advice for its game — never both, correctly,
at once. `archetypePacks.ts` then seeds CI, testing, release and documentation expectations from that
one answer, so the error propagates into every downstream surface.

**2. AtlasMind is single-root by construction.** There are **130 `workspaceFolders` references in
`src/`, of which 123 take `[0]`**. One comment acknowledges multi-root
(`workflowAutomation.ts:101`); nothing handles it. `docs/roadmap.md` lists multi-root awareness as an
open gap.

**3. The gap is already live in the most-invested domain.** The bootstrap project-type picker is a
single-select `showQuickPick` writing one `intake.projectType` string
(`bootstrap/bootstrapper.ts:386`). It offers *Shopify Store / Theme* and *Shopify App* as mutually
exclusive options, while a real Shopify build is routinely both, plus extensions. `fromBootstrapLabel`
already maps them to two different archetypes — the composite is modelled in the vocabulary and
impossible to express in the product.

Games make this unavoidable rather than merely wrong: an engine fork, gameplay systems, shared
libraries, a shader pipeline, backend services and internal tools are six components with different
archetypes, frequently in different repositories, sometimes under different version control. But
games are the *forcing function*, not the owner. This model MUST NOT be game-specific.

## §2 The model

### 2.1 Component

A **component** is a unit of the project with one location, one role, one archetype and one version
control system. A project is an ordered set of components plus a declared home (§2.6).

Locations are portable workspace-folder names or normalized workspace-relative paths. Absolute paths,
traversal, control characters, and platform-illegal path characters are refused: committed composition
must not bind the team to one machine or become a route outside an opened workspace.

A single-repo project is a project with exactly one component. It is the simplest case, **not** the
assumed one.

### 2.2 Role — what a component is

Roles and archetypes are separate axes. A role says what a component *does for this project*; an
archetype says what *shape of software* it is. Collapsing them would multiply the vocabulary with
every new combination.

| Role | Typical archetype | Distinguishing property |
|---|---|---|
| `application` | any | The thing users receive |
| `engine` | none | Upstream divergence is its dominant risk (§4) |
| `shared-library` | `library` | Consumers are siblings, so semver breaks the team, not strangers |
| `service` | `api` | Carries `has-server`, often `handles-personal-data` |
| `tools` | `cli` / `desktop` | Breakage blocks the team, not users |
| `content` | none | Assets, not code. Frequently not under git at all |
| `infrastructure` | none | Deployment and CI definitions |

Implementations MAY add roles. A role MUST NOT be added where a trait on an existing role would
serve — the `archetypePacks.ts` rule, applied one level up.

### 2.3 Archetype per component

Each component carries its own `ProjectArchetype` and traits, resolved by the existing
`projectArchetype.ts` rules **against that component's own files**.

The project-level archetype remains, and MUST be defined as the archetype of the home component
(§2.6). Removing it would break every existing consumer; redefining it as an aggregate would make it
mean something no caller expects.

### 2.4 Version control — a component property

Every component carries:

```
vcs: 'git' | 'perforce' | 'external' | 'none' | 'unknown'
```

`external` is deliberately not `dvc`, `s3` or `artifactory`. A component whose contents live outside
version control poses AtlasMind the same question a Perforce depot does — *content it cannot see,
whose absence MUST NOT be reported as emptiness*. Enumerating storage products would grow the field
forever and force a schema migration on each new one.

Every surface that reads version control **MUST ask the component** rather than assume the project.

### 2.5 Topology — derived, never declared

| Topology | Condition |
|---|---|
| `single-repo` | Exactly one component |
| `multi-repo` | More than one component, more than one git root |
| `multi-root` | More than one workspace folder |
| `hybrid` | Any component whose `vcs` is not `git` |

Topology MUST be derived from the component set and MUST NOT be a stored field. A stored topology
could disagree with the components it describes, and the resulting question — which is right? — has
no good answer. Topologies are not exclusive: a project is commonly `multi-repo` *and* `multi-root`
*and* `hybrid`.

### 2.6 The home component

Exactly one component is the **home**. It holds `project_memory/`.

There is **one SSOT for the project**, not one per component. The roadmap, debt register, risk
register, decision log and ideation board are about the *project*; splitting them per repository
would fragment the one thing the SSOT exists to unify.

Facts that genuinely are per-component — git status, pull requests, CI runs, build results, asset
inventory — MUST be scoped to their component and MUST be labelled with it on any surface that shows
them (§6.2).

## §3 Invariants

1. **Detection proposes; declaration decides.** (§7)
2. **Topology is derived, never stored.** (§2.5)
3. **Unknown is not zero.** (§6.1)
4. **Every count is labelled with its scope.** (§6.2)
5. **One SSOT, in the home component.** (§2.6)
6. **Composition is committed data, not a setting.** (§5.1)
7. **Non-git version control is read-only, forever.** (§6.4)

## §4 Upstream divergence

A component MAY declare an `upstream` — a remote and ref it was forked from. Where one is declared,
AtlasMind reports commits behind, files diverged, conflict-prone paths, and the trend of those
numbers over time.

This is **pure git and MUST NOT be engine-specific**. A forked game engine, a vendor board-support
package, a Chromium fork and a patched Postgres have the same problem, and a module named for one of
them guarantees a second copy for the others. The module is `upstreamDivergence.ts`.

Divergence past a project-declared threshold SHOULD be surfaced through `DebtRegister` as a derived
signal, graded by the same rule table as every other entry. A register holding two scales is worse
than one holding half the entries.

## §5 The composition file

### 5.1 Location and ownership

Composition is stored in `project_memory/operations/workflow.json` alongside the workflow
configuration, and is therefore **committed, reviewed and owned by the team** — not a setting.

A change to how a project is laid out is a change to how a team works. It MUST arrive as a diff with
a reviewer, following the rule already established for `workflowConfig.ts`.

An agent MUST NOT edit the composition.

### 5.2 Schema rules

- Registered with `SchemaMigration` at version 1 **before** anything writes a file.
- Unknown fields MUST survive a round trip, so an older build cannot silently drop a newer one's
  settings.
- A component whose location does not resolve MUST be **reported, never dropped**. A silently removed
  component reads as one that was never declared.
- Exactly one component MUST be `home`. A file declaring zero or many is invalid and MUST be reported
  rather than repaired by guessing.

### 5.3 Validation versus sanitising

As with `workflowConfig.ts`, these are separate questions. Sanitising asks *is this file usable*;
validation asks *does everything it names exist*. An unresolvable component is a validation finding,
not a reason to refuse the file.

## §6 Honesty rules

### 6.1 Unknown is not zero

A component whose version control AtlasMind cannot read MUST report `not-visible`, never a count of
zero. This is the `ObservedDelta` rule — *unknown → known is not zero → n* — applied to version
control.

Telling a Perforce studio it has "0 pending changes" is worse than telling it nothing. It is also the
single most likely way this feature loses a professional team's trust.

### 6.2 Every count is labelled

Any count, chart or list derived from a subset of components MUST name that subset. An unlabelled
"14 open issues" in a six-repository project is a wrong number wearing the costume of a right one.

### 6.3 Partial coverage is stated

Where a surface can cover only some components — because the rest are `external`, `unknown`, or
unreachable — it MUST say which, following the `DebtRegister` rule that a bounded scan states its
truncation.

### 6.4 Non-git version control is read-only

AtlasMind MAY read Perforce state (changelists, pending changes, who holds a lock). It MUST NOT
submit, revert, unlock, or otherwise write.

An agent that can revert an artist's unsubmitted work is not a tool anybody will install, and the
capability cannot be made safe by a confirmation dialog — the loss is silent, remote, and belongs to
somebody who never saw the prompt.

## §7 Detection

Detection MAY propose a composition from workspace evidence: multiple workspace folders, nested git
roots, an engine project file, a `.p4config`, a `dvc.yaml`.

Detection MUST NOT decide. A proposed composition is presented for confirmation and is written only
when a human accepts it. This mirrors `projectArchetype.ts`: *a wrong composition is worse than a
single-component one*, because it scopes every count on every surface to boundaries that do not
exist, and the resulting numbers are wrong in a way nobody can see.

Guided bootstrap is a declaration path, not detection. Choosing **Shopify composable project** opens a
second multi-select for theme, app, and extension. AtlasMind writes that accepted selection only when
the workflow has no declared composition; a rerun preserves an existing declaration, an unreadable or
invalid document, an orphaned Markdown mirror, and any document written by a newer AtlasMind. It does
not execute a Shopify generator or create a guessed source tree. The app is home when selected, then the
theme, then the extension; this deterministic priority gives exactly one component the SSOT root while
sibling locations remain portable.

Where detection finds nothing, the honest answer is one component covering the workspace — not a
failure.

## §8 Resolution — `WorkspaceScope`

`WorkspaceScope` exists and its default resolution is exactly `workspaceFolders[0]`, without consulting
composition. Existing behaviour is therefore preserved byte-for-byte until a surface opts in. As call
sites migrate, they MUST resolve through this boundary; missing, unreadable, or ambiguous components
remain explicit unknown entries rather than being dropped or substituted.

Surfaces migrate **by consequence, not by count**. Those where single-root is actively wrong move
first — asset inventory, build, git status, debt scan, CI, observed delta. The rest follow when
touched for other reasons.

A mechanical rewrite of all 123 sites is an explicit non-goal: it would be unreviewable, and it would
land its bugs everywhere simultaneously.

## §9 Conformance

An implementation conforms when:

- [x] Composition round-trips through `SchemaMigration` v1 with unknown fields preserved.
- [x] Topology is computed, and no persisted field stores it.
- [x] A Shopify project expresses *theme + app + extension* as three components.
- [ ] A component with `vcs: 'perforce'` reports `not-visible` rather than zero on every git surface.
- [ ] Every multi-component count on every surface names its scope.
- [ ] `upstreamDivergence` has no engine-specific symbol in it.
- [ ] No write path to any non-git version control system exists.
- [x] A single-root workspace behaves exactly as it did at v0.213.0; default scope remains the first folder.
