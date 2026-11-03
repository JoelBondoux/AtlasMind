# Product facts

## Dependency review

The follow-up v0.516.7 records exact exceptions for 22 historical secret-scan false positives,
reviewed against their original source and public form provenance. No additional file or
credential pattern is excluded; new credentials remain detectable. Evidence: `.gitleaksignore`.
It also accepts the new PR #276 for ESLint 10.14.0; runtime dependency locks are unchanged.

Source v0.516.6 consolidates dependency PRs #246, #252, #254, #259, #267, #270, #271 and #275.
ACP SDK 2.2.0 keeps stable ACP v1 and the existing app API. The real SDK JSON-transport test
covers streamed replies, denied write permission and cancellation. The 2026-11-03 production
npm audit reports zero findings; the complete audit still reports 13 moderate development
dependency findings. This source integration is separate from Marketplace publication.
Evidence: `package-lock.json`, `tests/acp/atlasMindAcpAgent.test.ts`, and `docs/development.md`.

## Chat execution and routing

- Roadmap cleanup and document reconciliation requests select reading and editing tools within
  the chosen agent's eligible skills. Selection does not bypass turn restrictions or approvals.
- After three qualifying rounds of inspection, an editing turn is prompted to apply and verify
  the requested change; a diagnosis-only turn is prompted to summarize its findings.
- If a tool-backed editing request settles without a successful file mutation, AtlasMind retries
  within the loop and may escalate before side effects. If still unfinished, execution artifacts
  carry `stoppedWithoutChanges`, chat reports the edit incomplete, and project tasks fail. An
  inspected document needing no changes may finish as a no-op. Dry runs and delegated ACP
  execution have separate evidence rules.
- Transcription IDs carrying `transcribe` or `transcription` segments, and the exact dedicated
  `copilot-dictation-cleanup-nano` model, cannot route as chat/coding models even if cached metadata
  grants them chat capabilities. Conversational Voxtral models remain eligible.
- An agent's model pins narrow routing candidates; they cannot bypass routing rejection.

Evidence: `src/core/orchestrator.ts`, `src/core/modelRouter.ts`, `src/providers/modelRole.ts`,
`src/chat/participant.ts`, and the regression suites for those modules. Behavior introduced in 0.516.4.

## Published release

v0.516.7 was published on 2026-11-03 through the tag-triggered Marketplace workflow
([run 41580392168](https://github.com/JoelBondoux/AtlasMind/actions/runs/41580392168)).
Release PR #277 merged as `a143f3cea4368971a2a443ca3a6efabae9a714d2`; the annotated release tag
points to that exact main commit. The public Marketplace VSIX was downloaded and verified as
version 0.516.7, including ACP SDK 2.2.0 and MCP SDK 1.32.2, without project memory, tests or
test-results. The published-baseline source follow-up is version 0.516.8.
