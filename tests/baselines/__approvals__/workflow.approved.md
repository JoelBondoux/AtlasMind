## GitHub workflow (managed by AtlasMind)

> Auto-generated from `project_memory/operations/workflow.json`. Do not edit by hand —
> changes are overwritten on the next sync. Edit the workflow file, or the Workflow page.

This repository follows a declared GitHub workflow. It is recorded in
`project_memory/operations/workflow.json` and is the authority for the rules below —
if this block and that file disagree, the file wins and this block is stale.

These rules apply to **you**, whichever tool you are. AtlasMind cannot gate a process it
does not run, so nothing here is enforced by machinery on your side: it is enforced by you
reading it. Where a rule and convenience conflict, follow the rule and say that you did.

### Branches

- Integration branch (normal push target): `develop`
- Release branch: `main`
- **Protected — never push directly:** `main`, `master`, `production`, `prod`, `release`, `stable`, `development`. Reach these through a reviewed pull request only.
- New branches: `<type>/<issue>-<slug>`, at most 60 characters, type from `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`.

### Stages

No workflow stage has been enabled for this project yet, so there are no per-stage
automation rules. The branch and label conventions above still apply.

### Labels

Use **only** these. A label that does not exist is *created* on the repository as a side
effect of applying it, so inventing one changes the project's taxonomy without asking.
Pick at most one from each category.

- **type:** `bug`, `enhancement`, `documentation`, `refactor`, `test`

### Testing

Testing requirements are **not** duplicated here. They live in
`project_memory/index/testing-config.json` and are described in the testing-protocols block
of this same file. Follow those.
