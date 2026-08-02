import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  normalizeLensContract,
  normalizeLensContractMappingFile,
  reviewLensContractWiring,
} from '../../src/core/lensContract';
import { analyzeLensSchemaChangeImpact } from '../../src/core/lensSchemaImpact';

const fixture = JSON.parse(readFileSync(
  resolve(process.cwd(), 'tests/fixtures/lens-contract-wiring.json'),
  'utf8',
)) as Record<string, unknown>;

describe('AtlasMind Lens schema change impact', () => {
  it('ranks a connected database field plus migration and deployment implications for removal', () => {
    const upstream = normalizeLensContract(fixture['upstream'])!;
    const downstream = normalizeLensContract(fixture['downstream'])!;
    const review = reviewLensContractWiring(
      upstream,
      downstream,
      normalizeLensContractMappingFile(fixture['mappingFile'])!,
    );
    const email = upstream.fields.find(field => field.path === 'email')!;

    const impact = analyzeLensSchemaChangeImpact({ upstream, downstream, review, seedFieldId: email.id, changeKind: 'remove' });

    expect(impact.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'users table.email', severity: 'high', proximity: 1 }),
      expect.objectContaining({ label: 'API compatibility review', category: 'contract', severity: 'high' }),
      expect.objectContaining({ label: 'Database migration review', category: 'migration', severity: 'high' }),
      expect.objectContaining({ label: 'Deployment ordering and rollback', category: 'deployment', severity: 'high' }),
    ]));
    expect(impact.notices).toEqual(expect.arrayContaining([expect.stringContaining('Tests, callers')]));
  });

  it('includes declared relationships that touch the proposed field change', () => {
    const upstream = normalizeLensContract(fixture['upstream'])!;
    const downstream = normalizeLensContract(fixture['downstream'])!;
    const review = reviewLensContractWiring(upstream, downstream);
    const email = downstream.fields.find(field => field.path === 'email')!;
    const impact = analyzeLensSchemaChangeImpact({
      upstream,
      downstream,
      review,
      seedFieldId: email.id,
      changeKind: 'rename',
      relations: [{
        id: 'relation:users-account',
        kind: 'foreign-key',
        label: 'users.email → accounts.id',
        from: { contractLabel: downstream.label, contractId: downstream.id, fieldPath: email.path, fieldId: email.id },
        to: { contractLabel: 'accounts', fieldPath: 'id' },
        evidence: { kind: 'declared', source: 'SQL FOREIGN KEY' },
      }],
    });

    expect(impact.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'relationship', label: 'users.email → accounts.id', severity: 'high' }),
    ]));
  });

  it('names absent connectivity as unknown instead of claiming no consumers', () => {
    const upstream = normalizeLensContract(fixture['upstream'])!;
    const downstream = normalizeLensContract(fixture['downstream'])!;
    const review = reviewLensContractWiring(upstream, downstream);
    const mystery = upstream.fields.find(field => field.path === 'mystery')!;

    const impact = analyzeLensSchemaChangeImpact({ upstream, downstream, review, seedFieldId: mystery.id, changeKind: 'type' });

    expect(impact.notices).toEqual(expect.arrayContaining([
      expect.stringContaining('missing evidence, not proof'),
    ]));
    expect(impact.items.find(item => item.label.includes('no consumers'))).toBeUndefined();
  });

  it('refuses a seed field outside the selected normalized contract pair', () => {
    const upstream = normalizeLensContract(fixture['upstream'])!;
    const downstream = normalizeLensContract(fixture['downstream'])!;
    const review = reviewLensContractWiring(upstream, downstream);

    expect(() => analyzeLensSchemaChangeImpact({
      upstream,
      downstream,
      review,
      seedFieldId: 'outside',
      changeKind: 'rename',
    })).toThrow(/seed field/);
  });
});
