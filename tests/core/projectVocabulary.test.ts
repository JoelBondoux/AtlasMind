import { describe, expect, it } from 'vitest';
import {
  collectProjectVocabulary,
  describeDeliveryPipeline,
  hasPromotionIntent,
  matchDeliveryIntent,
  type ProjectVocabularySource,
  type ProjectVocabularyStage,
} from '../../src/core/projectVocabulary.ts';

/**
 * The pipeline this repository actually declares, which is the case the module
 * exists for: the staging stage is *named* `Integration`, so a project that only
 * matched display names would not recognise "promote to staging".
 */
const ATLASMIND_STAGES: ProjectVocabularyStage[] = [
  { name: 'Local', kind: 'local', rank: 0, isProtected: false },
  { name: 'Integration', kind: 'staging', rank: 1, branchRef: 'develop', isProtected: false },
  { name: 'Production', kind: 'production', rank: 2, branchRef: 'main', isProtected: true },
];

const ATLASMIND: ProjectVocabularySource = {
  stages: ATLASMIND_STAGES,
  branches: { integration: 'develop', release: 'main', protected: ['main', 'production'] },
};

describe('hasPromotionIntent', () => {
  it.each([
    'promote to staging',
    'Promote develop to main',
    'ship it',
    'cut a release',
    'deploy the extension',
    'publish the marketplace build',
    'roll out to production',
  ])('recognises %j as pipeline movement', message => {
    expect(hasPromotionIntent(message)).toBe(true);
  });

  it.each([
    'what does the promotion policy say?',
    'explain how merging works',
    'read the changelog',
  ])('does not fire on %j', message => {
    expect(hasPromotionIntent(message)).toBe(false);
  });
});

describe('matchDeliveryIntent', () => {
  it('resolves a stage named by its kind rather than its display name', () => {
    // The regression this module was written for. `staging` appears nowhere in
    // the stage's name; it is the stage's declared kind.
    const match = matchDeliveryIntent('promote to staging', ATLASMIND);

    expect(match).toMatchObject({
      stageName: 'Integration',
      kind: 'staging',
      branchRef: 'develop',
      matchedTerm: 'staging',
      matchedOn: 'kind',
    });
  });

  it('resolves a stage named by its display name or its branch ref', () => {
    expect(matchDeliveryIntent('deploy to Production', ATLASMIND)).toMatchObject({
      stageName: 'Production', matchedOn: 'name', isProtected: true,
    });
    expect(matchDeliveryIntent('promote this to develop', ATLASMIND)).toMatchObject({
      stageName: 'Integration', matchedOn: 'branch', matchedTerm: 'develop',
    });
  });

  it('prefers a name match over a branch match over a kind match', () => {
    const match = matchDeliveryIntent('promote develop to Production', ATLASMIND);

    expect(match?.stageName).toBe('Production');
    expect(match?.matchedOn).toBe('name');
  });

  it('breaks ties on declaration order so the answer cannot shuffle', () => {
    const twins: ProjectVocabularySource = {
      stages: [
        { name: 'EU', kind: 'production', rank: 2, branchRef: 'main' },
        { name: 'US', kind: 'production', rank: 2, branchRef: 'main' },
      ],
    };

    for (let run = 0; run < 5; run++) {
      expect(matchDeliveryIntent('deploy to production', twins)?.stageName).toBe('EU');
    }
  });

  it('matches whole words only', () => {
    // `main` inside `domain` and `prod` inside `reproduce` would send a
    // promotion at a stage the user never named.
    expect(matchDeliveryIntent('explain the domain model', ATLASMIND)).toBeUndefined();
    expect(matchDeliveryIntent('reproduce the bug locally', {
      stages: [{ name: 'Prod', kind: 'production' }],
    })).toBeUndefined();
  });

  it('returns nothing when the project declares no stages', () => {
    expect(matchDeliveryIntent('promote to staging', {})).toBeUndefined();
    expect(matchDeliveryIntent('promote to staging', { stages: [] })).toBeUndefined();
  });

  it('ignores a stage whose declared name is unusable rather than guessing one', () => {
    const corrupt: ProjectVocabularySource = {
      stages: [{ name: '   ', kind: 'staging', branchRef: 'develop' }],
    };

    expect(matchDeliveryIntent('promote to staging', corrupt)).toBeUndefined();
  });

  it('never invents a stage the project did not declare', () => {
    const localOnly: ProjectVocabularySource = { stages: [{ name: 'Local', kind: 'local' }] };

    expect(matchDeliveryIntent('promote to staging', localOnly)).toBeUndefined();
    expect(matchDeliveryIntent('deploy to production', localOnly)).toBeUndefined();
  });
});

describe('collectProjectVocabulary', () => {
  it('collects names, kinds, branch refs and workflow branches, de-duplicated', () => {
    expect(collectProjectVocabulary(ATLASMIND)).toEqual([
      'develop', 'integration', 'local', 'main', 'production', 'staging',
    ]);
  });

  it('is empty for a project that declares nothing', () => {
    expect(collectProjectVocabulary({})).toEqual([]);
  });

  it('drops terms that are too long or carry unexpected characters', () => {
    const odd: ProjectVocabularySource = {
      stages: [
        { name: 'x'.repeat(61), kind: 'staging' },
        { name: 'rm -rf /; echo', kind: 'production' },
      ],
    };

    // The kinds survive; the unusable names do not.
    expect(collectProjectVocabulary(odd)).toEqual(['production', 'staging']);
  });
});

describe('describeDeliveryPipeline', () => {
  it('orders stages by rank and states each branch ref', () => {
    const described = describeDeliveryPipeline(ATLASMIND)!;

    expect(described).toContain('- Local (kind: local, no branch recorded)');
    expect(described).toContain('- Integration (kind: staging, branch `develop`)');
    expect(described).toContain('- Production (kind: production, branch `main`, protected)');
    expect(described.indexOf('Local')).toBeLessThan(described.indexOf('Integration'));
    expect(described.indexOf('Integration')).toBeLessThan(described.indexOf('Production'));
  });

  it('tells the reader that a kind is a valid way to name a stage', () => {
    expect(describeDeliveryPipeline(ATLASMIND)).toContain('"staging" means the stage whose kind is `staging`');
  });

  it('returns undefined rather than an empty heading when nothing is declared', () => {
    // An empty "Delivery pipeline:" heading teaches the model the project has no
    // pipeline, which is a stronger and more wrong claim than silence.
    expect(describeDeliveryPipeline({})).toBeUndefined();
    expect(describeDeliveryPipeline({ stages: [] })).toBeUndefined();
  });

  it('caps the list and states the remainder rather than truncating silently', () => {
    const many: ProjectVocabularySource = {
      stages: Array.from({ length: 11 }, (_unused, index) => ({
        name: `Stage${index}`,
        kind: 'development' as const,
        rank: index,
      })),
    };

    const described = describeDeliveryPipeline(many)!;

    expect(described).toContain('(8 of 11 shown)');
    expect(described).toContain('…and 3 more declared stage(s).');
  });
});
