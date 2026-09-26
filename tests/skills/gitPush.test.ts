import { describe, expect, it, vi } from 'vitest';
import { gitPushSkill } from '../../src/skills/gitPush.ts';
import type { SkillExecutionContext } from '../../src/types.ts';

/**
 * A context whose repository holds the given local branches and tags. Every
 * `git rev-parse --verify` answers from those sets; every push succeeds.
 */
function makeRepo(refs: { branches?: string[]; tags?: string[] } = {}) {
  const known = new Set([
    ...(refs.branches ?? []).map(name => `refs/heads/${name}`),
    ...(refs.tags ?? []).map(name => `refs/tags/${name}`),
  ]);
  const runCommand = vi.fn(async (_executable: string, args: string[] = []) => {
    if (args[0] === 'rev-parse') {
      const ok = known.has(args[args.length - 1] ?? '');
      return { ok, exitCode: ok ? 0 : 1, stdout: '', stderr: '' };
    }
    return { ok: true, exitCode: 0, stdout: '', stderr: '' };
  });
  const context = {
    runCommand,
    getGitStatus: vi.fn().mockResolvedValue('## develop'),
  } as unknown as SkillExecutionContext;
  const pushes = () => runCommand.mock.calls
    .map(call => call[1] ?? [])
    .filter(args => args[0] === 'push');
  return { context, pushes };
}

describe('git-push pushes exactly what it was asked to', () => {
  it('pushes a named local branch', async () => {
    const { context, pushes } = makeRepo({ branches: ['develop'] });
    const result = await gitPushSkill.execute({ branch: 'develop' }, context);
    expect(result).toContain('ok: true');
    expect(pushes()).toEqual([['push', 'origin', 'develop']]);
  });

  it('refuses a tag named where a branch belongs, so it cannot ride on a branch approval', async () => {
    // `git push origin v1.2.3` pushes a tag. The approval grade for a named
    // branch assumes it is a branch; the skill makes that true.
    const { context, pushes } = makeRepo({ tags: ['v1.2.3'] });
    const result = await gitPushSkill.execute({ branch: 'v1.2.3' }, context);
    expect(result).toMatch(/is a tag, not a branch/);
    expect(pushes()).toEqual([]);
  });

  it('refuses a branch that does not exist locally', async () => {
    const { context, pushes } = makeRepo();
    expect(await gitPushSkill.execute({ branch: 'nope' }, context)).toMatch(/No local branch/);
    expect(pushes()).toEqual([]);
  });

  it('pushes one named tag by its full ref and nothing else', async () => {
    const { context, pushes } = makeRepo({ branches: ['main'], tags: ['v1.2.3', 'v1.2.2'] });
    const result = await gitPushSkill.execute({ tag: 'v1.2.3' }, context);
    expect(result).toContain('ok: true');
    expect(pushes()).toEqual([['push', 'origin', 'refs/tags/v1.2.3']]);
  });

  it('refuses a tag that does not exist locally', async () => {
    const { context, pushes } = makeRepo();
    expect(await gitPushSkill.execute({ tag: 'v9.9.9' }, context)).toMatch(/No local tag/);
    expect(pushes()).toEqual([]);
  });

  it('refuses a tag combined with anything else, since that would approve two things at once', async () => {
    const { context, pushes } = makeRepo({ branches: ['develop'], tags: ['v1'] });
    for (const extra of [{ branch: 'develop' }, { tags: true }, { force: true }, { setUpstream: true }]) {
      expect(await gitPushSkill.execute({ tag: 'v1', ...extra }, context)).toMatch(/cannot be combined/);
    }
    expect(pushes()).toEqual([]);
  });

  it('refuses a remote given as a URL or path', async () => {
    const { context, pushes } = makeRepo({ branches: ['develop'] });
    for (const remote of ['https://example.com/x.git', '../elsewhere', 'git@host:x']) {
      expect(await gitPushSkill.execute({ remote, branch: 'develop' }, context)).toMatch(/configured remote/);
    }
    expect(pushes()).toEqual([]);
  });

  it('refuses ref names git would reject, including option-shaped ones', async () => {
    const { context, pushes } = makeRepo();
    for (const name of ['a..b', 'a b', '--force', 'x:main', 'a@{1}']) {
      expect(await gitPushSkill.execute({ branch: name }, context)).toMatch(/invalid characters/);
      expect(await gitPushSkill.execute({ tag: name }, context)).toMatch(/invalid characters/);
    }
    expect(pushes()).toEqual([]);
  });

  it('still refuses a force-push to a protected branch', async () => {
    const { context, pushes } = makeRepo({ branches: ['main'] });
    expect(await gitPushSkill.execute({ branch: 'main', force: true }, context)).toMatch(/blocked/);
    expect(pushes()).toEqual([]);
  });
});
