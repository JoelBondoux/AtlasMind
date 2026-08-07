import { describe, expect, it } from 'vitest';

import { normalizeLensContract } from '../../src/core/lensContract';
import { analyzeLensLiveTrust } from '../../src/core/lensLiveTrust';
import type { LensDataTrustPolicyFile, LensServedContract } from '../../src/types';

const OBSERVED_AT = '2026-08-05T10:00:00.000Z';

function served(paths: string[], overrides: { truncated?: boolean } = {}): LensServedContract {
  return {
    version: 1,
    endpointId: 'orders-api',
    contracts: [normalizeLensContract({
      version: 1,
      id: 'lens-served:abc',
      label: 'Order (live)',
      layer: 'api',
      sourceKind: 'openapi',
      coverage: 'complete',
      fields: paths.map(path => ({
        id: `served:${path}`,
        path,
        label: path,
        dataType: 'string',
        presence: 'required',
        nullability: 'non-null',
        evidence: { kind: 'runtime', source: 'Served OpenAPI document' },
      })),
    })!],
    observedAt: OBSERVED_AT,
    notices: [],
    truncated: overrides.truncated ?? false,
  };
}

const POLICY: LensDataTrustPolicyFile = {
  version: 1,
  fields: [{
    id: 'rule-1',
    contractId: 'contract:order',
    fieldPath: 'email',
    classification: 'confidential',
    controls: ['encryption', 'redaction'],
  }],
};

describe('the finding this lens exists for', () => {
  it('reports a served field no policy rule classifies', () => {
    const map = analyzeLensLiveTrust({
      served: served(['email', 'internalNotes']),
      policy: POLICY,
      outcome: 'reached',
      expectedContractIds: ['contract:order'],
    });
    const undeclared = map.items.filter(item => item.status === 'served-undeclared');
    expect(undeclared.map(item => item.fieldPath)).toEqual(['internalNotes']);
    expect(map.undeclaredCount).toBe(1);
  });

  it('ranks served-undeclared above everything else', () => {
    const map = analyzeLensLiveTrust({
      served: served(['email', 'internalNotes']),
      policy: POLICY,
      outcome: 'reached',
      expectedContractIds: ['contract:order'],
    });
    expect(map.items[0]?.status).toBe('served-undeclared');
  });

  it('confirms a served field the policy does classify', () => {
    const map = analyzeLensLiveTrust({
      served: served(['email']),
      policy: POLICY,
      outcome: 'reached',
      expectedContractIds: ['contract:order'],
    });
    const confirmed = map.items.find(item => item.status === 'confirmed');
    expect(confirmed?.classification).toBe('confidential');
    expect(confirmed?.controls).toEqual(['encryption', 'redaction']);
  });

  it('never infers a classification from a field name', () => {
    // A fabricated classification closes the gap without closing it, and lands
    // in a git-tracked file where nobody can tell it from a decision.
    const map = analyzeLensLiveTrust({
      served: served(['password', 'ssn', 'creditCardNumber']),
      policy: { version: 1, fields: [] },
      outcome: 'reached',
      expectedContractIds: [],
    });
    expect(map.items.every(item => item.classification === undefined)).toBe(true);
    expect(map.items.every(item => item.status === 'served-undeclared')).toBe(true);
  });

  it('says unknown is not public', () => {
    const map = analyzeLensLiveTrust({
      served: served(['internalNotes']),
      policy: { version: 1, fields: [] },
      outcome: 'reached',
      expectedContractIds: [],
    });
    expect(map.notices.join(' ')).toContain('never proof that data is public');
  });
});

describe('declared-absent', () => {
  it('reports a rule describing something the service no longer serves', () => {
    const map = analyzeLensLiveTrust({
      served: served(['id']),
      policy: POLICY,
      outcome: 'reached',
      expectedContractIds: ['contract:order'],
    });
    expect(map.items.find(item => item.status === 'declared-absent')?.fieldPath).toBe('email');
  });

  it('reports nothing as declared-absent when the reading was partial', () => {
    // Otherwise a budget produces a policy finding that is purely an artefact.
    const map = analyzeLensLiveTrust({
      served: served(['id'], { truncated: true }),
      policy: POLICY,
      outcome: 'reached',
      expectedContractIds: ['contract:order'],
    });
    expect(map.items.some(item => item.status === 'declared-absent')).toBe(false);
    expect(map.notices.join(' ')).toContain('partial');
  });

  it('ignores rules written against a contract this endpoint does not serve', () => {
    const map = analyzeLensLiveTrust({
      served: served(['id']),
      policy: {
        version: 1,
        fields: [{
          id: 'rule-2',
          contractId: 'contract:invoice',
          fieldPath: 'taxId',
          classification: 'restricted',
          controls: [],
        }],
      },
      outcome: 'reached',
      expectedContractIds: ['contract:order'],
    });
    expect(map.items.some(item => item.fieldPath === 'taxId')).toBe(false);
  });
});

describe('unassessed', () => {
  it('returns no items and no verdict when the probe did not reach', () => {
    for (const outcome of ['unreachable', 'refused', 'unauthorized', 'unassessed'] as const) {
      const map = analyzeLensLiveTrust({
        served: served([]),
        policy: POLICY,
        outcome,
        expectedContractIds: ['contract:order'],
        outcomeReason: 'It was refused.',
      });
      expect(map.items, outcome).toHaveLength(0);
      expect(map.undeclaredCount, outcome).toBe(0);
      expect(map.notices.join(' '), outcome).toContain('not a finding that everything is classified');
    }
  });
});
