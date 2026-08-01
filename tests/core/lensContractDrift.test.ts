import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  normalizeLensContract,
  normalizeLensContractMappingFile,
  reviewLensContractWiring,
} from '../../src/core/lensContract';
import { analyzeLensContractDrift } from '../../src/core/lensContractDrift';

const fixture = JSON.parse(readFileSync(
  resolve(process.cwd(), 'tests/fixtures/lens-contract-wiring.json'),
  'utf8',
)) as Record<string, unknown>;

describe('AtlasMind Lens contract drift review', () => {
  it('separates definite conflicts, intentional changes, drops, and missing evidence', () => {
    const review = reviewLensContractWiring(
      normalizeLensContract(fixture['upstream'])!,
      normalizeLensContract(fixture['downstream'])!,
      normalizeLensContractMappingFile(fixture['mappingFile'])!,
    );

    const report = analyzeLensContractDrift(review);
    const byWire = new Map(report.findings.map(finding => [finding.wireId, finding]));
    const wire = (path: string) => review.wires.find(candidate => candidate.from?.fieldPath === path);

    expect(byWire.get(wire('age')!.id)).toEqual(expect.objectContaining({
      findingClass: 'definite-conflict',
      severity: 'error',
    }));
    expect(byWire.get(wire('displayName')!.id)).toEqual(expect.objectContaining({
      findingClass: 'intentional-transform',
      severity: 'info',
    }));
    expect(byWire.get(wire('legacyCode')!.id)).toEqual(expect.objectContaining({
      findingClass: 'dropped-wire',
      severity: 'info',
    }));
    expect(byWire.get(wire('mystery')!.id)).toEqual(expect.objectContaining({
      findingClass: 'missing-evidence',
      severity: 'info',
      suppressed: true,
    }));
    expect(report.summary).toEqual(expect.objectContaining({
      errors: 1,
      suppressed: 1,
    }));
    expect(report.notices).toEqual(expect.arrayContaining([expect.stringContaining('not treated as a dropped')]));
  });

  it('calls an unresolved explicit mapping endpoint a dead wire without relabelling ordinary unknowns', () => {
    const upstream = normalizeLensContract(fixture['upstream'])!;
    const downstream = normalizeLensContract(fixture['downstream'])!;
    const mappings = normalizeLensContractMappingFile({
      version: 1,
      mappings: [{
        kind: 'rename',
        upstreamContractId: upstream.id,
        downstreamContractId: downstream.id,
        from: { contractId: upstream.id, fieldPath: 'removedFromCode' },
        to: { contractId: downstream.id, fieldPath: 'email' },
        intentional: true,
      }],
      suppressions: [],
    })!;
    const review = reviewLensContractWiring(upstream, downstream, mappings);
    const report = analyzeLensContractDrift(review);

    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ findingClass: 'dead-wire', severity: 'warning' }),
      expect.objectContaining({ findingClass: 'missing-evidence', severity: 'info' }),
    ]));
  });
});
