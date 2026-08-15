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
