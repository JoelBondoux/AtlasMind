import { describe, expect, it } from 'vitest';

import {
  extractJsonContractSources,
  extractSqlContractSources,
  extractTypeScriptContractSources,
} from '../../src/core/lensContractSources';

const SOURCE = {
  workspace: { name: 'atlasmind', index: 0 },
  workspacePath: 'contracts/source.txt',
} as const;

describe('AtlasMind Lens contract source adapters', () => {
  it('normalizes OpenAPI component schemas into API contracts with declared field evidence', () => {
    const result = extractJsonContractSources({
      ...SOURCE,
      workspacePath: 'openapi.json',
      text: JSON.stringify({
        openapi: '3.1.0',
        components: {
          schemas: {
            CreateUser: {
              type: 'object',
              required: ['email'],
              properties: {
                email: { type: 'string', format: 'email' },
                age: { type: ['integer', 'null'] },
                account: { $ref: '#/components/schemas/Account' },
              },
            },
          },
        },
      }, null, 2),
    });

    expect(result.notices).toEqual([]);
    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0]).toEqual(expect.objectContaining({
      label: 'CreateUser',
      layer: 'api',
      sourceKind: 'openapi',
      coverage: 'complete',
    }));
    expect(result.contracts[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'email', dataType: 'string', format: 'email', presence: 'required', nullability: 'non-null' }),
      expect.objectContaining({ path: 'age', dataType: 'integer', presence: 'optional', nullability: 'nullable' }),
      expect.objectContaining({ path: 'account', dataType: 'ref:Account', evidence: expect.objectContaining({ kind: 'declared' }) }),
    ]));
  });

  it('extracts SQL CREATE TABLE columns with line-backed targets and conservative partial coverage', () => {
    const result = extractSqlContractSources({
      ...SOURCE,
      workspacePath: 'migrations/001_users.sql',
      text: `CREATE TABLE public.users (
  id UUID PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  age INTEGER NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT users_email_unique UNIQUE (email)
);`,
    });

    expect(result.notices).toEqual(expect.arrayContaining([
      expect.stringContaining('heuristic'),
    ]));
    expect(result.contracts[0]).toEqual(expect.objectContaining({
      label: 'users',
      layer: 'database',
      sourceKind: 'sql',
      coverage: 'partial',
    }));
    expect(result.contracts[0]?.fields.map(field => field.path)).toEqual([
      'id', 'email', 'age', 'is_active', 'created_at',
    ]);
    expect(result.contracts[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'email', dataType: 'string', presence: 'required', nullability: 'non-null' }),
      expect.objectContaining({ path: 'age', dataType: 'integer', presence: 'optional', nullability: 'nullable' }),
      expect.objectContaining({ path: 'created_at', dataType: 'timestamp', target: expect.objectContaining({ range: expect.objectContaining({ startLine: 6 }) }) }),
    ]));
  });

  it('extracts TypeScript interfaces and object type aliases without claiming type resolution', () => {
    const result = extractTypeScriptContractSources({
      ...SOURCE,
      workspacePath: 'src/contracts/create-user.dto.ts',
      text: `export interface CreateUserDto {
  readonly email: string;
  /** Optional legacy age. */
  age?: number | null;
  profile: Profile;
  tags: Array<string>;
}

export type AuditRecord = {
  id: string;
  state: 'new' | 'done';
};`,
    });

    expect(result.notices).toEqual(expect.arrayContaining([expect.stringContaining('syntax-only')]));
    expect(result.contracts).toHaveLength(2);
    expect(result.contracts[0]).toEqual(expect.objectContaining({
      label: 'CreateUserDto',
      layer: 'api',
      sourceKind: 'typescript',
      coverage: 'partial',
    }));
    expect(result.contracts[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'email', dataType: 'string', presence: 'required', nullability: 'non-null' }),
      expect.objectContaining({ path: 'age', dataType: 'number', presence: 'optional', nullability: 'nullable' }),
      expect.objectContaining({ path: 'profile', dataType: 'ref:Profile' }),
      expect.objectContaining({ path: 'tags', dataType: 'array<string>' }),
    ]));
    expect(result.contracts[0]?.fields[1]?.target?.range?.startLine).toBe(4);
    expect(result.contracts[1]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'state', dataType: 'enum' }),
    ]));
  });

  it('returns named evidence gaps for malformed or unsupported documents instead of throwing', () => {
    expect(extractJsonContractSources({ ...SOURCE, text: '{ not-json' })).toEqual({
      contracts: [],
      notices: ['The JSON contract source is malformed and was not inspected.'],
    });
    expect(extractSqlContractSources({ ...SOURCE, text: 'SELECT 1;' })).toEqual({
      contracts: [],
      notices: ['No supported CREATE TABLE declarations were found.'],
    });
    expect(extractTypeScriptContractSources({ ...SOURCE, text: 'export const value = 1;' })).toEqual({
      contracts: [],
      notices: ['No supported top-level TypeScript interface or object type declarations were found.'],
    });
  });
});
