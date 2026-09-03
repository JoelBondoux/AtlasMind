# Data privacy and GDPR controls

AtlasMind includes a project-scoped Data Privacy policy and a built-in **GDPR — Personal Data**
detector pack. These controls reduce the chance that personal or classified project context reaches a
model The User did not select for that purpose. They are technical safeguards, not a compliance
certification, legal advice, a lawful-basis assessment, or a replacement for a data protection impact
assessment.

## What is enforced

| Control | Current behaviour |
|---|---|
| Explicit activation | The policy is off by default. No detector, routing restriction, or personal-data redaction is reported as active until the policy is enabled. |
| Project-owned policy | The configuration is stored in `project_memory/operations/data-privacy.json`, so rule and trust changes are reviewable with the project. |
| GDPR detector pack | `gdpr-pii` looks for plausible personal email addresses, labelled or international phone numbers, public IP addresses, dates of birth with a DOB cue, and postal addresses. Reserved/example values, role mailboxes, private IP ranges, and version-shaped dotted quads are deliberately excluded. |
| Custom classification | Literal terms, bounded regular expressions, and workspace-relative path globs can classify project-specific material as `confidential`, `proprietary`, or `secret`. Invalid regular expressions and paths outside the workspace do not become active rules. |
| Deny-by-default model trust | A model receives classified values intact only when its exact id is in `trustedModelIds`. An empty list and an unknown model id trust nothing. |
| Transfer boundary | GDPR/CCPA matches are `confidential`: routing may continue to the selected model, but matched spans are replaced with `[CONFIDENTIAL]` for an untrusted model. `secret` HIPAA/PCI matches additionally restrict model candidates to the trusted list when one is available. |
| Tool-result boundary | Text returned by tools is scanned before it is returned to an untrusted model. A file-read result whose path matches a classification rule is withheld as a whole. |
| Activity evidence | AtlasMind records the detector/rule label, sensitivity, time, and whether the selected model was trusted. It never records the matched value. The most recent 1,000 events are retained in VS Code workspace state and summarized on the Privacy page. |
| Provider governance | For providers hosting trusted models, the Privacy page links to the recorded privacy policy, DPA, retention summary, training stance, and data-subject-request route. An unknown provider is shown as unknown rather than assigned reassuring terms. |
| Director PII consent | Saving raw personal data in the Project Director requires a one-time acknowledgement and enables both the Data Privacy policy and the `gdpr-pii` pack. AtlasMind prefers references to an external system of record over local copies. |

The orchestrator scans the assembled context, not only the latest message. That includes retrieved
memory, live evidence, supplemental context, and the structured conversation bundle. Each slice is
classified separately so a notice can name where a detector fired without repeating the value.

## Enable and review the policy

1. Open **Project Dashboard → Privacy**.
2. Enable Data Privacy and select **GDPR — Personal Data**.
3. Add project-specific term, regular-expression, or path rules where the built-in heuristics cannot
   describe the project's data accurately.
4. Select only the exact model ids approved to receive classified values.
5. Save, then use the text/path test control with synthetic data before relying on the policy.
6. Review the activity summary and each trusted provider's current governance links periodically.

Selecting a model as trusted is a technical routing decision. It does not establish a lawful basis,
approve an international transfer, accept a provider DPA, configure provider-side retention, or prove
that a data-subject request reaches every store. Those decisions remain with the project's data
controller and should be recorded in its own governance process.

## Override policy

There is no per-turn GDPR bypass and no approval button that exposes a matched value to an untrusted
model. Tool approvals, autonomous-run approval modes, and retry/failover settings do not override the
Data Privacy boundary. When no trusted model is available, AtlasMind redacts or withholds classified
content rather than treating an unknown model as trusted.

The User can explicitly edit or disable the project policy on the Privacy page. That is a persistent
policy change, not a temporary exception, and the current format does not require or audit a GDPR
rationale. Consequently, AtlasMind does **not** claim to implement the roadmap's future
"reasoned and logged GDPR override" capability. A project that requires exception approval should keep
the policy enabled, document the decision in its own reviewed compliance record, and change the trusted
model or classification rules only after that review.

Direct edits to `project_memory/operations/data-privacy.json` are also policy changes. The extension
reloads that file, but source control review—not AtlasMind—is currently the audit trail for who changed
it and why.

## Retention and data-subject requests

The GDPR pack detects and controls model-bound context; it does not discover every personal-data store
in the product being developed and does not execute deletion, rectification, export, consent withdrawal,
or legal-hold workflows. Use the Testing page's GDPR and Data Retention control mappings to record the
scope, owner, evidence, and status of those obligations. An unassessed mapping remains unassessed.

AtlasMind's own relevant stores are intentionally distinguishable:

- the project policy is a repository file retained until the project removes it;
- privacy activity contains metadata only, is capped at 1,000 events, and lives in VS Code workspace
  state rather than the repository;
- Project Director contacts may contain raw PII only after acknowledgement, while its Markdown mirror
  omits raw communication handles;
- provider-side prompts, outputs, and account data follow the provider's current terms, linked from the
  Privacy page rather than copied into this document as a permanent promise.

## Verification and limits

The automated GDPR regression suite covers activation defaults, representative detector precision,
redaction for untrusted and unknown models, explicit trust, provider governance references, and the rule
that notices do not contain matched values. Detector tests cannot prove exhaustive recognition. A false
negative can still expose data, while a false positive can remove useful context, so project-specific
rules and real governance review remain necessary.

See also [Architecture](architecture.md#dataprivacymanager-srccoredataprivacymanagerts),
[Configuration](configuration.md), and [Agents and skills](agents-and-skills.md).
