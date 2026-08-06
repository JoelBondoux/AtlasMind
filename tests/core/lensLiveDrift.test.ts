import { describe, expect, it } from 'vitest';

import { normalizeLensContract } from '../../src/core/lensContract';
import { analyzeLensLiveDrift, pairContract, typesAgree } from '../../src/core/lensLiveDrift';
import type { LensContract, LensServedContract } from '../../src/types';

const OBSERVED_AT = '2026-08-05T10:00:00.000Z';

function field(path: string, dataType = 'string', presence = 'required', nullability = 'non-null') {
  return {
    id: `field:${path}`,
    path,
    label: path,
    dataType,
    presence,
    nullability,
    evidence: { kind: 'declared', source: 'openapi.json' },
  };
}

function declared(fields: unknown[], label = 'Order'): LensContract {
  return normalizeLensContract({
    version: 1,
    id: 'contract:order',
    label,
    layer: 'api',
    sourceKind: 'openapi',
    coverage: 'complete',
    fields,
  })!;
}

function served(
  fields: unknown[],
  overrides: { label?: string; truncated?: boolean; coverage?: string } = {},
): LensServedContract {
  return {
    version: 1,
    endpointId: 'orders-api',
    contracts: [normalizeLensContract({
      version: 1,
      id: 'lens-served:abc',
      label: `${overrides.label ?? 'Order'} (live)`,
      layer: 'api',
      sourceKind: 'openapi',
      coverage: overrides.coverage ?? 'complete',
      fields: fields.map(candidate => ({
        ...(candidate as Record<string, unknown>),
        evidence: { kind: 'runtime', source: 'Served OpenAPI document' },
      })),
    })!],
    observedAt: OBSERVED_AT,
    notices: [],
    truncated: overrides.truncated ?? false,
  };
}

describe('the findings The User asked for', () => {
  it('reports a declared field the service does not serve as a dead end', () => {
    const report = analyzeLensLiveDrift({
      declared: declared([field('id'), field('legacyCode')]),
      served: served([field('id')]),
      outcome: 'reached',
    });
    const absent = report.findings.filter(finding => finding.kind === 'absent-remotely');
    expect(absent).toHaveLength(1);
    expect(absent[0]?.fieldPath).toBe('legacyCode');
    expect(absent[0]?.severity).toBe('error');
    expect(absent[0]?.reason).toContain('dead end');
  });

  it('reports a served field nobody declared, separately', () => {
    // The two need opposite fixes, so they never collapse into "mismatch".
    const report = analyzeLensLiveDrift({
      declared: declared([field('id')]),
      served: served([field('id'), field('shadowFlag')]),
      outcome: 'reached',
    });
    const kinds = report.findings.map(finding => finding.kind);
    expect(kinds).toContain('undeclared-remotely');
    expect(kinds).not.toContain('absent-remotely');
  });

  it('reports a changed type with both shapes shown', () => {
    const report = analyzeLensLiveDrift({
      declared: declared([field('total', 'number')]),
      served: served([field('total', 'string')]),
      outcome: 'reached',
    });
    const finding = report.findings.find(candidate => candidate.kind === 'type-changed');
    expect(finding?.declared).toContain('number');
    expect(finding?.served).toContain('string');
    expect(finding?.severity).toBe('error');
  });

  it('reports a service that may serve null where the code expects a value', () => {
    const report = analyzeLensLiveDrift({
      declared: declared([field('total', 'number', 'required', 'non-null')]),
      served: served([field('total', 'number', 'required', 'nullable')]),
      outcome: 'reached',
    });
    expect(report.findings.find(finding => finding.kind === 'nullability-changed')?.severity).toBe('warning');
  });

  it('does not report the service being stricter than the declaration', () => {
    // Nothing currently running breaks when the service is tighter.
    const report = analyzeLensLiveDrift({
      declared: declared([field('total', 'number', 'optional', 'nullable')]),
      served: served([field('total', 'number', 'required', 'non-null')]),
      outcome: 'reached',
    });
    expect(report.findings.every(finding => finding.kind === 'matched')).toBe(true);
  });

  it('reports a required field the service declares optional', () => {
    const report = analyzeLensLiveDrift({
      declared: declared([field('id', 'string', 'required')]),
      served: served([field('id', 'string', 'optional')]),
      outcome: 'reached',
    });
    expect(report.findings.find(finding => finding.kind === 'presence-changed')?.severity).toBe('warning');
  });
});

describe('a partial reading never manufactures a schema failure', () => {
  it('reports nothing as absent when the served reading was truncated', () => {
    const report = analyzeLensLiveDrift({
      declared: declared([field('id'), field('missingBecauseOfTheCap')]),
      served: served([field('id')], { truncated: true }),
      outcome: 'reached',
    });
    expect(report.findings.some(finding => finding.kind === 'absent-remotely')).toBe(false);
    expect(report.notices.join(' ')).toContain('budget must not');
  });

  it('reports nothing as absent when the served coverage is partial', () => {
    const report = analyzeLensLiveDrift({
      declared: declared([field('id'), field('other')]),
      served: served([field('id')], { coverage: 'partial' }),
      outcome: 'reached',
    });
    expect(report.findings.some(finding => finding.kind === 'absent-remotely')).toBe(false);
  });

  it('still compares the fields the service did serve', () => {
    const report = analyzeLensLiveDrift({
      declared: declared([field('total', 'number'), field('other')]),
      served: served([field('total', 'string')], { truncated: true }),
      outcome: 'reached',
    });
    expect(report.findings.some(finding => finding.kind === 'type-changed')).toBe(true);
  });
});

describe('unassessed is never a clean bill of health', () => {
  it('returns no findings and says so when the probe did not reach', () => {
    for (const outcome of ['unreachable', 'refused', 'unauthorized', 'unassessed'] as const) {
      const report = analyzeLensLiveDrift({
        declared: declared([field('id')]),
        served: served([]),
        outcome,
        outcomeReason: 'The endpoint was refused by policy.',
      });
      expect(report.findings, outcome).toHaveLength(0);
      expect(report.outcome, outcome).toBe(outcome);
      expect(report.notices.join(' '), outcome).toContain('not a healthy one');
    }
  });
});

describe('contract pairing', () => {
  it('pairs on name, ignoring the presentational (live) suffix', () => {
    const pairing = pairContract(declared([field('id')]), served([field('id')]).contracts);
    expect(pairing.matched).toBe(true);
    expect(pairing.matchKind).toBe('exact');
  });

  it('falls back to a case-insensitive pairing and says it did', () => {
    const report = analyzeLensLiveDrift({
      declared: declared([field('id')], 'order'),
      served: served([field('id')], { label: 'Order' }),
      outcome: 'reached',
    });
    expect(report.notices.join(' ')).toContain('ignoring case');
  });

  it('reports an unmatched contract as a pairing problem, not as missing fields', () => {
    // A declared contract with no served counterpart usually means the naming
    // conventions differ, not that several hundred fields vanished.
    const report = analyzeLensLiveDrift({
      declared: declared([field('id'), field('total')], 'Order'),
      served: served([field('id')], { label: 'PurchaseOrder' }),
      outcome: 'reached',
    });
    expect(report.findings).toHaveLength(0);
    expect(report.notices[0]).toContain('served no schema named');
    expect(report.notices[0]).toContain('PurchaseOrder');
  });
});

describe('type agreement', () => {
  it('treats unknown on either side as missing evidence, not a conflict', () => {
    expect(typesAgree('unknown', 'string')).toBe(true);
    expect(typesAgree('string', 'unknown')).toBe(true);
  });

  it('does not equate vocabularies it would have to guess at', () => {
    // A false "these agree" is worse here than a visible finding somebody
    // dismisses.
    expect(typesAgree('varchar', 'string')).toBe(false);
  });

  it('ignores case and surrounding space', () => {
    expect(typesAgree('String', ' string ')).toBe(true);
  });
});
