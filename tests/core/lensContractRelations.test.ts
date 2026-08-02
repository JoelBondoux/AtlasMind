import { describe, expect, it } from 'vitest';

import { normalizeLensContract } from '../../src/core/lensContract';
import {
  normalizeLensContractRelations,
  resolveLensContractRelations,
} from '../../src/core/lensContractRelations';
import { createSourceLensTarget } from '../../src/core/lensTarget';

const workspace = { name: 'atlasmind', index: 0 };
const target = createSourceLensTarget({ kind: 'file', label: 'users', workspace, workspacePath: 'schema.sql' });

function contract(id: string, label: string, fieldId: string, path: string) {
  return normalizeLensContract({
    version: 1,
    id,
    label,
    layer: 'database',
    sourceKind: 'sql',
    coverage: 'partial',
    target,
    fields: [{
      id: fieldId,
      path,
      label: path,
      dataType: 'integer',
      presence: 'required',
      nullability: 'non-null',
      target,
      evidence: { kind: 'declared', source: 'test' },
    }],
  })!;
}

describe('AtlasMind Lens contract relationships', () => {
  it('normalizes untrusted relation records and resolves unique same-root endpoints', () => {
    const users = contract('db:users', 'users', 'field:user-account', 'account_id');
    const accounts = contract('db:accounts', 'accounts', 'field:account-id', 'id');
    const resolved = resolveLensContractRelations([{
      id: 'relation:users-account',
      kind: 'foreign-key',
      label: 'users.account_id → accounts.id',
      from: { contractLabel: 'users', fieldPath: 'account_id', contractId: users.id, fieldId: users.fields[0]!.id },
      to: { contractLabel: 'accounts', fieldPath: 'id' },
      target,
      evidence: { kind: 'declared', source: 'SQL FOREIGN KEY', confidence: 1 },
    }], [users, accounts]);

    expect(resolved).toEqual([
      expect.objectContaining({
        from: expect.objectContaining({ contractId: 'db:users', fieldId: 'field:user-account' }),
        to: expect.objectContaining({ contractId: 'db:accounts', fieldId: 'field:account-id' }),
      }),
    ]);
  });

  it('keeps an unresolved endpoint visible and refuses malformed records', () => {
    const users = contract('db:users', 'users', 'field:user-account', 'account_id');
    const unresolved = resolveLensContractRelations([{
      id: 'relation:unknown',
      kind: 'foreign-key',
      label: 'users.account_id → missing.id',
      from: { contractLabel: 'users', fieldPath: 'account_id', contractId: users.id },
      to: { contractLabel: 'missing', fieldPath: 'id' },
      target,
      evidence: { kind: 'declared', source: 'SQL FOREIGN KEY' },
    }], [users]);
    expect(unresolved?.[0]?.to).toEqual({ contractLabel: 'missing', fieldPath: 'id' });
    expect(normalizeLensContractRelations([{ id: '', kind: 'foreign-key' }])).toBeUndefined();
  });
});
