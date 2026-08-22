import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CHANNEL_RANK,
  channelForBranch,
  deriveVersionPlan,
  describeVersionPlan,
  formatVersion,
  parseVersion,
  promoteVersion,
  recommendedVersioningPolicy,
  sanitizeVersioningPolicy,
  stableChannel,
  validateVersioningPolicy,
  VERSION_PLAN_RULES,
  type VersioningPolicy,
} from '../../src/core/versioningPolicy.ts';
import { compareSemver } from '../../src/core/promotionRunner.ts';

/** The recommended shape, which is also the one every assertion below reasons about. */
const policy = (): VersioningPolicy =>
  recommendedVersioningPolicy({ integrationBranch: 'develop', releaseBranch: 'main' });

describe('parseVersion', () => {
  it('parses a finished version', () => {
    expect(parseVersion('1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: [], core: '1.2.3' });
  });

  it('parses a pre-release into its identifiers', () => {
    expect(parseVersion('1.5.0-beta.3')).toMatchObject({ core: '1.5.0', prerelease: ['beta', '3'] });
  });

  it('tolerates a v-prefix and carries build metadata without comparing it', () => {
    expect(parseVersion('v1.2.3+build.9')).toMatchObject({ core: '1.2.3', build: 'build.9' });
  });

  it('refuses rather than coercing — rule 5', () => {
    // The whole reason this is strict: `parseInt(part) || 0` turns each of these
    // into 0.0.0, which compares older than everything and passes the very gate
    // that exists to catch it.
    for (const bad of ['', 'latest', 'v', '1.2', '1.2.3.4', 'one.two.three', 'next-release', null, undefined, 42]) {
      expect(parseVersion(bad as unknown)).toBeUndefined();
    }
  });

  it('refuses a leading zero, because two spellings of one version is how a tag stops matching', () => {
    expect(parseVersion('01.2.3')).toBeUndefined();
    expect(parseVersion('1.5.0-beta.01')).toBeUndefined();
  });

  it('refuses a pre-release identifier outside the allowed charset', () => {
    expect(parseVersion('1.5.0-beta_3')).toBeUndefined();
    expect(parseVersion('1.5.0-beta 3')).toBeUndefined();
  });

  it('round-trips through formatVersion', () => {
    const version = fc
      .tuple(
        fc.nat({ max: 40 }),
        fc.nat({ max: 40 }),
        fc.nat({ max: 40 }),
        fc.option(fc.constantFrom('beta.1', 'rc.2', 'alpha', 'beta.11'), { nil: undefined }),
      )
      .map(([a, b, c, pre]) => `${a}.${b}.${c}${pre ? `-${pre}` : ''}`);

    fc.assert(fc.property(version, text => {
      const parsed = parseVersion(text);
      expect(parsed).toBeDefined();
      expect(formatVersion(parsed!)).toBe(text);
    }));
  });
});

describe('channelForBranch', () => {
  it('maps the declared branches', () => {
    expect(channelForBranch(policy(), 'main')?.id).toBe('stable');
    expect(channelForBranch(policy(), 'develop')?.id).toBe('preview');
  });

  it('matches a pattern channel by prefix', () => {
    expect(channelForBranch(policy(), 'release/1.5')?.id).toBe('candidate');
  });

  it('produces nothing for a feature branch — rule 2', () => {
    expect(channelForBranch(policy(), 'feat/123-thing')).toBeUndefined();
  });

  it('prefers an exact match over a pattern that also matches', () => {
    const custom: VersioningPolicy = {
      ...policy(),
      channels: [
        { id: 'wild', label: 'Wild', branch: 'release/*', prerelease: 'rc', distTag: 'rc', stability: 'candidate' },
        { id: 'pinned', label: 'Pinned', branch: 'release/1.5', prerelease: 'pin', distTag: 'pin', stability: 'candidate' },
      ],
    };
    expect(channelForBranch(custom, 'release/1.5')?.id).toBe('pinned');
  });

  it('prefers the longest matching pattern', () => {
    const custom: VersioningPolicy = {
      ...policy(),
      channels: [
        { id: 'broad', label: 'Broad', branch: 'release/*', prerelease: 'rc', distTag: 'rc', stability: 'candidate' },
        { id: 'narrow', label: 'Narrow', branch: 'release/hotfix/*', prerelease: 'hf', distTag: 'hf', stability: 'candidate' },
      ],
    };
    expect(channelForBranch(custom, 'release/hotfix/9')?.id).toBe('narrow');
  });
});

describe('recommendedVersioningPolicy', () => {
  it('recommends SemVer with conventional commits and tag-sourced numbers', () => {
    const recommended = policy();
    expect(recommended.scheme).toBe('semver');
    expect(recommended.commitConvention).toBe('conventional');
    expect(recommended.source).toBe('tag');
  });

  it('maps stable, preview and candidate onto the branches a project has', () => {
    expect(policy().channels.map(channel => channel.id)).toEqual(['stable', 'preview', 'candidate']);
    expect(stableChannel(policy())?.branch).toBe('main');
  });

  it('gives a trunk-based project one release channel, not two identical ones', () => {
    const trunk = recommendedVersioningPolicy({ integrationBranch: 'main', releaseBranch: 'main' });
    expect(trunk.channels.map(channel => channel.id)).toEqual(['stable', 'candidate']);
  });

  it('honours a project that keeps the number in its manifest by choice', () => {
    expect(recommendedVersioningPolicy({
      integrationBranch: 'develop',
      releaseBranch: 'main',
      manifestSourced: true,
    }).source).toBe('manifest');
  });
});

describe('deriveVersionPlan', () => {
  const base = {
    currentBranch: 'develop',
    manifestVersion: '1.4.2',
    lastStableVersion: '1.4.2',
    commitSubjects: ['feat: a new thing', 'fix: a small thing'],
    existingTags: ['v1.4.0', 'v1.4.1', 'v1.4.2'],
  };

  it('derives nothing at all when no policy is declared — rule 3', () => {
    const plan = deriveVersionPlan({ ...base });
    expect(plan.declared).toBe(false);
    expect(plan.nextVersion).toBeUndefined();
    expect(plan.rule.id).toBe('not-declared');
    expect(plan.refusal?.reason).toBe('not-declared');
    // Never a silent SemVer assumption on a project that never chose one.
    expect(describeVersionPlan(plan)).toContain('not assuming');
  });

  it('produces no version on a branch with no channel, and says that is normal', () => {
    const plan = deriveVersionPlan({ ...base, policy: policy(), currentBranch: 'feat/12-thing' });
    expect(plan.declared).toBe(true);
    expect(plan.nextVersion).toBeUndefined();
    expect(plan.rule.id).toBe('no-channel');
    expect(plan.refusal?.detail).toContain('not a fault');
  });

  it('opens a pre-release on the bumped line for a preview channel', () => {
    const plan = deriveVersionPlan({ ...base, policy: policy() });
    expect(plan.channel?.id).toBe('preview');
    expect(plan.bumpLevel).toBe('minor');
    expect(plan.nextVersion).toBe('1.5.0-beta.1');
    expect(plan.nextTag).toBe('v1.5.0-beta.1');
    expect(plan.rule.id).toBe('open-prerelease');
  });

  it('advances the ordinal when the line already has a pre-release open', () => {
    const plan = deriveVersionPlan({
      ...base,
      policy: policy(),
      existingTags: ['v1.4.2', 'v1.5.0-beta.1', 'v1.5.0-beta.2'],
    });
    expect(plan.nextVersion).toBe('1.5.0-beta.3');
    expect(plan.rule.id).toBe('continue-prerelease');
  });

  it('ignores a pre-release stranded below the last release', () => {
    // `1.4.0-beta.7` is history once `1.4.2` shipped. Continuing it would emit a
    // version SemVer orders below something already published.
    const plan = deriveVersionPlan({
      ...base,
      policy: policy(),
      existingTags: ['v1.4.0-beta.7', 'v1.4.2'],
    });
    expect(plan.nextVersion).toBe('1.5.0-beta.1');
    expect(plan.rule.id).toBe('open-prerelease');
  });

  it('finalizes a pre-release on the stable channel, preserving the release line — rule 1', () => {
    const plan = deriveVersionPlan({
      ...base,
      policy: policy(),
      currentBranch: 'main',
      manifestVersion: '1.5.0-rc.2',
    });
    expect(plan.rule.id).toBe('finalize');
    // The line the candidate was tested on, not a fresh bump on top of it.
    expect(plan.nextVersion).toBe('1.5.0');
  });

  it('bumps the release line on the stable channel when nothing is in flight', () => {
    const plan = deriveVersionPlan({ ...base, policy: policy(), currentBranch: 'main' });
    expect(plan.rule.id).toBe('bump-stable');
    expect(plan.nextVersion).toBe('1.5.0');
  });

  it('reads the bump level from conventional commits, and says patch when none were read', () => {
    const major = deriveVersionPlan({ ...base, policy: policy(), currentBranch: 'main', commitSubjects: ['feat!: drop it'] });
    expect(major.bumpLevel).toBe('major');
    expect(major.nextVersion).toBe('2.0.0');

    const none = deriveVersionPlan({ ...base, policy: policy(), currentBranch: 'main', commitSubjects: [] });
    expect(none.notes.join(' ')).toContain('falls to patch');
  });

  it('suggests no level at all when the convention is switched off', () => {
    const manual: VersioningPolicy = { ...policy(), commitConvention: 'none' };
    const plan = deriveVersionPlan({ ...base, policy: manual, currentBranch: 'main' });
    expect(plan.bumpLevel).toBeUndefined();
  });

  it('says so when tags were never read, rather than reading that as "there are none"', () => {
    const plan = deriveVersionPlan({ ...base, policy: policy(), existingTags: undefined });
    expect(plan.notes.join(' ')).toContain('Tags were not read');
    // The number is still offered — it is a reading, not an action.
    expect(plan.nextVersion).toBe('1.5.0-beta.1');
  });

  it('refuses an unparseable base rather than coercing it to 0.0.0 — rule 5', () => {
    const plan = deriveVersionPlan({
      ...base,
      policy: policy(),
      lastStableVersion: 'nightly',
      manifestVersion: 'nightly',
    });
    expect(plan.nextVersion).toBeUndefined();
    expect(plan.rule.id).toBe('unparseable');
  });

  it('builds on the last released version, not on a manifest already bumped', () => {
    // Bumping the manifest's own pre-release would skip a number nobody released.
    const plan = deriveVersionPlan({
      ...base,
      policy: policy(),
      currentBranch: 'develop',
      manifestVersion: '1.5.0-beta.1',
      lastStableVersion: '1.4.2',
      existingTags: ['v1.4.2'],
    });
    expect(plan.nextVersion).toBe('1.5.0-beta.1');
  });

  it('always moves forward on the semver scheme', () => {
    const level = fc.constantFrom(['fix: x'], ['feat: x'], ['feat!: x'], []);
    const branch = fc.constantFrom('main', 'develop', 'release/1.9');
    fc.assert(fc.property(level, branch, (commitSubjects, currentBranch) => {
      const plan = deriveVersionPlan({
        policy: policy(),
        currentBranch,
        manifestVersion: '1.4.2',
        lastStableVersion: '1.4.2',
        commitSubjects,
        existingTags: ['v1.4.2'],
      });
      expect(plan.nextVersion).toBeDefined();
      expect(compareSemver(plan.nextVersion!, '1.4.2')).toBeGreaterThan(0);
    }));
  });

  describe('calver', () => {
    const calver = (): VersioningPolicy => ({ ...policy(), scheme: 'calver' });
    // 2026-08-20T00:00:00Z
    const now = Date.UTC(2026, 7, 20);

    it('numbers by the release date', () => {
      const plan = deriveVersionPlan({ ...base, policy: calver(), now, existingTags: [] });
      expect(plan.nextVersion).toBe('2026.8.0');
      expect(plan.rule.id).toBe('calver');
    });

    it('advances the ordinal within a period', () => {
      const plan = deriveVersionPlan({ ...base, policy: calver(), now, existingTags: ['v2026.8.0', 'v2026.8.1'] });
      expect(plan.nextVersion).toBe('2026.8.2');
    });

    it('starts a new period at zero', () => {
      const plan = deriveVersionPlan({ ...base, policy: calver(), now, existingTags: ['v2026.7.4'] });
      expect(plan.nextVersion).toBe('2026.8.0');
    });

    it('refuses without a clock rather than guessing at today', () => {
      const plan = deriveVersionPlan({ ...base, policy: calver() });
      expect(plan.nextVersion).toBeUndefined();
      expect(plan.refusal?.reason).toBe('no-clock');
    });
  });

  describe('manual', () => {
    const manual = (): VersioningPolicy => ({ ...policy(), scheme: 'manual' });

    it('reports the manifest version unchanged', () => {
      const plan = deriveVersionPlan({ ...base, policy: manual(), manifestVersion: '0.376.0' });
      expect(plan.nextVersion).toBe('0.376.0');
      expect(plan.rule.id).toBe('manual');
    });

    it('still refuses a manifest version that is not a version', () => {
      const plan = deriveVersionPlan({ ...base, policy: manual(), manifestVersion: 'dev' });
      expect(plan.nextVersion).toBeUndefined();
      expect(plan.rule.id).toBe('unparseable');
    });
  });

  it('names a declared rule on every outcome — rule 4', () => {
    const plans = [
      deriveVersionPlan({ ...base }),
      deriveVersionPlan({ ...base, policy: policy() }),
      deriveVersionPlan({ ...base, policy: policy(), currentBranch: 'main' }),
      deriveVersionPlan({ ...base, policy: policy(), currentBranch: 'feat/x' }),
      deriveVersionPlan({ ...base, policy: policy(), lastStableVersion: 'nope', manifestVersion: 'nope' }),
    ];
    for (const plan of plans) {
      expect(VERSION_PLAN_RULES[plan.rule.id]).toBe(plan.rule.text);
    }
  });
});

describe('promoteVersion', () => {
  it('carries the release line across a promotion untouched — rule 1', () => {
    const toRc = promoteVersion(policy(), '1.5.0-beta.3', 'candidate');
    expect(toRc).toMatchObject({ ok: true, version: '1.5.0-rc.1', tag: 'v1.5.0-rc.1' });

    const toStable = promoteVersion(policy(), '1.5.0-rc.1', 'stable');
    expect(toStable).toMatchObject({ ok: true, version: '1.5.0' });
  });

  it('refuses to move backwards, which would order a release below itself', () => {
    expect(promoteVersion(policy(), '1.5.0', 'preview')).toMatchObject({ ok: false, reason: 'backward' });
    expect(promoteVersion(policy(), '1.5.0-rc.1', 'preview')).toMatchObject({ ok: false, reason: 'backward' });
  });

  it('refuses a promotion to the channel the version is already on', () => {
    expect(promoteVersion(policy(), '1.5.0-beta.3', 'preview')).toMatchObject({ ok: false, reason: 'same-channel' });
  });

  it('refuses a pre-release identifier no declared channel produces', () => {
    expect(promoteVersion(policy(), '1.5.0-nightly.4', 'stable')).toMatchObject({ ok: false, reason: 'unparseable' });
  });

  it('refuses an unknown channel and an unparseable version', () => {
    expect(promoteVersion(policy(), '1.5.0-beta.1', 'shipit')).toMatchObject({ ok: false, reason: 'no-channel' });
    expect(promoteVersion(policy(), 'latest', 'stable')).toMatchObject({ ok: false, reason: 'unparseable' });
  });

  it('never re-mints the release line, for any accepted promotion', () => {
    // The property the whole channel model rests on: if a promotion could change
    // major, minor or patch, the artifact somebody tested and the artifact that
    // ships would be different ones sharing a name.
    const core = fc.tuple(fc.nat({ max: 30 }), fc.nat({ max: 30 }), fc.nat({ max: 30 }))
      .map(([a, b, c]) => `${a}.${b}.${c}`);
    const suffix = fc.constantFrom('', '-beta.1', '-beta.9', '-rc.1', '-rc.4');
    const target = fc.constantFrom('stable', 'preview', 'candidate');

    fc.assert(fc.property(core, suffix, target, (line, pre, toId) => {
      const outcome = promoteVersion(policy(), `${line}${pre}`, toId);
      if (outcome.ok) {
        expect(parseVersion(outcome.version)?.core).toBe(line);
      }
    }));
  });

  it('ranks stability so a promotion can tell forward from backward', () => {
    expect(CHANNEL_RANK.preview).toBeLessThan(CHANNEL_RANK.candidate);
    expect(CHANNEL_RANK.candidate).toBeLessThan(CHANNEL_RANK.stable);
  });
});

describe('sanitizeVersioningPolicy', () => {
  it('round-trips a policy it produced', () => {
    const original = policy();
    expect(sanitizeVersioningPolicy(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });

  it('refuses a document with no recognised scheme', () => {
    expect(sanitizeVersioningPolicy({ scheme: 'lunar', channels: [] })).toBeUndefined();
    expect(sanitizeVersioningPolicy(undefined)).toBeUndefined();
    expect(sanitizeVersioningPolicy([])).toBeUndefined();
  });

  it('drops a channel whose pre-release identifier would corrupt a tag', () => {
    const result = sanitizeVersioningPolicy({
      scheme: 'semver',
      channels: [
        { id: 'ok', branch: 'main', distTag: 'latest', stability: 'stable' },
        { id: 'bad', branch: 'develop', prerelease: 'beta 1', distTag: 'next', stability: 'preview' },
        { id: 'numeric', branch: 'develop', prerelease: '2', distTag: 'next', stability: 'preview' },
      ],
    });
    expect(result?.channels.map(channel => channel.id)).toEqual(['ok']);
  });

  it('drops a channel whose branch name would not survive git', () => {
    const result = sanitizeVersioningPolicy({
      scheme: 'semver',
      channels: [
        { id: 'ok', branch: 'main', distTag: 'latest', stability: 'stable' },
        { id: 'spaces', branch: 'my branch', distTag: 'x', stability: 'preview' },
        { id: 'dotdot', branch: 'a..b', distTag: 'x', stability: 'preview' },
        { id: 'lead', branch: '-x', distTag: 'x', stability: 'preview' },
      ],
    });
    expect(result?.channels.map(channel => channel.id)).toEqual(['ok']);
  });

  it('keeps a pattern branch, whose wildcard is declared rather than illegal', () => {
    const result = sanitizeVersioningPolicy({
      scheme: 'semver',
      channels: [{ id: 'rc', branch: 'release/*', prerelease: 'rc', distTag: 'rc', stability: 'candidate' }],
    });
    expect(result?.channels[0].branch).toBe('release/*');
  });

  it('cleans a label rather than refusing the channel that carries it', () => {
    const noisy = `Pre${String.fromCharCode(7)}view`;
    const result = sanitizeVersioningPolicy({
      scheme: 'semver',
      channels: [{ id: 'preview', label: noisy, branch: 'develop', prerelease: 'beta', distTag: 'next', stability: 'preview' }],
    });
    expect(result?.channels[0].label).toBe('Pre view');
  });

  it('falls back to the id when a label is missing or empty', () => {
    const result = sanitizeVersioningPolicy({
      scheme: 'semver',
      channels: [{ id: 'preview', label: '   ', branch: 'develop', distTag: 'next', stability: 'preview' }],
    });
    expect(result?.channels[0].label).toBe('preview');
  });

  it('de-duplicates channel ids and caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`, branch: `b${i}`, distTag: 'x', stability: 'preview',
    }));
    const result = sanitizeVersioningPolicy({ scheme: 'semver', channels: [...many, { id: 'c0', branch: 'other', distTag: 'x', stability: 'preview' }] });
    expect(result?.channels.length).toBe(12);
    expect(new Set(result?.channels.map(channel => channel.id)).size).toBe(12);
  });

  it('refuses a tag prefix that is not one, rather than passing it into a tag', () => {
    expect(sanitizeVersioningPolicy({ scheme: 'semver', channels: [], tagPrefix: 'v1.2.3-' })?.tagPrefix).toBe('v');
    expect(sanitizeVersioningPolicy({ scheme: 'semver', channels: [], tagPrefix: '' })?.tagPrefix).toBe('');
  });
});

describe('validateVersioningPolicy', () => {
  it('reports a channel naming a branch that does not exist, and keeps the channel', () => {
    const result = validateVersioningPolicy(policy(), ['main', 'feat/x']);
    expect(result.warnings.join(' ')).toContain('develop');
    expect(result.errors).toEqual([]);
    // Reported, never dropped: a silently removed channel reads as one nobody
    // declared, and the team goes looking for the setting they know they wrote.
    expect(policy().channels.some(channel => channel.branch === 'develop')).toBe(true);
  });

  it('says nothing about branches when none were read', () => {
    expect(validateVersioningPolicy(policy(), []).warnings).toEqual([]);
  });

  it('errors when two channels stamp the same identifier', () => {
    const clashing: VersioningPolicy = {
      ...policy(),
      channels: [
        ...policy().channels,
        { id: 'other', label: 'Other', branch: 'next', prerelease: 'beta', distTag: 'other', stability: 'preview' },
      ],
    };
    expect(validateVersioningPolicy(clashing, []).errors.join(' ')).toContain('both stamp');
  });

  it('errors when nothing could ever be released', () => {
    const noStable: VersioningPolicy = {
      ...policy(),
      channels: policy().channels.filter(channel => channel.id !== 'stable'),
    };
    expect(validateVersioningPolicy(noStable, []).errors.join(' ')).toContain('finished versions');
  });

  it('errors when no channel is declared at all', () => {
    expect(validateVersioningPolicy({ ...policy(), channels: [] }, []).errors.join(' ')).toContain('no branch produces');
  });
});
