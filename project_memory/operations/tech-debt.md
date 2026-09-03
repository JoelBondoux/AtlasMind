# Technical debt

> Generated from `tech-debt.json` by AtlasMind. Entries **transition** —
> they are never deleted. Hand edits to this file are lost.

- **Open:** 0 · **closed:** 8
- **Last scan:** 2026-07-30T04:39:18.633Z

Severity comes from a **declared rule**, never from a judgement call. The rule
is named on every entry so the grade can be argued with, and it does **not**
drift with age — an entry whose severity changed while nothing about the code
changed could not be compared with last month's.

## Open

_Nothing open._ An empty register means nothing was found or nothing was scanned — not that no debt exists.

## Closed

`resolved` means somebody did the work. `obsolete` means the evidence went
away and nobody said they fixed it — a different fact, and only one of them
is an accomplishment.

| Status | What | Where | Since |
|---|---|---|---|
| obsolete | ATDD is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 |
| resolved | BDD is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 |
| obsolete | Contract is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 |
| obsolete | End-to-End is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 |
| obsolete | Model-Based (MBT) is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 |
| resolved | Mutation Testing is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 |
| obsolete | Performance is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 |
| resolved | Property-Based is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 |

## The rules

| Rule | Domain | Severity | Why |
|---|---|---|---|
| `security-marker` | security | high | A marker mentioning security, a credential, or an injection. Never graded lower whatever else it looks like. |
| `broken-marker` | code | medium | A `FIXME`, `HACK` or `XXX`. These assert that something is wrong, which outranks something being absent. |
| `todo-marker` | code | low | A `TODO`. Something absent rather than something broken. |
| `stale-dependency-pr` | dependency | high | A dependency update open longer than the stale threshold. An unmerged security update is worse than an unopened one, because somebody already decided it mattered. |
| `uncovered-methodology` | test | medium | A testing methodology enabled with no evidence it runs. The gap between what a project says it does and what it does. |
| `stale-document` | documentation | low | A tracked document past its review baseline. Low because a stale document is usually still mostly true. |
| `missing-ci` | infrastructure | medium | No CI workflow. On a solo project CI is not a supplement to review — it is the review. |
