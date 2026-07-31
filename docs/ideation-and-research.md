# Ideation and Research

> **Specification.** Normative for the ideation board's role in the workflow and for the research
> register that feeds it. The phased implementation plan is
> [`project_memory/roadmap/ideation-and-research.md`](../project_memory/roadmap/ideation-and-research.md).
> Where the two disagree, this document wins.

Ideation is **stage 0** of AtlasMind's guided workflow. A card becomes a roadmap item
([`src/core/ideationDerivation.ts`](../src/core/ideationDerivation.ts)), a roadmap item becomes a
GitHub issue draft ([`src/core/roadmapIssueDraft.ts`](../src/core/roadmapIssueDraft.ts)), and the
seven stages after that are already specified in
[the guided workflow](guided-github-workflow.md).

What stage 0 could not do is **learn anything nobody had already typed into it**. Every inbound path
was the user, or Atlas reflecting on the board's existing contents. The research register is the
missing inbound edge: a scan asks a question about the world outside the repository, records what it
found *with citations*, and offers each finding to the board as evidence.

---

## 1. Two questions, and only one of them is new

A scan is classified by **where its evidence lives**, and that classification decides whether
AtlasMind builds a scanner for it at all.

| Class | Meaning | AtlasMind's job |
|---|---|---|
| `internal` | The evidence is in this repository | **Subscribe** to the register that already owns the question |
| `external` | The evidence is outside this repository | **Scan**, and cite |
| `hybrid` | Both halves are needed to answer it | Scan, cite, and **name the half that went unassessed** |

Five questions are already owned:

| Question | Owned by |
|---|---|
| gap | Project Dashboard → Gap Analysis (`project_memory/analysis/gap-analysis.md`) |
| security | [`src/core/securityReviewManager.ts`](../src/core/securityReviewManager.ts) |
| risk | [`src/core/riskOversightManager.ts`](../src/core/riskOversightManager.ts) |
| debt | [`src/core/debtRegister.ts`](../src/core/debtRegister.ts) |
| testing | [`src/core/testingPolicyCoverage.ts`](../src/core/testingPolicyCoverage.ts) |

**These are not re-implemented.** A second gap analysis inside ideation would eventually contradict
the first, and the contradiction would surface as a board citing evidence the Gap Analysis page
denies. This is the same refusal `ideationDerivation.ts` already made about focus classification:
*"a second classifier keyed on card kind would eventually disagree with it, and the disagreement
would surface as an item whose priority reason contradicts its own label."*

The catalog therefore declares **seven scannable questions**, all of which reach outside the
repository, and records the five internal ones as subscriptions rather than scans.

### 1.1 The catalog

Declared once in [`src/core/researchScanCatalog.ts`](../src/core/researchScanCatalog.ts), published
in the register's markdown mirror, and the only place a scan type may be introduced.

| Scan | Class | Question | Cadence |
|---|---|---|---|
| `competition` | external | Who else solves this, how are they positioned, what have they shipped recently? | 30 days |
| `customer` | external | Who uses this kind of product, what do they ask for, where do they complain? | 30 days |
| `technology` | external | What is changing underneath this project — platforms, dependencies, standards? | 30 days |
| `feature` | hybrid | What do comparable products offer that this project does not? | 60 days |
| `market` | external | How large is this category, where is it going, what adjacent categories touch it? | 90 days |
| `funding` | external | What grants, programmes, sponsorship or pricing comparables apply? | 90 days |
| `regulatory` | external | What obligations apply to a product of this shape, and what is changing? | 180 days |

Cadence is a **default, not a policy** — a project may override any of them.

### 1.2 The boundary with oversight

`funding` and `regulatory` sit close to the `commercial-oversight` and `legal-oversight` advisors.
The line is:

> **Research says what is true outside. Oversight says what it means for us.**

A funding programme's existence and deadline is a research finding. Whether this project's licensing
makes it ineligible is a commercial risk finding. They live in different registers and the digest
links them.

---

## 2. A citation, or it is not a finding

The single safety-critical rule in this feature.

A model asked about a market will answer. The answer will be fluent, specific, plausible, and
indistinguishable from a researched one. Filed into `project_memory/` — which is git-tracked — and
read six weeks later by somebody deciding what to build, it is indistinguishable from evidence.

So:

- A **finding** carries a retrievable citation: an `https` URL and the timestamp at which it was
  fetched. Without both, it is not a finding.
- A claim with no citation is recorded as a **question** — "worth researching" — in a visibly
  different class. Questions are never counted as evidence, never charted, and never summarised in
  the digest's *what changed* section.
- The demotion happens in the **sanitizer**, not in a prompt. A prompt is a request; a sanitizer is
  a guarantee.

### 2.1 Sources, and the absence of one

Detected by [`src/core/researchSources.ts`](../src/core/researchSources.ts), in preference order:

1. `exa-search` — the EXA web-search skill, when a key is stored.
2. A connected MCP server exposing a search or fetch tool.
3. `web-fetch` — sufficient for a scan aimed at named URLs, insufficient for open discovery.

**With no source, an external scan returns `no-source`.** It does not return an empty clean result,
and it does not fall back to the model's recollection. The result names the setup step that would fix
it. This is [`src/core/attentionFeed.ts`](../src/core/attentionFeed.ts)'s rule 5 applied to a second
register: *silence earned by not looking is the one failure mode that would make this actively
harmful.*

A `hybrid` scan with no external source reports its internal half and marks the external half
`unassessed`. It may not report "no feature gaps".

### 2.2 Fetched content is untrusted input

A competitor's landing page is exactly as untrusted as a GitHub issue body, and the mitigations are
the ones `issueTracker.ts` already established:

- control characters stripped, length clamped, count capped;
- `https` only, SSRF-screened, non-`https` links dropped;
- secrets redacted before anything is stored or sent;
- fenced and labelled **REPORTED CONTENT** wherever it reaches a model, so a page reading "ignore
  your instructions" cannot become one;
- **derive, don't mirror** — the register stores the claim and the citation, never the page body,
  because `project_memory/` is committed and mirroring would commit somebody else's site into this
  repository.

---

## 3. The register

Persisted under `project_memory/analysis/`:

| File | Contents |
|---|---|
| `research.json` | The register |
| `research.md` | Human mirror — findings, the rule table, the catalog, what is unassessed |
| `research-history.json` | Capped, append-only run history |
| `research-digest.md` | The rolling digest (§5) |

Implemented by [`src/core/researchRegister.ts`](../src/core/researchRegister.ts), which mirrors
`riskOversightManager` in shape: `fs`-only, no `vscode` import, unit-tested in isolation.

### 3.1 Findings transition; they are never deleted

| Status | Meaning |
|---|---|
| `open` | Recorded, nobody has decided anything |
| `accepted` | Judged true and relevant; kept as standing context |
| `actioned` | Became work — a card, a roadmap item, or an issue |
| `superseded` | A later scan replaced it |
| `dismissed` | A human rejected it |

`superseded` and `dismissed` never collapse into one status. One says the world moved; the other says
a person disagreed. Collapsing them would report a judgement nobody made.

### 3.2 Severity comes from a declared rule, never a model

A score assigned in March is not comparable with one assigned in July, and comparability across scans
is the register's entire value. Every finding names the rule that graded it, and the rule table is
published in `research.md`.

The table is ordered; **first match wins**:

| Rule | Severity |
|---|---|
| A regulatory obligation with a stated deadline | `high` |
| A competitor shipping something this project's roadmap also claims | `high` |
| A funding opportunity with a stated deadline | `high` |
| A named, repeated customer complaint about this category | `medium` |
| A dependency, platform or standard with an announced end of life | `medium` |
| A feature present in two or more comparable products and absent here | `medium` |
| Anything else carrying a citation | `low` |
| No citation | *not a finding — recorded as a question* |

Severity **does not drift with age**, for the reason the debt register gives: an entry whose grade
changed while the evidence did not could not be compared with last month's. Age is reported as its
own fact.

### 3.3 Reconciliation

A re-scan of the same type does not wipe the previous findings. Incoming findings are matched against
existing ones on normalized title plus citation host; a match updates in place and keeps the human
decision, a miss is added as `open`, and an existing `open` finding that the new scan did not
reproduce becomes `superseded` — never deleted, and never silently dropped.

Findings that a human has `accepted`, `actioned` or `dismissed` are **never** auto-superseded. A
decision outlives the scan that prompted it.

---

## 4. Scheduling: due is a fact, running is a decision

VS Code extensions have no daemon, and these scans reach the network and spend money. So AtlasMind
computes **when a scan is due** and does not, by default, run one.

[`src/core/researchSchedule.ts`](../src/core/researchSchedule.ts) is pure and clock-injected.

### 4.1 The ladder

Three rungs, with the effective level being `min(master, per-scan)` — the same ceiling model
`workflowConfig` uses, and every level change is stated in the same sentence as the request.

| Rung | Behaviour |
|---|---|
| `observe` *(default)* | Report that the scan is due. Nothing runs. |
| `propose` | Draft the scan brief and show it. Running is still a click. |
| `auto` | Run when due, on window activation, inside the declared spend cap. |

`auto` **never files a decision**: findings land `open` and needing triage, exactly as if a human had
pressed the button.

### 4.2 A missed window is not a backlog

Six weeks with the editor closed produces **one** due scan, not six. The schedule reports "due, last
run 41 days ago". A queue of skipped runs would be an artefact of when somebody opened their editor,
not of anything that happened.

### 4.3 Due-ness surfaces where attention already lives

Two rules join [`src/core/attentionFeed.ts`](../src/core/attentionFeed.ts):

- `research-scan-due` — `soon`. An enabled scan is past its cadence.
- `research-never-scanned` — `unassessed`. An enabled scan has never run, which is unknown rather
  than clean.

### 4.4 Spend

Every scan records its cost through `CostTracker`. `auto` cannot be enabled without the projected
monthly spend being shown first, and the declared cap **stops** runs rather than warning about them.
A recurring background spend nobody estimated is why features get switched off.

---

## 5. The digest

[`src/core/researchDigest.ts`](../src/core/researchDigest.ts) composes `research-digest.md`. It
answers three questions in a fixed order:

1. **What changed outside?**
2. **What does it mean for what we are building?**
3. **What is still unassessed?**

Question 3 is always rendered, including when it is empty. Dropping it when it is inconvenient is
how a digest starts congratulating you for not looking.

### 5.1 The digest introduces no claims

Composition is deterministic: it groups and ranks findings that are already in the register, and
every line carries the finding id it came from. The same register produces the same digest, which is
what makes it reviewable.

Where a "so what" reading is wanted, an optional model pass produces one **fenced and unpersisted** —
following `agentHandoff`: *the answer comes back fenced, another agent's opinion rather than a
verified result.*

### 5.2 Question 1 is a delta, so it obeys the delta rules

"What changed outside" is the same question [`src/core/observedDelta.ts`](../src/core/observedDelta.ts)
already answers about the repository, and it reuses that module's five rules rather than inventing a
sixth set:

1. **No baseline is a first look** — not "twelve changes".
2. **Unknown → known is not zero → n.** A competition scan going from unassessed to twelve findings
   is not twelve new competitors appearing.
3. **Known → unknown is news**, ranked *above* the movement it hides.
4. **A changed scope discards the baseline** rather than subtracting two unrelated readings.
5. **Never report your own actions back** — a finding you dismissed yesterday is not news today.

Ranking is by consequence, not magnitude, with declaration order breaking ties so the digest cannot
shuffle between renders. Caps state their remainder.

---

## 6. Findings become work through machinery that already exists

```
finding → evidence card → deriveCardRoadmapText → roadmap item → roadmapIssueDraft → issue draft
```

Every arrow after the first is shipped code. A finding becomes a card of kind `evidence` — which
already defaults to confidence 70 and already supports a `url` media record for the citation — and
the board's existing connection, derivation and drafting paths carry it the rest of the way.

The card records the finding id it came from, so the chain from *"we read this on a competitor's
changelog"* to *"issue #412"* is followable in both directions. The join uses normalized text, for
the same reason `IdeationDerivedRecord` does: roadmap ids are positional and renumber on insert.

**A scan never edits the roadmap.** It produces evidence. A human raises the work.

---

## 7. Invariants

Ten properties a reviewer can check, rather than principles to bear in mind.

1. No finding without a retrievable citation. Model recollection is a question, never evidence.
2. Unassessed is never reported as clear. No source yields `no-source`, never an empty clean report.
3. Nothing spends money on a timer without a per-scan opt-in.
4. Findings transition, never delete. `superseded` and `dismissed` never collapse.
5. Fetched content is untrusted input, sanitized at the boundary and fenced at every model boundary.
6. Derive, don't mirror. The claim and its citation are stored; the page is not.
7. A scan never edits the roadmap.
8. Severity from a declared rule table, never a model score, published in the mirror.
9. One register per question. Internal questions are subscribed to, not re-answered.
10. No silent caps. Every truncation states its remainder.

---

## 8. The board itself

The research register is the inbound half. The board is where the evidence lands, and it is
specified by three properties that were missing when it was only a whiteboard.

**A stage, not a scratchpad.** Ideation is reachable as **Project Dashboard → Where we stand →
Ideation** as well as the full-screen canvas. The page is the stage — what is on the board, what is
unrealized, what currently has a roadmap origin, and what is contradicted. The canvas is the canvas.

The page also offers *available evidence* from the five internal owners named in §1: Gap Analysis,
Security Review, Risk Oversight, Tech Debt, and Testing Coverage. It does not run a second scanner,
ask a model, or make a claim of its own. The webview supplies only an opaque record id; the host
rebuilds the snapshot and resolves that id before opening the canvas, which is the sole board writer.
The imported card is deliberately left unconnected: a record existing in a register does not by
itself prove which board claim it supports. **Open canvas** is the one deliberate link in both
directions. `/ideate` gives the same read-only state and readiness reading in chat.

**The vocabulary is published at the point of choosing.** `KIND_PREFIX` in `ideationDerivation.ts`
decides that a `problem` becomes `Fix: …` on the roadmap and a `risk` becomes `Mitigate: …`. That
mapping is rendered where a kind is picked. A rule you cannot see is a rule you cannot argue with —
the same argument the debt register makes for publishing its rule table.

**An empty board is a starting point, not a blank.**
[`src/core/ideationBoardTemplates.ts`](../src/core/ideationBoardTemplates.ts) derives starter frames
from the project's archetype and traits, so a game project and a CLI tool do not open the same empty
canvas, alongside four general frames: Problem → Solution, Assumption map, Competitive position,
Customer journey.

**Readiness is a record, not a gate.**
[`src/core/ideationReadiness.ts`](../src/core/ideationReadiness.ts) states what the board has and
has not — problems without evidence, unresolved contradictions, cards that never became work — and
blocks nothing. `unknown` is never rendered as ready, following `releasePreparation`.

---

## 9. Settings

Declared in the same commit as the code that reads them; `tests/settingsIntegrity.test.ts` enforces
that and is not to be weakened.

| Setting | Default | Purpose |
|---|---|---|
| `atlasmind.research.enabled` | `false` | Master gate. Deny by default. |
| `atlasmind.research.automationLevel` | `observe` | The ceiling every scan's own level is capped by. |
| `atlasmind.research.scans` | `{}` | Per-scan `{ enabled, cadenceDays, automationLevel }` overrides. |
| `atlasmind.research.searchSource` | `auto` | `auto` / `exa` / `mcp` / `web-fetch` / `none`. |
| `atlasmind.research.monthlySpendCapUsd` | `0` | `0` means no automatic run may spend anything. |
