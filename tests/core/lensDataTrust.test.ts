import { describe, expect, it } from 'vitest';

import { normalizeLensContract, reviewLensContractWiring } from '../../src/core/lensContract';
import {
  analyzeLensDataTrust,
  normalizeLensDataTrustPolicyFile,
} from '../../src/core/lensDataTrust';
import { createSourceLensTarget } from '../../src/core/lensTarget';

function contract(id: string, label: string, fieldId: string, path: string, layer: 'api' | 'database') {
  const target = createSourceLensTarget({
    kind: 'code-range',
    label: path,
    workspace: { name: 'atlasmind', index: 0 },
    workspacePath: layer === 'api' ? 'openapi.json' : 'schema.sql',
    range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 12 },
  });
  return normalizeLensContract({
    version: 1,
    id,
    label,
    layer,
    sourceKind: layer === 'api' ? 'openapi' : 'sql',
    coverage: 'complete',
    target,
    fields: [{
      id: fieldId,
      path,
      label: path,
      dataType: 'string',
      presence: 'required',
      nullability: 'non-null',
      target,
      evidence: { kind: 'declared', source: 'test contract' },
    }],
  })!;
}

describe('AtlasMind Lens data trust map', () => {
  it('maps explicit classifications and controls across a normalized field wire', () => {
    const upstream = contract('api:user', 'User request', 'api:email', 'email', 'api');
    const downstream = contract('database:users', 'users', 'db:email', 'email', 'database');
    const review = reviewLensContractWiring(upstream, downstream);
    const policy = normalizeLensDataTrustPolicyFile({
      version: 1,
      fields: [
        {
          id: 'api-email',
          contractId: upstream.id,
          fieldPath: 'email',
          classification: 'confidential',
          controls: ['consent', 'authorization', 'redaction'],
          note: 'Customer contact data',
        },
        {
          id: 'db-email',
          contractId: downstream.id,
          fieldPath: 'email',
          classification: 'restricted',
          controls: ['encryption', 'retention', 'residency'],
        },
      ],
    })!;

    const map = analyzeLensDataTrust({
      upstream,
      downstream,
      review,
      policy,
      seedFieldId: 'api:email',
    });

    expect(map.items).toEqual([
      expect.objectContaining({
        status: 'declared',
        classification: 'confidential',
        controls: ['consent', 'authorization', 'redaction'],
        proximity: 0,
      }),
      expect.objectContaining({
        status: 'declared',
        classification: 'restricted',
        controls: ['encryption', 'retention', 'residency'],
        proximity: 1,
      }),
    ]);
    expect(map.items[0]?.target).toEqual(expect.objectContaining({
      kind: 'schema',
      detail: expect.stringContaining('confidential'),
    }));
    expect(map.notices).toEqual(expect.arrayContaining([
      expect.stringContaining('does not infer sensitivity from field names'),
      expect.stringContaining('declarations are policy evidence, not runtime verification'),
    ]));
  });

  it('keeps absent policy as unknown and refuses duplicate field rules', () => {
    const upstream = contract('api:user', 'User request', 'api:email', 'email', 'api');
    const downstream = contract('database:users', 'users', 'db:email', 'email', 'database');
    const review = reviewLensContractWiring(upstream, downstream);
    const empty = normalizeLensDataTrustPolicyFile({ version: 1, fields: [] })!;

    expect(analyzeLensDataTrust({ upstream, downstream, review, policy: empty, seedFieldId: 'api:email' }).items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ status: 'unknown', controls: [] })]));
    const duplicate = {
      id: 'duplicate',
      contractId: upstream.id,
      fieldPath: 'email',
      classification: 'internal',
      controls: [],
    };
    expect(normalizeLensDataTrustPolicyFile({ version: 1, fields: [duplicate, { ...duplicate, id: 'other' }] }))
      .toBeUndefined();
  });
});
