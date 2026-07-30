# Technical debt

> Generated from `tech-debt.json` by AtlasMind. Entries **transition** —
> they are never deleted. Hand edits to this file are lost.

- **Open:** 8 · **closed:** 0
- **Last scan:** 2026-07-30T04:39:18.633Z

Severity comes from a **declared rule**, never from a judgement call. The rule
is named on every entry so the grade can be argued with, and it does **not**
drift with age — an entry whose severity changed while nothing about the code
changed could not be compared with last month's.

## Open

| Severity | Domain | What | Where | Since | Rule |
|---|---|---|---|---|---|
| medium | test | ATDD is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 | `uncovered-methodology` |
| medium | test | BDD is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 | `uncovered-methodology` |
| medium | test | Contract is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 | `uncovered-methodology` |
| medium | test | End-to-End is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 | `uncovered-methodology` |
| medium | test | Model-Based (MBT) is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 | `uncovered-methodology` |
| medium | test | Mutation Testing is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 | `uncovered-methodology` |
| medium | test | Performance is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 | `uncovered-methodology` |
| medium | test | Property-Based is enabled with no evidence it runs | `project_memory/index/testing-config.json` | 2026-07-30 | `uncovered-methodology` |

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
