import { describe, expect, it } from 'vitest';

import {
  applyReleaseDesignImport,
  discoverReleaseDesignCandidates,
  matchReleaseDesignFeatures,
  parseReleaseDesignDocument,
  releaseDesignRelationshipScore,
} from '../../src/core/releaseMatrixImport.ts';
import {
  emptyReleaseMatrixDocument,
  upsertReleaseMatrixCell,
  upsertReleaseMatrixFeature,
  upsertReleaseMatrixTier,
} from '../../src/core/releaseMatrix.ts';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const DESIGN = `# Product editions

| Feature | Group | Free | Pro |
| --- | --- | --- | --- |
| Cloud sync | Collaboration | Not offered | Released |
| 4K export | Export | 1080p limit | In progress |
`;

describe('release design discovery', () => {
  it('ranks product matrices above unrelated repository documents', () => {
    const candidates = discoverReleaseDesignCandidates([
      { path: 'docs/product-tiers.md', content: DESIGN },
      { path: 'CHANGELOG.md', content: '# Changelog\n\n## 1.0.0\n- Fixed a feature.' },
      { path: 'docs/notes.md', content: 'Meeting notes.' },
    ]);
    expect(candidates[0]).toMatchObject({ path: 'docs/product-tiers.md' });
    expect(candidates.some(candidate => candidate.path === 'CHANGELOG.md')).toBe(false);
  });
});

describe('release design parsing', () => {
  it('extracts offering columns, features, groups, cell decisions and source lines', () => {
    const plan = parseReleaseDesignDocument('docs/product-tiers.md', DESIGN);
    expect(plan.tiers.map(tier => tier.name)).toEqual(['Free', 'Pro']);
    expect(plan.features.map(feature => [feature.name, feature.group])).toEqual([
      ['Cloud sync', 'Collaboration'],
      ['4K export', 'Export'],
    ]);
    expect(plan.cells).toEqual(expect.arrayContaining([
      expect.objectContaining({ featureImportId: 'cloud-sync', tierImportId: 'free', status: 'not-offered' }),
      expect.objectContaining({ featureImportId: 'cloud-sync', tierImportId: 'pro', status: 'released' }),
      expect.objectContaining({ featureImportId: '4k-export', tierImportId: 'free', status: 'planned', parameters: '1080p limit' }),
      expect.objectContaining({ featureImportId: '4k-export', tierImportId: 'pro', status: 'in-progress' }),
    ]));
    expect(plan.features[0]?.sourceLine).toBe(5);
  });

  it('extracts explicit feature lists under named tier headings without mining prose', () => {
    const plan = parseReleaseDesignDocument('docs/plans.md', `# Plans\n\n## Free tier\n- Offline mode\n- [x] Local export\n\n## Pro tier\n- Team sharing: 10 seats\n`);
    expect(plan.tiers.map(tier => tier.name)).toEqual(['Free', 'Pro']);
    expect(plan.features.map(feature => feature.name)).toEqual(['Offline mode', 'Local export', 'Team sharing']);
    expect(plan.cells.find(cell => cell.featureImportId === 'local-export')?.status).toBe('released');
  });

  it('accepts a structured JSON design shape', () => {
    const plan = parseReleaseDesignDocument('design/editions.json', JSON.stringify({
      editions: [{ name: 'Student', pricing: 'Free' }, { name: 'Studio', pricing: '$20/month' }],
      features: [{ name: 'Render queue', group: 'Rendering', availability: { Student: false, Studio: 'ready' } }],
    }));
    expect(plan.format).toBe('structured-json');
    expect(plan.tiers).toHaveLength(2);
    expect(plan.cells.map(cell => cell.status)).toEqual(['not-offered', 'ready']);
  });
});

describe('release design relationship matching', () => {
  it('suggests strong roadmap and Issue matches without matching generic words alone', () => {
    const plan = parseReleaseDesignDocument('docs/product-tiers.md', DESIGN);
    const matches = matchReleaseDesignFeatures(
      plan,
      [{ id: 'roadmap-cloud', text: 'Implement cloud sync', completed: false }],
      [{ number: 42, title: 'Cloud sync across devices', state: 'open' }],
    );
    expect(matches.find(match => match.featureImportId === 'cloud-sync')?.roadmap)
      .toMatchObject({ confidence: 'strong', selectedByDefault: true, target: { id: 'roadmap-cloud' } });
    expect(matches.find(match => match.featureImportId === 'cloud-sync')?.issue)
      .toMatchObject({ confidence: 'strong', selectedByDefault: true, target: { number: 42 } });
    expect(releaseDesignRelationshipScore('Export', 'Support feature requests')).toBeLessThan(0.5);
  });
});

describe('reviewed release design merge', () => {
  it('adds missing data and relationships while preserving an existing cell decision', () => {
    const plan = parseReleaseDesignDocument('docs/product-tiers.md', DESIGN);
    let document = emptyReleaseMatrixDocument(NOW);
    const free = upsertReleaseMatrixTier(document, { name: 'Free', kind: 'tier', status: 'released' }, NOW)!;
    document = free.document;
    const cloud = upsertReleaseMatrixFeature(document, { name: 'Cloud sync', status: 'blocked' }, NOW)!;
    document = cloud.document;
    document = upsertReleaseMatrixCell(document, {
      tierId: free.id,
      featureId: cloud.id,
      status: 'blocked',
      parameters: 'Waiting for storage review',
    }, NOW)!;
    const matches = matchReleaseDesignFeatures(
      plan,
      [{ id: 'roadmap-cloud', text: 'Implement cloud sync', completed: false }],
      [{ number: 42, title: 'Cloud sync across devices', state: 'open' }],
    );
    const result = applyReleaseDesignImport(document, plan, matches, plan.features.map(feature => ({
      featureImportId: feature.importId,
      include: true,
      linkRoadmap: feature.importId === 'cloud-sync',
      linkIssue: feature.importId === 'cloud-sync',
    })), NOW);

    expect(result.addedTiers).toBe(1);
    expect(result.reusedTiers).toBe(1);
    expect(result.addedFeatures).toBe(1);
    expect(result.reusedFeatures).toBe(1);
    expect(result.preservedCells).toBe(1);
    expect(result.document.cells.find(cell => cell.tierId === free.id && cell.featureId === cloud.id))
      .toMatchObject({ status: 'blocked', parameters: 'Waiting for storage review' });
    expect(result.document.features.find(feature => feature.id === cloud.id)).toMatchObject({
      roadmapItemId: 'roadmap-cloud',
      issueNumbers: [42],
      fileLinks: ['docs/product-tiers.md#L5'],
    });
  });
});
