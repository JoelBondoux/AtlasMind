# Product facts

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

v0.516.4 was published on 2026-11-03 through the tag-triggered Marketplace workflow
([run 41550779260](https://github.com/JoelBondoux/AtlasMind/actions/runs/41550779260)).
Release PR #274 merged as `b6fb7ac5bae7fa9c926be038a5bc0a5001121be6`; the annotated release tag
points to that exact main commit. The published-baseline source follow-up is version 0.516.5.
