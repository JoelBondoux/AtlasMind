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
Five items, dependency-ordered. Four of the five are one chain — cost data, cost per item, the
report, the portal — which is deliberate: they are the positioning, and the fifth is the only way to
find out whether it lands.

### [NOW-1] Cost records you can attribute and re-price
**Problem:** Spend is recorded machine-wide in editor state, capped at 500 requests, with no project
and no cache-write detail. So we cannot say what a project cost, what a feature cost, or what the
same work would have cost elsewhere — and none of it can appear in a document anyone else can read.
**Outcome:** Every request is recorded against a project, with enough token detail to re-price it
later, in a project-scoped store whose location the user chooses.
**Why now:** C1, C2, C6, C7, PM2. Nothing else in this horizon can be built without it.
**Acceptance criteria:**
- A cost record carries the workspace it belongs to, and cache read *and* write token counts as
  separate fields.
- Cost history is project-scoped and survives reinstalling the extension.
- A setting chooses where it lives: **private to this machine** (default) or **in the repository**.
  Changing it moves the existing history rather than starting a new one, and says how many records
  moved.
- Choosing the repository option warns, once, that spend data will be committed — and the file it
  writes is named in the warning.
- Existing records without the new fields still load and are reported as incomplete rather than as
  zero.
- Retention is bounded and the limit is stated where a user can see it.
**Touches:** `src/types.ts` (`CostRecord`), `src/core/costTracker.ts`, `src/extension.ts` (storage
wiring), `package.json` (new setting), provider adapters that populate usage.
**Size:** M
**Runs where:** Local only.
**Depends on:** nothing.

> **Decided:** a setting, not a fixed choice — proposed as `atlasmind.cost.historyLocation` with
> `machine-private` (default) and `repository`.
>
> **Private is the default deliberately.** In-repo is the more useful option — diffable, survives a
> clone, and it is what lets the producer's report (`NOW-3`) carry a cost section for someone who
> never opens VS Code. It is also the more consequential one: it commits a record of your API spend
> to a repository you may later make public, and it is the first thing AtlasMind would write into
> `project_memory/` that is about *you* rather than about the project. Deny-by-default is the house
> rule for exactly this shape of choice, so the useful option is one setting away rather than the
> starting position.
>
> **Consequence to state in the docs, not hide:** with the default left alone, the producer's report
> renders its cost section as *not shared* rather than as zero. A report that silently omits cost
> reads as a project with no spend.

### [NOW-2] Cost per roadmap item
**Problem:** The roadmap knows what was planned and the cost tracker knows what was spent, and
nothing connects them. Nobody in the market can answer "what did this feature cost to build" —
issue trackers cannot see tokens, cost trackers cannot see a plan.
**Outcome:** A roadmap item shows what it has cost so far and how that compares with its estimate;
the cost dashboard can break spend down by roadmap item.
**Why now:** PM2 — the report's judgement that this is the single most differentiating unbuilt
feature matches what the code shows: both halves exist and the join is one optional field.
**Acceptance criteria:**
- Work started from a roadmap item records that item's durable id **on the cost record itself**.
- An item shows spend to date against its estimate, or states plainly that no spend has been
  attributed yet — never a zero that reads as "free".
- Spend that cannot be attributed to any item is reported as unattributed rather than distributed.
- The attribution survives an item being renamed or reordered.
- Every attributed record says **how** it was attributed, so an inference is never mistaken for an
  assertion.
**Touches:** `src/types.ts` (`CostRecord`), `src/core/costTracker.ts`,
`src/core/roadmapCostAttribution.ts` (new), the roadmap hand-off in
`src/views/projectDashboardPanel.ts`, `src/views/chatPanel.ts`, `src/core/orchestrator.ts`.
**Size:** M
**Runs where:** Local only.
**Depends on:** NOW-1.

> **The id goes on `CostRecord`, not `ProjectRunRecord`.** The original shape here mirrored
> `ideationOrigin` on the run record, which would have made attribution a three-way join —
> cost → run → item — and would have missed every chat turn that never creates a run, which is most
> of them. Directly on the cost record it is a group-by, and it works wherever spend happens.
>
> **A roadmap-attributed session attributes its whole session, and says that it did.** The
> alternative — attributing only the first turn — under-reports so badly it would make the feature
> useless, since almost all the work in a session is follow-up turns. But a session left open while
> you wander onto something else would then charge unrelated work to the item, so the attribution
> carries its provenance (`session` rather than `explicit`) and the surface shows which. An inference
> presented as an assertion is the failure mode here: a confident wrong number is worse than no
> number, and this is the one place where being able to see *why* a cost landed where it did is what
> makes it correctable.

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
- **The generator emits structured data alongside the rendered document**, so a GitHub Pages portal
  can consume it later without the report being rebuilt. See the note below.
**Touches:** new `src/core/producerReport.ts`; reads `roadmapGraphStore`, `riskOversightManager`,
`projectDirectorManager`, `deliveryManager`, `costTracker`.
**Size:** M
**Runs where:** Local only. Publishing is GitHub Pages, which is free.
**Depends on:** NOW-2 for the cost section only — the other sections can ship first.

> **Build it to feed a portal, because one is planned.** The backlog carries *"Explore a GitHub Pages
> hosted (within the host repo) web portal for AM Project Manager"*, tagged `#mvp`. That is the same
> artefact with a different renderer, and it fits the constraints exactly — Pages in the user's own
> repository is free and is not hosting we run.
>
> So separate the three layers now: **gather** (read the managers) → **model** (a plain data object,
> written out as JSON beside the report) → **render** (markdown, static HTML, and later a portal).
> Emitting the data object costs almost nothing today and is the difference between a portal being a
> renderer and a portal being a rewrite. It also gives the MCP roadmap server (`NXT-7`) something to
> serve without a second gatherer.

### [NOW-4] Publish the report as a GitHub Pages portal
**Problem:** A committed HTML file is readable outside VS Code only by someone who clones the
repository and opens it. A producer, a client or a technical director needs a **URL you can send
them**. That last step is the difference between the project manager being visible and being
theoretically visible.
**Outcome:** The generated report publishes to GitHub Pages from the host repository, so project
status is a link.
**Why now:** PM1 (Critical) — this is the gap, and `NOW-3` alone only half closes it. Moved into MVP
by decision; see the re-cut note below.
**Acceptance criteria:**
- Publishing is **off until switched on**, and the switch names what will become readable.
- **Per-section control**, with a declared default set: **roadmap progress by gate** and **delivery
  readiness** publish; **stakeholders, assignments, follow-ups, the risk register and all cost**
  do not, until each is switched on individually.
- **Repository visibility is checked at publish time and changes the warning.** A private repository
  publishing a public page is the surprising case and must be called out in those words — a user who
  made the repo private has already expressed an intent the Pages default contradicts.
- Enabling a sensitive section names what becomes readable at a public URL, and says whether the
  repository is public or private when it asks.
- A published page states when it was generated; a stale page says so rather than looking current.
- Publishing is a committed workflow the user can read, not a hidden push.
- Turning it off removes the published page, and says whether the removal succeeded.
**Touches:** `producerReport.ts` (from `NOW-3`), a Pages workflow, `package.json` (settings).
**Size:** M
**Runs where:** Local only to generate; GitHub Pages to serve, which is free and is the user's own
repository — not hosting we run.
**Depends on:** NOW-3.

> **The privacy problem here is bigger than it looks, and it must be designed in, not bolted on.**
> **A GitHub Pages site is public by default even when the repository is private** — restricting
> access is a GitHub Enterprise Cloud feature. So for a free or Pro account, "publish the producer's
> report" means *publish it to the open internet*, and the item must confirm that behaviour against
> current GitHub documentation before shipping rather than trusting this note.
>
> That matters because of what the report contains. `projectDirectorManager` deliberately avoids
> hoarding personal data and prefers references it resolves on demand — publishing stakeholder names,
> assignments and follow-ups to a public URL would undo that in one step. The risk register is
> commercial, legal and ethical findings with recorded decisions. And if cost history is set to
> `repository` (`NOW-1`), spend becomes public too.
>
> Hence the decided default: a page showing **roadmap progress by gate and delivery readiness** —
> which is what a client actually asks for — with **people and money opt-in**, one section at a time.
>
> The visibility check exists because the two defaults point opposite ways. GitHub's is *publish
> publicly*; a user who made their repository private has already said something different. Where a
> tool's default and a user's expressed intent disagree, saying so out loud is the minimum, and it
> costs one API call at the moment it matters.

### [NOW-5] Twenty beta users, individually recruited
**Problem:** Nobody is using AtlasMind, there is no telemetry, and there is no way to get any. Every
prioritisation call after this one is currently a guess.
**Outcome:** 15–20 people installed, onboarded and interviewed, with notes recorded in the repo.
**Why now:** It is the only feedback instrument available, and it gates whether the producer's-console
positioning is right at all.
**Acceptance criteria:**
- **Solo producers and small studios running agents are the lead pool** — recruit there first and
  weight the numbers that way. Most will also be BYOK, so the cost story still gets tested; it is
  tested *on the people the console is for* rather than on a second audience.
- Each user is interviewed at least once, with notes captured as project memory.
- The interviews explicitly test whether the producer's console lands, not just whether the tool works.
- Recruit where solo producers already are — indie game-dev communities, Codecks and HacknPlan users
  who have outgrown them, small agencies — not only in the local-LLM and BYOK channels, which select
  for the other story.
**Touches:** nothing in `src/`.
**Size:** S (effort), ongoing (calendar).
**Runs where:** Local only.
**Depends on:** nothing — start immediately and in parallel; it does not need the engineering above.

---

## Next

*Close the loop, publish a number, and take the gap nobody has filled.*

### [NXT-0] Bundled price map, refreshed by a scheduled Action
**Problem:** Every cost and saving figure depends on model prices, prices move, and a stale map turns
the product's central claim into a wrong number stated confidently.
**Outcome:** A versioned price map is committed to the repo and ships with each release; a scheduled
GitHub Action opens a pull request when prices move.
**Why now:** Underpins C2 and C5. Kept as `NXT-0` rather than renumbered, because it is a
prerequisite of `NXT-1` and sorts in front of it.
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

> **Moved out of Now to make room for the portal, and the dependencies say that is correct.** Nothing
> in Now needs it: `NOW-2` reports *actual* spend, which is already priced by the code today. What
> needs a fresh, versioned map is the **savings** claim — `NXT-1` — and it now sits directly in front
> of it.
>
> **The cost of the move, stated:** until this ships, cost-per-roadmap-item shows figures from
> whatever prices are currently hardcoded, with no version stamp and no refresh. That is the status
> quo rather than a regression, but it means the first numbers a beta user sees are unversioned. If
> that bothers you, this is S-sized and can be done in parallel by anyone — it is mostly a workflow
> file.

### [NXT-1] Counterfactual pricing engine
**Problem:** The cost dashboard reports what was spent. The claim worth making is what was *avoided*
— and there is no method behind it and nothing published.
**Outcome:** For each request routed to a local or cheaper model, the identical token counts are
re-priced at a nominated flagship model from the same price map, and the difference is reported with
the method stated openly.
**Why now:** C2, C5. Highest-value item in this horizon. **Deliberately not promoted into Now** — the
producer's console leads (decision recorded below), and this shares `NOW-1`'s foundation, so it
follows immediately rather than competing.
**Acceptance criteria:**
- Re-pricing preserves the cache read/write split recorded in NOW-1, and refuses to produce a figure
  for records that predate those fields.
- The method, including the caveat that flagship models usually emit more output tokens so the figure
  is a floor, is documented where the number is displayed.
- The comparison model is named on screen, not implied.
**Touches:** new pricing module, `src/core/costTracker.ts`, `src/views/costDashboardPanel.ts`.
**Size:** M
**Runs where:** Local only — arithmetic against a bundled table.
**Depends on:** NOW-1, NXT-0.

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

### [NXT-8] Fetch the database drivers on first use, not at install
**Problem:** `pg` and `mysql2` are two of seven runtime dependencies and ship to every user for the
Lens live-database feature, which most beta users will never open.
**Outcome:** A clean install carries no database drivers; the first time someone points Lens at a
live database, AtlasMind fetches them, verifies them, and proceeds.
**Why now:** X7. Decided: keep the feature, move the cost to the people who use it.
**Acceptance criteria:**
- A fresh install contains neither driver, and the Lens surfaces that do not touch a live database
  work unchanged.
- The fetch is explicit: it says what it is downloading and why, and does not begin without consent.
- Downloads are integrity-checked before anything is loaded, following the SHA-256-verified pattern
  `localTranscriber.ts` already uses for its model and binary.
- A failed or declined fetch degrades to "live database reads unavailable" with the reason — never a
  broken Lens page.
**Touches:** `package.json` (dependencies), `src/core/lensDatabaseReading.ts` and the Lens probe
path, a new verified-fetch helper.
**Size:** M
**Runs where:** Local only; the download comes from the public npm registry, not from us.
**Depends on:** nothing.

> **Measured before recommending, because the number is smaller than it feels.** The two drivers and
> their exclusive transitive dependencies total roughly **1.7 MB** — against a 21 MB `node_modules`
> and a 12 MB packaged `.vsix`. So this removes about 8% of the dependency tree and rather less of
> the download.
>
> It also *adds* something: fetching and executing third-party code at runtime is a supply-chain
> surface that shipping a pinned dependency does not have. That is why the integrity check above is
> an acceptance criterion rather than a nicety.
>
> **The cheaper 80% is lazy loading** — `require` the driver only when a live-database probe actually
> runs. That costs nothing, adds no new surface, and removes the drivers from activation entirely; it
> just does not shrink the download. If install weight is the real goal, do the fetch. If start-up
> cost and "why does this need a database driver?" are the real goals, lazy loading answers both for
> a fraction of the work. Worth deciding which problem is being solved before building.

### [NXT-9] Wire the four side surfaces into the project manager, and into each other
**Problem:** Ideation, vision, UI Studio and Buzz each stand alone. Only ideation has a door into the
plan. The rest generate value that never reaches the roadmap, the risk register or the report, which
is what makes them read as scope sprawl rather than as parts of one console.
**Outcome:** Each of the four has at least one deterministic path into the project manager, and the
producer's report can see what they produced.
**Why now:** PM8, and it is the decision recorded below: all four stay, so they have to earn their
place by connecting rather than by existing.
**Acceptance criteria:**
- Each surface has a named, deterministic hand-off into a roadmap item, a risk, a document or a
  follow-up — following the existing ideation→roadmap path, which already writes through the single
  roadmap writer rather than a second serializer.
- Provenance is recorded on the receiving side, using durable ids, so a link survives a rename.
- The producer's report gains a section naming what each connected surface contributed, or states
  that a surface is not connected — never silence.
- No surface writes to the roadmap through a path of its own.
**Touches:** `src/views/projectIdeationPanel.ts`, the UI Studio panels, vision, the Buzz inbound
path, `roadmapGraphStore.ts`, `producerReport.ts` (from `NOW-3`).
**Size:** L — realistically one surface at a time.
**Runs where:** Local only.
**Depends on:** NOW-3 for the report half.

### [NXT-10] Slack as an alternative to Buzz for outbound updates
**Problem:** Buzz is the only way a status update reaches a person where they already are, and Buzz
is a niche most teams are not on. A producer's console that cannot tell anyone anything is missing
the last step.
**Outcome:** A Director follow-up, assignment or status update can be sent to Slack, through the
same guarded path Buzz uses.
**Why now:** PM1's other half — the report is the pull; this is the push. Requested as a Buzz
alternative.
**Acceptance criteria:**
- Slack is reached through a connected Slack MCP server, not a bespoke integration with a
  credential of its own.
- Sending stays behind the existing deny-by-default outbound gate and the modal confirmation that
  names the recipient — a Slack post is as outward-facing as a Buzz post.
- Buzz and Slack are alternatives, not a migration: neither is required and both can be off.
**Touches:** `src/core/directorCommsRunner.ts`, the dashboard Director page, docs.
**Size:** S
**Runs where:** Local only — the user's own Slack workspace and their own MCP server.
**Depends on:** nothing.

> **Most of this already exists, which is why it is S.** `directorCommsRunner.ts` was written for
> exactly this: it names Slack in its own header, and matches connector tools on patterns
> (`post_message`, `chat_post`, `post_to_channel`, `send_dm`) that a Slack MCP server satisfies
> directly. The work is connecting and documenting a server, and confirming the channel-vs-DM
> distinction it already models behaves, rather than building an integration.

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

### [LTR-4] Copy cost history to a destination you nominate
**Problem:** Wherever cost history lives it lives in one place. Machine-private means it dies with
the laptop; in-repo means it is only as durable as that clone. Someone accounting for spend over a
year wants a copy somewhere that is neither.
**Outcome:** Cost history can be mirrored to a location the user nominates, on a schedule or on
demand, without the primary store changing.
**Why now:** Second-line by request, and correctly so — it is a durability and bookkeeping
convenience, not part of the value claim. `NOW-1`'s setting already solves the question that was
blocking work; this is the follow-on.
**Acceptance criteria:**
- The mirror is a **copy**, never a move: the primary store chosen in `NOW-1` stays authoritative,
  so a failed or misconfigured mirror can never lose history.
- Off by default, and the first copy to any destination is confirmed with the destination named in
  the dialog — this writes data somewhere new, which is outward-facing by definition.
- A destination that cannot be reached is reported, not retried silently, and never blocks a run.
- Any credential lives in VS Code SecretStorage, never in a setting or a committed file.
- What is copied is stated exactly, and is cost records only — no prompts, no code, no file paths.
**Touches:** `src/core/costTracker.ts`, a new export/mirror module, `package.json` (settings),
SecretStorage.
**Size:** M for the local scope below; L if it grows a service integration.
**Runs where:** Local only, **provided the destination is one the user already owns** — another
directory, a synced folder, a private git remote, an encrypted archive. Nothing here is hosting *we*
pay for.
**Depends on:** NOW-1.

> **Scope this deliberately when it comes up.** "A secure source" spans two very different builds. A
> filesystem path or a git remote the user already has is a small, credential-free feature. An
> integration with a named cloud provider brings an SDK, a credential, a token-refresh path and a
> support burden, for a file that is a few hundred kilobytes of numbers. Start with the first; treat
> the second as a separate item that has to justify itself.
>
> **"Secure" needs a definition before it is promised.** Cost history is not a credential, but it
> does reveal spend, cadence and which projects are active. If the word appears in the UI it should
> mean something specific — at minimum encrypted at rest with a key in SecretStorage — rather than
> "we put it somewhere else".

### [LTR-5] Cross-tool spend visibility — **Contested**
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
| **`pg` and `mysql2` shipped to every user** | Decided: the feature stays, the cost moves to the people who use it. Now `NXT-8`, with the measured saving (~1.7 MB) and the supply-chain caveat stated there. |
| **Anything needing a server** | Team dashboards, shared memory, hosted gateway, centralised billing, SSO. Real gaps; unaffordable, and irrelevant before the first twenty users. Unlocked by revenue. |
| **Usage telemetry and analytics** | Needs an endpoint. Beta learning comes from NOW-5 instead. |
| **A second surface (CLI, JetBrains, mobile)** | Right eventual move; wrong before anyone uses the first surface. |
| **Resource scheduling, capacity planning, time tracking, asset pipelines** | Flow Production Tracking and Hansoft own these. State the boundary rather than chasing it. |
| **Agent work classification** | Cursor already ships it on-device. Not the wedge. |
| **Team/enterprise, pricing model, chargeback export** | Needs hosting and paying customers. Revisit once the value claim is proven. |
| **Reformatting `improvement-plan.md` into this file's shape** | It is machine-parsed with durable anchors. Reformatting would break the dashboard and destroy every item id. |

---

## Decisions taken

Recorded rather than deleted, so a later reader can see what was chosen and what it ruled out.

| Question | Decision | Consequence |
|---|---|---|
| Where does cost history live? | **A setting**, `machine-private` by default, `repository` one switch away | `NOW-1` unblocked. With the default untouched, the producer's report shows cost as *not shared*, never zero |
| Prove the saving first, or the producer's console? | **The producer's console** | `NOW-2` and `NOW-3` stay in Now; counterfactual pricing (`NXT-1`) follows immediately on the same foundation, not in competition with it |
| Keep the Lens database drivers? | **Keep the feature, fetch the drivers on first use** | `NXT-8`. Measured saving ~1.7 MB of a 21 MB tree, against a new runtime-download surface — the item argues both sides and asks which problem is being solved |
| Ideation, vision, UI Studio, Buzz? | **All four stay, and must connect** — to the project manager and to each other | `NXT-9`. They earn their place by connecting rather than by existing; the report names what each contributed, or says it is unconnected |
| Slack as a Buzz alternative? | **Yes, via a Slack MCP server** | `NXT-10`, sized S because `directorCommsRunner` was already built for it. Alternatives, not a migration |
| Which beta pool leads? | **Solo producers and small studios**, most of whom will also be BYOK | `NOW-5` recruits there first, so the cost story is tested on the people the console is for rather than on a second audience |
| Is the GitHub Pages portal in MVP? | **Yes** | It becomes `NOW-4`. To hold the five-item cap, the price map moved to `NXT-0` — nothing in Now needed it, and it sits directly in front of the savings claim that does |
| What may the portal publish by default? | **Roadmap progress by gate and delivery readiness.** Stakeholders, assignments, follow-ups, risks and cost are opt-in, one section at a time | `NOW-4` also checks repository visibility at publish time and warns differently for a private repo, because a Pages site is public regardless and that contradicts an intent the user has already expressed |

## Still open

Everything else is decided; `Now` can be started.

1. **Is install weight or start-up cost the real problem with the database drivers?** They have
   different answers — a verified runtime fetch for the first, plain lazy loading for the second, at
   a fraction of the work and with no new supply-chain surface. `NXT-8` is written for the fetch
   because that is what was asked; it is worth thirty seconds' thought before it is built. It blocks
   nothing in Now.
