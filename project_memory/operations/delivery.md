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
- **Config source:** — (location only — secret values stay in your secret store)
- **Data:** No application database
- **Backup before promotion:** not required

### 2. Integration — `staging`

Shared integration branch (`develop`). Work merges here and is built, linted, and tested together before a release is promoted to production.

- **Branch:** `develop`
- **Hosting:** —
- **Config source:** — (location only — secret values stay in your secret store)
- **Data:** No application database
- **Backup before promotion:** not required

### 3. Production — `production` 🔒 protected

The released product your users install or consume via VS Code Marketplace. Promotion is the release: version-gated, requires sign-off, and never force-pushed.

- **Branch:** `master`
- **Hosting:** VS Code Marketplace
- **Config source:** — (location only — secret values stay in your secret store)
- **Data:** No application database
- **Backup before promotion:** not required

## Promotions

### Local → Integration

Every promotion runs the same guarded sequence:

1. **Preflight gate** — the required checks below must all pass, or the promotion aborts.
2. **Backup** — optional for this target.
3. **Promote** — the build is merged/tagged forward. AtlasMind never force-pushes.
4. **Verify** — the target is health-checked after deploy.

- **Required checks:** `Working tree clean`, `Compile/build passes`, `Lint passes`, `Tests pass`
- **Required CI status checks:** `quality (ubuntu-latest)`, `quality (windows-latest)`, `quality (macos-latest)`
- **Promotion mechanism:** direct merge/tag
- **Approval:** not required
- **Version bump required:** yes
- **Changelog entry required:** yes

### Integration → Production

Every promotion runs the same guarded sequence:

1. **Preflight gate** — the required checks below must all pass, or the promotion aborts.
2. **Backup** — optional for this target.
3. **Promote via Pull Request** — open a PR into `master` (a protected branch); the required status checks must be green and the PR merged. AtlasMind never force-pushes or pushes directly.
4. **Verify** — the target is health-checked after deploy.

- **Required checks:** `Working tree clean`, `Compile/build passes`, `Lint passes`, `Tests pass`
- **Required CI status checks:** `quality (ubuntu-latest)`, `quality (windows-latest)`, `quality (macos-latest)`
- **Promotion mechanism:** Pull Request into a protected branch
- **Approval:** a human must sign off before anything runs
- **Version bump required:** yes
- **Changelog entry required:** yes

---

_Last updated: 2026-06-21T00:12:30.699Z._
