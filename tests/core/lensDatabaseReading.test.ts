import { describe, expect, it } from 'vitest';

import { normalizeLensContract } from '../../src/core/lensContract';
import {
  buildDatabaseHealth,
  readConstraints,
  readQueryPlan,
  readRowEstimate,
  readServedContractsFromCatalog,
  readTableMetrics,
  summarizeLatency,
} from '../../src/core/lensDatabaseReading';

const OBSERVED_AT = '2026-08-05T10:00:00.000Z';

const CATALOG_ROWS = [
  { table_name: 'orders', column_name: 'id', data_type: 'uuid', is_nullable: 'NO', has_default: true },
  { table_name: 'orders', column_name: 'total', data_type: 'numeric', is_nullable: 'YES', has_default: false },
  { table_name: 'customers', column_name: 'email', data_type: 'text', is_nullable: 'NO', has_default: false },
];

describe('catalog rows become contracts', () => {
  it('produces one contract per table with bare column paths', () => {
    // Mirrors extractSqlContractSources exactly. The two sides of a drift
    // comparison must be built the same way.
    const served = readServedContractsFromCatalog('db', 'postgres', CATALOG_ROWS, OBSERVED_AT);
    expect(served?.contracts.map(contract => contract.label)).toEqual(['orders (live)', 'customers (live)']);
    expect(served?.contracts[0]?.fields.map(field => field.path)).toEqual(['id', 'total']);
  });

  it('produces contracts the shared normalizer accepts', () => {
    const served = readServedContractsFromCatalog('db', 'postgres', CATALOG_ROWS, OBSERVED_AT);
    for (const contract of served!.contracts) {
      expect(normalizeLensContract(contract)).toBeDefined();
    }
  });

  it('marks a NOT NULL column with a default as optional, not required', () => {
    // A writer may omit it and the database will supply one, so presence is
    // about the declaration rather than about the constraint.
    const served = readServedContractsFromCatalog('db', 'postgres', CATALOG_ROWS, OBSERVED_AT);
    const orders = served!.contracts[0]!;
    expect(orders.fields[0]?.presence).toBe('optional');
    expect(orders.fields[0]?.nullability).toBe('non-null');
    expect(served!.contracts[1]?.fields[0]?.presence).toBe('required');
  });

  it('marks every field as runtime evidence', () => {
    const served = readServedContractsFromCatalog('db', 'postgres', CATALOG_ROWS, OBSERVED_AT);
    for (const contract of served!.contracts) {
      for (const field of contract.fields) {
        expect(field.evidence.kind).toBe('runtime');
      }
    }
  });

  it('says it read the catalog and no application row', () => {
    const served = readServedContractsFromCatalog('db', 'postgres', CATALOG_ROWS, OBSERVED_AT);
    expect(served?.notices.join(' ')).toContain('No application table was queried');
    expect(served?.notices.join(' ')).toContain('read-only transaction');
  });

  it('returns undefined rather than an empty contract set', () => {
    // Empty compared against a declared schema reports every table as missing.
    expect(readServedContractsFromCatalog('db', 'postgres', [], OBSERVED_AT)).toBeUndefined();
    expect(readServedContractsFromCatalog('db', 'postgres', [{ nonsense: 1 }], OBSERVED_AT)).toBeUndefined();
  });

  it('counts rows it could not read instead of guessing', () => {
    const served = readServedContractsFromCatalog('db', 'postgres', [
      ...CATALOG_ROWS,
      { table_name: 'orders' },
      { column_name: 'orphan' },
    ], OBSERVED_AT);
    expect(served?.notices.join(' ')).toContain('2 catalog rows were missing');
  });
});

describe('a never-analyzed table reports unknown, not zero', () => {
  it('reads the Postgres never-analyzed sentinel as unknown', () => {
    // reltuples = -1 means nobody has measured this table. Reporting it as 0
    // would say "this table is empty" to somebody checking whether a migration
    // ran — the most expensive wrong answer this module could give.
    expect(readRowEstimate(-1)).toBeUndefined();
  });

  it('reads a null MySQL TABLE_ROWS as unknown', () => {
    expect(readRowEstimate(null)).toBeUndefined();
    expect(readRowEstimate(undefined)).toBeUndefined();
  });

  it('keeps a genuine zero distinct from unknown', () => {
    expect(readRowEstimate(0)).toBe(0);
  });

  it('reads bigint-as-string, which is how pg returns large counts', () => {
    expect(readRowEstimate('120493')).toBe(120493);
  });

  it('leaves rowEstimate absent on the metric rather than defaulting it', () => {
    const metrics = readTableMetrics([
      { table_name: 'fresh', row_estimate: 42 },
      { table_name: 'never', row_estimate: -1 },
    ]);
    expect(metrics[0]?.rowEstimate).toBe(42);
    expect(metrics[1]).not.toHaveProperty('rowEstimate');
  });

  it('says so in the health notices', () => {
    const health = buildDatabaseHealth({
      endpointId: 'db',
      dialect: 'postgres',
      tables: readTableMetrics([{ table_name: 'never', row_estimate: -1 }]),
      constraints: [],
      truncated: false,
    });
    expect(health.notices.join(' ')).toContain('never been analyzed');
    expect(health.notices.join(' ')).toContain('not the same as empty');
  });

  it('states that counts are estimates rather than a COUNT(*)', () => {
    const health = buildDatabaseHealth({
      endpointId: 'db', dialect: 'postgres', tables: [], constraints: [], truncated: false,
    });
    expect(health.notices.join(' ')).toContain('planner estimates');
    expect(health.notices.join(' ')).toContain('no row of your data was read');
  });
});

describe('timestamps', () => {
  it('reads the epoch sentinel as never, not as 1970', () => {
    // The metrics query COALESCEs to to_timestamp(0) to mean "never".
    const metrics = readTableMetrics([
      { table_name: 't', last_analyzed: new Date(0), last_vacuumed: '1970-01-01T00:00:00.000Z' },
    ]);
    expect(metrics[0]).not.toHaveProperty('lastAnalyzedAt');
    expect(metrics[0]).not.toHaveProperty('lastVacuumedAt');
  });

  it('reads a real timestamp', () => {
    const metrics = readTableMetrics([{ table_name: 't', last_analyzed: '2026-07-01T09:00:00.000Z' }]);
    expect(metrics[0]?.lastAnalyzedAt).toBe('2026-07-01T09:00:00.000Z');
  });
});

describe('constraints', () => {
  it('reads table, name, type and column', () => {
    const constraints = readConstraints([
      { table_name: 'orders', constraint_name: 'orders_pkey', constraint_type: 'PRIMARY KEY', column_name: 'id' },
      { table_name: 'orders', constraint_name: 'orders_customer_fk', constraint_type: 'FOREIGN KEY', column_name: 'customer_id' },
    ]);
    expect(constraints).toHaveLength(2);
    expect(constraints[1]?.constraintType).toBe('FOREIGN KEY');
  });

  it('drops a row with no usable name rather than inventing one', () => {
    expect(readConstraints([{ table_name: 'orders' }])).toEqual([]);
  });
});

describe('latency', () => {
  it('keeps the first sample separate from the rest', () => {
    // On a serverless database the first call is a cold start measured in
    // seconds; an average including it describes neither path.
    const profile = summarizeLatency([1800, 20, 22, 19, 21]);
    expect(profile?.firstMs).toBe(1800);
    expect(profile?.p50Ms).toBeLessThan(100);
    expect(profile?.coldStartSuspected).toBe(true);
  });

  it('does not cry cold start on a uniformly slow connection', () => {
    const profile = summarizeLatency([400, 380, 410, 395, 405]);
    expect(profile?.coldStartSuspected).toBe(false);
  });

  it('does not cry cold start on a fast first call', () => {
    const profile = summarizeLatency([20, 22, 19, 21, 20]);
    expect(profile?.coldStartSuspected).toBe(false);
  });

  it('needs more than one follow-up sample before suspecting anything', () => {
    // One sample cannot distinguish a cold start from a transient stall.
    expect(summarizeLatency([1800, 20])?.coldStartSuspected).toBe(false);
  });

  it('returns undefined when nothing was sampled', () => {
    expect(summarizeLatency([])).toBeUndefined();
  });
});

describe('query plans', () => {
  it('reads a Postgres JSON plan', () => {
    const plan = readQueryPlan('postgres', [{
      'Planning Time': 1.25,
      Plan: { 'Node Type': 'Hash Join', 'Total Cost': 431.2, 'Plan Rows': 900 },
    }]);
    expect(plan.available).toBe(true);
    expect(plan.planningMs).toBe(1.25);
    expect(plan.rootNode).toBe('Hash Join');
  });

  it('reads a MySQL plan delivered as a JSON string', () => {
    const plan = readQueryPlan('mysql', JSON.stringify({ query_block: { select_id: 1, cost_info: { query_cost: '12.5' } } }));
    expect(plan.available).toBe(true);
    expect(plan.estimatedCost).toBe(12.5);
  });

  it('reports an unreadable plan without failing anything', () => {
    // MySQL before 5.7 has no FORMAT=JSON. A schema reading that worked must
    // never be discarded because the plan did not.
    const plan = readQueryPlan('mysql', undefined);
    expect(plan.available).toBe(false);
    expect(plan.unavailableReason).toContain('does not affect the schema reading');
  });

  it('carries the unavailable reason into the health notices', () => {
    const health = buildDatabaseHealth({
      endpointId: 'db',
      dialect: 'mysql',
      tables: [],
      constraints: [],
      plan: readQueryPlan('mysql', undefined),
      truncated: false,
    });
    expect(health.notices.join(' ')).toContain('no readable plan');
  });
});
