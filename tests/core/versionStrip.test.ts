import { describe, expect, it } from 'vitest';
import {
  VERSION_STRIP_CAP,
  buildVersionStrip,
  type VersionStripInput,
  type VersionStripStage,
} from '../../src/core/versionStrip.ts';
import { recommendedVersioningPolicy } from '../../src/core/versioningPolicy.ts';

const stage = (over: Partial<VersionStripStage> & Pick<VersionStripStage, 'id' | 'name' | 'rank'>): VersionStripStage => ({
  branchRef: '',
  branchExists: false,
  deployedVersion: '—',
  isCurrentBranch: false,
  isProtected: false,
  ...over,
});

/** The pipeline AtlasMind seeds for itself: Local → Staging → Production. */
const seeded: VersionStripStage[] = [
  stage({ id: 'stage-local', name: 'Local', rank: 0 }),
  stage({ id: 'stage-staging', name: 'Staging', rank: 1, branchRef: 'develop', branchExists: true, deployedVersion: '0.214.0', isCurrentBranch: true }),
  stage({ id: 'stage-production', name: 'Production', rank: 2, branchRef: 'main', branchExists: true, deployedVersion: '0.214.0', isProtected: true }),
];

const base: VersionStripInput = { stages: seeded, workingVersion: '0.214.0', currentBranch: 'develop' };

describe('the strip follows the delivery pipeline', () => {
  it('renders one pill per stage, in pipeline order', () => {
    // The gap this closes: the header was hardcoded to a production branch plus
    // the checked-out branch, so adding a Staging stage changed nothing here.
    const strip = buildVersionStrip(base);
    expect(strip.source).toBe('delivery');
    expect(strip.pills.map(pill => pill.label)).toEqual(['Local', 'Staging', 'Production']);
    expect(strip.pills.map(pill => pill.ref)).toEqual(['working tree', 'develop', 'main']);
  });

  it('picks up a stage added to the pipeline', () => {
    const strip = buildVersionStrip({
      ...base,
      stages: [...seeded, stage({ id: 'stage-qa', name: 'QA', rank: 1.5, branchRef: 'qa', branchExists: true, deployedVersion: '0.213.0' })],
    });
    expect(strip.pills.map(pill => pill.label)).toEqual(['Local', 'Staging', 'QA', 'Production']);
  });

  it('orders by rank rather than by declaration', () => {
    const strip = buildVersionStrip({ ...base, stages: [...seeded].reverse() });
    expect(strip.pills.map(pill => pill.label)).toEqual(['Local', 'Staging', 'Production']);
  });

  it('breaks rank ties on name so the header cannot shuffle', () => {
    const tied = [
      stage({ id: 'b', name: 'Beta', rank: 1, branchRef: 'beta', branchExists: true, deployedVersion: '1.0.0' }),
      stage({ id: 'a', name: 'Alpha', rank: 1, branchRef: 'alpha', branchExists: true, deployedVersion: '1.0.0' }),
    ];
    expect(buildVersionStrip({ ...base, stages: tied }).pills.map(p => p.label)).toEqual(['Alpha', 'Beta']);
    expect(buildVersionStrip({ ...base, stages: [...tied].reverse() }).pills.map(p => p.label)).toEqual(['Alpha', 'Beta']);
  });

  it('normalises a remote-tracking ref to the branch name', () => {
    const strip = buildVersionStrip({
      ...base,
      stages: [stage({ id: 'p', name: 'Production', rank: 2, branchRef: 'origin/main', branchExists: true, deployedVersion: '0.214.0' })],
    });
    expect(strip.pills[0]!.ref).toBe('main');
  });
});

describe('a version is never invented', () => {
  it('reports a branch that does not exist rather than borrowing a version', () => {
    // Showing the working copy's version against an environment nobody has
    // deployed to would claim a deployment that never happened.
    const strip = buildVersionStrip({
      ...base,
      stages: [stage({ id: 'stage-staging', name: 'Staging', rank: 1, branchRef: 'release/next' })],
    });
    expect(strip.pills[0]!.version).toBeUndefined();
    expect(strip.pills[0]!.note).toContain('does not exist');
  });

  it('treats the dash placeholder as unknown, not as a version', () => {
    const strip = buildVersionStrip({
      ...base,
      stages: [stage({ id: 's', name: 'Staging', rank: 1, branchRef: 'develop', branchExists: true, deployedVersion: '—' })],
    });
    expect(strip.pills[0]!.version).toBeUndefined();
    expect(strip.pills[0]!.note).toContain('No');
  });

  it('never shows the working version on a branch pill', () => {
    const strip = buildVersionStrip({ ...base, workingVersion: '9.9.9' });
    const branchPills = strip.pills.filter(pill => !pill.isWorkingTree);
    expect(branchPills.length).toBeGreaterThan(0);
    for (const pill of branchPills) {
      expect(pill.version, pill.label).not.toBe('9.9.9');
    }
  });
});

describe('the working tree is its own claim', () => {
  it('reads from package.json on disk, not from a branch', () => {
    // The local pill is the only one that can be ahead of what is committed —
    // which is exactly what makes it worth a slot in the header.
    const strip = buildVersionStrip({ ...base, workingVersion: '0.215.0' });
    const local = strip.pills.find(pill => pill.isWorkingTree)!;
    expect(local.version).toBe('0.215.0');
    expect(local.ref).toBe('working tree');
    expect(local.label).toBe('Local');
  });

  it('says when the tree is dirty, since that is when it differs', () => {
    const clean = buildVersionStrip(base).pills.find(pill => pill.isWorkingTree)!;
    expect(clean.isDirty).toBe(false);
    expect(clean.note).toBeUndefined();

    const dirty = buildVersionStrip({ ...base, workingTreeDirty: true }).pills.find(pill => pill.isWorkingTree)!;
    expect(dirty.isDirty).toBe(true);
    expect(dirty.note).toContain('Uncommitted');
  });

  it('marks exactly one pill as current when a stage matches the branch', () => {
    const strip = buildVersionStrip(base);
    // The working tree is always where you are; the branch match is the other.
    expect(strip.pills.filter(pill => pill.isCurrent).map(pill => pill.label)).toEqual(['Local', 'Staging']);
  });
});

describe('truncation is never silent', () => {
  const many: VersionStripStage[] = Array.from({ length: 7 }, (_unused, index) => stage({
    id: `s${index}`, name: `Stage ${index}`, rank: index, branchRef: `b${index}`, branchExists: true, deployedVersion: '1.0.0',
  }));

  it('caps the visible pills and states the remainder', () => {
    const strip = buildVersionStrip({ ...base, stages: many });
    expect(strip.pills).toHaveLength(VERSION_STRIP_CAP);
    expect(strip.droppedByCap).toBe(many.length - VERSION_STRIP_CAP);
  });

  it('keeps the earliest stages rather than an arbitrary slice', () => {
    const strip = buildVersionStrip({ ...base, stages: many });
    expect(strip.pills.map(pill => pill.label)).toEqual(['Stage 0', 'Stage 1', 'Stage 2', 'Stage 3']);
  });
});

describe('a project with no pipeline still gets a header', () => {
  it('falls back to the git-derived pair', () => {
    const strip = buildVersionStrip({
      workingVersion: '0.214.0',
      currentBranch: 'develop',
      production: { branch: 'origin/main', version: '0.213.0' },
    });
    expect(strip.source).toBe('branches');
    expect(strip.pills.map(pill => pill.label)).toEqual(['Production', 'Working tree']);
    expect(strip.pills[0]!.version).toBe('0.213.0');
  });

  it('drops the production pill when it is the branch you are on', () => {
    const strip = buildVersionStrip({
      workingVersion: '0.214.0',
      currentBranch: 'main',
      production: { branch: 'main', version: '0.214.0' },
    });
    expect(strip.pills.map(pill => pill.label)).toEqual(['Working tree']);
  });

  it('is never empty', () => {
    for (const input of [
      { workingVersion: '1.0.0', currentBranch: 'main' },
      { workingVersion: '1.0.0', currentBranch: 'main', stages: [] },
    ] as VersionStripInput[]) {
      expect(buildVersionStrip(input).pills.length).toBeGreaterThan(0);
    }
  });

  it('distinguishes a guessed production branch from a declared stage', () => {
    // `detectProductionBranchRef` walks a candidate list, so the fallback is a
    // guess. Reporting it in the same shape as a declared stage would present
    // the guess with the same authority.
    expect(buildVersionStrip({ workingVersion: '1.0.0', currentBranch: 'dev' }).source).toBe('branches');
    expect(buildVersionStrip(base).source).toBe('delivery');
  });
});

describe('buildVersionStrip — release channels', () => {
  const policy = recommendedVersioningPolicy({ integrationBranch: 'develop', releaseBranch: 'main' });

  it('shows no channel at all when no policy is declared', () => {
    // A `beta` pill on a project that never chose a channel model would be the
    // header asserting how that project releases, on no evidence.
    for (const pill of buildVersionStrip(base).pills) {
      expect(pill.channel).toBeUndefined();
    }
  });

  it('names the channel each declared branch produces', () => {
    const strip = buildVersionStrip({ ...base, policy });
    const byRef = new Map(strip.pills.map(pill => [pill.ref, pill]));
    expect(byRef.get('develop')?.channel).toMatchObject({ id: 'preview', distTag: 'next' });
    expect(byRef.get('main')?.channel).toMatchObject({ id: 'stable', distTag: 'latest' });
  });

  it('gives the working-tree pill the channel of the branch actually checked out', () => {
    // It carries no `branchRef` by design, so it resolves from `currentBranch`
    // or it would be the one pill that never knows what it is producing.
    const strip = buildVersionStrip({ ...base, policy, stages: [seeded[0]] });
    expect(strip.pills[0].isWorkingTree).toBe(true);
    expect(strip.pills[0].channel?.id).toBe('preview');
  });

  it('leaves a branch no channel matches without one', () => {
    const strip = buildVersionStrip({ ...base, policy, currentBranch: 'feat/9-thing', stages: [seeded[0]] });
    expect(strip.pills[0].channel).toBeUndefined();
  });
});
