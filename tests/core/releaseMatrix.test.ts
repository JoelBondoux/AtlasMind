import { describe, expect, it } from 'vitest';

import {
  buildReleaseMatrixSnapshot,
  emptyReleaseMatrixDocument,
  interpretReleaseMatrixDocument,
  normalizeReleaseMatrixFileLink,
  parseReleaseMatrixEntityKey,
  removeReleaseMatrixTier,
  setReleaseMatrixFeatureIssueLinks,
  setReleaseMatrixRoadmapLink,
  upsertReleaseMatrixCell,
  upsertReleaseMatrixFeature,
  upsertReleaseMatrixTier,
} from '../../src/core/releaseMatrix.ts';

const NOW = new Date('2026-09-17T12:00:00.000Z');

function populated() {
  let document = emptyReleaseMatrixDocument(NOW);
  const free = upsertReleaseMatrixTier(document, {
    name: 'Free', kind: 'tier', status: 'planned', pricing: 'Free', fileLinks: ['docs/tiers.md#L12'],
  }, NOW)!;
  document = free.document;
  const pro = upsertReleaseMatrixTier(document, {
    name: 'Pro', kind: 'tier', status: 'planned', pricing: '£12 / month',
  }, NOW)!;
  document = pro.document;
  const exportFeature = upsertReleaseMatrixFeature(document, {
    name: '4K export', group: 'Export', status: 'in-progress', fileLinks: ['src/export.ts'],
  }, NOW)!;
  document = exportFeature.document;
  return { document, freeId: free.id, proId: pro.id, featureId: exportFeature.id };
}

describe('release matrix document boundary', () => {
  it('keeps workspace links relative and preserves line anchors', () => {
    expect(normalizeReleaseMatrixFileLink('docs/tiers.md#L12')).toBe('docs/tiers.md#L12');
    expect(normalizeReleaseMatrixFileLink('./src/feature.ts')).toBe('src/feature.ts');
    expect(normalizeReleaseMatrixFileLink('../secret.txt')).toBeUndefined();
    expect(normalizeReleaseMatrixFileLink('C:\\secret.txt')).toBeUndefined();
    expect(normalizeReleaseMatrixFileLink('https://example.com/file')).toBeUndefined();
  });

  it('refuses a future schema instead of coercing it into v1', () => {
    expect(interpretReleaseMatrixDocument({ version: 2, tiers: [], features: [], cells: [] }))
      .toMatchObject({ kind: 'refused' });
  });

  it('drops duplicate ids, orphan cells, traversal links and unsupported statuses', () => {
    const reading = interpretReleaseMatrixDocument({
      version: 1,
      updatedAt: NOW.toISOString(),
      tiers: [
        { id: 'pro', name: 'Pro', kind: 'tier', status: 'released', fileLinks: ['docs/pro.md', '../nope'] },
        { id: 'pro', name: 'Duplicate', kind: 'dlc', status: 'planned' },
      ],
      features: [{ id: 'sync', name: 'Sync', status: 'made-up' }],
      cells: [
        { tierId: 'pro', featureId: 'sync', status: 'ready' },
        { tierId: 'missing', featureId: 'sync', status: 'ready' },
      ],
    });
    expect(reading.kind).toBe('ok');
    if (reading.kind !== 'ok') return;
    expect(reading.document.tiers).toHaveLength(1);
    expect(reading.document.tiers[0]?.fileLinks).toEqual(['docs/pro.md']);
    expect(reading.document.features[0]?.status).toBe('planned');
    expect(reading.document.cells).toHaveLength(1);
  });
});

describe('release matrix decisions', () => {
  it('distinguishes an unknown cell from an explicit not-offered decision', () => {
    const initial = populated();
    const oneDecision = upsertReleaseMatrixCell(initial.document, {
      tierId: initial.freeId,
      featureId: initial.featureId,
      status: 'not-offered',
      parameters: 'Paid upgrade only',
    }, NOW)!;
    const snapshot = buildReleaseMatrixSnapshot(oneDecision);

    expect(snapshot.totalCellCount).toBe(2);
    expect(snapshot.decidedCellCount).toBe(1);
    expect(snapshot.unknownCellCount).toBe(1);
    expect(snapshot.statusCounts['not-offered']).toBe(1);
    expect(snapshot.offeredCellCount).toBe(0);
    expect(snapshot.decisionCoveragePercent).toBe(50);
  });

  it('reports readiness per offering without treating exclusions as unfinished work', () => {
    const initial = populated();
    let document = upsertReleaseMatrixCell(initial.document, {
      tierId: initial.freeId, featureId: initial.featureId, status: 'not-offered',
    }, NOW)!;
    document = upsertReleaseMatrixCell(document, {
      tierId: initial.proId, featureId: initial.featureId, status: 'ready', parameters: 'Up to 4K',
    }, NOW)!;
    const snapshot = buildReleaseMatrixSnapshot(document);
    expect(snapshot.tierMetrics.find(metric => metric.tierId === initial.freeId)).toMatchObject({
      decidedCount: 1, offeredCount: 0, readyCount: 0,
    });
    expect(snapshot.tierMetrics.find(metric => metric.tierId === initial.proId)).toMatchObject({
      decidedCount: 1, offeredCount: 1, readyCount: 1, readinessPercent: 100,
    });
  });

  it('removing an offering cascades only its cells and leaves features intact', () => {
    const initial = populated();
    const withCell = upsertReleaseMatrixCell(initial.document, {
      tierId: initial.freeId, featureId: initial.featureId, status: 'planned',
    }, NOW)!;
    const removed = removeReleaseMatrixTier(withCell, initial.freeId, NOW)!;
    expect(removed.tiers.map(tier => tier.id)).toEqual([initial.proId]);
    expect(removed.features.map(feature => feature.id)).toEqual([initial.featureId]);
    expect(removed.cells).toEqual([]);
  });
});

describe('release matrix roadmap relationships', () => {
  it('parses only closed entity keys', () => {
    expect(parseReleaseMatrixEntityKey('tier:pro')).toEqual({ kind: 'tier', tierId: 'pro' });
    expect(parseReleaseMatrixEntityKey('feature:cloud-sync')).toEqual({ kind: 'feature', featureId: 'cloud-sync' });
    expect(parseReleaseMatrixEntityKey('cell:cloud-sync:pro')).toEqual({ kind: 'cell', featureId: 'cloud-sync', tierId: 'pro' });
    expect(parseReleaseMatrixEntityKey('cell:../../secret:pro')).toBeUndefined();
  });

  it('shows open, complete and missing links without inventing completion', () => {
    const initial = populated();
    let document = setReleaseMatrixRoadmapLink(
      initial.document,
      { kind: 'feature', featureId: initial.featureId },
      'roadmap-export',
      NOW,
    )!;
    document = setReleaseMatrixRoadmapLink(
      document,
      { kind: 'tier', tierId: initial.proId },
      'roadmap-missing',
      NOW,
    )!;
    const snapshot = buildReleaseMatrixSnapshot(document, [
      { id: 'roadmap-export', text: 'Feature: 4K export', completed: false },
    ]);
    expect(snapshot.roadmapLinks[`feature:${initial.featureId}`]?.state).toBe('linked-open');
    expect(snapshot.roadmapLinks[`tier:${initial.proId}`]?.state).toBe('missing');
    expect(snapshot.roadmappedCount).toBe(1);
  });

  it('keeps Issue relationships explicit when the tracker has not been read', () => {
    const initial = populated();
    const document = setReleaseMatrixFeatureIssueLinks(initial.document, initial.featureId, [42, 43], NOW)!;
    const unassessed = buildReleaseMatrixSnapshot(document);
    expect(unassessed.issueLinks[`feature:${initial.featureId}`]).toEqual([
      { number: 42, state: 'not-assessed' },
      { number: 43, state: 'not-assessed' },
    ]);
    const assessed = buildReleaseMatrixSnapshot(document, [], [
      { number: 42, title: 'Export quality', state: 'open' },
    ]);
    expect(assessed.issueLinks[`feature:${initial.featureId}`]).toEqual([
      { number: 42, title: 'Export quality', state: 'linked-open' },
      { number: 43, state: 'missing' },
    ]);
  });
});
