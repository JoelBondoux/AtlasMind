import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  buildPromotionPlan,
  evaluatePromotionGateExceptFixable,
  classifyBumpLevel,
  bumpVersion,
  setPackageJsonVersion,
  insertChangelogEntry,
  buildInitialChangelog,
  syncReadmeReleaseVersion,
  syncNpmLockfileVersion,
  insertWikiChangelogEntry,
  applyPromotionRemediation,
} from '../../src/core/promotionRunner.ts';
import type { DeliveryConfig, DeploymentStage, PromotionPlan } from '../../src/types.ts';

function makeStage(over: Partial<DeploymentStage> & { id: string; name: string }): DeploymentStage {
  return {
    kind: 'staging',
    rank: 1,
    description: '',
    config: {},
    hosting: {},
    data: {},
    backupPolicy: { required: false },
    promotionPolicy: { requiresApproval: false, requireVersionBump: false, requireChangelog: false, requiredChecks: [] },
    rollbackPolicy: {},
    isProtected: false,
    ...over,
  } as DeploymentStage;
}

function makeConfig(from: DeploymentStage, to: DeploymentStage): DeliveryConfig {
  return { version: 1, stages: [from, to], paths: [{ id: 'p1', fromStageId: from.id, toStageId: to.id }] };
}

const ASSESSMENT = { bumpLevel: 'minor' as const, bumpReason: 'minor — a feature.', canBumpVersion: true, canEditChangelog: true };

describe('classifyBumpLevel', () => {
  it('returns patch for fixes/chores/docs only', () => {
    expect(classifyBumpLevel(['fix: a', 'chore: b', 'docs: c'])).toBe('patch');
  });
  it('returns minor when any feat is present', () => {
    expect(classifyBumpLevel(['fix: a', 'feat: new thing'])).toBe('minor');
  });
  it('returns major for a "type!:" breaking subject', () => {
    expect(classifyBumpLevel(['feat!: drop legacy API', 'fix: a'])).toBe('major');
  });
  it('returns major for a BREAKING CHANGE footer', () => {
    expect(classifyBumpLevel(['refactor: x\n\nBREAKING CHANGE: removed Y'])).toBe('major');
  });
  it('defaults to patch on no commits', () => {
    expect(classifyBumpLevel([])).toBe('patch');
  });
});

describe('bumpVersion', () => {
  it('bumps each level correctly', () => {
    expect(bumpVersion('0.0.0', 'patch')).toBe('0.0.1');
    expect(bumpVersion('0.0.0', 'minor')).toBe('0.1.0');
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
  });
  it('tolerates a v-prefix and pre-release suffix', () => {
    expect(bumpVersion('v1.2.3-beta.1', 'patch')).toBe('1.2.4');
  });
});

describe('setPackageJsonVersion', () => {
  it('replaces only the version field, preserving formatting', () => {
    const raw = '{\n  "name": "x",\n  "version": "0.0.0",\n  "scripts": {}\n}\n';
    const out = setPackageJsonVersion(raw, '0.1.0');
    expect(out).toContain('"version": "0.1.0"');
    expect(out).toContain('"name": "x"');
    expect(out.startsWith('{\n  "name"')).toBe(true);
  });
  it('returns the input unchanged when there is no version field', () => {
    const raw = '{\n  "name": "x"\n}\n';
    expect(setPackageJsonVersion(raw, '0.1.0')).toBe(raw);
  });
});

describe('insertChangelogEntry', () => {
  it('inserts beneath an Unreleased section, above the first version', () => {
    const raw = '# Changelog\n\n## [Unreleased]\n\n### Added\n\n## [1.0.0] - 2020-01-01\n\n- old\n';
    const out = insertChangelogEntry(raw, '1.1.0', '2026-06-29');
    expect(out).toContain('## [1.1.0] - 2026-06-29');
    // New entry sits after Unreleased but before 1.0.0.
    expect(out.indexOf('## [Unreleased]')).toBeLessThan(out.indexOf('## [1.1.0]'));
    expect(out.indexOf('## [1.1.0]')).toBeLessThan(out.indexOf('## [1.0.0]'));
  });
  it('inserts above the first version heading when there is no Unreleased', () => {
    const raw = '# Changelog\n\n## [1.0.0] - 2020-01-01\n\n- old\n';
    const out = insertChangelogEntry(raw, '1.1.0', '2026-06-29');
    expect(out.indexOf('## [1.1.0]')).toBeLessThan(out.indexOf('## [1.0.0]'));
  });
  it('appends when the document has no version headings', () => {
    const raw = '# Changelog\n\nPreamble only.\n';
    const out = insertChangelogEntry(raw, '1.0.0', '2026-06-29');
    expect(out).toContain('Preamble only.');
    expect(out).toContain('## [1.0.0] - 2026-06-29');
  });
});

describe('buildInitialChangelog', () => {
  it('seeds a Keep-a-Changelog document with the first entry', () => {
    const out = buildInitialChangelog('1.0.0', '2026-06-29');
    expect(out).toContain('# Changelog');
    expect(out).toContain('Keep a Changelog');
    expect(out).toContain('## [1.0.0] - 2026-06-29');
  });
});

describe('release metadata synchronization', () => {
  it('updates only recognised current-version README markers', () => {
    const raw = '# App\nCurrent source version: 1.2.3\n## What\'s new in 1.2.3\nHistory: 1.2.3\n';
    const out = syncReadmeReleaseVersion(raw, '1.2.3', '1.2.4');
    expect(out).toContain('Current source version: 1.2.4');
    expect(out).toContain("## What's new in 1.2.4");
    expect(out).toContain('History: 1.2.3');
  });

  it('inserts a wiki release above history and is idempotent', () => {
    const raw = '# Changelog\n\n---\n\n## v1.2.3 — Previous\n\nOld.\n';
    const once = insertWikiChangelogEntry(raw, '1.2.4');
    expect(once.indexOf('## v1.2.4')).toBeLessThan(once.indexOf('## v1.2.3'));
    expect(insertWikiChangelogEntry(once, '1.2.4')).toBe(once);
  });

  it('updates only the root versions in an npm lockfile', () => {
    const raw = JSON.stringify({
      name: 'demo', version: '1.2.3', lockfileVersion: 3,
      packages: { '': { name: 'demo', version: '1.2.3' }, 'node_modules/same': { version: '1.2.3' } },
    }, null, 2) + '\n';
    const parsed = JSON.parse(syncNpmLockfileVersion(raw, '1.2.4'));
    expect(parsed.version).toBe('1.2.4');
    expect(parsed.packages[''].version).toBe('1.2.4');
    expect(parsed.packages['node_modules/same'].version).toBe('1.2.3');
  });
});

describe('buildPromotionPlan — remediation', () => {
  function planFor(opts: {
    fromVersion: string;
    toVersion: string;
    changelogHasFromVersion: boolean;
    workingTreeClean?: boolean;
    requiredChecks?: string[];
    withAssessment?: boolean;
  }): PromotionPlan {
    const from = makeStage({ id: 'local', name: 'Local' });
    const to = makeStage({
      id: 'staging',
      name: 'Staging',
      branchRef: 'staging',
      promotionPolicy: { requiresApproval: false, requireVersionBump: true, requireChangelog: true, requiredChecks: opts.requiredChecks ?? [] },
    });
    return buildPromotionPlan({
      config: makeConfig(from, to),
      pathId: 'p1',
      fromVersion: opts.fromVersion,
      toVersion: opts.toVersion,
      workingTreeClean: opts.workingTreeClean ?? true,
      changelogHasFromVersion: opts.changelogHasFromVersion,
      ...(opts.withAssessment === false ? {} : { remediationAssessment: ASSESSMENT }),
    })!;
  }

  it('offers a remediation that resolves both version and changelog, with an assessed bump', () => {
    const plan = planFor({ fromVersion: '0.0.0', toVersion: '0.0.0', changelogHasFromVersion: false });
    expect(plan.remediation).toBeDefined();
    expect(plan.remediation!.resolves.sort()).toEqual(['changelog', 'version-bump']);
    expect(plan.remediation!.targetVersion).toBe('0.1.0'); // minor assessment from 0.0.0
    expect(plan.remediation!.bumpLevel).toBe('minor');
    expect(plan.remediation!.commits).toBe(true);
    expect(plan.checks.find(c => c.id === 'version-bump')!.fixable).toBe(true);
    expect(plan.checks.find(c => c.id === 'changelog')!.fixable).toBe(true);
  });

  it('does not offer a remediation when a non-fixable auto check is also failing', () => {
    const plan = planFor({
      fromVersion: '0.0.0', toVersion: '0.0.0', changelogHasFromVersion: false,
      workingTreeClean: false, requiredChecks: ['Working tree clean'],
    });
    expect(plan.checks.some(c => c.id.startsWith('auto-clean') && c.status === 'fail')).toBe(true);
    expect(plan.remediation).toBeUndefined();
  });

  it('offers a changelog-only remediation (no bump) when the version is already ahead', () => {
    const plan = planFor({ fromVersion: '0.1.0', toVersion: '0.0.0', changelogHasFromVersion: false });
    expect(plan.remediation).toBeDefined();
    expect(plan.remediation!.bumpLevel).toBeNull();
    expect(plan.remediation!.targetVersion).toBe('0.1.0');
    expect(plan.remediation!.resolves).toEqual(['changelog']);
  });

  it('offers no remediation when every check passes', () => {
    const plan = planFor({ fromVersion: '0.1.0', toVersion: '0.0.0', changelogHasFromVersion: true });
    expect(plan.remediation).toBeUndefined();
  });

  it('offers no remediation without an assessment', () => {
    const plan = planFor({ fromVersion: '0.0.0', toVersion: '0.0.0', changelogHasFromVersion: false, withAssessment: false });
    expect(plan.remediation).toBeUndefined();
  });
});

describe('applyPromotionRemediation — safety', () => {
  it('refuses a non-semver target version before touching the filesystem or git', async () => {
    const res = await applyPromotionRemediation('/dir/does/not/exist', {
      resolves: ['changelog'],
      targetVersion: '1.0.0; rm -rf /',
      bumpLevel: null,
      bumpReason: '',
      editsChangelog: true,
      commits: true,
      summary: '',
    });
    expect(res.ok).toBe(false);
    expect(res.committed).toBe(false);
    expect(res.output).toMatch(/unexpected version/i);
  });

  it('treats the manifest, changelog, and recognised release docs as one edit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'atlasmind-promotion-'));
    try {
      await mkdir(path.join(root, 'wiki'));
      await writeFile(path.join(root, 'package.json'), '{\n  "name": "demo",\n  "version": "1.2.3"\n}\n');
      await writeFile(path.join(root, 'package-lock.json'), '{\n  "name": "demo",\n  "version": "1.2.3",\n  "lockfileVersion": 3,\n  "packages": { "": { "version": "1.2.3" } }\n}\n');
      await writeFile(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n## [1.2.3] - 2026-01-01\n\n- Old.\n');
      await writeFile(path.join(root, 'README.md'), '# Demo\n\nCurrent source version: 1.2.3\n\n## What\'s new in 1.2.3\n');
      await writeFile(path.join(root, 'wiki', 'Changelog.md'), '# Changelog\n\n---\n\n## v1.2.3 — Old\n');

      const res = await applyPromotionRemediation(root, {
        resolves: ['version-bump', 'changelog'],
        targetVersion: '1.2.4',
        bumpLevel: 'patch',
        bumpReason: 'patch',
        editsChangelog: true,
        commits: false,
        summary: '',
      });

      expect(res).toEqual(expect.objectContaining({ ok: true, committed: false }));
      expect(await readFile(path.join(root, 'package.json'), 'utf8')).toContain('"version": "1.2.4"');
      expect(await readFile(path.join(root, 'package-lock.json'), 'utf8')).toContain('"version": "1.2.4"');
      expect(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8')).toContain('## [1.2.4]');
      expect(await readFile(path.join(root, 'README.md'), 'utf8')).toContain('Current source version: 1.2.4');
      expect(await readFile(path.join(root, 'wiki', 'Changelog.md'), 'utf8')).toContain('## v1.2.4');
      expect(res.output).toContain('README.md');
      expect(res.output).toContain('package-lock.json');
      expect(res.output).toContain('wiki/Changelog.md');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('evaluatePromotionGateExceptFixable', () => {
  const base: PromotionPlan = {
    pathId: 'p1', fromStageId: 'a', toStageId: 'b', fromName: 'A', toName: 'B',
    steps: [], checks: [], blockers: [], requiresApproval: false, isProtected: false,
    viaPullRequest: false, hasRoutine: false,
  };

  it('tolerates a failing fixable auto-check but still requires manual attestations', () => {
    const plan: PromotionPlan = {
      ...base,
      checks: [
        { id: 'version-bump', label: 'v', kind: 'auto', status: 'fail', detail: '', fixable: true },
        { id: 'manual-x', label: 'x', kind: 'manual', status: 'manual', detail: '' },
      ],
    };
    expect(evaluatePromotionGateExceptFixable(plan, [], '', 'B').allowed).toBe(false);
    expect(evaluatePromotionGateExceptFixable(plan, ['manual-x'], '', 'B').allowed).toBe(true);
  });

  it('still blocks on a failing NON-fixable auto-check', () => {
    const plan: PromotionPlan = {
      ...base,
      checks: [{ id: 'ci', label: 'CI', kind: 'auto', status: 'fail', detail: '' }],
    };
    expect(evaluatePromotionGateExceptFixable(plan, [], '', 'B').allowed).toBe(false);
  });
});
