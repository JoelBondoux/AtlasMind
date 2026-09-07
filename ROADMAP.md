# AtlasMind Roadmap

**Positioning being tested:** *a producer's console for software built by AI agents — the plan, the
risk, the people and the cost, in your repo, next to the code.*

**Constraints this roadmap obeys:** closed beta, no customers, free product, no hosting budget, no
analytics. Every item runs entirely on the user's machine. The question each item answers is: *does
this help a first user install, understand the value, and stay?*

---

## Where the roadmap lives

There are three files and they do different jobs. Nothing here replaces the other two.

| File | What it is | Touched by this rewrite |
|---|---|---|
| `project_memory/roadmap/improvement-plan.md` | **The live backlog.** ~40 items, machine-parsed by the Project Dashboard, with durable `<!-- rm:id -->` anchors, `#mvp` gates and drag-order priority | **No.** Reformatting it into the item shape below would break the parser and destroy every anchor |
| `docs/roadmap.md` | Human-facing narrative of feature areas (Lens, prefab packs, game engines). Prose, not items | No |
| `ROADMAP.md` *(this file)* | **Strategic sequencing** — what to do next and why, in three horizons | Yes, new |

The backlog stays the record of *everything outstanding*. This file says *what to do first*. When an
item here is accepted, it should get a line in the backlog so the dashboard can see it.

---

## What the code says

Written before proposing anything, and it changes the sequencing in two places.

### Can we do counterfactual pricing today? Partly — and not the way the report describes

`CostRecord` (`src/types.ts`) persists `model`, `providerId`, `inputTokens`, `outputTokens`,
`cachedInputTokens`, `costUsd`, `timestamp`, plus `taskId`, `agentId`, `sessionId` and `messageId`.
That is most of what re-pricing needs.

Three problems, in order of severity:

1. **Cache writes are not captured.** `cachedInputTokens` is documented as "the portion of
   `inputTokens` served from the provider's prompt cache" — that is the cache **read**. Cache
   *writes* are priced differently by every major provider, and the report's method explicitly says
   "preserving the cache read/write split". We can preserve the read half. We cannot preserve the
   split. Given the report's own note that one tracker measured 95.2% of tokens as cache reads, this
   is not a rounding error.
2. **Cost history is in VS Code `globalState`, capped at 500 records** (`costTracker.ts`:
   `attachStorage(context.globalState)`, `MAX_PERSISTED_RECORDS = 500`). So retroactive re-pricing
   reaches back 500 requests and no further, and the data is not in the repo.
3. **There is no project field.** `CostRecord` has no `workspaceKey`. Because storage is *global*,
   spend from every project on the machine is in one undifferentiated list. Per-project cost
   attribution (gap C7) is not "not built" — it is currently **impossible to compute**, even
   retroactively.

**Consequence for sequencing:** counterfactual pricing is going-forward only, and the data-model
change is a prerequisite rather than part of the feature. That is `NOW-1`.

### Can we attribute cost to a roadmap item? Half the join already exists

This is the feature you said you care most about, so the detail matters.

- `CostRecord` carries `sessionId` and `messageId`.
- `ProjectRunRecord` (`projectRunHistory.ts`) carries `workspaceKey`, `chatSessionId`,
  `chatMessageId` — **and `ideationOrigin`**, which is provenance pointing back at an ideation card.

So **cost → run is already joinable**. What is missing is **run → roadmap item**: no run, mission or
chat session carries a roadmap id.

**The smallest change that creates the join key** is to add an optional `roadmapItemId` to
`ProjectRunRecord`, exactly mirroring the `ideationOrigin` precedent, and to stamp it when a run is
started from a roadmap item — which is already a real entry point, since every item has *Plan*,
*Resolve* and *Completion check* hand-offs. Roadmap ids are already durable (`<!-- rm:id -->`
anchors), so the key survives renames and reordering. Add `workspaceKey` to `CostRecord` at the same
time and per-project attribution falls out for free.

### Does memory feed routing? No — and the report is wrong about this

The report calls the memory→routing link "our real differentiator" (M4). The code does not support
that claim.

`modelRouter.ts` consumes `TaskProfile`, `ModelCapability`, `SubscriptionQuota`, `ModelStruggleState`
and a decayed **execution-outcome** state (`ModelOutcomeState`, an EWMA over recorded run outcomes
with a bounded ±0.3 bias). It does not read SSOT project memory. There is no import of
`src/memory/` anywhere in it.

What actually exists is **outcome-driven routing** — the router learns which models did well *on this
project's tasks* and biases towards them. That is genuinely uncommon and worth marketing. But it is a
different claim, and shipping the report's wording would be an unverified statement about our own
product, which is the one thing this codebase is unusually careful about everywhere else.

**Marketing it as "memory informs routing" would be false today.** Either build the link or change
the sentence. This roadmap changes the sentence.

### Do Mission Control's ceilings generalise? Yes, and a project-level cap already exists

`missionRunner.ts` enforces `maxIterations`, `maxDurationMs`, `maxCostUsd`, `maxTokens` and
`maxConsecutiveNoProgress`, and — importantly — takes its budget through an injected
`MissionBudgetStore` interface exposing `getDailyBudgetStatus()`. The daily project-wide cap
(`dailyCostLimitUsd`) is already wired through it.

So gap C4 ("no budgets, caps or alerts") is **overstated**: a daily spend cap exists and already
blocks missions. What is missing is a cap scoped to a *roadmap item or gate* — and that needs the
join key from `NOW-1`. Extending the existing interface is the right move; building a second budget
system is not.

### How much of the PM lives in markdown already? Almost all of it — except cost

Every durable PM artefact is a JSON source of truth plus a markdown mirror, inside git-tracked
`project_memory/`:

| Thing | Where |
|---|---|
| Roadmap items, gates | `project_memory/roadmap/improvement-plan.md` (managed block) |
| Dependency graph, positions | `roadmap/roadmap-graph.json` + `.md` mirror |
| Per-item plans | `roadmap/plans/` |
| Risks | `operations/risk-oversight.json` + `.md` + append-only `-history.json` |
| Stakeholders, responsibilities, follow-ups | `operations/project-director.json` + `.md` |
| Delivery stages, runbooks | `operations/delivery.json` + `delivery.md` |
| Documents, workflow, testing config | `operations/`, `index/` |
| **Cost** | **VS Code `globalState`. Not in the repo. Not shareable. Not diffable.** |

That table is the whole argument for `NOW-1`. Everything a producer's report needs is already
git-native except the one number the product is trying to prove.

### What would a producer's report need? Everything but cost, today

Roadmap progress by gate, open risks and their recorded decisions, delivery readiness and stakeholder
ownership can all be assembled from the files above with no model in the path. Cost against estimate
cannot, until `NOW-1`. Estimates already exist on roadmap graph nodes.

**Architectural call:** build the report as a **generator module that reads managers and writes
files** — not as another page in `projectDashboardPanel.ts`. That file is 30,317 lines (the report's
figure is exact). Adding the flagship producer surface to it would make the decomposition problem
worse and put the deliverable behind it. As a generator, the report does not depend on decomposition
at all.

### What could day-one projected savings actually infer? Not enough — this one is contested

`bootstrapper.ts` has a real cold-repo scan (`scanImportFiles`, `detectProjectType`,
`detectEcosystem`, ~8,200 lines). It can tell you the ecosystem, the project type, the manifests and
the rough shape of the codebase.

It cannot tell you **how many requests you will make next month**, and monthly saving is
volume × per-request delta. A "projected monthly saving" derived from a repo scan would be a
confident number with no basis — precisely the kind of claim this codebase refuses everywhere else
("unassessed is not clear", published rule tables, no model output in durable artefacts). Shipping
one to solve a cold start would undercut the credibility the rest of the product is built on.

See `NOW-2`'s note and **Explicitly not doing** for the honest alternative.

### Other claims worth correcting

- **PM4 / M1 are largely closed already.** As of v0.420.3–0.420.4 (today), the README, the Marketplace
  `description` and `keywords`, and the wiki lead with project management rather than orchestration,
  and the "session vs project" memory claim no longer appears anywhere outside historical changelog
  entries. The report was accurate when written.
- **X6 is half right.** `test/core/routing.test.ts` genuinely never runs — `vitest.config.ts` has
  `include: ['tests/**/*.test.ts']`. But `src/remote/` is not *excluded* from coverage; coverage
  `include` is an allowlist naming eight directories, and `src/remote/`, `src/voice/`, `src/ard/`,
  `src/utils/` and `src/web/` are simply absent from it. Thresholds are 45/45 as stated.
- **X7 confirmed and sharper than stated.** There are **seven** runtime dependencies. Two of them
  (`pg`, `mysql2`) are database drivers.
- **PM5 confirmed.** No export capability of any kind exists in `src/core/`.

---

## Now

*Make the producer's console demonstrable, and make cost a first-class project artefact.*
Five items, dependency-ordered.

### [NOW-1] Cost records you can attribute and re-price
**Problem:** Spend is recorded machine-wide in editor state, capped at 500 requests, with no project
and no cache-write detail. So we cannot say what a project cost, what a feature cost, or what the
same work would have cost elsewhere — and none of it can appear in a document anyone else can read.
**Outcome:** Every request is recorded against a project, with enough token detail to re-price it
later, in a file that lives with the project rather than in the editor.
**Why now:** C1, C2, C6, C7, PM2. Nothing else in this horizon can be built without it.
**Acceptance criteria:**
- A cost record carries the workspace it belongs to, and cache read *and* write token counts as
  separate fields.
- Cost history for a project is stored with the project and survives reinstalling the extension.
- Existing records without the new fields still load and are reported as incomplete rather than as
  zero.
- Retention is bounded and the limit is stated where a user can see it.
**Touches:** `src/types.ts` (`CostRecord`), `src/core/costTracker.ts`, `src/extension.ts` (storage
wiring), provider adapters that populate usage.
**Size:** M
**Runs where:** Local only.
**Depends on:** nothing.

> **Decision needed before this ships** — see Open question 2. Putting spend in `project_memory/`
> makes it diffable, shareable and readable by the producer's report; it also commits your API spend
> to a repository you may make public. The alternative is a project-scoped file outside git, which
> keeps it private and makes the report's cost section local-only.

### [NOW-2] Cost per roadmap item
**Problem:** The roadmap knows what was planned and the cost tracker knows what was spent, and
nothing connects them. Nobody in the market can answer "what did this feature cost to build" —
issue trackers cannot see tokens, cost trackers cannot see a plan.
**Outcome:** A roadmap item shows what it has cost so far and how that compares with its estimate;
the cost dashboard can break spend down by roadmap item.
**Why now:** PM2 — the report's judgement that this is the single most differentiating unbuilt
feature matches what the code shows: both halves exist and the join is one optional field.
**Acceptance criteria:**
- A run started from a roadmap item records that item's durable id.
- An item's page shows spend to date against its estimate, or states plainly that no spend has been
  attributed yet — never a zero that reads as "free".
- Spend that cannot be attributed to any item is reported as unattributed rather than distributed.
- The attribution survives an item being renamed or reordered.
**Touches:** `src/types.ts` (`ProjectRunRecord`), `src/core/projectRunHistory.ts`,
`src/core/roadmapGraph.ts` / `roadmapGraphStore.ts` (estimates), `src/views/costDashboardPanel.ts`.
**Size:** M
**Runs where:** Local only.
**Depends on:** NOW-1.

### [NOW-3] The producer's report
**Problem:** Everything good about the project manager is invisible to the people who most need it.
A producer, a client or a technical director does not have VS Code open, and there is no artefact
they can read.
**Outcome:** One command produces a status document — markdown plus a static HTML view — covering
roadmap progress by gate, open risks with their recorded decisions, delivery readiness, ownership,
and cost against estimate. It commits to the repo and can be published to GitHub Pages.
**Why now:** PM1 (Critical), and it is the fix for the PM pillar's structural problem.
**Acceptance criteria:**
- Generated with no model in the path — the same project state produces a byte-identical report.
- Any section whose data is unavailable says so explicitly rather than being omitted or zeroed.
- The HTML view is a single self-contained file that opens from disk with no server.
- Generation is a module, not a page in `projectDashboardPanel.ts`.
**Touches:** new `src/core/producerReport.ts`; reads `roadmapGraphStore`, `riskOversightManager`,
`projectDirectorManager`, `deliveryManager`, `costTracker`.
**Size:** M
**Runs where:** Local only. Publishing is GitHub Pages, which is free.
**Depends on:** NOW-2 for the cost section only — the other sections can ship first.

### [NOW-4] Bundled price map, refreshed by a scheduled Action
**Problem:** Every cost and saving figure depends on model prices, prices move, and a stale map turns
the product's central claim into a wrong number stated confidently.
**Outcome:** A versioned price map is committed to the repo and ships with each release; a scheduled
GitHub Action opens a pull request when prices move.
**Why now:** Underpins C2 and C5. The whole cost claim rots without it.
**Acceptance criteria:**
- The map is a committed file with a version and a date, and the version is visible wherever a
  saving is shown.
- A scheduled workflow opens a PR on change and does nothing when nothing changed.
- No network call at runtime.
- A price the map does not cover is reported as unpriced, never guessed.
**Touches:** new price map data file, `src/core/costTracker.ts` / pricing lookup,
`.github/workflows/`.
**Size:** S
**Runs where:** Local only at runtime; the refresh runs on GitHub's free tier.
**Depends on:** nothing.

### [NOW-5] Twenty beta users, individually recruited
**Problem:** Nobody is using AtlasMind, there is no telemetry, and there is no way to get any. Every
prioritisation call after this one is currently a guess.
**Outcome:** 15–20 people installed, onboarded and interviewed, with notes recorded in the repo.
**Why now:** It is the only feedback instrument available, and it gates whether the producer's-console
positioning is right at all.
**Acceptance criteria:**
- Two pools recruited deliberately: BYOK developers who feel API spend, and solo producers or small
  studios running agents.
- Each user is interviewed at least once, with notes captured as project memory.
- The interviews explicitly test whether the producer's console lands, not just whether the tool works.
**Touches:** nothing in `src/`.
**Size:** S (effort), ongoing (calendar).
**Runs where:** Local only.
**Depends on:** nothing — start immediately and in parallel; it does not need the engineering above.

---

## Next

*Close the loop, publish a number, and take the gap nobody has filled.*

### [NXT-1] Counterfactual pricing engine
**Problem:** The cost dashboard reports what was spent. The claim worth making is what was *avoided*
— and there is no method behind it and nothing published.
**Outcome:** For each request routed to a local or cheaper model, the identical token counts are
re-priced at a nominated flagship model from the same price map, and the difference is reported with
the method stated openly.
**Why now:** C2, C5. Highest-value item in this horizon; see Open question 1 about promoting it.
**Acceptance criteria:**
- Re-pricing preserves the cache read/write split recorded in NOW-1, and refuses to produce a figure
  for records that predate those fields.
- The method, including the caveat that flagship models usually emit more output tokens so the figure
  is a floor, is documented where the number is displayed.
- The comparison model is named on screen, not implied.
**Touches:** new pricing module, `src/core/costTracker.ts`, `src/views/costDashboardPanel.ts`.
**Size:** M
**Runs where:** Local only — arithmetic against a bundled table.
**Depends on:** NOW-1, NOW-4.

### [NXT-2] Dogfood for three weeks and publish the number
**Problem:** Every serious competitor has published evidence. AtlasMind has none, about anything.
**Outcome:** AtlasMind's own development runs on AtlasMind for three weeks; the measured saving, the
method and the raw data are published in the README and on GitHub Pages.
**Why now:** X1 (Critical), C5. Treated as a product deliverable, not marketing — the artefact is the
producer's report plus the pricing method, applied to this repository.
**Acceptance criteria:**
- The published figure is reproducible from committed data by a reader.
- The method's limitations are stated in the same place as the number.
- The raw per-request data behind it is committed, or its absence explained.
**Touches:** `README.md`, GitHub Pages, `docs/`.
**Size:** S (effort), three weeks (calendar).
**Runs where:** Local only; publishing is free.
**Depends on:** NXT-1, NOW-3.

### [NXT-3] Budgets and caps at project and roadmap level
**Problem:** A spend cap exists for the day and for a mission. Nothing caps a *feature*. Cline has 5M
installs and no spending caps at all — this is an open hole in the extension market.
**Outcome:** A budget can be set against a roadmap item or a release gate, and enforcement reuses the
Mission Control ceiling machinery rather than duplicating it.
**Why now:** C4. Note the gap is overstated in the report — a daily cap already exists and already
blocks missions; this extends its scope.
**Acceptance criteria:**
- A budget is declared against a durable roadmap id and travels with it.
- Enforcement goes through the existing `MissionBudgetStore` interface; no second budget system.
- Crossing a threshold warns before it blocks, and a block names the budget that caused it.
**Touches:** `src/core/missionRunner.ts`, `costTracker.ts`, `roadmapGraphStore.ts`.
**Size:** M
**Runs where:** Local only.
**Depends on:** NOW-2.

### [NXT-4] Say how collaboration works, and prove it
**Problem:** The whole git-native backlog camp leads with "git is the sync layer, there is no server".
AtlasMind is *more* git-native than any of them and says nothing about it, so a hosting constraint
reads as a missing feature instead of a design position.
**Outcome:** Documentation and a worked example showing plan, risk and ownership changes arriving as
diffs in a pull request, with conflicts resolving like any other file.
**Why now:** PM3, PM6. Costs nothing, and converts the constraint into the argument.
**Acceptance criteria:**
- A page shows a real diff of a roadmap and a risk change in a PR.
- The determinism rule — durable artefacts are byte-identical scaffolds with no model output — is
  stated as the reason the diffs are reviewable.
**Touches:** `wiki/`, `README.md`.
**Size:** S
**Runs where:** Local only.
**Depends on:** nothing.

### [NXT-5] Export the roadmap
**Problem:** Import is re-runnable and keyed; export does not exist. A one-way door reads as lock-in,
which contradicts the product's own stated principles.
**Outcome:** Roadmap items export to GitHub Projects, and to a format Linear and Jira can ingest.
**Why now:** PM5.
**Acceptance criteria:**
- Export is deterministic and re-runnable; a second run updates rather than duplicating.
- The durable item id travels with the export so a round trip can be matched.
- Nothing is written to a third-party service without a confirmation naming the destination.
**Touches:** new export module beside `roadmapImport.ts`, `roadmapIssueDraft.ts`.
**Size:** M
**Runs where:** Local only; GitHub writes go through the user's own `gh`.
**Depends on:** nothing.

### [NXT-6] Fix the dead test directory and the coverage blind spots
**Problem:** `test/core/routing.test.ts` has never executed, because the runner only collects
`tests/**`. The router is about to carry budget enforcement, and its test does not run.
**Outcome:** The stray test runs or is deleted deliberately; `src/remote/` and the other unlisted
directories are either covered or explicitly declared out of scope.
**Why now:** X6, and it is a prerequisite for trusting NXT-3.
**Acceptance criteria:**
- No test file exists outside the directory the runner collects.
- Coverage `include` either names every shipped source directory or documents each omission.
**Touches:** `test/`, `tests/`, `vitest.config.ts`.
**Size:** S
**Runs where:** Local only.
**Depends on:** nothing.

### [NXT-7] Expose the roadmap, memory and cost as local MCP servers
**Problem:** AtlasMind competes with other agents instead of being consumed by them. `backlogit`
already ships an MCP roadmap surface; in that camp it is table stakes.
**Outcome:** Claude Code, Copilot and Cursor users can read AtlasMind's plan of record, project
memory and cost data over stdio without leaving their own agent.
**Why now:** X2, M2, PM9 — and it is the cheapest distribution available, which matters more than
usual with no marketing budget. It is also the natural extension of the bring-your-own-tool
positioning shipped in v0.420.4.
**Acceptance criteria:**
- Servers run locally over stdio with no network listener.
- Read-only by construction for the first release; no tool can mutate the roadmap.
- Works when AtlasMind's own chat has never been opened.
**Touches:** new `src/mcp/servers/`, `roadmapGraphStore`, `src/memory/`, `costTracker`.
**Size:** M
**Runs where:** Local only.
**Depends on:** NOW-1 for the cost server.

---

## Later

*Structural work that gates quality rather than delivering a claim.*

### [LTR-1] Decompose `projectDashboardPanel.ts`
**Problem:** 30,317 lines in one file — over 10% of the codebase — on the most important surface in
the product. Agents do ~90% of the code here, and agent-assisted editing degrades badly at that size.
**Outcome:** The dashboard is a set of page modules with a thin host, and no single file over a
few thousand lines.
**Why now:** X5. Deliberately *not* in Now: the Now items are designed to route around it
(the producer's report is a generator, not a page), so it gates future quality rather than the
current claim. It becomes urgent the moment a Now item is forced to add a page.
**Acceptance criteria:**
- Each dashboard page is its own module with its own tests.
- The webview message gate and its parity test survive the split intact.
- No behaviour change; the existing panel tests pass unmodified.
**Touches:** `src/views/projectDashboardPanel.ts`, `media/projectDashboard.js`.
**Size:** L
**Runs where:** Local only.
**Depends on:** nothing, but should follow NOW-1…3 so it is not reorganising a moving target.

### [LTR-2] Decompose the other large files
**Problem:** Nine files over 5,000 lines, including `bootstrapper.ts` at ~8,200.
**Outcome:** No shipped source file over ~3,000 lines without a stated reason.
**Why now:** X5.
**Acceptance criteria:** Each split preserves public signatures and existing tests.
**Touches:** `src/bootstrap/bootstrapper.ts` and the other large modules.
**Size:** L
**Runs where:** Local only.
**Depends on:** LTR-1 (do the hardest one first and learn from it).

### [LTR-3] Git worktree isolation for parallel runs
**Problem:** Parallel agent runs share a working tree. By 2026 almost every competitor gives each
parallel agent its own worktree so they cannot trample each other's files, lockfiles and ports.
**Outcome:** A parallel run executes in its own worktree and merges back through the normal review
path.
**Why now:** O1. Later rather than Next because it matters at a usage volume no one has reached yet.
**Acceptance criteria:**
- Each parallel run gets its own worktree, removed on completion.
- A failed run leaves the worktree for inspection rather than deleting evidence.
- The main working tree is never modified by a background run.
**Touches:** `src/core/` run execution, git skills.
**Size:** M
**Runs where:** Local only.
**Depends on:** nothing.

### [LTR-4] Cross-tool spend visibility — **Contested**
**Problem:** AtlasMind sees only its own traffic, so it reports a fraction of the developer's real
AI bill.
**Outcome:** Read what Claude Code, Cursor and Windsurf write to disk and price it alongside our own.
**Why now:** C3. **Marked contested:** strategically attractive and genuinely hosting-free, but it is
a large, brittle surface — parsing other vendors' undocumented on-disk formats, which change without
notice — built for a user base that does not exist yet. Two dedicated products already do this. Do
not start it before there are users asking for it.
**Acceptance criteria:** deferred until the item is uncontested.
**Touches:** new readers, `costDashboardPanel.ts`.
**Size:** L
**Runs where:** Local only.
**Depends on:** NXT-1.

---

## Explicitly not doing

| Not doing | Why |
|---|---|
| **Day-one *projected monthly savings*** | A repo scan cannot know your request volume, and saving is volume × delta. A confident number with no basis contradicts the product's own refusal to guess. Ship *time to first real number* instead: price the first real request the moment it lands, and show the method until then. |
| **Marketing "memory informs routing"** | The router reads execution outcomes and struggle state, not project memory. Market **outcome-driven routing**, which is true and still rare. |
| **`pg` and `mysql2` shipped to every user** | Two of seven runtime dependencies are database drivers for the Lens live-database feature. In a free beta trying to reduce install friction, that needs to be either central to the thesis or lazily loaded / split out. **Decision needed — Open question 3.** |
| **Anything needing a server** | Team dashboards, shared memory, hosted gateway, centralised billing, SSO. Real gaps; unaffordable, and irrelevant before the first twenty users. Unlocked by revenue. |
| **Usage telemetry and analytics** | Needs an endpoint. Beta learning comes from NOW-5 instead. |
| **A second surface (CLI, JetBrains, mobile)** | Right eventual move; wrong before anyone uses the first surface. |
| **Resource scheduling, capacity planning, time tracking, asset pipelines** | Flow Production Tracking and Hansoft own these. State the boundary rather than chasing it. |
| **Agent work classification** | Cursor already ships it on-device. Not the wedge. |
| **Team/enterprise, pricing model, chargeback export** | Needs hosting and paying customers. Revisit once the value claim is proven. |
| **Reformatting `improvement-plan.md` into this file's shape** | It is machine-parsed with durable anchors. Reformatting would break the dashboard and destroy every item id. |

---

## Open questions for Joel

1. **Which claim do you want provable first — the saving, or the producer's console?** I sequenced the
   producer's console into Now (NOW-2, NOW-3) and counterfactual pricing into Next (NXT-1), following
   your instruction that the project manager is the lead pillar. The report ranks pricing first. They
   share the same foundation (NOW-1), so this is a straight swap of NOW-3 and NXT-1 if you prefer the
   number.

2. **Where does cost history live — in the repo, or beside it?** In `project_memory/` it is diffable,
   survives reinstalls, and the producer's report can carry cost. It also commits your API spend to a
   repository you may make public, and it is the first thing AtlasMind would write there that is
   about *you* rather than about the project. Outside git it stays private and the report's cost
   section becomes local-only. This blocks NOW-1.

3. **Is the Lens live-database feature central to the thesis?** If yes, keep `pg` and `mysql2` and say
   why. If no, they should be lazily loaded or moved to an optional install — two of seven runtime
   dependencies is a real chunk of install weight for something most beta users will never touch.

4. **What happens to ideation, vision, UI Studio and Buzz?** Each is defensible alone; together they
   blur the producer-console thesis. I need to know which serve it (my read: ideation clearly does —
   it already feeds the roadmap) before I can sequence anything that touches them.

5. **Which beta pool leads — BYOK cost-conscious developers, or solo producers and small studios?**
   They want different first-run experiences and would validate different claims. Recruiting both
   equally with twenty people gets ten of each, which may be too few of either to learn from.
