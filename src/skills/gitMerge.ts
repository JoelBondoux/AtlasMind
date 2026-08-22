import type { SkillDefinition } from '../types.js';
import { isSafeGitRefArgument } from './gitSync.js';

/**
 * Local merge — the write half of every "merge X into Y then publish" flow.
 *
 * Task-scoped selection has always recognised integration wording
 * (`TASK_SCOPED_GIT_INTEGRATION_PATTERN`) and handed the turn `git-branch`,
 * `git-commit` and `git-push` — but the merge itself had no skill, so the one
 * step the flow is named after ran as an improvised terminal command or not at
 * all. A conflict is reported with the exact conflicted files and the two ways
 * out (resolve, or action "abort"), because a model told only "exit code 1"
 * reliably invents a third.
 */

function formatCommandResult(result: { ok: boolean; exitCode: number; stdout: string; stderr: string }): string {
  return [
    `ok: ${result.ok}`,
    `exitCode: ${result.exitCode}`,
    result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
    result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
  ].join('\n');
}

export const gitMergeSkill: SkillDefinition = {
  id: 'git-merge',
  name: 'Git Merge',
  builtIn: true,
  description:
    'Merge a named branch into the currently checked-out branch, or abort an in-progress merge. ' +
    'On conflict, reports the conflicted files and how to proceed. Never force-merges and never ' +
    'switches branches — check out the target branch first with git-branch.',
  routingHints: [
    'merge branch', 'merge into current branch', 'merge develop', 'abort merge',
    'integrate branch', 'no-ff merge',
  ],
  parameters: {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['merge', 'abort'],
        description: 'merge: merge a branch into the current branch. abort: abandon an in-progress conflicted merge.',
      },
      branch: {
        type: 'string',
        description: 'The branch to merge in (required for merge).',
      },
      noFf: {
        type: 'boolean',
        description: 'Always create a merge commit (--no-ff), preserving the branch point. Defaults to false.',
      },
      message: {
        type: 'string',
        description: 'Optional merge-commit message.',
      },
    },
  },
  async execute(params, context) {
    const action = params['action'];
    if (typeof action !== 'string' || !['merge', 'abort'].includes(action)) {
      return 'Error: "action" must be one of: merge, abort.';
    }

    if (action === 'abort') {
      const result = await context.runCommand('git', ['merge', '--abort']);
      if (!result.ok) {
        return `Error: "git merge --abort" failed (is a merge actually in progress?).\n${formatCommandResult(result)}`;
      }
      return 'Merge aborted; the working tree is back to its pre-merge state.';
    }

    const rawBranch = params['branch'];
    const branch = typeof rawBranch === 'string' ? rawBranch.trim() : '';
    if (branch.length === 0) {
      return 'Error: "branch" is required for the "merge" action.';
    }
    if (!isSafeGitRefArgument(branch)) {
      return 'Error: Branch name contains invalid characters.';
    }

    const args = ['merge'];
    if (params['noFf'] === true) {
      args.push('--no-ff');
    }
    const message = typeof params['message'] === 'string' ? params['message'].trim() : '';
    if (message.length > 0) {
      args.push('-m', message.slice(0, 500));
    }
    args.push(branch);

    const result = await context.runCommand('git', args);
    if (result.ok) {
      const output = `${result.stdout}\n${result.stderr}`.trim();
      return output.length > 0 ? output : `Merged ${branch} into the current branch.`;
    }

    const conflicts = await context.runCommand('git', ['diff', '--name-only', '--diff-filter=U']);
    const conflictedFiles = conflicts.ok ? conflicts.stdout.trim() : '';
    if (conflictedFiles.length > 0) {
      return (
        `Merge of ${branch} stopped on conflicts in:\n${conflictedFiles}\n\n` +
        'Resolve the conflicted files and commit with git-commit, or call this skill with action "abort" to abandon the merge.'
      );
    }
    return `Error: "git ${args.join(' ')}" failed.\n${formatCommandResult(result)}`;
  },
};
