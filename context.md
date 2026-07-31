## Goal
Review and strengthen task-routing behavior verification: confirm what the original BDD suite proved, close the uncovered gaps, and make the routing behavior assertions explicit and maintainable.

## Approach
Move routing checks into the project's primary test framework (Vitest) with deterministic, text-matched assertions, then run the full suite to confirm the change set is stable. Keep the existing intent (routing behavior coverage) but make fallback and ambiguous cases unambiguous.

## Findings
- Original BDD intent was to verify specialist routing for clear prompts and ensure generic prompts were not sent to oversight-like agents, but coverage used only negative checks (`should not`), which left fallback behavior implicit.
- `src/runtime/core.ts` confirms the default fallback agent id is `default` (`BUILTIN_AGENT_DEFAULTS` first entry).
- The stronger routing expectation is now encoded in Vitest (`test/core/routing.test.ts`), including explicit assertions for fallback-to-`default` and ambiguous prompt behavior.
- A related failure path was `tests/example.property.test.ts` requiring `fast-check`; dependency state was repaired after adding it as `devDependency` in `package.json`.
- BDD artifacts were fully removed (`test/bdd/` feature/step files/directories) after migration, reducing brittle test tooling risk.

## Concluded
- Confirmed the prior BDD suite did not make fallback routing explicit and did not cover ambiguous prompts.
- Replaced fragile BDD coverage with `test/core/routing.test.ts`, increasing assertion strength and adding ambiguity routing coverage.
- Verified generic prompts assert to `default` and a security-review ambiguity scenario asserts to `security-reviewer`.
- Repaired and normalized dependency state for `fast-check` so property-based tests stop failing.
- Removed legacy BDD files/directories and validated a green full Vitest run.

## Open Threads
- No unresolved questions or blocked tasks currently; next step is routine monitoring of routing behavior when prompts or agent definitions change.
- ~~Added explicit fallback assertion to `default` in migrated Vitest routing tests.~~
- ~~Removed obsolete BDD files after migration and confirmed suite passes.~~

## SSOT Links
package.json
src/runtime/core.ts
test/core/routing.test.ts
tests/example.property.test.ts
vitest.config.ts
context.md

## Current State
I updated the context to reflect completion of the routing-test remediation: BDD tests were replaced with stronger Vitest coverage, dependency issues were fixed, and BDD artifacts were removed. The project now has a passing routing regression test suite with explicit fallback and ambiguity assertions.
