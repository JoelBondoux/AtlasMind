# Game Engine Integration

How AtlasMind identifies a game engine, reads a game project, and — later — talks to a running editor.

This is the normative specification for the engine-specific half. The general model it builds on is
[`project-composition.md`](project-composition.md); the phased implementation plan is
[`project_memory/roadmap/game-engine-integration.md`](../project_memory/roadmap/game-engine-integration.md).
Where this document and the plan disagree, this document wins.

## §0 Status and scope

### 0.1 Normative language

**MUST**, **MUST NOT**, **SHOULD** and **MAY** carry their RFC 2119 meanings.

### 0.2 Built versus proposed

Phase 0 and Phase 1 are built through C1.8: the `game` persisted-document kind is registered at schema
v1; deterministic fixtures cover Unreal, Unity, Godot 3/4 and Perforce; declared component scope
round-trips through `workflow.json`; and the Project Dashboard now scopes Git, local CI, debt,
issue-tracker visibility, and observed-delta evidence to those components with explicit `not-visible`
results. The generic Shopify theme + app + extension bootstrap path supplies the required non-game
composition validation, and four editable game architecture seeds cover single-repo, multi-repo,
hybrid Git + Perforce, and engine-fork layouts without persisting preset authority or guessed
coordinates. The engine-agnostic upstream-divergence core now derives commits, changed-path overlap,
and comparable trends through read-only Git evidence. No engine detector, inventory reader, log parser,
game command surface, bridge, or game dashboard is built yet; those sections remain intended behaviour.
Facts about engines are marked as claims requiring verification (§2.4).

### 0.3 Engines in scope

Unreal Engine, Unity and Godot. `custom` and `unknown` are legitimate values, not failures.

### 0.4 Non-goals

- Replacing or embedding the engine editor. AtlasMind renders nothing.
- Asset generation. That belongs to the Vision panel and specialist integrations.
- Bundling, requiring, probing for, or asserting facts about console SDKs (§7.6).
- Shipping any compiled artifact into a user's engine installation (§6.1).
- Writing binary engine content, at any phase, under any approval (§7.4).

## §1 Why — the gap, dated 2026-07-30

`game` has been a `ProjectArchetype` since v0.185.0, and `archetypePacks.ts` ships a game pack with a
CI shape, release model, testing model, documentation expectations, refactor heuristics and watch
paths. `projectArchetype.ts` opens by admitting games were "the clearest casualty — detected from
`phaser`/`bevy`/`pygame`, never acted on".

That was fixed one level up and not at all one level down. Verified at v0.213.0:

- **Neither `.uproject` nor `ProjectSettings/ProjectVersion.txt` appears anywhere in `src/`.** A
  Unreal or Unity project is detected as `generic`.
- Godot is partly detected — `projectArchetype.ts` matches `project.godot` and the token `godot`, and
  `terminalRun.ts` allow-lists the `godot` command — but no version is read and nothing acts on it.
- `TestingPolicyCoverage` has no reader for a performance report, while the game pack *recommends*
  performance testing. Declaring the archetype therefore creates a gap that can never close — the
  precise failure `archetypePacks.ts` warns against, since a permanent false gap teaches people to
  ignore gaps.

## §2 Engine identity

### 2.1 Detection is by decisive file

Engines identify themselves by project file, not by dependency manifest. Detection MUST read files.

| Engine | Decisive file | Version source |
|---|---|---|
| `unreal` | `*.uproject` (JSON) | `EngineAssociation`, corroborated by `Config/DefaultEngine.ini` |
| `unity` | `ProjectSettings/ProjectVersion.txt` | `m_EditorVersion` — authoritative and exact |
| `godot` | `project.godot` (INI-like) | `config/features`; its absence implies Godot 3 |

### 2.2 Version is read, never inferred

Everything downstream — CLI flags, plugin APIs, build commands, report formats — is version-specific.
An engine whose version cannot be read MUST report `unknown`, and every version-dependent affordance
MUST be withheld rather than attempted with a guess.

### 2.3 A wrong engine is worse than `unknown`

The honesty rule from `projectArchetype.ts`, restated because the cost is higher here. A misdetected
engine produces build commands that do not exist and asks for evidence the project can never produce.
Detection MUST return a confidence signal, and a caller MUST NOT present an unconfident detection as
a finding.

Declaration in the composition file always beats detection.

### 2.4 Version-specific facts MUST be pinned

Every claim about an engine's CLI, file format or plugin API MUST be verified against primary
documentation at implementation time and pinned in a constant — `UNREAL_SURFACE_VERIFIED_AT` and
siblings — following the `ACP_SPEC_VERIFIED_AT` and `BUZZ_PROTOCOL_VERIFIED_VERSION` precedent.

Where AtlasMind encounters an engine version outside its verified range it MUST report *"not verified
against this version"* and degrade, never extrapolate. This is the only mechanism preventing the
feature rotting silently as engines ship.

### 2.5 An engine fork is not an engine installation

A forked engine is a **component** whose `upstream` is declared (`project-composition.md` §4). Its
distinguishing fact is distance from that upstream, not its version string. Fork tracking is pure git
and MUST NOT live in an engine-specific module.

## §3 The game profile

### 3.1 Location

`project_memory/domain/game.json`, with a regenerated human-readable mirror at
`project_memory/domain/game.md` — the `websiteWorkspaceManager` pattern.

Registered with `SchemaMigration` at version 1 before anything writes it. The registration and
future-version refusal test are built; no writer exists yet. Seeding MUST NOT overwrite a file written
by a newer AtlasMind; an explicit save may.

### 3.2 Contents

Declared engine and version; platform targets; build configurations; performance budgets; content
roots; discipline ownership; store and certification targets.

### 3.3 What it MUST NOT contain

Credentials, signing keys, store API tokens, console SDK paths, or engine binary paths. Secret
*references* only, per the Website Studio rule.

## §4 Reading the project

### 4.1 Asset inventory

A bounded filesystem walk over each `content` component's declared roots. Bounded three ways — file
count, total bytes, wall time — with the truncation **stated on the surface**, following
`DebtRegister`. Because it is a filesystem walk it MUST run on explicit request behind a
confirmation, never on render.

Asset paths MUST be traversal-checked. An asset path that escapes its declared root is reported and
its file affordance withheld, following `parseGhReviewComments`.

### 4.2 LFS honesty

For components whose `vcs` is `git`, AtlasMind reports binary assets not covered by `.gitattributes`
LFS patterns. This is the highest-value early finding and the cheapest to compute.

For components whose `vcs` is not `git`, it MUST report `not-visible` and MUST NOT report zero
(`project-composition.md` §6.1).

### 4.3 Build and cook logs

AtlasMind parses logs the project already wrote. It MUST NOT run a build to obtain one.

Logs are **untrusted input**: parsing MUST never throw, MUST use bounded regex reads rather than a
parser, MUST cap size and count, MUST strip control characters, and MUST apply the shared secret
redactor — build logs routinely contain signing paths, tokens and machine names.

Where no log exists the surface MUST report **no verdict** and name the command that would produce
one. It MUST NOT report "0 errors".

### 4.4 Performance evidence

`TestingPolicyCoverage` gains a reader for a performance report the project already wrote. It MUST
NOT run a profiler. No report means no verdict — never "0 ms", never a passing budget.

## §5 The bridge

### 5.1 Direction and transport

**AtlasMind hosts; the engine companion connects.** The server MUST bind to loopback only.

The first frame a client sends MUST be `auth`, carrying a token held in `SecretStorage`. An
unauthenticated frame MUST be refused and the connection closed. The protocol carries a version and
MUST refuse a mismatch rather than negotiating down.

Transport MUST be injected, so the client is unit-testable on a fake socket and integration-testable
against a real in-process server — the `buzzClient` / `buzzSocket` pattern.

### 5.2 Read-only by construction

The bridge protocol **MUST NOT define a command frame**. Not a disabled one, not a gated one — the
capability MUST be absent from the wire format, asserted by a test, the way `buzzClient` asserts it
never sends `EVENT`.

Agent-invoked engine commands are a later, separate protocol version and are governed by §7.5.

### 5.3 Gates

Two settings gates, both defaulting closed: `atlasmind.gameEngine.enabled` and
`atlasmind.gameEngine.bridgeEnabled`. Persisting anything the bridge observes into `project_memory/`
requires a **third**, also closed, because that directory is git-tracked.

The presence of a companion plugin MUST NOT enable anything.

## §6 Companion plugins

### 6.1 No compiled artifact ships

The Unreal companion is Python, the Unity companion is C# the editor compiles, the Godot companion is
GDScript. AtlasMind MUST NOT ship a compiled binary into a user's engine installation.

This is a security property — we never place an opaque binary inside somebody's toolchain — and a
maintenance property: a C++ Unreal plugin would need rebuilding for every engine version, an
unbounded commitment that would be abandoned and leave users on a broken plugin.

### 6.2 AtlasMind never installs

Companions ship as source in the repository with instructions. AtlasMind MUST NOT copy, download or
install one. Where installation steps are shown they are **quoted as somebody else's text**, never
one-click, following `buzzDocsSource` and `acpInstaller`.

## §7 Security boundary

### 7.1 Never execute a path from a project file

Engine binary locations come from user-authored settings or constants in source. A path parsed out of
a `.uproject`, a config file or engine output MUST NOT be executed. That is remote code execution
with extra steps.

### 7.2 Commands are argv arrays

Every subprocess uses `execFile(cmd, args)`. No shell, no interpolation of untrusted text —
the `ghClient` and `acpInstaller` boundary.

### 7.3 Engine output is untrusted input

Asset names, blueprint node names, log lines and console output MUST be redacted, control-stripped and
clamped at the boundary, and MUST be fenced and labelled REPORTED CONTENT before reaching a model.
An asset named to read as an instruction MUST NOT become one. This is `buildIssueWorkPrompt`'s rule
applied to a far noisier source.

### 7.4 AtlasMind proposes; the engine writes

AtlasMind MUST NOT write `.uasset`, `.umap`, or any binary engine content, at any phase, under any
approval. Binary content has no reviewable diff, so a confirmation dialog cannot describe what is
about to change — which makes informed consent impossible rather than merely inconvenient.

### 7.5 Engine commands are Tier 3

Agent-invoked engine commands, when they arrive, run through `toolApprovalManager` at the
`terminal-write` tier. Commands come from user-authored configuration or constants in source; a
webview supplies **data only, never a command string**.

`RunUAT` and Unity's `-batchmode` MUST NOT be added to the `terminalRun` auto-approve tier. They
accept arbitrary arguments, run for tens of minutes and write build output.

### 7.6 Consoles

AtlasMind MUST NOT bundle, require, probe for, or assert facts about console SDKs. Console platforms
are modelled as **declared targets with user-authored commands only**.

## §8 Degradation — every "we cannot tell"

The distinguishing behaviour of this feature is what it says when it does not know.

| Situation | Reported as | Never |
|---|---|---|
| No engine file found | `unknown` engine, project unchanged | `custom`, or a guess |
| Engine file found, version unreadable | Engine named, version `unknown`; version-dependent affordances withheld | A default version |
| Engine version outside verified range | "Not verified against this version" | Extrapolated flags |
| Content component under Perforce or `external` | `not-visible` | `0 assets` |
| No build log | "No verdict" plus the command to produce one | `0 errors` |
| No performance capture | "No verdict" | `0 ms`, or a passing budget |
| Asset scan truncated | The finding plus what was skipped and why | A total presented as complete |
| Bridge enabled, nothing connected | "No editor connected" | Last known state as current |
| Companion version older than AtlasMind's protocol | Refused, both versions named | Best-effort parsing |

## §9 Conformance

An implementation conforms when:

- [ ] A Unreal, Unity and Godot fixture each resolve to the correct engine and exact version.
- [ ] A project with an unreadable engine version withholds every version-dependent affordance.
- [ ] Every engine CLI fact in source sits behind a `*_VERIFIED_AT` constant.
- [ ] The bridge wire format contains no command frame, asserted by test.
- [ ] The bridge refuses an unauthenticated first frame and binds loopback only.
- [ ] No code path writes a binary engine asset.
- [ ] No engine binary path is sourced from a parsed project file.
- [ ] Engine-derived text reaching a model is fenced as REPORTED CONTENT, asserted by test.
- [ ] No compiled artifact exists in the shipped companion plugins.
- [ ] Every row of the §8 degradation table is covered by a test.
