# Ideation and Research — Phased Roadmap

> **Status:** C0 and the pure engine shipped in **v0.225.0**; C1 partially (both pure modules), C2
> onward not started. **Owner:** AtlasMind core. **Created:** 2026-07-30. **Baseline:** v0.224.1.
> This is the SSOT implementation plan. Its normative specification is
> [`docs/ideation-and-research.md`](../../docs/ideation-and-research.md) — **C0 and the pure engine
> shipped in v0.225.0**. Where that specification and this file disagree, the specification wins and
> this file is wrong.
>
> Nothing here overrides AtlasMind's safety-first defaults: deny-by-default, sanitize-at-boundary,
> confirm-before-destructive-action. Build incrementally, respecting the entry criteria between phases.

## Decisions taken at kickoff

| Question | Decision | Consequence |
|---|---|---|
| Where ideation lives | **Both** — a Project Dashboard page *and* the existing full-screen panel | The dashboard page is the *stage*; the panel is the *canvas*. The dashboard already reserves the `ideation` page id with no tab behind it. |
| What the panel becomes | **Four modes, not one scroll** — Frame / Scaffold / Shape / Decide | The four-stage guide already describes this order; today the UI presents all five sections at once, so the guide describes something the interface does not embody. |
| Which scans get built | **Only the ones no register already owns** | gap, security, risk, debt and testing are answered by existing dashboard pages. A second answer would eventually contradict the first. |
| What a scan produces | **Findings in a register**, not prose in a chat | Mirrors `riskOversightManager` exactly: transitions not deletions, declared rule table, JSON + markdown mirror, capped append-only history. |
| External evidence | **A citation or it is not a finding** | A model's recollection of the market, filed into git-tracked memory and used to steer a roadmap, is the worst failure mode this feature can have. |
| What "scheduled" means | **A scan becomes *due*; running it is a decision** | VS Code has no daemon, and AtlasMind never spends money or reaches the network on a timer without an explicit per-type opt-in. |
| Findings → work | **Reuse the existing chain, add nothing** | Finding → evidence card → `deriveCardRoadmapText` → roadmap item → `roadmapIssueDraft` → issue. All four links already exist. |

## Context — why

### Ideation is stage 0 of the workflow and the only stage you have to leave the dashboard to reach

`ideationDerivation.ts` opens by calling ideation "stage 0 of the workflow". Every other stage —
Workflow, Roadmap, Issues, Pull Requests, Release, Debt, Risk — is a tab inside the Project
Dashboard. Ideation is a separate webview panel behind a command. `DASHBOARD_PAGE_IDS` already
carries `ideation` as "a legal prompt origin with no tab" (`wiki/Architecture.md:168`), so the
placeholder exists and nothing is behind it.

The v0.207.1 changelog states the consequence in its own words: *"A board that is silently discarded
on re-run is a board nobody invests in — which is the honest explanation for why the Ideation surface
felt abandoned."* The erasure bug was fixed. The abandonment was not.

### The panel describes a workflow it does not enforce

`render()` (`media/projectIdeation.js:611`) emits, in order: a stat strip, a collapsible four-card
process guide, the board, the composer, the inspector, the facilitation feedback, and the analytics
section. That is five distinct jobs on one page, and the guide is a *description* of an order the
interface does not impose — four cards reading "1. Frame the problem… 4. Decide what to validate"
above a surface that presents all four at once. A guide that has to explain the layout is the
definition of an unintuitive layout.

The guide has already been moved twice (v0.119.0 to the bottom, v0.212.1 back above the canvas). Both
moves treated placement as the problem. The problem is that it is a guide at all.

### Nothing has ever explained what the board's own vocabulary means

Nine card kinds. `KIND_PREFIX` in `ideationDerivation.ts` decides that a `problem` becomes `Fix: …`
on the roadmap and a `risk` becomes `Mitigate: …`, with a carefully argued rationale in the module
header — and **none of that reaches the person choosing the kind**. Four scored fields (confidence,
evidence strength, risk score, cost to validate) have per-kind defaults in
`defaultConfidenceForKind` and friends, are rendered as sliders, and — as far as the panel is
concerned — drive nothing the user can see. The v0.174.0 settings audit found three settings read by
nothing and made their descriptions say so. The same audit is owed here: wire them or remove them.

### The board can only learn what somebody already typed into it

Every inbound path today is the user or Atlas reflecting on the board's own contents.
`runDeepBoardAnalysis` re-reads what is there. There is no path by which the outside world reaches
the board — no market, no competitor, no customer signal, no funding landscape. So ideation can
structure a decision but cannot inform one, and a board full of confident cards about an unexamined
market looks exactly like a board full of researched ones.

### And it has no documentation

There is no `docs/ideation.md` and no `wiki/Ideation.md`. Every comparable surface has both. The
Architecture wiki paragraph is a feature list. There is no `/ideate` or `/research` slash command.

## The model

### Two questions, and only one of them is new

The user's requested scan list — gap, customer, market, competition, feature, security, funding,
risk — splits cleanly along **where the evidence lives**, and that split decides what gets built.

| Scan | Evidence class | Who answers it today |
|---|---|---|
| `gap` | internal | Project Dashboard → **Gap Analysis** (`project_memory/analysis/gap-analysis.md`) |
| `security` | internal | `securityReviewManager` + Security page |
| `risk` | internal | `riskOversightManager` + Risk page |
| `debt` | internal | `debtRegister` + Tech Debt tab |
| `testing` | internal | `testingPolicyCoverage` + Testing page |
| `feature` | **hybrid** | nobody — needs the repo *and* the outside |
| `market` | external | nobody |
| `competition` | external | nobody |
| `customer` | external | nobody |
| `funding` | external | nobody |
| `regulatory` | external | partly — `compliancePacks.ts` declares obligations, nothing checks the landscape |
| `technology` | external | nobody — the substrate under this project moves monthly |

**Internal scans are not re-implemented. They are subscribed to.** Building a second gap analysis
inside ideation would produce two registers that disagree, and the disagreement would surface as a
board citing evidence the Gap Analysis page denies. This is the same refusal `ideationDerivation.ts`
already made about focus classification: *"a second classifier keyed on card kind would eventually
disagree with it, and the disagreement would surface as an item whose priority reason contradicts its
own label."*

So the research register **reads** the five existing registers and offers their open findings as
evidence for the board. New scanning is built only for the seven questions nobody owns — and those
are exactly the outward-facing ones.

**A hybrid scan must say which half it could not assess.** `feature` needs both the repo (what we
have) and the outside (what comparable products have). With no external source it may report the
first half and must report the second as unassessed. It may not report "no feature gaps".

### The register

Mirrors `riskOversightManager` in shape, because that module already solved this problem:

- `project_memory/analysis/research.json` — the register.
- `project_memory/analysis/research.md` — the human mirror, publishing the rule table and the scan catalog.
- `project_memory/analysis/research-history.json` — capped, append-only.
- Findings **transition, never delete**: `open` → `accepted` / `actioned` / `superseded` / `dismissed`.
  `superseded` (a later scan replaced it) stays distinct from `dismissed` (a human rejected it), because
  collapsing them would report a judgement nobody made.
- Severity and priority come from a **declared rule table**, never a model score. A score assigned in
  March is not comparable with one assigned in July, and comparability across scans is the register's
  whole value. Every finding names the rule that graded it.
- `analysis` is added to `SSOT_FOLDERS`. The folder is already used by gap analysis and is not declared.

### Citations, and what happens without a source

**A finding carries a retrievable citation — URL plus fetched-at — or it is not a finding.** A claim
the model produced from recollection is recorded in a visibly different class, `question`, meaning
"worth researching", and it is never counted, charted or digested as evidence.

Sources, in preference order: the `exa-search` skill (needs a key), a connected MCP research server,
the `web-fetch` skill for a named URL. `researchSources.ts` detects which are available.

**With no source, an external scan returns `no-source` and names the setup step.** It does not return
an empty clean result. This is `attentionFeed.ts`'s rule 5 applied to a second register: *"a page that
could not be read must never contribute to a quiet Overview. Silence earned by not looking is the one
failure mode that would make this section actively harmful."*

### Scheduling — due-ness is a fact, running is a decision

Each scan type declares a cadence (competition 30d, customer 30d, technology 30d, feature 60d, market
90d, funding 90d, regulatory 180d). The schedule computes when a scan is **due**. It does not run one.

Three rungs, matching `workflowConfig`'s master/ceiling model, with `min(master, per-scan)` applying:

| Rung | Behaviour |
|---|---|
| `observe` (default) | Tell me it is due. Nothing runs. |
| `propose` | Draft the scan brief and show it. Running is still a click. |
| `auto` | Run when due, on window activation, within the declared spend cap. Findings always land `open` and needing triage — `auto` never files a decision. |

Due-ness surfaces through the **attention feed** (`src/core/attentionFeed.ts`), with two new rules:
`research-scan-due` at `soon`, and `research-never-scanned` at `unassessed`. Both are `unassessed`
-class citizens of the same rule table. The timer itself reuses `FollowUpScheduler`'s shape — on-activation check plus a
low-frequency interval, throttled once per day, notification-only.

**A missed window is not a backlog.** Six weeks with the editor closed is one due scan, not six. The
schedule reports "due, last run 41 days ago", never a queue of skipped runs.

### Reports

**Per-scan brief** — the register's markdown mirror, one section per scan type: findings with their
citations, the rule that graded each, its age, and what is unassessed.

**The Research Digest** — `project_memory/analysis/research-digest.md`, rolling, answering three
questions in a fixed order:

1. *What changed outside?*
2. *What does it mean for what we are building?*
3. *What is still unassessed?*

Question 3 is non-negotiable and always rendered, even when empty.

Composition is **deterministic** — the digest groups and ranks findings already recorded, each line
citing its finding id, and introduces no new claims. Where a "so what" reading is wanted, an optional
model pass produces it **fenced and unpersisted**, following `agentHandoff`: *"the answer comes back
fenced — another agent's opinion, not a verified result."*

Question 1 is a delta question, so it reuses `observedDelta.ts`'s five anti-lying rules rather than
inventing a sixth set: no baseline is a first look; unknown → known is not zero → n; known → unknown
is news, ranked above the movement it hides; a changed scope discards the baseline; never report your
own actions back. A competition scan going from unassessed to twelve findings is **not** "twelve new
competitors appeared", and only a rule written down in advance stops the digest from saying so.

### The loop closes with machinery that already exists

A finding becomes an **evidence card** on the board — kind `evidence`, which exists, already defaults
to confidence 70, and already supports a `url` media record for the citation. From there:

```
finding → evidence card → deriveCardRoadmapText → roadmap item → roadmapIssueDraft → issue
```

Every arrow after the first is shipped code. The card gains a `sourceFindingId`, so the chain from
"we read this on a competitor's changelog" to "issue #412" is followable in both directions — using
the same normalized-text join `IdeationDerivedRecord` already uses, for the same reason (roadmap ids
are positional and renumber on insert).

## Phases

### C0 — Specification and vocabulary — **shipped v0.225.0**

- **C0.1** Write `docs/ideation-and-research.md`: the scan catalog, the evidence classes, the citation
  rule, the register schema, the rule table, the schedule model, and the digest contract.
- **C0.2** `src/core/researchScanCatalog.ts` — pure. The declared scan types, their evidence class,
  their question, cadence default, and the severity rule table. Unit-tested. No I/O, no `vscode`.
- **C0.3** Settings are **not** declared here. `tests/settingsIntegrity.test.ts` requires every
  declared setting to be read by code, and it is right to: a setting nothing reads is a promise the
  build does not keep. Each `atlasmind.research.*` key is declared in the same commit as the code
  that reads it, and `NOT_READ_BY_DESIGN` is not touched.

**Exit:** the specification is written and the catalog compiles with tests. Nothing is user-visible.

### C1 — The board becomes intuitive

No research. Ships value alone and is the phase the user feels first.

- **C1.1** **Four modes replace the scroll.** Frame / Scaffold / Shape / Decide as a segmented
  control; each mode shows only its own surfaces. The process guide stops being a panel and becomes
  the navigation. Full WAI-ARIA tab pattern, matching the dashboard nav.
- **C1.2** **Real empty states.** `src/core/ideationBoardTemplates.ts` — pure, archetype-aware starter
  frames seeded from `projectArchetype` + `archetypePacks`, so a game project and a CLI tool do not
  open the same blank canvas. Four generic frames alongside: Problem → Solution, Assumption map,
  Competitive position, Customer journey.
- **C1.3** **The kind picker publishes what a kind becomes.** `KIND_PREFIX`'s mapping is rendered at
  the point of choosing — `problem` → `Fix: …`, `risk` → `Mitigate: …`. Same argument as the debt
  register publishing its rule table: a rule you cannot see is a rule you cannot argue with.
- **C1.4** **Audit the four scored fields.** For each of confidence, evidence strength, risk score and
  cost to validate: name what reads it, or remove it. A slider that changes nothing is worse than no
  slider.
- **C1.5** **A board readiness record** — `src/core/ideationReadiness.ts`, pure. Not a gate. "4
  problems, 0 evidence, 1 unresolved contradiction, 6 unrealized cards." Built on the existing
  `unrealizedCards` / `countUnrealizedByKind`, which today have exactly one caller.
- **C1.6** **Keyboard and non-canvas access.** Card and link creation from the keyboard, and an ARIA
  list view of the board as a genuine alternative to the drag surface.
- **C1.7** Docs: `docs/ideation-and-research.md` user section, `wiki/Ideation.md`, README, `wiki/_Sidebar.md`.

**Exit:** a first-time user can open the board, pick a template, understand what a card kind commits
to, and reach the backlog — without reading a guide.

### C2 — Ideation becomes a Project Dashboard page

**Entry:** C1 shipped.

- **C2.1** An `ideation` tab behind the reserved page id, under *Where we stand*. It answers: what is
  on the board, what is unrealized, what became work, what is contradicted.
- **C2.2** **Available evidence, from registers that already exist.** The page reads open findings
  from gap analysis, security, risk, debt and testing coverage and offers each as an evidence card.
  Zero new scanning. This is the whole of the "internal scan" story.
- **C2.3** "Open the canvas" is the one link between page and panel, in both directions.
- **C2.4** `/ideate` chat command: board state, what needs attention, open the canvas.

**Exit:** ideation is reachable without leaving the dashboard, and the five internal registers can
feed the board.

### C3 — The research register

**Entry:** C2 shipped. Still zero network.

- **C3.1** `src/core/researchRegister.ts` — `fs`-only. Persistence, transitions, reconciliation,
  the markdown mirror, capped history. Mirrors `riskOversightManager`.
- **C3.2** Finding → evidence card, with `sourceFindingId` and the citation as a `url` media record.
- **C3.3** The provenance chain rendered in both directions: from a finding, what it became; from a
  roadmap item, what argued for it.
- **C3.4** The register's page section, with the rule table published.

**Exit:** internal findings flow into the board and out to the backlog with provenance intact. The
register works end to end with nothing fetched.

### C4 — External scans

**Entry:** C3 shipped. This is the first phase that reaches the network and spends money.

- **C4.1** `src/core/researchSources.ts` — pure detection of which source is available, and the
  `no-source` result with its setup step.
- **C4.2** New advisor agents: `market-analyst`, `competitive-analyst`, `customer-researcher`,
  `funding-analyst`, `regulatory-analyst`, `technology-analyst`. Prompt shape follows
  `buildRiskAnalysisPrompt` — prose for the transcript, a fenced JSON block for the register, a parser
  that tolerates the model ignoring the contract entirely.
- **C4.3** The **citation gate**: a finding without a retrievable URL and fetch timestamp is demoted
  to `question`. Enforced in the sanitizer, not in a prompt.
- **C4.4** The **untrusted-content boundary**. Fetched pages are exactly as untrusted as an issue
  body: control-stripped, redacted, clamped, count-capped, `https`-only, SSRF-screened, and fenced as
  REPORTED CONTENT wherever they reach a model — a competitor's page reading "ignore your
  instructions" must not become one. **Derive, don't mirror**: the register stores the claim and the
  citation, never the scraped page, because `project_memory/` is git-tracked.
- **C4.5** The `feature` hybrid scan, and its obligation to state which half went unassessed.
- **C4.6** Per-scan cost recorded through `CostTracker`.

**Exit:** an external scan runs on explicit request, produces cited findings or an honest
`no-source`, and its cost is on the record.

### C5 — Scheduling and the digest

**Entry:** C4 shipped and at least one external scan has produced cited findings against a real source.

- **C5.1** `src/core/researchSchedule.ts` — pure, clock injected. Due-ness, cadence, and the
  "one due scan, not six" rule.
- **C5.2** Two new `attentionFeed.ts` rules: `research-scan-due` (`soon`), `research-never-scanned`
  (`unassessed`).
- **C5.3** The three rungs, with `min(master, per-scan)` and every level change stated in the same
  sentence — the `workflowConfig` pattern.
- **C5.4** Spend projection shown **before** `auto` can be enabled, and a hard monthly cap that stops
  runs rather than warning about them.
- **C5.5** `src/core/researchDigest.ts` — pure. The three-question digest, deterministic composition,
  `observedDelta` rules for question 1, the optional fenced model reading.
- **C5.6** `/research` chat command: what is due, run one, read the digest.
- **C5.7** Docs: `wiki/Configuration.md`, `wiki/Chat-Commands.md`, `wiki/Architecture.md`,
  `docs/architecture.md`, `docs/configuration.md`, README.

**Exit:** scans become due on their own, the user is told, running stays a decision, and the digest
reports what changed without inventing a baseline.

## What must not happen

Ten invariants. Each is a property a reviewer can check, not a principle to bear in mind.

1. **No finding without a retrievable citation.** Model recollection is a `question`, never evidence.
2. **Unassessed is never reported as clear.** No source ⇒ `no-source`, never an empty clean report.
3. **Nothing spends money on a timer without a per-type opt-in.** Due is a notification; running is a decision.
4. **Findings transition, never delete.** `superseded` and `dismissed` never collapse.
5. **Fetched content is untrusted input.** Sanitized at the boundary, fenced as REPORTED CONTENT at every model boundary.
6. **Derive, don't mirror.** The claim and its citation reach `project_memory/`; the page does not.
7. **A scan never edits the roadmap.** It produces evidence. A human raises the work.
8. **Severity from a declared rule table, never a model score.** Published in the mirror.
9. **One register per question.** Internal questions are subscribed to, not re-answered.
10. **No silent caps.** Every truncation states its remainder.

## Open questions

- **`funding` versus `commercial-oversight`.** Proposed boundary: **research says what is true
  outside; oversight says what it means for us.** Funding landscape findings land in the research
  register; commercial exposure lands in the risk register; the digest links them. Confirm before C4.2.
- **Where the digest's "so what" comes from.** Fenced model opinion is the safe default. A
  deterministic alternative — rank findings against roadmap focus using the existing keyword table —
  may be better, and would keep the digest model-free end to end. Decide in C5.5.
- **Cross-project research.** `atlasmind.ideation.crossProjectPaths` already reads other boards.
  Whether a scan's findings may be shared across projects is a privacy decision, not a plumbing one.
  Out of scope until C5 ships.
- **Does `technology` overlap `dependency-manager`?** The dependency agent watches versions; a
  technology scan watches the substrate. Probably distinct, possibly not. Confirm before C4.2.

## Documentation triggered by this plan

Per the checklist in `CLAUDE.md`, and in the same commits as the code:

| Change | Files |
|---|---|
| New source files (7 core modules, 6 agents) | `README.md`, `docs/architecture.md`, `docs/development.md`, `wiki/Architecture.md` |
| New settings (`atlasmind.research.*`) | `README.md`, `package.json`, `docs/configuration.md`, `wiki/Configuration.md` |
| New chat commands (`/ideate`, `/research`) | `README.md`, `package.json`, `wiki/Chat-Commands.md` |
| New agents | `docs/agents-and-skills.md`, `wiki/Agents.md` |
| New dashboard page | `docs/development.md`, `wiki/Architecture.md` |
| New SSOT folder (`analysis`) | `docs/ssot-memory.md`, `wiki/Memory-System.md` |
| New network boundary | `wiki/Security.md`, `wiki/Tool-Execution.md` |
| Every commit | `CHANGELOG.md`, `package.json`, `README.md` banner, `wiki/Changelog.md` |

A new `wiki/Ideation.md` and `docs/ideation-and-research.md` are created by this plan and must be
added to `wiki/_Sidebar.md` and the documentation table in `CLAUDE.md`.
