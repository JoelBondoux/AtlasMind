import type { SkillDefinition, SkillExecutionContext } from '../types.js';

/** Branches that are always protected from force-pushes and deletion. */
const PROTECTED_BRANCHES = new Set(['main', 'master', 'production', 'prod', 'release', 'stable']);

export function isProtectedBranch(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return PROTECTED_BRANCHES.has(lower) || lower.startsWith('release/') || lower.startsWith('hotfix/');
}

/** Characters git refuses in a ref name, plus `..`. */
const INVALID_REF_CHARACTERS = /[~^:?*[\s\\]|\.\.|@\{/;

async function localRefExists(context: SkillExecutionContext, ref: string): Promise<boolean> {
  const result = await context.runCommand('git', ['rev-parse', '--verify', '--quiet', ref]);
  return result.ok;
}

export const gitPushSkill: SkillDefinition = {
  id: 'git-push',
  name: 'Git Push',
  builtIn: true,
  description:
    'Push a named branch, or one named tag, to a remote. ' +
    'Always name the branch: a push that names an ordinary working branch (e.g. develop, feat/x) can be pre-approved under autopilot, ' +
    'while a push with no branch named, to a protected branch (main, master, production, staging, release/*, hotfix/*), with force, or of a tag always asks. ' +
    'Never use this to promote into a protected branch — open a pull request instead. ' +
    'Push a release tag only after the pull request that carries its version has merged. ' +
    'Defaults to "origin" when no remote is specified.',
  routingHints: [
    'push branch', 'push to remote', 'push to origin', 'push changes', 'push commits',
    'upload branch', 'publish branch', 'push tag',
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
        description: 'Local branch to push. Name it explicitly — omitting it pushes the current branch and always asks for approval.',
      },
      tag: {
        type: 'string',
        description:
          'Push exactly this one local tag (e.g. "v1.2.3") and nothing else. Cannot be combined with branch, tags, or force. ' +
          'A tag push can start a release workflow, so it always asks for approval.',
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
        description: 'Also push all local tags (--tags). Prefer "tag" to push a single one. Defaults to false.',
      },
    },
  },
  async execute(params, context) {
    const remote = typeof params['remote'] === 'string' && params['remote'].trim()
      ? params['remote'].trim()
      : 'origin';

    const rawBranch = params['branch'];
    const branch = typeof rawBranch === 'string' && rawBranch.trim() ? rawBranch.trim() : undefined;
    const rawTag = params['tag'];
    const tag = typeof rawTag === 'string' && rawTag.trim() ? rawTag.trim() : undefined;
    const force = params['force'] === true;
    const setUpstream = params['setUpstream'] === true;
    const tags = params['tags'] === true;

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) {
      return 'Error: Remote must be the name of a configured remote (e.g. "origin"), not a URL or path.';
    }

    // One named tag, pushed by its full ref so it cannot be read as a branch.
    // Kept separate from every branch option: the approval for a tag push is a
    // decision about a release, and folding a branch into it would approve two
    // different things in one dialog.
    if (tag !== undefined) {
      if (branch !== undefined || tags || force || setUpstream) {
        return 'Error: "tag" pushes exactly one tag and cannot be combined with branch, tags, force, or setUpstream.';
      }
      if (INVALID_REF_CHARACTERS.test(tag) || tag.startsWith('-')) {
        return 'Error: Tag name contains invalid characters.';
      }
      if (!await localRefExists(context, `refs/tags/${tag}`)) {
        return `Error: No local tag named "${tag}". Create it first (git tag), then push it.`;
      }
      const tagResult = await context.runCommand('git', ['push', remote, `refs/tags/${tag}`]);
      return formatResult(tagResult);
    }

    // Validate branch name characters when provided
    if (branch !== undefined && (INVALID_REF_CHARACTERS.test(branch) || branch.startsWith('-'))) {
      return 'Error: Branch name contains invalid characters.';
    }

    // The approval grade for a named branch assumes it *is* a branch. `git push
    // origin v1.2.3` pushes a tag when that name is a tag, so a tag named where a
    // branch belongs would ride through on a branch's approval. Checked here,
    // where git can answer, because the classifier cannot.
    if (branch !== undefined && !await localRefExists(context, `refs/heads/${branch}`)) {
      if (await localRefExists(context, `refs/tags/${branch}`)) {
        return `Error: "${branch}" is a tag, not a branch. Use the "tag" parameter to push it.`;
      }
      return `Error: No local branch named "${branch}".`;
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
    return formatResult(result);
  },
};

function formatResult(result: { ok: boolean; exitCode: number; stdout: string; stderr: string }): string {
  return [
    `ok: ${result.ok}`,
    `exitCode: ${result.exitCode}`,
    result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
    result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
  ].join('\n');
}
