# Plan — GitHub task routing and ceiling enforcement

Raised from a debug-session transcript (Heist, 2026-09-07) in which "pr to main / test and
merge" consumed three autonomous runs and about £0.28, attempted a local merge into a
protected branch, and reported a misattributed refusal.

## Objective

An autonomous run that is asked to do something its own declared workflow forbids should
refuse in the first second, citing the rule — not discover a tool-permission wall several
model attempts later and describe it wrongly.

## Context

What the transcript shows, in order:

1. A commit succeeded on `copilot/mai-code-1.1-flash` (£0.02).
2. A PR was raised correctly on `acp/claude`, which itself flagged that `delivery.json`
   declares `staging → main` with `main` protected.
3. Three "test and merge" runs followed. Two paused at `maxToolIterations` having made no
   successful tool call. The third completed with: *"a security policy preventing write
   operations … disables any `terminal-run` command that modifies files, including `git`"*,
   listing `git checkout main`, `git merge`, `git push`.

Every fact needed to refuse was already recorded before the first run: `main` is protected,
the Release and Pull-request stages sit at `observe`, and the pipeline declares a staging
stage the request bypassed.

Relevant existing code — none of this needs inventing:

- `core/plannedActionCeiling.ts` was written for exactly this case. Its own header describes
  an autonomous plan whose subtasks pushed to origin against stages declared `observe`, and
  says "the planner never consulted them".
- It is called from `chat/participant.ts:1247` only, where it contributes an approval reason.
- `orchestrator.ts` never reads `workflow.maxAutomationLevel`, `allowPullRequestWrites` or
  `allowReleaseWrites`.
- `core/planner.ts:44` already documents the correct action: `gh pr merge <number> --merge
  --admin`, planned as its own approval-gated step.
- `core/toolPolicy.ts:306` already separates `gh pr list` from `gh pr merge` by verb.
- A `github-operator` agent exists (`skills/terminalRun.ts:79`); the run used
  `general-assistant`.

## Approach

Three changes, in dependency order. The first is the one that makes the rest cheap: a run
that refuses early never reaches the model attempts, the failover chain, or the iteration
cap.

`plannedActionCeiling` stays a pure reporter — its stated design is that nothing in it blocks
and nothing in it approves. The decision to stop belongs to the caller.

## Steps

1. **Enforce the ceiling on every project run, not just the participant's.**
   `processProject` has four callers (participant, CLI, mission runner, run centre) and only
   one checks. Put the pre-flight inside `processProject` so the guarantee does not depend on
   which surface started the run. The orchestrator needs the *resolved* stage levels;
   `resolveWorkflowStageLevelsForRun` currently lives in `participant.ts` and depends on
   `vscode`. Extract the resolution rule so both can use it without a second copy of
   `min(master, ceiling, capability, stage)`.

2. **Route a git/`gh` goal to `github-operator`.** `TASK_SCOPED_GIT_PATTERN` already
   recognises the shape. `general-assistant` improvised local git against a protected branch
   while the correct command was documented in the planner prompt it never saw.

3. **A refusal names the gate that fired and the sanctioned route.** "A security policy
   disables any terminal-run command that modifies files" is wrong twice: it is not why the
   merge was disallowed, and it implies nothing could have worked.

Deferred, and worth re-measuring after 1–3 rather than fixing blind:

4. `MODEL_FAILURE_TTL_MS` is 5 minutes, so `gpt-6-astra` — which 400s permanently on this
   machine, because the installed Codex CLI is too old — was re-selected on each retry.
   Permanent failures should bench until the agent is re-probed.
5. `sanitizeAssistantResponse` already strips and attributes the agent's own diagnostics
   ("Exceeded skills context budget", "Model metadata not found"); the synthesis path
   bypasses it, so Codex's warnings read as AtlasMind's.
6. 185,138 input tokens for one `gh pr` subtask, and two paused runs that offered an
   identical "raise the limit" prompt having achieved nothing.
7. The final message truncated mid-sentence ("Without the ability to run these …").

## Verification

- A project run whose plan names a merge or push against a stage declared `observe` stops
  before any model attempt, and says which stage and which level refused it.
- The same run started from the CLI, the mission runner and the run centre refuses
  identically — the property is the orchestrator's, not the surface's.
- A goal matching the git/`gh` shape selects `github-operator`.
- An undeclared workflow still says nothing: no config means no rule to be outside of.

## Completion criteria

Asking an unattended run to merge into a protected branch produces one refusal naming the
declared stage, costs one model attempt or none, and suggests the route that would work.
