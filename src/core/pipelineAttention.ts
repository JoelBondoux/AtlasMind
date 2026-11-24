/**
 * What on the Pipeline page needs a person right now, as one ranked list with
 * one lead — the card at the top of the page, absent when nothing needs you.
 *
 * Every fact here is already derived elsewhere: which pull request is blocked
 * on a required check nobody posted (`requiredCheckGap`), whether this folder
 * can run a reviewed PR (`reviewedPrLocalCiState`), why the last runner
 * container died (`localCiFailureHints`), and what the last CI failure was
 * classified as (`ciFailureAnalysis`). This module only decides their order,
 * and the order is the point: a page that shows all of them with equal weight
 * is a page somebody has to read, and the one thing that blocks a merge should
 * not compete with a flaky test from last week.
 *
 * Five rules.
 *
 * - **Ranked by consequence, from a declared table.** `PIPELINE_ATTENTION_RULES`
 *   is evaluated in order and its order is the policy; every item names the
 *   rule that produced it.
 * - **One lead, one button.** The first item is the card; the rest are counted.
 *   Two cards at the top of a page are two cards nobody reads.
 * - **Empty when nothing needs you.** No "all clear" item is ever manufactured,
 *   because a card that is always present is a card that is always skipped.
 * - **A blocked PR outranks a broken machine, which outranks an old failure.**
 *   The merge is what somebody came for; the runner is how they get there; the
 *   classified failure already leads Activity.
 * - **Nothing here runs, fetches or decides what is true.** Inputs are the
 *   derived states; the output is a value a test walks.
 */

import type { RequiredCheckGap } from './requiredCheckGap.js';
import type { ReviewedPrLocalCiState, ReviewedPrNextAction } from './reviewedPrLocalCiState.js';
import type { LocalCiFailureHint } from './localCiFailureHints.js';

export type PipelineAttentionAction =
  | ReviewedPrNextAction
  | 'runner-output'
  | 'open-activity'
  | 'open-pull-requests'
  | 'none';

export interface PipelineAttentionItem {
  rule: string;
  title: string;
  detail: string;
  action: PipelineAttentionAction;
  actionLabel: string;
  /** Pull requests the item is about, when it is about any. */
  pullRequests?: number[];
}

export interface PipelineAttention {
  /** The card. Absent when nothing needs a person. */
  lead?: PipelineAttentionItem;
  /** Every item, lead first. */
  items: PipelineAttentionItem[];
}

export interface PipelineAttentionInput {
  requiredCheckGaps?: readonly RequiredCheckGap[];
  reviewedPr: Pick<ReviewedPrLocalCiState, 'contract' | 'runnable' | 'nextAction' | 'blockers' | 'trustedBaseBranch' | 'folderName'>;
  runner?: { lifecycle: string; failureHint?: LocalCiFailureHint };
  ciFailure?: { classification: string; jobName: string; stepName: string };
}

/** The ranking, published. Evaluated in order; each rule may yield one item. */
export const PIPELINE_ATTENTION_RULES: ReadonlyArray<{ rule: string; when: string }> = [
  { rule: 'required-check-ready', when: 'An open PR is blocked on the AtlasMind check and this folder is ready to run it.' },
  { rule: 'required-check-not-ready', when: 'An open PR is blocked on the AtlasMind check and this folder cannot run it yet.' },
  { rule: 'required-check-other', when: 'An open PR is blocked on a required check nothing here posts.' },
  { rule: 'runner-failed', when: 'The last runner container died with a cause AtlasMind recognised.' },
  { rule: 'ci-failure', when: 'The most recent hosted CI failure has been classified.' },
];

const ACTION_LABELS: Record<ReviewedPrNextAction, string> = {
  patch: 'Patch this repository…',
  'open-contract': 'Open the contract to fix it',
  'commit-managed-files': 'Commit the local-CI files',
  'checkout-trusted-branch': 'Check out the trusted branch…',
  repatch: 'Re-patch to refresh the managed files…',
  review: 'Run reviewed PR…',
};

function listPrs(numbers: readonly number[]): string {
  const shown = numbers.slice(0, 3).map(number => `#${number}`).join(', ');
  return numbers.length > 3 ? `${shown} +${numbers.length - 3}` : shown;
}

/** Decide what needs a person, in order. Pure; never throws. */
export function derivePipelineAttention(input: PipelineAttentionInput): PipelineAttention {
  const items: PipelineAttentionItem[] = [];
  const gaps = input.requiredCheckGaps ?? [];
  const localCiBlocked = gaps.filter(gap => gap.state === 'blocked-missing' && gap.localCiMissing).map(gap => gap.number);
  const otherBlocked = gaps.filter(gap => gap.state === 'blocked-missing' && !gap.localCiMissing);
  const ready = input.reviewedPr.contract === 'enabled' && input.reviewedPr.runnable;

  if (localCiBlocked.length > 0 && ready) {
    items.push({
      rule: 'required-check-ready',
      title: `${localCiBlocked.length === 1 ? 'Pull request' : 'Pull requests'} ${listPrs(localCiBlocked)} cannot merge until this computer runs ${localCiBlocked.length === 1 ? 'it' : 'them'}`,
      detail: `The base branch requires the AtlasMind/local-ci check, and only a reviewed-PR run from this computer posts it. This folder is ready: contract enabled, on ${input.reviewedPr.trustedBaseBranch ?? 'the trusted branch'}, files committed.`,
      action: 'review',
      actionLabel: ACTION_LABELS.review,
      pullRequests: localCiBlocked,
    });
  } else if (localCiBlocked.length > 0) {
    const action = input.reviewedPr.nextAction;
    items.push({
      rule: 'required-check-not-ready',
      title: `${localCiBlocked.length === 1 ? 'Pull request' : 'Pull requests'} ${listPrs(localCiBlocked)} ${localCiBlocked.length === 1 ? 'needs' : 'need'} the AtlasMind check, and ${input.reviewedPr.folderName || 'this folder'} cannot run it yet`,
      detail: input.reviewedPr.blockers[0] ?? 'This folder is not ready to run a reviewed pull request.',
      action,
      actionLabel: ACTION_LABELS[action],
      pullRequests: localCiBlocked,
    });
  }
  if (otherBlocked.length > 0) {
    const names = [...new Set(otherBlocked.flatMap(gap => gap.missing))].slice(0, 2).join(', ');
    items.push({
      rule: 'required-check-other',
      title: `${otherBlocked.length === 1 ? 'Pull request' : 'Pull requests'} ${listPrs(otherBlocked.map(gap => gap.number))} ${otherBlocked.length === 1 ? 'is' : 'are'} blocked on a required check nothing has posted`,
      detail: `Required: ${names}. Nothing on this computer produces ${otherBlocked.length === 1 && otherBlocked[0]!.missing.length === 1 ? 'it' : 'them'}; check the workflow that should.`,
      action: 'open-pull-requests',
      actionLabel: 'Open Pull Requests',
      pullRequests: otherBlocked.map(gap => gap.number),
    });
  }
  if (input.runner?.lifecycle === 'failed' && input.runner.failureHint && input.runner.failureHint.kind !== 'unknown') {
    items.push({
      rule: 'runner-failed',
      title: input.runner.failureHint.title,
      detail: input.runner.failureHint.body,
      action: 'runner-output',
      actionLabel: 'Open runner output',
    });
  }
  if (input.ciFailure && input.ciFailure.classification && input.ciFailure.classification !== 'none') {
    items.push({
      rule: 'ci-failure',
      title: `The last CI failure was ${input.ciFailure.classification}`,
      detail: `${input.ciFailure.jobName || 'A job'} failed at ${input.ciFailure.stepName || 'a step'}. Activity has the evidence and the hand-off to Atlas.`,
      action: 'open-activity',
      actionLabel: 'Open Activity',
    });
  }
  return items.length > 0 ? { lead: items[0]!, items } : { items };
}
