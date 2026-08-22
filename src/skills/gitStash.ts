import type { SkillDefinition } from '../types.js';

/**
 * Stash management — the safety valve every branch-switching flow needs.
 *
 * Cleanup and review tasks constantly hit "cannot switch: you have local
 * changes", and without a stash skill the model's options were a raw
 * `terminal-run` invocation or abandoning the task. Stash entries are addressed
 * by a validated integer index (`stash@{n}` is constructed here, never accepted
 * as free text), so a crafted ref can never smuggle extra arguments to git.
 */

function stashRef(index: number): string {
  return `stash@{${index}}`;
}

function readIndex(value: unknown): number | string {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 999) {
    return 'Error: "index" must be an integer between 0 and 999.';
  }
  return value;
}

function formatCommandResult(result: { ok: boolean; exitCode: number; stdout: string; stderr: string }): string {
  return [
    `ok: ${result.ok}`,
    `exitCode: ${result.exitCode}`,
    result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
    result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
  ].join('\n');
}

export const gitStashSkill: SkillDefinition = {
  id: 'git-stash',
  name: 'Git Stash',
  builtIn: true,
  description:
    'Set local changes aside and bring them back: list stashes, show one, push (save) the working tree, ' +
    'apply or pop an entry, or drop one. Drop permanently discards the stashed changes; pop drops after a ' +
    'successful apply. Entries are addressed by integer index (0 = newest).',
  routingHints: [
    'stash changes', 'stash the working tree', 'list stashes', 'apply stash', 'pop stash',
    'restore stashed changes', 'set changes aside',
  ],
  parameters: {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'show', 'push', 'apply', 'pop', 'drop'],
        description: 'The stash operation to perform.',
      },
      index: {
        type: 'integer',
        description: 'Stash entry index for show/apply/pop/drop (0 = newest). Defaults to 0.',
      },
      message: {
        type: 'string',
        description: 'Optional description recorded with push.',
      },
      includeUntracked: {
        type: 'boolean',
        description: 'For push: also stash untracked files (-u). Defaults to false.',
      },
    },
  },
  async execute(params, context) {
    const action = params['action'];
    if (typeof action !== 'string' || !['list', 'show', 'push', 'apply', 'pop', 'drop'].includes(action)) {
      return 'Error: "action" must be one of: list, show, push, apply, pop, drop.';
    }

    if (action === 'list') {
      const result = await context.runCommand('git', ['stash', 'list']);
      if (!result.ok) {
        return `Error: "git stash list" failed.\n${formatCommandResult(result)}`;
      }
      return result.stdout.trim() || 'No stash entries.';
    }

    if (action === 'push') {
      const args = ['stash', 'push'];
      if (params['includeUntracked'] === true) {
        args.push('--include-untracked');
      }
      const message = typeof params['message'] === 'string' ? params['message'].trim() : '';
      if (message.length > 0) {
        args.push('-m', message.slice(0, 200));
      }
      const result = await context.runCommand('git', args);
      if (!result.ok) {
        return `Error: "git stash push" failed.\n${formatCommandResult(result)}`;
      }
      const output = `${result.stdout}\n${result.stderr}`.trim();
      return output.length > 0 ? output : 'Saved the working tree to the stash.';
    }

    const index = readIndex(params['index']);
    if (typeof index === 'string') {
      return index;
    }
    const ref = stashRef(index);
    const args = action === 'show'
      ? ['stash', 'show', '--stat', ref]
      : ['stash', action, ref];
    const result = await context.runCommand('git', args);
    if (!result.ok) {
      const conflictHint = (action === 'apply' || action === 'pop')
        && `${result.stdout}\n${result.stderr}`.toLowerCase().includes('conflict')
        ? '\nThe stash conflicts with the current working tree. Resolve the conflicted files, then (for pop) drop the entry once its changes are safely applied.'
        : '';
      return `Error: "git ${args.join(' ')}" failed.\n${formatCommandResult(result)}${conflictHint}`;
    }
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (output.length > 0) {
      return output;
    }
    switch (action) {
      case 'show': return `${ref} holds no changes.`;
      case 'apply': return `Applied ${ref} (the entry is kept).`;
      case 'pop': return `Applied and dropped ${ref}.`;
      default: return `Dropped ${ref}. Its changes are discarded.`;
    }
  },
};
