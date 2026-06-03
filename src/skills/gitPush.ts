import type { SkillDefinition } from '../types.js';

/** Branches that are always protected from force-pushes. */
const PROTECTED_BRANCHES = new Set(['main', 'master', 'production', 'prod', 'release', 'stable']);

function isProtectedBranch(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return PROTECTED_BRANCHES.has(lower) || lower.startsWith('release/') || lower.startsWith('hotfix/');
}

export const gitPushSkill: SkillDefinition = {
  id: 'git-push',
  name: 'Git Push',
  builtIn: true,
  description:
    'Push the current branch (or a named branch) to a remote. ' +
    'Rejects force-pushes to protected branches (main, master, production, release/*, hotfix/*) without explicit confirmation. ' +
    'Defaults to "origin" when no remote is specified.',
  routingHints: [
    'push branch', 'push to remote', 'push to origin', 'push changes', 'push commits',
    'upload branch', 'publish branch',
  ],
  parameters: {
    type: 'object',
    properties: {
      remote: {
        type: 'string',
        description: 'Remote name. Defaults to "origin".',
      },
      branch: {
        type: 'string',
        description: 'Branch to push. Omit to push the current checked-out branch.',
      },
      setUpstream: {
        type: 'boolean',
        description: 'Pass -u / --set-upstream so the local branch tracks the remote. Defaults to false.',
      },
      force: {
        type: 'boolean',
        description:
          'Allow non-fast-forward push (--force-with-lease). ' +
          'Blocked on protected branches (main, master, production, release/*, hotfix/*). ' +
          'Defaults to false.',
      },
      tags: {
        type: 'boolean',
        description: 'Also push all local tags (--tags). Defaults to false.',
      },
    },
  },
  async execute(params, context) {
    const remote = typeof params['remote'] === 'string' && params['remote'].trim()
      ? params['remote'].trim()
      : 'origin';

    const rawBranch = params['branch'];
    const branch = typeof rawBranch === 'string' ? rawBranch.trim() : undefined;
    const force = params['force'] === true;
    const setUpstream = params['setUpstream'] === true;
    const tags = params['tags'] === true;

    // Validate branch name characters when provided
    if (branch !== undefined && /[~^:\s\\]|\.\./.test(branch)) {
      return 'Error: Branch name contains invalid characters.';
    }

    // Reject force-push to protected branches
    if (force && branch && isProtectedBranch(branch)) {
      return (
        `Error: Force-push to "${branch}" is blocked. ` +
        'Protected branches (main, master, production, release/*, hotfix/*) must not be force-pushed. ' +
        'Use a PR to merge changes instead.'
      );
    }

    // Resolve the effective branch name for the protection check when no branch arg is given
    if (force && !branch) {
      const statusResult = await context.getGitStatus();
      const headMatch = /^(?:On branch|## )([^\n.]+)/.exec(statusResult);
      const currentBranch = headMatch ? headMatch[1]!.trim() : '';
      if (currentBranch && isProtectedBranch(currentBranch)) {
        return (
          `Error: Force-push to current branch "${currentBranch}" is blocked. ` +
          'Protected branches must not be force-pushed. Use a PR to merge changes instead.'
        );
      }
    }

    const args: string[] = [remote];
    if (branch) {
      args.push(branch);
    }
    if (setUpstream) {
      args.push('--set-upstream');
    }
    // Prefer --force-with-lease over --force: aborts if the remote has moved since last fetch.
    if (force) {
      args.push('--force-with-lease');
    }
    if (tags) {
      args.push('--tags');
    }

    const result = await context.runCommand('git', ['push', ...args]);
    return [
      `ok: ${result.ok}`,
      `exitCode: ${result.exitCode}`,
      result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
      result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
    ].join('\n');
  },
};
