# Guided GitHub Workflow — Phased Roadmap

> **Status:** Tier 1 shipped v0.181.0; Tier 2 shipped v0.183.0 (C3.4, C3.6 outstanding); Tier 3 CI intelligence shipped v0.184.0; **Tier 3.5 archetype specialisation shipped v0.185.0** (C7.4, C7.5 outstanding); **Tier 3 release half shipped v0.189.0 — C5.1 and C5.3 complete, so Tier 3's exit criteria are met**; **Tier 4 in progress — C1.1 and C1.7 shipped v0.190.0–v0.191.0, C1.6 shipped v0.192.0; C1.6 shipped v0.192.0, C6.1 shipped v0.193.0; **Tier 4 complete** — C1.1/C1.7 v0.190.0–v0.191.0, C1.6 v0.192.0, C6 v0.193.0–v0.195.0, C1.8 v0.196.0**. **Owner:** AtlasMind core. **Created:** 2026-07-28.
> This is the SSOT implementation plan for [`docs/guided-github-workflow.md`](../../docs/guided-github-workflow.md),
> which is the normative specification. Where the two disagree, the specification wins and this
> file is wrong. Build incrementally, respecting the entry criteria between tiers. Nothing here
> overrides AtlasMind's safety-first defaults: deny-by-default, sanitize-at-boundary,
> confirm-before-destructive-action.

## Context — why

AtlasMind shipped eighteen agents, a planner, a task scheduler, an issue tracker, a guarded
promotion engine, and a complete release-versioning engine — and no workflow. Nothing tells a
user *the order in which to do the work*, so every user assembles their own, and AtlasMind's
guidance about GitHub varies by which file happens to be read.

The repository proved the cost of that. Before the specification landed, nine documents described
this project's GitHub process. They disagreed on whether pull requests target `main` or `develop`,
whether reviews are required, and whether a release is driven from the Actions tab or a terminal.
Two cited CI workflow files that do not exist. Six asserted `project_memory/` was excluded from
`main` "enforced by `.gitignore`" while ninety of its files were tracked there.

The intended outcome is threefold, and the third is the one that differentiates:

1. **One canonical workflow**, expressed as committed data rather than prose, so it can be
   enforced and measured rather than remembered.
2. **A GitHub window** in the Project Dashboard — read *and* modify the issues, branches, pull
   requests, reviews, checks and releases a developer touches daily, without leaving the editor.
3. **A teaching surface.** Every stage and step carries a `?` affordance explaining *why this
   exists, how to do it, and what people get wrong*, written so a student can learn professional
   practice from it. No competing tool treats the workflow itself as the thing being taught.

## Separation of concerns — the governing contract

| Concern | Owner | Never |
|---|---|---|
| Identity and authentication to GitHub | The `gh` CLI, authenticated by the user | AtlasMind stores, logs, or transmits a token |
| What the workflow *is* | `project_memory/operations/workflow.json`, committed and reviewed | An agent edits it |
| Whether an action may run | The automation ladder — four gates, all defaulting closed | A file alone raises the ceiling |
| What command runs | A constant in source, or persisted user-authored config | A webview supplies a command string |
| Execution | `ghClient` (argv array, no shell) and existing git skills | A shell string interpolates untrusted text |
| The record | Append-only workflow history | An entry is deleted or rewritten |
| Reasoning about a failure | An agent, given fenced evidence | A model decides a classification |

The load-bearing line is the last one. Classification, naming, drafting and versioning are
**rule-driven and deterministic**; agents *explain* and *propose*, they do not *decide*. That is
what lets the dashboard chart a failure taxonomy over time and have the chart mean something.

## GitHub surface — ground truth (verify per release)

What AtlasMind actually does today, so every tier builds on facts rather than assumptions.

**One `gh` exec boundary** as of v0.182.0 — `src/core/ghClient.ts`, argv arrays only, no shell,
pinned by `tests/core/ghExecBoundary.test.ts`. It replaced three ad-hoc sites, one of which
(`bootstrapper.ts` repo creation) interpolated an **unvalidated GitHub owner** into a shell string.
`promotionRunner.ts` still composes a `gh workflow run` string, but as persisted user-authored
config executed through the promotion runner's own audited path — not spawned directly.

**Subcommands in use:** `gh repo view --json nameWithOwner`; `gh issue list/create/comment/close/reopen`;
`gh api repos/{slug}/branches/{b}/protection`; `gh api repos/{slug}/commits/{ref}/check-runs`;
`gh repo create`.

**Every tier of this roadmap is now shipped.** **Every item in this roadmap is now shipped.** Releases are read as of v0.189.0
(`gh release list`, plus local `git tag` and `git describe`), and the release *plan* is built entirely
from local files so it works with no `gh` at all; `gh release create` remains proposed. CI runs and failed logs are read as of v0.184.0 (`gh run list`, `gh run view --log-failed`),
classified by a rule table with no model in the path (`ciFailureAnalysis.ts`). Pull requests are read (v0.182.0) **and written**
(v0.183.0: `gh pr create/review/merge/close`, behind the ladder and a modal). Branch naming landed in
v0.182.0. The automation ladder itself — `min(master, ceiling, capability, stage)` — landed in
v0.183.0 as `workflowAutomation.ts`; before that the settings existed but nothing evaluated them.

**Already built and directly reusable:** `issueTracker.ts` (pure parse/sanitize/summarize plus the
untrusted-content prompt fence); `promotionRunner.ts` (`classifyBumpLevel`, `bumpVersion`,
`setPackageJsonVersion`, `insertChangelogEntry`, `compareSemver`, the five-gate
`evaluatePromotionGate`, `applyPromotionRemediation` which never pushes or tags);
`deliveryManager.ts` (single-flight lock, append-only history, the JSON+mirror persistence
pattern); `testingPolicyCoverage.ts` (`parseJUnitReport` and the no-report-no-verdict contract);
`setupWalkthrough.ts` (the step model, pure and tested, with **no webview consumer yet**).

**Dashboard render primitives already available** — the instrumentation wall invents nothing:
`renderChartCard` (time series with period-over-period trend deltas), `renderDonutChart`,
`renderDistributionBar`, `renderMetricPill`, `renderFlowStrip`, `renderScoreRing`,
`renderPipelineFlow`, `renderVersionStrip`, `renderWorkMixCharts`.

---

## Tier 1 — the workflow engine, the guide, and the instruments  ✅ **SHIPPED v0.181.0**

**Entry criteria:** none. **Exit criteria:** a user can open the Workflow page, learn the whole
workflow from it, and see real numbers about their repository — with AtlasMind having written
nothing to GitHub.

### C1 — Workflow Engine & Configuration

#### C1.1 — The workflow configuration model  ✅ shipped v0.190.0, completed v0.191.0

> **Correction.** This item was recorded as shipped in Tier 1 (v0.181.0) and was not. No
> `workflowConfig.ts` existed; `workflowConfigPresent` was hardcoded `false` in the dashboard, so the
> curriculum's "declare your workflow" step could never be completed by anybody — a permanently open
> gap, which is precisely the failure mode the archetype packs are written to avoid ("a dashboard
> with a permanent false gap teaches people to ignore gaps"). `integrationBranch` and
> `protectedBranches` were likewise hardcoded to *this repository's* branch names, so every other
> project was taught a workflow naming branches it does not have. Found while building C1.7, which
> needs this model to have something to edit.
>
> **Second correction (v0.191.0).** The v0.190.0 model implemented most of specification §4.2 and
> not all of it. Missing: `command` (whose rule the module header *cited* while the field did not
> exist), the categorised label taxonomy, `testing.inherit`, `testingOverrides`, and any check that
> `ownerAgentId` resolves. A schema described in the specification and half-built in the
> implementation is the same class of problem as an item marked shipped that was never built, one
> layer down.

- **Purpose:** Make the workflow data a team owns and reviews, rather than prose that drifts.
- **Expected behaviour:** Seed `workflow.json` + `workflow.md` mirror from a profile; sanitize on read; refuse a document written by a newer AtlasMind rather than overwriting it; preserve unknown fields on rewrite.
- **Agents involved:** none — a pure module.
- **GitHub API usage:** n/a.
- **Deterministic output requirements:** Same input config ⇒ byte-identical mirror. `managed: true` entries may be disabled, never deleted. `command: ''` is a blocker, not a default.
- **Priority:** High

#### C1.2 — The automation ladder

- **Purpose:** Make "full automation is possible, never default" true by construction.
- **Expected behaviour:** `effective = min(master, ceiling, capability, stage)` across five rungs. Six deny-by-default settings; hard ceilings no file can raise.
- **Agents involved:** none — policy.
- **GitHub API usage:** n/a.
- **Deterministic output requirements:** Pure function of four inputs; exhaustive test over the rung lattice pinning that every non-ideal branch denies.
- **Priority:** High

#### C1.3 — The shared `gh` runner (`ghClient.ts`)

- **Purpose:** One exec boundary instead of three ad-hoc ones, including the single shell-based call.
- **Expected behaviour:** argv array, never a shell string; per-call timeout and output cap; classify failure as not-installed / not-authenticated / rate-limited / other, each with the command that fixes it.
- **Agents involved:** none.
- **GitHub API usage:** all of it — this is the boundary.
- **Deterministic output requirements:** A test asserts no call site passes a shell metacharacter and no argument is user-interpolated into a command string.
- **Priority:** High

#### C1.4 — The teaching curriculum (`workflowCurriculum.ts`)

- **Purpose:** The `?` content — why each step exists, how to do it, what people get wrong — as pure data so it is reviewable and testable rather than buried in markup.
- **Expected behaviour:** Extends the existing `SetupStep` model with `why`, `how[]`, `commonMistakes[]`, `glossary[]`, `proficiency`. Derived from observed state; never model-generated.
- **Agents involved:** none.
- **GitHub API usage:** n/a.
- **Deterministic output requirements:** Every stage has non-empty `why` and `how`; every glossary reference resolves; step order matches the specification's stage order. All three pinned by test.
- **Priority:** High

#### C1.5 — The Workflow dashboard page

- **Purpose:** The surface. Guide, GitHub window, and instrument wall in one place.
- **Expected behaviour:** Three bands — guide, repository control, instrumentation. Help disclosures keep open/closed state across re-render via module state, **not** native `<details>`. Keyboard focus survives a toggle. Empty states explain the feature rather than reporting emptiness.
- **Agents involved:** none — a render surface.
- **GitHub API usage:** read-only in this tier, loaded on demand only.
- **Deterministic output requirements:** A nav badge appears only once data was actually loaded. CI with no report reads "no verdict", never "0 failing".
- **Priority:** High

### C2 — Issue & Planning Automation

#### C2.1 — Issue intake drafting

- **Purpose:** Remove the two steps people skip — labelling from the taxonomy, and writing acceptance criteria.
- **Expected behaviour:** Derive an `IssueDraft` from a roadmap item. At `draft` shown only; at `propose` created after a modal naming repo and action.
- **Agents involved:** `github-operator` (owner), Planner **service**.
- **GitHub API usage:** `gh repo view --json nameWithOwner`, `gh issue list --json …`, `gh issue create --title --body --label`.
- **Deterministic output requirements:** Labels drawn only from the declared taxonomy — an unmatched label is dropped, never invented. Same item + taxonomy ⇒ byte-identical draft. Secret-shaped token ⇒ blocked, not redacted.
- **Priority:** High

#### C2.2 — Issue metrics

- **Purpose:** Make intake health visible: what is unassigned, what is ageing, where the work is concentrated.
- **Expected behaviour:** Open-by-label and open-by-assignee donuts, an age-distribution bar, stale count at the declared threshold.
- **Agents involved:** none.
- **GitHub API usage:** `gh issue list --json` (already parsed by `parseGhIssueList`).
- **Deterministic output requirements:** All derivations pure over the parsed issue set; unit-tested against fixtures.
- **Priority:** Medium

---

## Tier 2 — branches and pull requests  ✅ **SHIPPED v0.182.0–v0.201.0**  ✅ **complete**

**Entry criteria:** ✅ met in v0.182.0 — Tier 1 shipped, and `ghClient` is now the only `gh` exec path (pinned by `tests/core/ghExecBoundary.test.ts`).
**Exit criteria:** a pull request can be drafted, opened, reviewed and merged from the dashboard,
with every write gated.

### C3 — Branch & Pull-Request Automation

#### C3.1 — Branch-name derivation

- **Purpose:** Remove the most common source of unfilterable branch history — hand-typed names.
- **Expected behaviour:** `deriveBranchName({type, issueNumber, title, convention})`. At `draft` shown; at `propose` created from the integration branch.
- **Agents involved:** `github-operator`.
- **GitHub API usage:** `gh api repos/{slug}/branches/{base}/protection` to confirm the base permits it. Naming itself needs none.
- **Deterministic output requirements:** Pure and idempotent; ASCII-slugged; length-capped at a word boundary; collisions resolved by ordinal suffix, never a hash or timestamp; incapable of producing a protected name; rejects the existing invalid character set. Empty slug ⇒ blocked and asks, never a generated id.
- **Priority:** High

#### C3.2 — Pull-request draft synthesis

- **Purpose:** Remove the two most-skipped pull-request steps — writing the body and linking the issue — without letting a model author the title.
- **Expected behaviour:** Given head and base, emit a `PullRequestDraft`. At `draft` shown; at `propose` created after a modal; at `auto` created only when the base is unprotected.
- **Agents involved:** `github-operator` (owner), `code-reviewer` (advisory).
- **GitHub API usage:** `gh pr create --base --head --title --body`, `gh pr list --json number,title,state,headRefName,createdAt,mergedAt,reviews`, `gh pr view --json`.
- **Deterministic output requirements:** Title from `classifyBumpLevel` over the commit range — reuse, never a second commit parser. Body a fixed-order template fill. Same range + template ⇒ byte-identical draft. No model in the path.
- **Priority:** High

#### C3.3 — `pullRequestTracker.ts` — the untrusted-input boundary

- **Purpose:** Pull-request bodies and review comments are the same third-party attack surface as issue bodies, and today nothing sanitizes them because nothing reads them.
- **Expected behaviour:** Pure parse and sanitize mirroring `issueTracker.ts` exactly — control-strip, clamp, cap counts, drop non-`https` links, never throw. Plus `buildPrReviewPrompt` fencing review text as reported content.
- **Agents involved:** consumed by `code-reviewer`, `security-reviewer`.
- **GitHub API usage:** `gh api repos/{slug}/pulls/{n}/reviews`, `.../comments`.
- **Deterministic output requirements:** Total function — malformed input degrades to typed `unknown`, never an exception. A test asserts a review body containing an instruction cannot escape the fence.
- **Priority:** High

#### C3.4 — Review ingestion and the address-feedback loop  ✅ shipped v0.200.0

- **Purpose:** Close the loop from a review comment to a fix.
- **Expected behaviour:** Findings render as structured records with a file button; "address this" opens a scoped chat with the comment fenced.
- **Agents involved:** `code-reviewer`, `security-reviewer`, `github-operator`.
- **GitHub API usage:** `gh pr review --approve|--request-changes|--comment`, `gh pr diff`, `gh pr checks`.
- **Deterministic output requirements:** Findings are `{path, line, severity, ruleId}` — never free prose posted to a pull request.
- **Priority:** Medium
- **As shipped:** `parseGhReviewComments` + `buildReviewCommentPrompt`, with each comment rendered as a
  record carrying a file button and an "Address this one" action. **Nothing is posted back** — the
  specification's `{path, line, severity, ruleId}` requirement was about AtlasMind *writing* a review, and
  the ingestion direction only reads; the prompt explicitly forbids replying on the pull request. The path
  is traversal-checked because it arrives from a third party and becomes a file somebody clicks, and an
  untrusted one is emptied rather than rewritten, with the comment still shown.

#### C3.5 — Pull-request metrics

- **Purpose:** The numbers that reveal review health: how long work waits, and how big it is when it arrives.
- **Expected behaviour:** Throughput over time, median time-to-first-review, median time-to-merge, size distribution, review depth.
- **Agents involved:** none.
- **GitHub API usage:** `gh pr list --json createdAt,mergedAt,reviews,additions,deletions`.
- **Deterministic output requirements:** Medians over a declared window with a declared tie rule; a window with too few samples reports "not enough data", never a misleading single-sample median.
- **Priority:** Medium

#### C3.6 — Labels and milestones  ✅ shipped v0.201.0

- **Purpose:** Let the taxonomy the workflow depends on be managed where it is used.
- **Expected behaviour:** List, create, edit, delete labels; list, create, close milestones. Every write modal-gated.
- **Agents involved:** `github-operator`.
- **GitHub API usage:** `gh label list/create/edit/delete`, `gh api repos/{slug}/milestones`.
- **Deterministic output requirements:** A label deletion names every issue that will lose it, before confirming.
- **Priority:** Low
- **As shipped:** `labelRegistry.ts` + a card on the Issues tab. The naming requirement is met from the
  issue list already on screen, so it costs no request — and where that list was never loaded the dialog
  **says so rather than reporting zero**, because "nothing uses this" and "we did not look" lead to
  opposite decisions. Two additions the specification did not ask for and the surface needed: a colour is
  **validated to six hex digits or dropped** (it reaches a style attribute), and a milestone is **closed,
  never deleted** — deleting one detaches every issue from it silently.

---

## Tier 3 — CI intelligence and release automation  ✅ **SHIPPED v0.184.0–v0.189.0**  *(C5.2 outstanding — fixed in docs, not yet in scripts)*

**Entry criteria:** Tier 2 shipped. **Exit criteria:** a red build explains itself with evidence,
and a release can be prepared from the dashboard.

### C4 — CI Intelligence

#### C4.1 — Run and log retrieval

- **Purpose:** AtlasMind reads check *states* today and has never read a *log*. That is the difference between knowing a job failed and knowing why.
- **Expected behaviour:** List runs, fetch jobs, fetch failed-step logs on demand. Never polled on a timer.
- **Agents involved:** `ci-analyst`.
- **GitHub API usage:** `gh run list --json`, `gh api repos/{slug}/actions/runs/{id}/jobs`, `gh run view <id> --log-failed`.
- **Deterministic output requirements:** Logs size-capped, control-stripped and secret-redacted before display or prompt. Truncation is marked, never silent.
- **Priority:** High

#### C4.2 — The failure classification rule table

- **Purpose:** A taxonomy that varies run to run cannot be charted, and a chart of CI failures is one of the most useful things a team can look at.
- **Expected behaviour:** Ordered first-match-wins over log text: `dependency-install → compile → lint → test-failure → timeout → flake-suspect → infra → unknown`.
- **Agents involved:** `ci-analyst` explains the result; it does not choose it.
- **GitHub API usage:** consumes C4.1.
- **Deterministic output requirements:** **No model in the path.** Same log bytes ⇒ same classification, pinned by fixture tests per class. `unknown` escalates to a human and is never guessed. No automatic re-run and no automatic workflow-file edit at any rung.
- **Priority:** High

#### C4.3 — CI metrics

- **Purpose:** Make pipeline health a trend rather than a snapshot.
- **Expected behaviour:** Pass rate over time, per-check breakdown, failure-taxonomy donut, mean time to green, flake suspects.
- **Agents involved:** none.
- **GitHub API usage:** consumes C4.1 and existing check-runs.
- **Deterministic output requirements:** Inherits the no-report-no-verdict contract — a missing report is stated as missing with the command that produces one, never rendered as zero.
- **Priority:** Medium

#### C4.4 — The `ci-analyst` agent

- **Purpose:** Give stage 5 an owner whose rubric already demands citing the failing job or log evidence.
- **Expected behaviour:** Explains a classified failure, names the likely owning agent, proposes a fix. Never re-runs, never edits a workflow.
- **Agents involved:** itself.
- **GitHub API usage:** none directly.
- **Deterministic output requirements:** Ships with `primaryRoutingNeeds` omitted and `skills: []`, addressed by `stages.ci.ownerAgentId`. Its role and description must avoid the reserved routing vocabulary — pinned by test.
- **Priority:** Medium

### C5 — Release Automation

#### C5.1 — Release preparation  ✅ shipped v0.189.0

- **Purpose:** The hard parts already exist and are pure; what is missing is a path AtlasMind can drive.
- **Expected behaviour:** Classify the bump, apply it, write the changelog entry, verify monotonicity, present the plan against the five gates.
- **Agents involved:** `release-manager` (owner), `github-operator`, `docs-writer`.
- **GitHub API usage:** `gh release create <tag> --notes-file --title`, `gh release view`.
- **Deterministic output requirements:** Reuses `classifyBumpLevel` / `bumpVersion` / `setPackageJsonVersion` / `insertChangelogEntry` / `compareSemver` unchanged. **Release notes are the changelog section verbatim — never model-generated.** Remediation never pushes, tags, or force-pushes.
- **Priority:** High
- **As shipped:** `releasePreparation.ts` — seven ordered gates where **`unknown` is not a pass**, and a **secret in the notes refuses the release rather than being redacted out of it** (the inverse of the inbound rule, because these notes are outbound and permanent). The plan is built from local files only, so it is useful with no `gh` at all. Building it also exposed a check that could not fail: `changelogHasCurrentVersion` was derived from *the file existing*, so the most commonly missing thing at release time was reported present on every repository that had ever written a changelog.

#### C5.2 — Fix the double-publish chain

- **Purpose:** `publish:release` runs `vsce publish && tag:release`; the pushed tag triggers `publish.yml`, which runs `publish:release` **again** and fails on "version already exists". Following the documented step 7 causes it.
- **Expected behaviour:** Either add the missing tag workflow, or drop the `&& npm run tag:release` chain so local and CI paths cannot both publish. Documented as an interim in the specification; this item is the code fix.
- **Agents involved:** `devops-engineer`.
- **GitHub API usage:** n/a.
- **Deterministic output requirements:** Exactly one publish attempt per version, from exactly one place.
- **Priority:** Medium

#### C5.3 — Release and delivery metrics (DORA)  ✅ shipped v0.189.0

- **Purpose:** The four keys are the standard professional framing, which makes them the right thing to teach as well as to measure.
- **Expected behaviour:** Deployment frequency, lead time for change (issue → merge), change failure rate, time to restore. Plus version/changelog drift and conventional-commit conformance.
- **Agents involved:** none.
- **GitHub API usage:** `gh release list --json`, `gh pr list --json mergedAt`, run conclusions.
- **Deterministic output requirements:** Each metric declares its window and its inclusion rule on the card. Change-failure detection uses a declared revert/hotfix rule, not inference.
- **Priority:** Medium
- **As shipped:** `deriveDoraMetrics` in `workflowMetrics.ts`. Lead time is **merge → release** — the half a team can act on, and the half squash-merging does not destroy — with unshipped merges *excluded* rather than counted as infinitely slow. The failure rule is `DECLARED_CHANGE_FAILURE_RULE` (a patch release within 48 hours), shown wherever the number is and applied literally; a minor or major follow-up is a planned release, not a remediation. Every counted release is named on the surface so the number can be argued with.

---

## Tier 3.5 — archetype specialisation  ✅ **SHIPPED v0.185.0**  *(complete as of v0.197.0)*

**Entry criteria:** Tier 3's CI half shipped. **Exit criteria:** the workflow specialises by project
shape, and the shape is declarable at bootstrap and changeable afterwards.

**Why this had to land before Tier 4.** Tier 4 builds the `workflow.json` editing UI. Building that
against a schema missing its most important personalisation dimension would mean building it twice.

**The problem it fixed.** "What kind of project is this?" had *three* answers that disagreed: a
twelve-option bootstrap picker whose value fed a single regex, `testingScaffolder`'s seven-value
`Archetype`, and `deliveryManager`'s four-value `DeliveryArchetype`. Games were the clearest
casualty — detected from `phaser`/`bevy`/`pygame`, **never acted on** (`archetype === 'game'`
appeared zero times in any output branch), not selectable at bootstrap at all, and shipped as
`generic`. That is the same failure this specification exists to fix, in a different dimension.

### C7 — Archetype specialisation

#### C7.1 — One vocabulary  ✅ shipped v0.185.0

- **Purpose:** Replace three disagreeing notions of project shape with one.
- **Expected behaviour:** `ProjectArchetype` (9 values) plus composable `ArchetypeTrait`s. Detection from manifests is a *suggestion*; the declaration decides. Forward-mapping functions retire the other two vocabularies.
- **Agents involved:** none — pure.
- **GitHub API usage:** n/a.
- **Deterministic output requirements:** Detection reports `confident: false` when nothing matched, so "generic project" and "we could not tell" stay distinct. An unrecognised legacy value maps to `undefined`, never silently to `generic`. **No schema migration was needed** — `delivery.json` never persisted an archetype.
- **Priority:** High

#### C7.2 — Archetype packs  ✅ shipped v0.185.0

- **Purpose:** Declare, per shape, what differs across the six axes: CI steps, release model, testing strategy, documentation, refactor heuristics, workspace intelligence.
- **Expected behaviour:** Packs are data in source — reviewable in a diff, testable without a workspace, overridable per item. Traits add to a pack and never contradict it.
- **Agents involved:** consumed by `refactorer` (heuristics) and `ci-analyst` (expected steps).
- **GitHub API usage:** n/a.
- **Deterministic output requirements:** Every recommendation carries a rationale; every discouragement carries a reason. A pack never recommends a methodology the shape cannot produce evidence for — an unclosable gap teaches people to ignore gaps.
- **Priority:** High

#### C7.3 — Declarable and changeable  ✅ shipped v0.185.0

- **Purpose:** Bootstrap declares the shape; the dashboard shows it and allows changing it.
- **Expected behaviour:** A **Game** option in the bootstrap picker (previously impossible); `atlasmind.workflow.archetype` and `.traits` settings; a Project shape card on the Workflow page showing declared, detected, and any disagreement.
- **Agents involved:** none.
- **GitHub API usage:** n/a.
- **Deterministic output requirements:** Where detection and declaration disagree, both are shown and the declaration wins — a deliberate declaration is a decision, not a mistake.
- **Priority:** High

#### C7.4 — Wire packs into the testing scaffolder  ✅ shipped v0.197.0

- **Purpose:** `testingScaffolder` still carries its own recommendation logic and still does nothing with `game`. The packs now hold that knowledge; the scaffolder should read it.
- **Expected behaviour:** Scaffold output derives from `archetypePack(...).testing` rather than local branching, so a shape's recommendations live in exactly one place.
- **Agents involved:** `test-developer`.
- **GitHub API usage:** n/a.
- **Deterministic output requirements:** Non-destructive as today — starter files written only when absent, manifests never mutated.
- **Priority:** Medium
- **As shipped:** `toProjectArchetype` — which the scaffolder's own comment had described for two
  versions without it existing — plus `archetypeTestingModel`, so the playbook reads the packs rather
  than restating them. `game` acts on something for the first time: a determinism test instead of a
  Playwright page test, a frame budget instead of a k6 load script. Building it caught a recipe emitting
  TypeScript annotations into a `.js` file, now pinned by a test over every Node recipe.

#### C7.5 — Archetype-aware CI scaffolding  ✅ shipped v0.197.0

- **Purpose:** `/bootstrap` scaffolds one generic `ci.yml` regardless of shape. The packs declare what each shape's pipeline needs.
- **Expected behaviour:** Scaffolded CI includes the archetype's required steps, each as a commented, quoted suggestion the user completes — never a command AtlasMind invented and runs.
- **Agents involved:** `devops-engineer`.
- **GitHub API usage:** n/a.
- **Deterministic output requirements:** Same shape + same traits ⇒ same scaffold. Existing files are never overwritten.
- **Priority:** Medium
- **As shipped:** two halves, different in kind. Generic Node steps stay **real commands** (the manifest
  says the scripts exist); archetype steps are **commented suggestions with their rationale**, because
  AtlasMind knows a game wants a determinism gate without knowing this project's command for one, and a
  guess that fails on the first commit teaches people to delete the file. `archetypeFromProjectTypeLabel`
  closes the gap that made all of this unreachable: the bootstrap picker shows prose, `normalizeArchetype`
  takes ids, and every chosen shape was resolving to `generic`. The trigger no longer names `master` — not
  the default of any repository created since 2020, and not this project's.

---

## Tier 4 — maintenance, tech-debt, and unattended operation

**Entry criteria:** ✅ Tiers 1–3 shipped as of v0.189.0. The audit record (C1.6) is itself a Tier 4 item, so it is proven *by* this tier rather than before it. **Exit criteria:** a team can
raise a stage to `propose` or `auto` and have the record show exactly what was done and why.

### C6 — Maintenance & Tech-Debt

#### C6.1 — The debt register  ✅ shipped v0.193.0

- **Purpose:** A solo developer has no colleague who remembers the shortcut, and a studio has no shared memory of it either.
- **Expected behaviour:** Append-only `{id, domain, evidencePath, evidenceLine, detectedAt, severity, status}` in JSON with a markdown mirror. Entries transition; they are never deleted.
- **Agents involved:** `refactorer` (owner), `dependency-manager`, `docs-writer`.
- **GitHub API usage:** `gh issue list --label`, `gh issue comment`, `gh pr list --author app/dependabot`.
- **Deterministic output requirements:** **Severity from a declared rule table, not a model score** — a score produced last week is not comparable with one produced today, and comparability is the register's entire value. Stable sort on `(severity, detectedAt, id)`.
- **Priority:** Medium
- **As shipped:** `debtRegister.ts` + a Tech Debt page. Severity is fixed by the rule at detection and **does not drift with age** — the obvious escalate-over-time feature fails the same comparability test the rule table exists to pass. `resolved` and `obsolete` are kept distinct because "somebody did the work" and "the evidence vanished" are different facts. Running the scanner over this repository found **29 false positives and zero real markers**, which produced the rule that a marker only counts when it *opens a comment*: markers in strings, templates and regexes are data, and markers discussed in prose are documentation.

#### C6.2 — The `refactorer` agent and a `debt` risk domain  ✅ shipped v0.195.0

- **Purpose:** Give deferred work an owner. The risk register's domains are ethics/legal/commercial only; debt has nowhere to live.
- **Expected behaviour:** Proposes refactors from register entries. Records; never applies below `propose`.
- **Agents involved:** itself.
- **GitHub API usage:** n/a.
- **Deterministic output requirements:** Same routing-neutrality constraints as C4.4.
- **Priority:** Low
- **As shipped:** `buildDebtWorkPrompt` + a "Look at it with Atlas" action on each entry. The `debt` risk
  domain was **not** added — see open question 5, answered at C6.1. The prompt's fence inverts the usual
  one: a debt entry is not untrusted third-party text, so the risk is not that the text is hostile but
  that the agent reads a deferred decision as a mandate. "Worth keeping, with the reason it was the right
  call" is therefore a first-class answer, and the button says *look at it* rather than *fix it*.

#### C6.3 — Maintenance sweep and metrics  ✅ shipped v0.194.0 *(on-demand; no scheduler)*

- **Purpose:** Make deferral visible as it ages, rather than at the point it becomes urgent.
- **Expected behaviour:** Scheduled or on-demand sweep over stale issues, stale documents, dependency pull requests, coverage gaps and integration drift. Never auto-closes, never auto-merges.
- **Agents involved:** `refactorer`, `dependency-manager`, `docs-writer`.
- **GitHub API usage:** as C6.1.
- **Deterministic output requirements:** Register ageing, by-domain breakdown, new-versus-resolved trend — all pure over the register.
- **Priority:** Low
- **As shipped:** `deriveDebtFromSignals` folds four unwritten signals into the register on the same explicit scan. **No scheduler** — a sweep on a timer would write to a tracked file while nobody was looking, and this repository's own rule is that `project_memory/` changes arrive as reviewable diffs. Auditing the fields this needed found four more `WorkflowObservedState` bugs (below).

### C1 (continued) — unattended operation

#### C1.6 — The workflow audit record  ✅ shipped v0.192.0

- **Purpose:** Make every other stage's determinism claim verifiable rather than aspirational.
- **Expected behaviour:** Append a `WorkflowRunRecord` per transition with `inputsFingerprint`, `outputsFingerprint`, gate results, actor and effective level. A stage that cannot write its record does not proceed.
- **Agents involved:** Orchestrator service; `memory-agent` for the SSOT surface.
- **GitHub API usage:** n/a.
- **Deterministic output requirements:** Two runs with the same `inputsFingerprint` must produce the same `outputsFingerprint`; a mismatch names the stage and both runs.
- **Priority:** High
- **As shipped:** `workflowAuditRecord.ts` + `runRecorded`/`recordRefusal` on the dashboard panel. Wired into issue writes, pull-request writes and their refusals. Building it found a **dead safety switch**: `atlasmind.workflow.allowIssueWrites` was documented and nothing consulted it, so a user could turn it off believing it stopped issue writes. Issue writes now take the same ladder gate pull-request writes have had since v0.183.0 — a behaviour change, and a deliberate one: a false assurance is worse than no switch.

#### C1.7 — Workflow configuration editing UI  ✅ shipped v0.190.0

- **Purpose:** Let a team change its workflow where it reads it, and see the diff it will commit.
- **Expected behaviour:** Edit stages, rungs, checks and taxonomy. Shows the resulting diff before writing. Cannot delete a `managed` entry.
- **Agents involved:** none — **no agent may edit this file.**
- **GitHub API usage:** n/a.
- **Deterministic output requirements:** Round-trips unknown fields; refuses a newer-version document rather than overwriting it.
- **Priority:** Medium
- **As shipped:** A card on the Workflow page. The file is **never created implicitly** — every other persisted document seeds on first read, and this one deliberately does not, because it gets committed and writing one because somebody opened a tab would put words in their mouth in a file others review. Every edit is one field whose exact change the host lists in a `{modal:true}` confirmation before writing, since the person clicking the button and the person reading the pull request need to be looking at the same thing. Refusals are reported, not silent.

#### C1.8 — A first-class handoff tool  ✅ shipped v0.196.0

- **Purpose:** Handoff today is structural (`dependsOn` + role) and prose. The specification says so honestly; this closes it.
- **Expected behaviour:** A built-in tool letting a subtask transfer control to a named agent with scoped context, recorded in the audit trail.
- **Agents involved:** all.
- **GitHub API usage:** n/a.
- **Deterministic output requirements:** A handoff is a recorded event with a named source and target; delegated execution never implies delegated authorization.
- **Priority:** Low
- **As shipped:** option 2 — real delegated execution, chosen deliberately over the record-only version.
  `agentHandoff.ts` holds the policy; `SkillExecutionContext.runAgent` is the seam; the orchestrator
  supplies execution. "Delegated execution never implies delegated authorization" is implemented as
  `intersection(caller, target)`, never the union, with an exhaustive subset-lattice test. The caller's
  identity comes from `currentExecution` rather than a tool argument, and carries *resolved* skills — a
  planner subtask is ephemeral and absent from the registry, so a lookup by id would have refused every
  handoff a subtask ever made, for a reason that looked like policy.

---

## C1.8 — the decision, and what followed

Two readings of "handoff" were on the table: a recorded request (no orchestrator change, small, and at
risk of being a tool that returns "recorded" while nothing happens) or real delegated execution. **The
decision was real delegated execution**, and it needed all four of the things that made it the larger
option: a `runAgent` seam on `SkillExecutionContext`, re-entrancy handling, a depth cap, and an
authorization rule.

The authorization rule is the one that mattered. **`intersection(caller, target)`, never the union.**
The appealing alternative — that handing off to a specialist gives you the specialist's tools — is
exactly what would turn every restriction in the system into a suggestion, and privilege escalation by
delegation is a classic precisely because the escalating step always looks reasonable in isolation.

Building it surfaced one bug the policy alone would not have caught: a planner subtask runs as an
ephemeral agent that is **not in the registry**, so resolving the caller's ceiling by id would have
returned an empty set and refused every handoff a subtask ever made — with a message that read like
policy and was actually a missing record. The caller's resolved skills are now carried on
`currentExecution` rather than looked up.

## The `WorkflowObservedState` audit — a bug class, recorded

Four versions running, a field the curriculum reads turned out never to have been supplied. Each time
the symptom was the same: **the guide asks somebody to do something and then refuses to notice that
they did.**

| Field | What it did | Fixed |
|---|---|---|
| `workflowConfigPresent` | Hardcoded `false` — "declare your workflow" uncompletable by anybody | v0.190.0 |
| `changelogHasCurrentVersion` | Derived from the *file existing*, so the commonest release-time omission always read as present | v0.189.0 |
| `hasDebtRegister` | Hardcoded `false` — "record what you deferred" uncompletable | v0.193.0 |
| `ciStatus` | Hardcoded `'none'` — a project with a green build told it had no check runs | v0.194.0 |
| `openDependencyPrCount`, `staleDocumentCount`, `requiredApprovers` | Never assigned at all | v0.194.0 |
| `unassignedIssueCount`, `hasTestFiles`, `openPullRequestCount` | Declared and read by nothing — removed | v0.194.0 |

`tests/views/observedStateCoverage.test.ts` now enforces three properties against the real source,
because none of them is expressible in the type system: every field a step reads is assigned
somewhere; no field describing the user's repository is assigned a bare literal (a constant is a
*confident false statement*, which is worse than a missing one); and no field is declared that no
step reads (a dangling field reads as deliberate to the next person).

## Cross-cutting safety invariants (inherit for every tier)

1. **Deny by default.** Every capability ships `false`; every stage ships `observe`. Four gates
   guard each rung and all default closed.
2. **Server-sourced commands.** A surface may trigger and attest; it may never supply a command
   string. Every executed command is a constant in source or persisted user-authored config.
3. **No stored credential.** AtlasMind shells to an already-authenticated `gh`. There is no token
   setting and there will not be one.
4. **Sanitize at the boundary.** Issue bodies, pull-request bodies, review comments, CI logs and
   fetched docs are untrusted: control-stripped, secret-redacted, capped, and fenced as reported
   content before reaching a prompt.
5. **Never force.** No force-push, no tag deletion, no release deletion, at any rung.
6. **Never silently.** Truncation is marked. A missing report is stated, never rendered as zero.
   A dropped label is reported. A blocked action says which gate and why.
7. **Append-only.** Records transition; they are never deleted or rewritten.
8. **Rules decide, agents explain.** Classification, naming, drafting and versioning are
   deterministic. Agents propose and explain; they do not choose the outcome.
9. **Honesty about determinism.** Where a step cannot be reproducible — LLM decomposition — say so
   on the surface rather than implying a guarantee.

## Open questions — decisions owed

1. **Does `workflow.json` ship as a specimen or only on first use?** Current call: create it with
   `status: 'specimen'` and a mirror stating no version reads it yet, so the schema has a real,
   diffable example at the real path. Revisit if unread config proves confusing.
2. **`RoutingNeedId` is a closed 18-value enum.** The three new agents therefore ship
   routing-neutral. If a later version wants them routable, extending the enum is four coupled
   sites, and `github-operator` would need narrowing from `['git','devops','release']` to `['git']`
   in the same change or `release` becomes a three-way contest.
3. **How much CI history is worth fetching?** Log retrieval is rate-limited and slow. Current call:
   on demand only, for the failing run in view. A trend chart wants more.
4. **Should the studio profile enforce distinct approvers by identity or by account?** Identity
   comparison catches the same human with two accounts; account comparison is simpler and wrong.
5. **Does the debt register belong in the risk register instead?** ~~Current call: separate, revisit at
   C6.1.~~ **Answered at C6.1: separate.** The risk register's domains are ethics, legal and commercial
   — read-only oversight of *exposures*, raised by advisors. Debt is engineering work somebody chose
   to defer, and it transitions through `accepted` and `scheduled`, which are not things a risk does.
   Sharing a store would have meant one vocabulary serving two questions, which is the failure the
   archetype work spent a whole tier undoing.
6. **Where does `/workflow` as a chat command fit?** The dashboard is the primary surface. A chat
   command would need a `KNOWN_SLASH_COMMANDS` entry and a walkthrough renderer; deferred until the
   page proves the model.
