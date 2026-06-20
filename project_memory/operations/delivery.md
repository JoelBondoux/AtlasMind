# Delivery Pipeline

> Maintained by AtlasMind (Project Dashboard → Delivery). This is the human-readable
> mirror of `delivery.json`; edit either and the other is kept in sync from the dashboard.

A **stage** is one environment your software runs in. A **promotion** ("push") moves a
build from one stage to the next — safely, with a backup taken first and the listed
checks required to pass before anything changes.

## Stages

### 1. Local — `local`

Your own machine. Where you write and run code day to day. Data here is disposable — nothing your users see lives at this stage.

- **Branch:** — (working tree)
- **Hosting:** localhost
- **Config source:** .env.local (location only — secret values stay in your secret store)
- **Data:** Local development database (disposable)
- **Backup before promotion:** not required

### 2. Staging — `staging`

A production-like rehearsal environment. Changes land here first so they can be tested against realistic data and settings before any real users are affected.

- **Branch:** `develop`
- **Hosting:** TBD
- **Config source:** .env.staging (location only — secret values stay in your secret store)
- **Data:** Staging database (safe to reset)
- **Backup before promotion:** not required
  - Retention: Optional — staging data is generally reproducible.

### 3. Production — `production` 🔒 protected

The live environment your real users depend on. Every change here is treated as high-risk: it is backed up first, requires sign-off, and is never force-pushed.

- **Branch:** `master`
- **Hosting:** TBD
- **Config source:** .env.production (location only — secret values stay in your secret store)
- **Data:** Production database (real user data)
- **Backup before promotion:** required — ⚠️ no backup command set yet, so promotion to this stage is blocked until you add one
  - Retention: Recommended: keep at least 7 daily snapshots.

## Promotions

### Local → Staging

Every promotion runs the same guarded sequence:

1. **Preflight gate** — the required checks below must all pass, or the promotion aborts.
2. **Backup** — optional for this target.
3. **Promote** — the build is merged/tagged forward. AtlasMind never force-pushes.
4. **Verify** — the target is health-checked after deploy.

- **Required checks:** `Working tree clean`, `Compile passes`, `Tests pass`
- **Approval:** not required
- **Version bump required:** yes
- **Changelog entry required:** yes

### Staging → Production

Every promotion runs the same guarded sequence:

1. **Preflight gate** — the required checks below must all pass, or the promotion aborts.
2. **Backup** — a snapshot of **Production** is taken before any change, so it can be recovered.
3. **Promote** — the build is merged/tagged forward. AtlasMind never force-pushes.
4. **Verify** — the target is health-checked after deploy.

- **Required checks:** `Working tree clean`, `Compile passes`, `Tests pass`, `CI green`, `Staging verified`
- **Approval:** a human must sign off before anything runs
- **Version bump required:** yes
- **Changelog entry required:** yes

---

_Last updated: 2026-06-20T04:20:02.255Z._
