# GitHub Workflow

**Eight stages from an idea to a released version, with every step explained.**

Open it from **Project Dashboard → Workflow**.

If you've never worked to a formal development process, this is a genuinely good place to learn one.
Every stage and every step has a **?** that explains *why it exists*, *how to do it*, and *what people
usually get wrong*. Nothing is assumed, and nothing is jargon for its own sake.

If you have worked to one, it's a checklist that adapts to your project rather than lecturing you about
someone else's.

Built for solo developers and teams of roughly three to ten working on GitHub.

---

## Why it's one thing, not nine documents

Most projects describe their process in several places — a README section, a CONTRIBUTING file, a wiki
page, someone's notes. They drift, and then they disagree about whether pull requests go to `main` or
`develop`, whether review is required, and how a release starts.

So in AtlasMind the workflow is **a file in your repository**, not prose. The stages, their gates and
their automation levels all live in one place, and everything else points at it.

The practical benefit: a change to how your team works arrives as a **diff with a reviewer**, rather
than as a habit nobody wrote down.

---

## The eight stages

| # | Stage | What happens |
|---|---|---|
| 1 | **Planning & issue intake** | An intention becomes a tracked, labelled issue with acceptance criteria |
| 2 | **Branch creation & naming** | A conventional branch name derived from that issue |
| 3 | **Local development** | The actual work, against the testing protocols you chose |
| 4 | **Pull requests & review** | A PR that links its issue, fills the template, and collects review |
| 5 | **CI & failure analysis** | Checks run, and when they fail the cause is identified with evidence |
| 6 | **Release** | Version bump, changelog, tag, publish |
| 7 | **Maintenance & tech debt** | What you deferred, recorded and visibly ageing |
| 8 | **Automation policy** | How much of the above AtlasMind may do on its own |

**Stage 3 never touches GitHub.** That's deliberate — you can work offline, and nothing there can
accidentally become public.

**Stage 8 isn't a step you perform.** It's the layer the other seven run inside.

### Stage 6 gets extra care, because you can't undo a release

The Release page runs seven gates in root-cause order: changelog entry present, notes have content, no
credentials in the notes, version moved on, tag is free, working tree clean, CI passing.

Four things worth knowing:

- **A gate that reports *unknown* is never treated as a pass.** "We didn't check" has to stay
  distinguishable from "we checked and it was fine".
- **Release notes are your changelog section, copied word for word.** Not summarised, not generated.
- **If the notes contain something shaped like a credential, the release is refused — not quietly
  cleaned up.** Silently publishing an edited version of what you reviewed, without telling you what was
  removed, is the worse outcome.
- **The gates are listed urgent-first, and each one opens where its evidence lives.** Root-cause order
  is how they are *checked*; it is not how you want to read them, so blocked gates come first, then
  unknown, then ready — with the check order preserved inside each band. Unknown ranks with the
  problems rather than with the passes, for the same reason it is not a pass. Click a gate's link to
  open the page or file that would answer it: CI to the Pipeline page, the testing policy to Testing,
  the changelog gates to `CHANGELOG.md`. Filter to **Needs you** (blocked *and* unknown) when you are
  working through them; whenever a filter is hiding something, the card says how many.

Nothing on that page publishes anything. Tagging and publishing stay with you at every automation level.

---

## Two profiles

Not beginner mode and expert mode — two genuinely different situations. Set yours with
`atlasmind.workflow.profile`.

### Solo

You're the author, the reviewer and the releaser. The workflow's job is **not** to pretend there's a
second person. It's to make your decisions explicit and recorded, so that in six months the record
explains itself.

- **Zero required approvals.** Approving your own work is theatre, and worse, it teaches you to click
  through gates without reading them.
- **CI is your reviewer** — which is exactly why its checks stop being optional here.
- Routine work can go straight to the integration branch; risky work takes a branch.
- **The debt register matters more, not less.** You have no colleague who remembers the shortcut.

What solo does *not* relax: the untrusted-input boundary, protected branches (including for you), the
version-and-changelog rule, and the audit record.

### Small studio (3–10 people)

Authorship and approval are genuinely separable, so the workflow makes the separation real.

- **At least one approver who isn't the author.** This is the one place the profiles differ in kind
  rather than degree — not distrust, just that the author is the person least able to see what they
  assumed.
- Direct pushes to the integration branch are off. Everything takes a branch.
- Declare code owners **before** you're about five people, while it's still administrative rather than
  political.
- Rotate reviewers, and rotate whoever runs the release.

---

## How much AtlasMind may do

Five levels. **Everything ships at `observe`.**

| Level | AtlasMind may |
|---|---|
| `off` | Nothing |
| `observe` | Read, measure, display |
| `draft` | Produce something and show it to you |
| `propose` | Act, after you confirm |
| `auto` | Act unattended, inside that stage's gates |

The level actually in force for any stage is the **lowest** of four independent things:

```
min( master switch, your ceiling, capability switch, what the stage asked for )
```

All four default closed. That's what makes *"full automation is possible, never default"* true by
construction rather than by promise — your project file may request `auto`, and if any one of the four
disagrees, `auto` doesn't happen. **Your personal settings can only ever lower it.**

The Workflow page shows all four, so you can see where you stand instead of working it out.

### Things no setting will ever automate

- **Force-pushing.** To anything. Ever.
- **Deleting a tag or a release.**
- **Re-running a CI job.** Re-running until green turns a flaky test into policy.
- **Editing a CI workflow file.** That file is what enforces the gates.

The Pipeline page does allow a human to manage CI without weakening that rule. It inspects existing
workflow files read-only, opens them in the editor, and can ask AtlasMind for a proposal. For a project
with no CI, it can create one deterministic starter after an exact preview. That path is manual,
create-only, and cannot replace, disable or delete a workflow; it is not automatic workflow editing.
- **Merging a dependency update.** That's a supply-chain decision.
- **Storing a GitHub token.** AtlasMind holds no credential — it uses your authenticated `gh` CLI, so
  your access stays revocable where you granted it.

---

## It adapts to how you test

The workflow reads the testing protocols you enabled and asks for evidence accordingly.

That's deliberate: a workflow demanding behaviour-driven scenarios from a project that doesn't write
them would just be ignored, and an ignored workflow enforces nothing.

Your enabled protocols change which checks appear on a pull request, what CI is expected to produce, and
which agent picks up a testing task. Protocols that are ways of working rather than files are never
counted as gaps.

**One rule worth internalising:** no test report means **no verdict**, never "0 failing". A suite that
didn't run is not a suite that passed, and blurring the two is how a green dashboard hides a broken
pipeline.

---

## Reading the numbers

The page charts delivery health, and every card has a **?** explaining what it measures and what a bad
number looks like.

| What you see | What it usually means |
|---|---|
| Lots of stale issues | The backlog isn't being triaged — and an untriaged backlog is indistinguishable from no backlog |
| Low branch-naming conformance | You can't tell what a branch is for without reading its diff |
| Low commit-convention conformance | Automatic version bumps and changelogs can't be trusted, because both are derived from those prefixes |
| Long time to first review | Work is queued, not slow. Usually scheduling rather than capacity |
| Repeated flaky failures | The most corrosive one. Once a red build might mean nothing, people stop reading red builds |

### The four delivery measures

The Release page adds deployment frequency, lead time for change, change failure rate and time to
restore.

They're deliberately paired: the first two are about speed, the last two about stability. Improving the
half you like by wrecking the other shows up immediately — shipping daily means nothing if a third of
releases need a same-day fix.

Each one tells you the rule it used, because a metric with an unstated definition can't be compared with
last month's:

- **Lead time is merge → release**, not first commit → release. That's the half you can actually act on,
  and the half squash-merging doesn't destroy. Work that merged but hasn't shipped is *excluded* rather
  than counted as infinitely slow — the fact that it's waiting is itself the finding.
- **A change failure is a patch release within 48 hours.** Every release it counted is named, so you can
  argue with the number instead of taking it on trust. A minor or major follow-up is a planned release,
  not a fix.
- **Drafts and pre-releases don't count.** Neither is a deployment to anybody.

The bands are the widely cited industry thresholds, not a certification. The exact boundaries have moved
between annual reports, and **your own trend matters far more than which side of a line you land on.**

Two honesty rules hold throughout: something that couldn't be measured is **left out of the health
score** rather than counted as zero, and a badge only appears once data was actually loaded — so a
tracker nobody opened never reads as "all clear".

---

## Related

- [[Delivery]] — the guarded path to production behind stage 6
- [[Project Planner]] — the orchestration behind stage 3
- [[Ideation]] — stage 0, where ideas become issues
- [[Agents]] — who owns which stage
- [[Configuration]] — every `atlasmind.workflow.*` setting
- [[Security]] — the boundaries the workflow inherits
