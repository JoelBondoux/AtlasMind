/**
 * What a confirmed tracker write already tells you, applied before the re-read.
 *
 * Closing an issue on the Issues page did the right thing and then appeared to
 * do nothing. The write itself is fast — `gh issue close` returns in under a
 * second — but the panel then re-read the *whole* repository before publishing
 * anything: repository slug, viewer login, a hundred issues, thirty pull
 * requests with their reviews and checks, two workflow-run listings, labels,
 * milestones, releases, and, when the latest run failed, a **log download with a
 * 45-second timeout**. Every one of those is serial, and the page was updated
 * only after the last of them. Measured on this repository, the pull-request
 * leg alone is four seconds and the whole chain is comfortably ten; with a
 * failing build in front of it, far longer. So the row you just closed sat
 * there looking untouched, which reads as a button that does not work.
 *
 * This module closes the gap at the near end. It is deliberately narrow.
 *
 * **Only what the write itself established.** `gh` exits non-zero when GitHub
 * refuses, so a successful close is a *fact about the tracker*, not a guess
 * about it — the same standard the rest of the codebase applies when it refuses
 * to infer things. Nothing here predicts a consequence GitHub would decide:
 * merging a pull request often closes issues through a `Closes #12` line, and
 * that is GitHub's inference, not ours, so it is left for the re-read.
 *
 * **Never invents a record.** A number that is not already in the list produces
 * the list unchanged. Creating an issue therefore echoes nothing at all — the
 * new number is not known here — and the re-read remains the only thing that
 * can report it. Appending a stub would put a row on screen that no read has
 * ever seen, which is the failure this module exists to avoid the *appearance*
 * of.
 *
 * **Only the fields the action names.** A close sets `state` and `updatedAt`,
 * because both genuinely changed a moment ago. It does not touch labels,
 * assignees or anything else it has no news about.
 *
 * **An echo is a floor, not a ceiling.** The authoritative re-read follows
 * immediately and replaces everything here. If the two ever disagree, the read
 * wins — which is why nothing in this module needs to be right about anything
 * except what just happened.
 *
 * Pure, `vscode`-free, unit-tested.
 */

import type { IssueRecord } from './issueTracker.js';
import type { PullRequestRecord } from './pullRequestTracker.js';

/** The issue actions whose outcome is knowable without asking GitHub again. */
export type ConfirmedIssueWrite =
  | { action: 'close'; number: number }
  | { action: 'reopen'; number: number }
  | { action: 'comment'; number: number };

/** The pull-request actions whose outcome is knowable the same way. */
export type ConfirmedPullRequestWrite =
  | { action: 'close'; number: number }
  | { action: 'merge'; number: number };

/**
 * Fold a confirmed issue write into the list the page is already showing.
 *
 * Returns the **same array reference** when nothing applies, so a caller can
 * cheaply tell whether a re-render is worth publishing.
 */
export function applyConfirmedIssueWrite(
  issues: readonly IssueRecord[],
  write: ConfirmedIssueWrite,
  at: Date = new Date(),
): readonly IssueRecord[] {
  const index = issues.findIndex(issue => issue.number === write.number);
  if (index === -1) {
    return issues;
  }
  const current = issues[index]!;
  const updatedAt = at.toISOString();
  const next: IssueRecord = write.action === 'close'
    ? { ...current, state: 'closed', updatedAt }
    : write.action === 'reopen'
      ? { ...current, state: 'open', updatedAt }
      // A comment is the one write that changes a count rather than a state.
      // Clamped the same way the parser clamps it, so an echo can never put a
      // number on screen the parser would have refused.
      : { ...current, comments: Math.min(current.comments + 1, 100_000), updatedAt };
  if (next.state === current.state && next.comments === current.comments) {
    return issues;
  }
  const copy = [...issues];
  copy[index] = next;
  return copy;
}

/**
 * Fold a confirmed pull-request write into the list the page is already showing.
 *
 * `merged` and `closed` stay distinct, as they do everywhere else in this
 * codebase: a merged pull request is a delivery and a closed one is a decision
 * not to deliver, and the delivery metrics read the difference. `mergedAt` is
 * set only by a merge, because an empty `mergedAt` is what the rest of the
 * dashboard uses to mean "this never merged".
 */
export function applyConfirmedPullRequestWrite(
  pulls: readonly PullRequestRecord[],
  write: ConfirmedPullRequestWrite,
  at: Date = new Date(),
): readonly PullRequestRecord[] {
  const index = pulls.findIndex(pull => pull.number === write.number);
  if (index === -1) {
    return pulls;
  }
  const current = pulls[index]!;
  const stamp = at.toISOString();
  const next: PullRequestRecord = write.action === 'merge'
    ? { ...current, state: 'merged', mergedAt: stamp, updatedAt: stamp, isDraft: false }
    : { ...current, state: 'closed', updatedAt: stamp };
  if (next.state === current.state) {
    return pulls;
  }
  const copy = [...pulls];
  copy[index] = next;
  return copy;
}
