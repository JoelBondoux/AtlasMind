# Delivery

**Getting your work safely from your machine to production** — and knowing exactly what has to be true
before each step.

Every other part of AtlasMind is about *making* a change. Delivery is about *moving* one, somewhere a
mistake is expensive to undo. That's why it's the most carefully gated thing here.

Open it from **Project Dashboard → Delivery**.

---

## Your project's shipping guide

The first section answers the practical newcomer questions: **what must be installed, which checks make
the build trustworthy, how is it packaged, and what moves it into production or a registry?**

AtlasMind derives an ordered **Prerequisites → Validate → Package → Deploy → Publish** guide from the
project in front of you. It understands Node package managers and lockfiles, Python, Go, Rust,
Maven/Gradle, .NET and container projects, then combines that runtime evidence with the Delivery stages,
the bound project routine and CI/CD workflows.

## Configure and manage CI

Open **Project Dashboard → Pipeline**. The page separates three ideas that CI tools often compress
into one YAML file:

1. **Define** — workflow files describe jobs, runners and steps.
2. **Assign** — triggers under `on:` choose the events and branches that run those jobs.
3. **Enforce** — required checks and branch protection decide whether a missing or failing result blocks
   a merge.

Every detected GitHub Actions workflow gets a card showing those facts, plus job timeouts, explicit
token permissions, concurrency, build/lint/test coverage and cautions. **Open workflow** edits the real
file in VS Code. The AtlasMind action opens a proposal-first review that explains the workflow for a
newcomer and checks professional concerns such as least privilege, action pinning, caching, secret
exposure, artifact retention and duplicated work.

When a Node project has no quality CI, **Preview starter CI** derives one from the project's declared
integration/release branches, lockfile and actual package scripts. The confirmation names the path,
branches and checks before `.github/workflows/ci.yml` is created. It is create-only: AtlasMind never
adds a competing starter beside existing quality CI and never overwrites, disables or deletes a workflow.
Release-only automation remains separate because building a release artifact does not prove pull
requests are checked before merge.

Each item says how strong the evidence is:

- **Configured** — the repository explicitly declares the script, routine step, target or policy.
- **Runtime convention** — a standard ecosystem command AtlasMind can safely suggest, such as
  `go test ./...`; useful, but not a claim that the project declared or ran it.
- **Manual check** — something a person must inspect or approve.
- **Missing** — a load-bearing step AtlasMind could not find. Blocking items are counted at the top.

Each item links back to the file that supplied the evidence.

The five phase columns start **collapsed**. Their numbered identifiers show the strongest status inside:
green is fully configured, blue includes a runtime convention, amber needs a manual check or has a
non-blocking gap, and red contains a blocker. Open a column to see the detail. Every non-green step has
an AtlasMind-logo button; hover it to see the exact action, then press it to open a focused resolution
draft. The webview sends only the step id — the extension host rebuilds the live guide before composing
that draft, so the page cannot supply a command or prompt of its own.

### Running what it found

Opening or refreshing the page never runs anything. Every run starts with a click:

- **⧉ Copy** puts the command on the clipboard.
- **&gt;_ Send to terminal** types it into a terminal named `AtlasMind Delivery`, opened at the project
  root — **without pressing Enter**. Read it, then run it yourself. That keystroke is deliberately left
  to you, which is why this button asks nothing first.
- **▶ Run** inside an expanded column runs that whole phase, after a confirmation that lists every command in
  the order they will run, marks the ones that reach beyond your machine (a push, a deployment, a
  publication — none of which closing the terminal undoes), and tells you whether a failure will stop
  the rest.

That last point is worth knowing before you use it. Commands are chained with `&&` so a failing check
stops the ones after it — but Windows PowerShell 5.1 has no `&&`, and on an unrecognised shell AtlasMind
will not assume one. There, the commands are sent separately and the dialog says so: a failing test will
**not** stop the packaging behind it. Run them one at a time if that matters. AtlasMind never reads the
terminal output, so the result is yours to check either way.

Actual deployments still go through the guarded promotion flow below, with live preflight checks,
approval and protected-stage confirmation. The runbook's commands come from *detection*; promotion's come
from a reviewed `delivery.json`, and the two paths stay separate.

---

## Stages and promotions

Delivery is modelled as **stages** — places your code can be — joined by **promotions**, the permitted
moves between them.

| Stage | Usually |
|---|---|
| **Local** | Your working tree |
| **Integration** | Your integration branch — `develop` in AtlasMind's own repository |
| **Production** 🔒 | Your release branch, and whatever it publishes to. Protected |

AtlasMind seeds these from your repository's branches the first time you open the page, and then they're
yours to change. The configuration lives in your repository (`project_memory/operations/delivery.json`,
with a readable mirror alongside it), so a change to **how your project ships** shows up in a diff and
gets reviewed like any other change — rather than being a habit in one person's head.

### The empty backup command is deliberate

Where a production stage involves a database, its backup policy ships with **no command in it**, and
promotion stays blocked until you write one.

That's not an oversight — it *is* the gate. AtlasMind can't invent a backup command that would actually
restore your data, and a backup step that doesn't really work is worse than no backup, because you'll
trust it at the worst possible moment.

---

## What happens during a promotion

Every promotion runs the same fixed sequence:

```
preflight → backup → backup-verify → migrate → deploy → verify → record
```

- **Preflight** — the gates below, checked against live state
- **Backup** — your command, if the stage declares one
- **Deploy** — your routine's steps, a workflow trigger, or nothing
- **Verify** — an HTTP health check, if you configured one
- **Record** — written to the history *before* the run counts as done

Only one promotion can run at a time. A lock (expiring after 60 minutes) means two people can't release
simultaneously, and a crashed process can't block the pipeline forever.

---

## The five gates

Checked **in this order**, and the first failure is the one you're told about. The order matters: being
told "approval required" when the real problem is a red build sends you to the wrong place.

1. **Nothing structurally blocking** — a required backup with no command, or a PR-based promotion with
   no way to open a PR
2. **No failing automatic check** — version bumped, changelog written, working tree clean, and every
   required CI check green
3. **Every manual check attested** — you explicitly confirming the things a machine can't verify
4. **Approval recorded**, where the target stage needs one
5. **Type-to-confirm** on a protected target — you type the stage's name

The plan is **rebuilt from live state the moment you press the button**, not taken from whatever the
screen last showed you. A check that went red while you were reading still stops you.

### Two kinds of evidence, kept apart

**Automatic checks** are CI reporting green. **Manual checks** are you saying you looked.

These are deliberately never allowed to substitute for each other. Where AtlasMind *can* read a CI
result directly, a check that would have been manual is promoted to automatic — because attesting to
something you didn't actually do puts a falsehood in a permanent record, which is worse than having no
record at all.

---

## Things that hold no matter what you configure

- **AtlasMind never force-pushes.** Where a force is genuinely unavoidable it uses a lease. To a
  protected branch it refuses outright.
- **Every command comes from your configuration**, read on the server side. The dashboard can trigger a
  promotion and attest a check; it can never supply a command to run.
- **Release fixes never push, tag or force-push.** The Detected Runbook shows **Prepare release version**
  as a prerequisite. Resolve & run updates the manifest, npm root lockfile version, formal changelog,
  recognised README current-version markers, and an existing wiki changelog as one scoped commit. It
  never creates a project-specific mirror that was not already there.
- **Production is protected by default**, and the backup gate denies by default.
- **The history is append-only.** Entries get added, never rewritten.

---

## Rollback

Each stage can declare a rollback command, which is lock-guarded and recorded exactly like a promotion.

AtlasMind will not write one for you, for the same reason it won't write your backup command: a rollback
that doesn't genuinely restore service is worse than knowing you don't have one.

---

## Related

- [[GitHub Workflow]] — the eight-stage workflow this is part of
- [[Project Planner]] — autonomous runs route deployments through here rather than deploying directly
- [[Tool Execution]] — the approval model shared with the rest of AtlasMind
- [[Website Studio]] — the Develop → Staging → Production path for client sites
- [[Security]] — these boundaries in their wider context
