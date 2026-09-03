# Data privacy and GDPR

AtlasMind can classify personal or confidential project context before it reaches a model. The controls
are technical safeguards, not a GDPR certification or legal advice.

## Turn it on deliberately

Open **Project Dashboard → Privacy**, enable Data Privacy, select **GDPR — Personal Data**, and choose
the exact models allowed to receive classified values. The policy is off by default, and an empty trusted
list trusts nothing.

The built-in GDPR pack looks for plausible personal email addresses, labelled or international phone
numbers, public IP addresses, dates of birth with a DOB cue, and postal addresses. It deliberately skips
common documentation values such as `example.com`, role mailboxes, private/test IP ranges, and dotted
version numbers. Add project-specific term, regular-expression, or path rules when a heuristic cannot
describe your data accurately.

## What happens to a match

- A GDPR or CCPA match is redacted as `[CONFIDENTIAL]` before an untrusted model receives the text.
- A tool result is scanned on the return path; a file matching a classified path rule is withheld whole.
- An exact model id on the trusted list may receive the classified value intact.
- The activity view records the rule label, sensitivity, time, and trust decision—never the matched value.
- The provider section links to privacy, DPA, retention, training, and data-subject-request information
  for providers hosting trusted models.

AtlasMind scans the assembled context, including memory, evidence, attachments/tool output, and the
structured conversation bundle—not only the message just typed.

## Overrides are intentionally narrow

There is no per-turn GDPR bypass. Tool approvals, autonomous approval modes, retries, and provider
failover cannot make an untrusted model trusted. If no trusted model is available, AtlasMind redacts or
withholds the classified content.

The User can edit or disable the saved project policy. That is a persistent configuration change, not a
temporary exception, and AtlasMind does not currently require or audit a legal rationale for it. The
future roadmap item for reasoned, logged compliance overrides therefore remains future work. Source
control review is the current audit trail for direct changes to
`project_memory/operations/data-privacy.json`.

## What AtlasMind does not decide

Trusting a model does not establish lawful basis, approve an international transfer, accept a DPA,
configure provider retention, or prove erasure across every store. The GDPR and Data Retention mappings
on the Testing page help record those human decisions; they start **Not assessed** and AtlasMind does not
turn absence of evidence into a pass.

For the exact enforcement paths, retained metadata, and verification boundaries, read the
[developer control reference](../docs/data-privacy-and-gdpr.md). See [[Security]] for the wider trust
model.
