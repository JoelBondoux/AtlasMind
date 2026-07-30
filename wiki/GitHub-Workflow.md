# GitHub Workflow

> AtlasMind's guided workflow: eight stages from an idea to a released version, with every step
> explained. Built for solo developers and teams of three to ten working on GitHub.

Open it from the Project Dashboard → **Workflow**.

If you have never worked to a formal development process, this page is a reasonable place to learn
one. Every stage and every step carries a **?** that opens a plain-language explanation of *why it
exists*, *how to do it*, and *what people usually get wrong*. Nothing is assumed.

The full normative specification is
[`docs/guided-github-workflow.md`](https://github.com/JoelBondoux/AtlasMind/blob/main/docs/guided-github-workflow.md).
This page is the guided tour.

---

## Why have one workflow at all

Before this existed, AtlasMind's own repository described its GitHub process in **nine** different
documents. They disagreed on whether pull requests target `main` or `develop`, whether reviews were
required, and whether a release started from the Actions tab or a terminal. Two referred to CI
workflow files that did not exist.

None of that was carelessness. It is what happens when the same rule is written down in nine places
and edited at nine different times.

So the workflow is **data**, not prose. The stages, their gates, and their automation levels live in
one committed file. Everything else points at it.

---

## The eight stages

| # | Stage | What happens |
|---|---|---|
| 1 | **Planning & Issue Intake** | An intention becomes a tracked, labelled issue with acceptance criteria. |
| 2 | **Branch Creation & Naming** | A conventional branch name is derived from that issue. |
| 3 | **Local Development** | The work gets done, against the testing protocols you chose. |
| 4 | **Pull Requests & Reviews** | A pull request links its issue, fills the template, and collects review. |
| 5 | **CI/CD & Failure Analysis** | Checks run; when they fail, the cause is classified with evidence. |
| 6 | **Release Automation** | Version bump, changelog, tag, publish. |
| 7 | **Maintenance & Tech-Debt** | What you deferred is recorded and aged visibly. |
| 8 | **AI-Driven Automation** | The policy layer deciding how much of the above AtlasMind may do. |

Stage 3 is the only one that never touches GitHub — deliberately, so you can work offline and so
nothing there can accidentally become public.

Stage 6 is the only one describing an action that **cannot be undone**, which is why it is checked
before rather than fixed after. The Release page runs seven gates in root-cause order — changelog
entry, notes have content, no secrets in the notes, version moved on, tag is free, working tree
clean, CI passing — and a gate reporting *unknown* is never treated as a pass. Release notes are the
changelog section for that version, copied verbatim; if they contain anything shaped like a
credential the release is **refused rather than quietly redacted**, because publishing an edited
version of what you reviewed without telling you what was removed is the worse failure. Nothing on
that page publishes anything: tagging and publishing stay with you at every automation level.

Stage 8 is not a step you perform. It is the layer the other seven run inside.

---

## Two profiles

Not a beginner mode and an expert mode — two genuinely different situations.

### Solo

One person is author, reviewer, and releaser. The workflow's job is **not** to simulate a second
person; it is to make one person's decisions explicit and recorded, so that six months later the
record explains itself.

- **Zero required approvals.** Requiring your own approval is theatre, and worse, it trains you to dismiss a gate.
- **CI is the reviewer.** Which is exactly why its checks stop being optional in this profile.
- Routine work may go straight to the integration branch; isolated or risky work takes a branch.
- **The debt register matters more, not less** — you have no colleague who remembers the shortcut.

What solo does *not* relax: the untrusted-input boundary, protected-branch enforcement including
for you, the version-and-changelog rule, and the audit record.

### Small studio (3–10)

Authorship and approval are separable, so the workflow makes the separation real.

- **At least one approver distinct from the author.** This is the one place the profiles differ in kind rather than degree — not distrust, but that the author is the person least able to see what they assumed.
- Direct pushes to the integration branch are off; every change takes a branch.
- Declare code owners **before** the team passes about five people, while it is still administrative rather than political.
- Rotate reviewers, and rotate the release captain.

Set yours with `atlasmind.workflow.profile`.

---

## The automation ladder

Five rungs. Everything ships at **observe**.

| Rung | AtlasMind may |
|---|---|
| `off` | nothing |
| `observe` | read, measure, display |
| `draft` | produce an artifact and show it |
| `propose` | act, after you confirm |
| `auto` | act unattended, inside the stage's gates |

The effective level for any stage is the **lowest** of four independent gates:

```
min( master switch, your ceiling, capability switch, the stage's declared level )
```

All four default closed. That is what makes *"full automation is possible, never default"* true by
construction rather than by policy — the project file may request `auto`, and if any one of the four
disagrees, `auto` does not happen. Your personal settings can only ever **lower** the level.

The Workflow page shows all four, so you can see where you stand rather than having to work it out.

### What never automates

No setting raises these:

- Force-pushing — to anything, ever.
- Deleting a tag or a release.
- Re-running a CI job. Re-running until green turns a flake into policy.
- Editing a CI workflow file. That file enforces the gates.
- Merging a dependency update. That is a supply-chain event.
- Storing a GitHub token. AtlasMind holds no credential — it uses your authenticated `gh` CLI, so your authorisation stays revocable where you granted it.

---

## It adapts to your testing protocols

The workflow reads the protocols you enabled on the Testing page and asks for evidence accordingly.
This is deliberate: a workflow demanding behaviour-driven scenarios from a project that does not
write them would be ignored, and an ignored workflow enforces nothing.

Enabled protocols change which checks appear on a pull request, which artifacts CI is expected to
produce, and which agent picks up a testing subtask. Protocols that are ways of working rather than
files — `v-model`, `test-design` — are never counted as gaps.

**One rule is worth internalising:** no report means **no verdict**, never "0 failing". A test suite
that did not run is not a test suite that passed, and conflating the two is how a green dashboard
hides a broken pipeline.

---

## What the numbers mean

The page charts delivery health. Every metric card carries a **?** explaining what it measures and
what a bad number looks like.

| Reading | What it usually means |
|---|---|
| Many stale issues | The backlog is not being triaged. An untriaged backlog is indistinguishable from no backlog. |
| Low branch-naming conformance | Branch history is unfilterable — you cannot tell what a branch is for without reading its diff. |
| Low commit-convention conformance | The automated version bump and changelog cannot be trusted, because both are derived from those prefixes. |
| Long time-to-first-review | Work is queued, not slow. Usually a scheduling problem rather than a capacity one. |
| Recurring flake-suspect failures | The most corrosive failure mode: once a red build might mean nothing, people stop reading red builds. |

### The four delivery keys

The Release page adds deployment frequency, lead time for change, change failure rate and time to
restore. They are paired on purpose: the first two describe speed and the last two describe
stability, so improving the half you like by wrecking the other shows up immediately. Shipping daily
means nothing if a third of releases need a same-day fix.

Each declares the rule it used, because a delivery metric whose definition is implicit cannot be
compared with last month's:

- **Lead time is measured merge → release**, not first-commit → release. That is the half you can
  act on, and the half squash-merging does not destroy. Work that merged and has not shipped is
  *excluded* rather than counted as infinitely slow — that it is waiting is itself the finding.
- **A change failure is a patch release within 48 hours.** Applied literally, and every release it
  counted is named, so you can argue with the number rather than take it on trust. A minor or major
  follow-up is a planned release, not a remediation.
- **Drafts and pre-releases are excluded.** Neither is a deployment to anybody.

The bands are the widely cited thresholds, not a certification — the exact boundaries have moved
between annual industry reports, and your own trend matters far more than which side of a line you
land on.

Two honesty rules hold throughout: a component that could not be measured is **omitted from the
health score** rather than counted as zero, and a nav badge only appears once data was actually
loaded — so a tracker nobody opened never reads as "all clear".

---

## Related

- [[Delivery]] — the guarded promotion pipeline behind stage 6.
- [[Project Planner]] — the orchestration behind stage 3.
- [[Agents]] — who owns which stage.
- [[Configuration]] — every `atlasmind.workflow.*` setting.
- [[Security]] — the boundaries the workflow inherits.
