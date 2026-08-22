import type { SkillDefinition } from '../types.js';

/**
 * Remote synchronisation — fetch and pull as first-class skills.
 *
 * Branch cleanup, "am I behind?", and every merge-then-publish flow starts by
 * talking to the remote, and until now that meant models improvising
 * `terminal-run` git invocations or hallucinating a `git_fetch` tool for the
 * auto-synthesis path to reverse-engineer. Both skills refuse arguments that
 * could be parsed as flags (a remote named `--mirror` is an instruction, not a
 * name), and pull defaults to `--ff-only` so a routine sync can never invent a
 * merge commit nobody asked for.
 */

/** A remote/ref name a model may pass: no whitespace, no traversal, and never flag-shaped. */
export function isSafeGitRefArgument(value: string): boolean {
  if (value.length === 0 || value.length > 200) {
    return false;
  }
  if (value.startsWith('-')) {
    return false;
  }
  return !/[~^:\s\\]|\.\./.test(value);
}

function formatCommandResult(result: { ok: boolean; exitCode: number; stdout: string; stderr: string }): string {
  return [
    `ok: ${result.ok}`,
    `exitCode: ${result.exitCode}`,
    result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
    result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
  ].join('\n');
}

export const gitFetchSkill: SkillDefinition = {
  id: 'git-fetch',
  name: 'Git Fetch',
  builtIn: true,
  description:
    'Download new commits, branches, and tags from a remote without touching the working tree. ' +
    'Supports --prune to drop remote-tracking refs whose branch was deleted on the remote — ' +
    'the first step of any branch cleanup. Defaults to "origin".',
  routingHints: [
    'fetch from remote', 'fetch origin', 'update remote refs', 'prune remote branches',
    'sync with remote', 'refresh remote-tracking branches',
  ],
  parameters: {
    type: 'object',
    properties: {
      remote: {
        type: 'string',
        description: 'Remote name. Defaults to "origin". Ignored when all is true.',
      },
      prune: {
        type: 'boolean',
        description: 'Remove remote-tracking refs that no longer exist on the remote (--prune). Defaults to false.',
      },
      all: {
        type: 'boolean',
        description: 'Fetch every configured remote (--all). Defaults to false.',
      },
      tags: {
        type: 'boolean',
        description: 'Also fetch all tags (--tags). Defaults to false.',
      },
    },
  },
  async execute(params, context) {
    const remote = typeof params['remote'] === 'string' && params['remote'].trim()
      ? params['remote'].trim()
      : 'origin';
    if (!isSafeGitRefArgument(remote)) {
      return 'Error: Remote name contains invalid characters.';
    }

    const args = ['fetch'];
    if (params['prune'] === true) {
      args.push('--prune');
    }
    if (params['tags'] === true) {
      args.push('--tags');
    }
    if (params['all'] === true) {
      args.push('--all');
    } else {
      args.push(remote);
    }

    const result = await context.runCommand('git', args);
    if (!result.ok) {
      return `Error: "git ${args.join(' ')}" failed.\n${formatCommandResult(result)}`;
    }
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return output.length > 0 ? output : `Fetched ${params['all'] === true ? 'all remotes' : remote}: already up to date.`;
  },
};

export const gitPullSkill: SkillDefinition = {
  id: 'git-pull',
  name: 'Git Pull',
  builtIn: true,
  description:
    'Fetch and integrate remote changes into the current branch. Defaults to fast-forward-only, ' +
    'which fails cleanly instead of creating a surprise merge commit; pass mode "rebase" or "merge" ' +
    'to integrate diverged history deliberately.',
  routingHints: [
    'pull latest changes', 'pull from origin', 'update branch from remote', 'pull and rebase',
    'get latest from remote',
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
        description: 'Remote branch to pull. Omit to use the current branch\'s upstream.',
      },
      mode: {
        type: 'string',
        enum: ['ff-only', 'merge', 'rebase'],
        description: 'How to integrate diverged history. Defaults to "ff-only" (fails rather than merging).',
      },
    },
  },
  async execute(params, context) {
    const remote = typeof params['remote'] === 'string' && params['remote'].trim()
      ? params['remote'].trim()
      : 'origin';
    if (!isSafeGitRefArgument(remote)) {
      return 'Error: Remote name contains invalid characters.';
    }
    const rawBranch = params['branch'];
    const branch = typeof rawBranch === 'string' && rawBranch.trim() ? rawBranch.trim() : undefined;
    if (branch !== undefined && !isSafeGitRefArgument(branch)) {
      return 'Error: Branch name contains invalid characters.';
    }
    const mode = params['mode'];
    if (mode !== undefined && (typeof mode !== 'string' || !['ff-only', 'merge', 'rebase'].includes(mode))) {
      return 'Error: "mode" must be one of: ff-only, merge, rebase.';
    }

    const args = ['pull'];
    if (mode === 'rebase') {
      args.push('--rebase');
    } else if (mode !== 'merge') {
      args.push('--ff-only');
    }
    args.push(remote);
    if (branch) {
      args.push(branch);
    }

    const result = await context.runCommand('git', args);
    if (!result.ok) {
      const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
      const divergedHint = combined.includes('not possible to fast-forward') || combined.includes('diverging')
        ? '\nThe branches have diverged. Retry with mode "rebase" (linear history) or "merge" (merge commit) to integrate deliberately.'
        : '';
      return `Error: "git ${args.join(' ')}" failed.\n${formatCommandResult(result)}${divergedHint}`;
    }
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return output.length > 0 ? output : 'Already up to date.';
  },
};
