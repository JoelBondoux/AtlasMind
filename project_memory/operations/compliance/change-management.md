# Change-Management Compliance — control mapping

**Regime:** Change management

> Seeded by AtlasMind and **never rewritten** — this file fills with human decisions,
> so re-running the scaffolder leaves it exactly as you left it. It is the evidence
> AtlasMind reads when scoring this policy on the Testing dashboard.

## Before this mapping means anything

Which changes require which approvals, and the documented break-glass path for emergencies. Without a stated emergency route, the policy teaches people to bypass it.

## Controls

Every row starts at **Not assessed**, which is deliberately not the same as *compliant*.
An unassessed control and a satisfied one are different facts, and seeding a pass would
assert something nobody checked. Set a status only when you have looked.

Status is one of: `Not assessed` · `Satisfied` · `Partial` · `Gap` · `Not applicable`.
A `Not applicable` needs a justification in the Evidence column — that is what an
assessor will ask for.

| Ref | Requirement | Status | Evidence | Owner |
|---|---|---|---|---|
| `CHG-1` | Protected branches enforce review before merge | Not assessed | _none recorded_ | _unassigned_ |
| `CHG-2` | Required approvals defined by change type and area (CODEOWNERS) | Not assessed | _none recorded_ | _unassigned_ |
| `CHG-3` | Every production change traces to an issue or ticket | Not assessed | _none recorded_ | _unassigned_ |
| `CHG-4` | Deployment to production requires a recorded approval | Not assessed | _none recorded_ | _unassigned_ |
| `CHG-5` | Emergency change path documented, with retrospective approval required | Not assessed | _none recorded_ | _unassigned_ |
| `CHG-6` | Rollback procedure defined and exercised | Not assessed | _none recorded_ | _unassigned_ |
| `CHG-7` | Segregation of duties between author and approver | Not assessed | _none recorded_ | _unassigned_ |

## Open gaps

_List each `Gap` or `Partial` above with a remediation owner and a target date._

## Review log

| Date | Reviewer | Scope of review |
|---|---|---|
| _not yet reviewed_ | | |
