# Model-Output Risk Classification — control mapping

**Regime:** Model-output risk classification

> Seeded by AtlasMind and **never rewritten** — this file fills with human decisions,
> so re-running the scaffolder leaves it exactly as you left it. It is the evidence
> AtlasMind reads when scoring this policy on the Testing dashboard.

## Before this mapping means anything

The risk classes this product distinguishes, and what handling each one triggers — review, disclaimer, refusal, or logging.

## Controls

Every row starts at **Not assessed**, which is deliberately not the same as *compliant*.
An unassessed control and a satisfied one are different facts, and seeding a pass would
assert something nobody checked. Set a status only when you have looked.

Status is one of: `Not assessed` · `Satisfied` · `Partial` · `Gap` · `Not applicable`.
A `Not applicable` needs a justification in the Evidence column — that is what an
assessor will ask for.

| Ref | Requirement | Status | Evidence | Owner |
|---|---|---|---|---|
| `RISK-1` | Risk classes defined with examples of each | Not assessed | _none recorded_ | _unassigned_ |
| `RISK-2` | Labelled evaluation set exists and is version-controlled | Not assessed | _none recorded_ | _unassigned_ |
| `RISK-3` | Recall measured on the rare high-risk class, not overall accuracy alone | Not assessed | _none recorded_ | _unassigned_ |
| `RISK-4` | Each class maps to a defined handling path | Not assessed | _none recorded_ | _unassigned_ |
| `RISK-5` | Escalation to human review is tested end to end | Not assessed | _none recorded_ | _unassigned_ |
| `RISK-6` | Threshold changes require re-evaluation against the labelled set | Not assessed | _none recorded_ | _unassigned_ |

## Open gaps

_List each `Gap` or `Partial` above with a remediation owner and a target date._

## Review log

| Date | Reviewer | Scope of review |
|---|---|---|
| _not yet reviewed_ | | |
