# Ideation and Research

Ideation is **stage 0** of AtlasMind's [guided workflow](GitHub-Workflow). A card on the board
becomes a roadmap item, a roadmap item becomes a GitHub issue draft, and the seven stages after that
are already wired.

What stage 0 could not do until v0.225.0 was **learn anything you had not already typed into it**.
Every way in was you, or Atlas re-reading the board you had filled in — so ideation could structure a
decision but never inform one, and a board full of confident cards about an unexamined market looked
exactly like a board full of researched ones.

Research scans are the missing way in.

---

## The board

### One stage at a time

The workspace runs in four stages, and the bar above them is the guide — not a description of one.

| Stage | What you do |
|---|---|
| **1. Frame** | Describe the problem, set constraints, attach what you already have. Starter frames appear here while the board is empty. |
| **2. Scaffold** | Let Atlas turn the frame into cards and relationships, then read what it proposed. |
| **3. Shape** | Edit cards, connect them, and challenge what the board is claiming. |
| **4. Decide** | Read what the board can and cannot defend, then raise the work. |

Only the stage you pick renders. The board itself stays above all four, because three versions of
this layout have been spent learning that the whiteboard is the point of the panel.

The status on each button describes **where the board is**, not which stage you happen to be
reading — so the bar stays an honest summary while you look ahead. And which stage opens is derived
rather than remembered: an empty board opens on Frame, a populated one on Shape.

### What a card kind commits to

The kind you choose decides how the card reads once it reaches the roadmap, and the picker now says
so:

| Kind | On the roadmap |
|---|---|
| `problem` | **Fix: …** — the work is the fix, not the problem |
| `risk` | **Mitigate: …** — the work is the mitigation |
| `experiment` | **Trial: …** — a question to answer, not a decision already taken |
| `idea`, `requirement` | The title, unchanged. Putting an idea on the roadmap *is* the commitment |
| `evidence`, `user-insight` | Can be raised, but earn more as support: link them and they travel with the card into the issue |
| `atlas-response`, `attachment` | Not work. Make a card for what you want done and link this one to it |

### Starter frames

An empty board is the hardest screen in AtlasMind: everything else opens onto something — a
repository, a backlog, a register — and the whiteboard opens onto nothing.

Eleven starter frames are derived from your project's detected shape, so a game and a command-line
tool do not open the same blank canvas:

| Frame | When it is the right one |
|---|---|
| Core loop | A game: the first question is what the player does thirty seconds in |
| Command surface | A CLI: the interface *is* the product, and it is very hard to change later |
| The contract | An API: a promise to somebody you will never meet |
| What consumers depend on | A library: one that is used is one that cannot change |
| The first session | A web app: most of the value happens in somebody's first ten minutes |
| The moment of use | Mobile: standing up, one-handed, interrupted |
| Living in the window | Desktop: opened in the morning, closed at night |
| What it says | A website: understood in about eight seconds, or not at all |
| Personal data | Holds data about people, which changes what "done" means |
| Somebody else's platform | Ships onto a marketplace whose rules are not yours |
| Problem → solution · Assumption map · Competitive position · Customer journey | Always offered, whatever was detected |

**Every seeded card is a question, not an answer.** A template arriving with confident-sounding
conclusions would be thinking nobody did, presented as thinking somebody did — and it would set the
agenda for the board before you had a chance to.

### Readiness

A reading of what the board can and cannot defend, from ten declared rules. Each one publishes the
rule that produced it, so a verdict can be argued with rather than only trusted or ignored.

Ranked by consequence:

1. **An unresolved contradiction** — the board is the one surface in AtlasMind that records an
   argument *against* doing something. Burying that under "3 cards have no evidence" would waste the
   only thing this surface knows that an issue tracker does not.
2. Problems with nothing behind them, boards that are mostly ideas, boards where nothing could go
   wrong, unconnected cards, and cards that never reached the backlog.

**It blocks nothing.** A release gate exists because a release cannot be undone; a board can always
be edited, so a gate would be theatre with a cost. An empty board reads *unexamined* — never clear.

### The dashboard overview

**Project Dashboard → Where we stand → Ideation** is the stage-0 overview; the dedicated panel is
still the canvas. The overview shows active cards, cards that have not become work, current roadmap
origins, unresolved contradictions, and every readiness observation with the rule that produced it.

It also lists open records from Gap Analysis, Security Review, Risk Oversight, Tech Debt, and
Testing Coverage as **available evidence**. It does not run any scanner or model call. Choosing
**Add evidence card** sends only the record's opaque id back to the host, which re-reads the current
snapshot before handing a bounded seed to the canvas. The canvas makes the write and deliberately
does not connect the new card: deciding what evidence supports remains a human judgement.

**Open canvas** links the overview to the board, and **Ideation overview** in the canvas links back.
`/ideate` reports the same board state and needs-attention reading in chat, with buttons for both
surfaces; it is read-only.

---

## Research scans

### The seven questions

| Scan | Asks | Default cadence |
|---|---|---|
| Competition | Who else solves this, how are they positioned, what have they shipped? | 30 days |
| Customer | Who uses this kind of product, what do they ask for, where do they complain? | 30 days |
| Technology | What is changing underneath this — platforms, dependencies, standards? | 30 days |
| Feature gap | What do comparable products offer that this project does not? | 60 days |
| Market | How large is this category, where is it going, what is adjacent to it? | 90 days |
| Funding | What grants, programmes, sponsorship or pricing comparables apply? | 90 days |
| Regulatory | What obligations apply to a product of this shape, and what is changing? | 180 days |

### Why gap, security, risk and debt are not on that list

They already have answers. Gap analysis, the [security review](Security), the risk register and the
tech-debt register each own their question, and a second scanner would eventually disagree with the
first — surfacing as a board citing evidence the Gap Analysis page denies.

Those five are *subscribed to*, not re-scanned. A scan is only built where the evidence lives outside
your repository, because that is where nothing owns the question.

### A citation, or it is not a finding

The single rule the whole feature rests on.

A model asked about a market will answer. The answer will be fluent, specific, plausible — and
indistinguishable from a researched one. Filed into `project_memory/`, which is committed, and read
six weeks later by somebody deciding what to build, it is indistinguishable from evidence.

So:

- A **finding** carries a retrievable `https` URL and the time it was fetched.
- A claim without one is recorded as a **question to research**. It is not thrown away — a hunch is
  worth writing down — but it is never counted as evidence, never charted, and never reported as
  something that changed.
- The check lives in the sanitizer, not in the prompt. A prompt is a request; a sanitizer is a
  guarantee. It also survives a hand-edit of the register file.

### With no way to look, AtlasMind refuses

Before a scan runs, AtlasMind works out whether anything *could* have looked: an EXA key, a connected
MCP search tool, or the built-in fetch. With none of them, the scan records that it could not look
and names the setup step. **It never falls back to the model's recollection**, and it never reaches
the model at all.

Fetching a page you name is kept separate from finding one nobody has. A fetch-only project running a
competition scan would receive a recollection with one real citation stapled to it — worse than no
scan, because it looks sourced. A feature-gap scan can still run in that state: it reads your
repository for the half it can answer, and says which half it could not.

### How a finding is graded

Severity comes from a **declared rule table evaluated over facts**, never from a model's sense of
importance — because a score assigned in March has to be comparable with one assigned in July.

| Rule | Severity |
|---|---|
| A regulatory obligation with a deadline still ahead | high |
| A funding opportunity with a deadline still ahead | high |
| A competitor or comparable product covering something your roadmap also claims | high |
| A platform, dependency or standard with an announced end of life | medium |
| The same claim carried by two or more independent sources | medium |
| A deadline that has already passed | low |
| A single cited observation | low |
| No citation | *not a finding — recorded as a question* |

Every finding names the rule that graded it, and the table is published in the register itself.

### Findings transition; nothing is deleted

`open` → `accepted` / `actioned` / `superseded` / `dismissed`. A later scan that does not reproduce
an open finding marks it *superseded*; one you accepted, actioned or dismissed is never touched,
because a decision outlives the scan that prompted it. `superseded` and `dismissed` stay separate —
one says the world moved, the other says a person disagreed.

---

## Scheduling

**Due is a fact. Running is a decision.**

VS Code has no background daemon, and these scans reach the network and spend on a model. So
AtlasMind works out when a scan is past its cadence and tells you — it does not, by default, run one.

| Level | What happens |
|---|---|
| `observe` *(default)* | You are told a scan is due. Nothing runs. |
| `propose` | The scan brief is drafted. Running it is still a click. |
| `auto` | A due scan runs on window activation, inside the spend cap. Findings still land open and need triage. |

The effective level is the lower of the master ceiling and the scan's own, and any reduction is
stated in the same sentence as the request.

Two behaviours worth knowing:

- **A missed window is not a backlog.** Six weeks with the editor closed produces one due scan, not
  six. An automatic pass runs exactly one scan — never-assessed before merely overdue.
- **A failed attempt does not reset the clock.** Due-ness is measured from the last run that actually
  answered, so a failure yesterday does not make a scan that last worked in May look current.

Spend is capped by `atlasmind.research.monthlySpendCapUsd`, which defaults to `0` — nothing may run
on its own until you say what it may cost. Switching research on and letting it run unattended are
deliberately two separate decisions.

---

## The digest

`AtlasMind: Open the Research Digest` writes `project_memory/analysis/research-digest.md` and answers
three questions in a fixed order:

1. **What changed outside?**
2. **What does it mean for what we are building?**
3. **What is still unassessed?**

The third always renders, including when it is empty. Dropping it when inconvenient is how a digest
starts congratulating you for not looking.

**No model writes any of it.** Each scan's "so what" is a sentence declared once and published, so it
can be argued with — and the same register always produces the same digest, which is what makes it
reviewable and diffable in git.

The "what changed" section refuses five ways of lying:

- **No baseline is a first look**, not eighteen changes.
- **Unknown → known is not zero → n.** A competition scan going from never-run to twelve findings is
  not twelve competitors appearing.
- **Known → unknown is news**, ranked *above* the movement it hides — a scan that can no longer run
  explains the quiet underneath it.
- **A changed project discards the baseline** rather than subtracting two unrelated readings.
- **Your own dismissals are never reported back at you.**

The baseline is stored per developer, never in the tracked project memory: a shared one would mean
"when did *anybody* last read this", and two people opening it on the same day would fight over it.

---

## From a finding to shipped work

```
finding → evidence card → roadmap item → GitHub issue draft
```

Only the first arrow is new. A finding becomes a card of kind `evidence` carrying its citation, and
the board's existing connection, derivation and drafting paths carry it the rest of the way. The card
records the finding it came from, so the chain from *"we read this on a competitor's changelog"* to
*"issue #412"* is followable in both directions.

**A scan never edits the roadmap.** It produces evidence. You raise the work.

---

## Where things live

| File | Contents |
|---|---|
| `project_memory/analysis/research.json` | The register — source of truth |
| `project_memory/analysis/research.md` | The human mirror, publishing the rule table and the catalog |
| `project_memory/analysis/research-history.json` | Capped, append-only run history |
| `project_memory/analysis/research-digest.md` | The rolling digest |

The register stores a claim and the URL it came from — **never the page**. `project_memory/` is
committed, and mirroring somebody else's site into your repository would be a licensing problem
wearing a feature's clothes.

---

## Commands and settings

| Command | What it does |
|---|---|
| `/research` | Findings, what is due, what is blocked, and what has never been assessed |
| `AtlasMind: Run a Research Scan` | Runs one scan, after a confirmation naming the scan, the source and the cost |
| `AtlasMind: Open the Research Register` | The findings and the rules that graded them |
| `AtlasMind: Open the Research Digest` | What changed, what it means, what is unassessed |

Settings are documented in [Configuration](Configuration) under `atlasmind.research.*`. The
specification is [`docs/ideation-and-research.md`](../docs/ideation-and-research.md).
