import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LENS_CONTRACT_MAPPING_FILE,
  normalizeLensContract,
  normalizeLensContractMappingFile,
  reviewLensContractWiring,
} from '../../src/core/lensContract';

const fixture = JSON.parse(readFileSync(
  resolve(process.cwd(), 'tests/fixtures/lens-contract-wiring.json'),
  'utf8',
)) as Record<string, unknown>;

describe('AtlasMind Lens contract wiring foundation', () => {
  it('classifies exact, renamed, transformed, dropped, introduced, incompatible, and unverifiable fields', () => {
    const upstream = normalizeLensContract(fixture['upstream']);
    const downstream = normalizeLensContract(fixture['downstream']);
    const mappingFile = normalizeLensContractMappingFile(fixture['mappingFile']);
    expect(upstream).toBeDefined();
    expect(downstream).toBeDefined();
    expect(mappingFile).toBeDefined();

    const review = reviewLensContractWiring(upstream!, downstream!, mappingFile!);
    const byFrom = new Map(review.wires.map(wire => [wire.from?.fieldPath, wire]));
    const byTo = new Map(review.wires.map(wire => [wire.to?.fieldPath, wire]));

    expect(byFrom.get('email')).toEqual(expect.objectContaining({ status: 'exact' }));
    expect(byFrom.get('firstName')).toEqual(expect.objectContaining({
      status: 'transformed',
      mappingKind: 'rename',
      reason: expect.stringContaining('camelCase'),
    }));
    expect(byFrom.get('displayName')).toEqual(expect.objectContaining({ status: 'transformed', mappingKind: 'transform' }));
    expect(byFrom.get('legacyCode')).toEqual(expect.objectContaining({ status: 'dropped', intentional: true }));
    expect(byTo.get('created_at')).toEqual(expect.objectContaining({ status: 'introduced', intentional: true }));
    expect(byFrom.get('age')).toEqual(expect.objectContaining({ status: 'incompatible' }));
    expect(byFrom.get('mystery')).toEqual(expect.objectContaining({ status: 'unverified', suppressed: true }));
    expect(byTo.get('unlinked')).toEqual(expect.objectContaining({ status: 'unverified' }));
  });

  it('normalizes the explicit mapping file as untrusted input and refuses malformed endpoint shapes', () => {
    expect(LENS_CONTRACT_MAPPING_FILE).toBe('.atlasmind/lens-mappings.json');
    expect(normalizeLensContractMappingFile({
      version: 1,
      mappings: [{
        kind: 'drop',
        upstreamContractId: 'api:user',
        downstreamContractId: 'database:users',
        from: { contractId: 'api:user', fieldPath: 'legacy' },
        to: { contractId: 'database:users', fieldPath: 'legacy' },
      }],
      suppressions: [],
    })).toBeUndefined();
    expect(normalizeLensContractMappingFile({
      version: 1,
      mappings: [{
        kind: 'rename',
        upstreamContractId: 'api:user',
        downstreamContractId: 'database:users',
        from: { contractId: 'api:user', fieldPath: 'name' },
      }],
      suppressions: [],
    })).toBeUndefined();
  });

  it('does not turn an unmatched field into a dropped or introduced wire without explicit evidence', () => {
    const upstream = normalizeLensContract(fixture['upstream']);
    const downstream = normalizeLensContract(fixture['downstream']);
    const review = reviewLensContractWiring(upstream!, downstream!, { version: 1, mappings: [], suppressions: [] });

    expect(review.wires.find(wire => wire.from?.fieldPath === 'firstName')?.status).toBe('unverified');
    expect(review.wires.find(wire => wire.to?.fieldPath === 'given_name')?.status).toBe('unverified');
    expect(review.notices).toContain('Unmatched fields remain unverified; absence of a discovered wire is not proof of a drop or introduction.');
  });

  it('scopes drops and introductions to the explicitly named contract boundary', () => {
    const upstream = normalizeLensContract(fixture['upstream']);
    const downstream = normalizeLensContract(fixture['downstream']);
    const mappingFile = normalizeLensContractMappingFile({
      version: 1,
      mappings: [{
        kind: 'drop',
        upstreamContractId: 'api:user-payload',
        downstreamContractId: 'database:archive',
        from: { contractId: 'api:user-payload', fieldPath: 'legacyCode' },
      }],
      suppressions: [],
    });

    const review = reviewLensContractWiring(upstream!, downstream!, mappingFile!);
    expect(review.wires.find(wire => wire.from?.fieldPath === 'legacyCode')?.status).toBe('unverified');
  });
});
