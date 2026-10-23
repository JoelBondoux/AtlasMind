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

## Implemented in 0.507.0

- C2.6: bounded, read-only project-produced v1 performance reports; Tested/Measured distinction,
  explicit no-verdict paths and no inferred passing budgets. Schema, real collector and dashboard
  integration included. Game Dev remains open for C2.7 onward.

## Implemented in 0.508.0

- C2.7: confirmed game asset/LFS/import findings, explicit author TUNING points and exact fork counts
  past declared maxima. Same rule table; unknown/partial evidence keeps prior findings; measured
  details preserve manual decisions/history. Game Dev remains open for C2.8 onward.

## Next MVP work

The next open MVP item in canonical order is Game Dev's scoped consumers. Its next declared slice
is C2.8 decisive-file archetype detection; C2.6 and C2.7 are implemented above. See
[the phased plan](../roadmap/game-engine-integration.md). Team
management is ahead of it in the overall backlog but has no MVP gate. Other open MVP items remain
open; these completed slices do not establish whole-MVP completion.

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


## C2.6 validation evidence (0.507.0)

- Test-first failures captured for missing report support, missing UI measurements and unverified
  detail grading. Parser/coverage/detail, real collector, multi-root home selection and executed
  dashboard regressions pass. The schema vocabulary and reader limits are checked together.
- Full `npm run ci:local` passed: production/web compile, lint, integration audit, 580 test files,
  provider recommendations, coverage (12,083 tests; 63.08% lines) and VSIX packaging. The added
  multi-root test also passed separately, as did final docs integrity and targeted lint.
- Separate test-source typecheck remains at 215 pre-existing errors; no added report-reader/test errors.
- Compiled reader against this repository returned `no-report`; no fixture was installed as a real
  capture. There is no claimed engine/profile or budget acceptance.
- VSIX 0.507.0 contains the compiled reader and editor schema, with no project-memory, test-results,
  `.git`, `.claude` or `.atlasmind` artifacts. Hosted CI and installed UI acceptance remain separate.
- New source, core policy/detail services, webview, report boundary, release notes and roadmap docs
  have matching README/development/architecture/wiki updates. Commands, persisted settings, scheduler,
  providers, model routing and stored memory schemas are unchanged.

## C2.7 validation evidence (0.508.0)

- Test-first failures covered the missing derivation/profile contract and retaining high-severity
  findings at the candidate cap. Focused core, persisted profile, actual host collector and executed
  dashboard DOM regressions passed (420 tests); the final cap/dead-export checks passed (21 tests).
- Full `npm run ci:local` passed: production/web compile, lint, integration audit, 581 test files,
  provider recommendations, coverage (12,105 tests; 63.14% lines) and VSIX packaging. Using an existing
  export reduced the unused-export ratchet from 84 to 83.
- Separate test-source typing remains at 215 pre-existing errors, with no new game-debt/profile
  errors. Unknown or partial evidence preserves old findings; manual decisions survive count changes.
- VSIX 0.508.0 contains the final compiled collector/cap fix and no project-memory, test-results,
  `.git`, `.claude` or `.atlasmind` artifacts. Local installation was verified as
  `joelbondoux.atlasmind@0.508.0`. Installed UI/engine acceptance and hosted CI remain unperformed.
- Source additions, core debt/profile changes, SSOT fields, webview and confirmed read boundary have
  matching README, architecture, development, memory, workflow, safety and wiki updates. No command,
  VS Code setting, provider, model-routing, agent or scheduler contract changed. Version/changelog and
  three-entry README history align. No merge, push, release tag or publication was performed.
