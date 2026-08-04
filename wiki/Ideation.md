# Ideation and Research

**A place to think before you build — that actually connects to what you build.**

Most whiteboarding tools are a dead end: you have a great session, take a photo, and never open it
again. AtlasMind's ideation board is **stage 0 of the workflow**, which means a card on the board can
become a roadmap item, and a roadmap item can become a GitHub issue draft. The seven stages after that
are already wired.

It also does something a whiteboard can't: **go and find out things you don't already know**, and record
them with a source you can click.

Open it with **AtlasMind: Open Project Ideation**, or from **Project Dashboard → Ideation**.

---

## The board

### One stage at a time

The workspace runs in four stages, and only the one you pick renders. The board itself stays visible
above all four, because the whiteboard is the point of the panel.

| Stage | What you do |
|---|---|
| **1. Frame** | Describe the problem, set constraints, attach what you already have. Starter frames appear here while the board is empty |
| **2. Scaffold** | Let Atlas turn the frame into cards and relationships, then read what it proposed |
| **3. Shape** | Edit cards, connect them, and challenge what the board is claiming |
| **4. Decide** | Read what the board can and can't defend, then raise the work |

The status on each button tells you **where your board actually is**, not which stage you happen to be
looking at — so the bar stays honest while you browse ahead. Which stage opens is worked out rather than
remembered: an empty board opens on Frame, a populated one on Shape.

### What each card kind commits to

The kind you pick decides how the card reads once it reaches the roadmap:

| Kind | On the roadmap |
|---|---|
| `problem` | **Fix: …** — the work is the fix, not the problem |
| `risk` | **Mitigate: …** — the work is the mitigation |
| `experiment` | **Trial: …** — a question to answer, not a decision already made |
| `idea`, `requirement` | The title, unchanged. Putting an idea on the roadmap *is* the commitment |
| `evidence`, `user-insight` | Can be raised, but earn more as support — link them and they travel with the card into the issue |
| `atlas-response`, `attachment` | Not work. Make a card for what you want done and link this one to it |

### Starting from nothing

An empty board is the hardest screen in AtlasMind. Everything else opens onto something — a repository,
a backlog, a register — and the whiteboard opens onto nothing.

So AtlasMind offers **starter frames derived from your project's actual shape**. A game and a
command-line tool don't get the same blank canvas.

| Frame | When it's the right one |
|---|---|
| **Core loop** | A game — the first question is what the player does thirty seconds in |
| **Command surface** | A CLI — the interface *is* the product, and it's very hard to change later |
| **The contract** | An API — a promise to somebody you'll never meet |
| **What consumers depend on** | A library — one that's used is one that can't change |
| **The first session** | A web app — most of the value happens in someone's first ten minutes |
| **The moment of use** | Mobile — standing up, one-handed, interrupted |
| **Living in the window** | Desktop — opened in the morning, closed at night |
| **What it says** | A website — understood in about eight seconds, or not at all |
| **Personal data** | You hold data about people, which changes what "done" means |
| **Somebody else's platform** | You ship onto a marketplace whose rules aren't yours |
| **Problem → solution · Assumption map · Competitive position · Customer journey** | Always offered, whatever was detected |

**Every seeded card is a question, not an answer.** A template arriving with confident conclusions would
be thinking nobody did, presented as thinking somebody did — and it would set the agenda before you got
a say.

### Readiness — what your board can't defend

A reading of the board against ten declared rules. Each result publishes the rule that produced it, so
you can argue with a verdict rather than just trust or ignore it.

Ranked by consequence:

1. **An unresolved contradiction.** The board is the one place in AtlasMind that records an argument
   *against* doing something. Burying that under "3 cards have no evidence" would waste the only thing
   this surface knows that an issue tracker doesn't.
2. Then: problems with nothing behind them, boards that are mostly ideas, boards where nothing could go
   wrong, unconnected cards, and cards that never reached the backlog.

**It blocks nothing.** A release gate exists because a release can't be undone; a board can always be
edited, so a gate would be theatre with a cost.

An empty board reads *unexamined* — never *clear*. Not having looked is different from having looked and
found nothing.

### The dashboard view

**Project Dashboard → Ideation** is the overview; the dedicated panel is still the canvas. The overview
shows active cards, cards that haven't become work, what's currently on the roadmap, unresolved
contradictions, and every readiness observation with its rule.

It also lists open records from Gap Analysis, Security Review, Risk, Tech Debt and Testing Coverage as
**available evidence** — without running any scan or model call. Choosing **Add evidence card** puts it
on the board and deliberately **leaves it unconnected**: deciding what a piece of evidence supports is a
human judgement.

`/ideate` gives you the same reading in chat, read-only, with buttons to both surfaces.

---

## Research scans

### The seven questions

| Scan | Asks | Default cadence |
|---|---|---|
| **Competition** | Who else solves this, how are they positioned, what have they shipped? | 30 days |
| **Customer** | Who uses this kind of product, what do they ask for, where do they complain? | 30 days |
| **Technology** | What's changing underneath this — platforms, dependencies, standards? | 30 days |
| **Feature gap** | What do comparable products offer that this project doesn't? | 60 days |
| **Market** | How large is this category, where is it going, what's adjacent? | 90 days |
| **Funding** | What grants, programmes, sponsorship or pricing comparables apply? | 90 days |
| **Regulatory** | What obligations apply to a product of this shape, and what's changing? | 180 days |

### Why security, risk, gaps and debt aren't on that list

They already have answers. Gap analysis, the [[Security|security review]], the risk register and the
tech-debt register each own their question — and a second scanner would eventually disagree with the
first, which would show up as a board citing evidence that another page denies.

Those are *read from*, not re-scanned. A scan only exists where the evidence lives **outside your
repository**, because that's where nothing owns the question yet.

### A citation, or it isn't a finding

This is the rule the whole feature rests on.

Ask a model about a market and it will answer. The answer will be fluent, specific, plausible — and
indistinguishable from a researched one. Filed into your committed project memory and read six weeks
later by somebody deciding what to build, it's indistinguishable from evidence.

So:

- A **finding** carries a retrievable HTTPS link and the time it was fetched.
- A claim without one is recorded as a **question to research**. It isn't thrown away — a hunch is worth
  writing down — but it's never counted as evidence, never charted, and never reported as something that
  changed.
- The check is enforced when the data is saved, not requested in a prompt. A prompt is a request; this is
  a guarantee. It also survives someone hand-editing the file.

### If it can't look, it says so

Before a scan runs, AtlasMind works out whether anything *could* have looked — an EXA key, a connected
search tool, or the built-in fetch. With none of them, the scan records that it couldn't look and names
the setup step.

**It never falls back to what the model remembers.** It doesn't reach the model at all.

Fetching a page you name is treated as different from finding one nobody knows about. A fetch-only
project running a competition scan would get a recollection with one real citation stapled to it —
worse than no scan, because it *looks* sourced. A feature-gap scan can still run in that state: it reads
your repository for the half it can answer and tells you which half it couldn't.

### How findings are graded

Severity comes from a **published rule table applied to facts**, never from a model's sense of
importance — because a score from March has to be comparable with one from July.

| Rule | Severity |
|---|---|
| A regulatory obligation with a deadline still ahead | high |
| A funding opportunity with a deadline still ahead | high |
| A competitor covering something your roadmap also claims | high |
| A platform, dependency or standard with an announced end of life | medium |
| The same claim from two or more independent sources | medium |
| A deadline that's already passed | low |
| A single cited observation | low |
| No citation | *not a finding — recorded as a question* |

Every finding names the rule that graded it, and the table is printed in the register itself.

### Findings change state; nothing is deleted

`open` → `accepted` / `actioned` / `superseded` / `dismissed`.

A later scan that doesn't reproduce an open finding marks it *superseded*. One you accepted, actioned or
dismissed is never touched, because **your decision outlives the scan that prompted it**.

`superseded` and `dismissed` stay separate: one says the world moved, the other says a person disagreed.

---

## When scans happen

**Being due is a fact. Running one is your decision.**

VS Code has no background service, and these scans reach the network and spend money on a model. So
AtlasMind works out when a scan is past its cadence and tells you — it does not, by default, run one.

| Level | What happens |
|---|---|
| `observe` *(default)* | You're told a scan is due. Nothing runs |
| `propose` | The brief is drafted. Running it is still a click |
| `auto` | A due scan runs when you open the window, inside the spend cap. Findings still land open and need your triage |

Two behaviours worth knowing:

- **A missed window is not a backlog.** Six weeks with the editor closed produces *one* due scan, not
  six. An automatic pass runs exactly one — never-assessed before merely overdue.
- **A failed attempt doesn't reset the clock.** Being due is measured from the last run that actually
  answered, so a failure yesterday doesn't make a scan that last worked in May look current.

Spend is capped by `atlasmind.research.monthlySpendCapUsd`, which **defaults to `0`** — nothing may run
on its own until you say what it may cost. Switching research on and letting it run unattended are two
separate decisions on purpose.

---

## The digest

**AtlasMind: Open the Research Digest** answers three questions, in this order:

1. **What changed outside?**
2. **What does it mean for what we're building?**
3. **What's still unassessed?**

The third always appears, including when it's empty. Dropping it when it's inconvenient is how a digest
starts congratulating you for not looking.

**No model writes any of it.** Each scan's "so what" is a sentence declared once and published, so you
can argue with it — and the same register always produces the same digest, which is what makes it
reviewable and diffable in git.

The "what changed" section refuses five ways of misleading you:

- **No baseline is a first look**, not eighteen changes
- **Unknown → known is not zero → n.** A competition scan going from never-run to twelve findings is not
  twelve competitors appearing
- **Known → unknown is news**, ranked *above* the movement it hides — a scan that can no longer run
  explains the quiet underneath it
- **A changed project discards the baseline** rather than subtracting two unrelated readings
- **Your own dismissals are never reported back at you**

The baseline is stored **per developer**, never in shared project memory. A shared one would mean "when
did *anybody* last read this", and two people opening it the same day would fight over it.

---

## From a finding to shipped work

```
finding → evidence card → roadmap item → GitHub issue draft
```

A finding becomes a card carrying its citation, and the board's normal connection and drafting paths
carry it the rest of the way. The card records where it came from, so the chain from *"we read this on a
competitor's changelog"* to *"issue #412"* is followable in both directions.

**A scan never edits your roadmap.** It produces evidence. You raise the work.

---

## Where it's all kept

Your research register, its readable mirror, a capped run history and the rolling digest all live in
your project memory folder under `analysis/`.

The register stores **a claim and the link it came from — never the page itself**. Project memory is
committed to your repository, and mirroring somebody else's site into it would be a licensing problem
wearing a feature's clothes.

---

## Commands and settings

| Command | What it does |
|---|---|
| `/research` | Findings, what's due, what's blocked, and what's never been assessed |
| **AtlasMind: Run a Research Scan** | Runs one, after a confirmation naming the scan, the source and the cost |
| **AtlasMind: Open the Research Register** | The findings and the rules that graded them |
| **AtlasMind: Open the Research Digest** | What changed, what it means, what's unassessed |

Settings live under `atlasmind.research.*` — see [[Configuration]]. The full specification is
[`docs/ideation-and-research.md`](../docs/ideation-and-research.md).

---

## Related

- [[GitHub Workflow]] — the seven stages after this one
- [[Project Planner]] — turning a roadmap item into actual work
- [[Memory System]] — where the register lives
- [[Agents]] — the read-only analysts behind the scans
