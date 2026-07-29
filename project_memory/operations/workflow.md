# Workflow

> Generated from `workflow.json` by AtlasMind. Edit the JSON or the Workflow
> page — this file is regenerated and hand edits are lost.

- **Profile:** solo
- **Integration branch:** `develop`
- **Release branch:** `main`
- **Protected:** `main`, `master`, `production`, `prod`, `release`, `stable`, `development`
- **Branch names:** `type-issue-slug`, max 60 characters
- **Types:** feat, fix, chore, docs, refactor, test, perf
- **Labels:** bug, enhancement, documentation, security, dependencies, workflow

## Stages

What a stage *requests*. What it gets is the lowest of four independent gates
— this file, your automation ceiling, the matching capability switch, and the
master switch — so a stage asking for `auto` still does nothing until every
one of them agrees.

| Stage | Enabled | Requests | Attestations | CI checks | Blockers |
|---|---|---|---|---|---|
| Planning & issue intake | yes | `observe` (reports only) | Acceptance criteria written | — | — |
| Branch creation & naming | yes | `observe` (reports only) | — | — | — |
| Local development & orchestration | yes | `observe` (reports only) | — | — | — |
| Pull requests & reviews | yes | `observe` (reports only) | Self-reviewed the diff; Linked to an issue; Version bumped and changelog written | CI | — |
| CI/CD & failure analysis | yes | `observe` (reports only) | — | CI | — |
| Release automation | yes | `observe` (reports only) | Changelog entry written; Version bumped; README banner matches package.json | CI | — |
| Maintenance & tech debt | no | `observe` (reports only) | — | — | — |
| Automation policy | no | `observe` (reports only) | — | — | — |

## What this file cannot do

- It cannot raise your automation ceiling. Personal settings can only lower.
- It cannot remove a stage. A stage you do not use is disabled, so the
  decision stays in the record rather than vanishing from it.
- It cannot authorise a force-push, a tag deletion, a CI re-run, a CI
  workflow edit, or a dependency merge. Those are outside the ladder at
  every level.
