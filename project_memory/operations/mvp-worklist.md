# MVP execution record

Updated: 2026-10-19. Canonical scope and priority:
[Developer Roadmap](../roadmap/improvement-plan.md). Local work only; no hosted CI, publication or
installed-app acceptance is implied by the status below.

## Implemented in 0.506.0

- `roadmap-canvas-for-the-deliv`: Delivered nodes expose Auto tree, both directions, snap and
  completion-month reset alongside existing edit/link/route/zoom/selection controls. Single/group
  positions survive reload and remain independent of the plan. Evidence: executed dashboard DOM,
  host-handler, deterministic-layout and disk round-trip regression tests.
- `expand-baseline-comparrison`: Compare a named baseline with current project state or another
  saved baseline; show exact endpoints, directional before/after readings and explicit repository/
  component-scope incompatibility. No model, network fetch or observation rewrite occurs during a
  saved comparison. Evidence: pure comparison, host selection/boundary and dashboard DOM tests.

## Definition of done for this increment

Regression fails before the behavior change; focused behavior tests pass; standard full local CI
passes (compile, lint, integration audit, tests, provider recommendations, coverage and VSIX package);
version/docs/wiki align; unrelated dirty work stays untouched. Installed-app/manual acceptance and
hosted checks are recorded separately, not substituted by fixtures.

## Next MVP work

The next open MVP item in canonical order is Game Dev's scoped consumers. Its next declared slice
is performance-report coverage in [the phased plan](../roadmap/game-engine-integration.md). Team
management is ahead of it in the overall backlog but has no MVP gate. Other open MVP items remain
open; the two completed refinements do not establish whole-MVP completion.

## Validation evidence

- Baseline `ci:local:quick`: 12,036 tests passed before changes.
- Regression runs: six delivered-layout failures and three saved-comparison failures reproduced
  before their fixes (ignored logs under `test-results/mvp-validation`).
- Full `npm run ci:local`: passed compilation, lint, integration audit, 579 test files, provider
  recommendation checks, coverage (12,055 tests; 63.05% lines) and the 0.506.0 VSIX package.
- Final refinement suite: 188 tests passed; final lint passed. The packaged build runs production
  compilation again, after the final source changes.
- Separate test-source typecheck: 215 errors, identical line-for-line to the unchanged develop
  baseline. No additional errors were introduced by this increment.
- VSIX inspection: manifest version 0.506.0; no `.git`, `.claude`, `.atlasmind`, `test-results` or
  project-memory artifacts. Installed UI/manual acceptance and hosted CI have not been performed.

Documentation triggers checked: existing core services, webview, roadmap overlay persistence and
user-facing workflow guidance updated with matching wiki pages. No source files, commands, slash
commands, configuration settings, provider/routing contracts, tool approvals or scheduler behavior
were added or changed. Release metadata and the three-entry README history are synchronized.
