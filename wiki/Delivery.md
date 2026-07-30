# Delivery

> The guarded promotion pipeline: how work moves from your machine to production, and what has to
> be true before each step.

Delivery is stage 6 of [[GitHub Workflow|the guided GitHub workflow]]. Where the workflow's other
stages are about *making* a change, delivery is about *moving* one — and moving it somewhere a
mistake is expensive to undo. That is why it is the most heavily gated part of AtlasMind.

Open it from the Project Dashboard → **Delivery**.

---

## The stage model

AtlasMind models delivery as **stages** connected by **promotion paths**. A stage is a place code
can be; a path is a permitted move between two of them.

| Stage | Kind | Typically |
|---|---|---|
| Local | `local` | Your working tree. |
| Integration | `staging` | The integration branch — `develop` in AtlasMind's own repository. |
| Production | `production` 🔒 | The release branch, and whatever it publishes to. Protected. |

Seeded from your repository's branches on first use, then yours to edit. The configuration lives in
`project_memory/operations/delivery.json` with a readable mirror at `delivery.md` — both tracked, so
a change to how your project ships shows up in a diff and gets reviewed like any other change.

A production stage is **protected** by default, and where a database is involved its backup policy
ships with an **empty command**. That emptiness is not an oversight — it is the gate. Promotion
stays blocked until you supply a real backup command, because AtlasMind cannot invent one that
would actually restore your data.

---

## What a promotion does

Every promotion runs the same fixed sequence. AtlasMind-injected guardrails are marked `managed`;
the deploy steps come from a routine you wrote.

```
preflight → backup → backup-verify → migrate → deploy → verify → record
```

- **Preflight** — the checks below, evaluated against live state.
- **Backup** — your command, if the stage declares one. Never AtlasMind's invention.
- **Deploy** — your routine's steps, or a `workflow_dispatch` trigger, or nothing.
- **Verify** — an HTTP health check, if you configured one.
- **Record** — appended to the promotion history before the run is considered done.

Promotions are **single-flight**: a lock with a 60-minute expiry means two people cannot release
at the same time, and a crashed process cannot block the pipeline permanently.

---

## The five gates

Evaluated **in this order**, and the first failure is the one reported. The ordering matters —
telling you "approval required" when the real problem is a red build sends you to the wrong place.

1. **No blockers.** Nothing structurally prevents the promotion — a required backup with no command, or a PR-based promotion with nothing able to open a PR.
2. **No failing automatic check.** Version bumped, changelog entry present, working tree clean, and every required CI context green.
3. **Every manual check attested.** You confirm, explicitly, the things a machine cannot verify.
4. **Approval recorded**, where the target stage requires it.
5. **Type-to-confirm** on a protected target — you type the stage's name.

The plan is **rebuilt from live state** at the moment you press the button, not taken from whatever
the screen last showed. A check that went red while you were reading still stops you.

### Automatic versus manual checks

`requiredStatusChecks` are CI contexts — a machine reporting green. `requiredChecks` are human
attestations — you saying you looked. They are deliberately kept apart, because they are different
kinds of evidence and collapsing them would let one stand in for the other.

Where AtlasMind can read a CI context live, a check that would otherwise be manual is promoted to
automatic. Attesting a manual check you did not perform puts something untrue in the permanent
record, which is worse than having no record.

---

## Safety boundaries

These hold regardless of any setting:

- **AtlasMind never force-pushes.** Where a force is unavoidable it uses a lease; to a protected branch it refuses outright.
- **Every command is server-sourced.** The dashboard can trigger a promotion and attest a check; it can never supply a command string. What runs comes from your persisted, user-authored configuration.
- **Release remediation never pushes, tags, or force-pushes.** It may edit `package.json` and `CHANGELOG.md` and make a path-scoped commit — nothing more.
- **Production is protected by default**, and the backup gate is deny-by-default.
- **The history is append-only.** Entries are added, never rewritten.

---

## Rollback

Each stage may declare a rollback command. Rollback is lock-guarded like a promotion and recorded
the same way. AtlasMind will not invent one: a rollback that does not actually restore service is
worse than knowing you have none, because it will be trusted at the worst possible moment.

---

## Related

- [[GitHub Workflow]] — the eight-stage workflow delivery is part of.
- [[Project Planner]] — autonomous runs route deployments through this pipeline rather than executing them directly.
- [[Tool Execution]] — the approval model shared with the rest of AtlasMind.
- [[Security]] — the boundaries above, in their wider context.
