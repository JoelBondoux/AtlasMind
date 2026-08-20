import type { SkillDefinition } from '../types.js';
import { isProtectedBranch } from './gitPush.js';
import { isSafeGitRefArgument } from './gitSync.js';

export const gitLogSkill: SkillDefinition = {
  id: 'git-log',
  name: 'Git Log',
  builtIn: true,
  description:
    'View recent commit history. Supports optional count, ref/range, and file-scoped log.',
  parameters: {
    type: 'object',
    properties: {
      maxCount: {
        type: 'integer',
        description: 'Maximum number of commits to return. Default: 20, max: 100.',
      },
      ref: {
        type: 'string',
        description: 'Branch, tag, or revision range (e.g. "main", "HEAD~5..HEAD").',
      },
      filePath: {
        type: 'string',
        description: 'Optional file path to show only commits that touched this file.',
      },
    },
  },
  async execute(params, context) {
    const rawCount = params['maxCount'];
    const maxCount = typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount > 0
      ? Math.min(rawCount, 100)
      : 20;
    const ref = typeof params['ref'] === 'string' ? params['ref'].trim() : undefined;
    const filePath = typeof params['filePath'] === 'string' ? params['filePath'].trim() : undefined;

    return context.getGitLog({ maxCount, ref, filePath });
  },
};

function formatCommandResult(result: { ok: boolean; exitCode: number; stdout: string; stderr: string }): string {
  return [
    `ok: ${result.ok}`,
    `exitCode: ${result.exitCode}`,
    result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
    result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
  ].join('\n');
}

export const gitBranchSkill: SkillDefinition = {
  id: 'git-branch',
  name: 'Git Branch',
  builtIn: true,
  description:
    'Manage git branches: list branches (optionally only those already merged into a ref, or including ' +
    'remote-tracking branches), create a new branch, switch to an existing branch, or delete a branch ' +
    'locally or on the remote. Deleting protected branches (main, master, production, release/*, hotfix/*) is refused. ' +
    'If a delete is blocked by a worktree, remove the worktree first with git-worktree.',
  routingHints: [
    'list branches', 'merged branches', 'create branch', 'switch branch', 'delete branch',
    'delete remote branch', 'clean up branches', 'stale branches',
  ],
  parameters: {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'create', 'switch', 'delete'],
        description: 'The branch operation to perform.',
      },
      name: {
        type: 'string',
        description: 'Branch name (required for create, switch, and delete).',
      },
      mergedInto: {
        type: 'string',
        description: 'For list: only show branches already merged into this ref (e.g. "develop") — the safe candidates for deletion.',
      },
      all: {
        type: 'boolean',
        description: 'For list: include remote-tracking branches (--all). Defaults to false.',
      },
      force: {
        type: 'boolean',
        description: 'For delete: delete even when not merged (-D). Defaults to false.',
      },
      remote: {
        type: 'boolean',
        description: 'For delete: delete the branch on the remote (git push <remote> --delete) instead of locally. Defaults to false.',
      },
      remoteName: {
        type: 'string',
        description: 'For delete with remote=true: the remote to delete from. Defaults to "origin".',
      },
    },
  },
  async execute(params, context) {
    const action = params['action'];
    const name = params['name'];

    if (typeof action !== 'string' || !['list', 'create', 'switch', 'delete'].includes(action)) {
      return 'Error: "action" must be one of: list, create, switch, delete.';
    }
    if (action !== 'list') {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return `Error: "name" is required for the "${action}" action.`;
      }
      // Reject obviously invalid or flag-shaped branch names
      if (!isSafeGitRefArgument(name.trim())) {
        return 'Error: Branch name contains invalid characters.';
      }
    }

    if (action === 'list') {
      const mergedInto = typeof params['mergedInto'] === 'string' && params['mergedInto'].trim()
        ? params['mergedInto'].trim()
        : undefined;
      const includeAll = params['all'] === true;
      if (mergedInto !== undefined || includeAll) {
        if (mergedInto !== undefined && !isSafeGitRefArgument(mergedInto)) {
          return 'Error: "mergedInto" contains invalid characters.';
        }
        const args = ['branch'];
        if (includeAll) {
          args.push('--all');
        }
        if (mergedInto !== undefined) {
          args.push('--merged', mergedInto);
        }
        const result = await context.runCommand('git', args);
        if (!result.ok) {
          return `Error: "git ${args.join(' ')}" failed.\n${formatCommandResult(result)}`;
        }
        return result.stdout.trim()
          || (mergedInto !== undefined ? `No branches are merged into ${mergedInto}.` : 'No branches found.');
      }
      return context.gitBranch('list', undefined);
    }

    if (action === 'delete') {
      const trimmed = (name as string).trim();
      if (isProtectedBranch(trimmed)) {
        return (
          `Error: "${trimmed}" is a protected branch (main, master, production, release/*, hotfix/*) and will not be deleted.`
        );
      }
      if (params['remote'] === true) {
        const remoteName = typeof params['remoteName'] === 'string' && params['remoteName'].trim()
          ? params['remoteName'].trim()
          : 'origin';
        if (!isSafeGitRefArgument(remoteName)) {
          return 'Error: Remote name contains invalid characters.';
        }
        const result = await context.runCommand('git', ['push', remoteName, '--delete', trimmed]);
        if (!result.ok) {
          return `Error: deleting "${trimmed}" on ${remoteName} failed.\n${formatCommandResult(result)}`;
        }
        return `Deleted branch ${trimmed} on ${remoteName}.`;
      }
      if (params['force'] === true) {
        const result = await context.runCommand('git', ['branch', '-D', trimmed]);
        if (!result.ok) {
          const combined = `${result.stdout}\n${result.stderr}`;
          const worktreeHint = /used by worktree|checked out at/i.test(combined)
            ? '\nThe branch is pinned by a worktree — remove it first with the git-worktree skill, then retry.'
            : '';
          return `Error: force-deleting "${trimmed}" failed.\n${formatCommandResult(result)}${worktreeHint}`;
        }
        return `Force-deleted branch ${trimmed}.`;
      }
    }

    return context.gitBranch(
      action as 'list' | 'create' | 'switch' | 'delete',
      typeof name === 'string' ? name.trim() : undefined,
    );
  },
};
