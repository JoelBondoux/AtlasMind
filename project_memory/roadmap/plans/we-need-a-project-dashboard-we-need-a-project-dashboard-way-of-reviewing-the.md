# Plan: We need a Project Dashboard way of reviewing the status, design plan, roadmap items, any other associated relevant data 

> Filing record for roadmap item `we-need-a-project-dashboard` (backlog entry `roadmap-2`).
> Created 2026-09-16 as an empty frame — nothing below was decided by a machine.
> This file is referenced from `roadmap-graph.json`; the roadmap entry links here.

## Objective

We need a Project Dashboard way of reviewing the status, design plan, roadmap items, any other associated relevant data of public release versions, such as tierd value releases. Perhaps include in this page a way to generate a roadmap Gate for each version listed. A visualiser of each version, its progress to a version mvp, any other links, statistics and observed data with AI suggestions.

## Context

- Focus: architecture
- Branch: `refactor/we-need-a-project-dashboard-way-of-reviewing-the`
- Estimate: 4.5d
- Deadline: none set
- Waits on: nothing — this can start now

## Approach

Extend the existing Project Dashboard Release page rather than creating a second release surface. Build a deterministic host-side portfolio that joins public GitHub release records to the release gates, roadmap routes, and filed plans AtlasMind already owns. The webview will only render that evidence and send opaque version or roadmap ids back to the host.

Each public version will show its release tier, publication date, roadmap-gate coverage, tracked progress, filed-plan coverage, relevant links, and an evidence-derived next suggestion. Creating a version gate remains a confirmed tracked-file write. Asking AtlasMind for deeper suggestions uses the configured dashboard chat destination and a prompt reconstructed from the host-owned snapshot.

## Steps

- [x] Add a release-portfolio projection that classifies public versions and joins them to roadmap gates, roadmap items, and filed plans.
- [x] Render a version visualiser and portfolio statistics on the Release page, including release, gate, roadmap, and plan links.
- [x] Add a confirmed action that creates the matching roadmap gate for a selected public version.
- [x] Add a governed AtlasMind hand-off for evidence-based version suggestions without accepting prompt text from the webview.
- [x] Add focused unit/webview contract coverage and run the relevant compile, lint, and test checks.
- [x] Update user/developer documentation, version metadata, and release notes required by the repository policy.

## Verification

- Unit-test semantic release-tier classification, newest-release selection, missing-gate handling, gate progress, and filed-plan coverage.
- Contract-test the extended `gh release list` parser and the new webview/host message paths.
- Run TypeScript compilation, ESLint, the focused dashboard tests, and the repository test suite if the focused checks pass.
- Inspect the final diff and verify that no unrelated roadmap or working-tree changes were overwritten.

## Completion criteria

- The Release page lists every fetched public release (stable and pre-release; drafts are explicitly excluded) with its tier and observed publication data.
- A release with a matching roadmap gate shows its real completed/total progress and filed-plan coverage; a release without one says it is unplanned rather than displaying 0%.
- The User can open the public release, review the matching roadmap route and filed plans, or create the matching gate after an explicit confirmation.
- The AtlasMind suggestion action is built from host-owned evidence and routed through the configured dashboard chat destination.
- Documentation, changelogs, and version metadata agree, and the relevant automated checks pass.
