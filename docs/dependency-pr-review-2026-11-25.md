# Dependency PR review — 2026-11-25

Three open Dependabot PRs were reviewed against develop `a67930d868beda5311291cf3376cedd666644ecb`
(0.524.0). All three contain useful updates. Their changes are consolidated in source v0.524.1 with one
version/changelog update, as the repository's every-commit versioning rule requires; the source PRs are
closed as superseded by that integration, which does not mean their bot commits were merged individually.

| PR | Reviewed head | Change and verdict |
| --- | --- | --- |
| [296](https://github.com/JoelBondoux/AtlasMind/pull/296) | `395af3a52f013d670754ebece316d8b7fe454e09` | Accept `@agentclientprotocol/sdk` `^2.9.1`. The lockfile resolves to 2.12.0, the newest in range. The default entry still speaks stable protocol v1 and AtlasMind uses only the app API and stable fields; the ACP agent suite's real JSON-transport test (replies, denied writes, cancellation) passes unchanged. |
| [291](https://github.com/JoelBondoux/AtlasMind/pull/291) | `7e01905de11ffa89a73ad4ec241a30f7a5acb813` | Accept the developer-tooling group: typescript-eslint plugin 8.74.0 (parser peer unchanged), ESLint 10.15.0, `@vitest/coverage-v8` 5.1.2 with Vitest raised to the same 5.1.2 so the peer range is met rather than warned about, vsce 4.1.1, fast-check 4.11.0 and jsdom 31.0.1. jsdom's major is exercised by the HTML source-map property tests. |
| [286](https://github.com/JoelBondoux/AtlasMind/pull/286) | `2805a996685b5888e9a3b577aadffd6d8be3592f` | Accept ws 8.23.0; `@types/ws` 8.18.2 already matches. The Buzz client's real in-process WebSocket integration test passes. |

The three branches predate each other's manifest lines, so merging each lockfile as-is would drop a
neighbour's update. Consolidation applies the reviewed manifest deltas to the current baseline and
regenerates the lockfile with `npm install`; `npm ci` validates the result in CI.

Raising Vitest moved the declared line from `^5.0` to `^5.1`, which the output-schema-drift guard
treats as the moment the JUnit report format could have changed: `tests/fixtures/vitest-junit-report.xml`
was re-captured from a real Vitest 5.1.2 run (two suites, four cases, one failure, one skip) and the
guard's pin moved to `^5.1`.

Validation on the integration commit: `npm run compile`, `npm run lint`, the full Vitest suite, and
`npm audit --omit=dev --audit-level=high` (zero findings). Marketplace publication is a separate
release operation through the release gate.
