import { describe, expect, it } from 'vitest';

import { normalizeLensContract } from '../../src/core/lensContract';
import {
  DISCARDED_VALUE_KEYS,
  deriveServedContractFromGraphql,
  deriveServedContractFromMcpSchema,
  deriveServedContractFromOpenApi,
  LENS_SERVED_MAX_CONTRACTS,
  LENS_SERVED_MAX_FIELDS_PER_CONTRACT,
} from '../../src/core/lensServedContract';

const OBSERVED_AT = '2026-08-05T10:00:00.000Z';

const OPENAPI = {
  openapi: '3.0.0',
  components: {
    schemas: {
      Order: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', example: 'ord_9f2c-REAL-CUSTOMER-ID' },
          total: { type: 'number', nullable: true },
          lines: { type: 'array', items: { type: 'string' } },
          customer: {
            type: 'object',
            properties: { email: { type: 'string', default: 'someone@real.test' } },
          },
        },
      },
    },
  },
};

describe('OpenAPI derivation', () => {
  it('produces one contract per served schema, with bare field paths', () => {
    // Mirrors extractJsonContractSources exactly. The two sides of a drift
    // comparison must be built the same way or every field mismatches on its
    // name alone.
    const served = deriveServedContractFromOpenApi('orders-api', OPENAPI, OBSERVED_AT);
    expect(served?.contracts).toHaveLength(1);
    const paths = served!.contracts[0]!.fields.map(field => field.path);
    expect(paths).toContain('id');
    expect(paths).toContain('total');
    expect(paths).toContain('customer.email');
  });

  it('reads shape and discards every value-bearing key', () => {
    const served = deriveServedContractFromOpenApi('orders-api', OPENAPI, OBSERVED_AT);
    const serialized = JSON.stringify(served);
    expect(serialized).not.toContain('REAL-CUSTOMER-ID');
    expect(serialized).not.toContain('someone@real.test');
    for (const key of DISCARDED_VALUE_KEYS) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });

  it('carries type, presence, and nullability', () => {
    const served = deriveServedContractFromOpenApi('orders-api', OPENAPI, OBSERVED_AT);
    const byPath = new Map(served!.contracts[0]!.fields.map(field => [field.path, field]));
    expect(byPath.get('id')?.dataType).toBe('string/uuid');
    expect(byPath.get('id')?.presence).toBe('required');
    expect(byPath.get('total')?.nullability).toBe('nullable');
    expect(byPath.get('total')?.presence).toBe('optional');
    expect(byPath.get('lines')?.dataType).toBe('array<string>');
  });

  it('marks every field as runtime evidence, never as a file', () => {
    const served = deriveServedContractFromOpenApi('orders-api', OPENAPI, OBSERVED_AT);
    for (const field of served!.contracts[0]!.fields) {
      expect(field.evidence.kind).toBe('runtime');
    }
  });

  it('produces contracts the shared normalizer accepts', () => {
    const served = deriveServedContractFromOpenApi('orders-api', OPENAPI, OBSERVED_AT);
    for (const contract of served!.contracts) {
      expect(normalizeLensContract(contract)).toBeDefined();
    }
  });

  it('reads Swagger 2 root definitions as well as OpenAPI 3 components', () => {
    const served = deriveServedContractFromOpenApi('orders-api', {
      swagger: '2.0',
      definitions: { Order: { type: 'object', properties: { id: { type: 'string' } } } },
    }, OBSERVED_AT);
    expect(served?.contracts[0]?.fields[0]?.path).toBe('id');
  });

  it('returns undefined rather than an empty contract when nothing is readable', () => {
    // Unreadable is not empty: an empty contract compared against a declared one
    // reports every field as missing.
    expect(deriveServedContractFromOpenApi('orders-api', { openapi: '3.0.0' }, OBSERVED_AT)).toBeUndefined();
    expect(deriveServedContractFromOpenApi('orders-api', 'not an object', OBSERVED_AT)).toBeUndefined();
    expect(deriveServedContractFromOpenApi('orders-api', null, OBSERVED_AT)).toBeUndefined();
  });

  it('marks a reading that hit the field budget as partial', () => {
    const properties: Record<string, unknown> = {};
    for (let index = 0; index <= LENS_SERVED_MAX_FIELDS_PER_CONTRACT + 10; index += 1) {
      properties[`field_${index}`] = { type: 'string' };
    }
    const served = deriveServedContractFromOpenApi('orders-api', {
      openapi: '3.0.0',
      components: { schemas: { Big: { type: 'object', properties } } },
    }, OBSERVED_AT);
    expect(served?.truncated).toBe(true);
    expect(served?.contracts[0]?.coverage).toBe('partial');
    expect(served?.notices.join(' ')).toContain('not reported as missing');
  });

  it('keeps two schemas that share a name rather than dropping the second', () => {
    const schemas: Record<string, unknown> = {};
    for (let index = 0; index < LENS_SERVED_MAX_CONTRACTS + 5; index += 1) {
      schemas[`Schema${index}`] = { type: 'object', properties: { id: { type: 'string' } } };
    }
    const served = deriveServedContractFromOpenApi('orders-api', {
      openapi: '3.0.0',
      components: { schemas },
    }, OBSERVED_AT);
    expect(served?.contracts.length).toBe(LENS_SERVED_MAX_CONTRACTS);
    expect(served?.truncated).toBe(true);
  });
});

describe('GraphQL derivation', () => {
  const INTROSPECTION = {
    data: {
      __schema: {
        types: [
          {
            name: 'Order',
            kind: 'OBJECT',
            fields: [
              { name: 'id', type: { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'ID' } } },
              { name: 'total', type: { kind: 'SCALAR', name: 'Float' } },
              {
                name: 'lines',
                type: { kind: 'LIST', name: null, ofType: { kind: 'SCALAR', name: 'String' } },
              },
            ],
          },
          { name: '__Type', kind: 'OBJECT', fields: [{ name: 'name', type: { kind: 'SCALAR', name: 'String' } }] },
        ],
      },
    },
  };

  it('reads types and unwraps NON_NULL and LIST', () => {
    const served = deriveServedContractFromGraphql('gql', INTROSPECTION, OBSERVED_AT);
    const byPath = new Map(served!.contracts[0]!.fields.map(field => [field.path, field]));
    expect(byPath.get('id')?.dataType).toBe('ID');
    expect(byPath.get('id')?.nullability).toBe('non-null');
    expect(byPath.get('id')?.presence).toBe('required');
    expect(byPath.get('lines')?.dataType).toBe('array<String>');
  });

  it('skips introspection meta-types', () => {
    // Including them would drift every GraphQL endpoint against every declared
    // contract by about forty fields.
    const served = deriveServedContractFromGraphql('gql', INTROSPECTION, OBSERVED_AT);
    expect(served?.contracts.map(contract => contract.label)).toEqual(['Order (live)']);
  });

  it('returns undefined for a response that is not an introspection result', () => {
    expect(deriveServedContractFromGraphql('gql', { data: {} }, OBSERVED_AT)).toBeUndefined();
    expect(deriveServedContractFromGraphql('gql', { errors: [{ message: 'nope' }] }, OBSERVED_AT)).toBeUndefined();
  });
});

describe('MCP schema derivation', () => {
  it('reads tables and columns across the spellings that occur', () => {
    const served = deriveServedContractFromMcpSchema('db', {
      tables: [
        {
          table_name: 'orders',
          columns: [
            { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
            { column_name: 'total', data_type: 'numeric', is_nullable: 'YES' },
          ],
        },
      ],
    }, OBSERVED_AT);
    const fields = served!.contracts[0]!.fields;
    expect(served?.contracts[0]?.label).toBe('orders (live)');
    expect(fields.map(field => field.path)).toEqual(['id', 'total']);
    expect(fields[0]?.nullability).toBe('non-null');
    expect(fields[1]?.nullability).toBe('nullable');
  });

  it('inverts SQLite notnull rather than folding it in with the others', () => {
    // Folding it in would report every non-null column as nullable — silently,
    // and in the direction that hides a constraint.
    const served = deriveServedContractFromMcpSchema('db', [
      { name: 'orders', columns: [{ name: 'id', type: 'TEXT', notnull: 1 }, { name: 'note', type: 'TEXT', notnull: 0 }] },
    ], OBSERVED_AT);
    const fields = served!.contracts[0]!.fields;
    expect(fields[0]?.nullability).toBe('non-null');
    expect(fields[1]?.nullability).toBe('nullable');
  });

  it('records a table with no readable columns rather than inventing them', () => {
    const served = deriveServedContractFromMcpSchema('db', { tables: [{ name: 'orders' }] }, OBSERVED_AT);
    expect(served?.contracts[0]?.fields).toHaveLength(1);
    expect(served?.contracts[0]?.fields[0]?.path).toBe('(shape unknown)');
  });

  it('counts entries it could not interpret instead of guessing', () => {
    const served = deriveServedContractFromMcpSchema('db', {
      tables: [
        { name: 'orders', columns: [{ name: 'id', type: 'uuid' }] },
        'a string where a table should be',
        { no_recognisable_name: true },
      ],
    }, OBSERVED_AT);
    expect(served?.notices.join(' ')).toContain('2 entries were in a shape this reader does not recognise');
  });

  it('never carries a row into the output', () => {
    const served = deriveServedContractFromMcpSchema('db', {
      rows: [{ name: 'orders', columns: [{ name: 'email', type: 'text', sample: 'real@customer.test' }] }],
    }, OBSERVED_AT);
    expect(JSON.stringify(served)).not.toContain('real@customer.test');
  });

  it('returns undefined when nothing table-shaped can be found', () => {
    expect(deriveServedContractFromMcpSchema('db', { message: 'ok' }, OBSERVED_AT)).toBeUndefined();
  });
});
