# SOC 2 Type I/II — control mapping

**Regime:** SOC 2 Trust Services Criteria

> Seeded by AtlasMind and **never rewritten** — this file fills with human decisions,
> so re-running the scaffolder leaves it exactly as you left it. It is the evidence
> AtlasMind reads when scoring this policy on the Testing dashboard.

## Before this mapping means anything

Which criteria are in scope (Security is mandatory; Availability, Confidentiality, Processing Integrity and Privacy are opt-in), and whether the report is Type I or Type II. A Type II asks for evidence *over a period*, so decide the observation window before filling anything in — a control satisfied today with no history behind it does not pass a Type II.

## Controls

Every row starts at **Not assessed**, which is deliberately not the same as *compliant*.
An unassessed control and a satisfied one are different facts, and seeding a pass would
assert something nobody checked. Set a status only when you have looked.

Status is one of: `Not assessed` · `Satisfied` · `Partial` · `Gap` · `Not applicable`.
A `Not applicable` needs a justification in the Evidence column — that is what an
assessor will ask for.

AtlasMind automatically checks **part of 10** of these controls against your
stack, and the live result is on the Testing page. Those rows still start at *Not assessed*
on purpose: an automated check covers a fragment of a control, not the whole of it, and
deciding whether that fragment satisfies the requirement is the judgement being asked for.


### Governance and organisational

| Ref | Requirement | Status | Evidence | Owner |
|---|---|---|---|---|
| `CC1.1` | Commitment to integrity and ethical values demonstrated | Not assessed | _none recorded_ | _unassigned_ |
| `CC1.2` | Independent oversight of internal control exercised | Not assessed | _none recorded_ | _unassigned_ |
| `CC1.3` | Structures, reporting lines and authority established | Not assessed | _none recorded_ | _unassigned_ |
| `CC1.5` | Individuals held accountable for their control responsibilities | Not assessed | _none recorded_ | _unassigned_ |
| `CC2.1` | Quality information obtained to support internal control | Not assessed | _none recorded_ | _unassigned_ |
| `CC2.2` | Control responsibilities communicated internally | Not assessed | _none recorded_ | _unassigned_ |
| `CC2.3` | Relevant matters communicated to external parties | Not assessed | _none recorded_ | _unassigned_ |
| `CC3.1` | Objectives specified clearly enough to assess risk against | Not assessed | _none recorded_ | _unassigned_ |
| `CC3.2` | Risks to the objectives identified and analysed | Not assessed | AtlasMind checks part of this — see Testing → Policy coverage | _unassigned_ |
| `CC3.4` | Significant changes assessed for their effect on control | Not assessed | _none recorded_ | _unassigned_ |
| `CC4.1` | Ongoing evaluations confirm the controls are present and working | Not assessed | AtlasMind checks part of this — see Testing → Policy coverage | _unassigned_ |
| `CC4.2` | Control deficiencies evaluated and communicated to those who can act | Not assessed | _none recorded_ | _unassigned_ |
| `CC5.1` | Control activities selected and developed to mitigate risk | Not assessed | _none recorded_ | _unassigned_ |
| `CC9.2` | Vendor and business-partner risk assessed and managed | Not assessed | AtlasMind checks part of this — see Testing → Policy coverage | _unassigned_ |

### People

| Ref | Requirement | Status | Evidence | Owner |
|---|---|---|---|---|
| `CC1.4` | Commitment to attract, develop and retain competent people | Not assessed | _none recorded_ | _unassigned_ |

### Technological

| Ref | Requirement | Status | Evidence | Owner |
|---|---|---|---|---|
| `CC6.1` | Logical access controls restrict access to protected assets | Not assessed | AtlasMind checks part of this — see Testing → Policy coverage | _unassigned_ |
| `CC6.2` | User registration and de-registration are authorised | Not assessed | _none recorded_ | _unassigned_ |
| `CC6.3` | Access is modified and removed on role change or exit | Not assessed | _none recorded_ | _unassigned_ |
| `CC6.6` | External access points are protected | Not assessed | AtlasMind checks part of this — see Testing → Policy coverage | _unassigned_ |
| `CC6.7` | Data in transit and at rest is protected | Not assessed | AtlasMind checks part of this — see Testing → Policy coverage | _unassigned_ |
| `CC7.2` | Anomalies are monitored and detected | Not assessed | AtlasMind checks part of this — see Testing → Policy coverage | _unassigned_ |
| `CC7.3` | Security incidents are evaluated and responded to | Not assessed | AtlasMind checks part of this — see Testing → Policy coverage | _unassigned_ |
| `CC8.1` | Changes are authorised, tested and approved before deployment | Not assessed | AtlasMind checks part of this — see Testing → Policy coverage | _unassigned_ |
| `A1.2` | Backup and recovery meet availability commitments (if in scope) | Not assessed | AtlasMind checks part of this — see Testing → Policy coverage | _unassigned_ |

## Open gaps

_List each `Gap` or `Partial` above with a remediation owner and a target date._

## Review log

| Date | Reviewer | Scope of review |
|---|---|---|
| _not yet reviewed_ | | |
