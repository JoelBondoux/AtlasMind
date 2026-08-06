import { describe, expect, it } from 'vitest';

import { analyzeLensReachability } from '../../src/core/lensReachability';
import type { LensEndpointDeclaration, LensProbeResult } from '../../src/types';

function endpoint(overrides: Partial<LensEndpointDeclaration> = {}): LensEndpointDeclaration {
  return {
    id: 'orders-api',
    label: 'Orders API',
    kind: 'http-openapi',
    stage: 'staging',
    url: 'https://api.example.test/openapi.json',
    expectedContractIds: [],
    ...overrides,
  };
}

function result(endpointId: string, outcome: LensProbeResult['outcome']): LensProbeResult {
  return {
    version: 1,
    endpointId,
    outcome,
    reason: `outcome was ${outcome}`,
    observedAt: '2026-08-05T10:00:00.000Z',
  };
}

describe('unassessed is never unreachable', () => {
  it('reports an endpoint with no result as unassessed', () => {
    const map = analyzeLensReachability({
      endpoints: [endpoint()],
      results: new Map(),
      knownContractIds: [],
    });
    expect(map.items[0]?.outcome).toBe('unassessed');
    expect(map.unreachableCount).toBe(0);
    expect(map.unassessedCount).toBe(1);
  });

  it('does not attest to runtime evidence for an endpoint nobody probed', () => {
    const map = analyzeLensReachability({
      endpoints: [endpoint()],
      results: new Map(),
      knownContractIds: [],
    });
    expect(map.items[0]?.evidence.kind).toBe('declared');
  });

  it('counts a refusal as unassessed rather than as a failure', () => {
    // AtlasMind declining to ask says nothing about whether the service is up.
    // Reporting it as unreachable would be a lie about somebody's infrastructure.
    const map = analyzeLensReachability({
      endpoints: [endpoint({ id: 'a' }), endpoint({ id: 'b' })],
      results: new Map([
        ['a', result('a', 'refused')],
        ['b', result('b', 'unauthorized')],
      ]),
      knownContractIds: [],
    });
    expect(map.unreachableCount).toBe(0);
    expect(map.unassessedCount).toBe(2);
  });

  it('keeps refused, unauthorized, and unreachable as distinct outcomes', () => {
    const map = analyzeLensReachability({
      endpoints: [endpoint({ id: 'a' }), endpoint({ id: 'b' }), endpoint({ id: 'c' })],
      results: new Map([
        ['a', result('a', 'refused')],
        ['b', result('b', 'unauthorized')],
        ['c', result('c', 'unreachable')],
      ]),
      knownContractIds: [],
    });
    const outcomes = new Set(map.items.map(item => item.outcome));
    expect(outcomes).toEqual(new Set(['refused', 'unauthorized', 'unreachable']));
  });

  it('says an unassessed endpoint is not a clean result', () => {
    const map = analyzeLensReachability({
      endpoints: [endpoint()],
      results: new Map(),
      knownContractIds: [],
    });
    expect(map.notices.join(' ')).toContain('not a clean result');
  });
});

describe('ranking', () => {
  it('ranks unreachable first and reached last', () => {
    const map = analyzeLensReachability({
      endpoints: [endpoint({ id: 'ok' }), endpoint({ id: 'down' }), endpoint({ id: 'quiet' })],
      results: new Map([
        ['ok', result('ok', 'reached')],
        ['down', result('down', 'unreachable')],
      ]),
      knownContractIds: [],
    });
    expect(map.items.map(item => item.endpointId)).toEqual(['down', 'quiet', 'ok']);
  });

  it('breaks ties on declaration order, so the list cannot shuffle', () => {
    const endpoints = ['a', 'b', 'c'].map(id => endpoint({ id }));
    const first = analyzeLensReachability({ endpoints, results: new Map(), knownContractIds: [] });
    const second = analyzeLensReachability({ endpoints, results: new Map(), knownContractIds: [] });
    expect(first.items.map(item => item.endpointId)).toEqual(second.items.map(item => item.endpointId));
    expect(first.items.map(item => item.endpointId)).toEqual(['a', 'b', 'c']);
  });
});

describe('dangling contract ids', () => {
  it('carries an expected contract the repository no longer has', () => {
    const map = analyzeLensReachability({
      endpoints: [endpoint({ expectedContractIds: ['contract:order', 'contract:deleted'] })],
      results: new Map(),
      knownContractIds: ['contract:order'],
    });
    expect(map.items[0]?.danglingContractIds).toEqual(['contract:deleted']);
    expect(map.notices.join(' ')).toContain('dead end pointing the other way');
  });

  it('reports nothing dangling when every expected contract resolves', () => {
    const map = analyzeLensReachability({
      endpoints: [endpoint({ expectedContractIds: ['contract:order'] })],
      results: new Map(),
      knownContractIds: ['contract:order'],
    });
    expect(map.items[0]?.danglingContractIds).toEqual([]);
  });
});

describe('an empty map', () => {
  it('says nothing was declared rather than showing a clean result', () => {
    const map = analyzeLensReachability({ endpoints: [], results: new Map(), knownContractIds: [] });
    expect(map.items).toHaveLength(0);
    expect(map.notices[0]).toContain('.atlasmind/lens-endpoints.json');
    expect(map.notices.join(' ')).toContain('not that nothing is broken');
  });
});
