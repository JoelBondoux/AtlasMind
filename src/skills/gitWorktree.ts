import path from 'node:path';
import type { SkillDefinition, SkillExecutionContext } from '../types.js';

/**
 * Worktree management — the operation branch-cleanup runs aground on.
 *
 * A linked worktree pins its branch: `git branch --delete` refuses while the
 * worktree exists, so "clean up old branches" reliably becomes "remove the
 * worktrees first", and without this skill that meant models improvising
 * `terminal-run` command chains (observed: 17 raw commands in one cleanup run,
 * ending in an unresolved "remove it manually as administrator").
 *
 * Two properties are enforced rather than documented:
 *
 * **Only a registered linked worktree is ever removed.** The requested path is
 * resolved and matched against `git worktree list --porcelain` before anything
 * runs, and the main worktree (the first entry) is refused outright. A path git
 * does not know is an error, never a deletion.
 *
 * **The escalated Windows fallback stays inside the workspace.** `git worktree
 * remove --force` fails on Windows when OneDrive/attrib have left read-only
 * bits behind. When that happens — and only for a registered worktree that is
 * *inside the workspace root* — the skill clears read-only attributes and
 * removes the directory, then prunes the stale registration. A worktree outside
 * the workspace gets an honest report instead of an escalation, because a
 * recursive delete outside the workspace boundary is not this skill's to make.
 */

interface ParsedWorktree {
  path: string;
  isMain: boolean;
  branch?: string;
}

/** Parse `git worktree list --porcelain` output. The first entry is the main worktree. */
export function parseWorktreeList(porcelain: string): ParsedWorktree[] {
  const entries: ParsedWorktree[] = [];
  let current: ParsedWorktree | undefined;
  for (const line of porcelain.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('worktree ')) {
      current = { path: trimmed.slice('worktree '.length), isMain: entries.length === 0 };
      entries.push(current);
    } else if (current && trimmed.startsWith('branch ')) {
      current.branch = trimmed.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  return entries;
}

/** Normalize a filesystem path for equality comparison across slash style and case (win32). */
export function normalizeWorktreePath(input: string): string {
  const unified = input.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? unified.toLowerCase() : unified;
}

function resolveRequestedPath(requested: string, workspaceRoot: string | undefined): string {
  if (path.isAbsolute(requested)) {
    return requested;
  }
  return workspaceRoot ? path.resolve(workspaceRoot, requested) : path.resolve(requested);
}

function isInsideWorkspace(candidate: string, workspaceRoot: string | undefined): boolean {
  if (!workspaceRoot) {
    return false;
  }
  const rel = path.relative(workspaceRoot, candidate);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function formatCommandResult(result: { ok: boolean; exitCode: number; stdout: string; stderr: string }): string {
  return [
    `ok: ${result.ok}`,
    `exitCode: ${result.exitCode}`,
    result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
    result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
  ].join('\n');
}

async function listWorktrees(context: SkillExecutionContext): Promise<{ raw: string; entries: ParsedWorktree[] } | string> {
  const result = await context.runCommand('git', ['worktree', 'list', '--porcelain']);
  if (!result.ok) {
    return `Error: "git worktree list" failed.\n${formatCommandResult(result)}`;
  }
  return { raw: result.stdout, entries: parseWorktreeList(result.stdout) };
}

async function removeWorktree(
  context: SkillExecutionContext,
  requestedPath: string,
  force: boolean,
): Promise<string> {
  const listed = await listWorktrees(context);
  if (typeof listed === 'string') {
    return listed;
  }

  const resolved = resolveRequestedPath(requestedPath, context.workspaceRootPath);
  const normalizedResolved = normalizeWorktreePath(resolved);
  const match = listed.entries.find(entry => normalizeWorktreePath(entry.path) === normalizedResolved);

  if (!match) {
    const known = listed.entries.map(entry => `- ${entry.path}${entry.isMain ? ' (main worktree)' : ''}`).join('\n');
    return (
      `Error: "${requestedPath}" is not a registered worktree of this repository, so it will not be removed.\n` +
      `Registered worktrees:\n${known || '(none)'}`
    );
  }
  if (match.isMain) {
    return `Error: "${match.path}" is the main worktree and can never be removed by this skill.`;
  }

  const removeArgs = force
    ? ['worktree', 'remove', '--force', match.path]
    : ['worktree', 'remove', match.path];
  const removal = await context.runCommand('git', removeArgs);
  if (removal.ok) {
    return `Removed worktree ${match.path}${match.branch ? ` (branch ${match.branch} is now unlocked)` : ''}.`;
  }

  if (!force) {
    return (
      `Error: git refused to remove the worktree (it may hold modified or untracked files).\n` +
      `${formatCommandResult(removal)}\n` +
      'Retry with force: true to discard its local state.'
    );
  }

  // Windows escalation: OneDrive and attrib leave read-only bits that make git's
  // own deletion fail with a permission error. Measured on a real stuck worktree:
  // OneDrive Files-On-Demand marks the worktree directory *itself*
  // `ReadOnly + ReparsePoint` while the 2,000+ files inside carry nothing — so
  // the directory must be cleared by name, not only via `<path>\*`, which never
  // touches the top level. Only for a registered worktree inside the workspace
  // root — outside that boundary we report instead.
  if (process.platform === 'win32' && isInsideWorkspace(resolved, context.workspaceRootPath)) {
    await context.runCommand('attrib', ['-R', resolved, '/D']).catch(() => undefined);
    await context.runCommand('attrib', ['-R', `${resolved}\\*`, '/S', '/D']).catch(() => undefined);
    const retry = await context.runCommand('git', ['worktree', 'remove', '--force', match.path]);
    if (retry.ok) {
      return `Removed worktree ${match.path} after clearing read-only attributes.`;
    }
    const rd = await context.runCommand('cmd', ['/c', 'rd', '/s', '/q', resolved]);
    const prune = await context.runCommand('git', ['worktree', 'prune']);
    const after = await listWorktrees(context);
    const stillRegistered = typeof after !== 'string'
      && after.entries.some(entry => normalizeWorktreePath(entry.path) === normalizedResolved);
    if (!stillRegistered && rd.ok) {
      return `Removed worktree ${match.path} via the Windows fallback (cleared read-only attributes, deleted the directory, pruned the registration).`;
    }
    return (
      `Error: the worktree at ${match.path} could not be fully removed even with the Windows fallback. ` +
      'A file inside it is likely locked by a running process or cloud-sync client (e.g. OneDrive).\n' +
      `git worktree remove:\n${formatCommandResult(removal)}\n` +
      `directory delete:\n${formatCommandResult(rd)}\n` +
      `git worktree prune:\n${formatCommandResult(prune)}`
    );
  }

  return (
    `Error: git could not remove the worktree.\n${formatCommandResult(removal)}\n` +
    (process.platform === 'win32'
      ? 'The worktree lives outside the workspace root, so the escalated Windows cleanup is deliberately not applied there.'
      : 'Check filesystem permissions on the worktree directory, then retry.')
  );
}

export const gitWorktreeSkill: SkillDefinition = {
  id: 'git-worktree',
  name: 'Git Worktree',
  builtIn: true,
  description:
    'Manage git worktrees: list them, remove a registered linked worktree (unlocking its branch for deletion), ' +
    'or prune stale registrations. Removal only ever targets a worktree git itself lists, never the main worktree. ' +
    'With force, discards the worktree\'s local state; on Windows this may also clear read-only attributes and ' +
    'delete the directory when git\'s own removal is blocked by them.',
  routingHints: [
    'list worktrees', 'remove worktree', 'delete worktree', 'prune worktrees',
    'worktree blocking branch delete', 'clean up worktrees',
  ],
  parameters: {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'remove', 'prune'],
        description: 'The worktree operation to perform.',
      },
      path: {
        type: 'string',
        description: 'Worktree path (required for remove). Absolute, or relative to the workspace root.',
      },
      force: {
        type: 'boolean',
        description: 'For remove: discard modified/untracked files in the worktree, and on Windows escalate past read-only attributes. Defaults to false.',
      },
      dryRun: {
        type: 'boolean',
        description: 'For prune: report what would be pruned without pruning. Defaults to false.',
      },
    },
  },
  async execute(params, context) {
    const action = params['action'];
    if (typeof action !== 'string' || !['list', 'remove', 'prune'].includes(action)) {
      return 'Error: "action" must be one of: list, remove, prune.';
    }

    if (action === 'list') {
      const listed = await listWorktrees(context);
      if (typeof listed === 'string') {
        return listed;
      }
      if (listed.entries.length === 0) {
        return 'No worktrees are registered.';
      }
      return listed.entries
        .map(entry => `${entry.path}${entry.branch ? ` [${entry.branch}]` : ''}${entry.isMain ? ' (main worktree)' : ''}`)
        .join('\n');
    }

    if (action === 'prune') {
      const args = params['dryRun'] === true
        ? ['worktree', 'prune', '--dry-run', '--verbose']
        : ['worktree', 'prune', '--verbose'];
      const result = await context.runCommand('git', args);
      if (!result.ok) {
        return `Error: "git worktree prune" failed.\n${formatCommandResult(result)}`;
      }
      const output = result.stdout.trim() || result.stderr.trim();
      return output.length > 0
        ? output
        : (params['dryRun'] === true ? 'Nothing would be pruned.' : 'Nothing needed pruning.');
    }

    const rawPath = params['path'];
    if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
      return 'Error: "path" is required for the "remove" action.';
    }
    return removeWorktree(context, rawPath.trim(), params['force'] === true);
  },
};
