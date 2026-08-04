# Delivery

**Getting your work safely from your machine to production** — and knowing exactly what has to be true
before each step.

Every other part of AtlasMind is about *making* a change. Delivery is about *moving* one, somewhere a
mistake is expensive to undo. That's why it's the most carefully gated thing here.

Open it from **Project Dashboard → Delivery**.

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
- **Release fixes never push, tag or force-push.** At most they edit `package.json` and `CHANGELOG.md`
  and make a scoped commit.
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
