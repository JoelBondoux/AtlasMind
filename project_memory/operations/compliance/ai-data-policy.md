# AI Memory & Data-Use Policy — control mapping

**Regime:** AI memory and data-use policy

> Seeded by AtlasMind and **never rewritten** — this file fills with human decisions,
> so re-running the scaffolder leaves it exactly as you left it. It is the evidence
> AtlasMind reads when scoring this policy on the Testing dashboard.

## Before this mapping means anything

What the product promises about customer data — training use, retention, and separation between customers — and which provider settings back each promise.

## Controls

Every row starts at **Not assessed**, which is deliberately not the same as *compliant*.
An unassessed control and a satisfied one are different facts, and seeding a pass would
assert something nobody checked. Set a status only when you have looked.

Status is one of: `Not assessed` · `Satisfied` · `Partial` · `Gap` · `Not applicable`.
A `Not applicable` needs a justification in the Evidence column — that is what an
assessor will ask for.

| Ref | Requirement | Status | Evidence | Owner |
|---|---|---|---|---|
| `AID-1` | Training-use commitment stated and matched by provider configuration | Not assessed | _none recorded_ | _unassigned_ |
| `AID-2` | Provider zero/limited-retention setting verified where promised | Not assessed | _none recorded_ | _unassigned_ |
| `AID-3` | Every path reaching a model applies the redaction boundary | Not assessed | _none recorded_ | _unassigned_ |
| `AID-4` | Retrieval is filtered by tenant on every query path | Not assessed | _none recorded_ | _unassigned_ |
| `AID-5` | Secrets cannot reach a prompt, asserted at the dispatch boundary | Not assessed | _none recorded_ | _unassigned_ |
| `AID-6` | Stored memory has a retention window and a deletion route | Not assessed | _none recorded_ | _unassigned_ |
| `AID-7` | Sub-processor list current and disclosed | Not assessed | _none recorded_ | _unassigned_ |

## Open gaps

_List each `Gap` or `Partial` above with a remediation owner and a target date._

## Review log

| Date | Reviewer | Scope of review |
|---|---|---|
| _not yet reviewed_ | | |
