# Project Planner

**Ask for a piece of work, see the plan, then let it run.**

`/project` takes a goal, breaks it into steps, works out what depends on what, shows you the whole thing
before anything happens, then executes it — running independent steps in parallel and reporting honestly
on what worked.

```
@atlas /project Refactor the auth module to use JWT tokens
```

---

## How a run goes

| | |
|---|---|
| **1. Plan** | AtlasMind breaks the goal into steps, assigns each a role and the tools it needs, and works out the order |
| **2. Preview** | You see the steps, the dependency graph, and roughly how many files it'll touch. Big runs need your approval |
| **3. Execute** | Independent steps run in parallel, each with a specialist agent, tests first |
| **4. Summarise** | One report covering what happened, the test evidence, the cost and anything that failed |
| **5. Keep** | The run is saved so you can review it, discuss it, or feed it back into ideation |

---

## You don't always have to type `/project`

When a normal chat reply **offers** to run something autonomously, you get a decision card rather than a
dead-end sentence:

- **Start run** — go now, through the normal gates
- **Save for later** — plan it and keep the preview in the Run Center without executing
- **Cancel** — dismiss it

With Autopilot on, `atlasmind.autoStartProposedProjectRuns` allows an immediate start after a brief
notice. Set it to `false` if you'd rather always get the card. Unusually large runs still stop at the
approval threshold either way.

**Nothing is approved on your behalf.** However a run is asked for — a typed request, a routed intent, or
"Proceed" on a proposal card — the goal reaches the planner unapproved, because at the moment you ask,
nobody has seen a plan or a file estimate yet. If the estimate exceeds
`atlasmind.project.approvalFileThreshold`, AtlasMind shows the plan and stops with an **Approve and run**
control carrying that exact run. Clicking it is the approval.

**A run checks it has somewhere to run.** The planner never looks at your workspace — it works from the
goal, your memory and the available skills — so an empty folder produced a full plan invented from the
wording, and a run that then searched for files that were not there. From v0.343.0 the two situations that
look alike are separated. **No folder open** stops before planning: there is nowhere to write, so no plan
could be used. **An open folder with no files** is not refused, because that is how a new project starts —
but it is also what the wrong folder looks like, so the plan is shown and the run asks first, naming both
possibilities. That reason joins the file-count threshold in one approval rather than arriving as a second
gate.

Before v0.294.0 this was inverted: saying "Proceed" arrived unapproved and stopped, while a typed request
matching the project pattern was approved for you and went straight past the threshold — and the stop had
no control on it at all, only an instruction to retype the goal with a `--approve` token, so the obvious
retry stopped in the same place every time.

**The goal a run starts with is the work, never the word you agreed with.** When you say "yes" to a
closing offer, AtlasMind resolves the goal from what the assistant proposed. Until v0.310.5, an offer that
ended "Shall I go ahead?" resolved to the goal `go ahead` — and the plan, the subtask table, the file
estimate and the cost estimate were all derived from that fragment, which is also why such a run read as
having come from nowhere. An affirmation on its own is now refused as a goal and the resolver falls back
to what you actually asked for; "Shall I go ahead **and update the README banner**?" still resolves to the
work, because there the affirmation is only a preamble.

**A stated precondition is honoured.** If the assistant said it was waiting on you — "once you confirm the
version number, I can start a run" — a bare "continue" no longer overrides it, because it supplies none of
what was asked for and the run would begin on exactly the information the model said it lacked. A reply
that carries the detail ("yes, use 0.310.5") answers the precondition and proceeds.

**If a turn is waiting on you, it says so.** Any first-person offer to do work now shows the decision card
— it no longer has to contain the literal words "project run". Until v0.311.0 three separate rules decided
whether a turn was pending, and the one that *accepted your answer* was the widest of them: a reply ending
"I can implement this across the four files. Shall I go ahead?" showed no card and mentioned no run, while
typing "yes" started a planned multi-subtask one. The card also no longer deletes the question and its
quick replies; you get both. An offer to *explain* something still shows no card, because saying yes to
that is a conversation.

Permitting an unattended start is a separate question from announcing a pending one, so **auto-flow still
requires the explicit vocabulary** — otherwise widening the announcement would have turned an ordinary
"Want me to start?" into an autonomous run under Autopilot.

Detection for that narrower auto-start is deliberately conservative: it needs explicit project vocabulary *and* a first-person offer,
ignores a generic "I'll build this", backs off on declines, and never fires while requirements are still
being gathered.

---

## `/project` versus `/loop`

**`/project` is one pass.** Plan → execute → summarise → stop.

**`/loop` (and Mission Control) wraps that in an outer loop:**

1. **Plan the next slice** — grounded in project memory, your guardrails and success criteria, the last
   evaluation's verdict, and a summary of what's happened so far
2. **Execute it** — through exactly the same machinery, so agents, tests-first rules and your testing
   matrix all apply unchanged
3. **Evaluate** — a verdict of `achieved`, `progressing`, `stalled` or `blocked` decides whether to
   continue. A goal counts as **achieved only when behaviour-changing work has passing verification**
4. **Repeat** — until it's done, or until one of your limits stops it

The loop runs on its own but pauses at **deny-by-default checkpoints** — every N iterations, when it
crosses a fraction of your budget, or before batches of writes. Deployments go through the guarded
[[Delivery|delivery pipeline]], never run directly. Every run is saved for audit.

Configure the defaults under `atlasmind.loop.*` — see [[Configuration]].

---

## Planning

AtlasMind sends your goal plus workspace context to a model, which returns a plan.

Planning is **reasoning only** — it deliberately doesn't need tools, so the planning model can be a pure
reasoning model, including one reached through a subscription. Before execution, AtlasMind checks the
tools each step asked for actually exist. A step that inspects the repository but ended up with no tools
gets the minimum evidence set, which forces it onto a model that can actually use tools.

### It reads your roadmap

`project_memory/roadmap/improvement-plan.md` is treated as a weighted backlog. Your manual ordering
matters, but it isn't absolute: critical, security, architectural and delivery-risk signals can still
outrank something that just happens to sit near the top.

That ordering answers *which item matters more*. It cannot answer *which item cannot start until another
lands* — a different fact, and the one that decides whether a backlog can actually be built in the order
it's written. The Roadmap page's **dependency canvas** holds it: draggable nodes carrying the item, its
branch name, its deadline, the days left and an estimate, with arrows for what has to happen first.
Press **Route** on any node to hide everything that isn't that item or a prerequisite of it — completed
prerequisites included, because the route is how you got here — and see the outstanding days along it.

Grab a card anywhere to drag it — its buttons and chips stay clicks. The mouse wheel pans the canvas
(Shift pans sideways), and Ctrl+wheel — or a trackpad pinch — zooms about the cursor, so the point you
are looking at stays put. Panning and zooming never redraw the page, and a drop lands immediately; the
tree seats each item beside what it waits for, so arrows stay short instead of crossing the plan.

**Click a card's body** and its neighbourhood lights up — the card, its direct prerequisites and
dependents, and every arrow touching it — while everything else recedes. Escape or a click on empty
canvas puts it back. **Search the plan** from the toolbar: only items whose text matches stay, plus
everything connected to them — what they wait on, and what waits on them — with the rest hidden and
the view re-fitted as you type. Both are ways of looking: nothing is sent, and nothing changes.

**Every entry carries three Atlas pills — on the canvas card and on its backlog row alike.**

- **Plan** files a dedicated plan document for the item under `roadmap/plans/` — created once as an
  empty frame (Objective, Context, Approach, Steps, Verification, Completion criteria), never
  overwritten — records its path against the item, and opens a chat where Atlas drafts it into the
  file. The entry then shows a **plan** link: the item's filing record, one click from wherever you
  see the item.
- **Resolve** hands the work itself to Atlas in chat. When a plan has been filed, the hand-off says to
  read and follow it — and to say so before deviating where reality disagrees.
- **Completion check** asks Atlas whether the item is *actually* done, judged against the plan's
  completion criteria and the code, and reports complete, incomplete, or not decidable — with the
  evidence. It never ticks the item off: marking work done stays yours, informed by the report.

A delivered entry keeps only the Completion check — there is nothing left to plan or resolve, but "is
it really done?" is a question finished work still has to answer.

Four controls arrange the canvas. **Fit all**, beside the zoom buttons, puts the whole plan on screen.
**Snap to grid** lines a dragged node up with the auto-aligned ones. **Auto tree** lays the plan out as
a tree and fits it on screen, with **→** and **↓** beside it choosing which way the tree runs. The
layout reads locally by design: each prerequisite sits just before the first thing it unlocks, unrelated
sub-plans are laid out as separate blocks so their arrows never cross each other, children settle under
their parents (a chain draws as one straight line), and items with no links park in a compact block of
their own rather than stretching the first row across the whole canvas. Arranging always re-fits: a
re-flow moves every node while your pan and zoom stay put, so without the fit the whole result happens
off-screen and the button reads as though it did nothing. It releases every node you've positioned by
hand, so drag one again afterwards to pin it. And **Calculate tree**, the
button carrying the AtlasMind mark, works the whole dependency tree out from the wording of your backlog
and offers it in one go, behind a confirmation that says how many links it would add.

**The tree is built from links you have accepted.** A suggestion is drawn dashed and deliberately moves
no item and blocks none — an inference should not reorder your plan on its own. So a plan with nothing
accepted has no order to draw, and its items are parked in a compact block with the dashed arrows
overlaid — which can look like a missing layout and is not one. The canvas says so when you are in that
state, and the banner that says so carries **Calculate tree** itself, so the way out is in the sentence
that explains it. The suggestions toggle only shows and hides the dashed arrows; it
carries the count so "showing" with nothing drawn is distinguishable from a control that failed.

**Import a roadmap you already keep somewhere else.** **Import…** in the toolbar reads markdown files
across a glob, GitHub issues, a GitHub Projects board, or a CSV/TSV export. You are asked which source,
then for whatever it needs — a glob, a project number, or which spreadsheet column holds the item — and
then shown exactly what would change before anything is written.

Run it as often as you like. Each imported line records where it came from, so a second run updates what
moved rather than duplicating everything, and a *first* import adopts items you already typed by hand
instead of adding them twice. Nothing is ever deleted: an item the source has lost is reported and left
where it is, because "dropped", "renamed" and "your glob stopped matching that file" look identical from
here. And your own edits are safe — if you have retitled an item and the source has also changed it,
you get a conflict showing both texts and nothing is written.

**Four views, not three.** **Dependency canvas**, **Prioritised backlog**, **By person** and
**Delivered**. By person shows the same outstanding work in one band per person, with each band still
ordered by what has to happen first — so an arrow crossing between bands is one person waiting on
another, which is the question the view exists to answer. Bands are ordered by name rather than by how
much work is in them, so the picture does not reshuffle whenever somebody finishes something; unassigned
comes last. Positions you dragged on the dependency canvas are ignored here and dragging is not offered:
a coordinate means something in the arrangement it was set in and nothing in another one, and honouring
it would drop a card into somebody else's lane.

**Assign an item from its node editor.** The picker is drawn from your Project Director roster — add
people there first. It is deliberately a different fact from "added by" and "completed by": those are
history, and this is a plan. If somebody is later removed from the roster, work assigned to them is kept
and labelled as such rather than folded into unassigned, because deleting a contact is not a statement
that their work became nobody's.

**Adding an item re-fits the canvas.** A new item is laid into the tree at the next free row of its
level and would otherwise sit outside a viewport that never moved — indistinguishable from not having
been added. Only genuine arrivals do this; redrawing the same plan leaves your pan alone.

AtlasMind proposes links and applies none of them. Three declared rules produce suggestions: an item that
*says* what it waits for ("after…", "depends on…"), two items sharing a subject where one is foundation
work for the other, and two items sitting on different release gates. Each suggestion is drawn dashed and
names the rule and the evidence behind it. It moves no column, blocks no node, can't contradict a link
you drew, and can't make the plan circular — and it changes nothing until you accept it. Dismiss one and
it stays dismissed.

Estimates come from a published table rather than a model, with a per-item AI-assistance toggle, so the
same backlog grades identically on two machines. Nodes are edited where they sit — name, branch,
deadline, estimate — and the branch name follows a rename unless you override it.

Completed items move to a **Delivered** canvas, laid out by month, keeping the links between pieces of
work and recording when each landed and by whom. One exception: a completed item stays on the plan while
something outstanding still depends on it, because removing it would make the dependent item look like it
starts from nothing.

The deadlines, positions and links live in `roadmap-graph.json` beside the plan, keyed on a durable id
each backlog line carries as an invisible HTML comment — so renaming or reordering an item no longer
loses its history. The ids are written automatically the first time the dashboard loads, so every item
is ready to save against before you touch anything; graph records themselves are only created for items
that actually gain data.

### Limits and rules

- **Maximum 20 steps** per plan
- **Circular dependencies are detected and broken**, so a plan can't deadlock
- Each step gets a **role** that becomes a temporary specialist agent
- For behaviour changes, **test-writing steps are planned ahead of implementation steps**, so execution
  can follow red → green → refactor
- Steps can use testing and observability tools, so they can establish the failing signal themselves

### It knows about every tool you have

The planner builds its list of available tools **at planning time, from what's actually registered** —
built-in, your own, and any connected MCP server. You never have to tell the planner about a new tool.

It's also told to prefer a purpose-built tool over a raw terminal command wherever one exists —
`git-commit` rather than `terminal-run git commit -m "..."`, because the former passes your message as a
typed parameter with no shell quoting to go wrong.

---

## The preview

Before anything runs, you see:

- How many steps, and roughly how many files they'll touch
- The dependency graph
- Each step's title, role, tools and dependencies
- The tests-first policy that will apply
- The fact that implementation writes are **blocked until a relevant failing test has been seen**

The estimate is `steps × projectEstimatedFilesPerSubtask`. If it reaches
`projectApprovalFileThreshold` (12 by default), you approve before it proceeds.

---

## Execution

Independent steps are grouped into batches and run **up to 5 at a time**, each with its own temporary
specialist. Models are allocated across those parallel slots sensibly — subscription and free capacity
fills up first, pay-per-token absorbs the overflow, cost stays balanced across the batch.

Before every write, a snapshot is taken. If a step fails, its files can be rolled back to how they were.

### How a step ends

`completed`, `failed`, or **`needs-input`**.

**`needs-input` is a pause, not a failure.** It means the step hit an execution cap before finishing.
Rather than quietly recording the cap message as a successful result, chat asks whether to use a higher
limit **for this run**, **save it permanently**, or **keep the partial result**. The run stays paused
until you decide.

**A step is only `completed` if it actually delivered.** A response that ends on an unrecovered tool
error, announces an action without doing it ("Let's inspect…"), says required tools were unavailable, or
signals unverified work is classified as **failed** after one recovery attempt — so its dependents are
skipped and you get honest counts rather than a false "8/8 completed".

If a tool-capable model refuses mid-run, AtlasMind hands the step to a different tool-capable model
before it accepts a reasoning-only answer.

### The temporary specialists

| Role | Focus |
| --- | --- |
| `architect` | System design, patterns, scalability |
| `backend-engineer` | APIs, data layers, performance |
| `frontend-engineer` | UI components, accessibility |
| `tester` | Test authoring, coverage, edge cases |
| `documentation-writer` | Docs, clarity, completeness |
| `devops` | CI/CD, infrastructure, deployment |
| `data-engineer` | Data models, pipelines |
| `security-reviewer` | Threats and mitigations |
| `general-assistant` | Fallback |

For code-changing steps, each is told to find the closest relevant tests first, write the smallest test
before implementing, establish a failing signal before any implementation write, aim for
red → green → refactor and report the evidence — and to **explain why** if the work genuinely isn't
testable.

---

## The report

When everything's finished, AtlasMind collects the results and produces one summary covering what was
done, the test and verification evidence, the total cost, the files changed (up to
`projectChangedFileReferenceLimit`, clickable), and anything that failed.

Per-step test compliance is kept, so the Run Center can show you which steps were verified, which were
blocked, and which weren't applicable.

---

## Run history

Every completed run is saved, and you reach it with `/runs` or **AtlasMind: Open Project Run Center**.

The Run Center shows status, a short title plus the full goal, the step-by-step breakdown, total cost
and tokens, and lets you discuss the run in chat, inspect it, feed what it learned back into ideation, or
delete the record (without touching your files).

**History is per-workspace** — a run created in one repository doesn't show up in another. If you have
older runs from before this was true, they're adopted into the active workspace rather than disappearing.

### Very large drafts get staged

If a reviewed draft is too big for one run, the Run Center can break it into stages: AtlasMind executes
the first dependency-safe batch, keeps those outputs as context, and queues the rest as the next draft —
so you can work through something large in deliberate stages instead of one enormous run.

---

## From an idea to a tracked issue

The [[Ideation|ideation board]] feeds this. A card becomes a roadmap item, a roadmap item becomes a
GitHub issue draft.

### Card → roadmap item

Each card's inspector has **Add to roadmap**. The wording follows the card's kind — a `problem` becomes
`Fix: …`, a `risk` becomes `Mitigate: …`, because the work is the fix, not the problem. An `idea` or
`requirement` gets no prefix: putting an idea on the roadmap *is* the commitment.

You see the exact line in a dialog before anything is written, because your roadmap is a tracked file.

**The card's connections travel with it.** When that item later becomes an issue, the issue body carries
what the work depends on, what supports it, and what contradicts it — the one thing an ideation board
knows that no hand-typed issue body does. Direction is preserved ("this depends on X" and "X depends on
this" are opposite plans), and **a contradiction is stated as a caution**, never listed as support.

Provenance runs both ways: the card shows the item it produced, and the Roadmap page marks items that
came from ideation.

### Roadmap item → GitHub issue

Each open roadmap item has **Raise as issue**.

**The draft is derived, not generated.** No model is involved, so the same item produces the same issue
every time — which is what makes it reviewable. The rule that chose a label is visible, and the next
item's output is predictable. A generated title would be a claim nobody checked, posted publicly in your
name.

**It drafts; it doesn't file.** The text lands in the composer for you to read and edit, and posting goes
through the same confirmation as every other issue write.

**Labels come only from labels your repository already has**, because an invented label gets *created* on
the repository as a side effect of filing. Your repository's own spelling wins, and a label intent that
matched nothing is stated in the issue body rather than dropped silently.

The body says where it came from, and says plainly that closing the issue doesn't tick the roadmap item
off and vice versa.

### Work that started outside AtlasMind

A branch pushed or a PR opened by another tool would otherwise be invisible. The dashboard shows open
PRs with no linked issue, alongside commits since your last tag, and offers **Draft tracking issue** for
each — derived, not generated, opening in the normal composer, never posted automatically.

---

## Road to MVP — and every release after it

The Roadmap page opens with a **Road to …** section that turns your backlog into a path to a shippable
release.

- **Release gates.** MVP is built in; **+ New gate** declares your own (a public beta, `v1.0`, `v2`), up
  to 12. A selector switches which release the path describes, and each chip shows that gate's progress.
  Gates are stored as readable markdown in your roadmap file, so they diff and review like everything
  else.
- **Per-item membership.** Each item has a toggle per gate, so something can be in the MVP *and* the
  beta. Removing a gate removes its tag from every item and **never deletes backlog work**. The MVP gate
  can't be removed at all.
- **A visual guide.** A progress bar and numbered milestone track showing how far along you are, with
  on-path, completed and remaining counts.
- **A suggested route.** A deterministic ordering of what's left, front-loading foundational, security
  and architectural work, with the reasoning for each step and a highlighted next step. **Plan the route
  with Atlas** hands it to a live chat session — so no model calls happen during ordinary dashboard
  refreshes.
- **Guesses stay MVP-only.** With nothing tagged for MVP, AtlasMind suggests foundational items to get
  you started. A gate *you* created gets no such guess: what belongs in your "v2" is a release decision,
  not something to infer.

### Asking about the roadmap in chat

AtlasMind reads your roadmap files live and answers differently depending on what you asked:

- **"Plan the fastest route to MVP"** wants a plan, not a status dump. If unanswered basics block that,
  you get a focused set of direct questions — project type, audience, timeline, tech stack — and nothing
  else. With no gaps left, it goes and actually plans.
- **"What's outstanding?"** gets a deterministic status summary: the progress count and the outstanding
  list, in a collapsed section so it doesn't dominate the reply.

Both offer an **Answer all** chip that pre-fills your composer with a fill-in-the-blanks block covering
every gap. It pre-fills rather than sends, so the wording stays yours.

Counts only include real work — shipped release notes, already-answered metadata and scaffolding prose
are excluded.

---

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `atlasmind.projectApprovalFileThreshold` | `12` | Estimated file count that triggers approval |
| `atlasmind.projectEstimatedFilesPerSubtask` | `2` | How many files a step is assumed to touch |
| `atlasmind.projectChangedFileReferenceLimit` | `5` | Clickable file references in the summary |
| `atlasmind.projectRunReportFolder` | `project_memory/operations` | Where run reports are saved |
| `atlasmind.toolApprovalMode` | `ask-on-write` | Approval gating during execution |

---

## Getting good results

- **Start small.** Try a focused goal before a large refactor
- **Actually read the preview.** Check the dependency graph makes sense before approving
- **Use `/runs`.** Reviewing past runs teaches you how to phrase the next one
- **Fill in project memory.** The more context there is, the better the plan

---

## Related

- [[Ideation]] — where a goal comes from
- [[Agents]] — the specialists doing the work
- [[Delivery]] — where deployments actually happen
- [[Tool Execution]] — approvals and checkpoints
- [[Configuration]] — every `atlasmind.loop.*` and project setting
