# Plan: The guided GitHub workflow — one canonical, deterministic, eight-stage workflow

> Filing record for roadmap item `the-guided-github-workflow-o` (backlog entry `roadmap-28`).
> This file is referenced from `roadmap-graph.json`; the roadmap entry links here.

## Objective

Deliver a single executable workflow across eight stages:
`Planning & issue intake → Branch creation → Local development → Pull requests → CI/CD → Release → Maintenance → Automation`.
The workflow must be deterministic, rule-driven, and surfaced as a teaching + instrumentation surface in the Workflow page.

## Context

- Focus: delivery
- Branch: `chore/the-guided-github-workflow-one-canonical-deterministic`
- Scope: close implementation gaps between roadmap spec, dashboard behavior, and persisted workflow state
- Prerequisites:
  - `workflow.json` and curriculum are loadable and version-compatible
  - all writes remain gated by the automation ladder
  - issue/PR/CI content remains sanitized as untrusted input
- Success signal: each stage has a measurable transition and an append-only audit entry.

## Approach

Use existing modules first, then add narrow glue only where a deterministic seam is missing.
Keep the same control plane as `workflow.json` (pure config + ladder gates) and keep
execution on existing audited paths (`ghClient.ts` + existing `gh` skill wrappers).

- Preserve rule-driven behavior: models explain and propose, not classify or decide.
- Keep stage transitions explicit in state, not inferred from prose or comments.
- Keep local-first behavior where already possible (release planning and diagnostics should work without live GitHub).

## Steps

### Stage 1 — Planning & issue intake

- [ ] Confirm planning stage contract in `workflowConfig` and ensure curriculum, checks, and checksums are complete.
- [ ] Implement/validate issue intake drafting that only emits declared labels and generates deterministic acceptance criteria.
- [ ] Gate proposals on issue-taxonomy fit and deterministic roadmap item mapping.
- [ ] Add issue metrics instrumentation: open-by-label, open-by-assignee, stale windows, age buckets.
- [ ] Ensure refusal paths are surfaced with explicit gate names and reasons.

### Stage 2 — Branch creation

- [ ] Finalize deterministic branch-name derivation (`type`, `issueNumber`, slug, naming convention, ASCII safety).
- [ ] Guard generated names against reserved/protected branch names and illegal characters.
- [ ] Resolve naming collisions with deterministic suffixing (no timestamps/hashes for canonical reproducibility).
- [ ] Add pre-write checks against integration-branch protection before branch creation.

### Stage 3 — Local development

- [ ] Ensure branch-to-ticket linkage appears in dashboard state and stage checks.
- [ ] Add development readiness checks tied to declared workflow checks (where applicable) before PR handoff.
- [ ] Record development milestone state as a stable, append-only stage transition input.
- [ ] Block PR transition when required preconditions are missing or stale.

### Stage 4 — Pull requests

- [ ] Keep PR draft generation deterministic with fixed templates for title/body/checklist.
- [ ] Finish pull-request tracker boundary alignment with issue boundary sanitization/fencing.
- [ ] Deliver structured review ingestion (`path`, `line`, `severity`, `ruleId`) and file-button actions.
- [ ] Keep "address finding" actions scoped and fenced with untrusted-content handling.

### Stage 5 — CI/CD

- [ ] Run CI diagnostics on demand (`run list`, `jobs`, failed log view) with no periodic polling.
- [ ] Finalize deterministic failure taxonomy first-match order:
  `dependency-install → compile → lint → test-failure → timeout → flake-suspect → infra → unknown`.
- [ ] Add/lock CI metrics (pass rate, failure classes, time-to-green, flake buckets).
- [ ] Keep all logs capped, redacted, truncated-visible, and never treated as empty-success when missing.

### Stage 6 — Release

- [ ] Finalize release gate chain from local files: bump detection, monotonicity, changelog insertion, README/version alignment.
- [ ] Make release plan executable without GitHub for diagnostics and explicitly non-destructive.
- [ ] Enforce single publish path and remove the double-publish hazard by design.
- [ ] Keep release notes as canonical output from changelog entries (no model-generated prose).

### Stage 7 — Maintenance

- [ ] Ensure maintenance stage surfaces debt register state and sweeps for stale debt/stale-doc/dependency signals.
- [ ] Keep findings append-only and lifecycle transitions explicit (accepted/resolved/obsolete, no silent delete).
- [ ] Add maintenance reporting cards with owner, domain, and time-since-detection.

### Stage 8 — Automation

- [ ] Reaffirm all destructive and expensive operations are denied unless ladder gate evaluates true.
- [ ] Validate handoff/delegation path enforces caller-target permission intersection.
- [ ] Wire automation policy visibility (what is automatic, what is proposed, what is observed) into each stage card.
- [ ] Ensure every auto attempt emits both refusal audit and success audit fingerprints.

## Verification

- Unit and service tests:
  - no shell-form `gh` execution through workflow write paths
  - deterministic branch naming and PR draft outputs
  - failure classifier fixtures for each taxonomy bucket
  - migration safety for workflow config and curriculum
- Stage-level checks:
  - each stage card renders with `why/how/commonMistakes`
  - state transitions require gate pass and record audit rows
  - refusal states are explicit and actionable
- Release path:
  - monotonic semver checks pass
  - changelog/package/readme consistency checks pass
  - publish attempts are single-shot and tagged in the expected path

## Completion criteria

- The eight stages can be traversed from intake to release with deterministic, auditable transitions.
- All stage writes are mediated by gates and recorded; no silent skips or untracked write actions remain.
- CI and release diagnostics work in local-only mode using committed files plus on-demand GitHub reads.
- The workflow page teaches and enforces the process without requiring external, undocumented commands or manual memory.
