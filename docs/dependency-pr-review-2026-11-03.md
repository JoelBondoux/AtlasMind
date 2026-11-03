# Dependency PR review — 2026-11-03

Eight open Dependabot PRs were reviewed against develop `96fda31b7351eb6e26b2048dc2be97be8ae60e6e`.
All eight contain useful updates. Their changes are consolidated in source v0.516.6 with one
version/changelog update. The source PRs can then be closed as superseded by that integration;
closing them does not mean their bot commits were merged individually.

Dependabot closed seven original PRs once it detected their updates on develop, then opened
[276](https://github.com/JoelBondoux/AtlasMind/pull/276) at
`173e8231014e6b2f1b0f5a0982f0d65feff40092`. This additional review accepts ESLint 10.14.0:
same major and compatible parser peers, with rule crash/autofix fixes and stricter dependency
constraints. Its lockfile changes only the ESLint package; existing shared versions satisfy the
new constraints. This update is included in v0.516.7 and receives the same final validation.

| PR | Reviewed head | Change and verdict |
| --- | --- | --- |
| [246](https://github.com/JoelBondoux/AtlasMind/pull/246) | `b8e21717ccad5daf0cf1a3c1cefbc2d6793f82d7` | Accept pg 8.23.1 and its connection/protocol patch updates. |
| [252](https://github.com/JoelBondoux/AtlasMind/pull/252) | `d57f3536886a1209c587a313597adba7358c07a3` | Accept setup-node 7.1.0 and upload-artifact 7.0.2. Commit pins match upstream release tags; permissions, secrets, inputs and trust boundaries are unchanged. |
| [254](https://github.com/JoelBondoux/AtlasMind/pull/254) | `84962c28aec1f632b596981d3f09d92cff62e5e8` | Accept ws 8.22.0 with matching @types/ws 8.18.2. |
| [259](https://github.com/JoelBondoux/AtlasMind/pull/259) | `88bca8ee896731520085fc35ff6b144178aa3070` | Accept mysql2 3.24.6, including IPv6 URI and LOCAL INFILE fixes. |
| [267](https://github.com/JoelBondoux/AtlasMind/pull/267) | `401c619e382bc80b1d8f45cf8bd59a34134aebc2` | Accept MCP SDK 1.32.2 transport/capability fixes. |
| [270](https://github.com/JoelBondoux/AtlasMind/pull/270) | `080ab7aa38df512defb7b8eaac9a5eddcf0e5bf4` | Accept typescript-eslint 8.72.1, vsce 4.1.0 and Node types 26.6.6. Keep the declared TypeScript and VS Code compatibility floors. |
| [271](https://github.com/JoelBondoux/AtlasMind/pull/271) | `99d9ed4434c7a6aa457f204e0709ad6af582694d` | Accept ACP SDK 2.2.0 after migration-guide review. AtlasMind already uses the replacement app API and only stable ACP v1 fields. Add a real JSON-transport test for replies, denied writes and cancellation. |
| [275](https://github.com/JoelBondoux/AtlasMind/pull/275) | `2ae6f4a59df7ecdf84876a7063b85f7d0aef7a50` | Accept security overrides and transitive fixes through develop. Its main target does not justify bypassing the release workflow. |

The older PR branches predate changes to adjacent manifest lines, so merging each lockfile as-is
would risk dropping previously accepted updates. Consolidation applies each reviewed manifest
delta and lockfile package delta to the current integration baseline; `npm ci` validates the result.

The ACP major-version risk is API removal and stable/unstable schema filtering. The SDK default
entry still speaks protocol v1, and the application uses no removed connection classes or unstable
capabilities. Compilation plus the real SDK regression check both the TypeScript surface and the wire.
These tests use a controlled runtime; they do not prove live provider authentication or model completion.

Dependabot also reported missing `security` and `area:ci` labels on update PRs. Both update
configurations now request only the existing `dependencies` label.

The 2026-11-03 npm audit snapshot reports **zero production findings**, down from five affected
production packages. The full audit retains 13 moderate development-package findings rooted in
minimatch; npm reports no automatic fix. This review does not claim those findings are resolved.
Default-branch security alerts can remain open until a later intentional release promotion.

The first manually dispatched integration CI scanned all history and found 22 pre-existing
false positives. Source v0.516.7 records exact historical exceptions after checking every source
window: 20 synthetic test-value findings, one public NIP-OA signature and one public form identifier
verified through [Mistral's contact page](https://mistral.ai/contact/). No file or credential pattern
was newly excluded. This follow-up clears the historical scan without narrowing its scan range.

Validation uses `npm run ci:local` (compile, lint, integration coverage audit, full tests,
provider checks, coverage and VSIX packaging), the normal commit hook, and a manually dispatched
hosted CI matrix for the integration commit. Local and hosted results are linked in the closing
comments on the original PRs. Marketplace publication is a separate release operation.
