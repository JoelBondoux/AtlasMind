## Goal
Resume the interrupted release workflow for `fix/lens-acp-hidden-launch`. Preserve the verified commit/push baseline, keep the session-only context edit out of the release path, and complete promotion/publication once the branch target and release policy are reconciled.

## Approach
Treat `810ae2ba` on `origin/fix/lens-acp-hidden-launch` as the known-good baseline. Continue with the repo’s release workflow unless the user overrides it: separate the context-file edit from branch work, then promote through the documented branch path before marketplace publication.

## Findings
- Commit `810ae2ba` (`chore: commit staged changes`) was created from the staged files and pushed to `origin/fix/lens-acp-hidden-launch`.
- The working tree was clean at that handoff; no source edits were left behind from the prior turn.
- The current release continuation hit a sandbox boundary while trying to stash the session-only `context.md` change; `.git/index.lock` blocked the stash step.
- Repo policy in `AGENTS.md` says the normal release route is `develop` first, then promotion to `main`, so the user’s literal “main” wording still needs reconciliation with the documented workflow.
- No branch promotion, tag, build, package, or marketplace publish step has started in this resumed thread.

## Concluded
- Preserved the verified commit/push state for `810ae2ba`.
- Kept the interruption boundary explicit so the release can resume from a known-good point.
- Isolated the session context update from product code changes.

## Open Threads
- ~~Re-establish the interrupted release context.~~
- Resolve the `.git/index.lock` / stash issue so the session-only `context.md` change stays out of the release path.
- Decide whether to follow the repo release path (`develop` → `main`) or honor the user’s literal “promote to main” wording.
- Confirm whether marketplace publication should happen only after branch promotion under the repo workflow.

## SSOT Links
AGENTS.md
docs/guided-github-workflow.md
docs/github-workflow.md
package.json
CHANGELOG.md
context.md

## Current State
The most recent turn refreshed the rolling context for the interrupted release handoff. Branch promotion is still paused; no tag, build, or publish action has run in this turn.
