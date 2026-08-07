import { describe, expect, it } from 'vitest';

import {
  ALL_STATEMENTS,
  CONSTRAINT_QUERY,
  EXPLAIN_SCHEMA_QUERY,
  FORBIDDEN_SQL_VERBS,
  isSingleStatement,
  METRICS_QUERY,
  PING_QUERY,
  READ_ONLY_EPILOGUE,
  READ_ONLY_PREAMBLE,
  SCHEMA_QUERY,
} from '../../src/core/lensDatabaseDialect';

describe('AtlasMind never composes SQL — it sends a constant', () => {
  it('carries no write verb in any statement it can emit', () => {
    // The rule the direct-database transport rests on. If somebody adds DELETE
    // to this file, this test is what stops it shipping.
    for (const statement of ALL_STATEMENTS) {
      const lower = statement.toLowerCase();
      for (const verb of FORBIDDEN_SQL_VERBS) {
        const pattern = new RegExp(`(^|[^a-z0-9_])${verb}([^a-z0-9_]|$)`);
        expect(pattern.test(lower), `\`${verb}\` appears in: ${statement.trim().slice(0, 80)}`).toBe(false);
      }
    }
  });

  it('has no placeholder, parameter, or template hole anywhere', () => {
    // A constant with a hole is not a constant. Checked on the evaluated
    // strings, so the fact that EXPLAIN embeds SCHEMA_QUERY at module load is
    // irrelevant — what matters is what would go on the wire.
    for (const statement of ALL_STATEMENTS) {
      expect(statement).not.toContain('${');
      expect(statement).not.toMatch(/\$\d/);
      expect(statement).not.toMatch(/[^:]:[a-z_]+\b/i);
      expect(statement).not.toContain('%s');
      expect(statement).not.toContain('?');
    }
  });

  it('emits one statement at a time', () => {
    for (const statement of ALL_STATEMENTS) {
      expect(isSingleStatement(statement), statement.trim().slice(0, 60)).toBe(true);
    }
  });

  it('detects a smuggled second statement', () => {
    expect(isSingleStatement('SELECT 1; DROP TABLE users')).toBe(false);
    expect(isSingleStatement('SELECT 1;')).toBe(true);
    // A semicolon inside a string literal is not a statement separator.
    expect(isSingleStatement("SELECT 'a;b'")).toBe(true);
  });
});

describe('the read-only guard', () => {
  it('opens a read-only transaction for every dialect', () => {
    expect(READ_ONLY_PREAMBLE.postgres.join(' ')).toContain('BEGIN READ ONLY');
    expect(READ_ONLY_PREAMBLE.mysql.join(' ')).toContain('START TRANSACTION READ ONLY');
  });

  it('sets a statement timeout before opening the transaction', () => {
    // Order matters: a timeout set inside a transaction that already hung is
    // a timeout nobody benefits from.
    const postgres = READ_ONLY_PREAMBLE.postgres;
    expect(postgres.findIndex(s => s.includes('statement_timeout')))
      .toBeLessThan(postgres.findIndex(s => s.includes('BEGIN')));
  });

  it('ends with a rollback rather than a commit', () => {
    for (const dialect of ['postgres', 'mysql'] as const) {
      expect(READ_ONLY_EPILOGUE[dialect]).toEqual(['ROLLBACK']);
    }
  });
});

describe('what the constants ask for', () => {
  it('reads only the catalog, never an application table', () => {
    for (const dialect of ['postgres', 'mysql'] as const) {
      expect(SCHEMA_QUERY[dialect].toLowerCase()).toContain('information_schema');
      expect(CONSTRAINT_QUERY[dialect].toLowerCase()).toContain('information_schema');
    }
    expect(METRICS_QUERY.postgres.toLowerCase()).toContain('pg_class');
    expect(METRICS_QUERY.mysql.toLowerCase()).toContain('information_schema');
  });

  it('takes row estimates from the catalog, never from a COUNT over a user table', () => {
    // "AtlasMind never reads a row" should be literally true rather than nearly
    // true: a COUNT(*) returns only a number, but it reads every row to produce
    // it. So the row estimate comes from planner statistics the database
    // already maintains.
    expect(METRICS_QUERY.postgres.toLowerCase()).toContain('reltuples');
    expect(METRICS_QUERY.mysql.toLowerCase()).toContain('table_rows');
  });

  it('aggregates only over catalog relations, never over a user table', () => {
    // Counting the indexes on a relation is catalog metadata and is fine.
    // Counting rows *in* a user table is not. This asserts which of the two
    // every aggregate in the file is, rather than banning the word.
    const catalogRelations = [
      'pg_index', 'pg_class', 'pg_namespace', 'pg_stat_user_tables',
      'information_schema.statistics', 'information_schema.columns',
      'information_schema.tables', 'information_schema.table_constraints',
      'information_schema.key_column_usage',
    ];
    for (const dialect of ['postgres', 'mysql'] as const) {
      const sql = METRICS_QUERY[dialect].toLowerCase();
      // Every `count(` must be inside a subquery whose FROM names a catalog
      // relation. Walk forward from each occurrence to the next `from`.
      let index = sql.indexOf('count(');
      while (index !== -1) {
        const fromIndex = sql.indexOf('from', index);
        expect(fromIndex, `${dialect}: an aggregate with no FROM`).toBeGreaterThan(-1);
        const target = sql.slice(fromIndex + 4, fromIndex + 60).trim();
        expect(
          catalogRelations.some(relation => target.startsWith(relation)),
          `${dialect}: aggregate reads \`${target.split(/\s/)[0]}\`, which is not a catalog relation`,
        ).toBe(true);
        index = sql.indexOf('count(', index + 1);
      }
    }
  });

  it('excludes the system schemas', () => {
    // Including pg_catalog would drift every Postgres endpoint against every
    // declared contract by several hundred system tables.
    expect(SCHEMA_QUERY.postgres).toContain("'pg_catalog'");
    expect(METRICS_QUERY.postgres).toContain("'pg_catalog'");
    expect(SCHEMA_QUERY.mysql).toContain('DATABASE()');
  });

  it('reads whether a default exists, never the default itself', () => {
    // A default is an expression that is sometimes a literal, and a literal
    // default is a value.
    expect(SCHEMA_QUERY.postgres).toContain('column_default IS NOT NULL');
    expect(SCHEMA_QUERY.mysql).toContain('COLUMN_DEFAULT IS NOT NULL');
  });

  it('bounds every catalog read', () => {
    for (const query of [
      ...Object.values(SCHEMA_QUERY),
      ...Object.values(CONSTRAINT_QUERY),
      ...Object.values(METRICS_QUERY),
    ]) {
      expect(query.toUpperCase()).toContain('LIMIT');
    }
  });

  it('explains without analyzing', () => {
    // EXPLAIN ANALYZE would execute the statement. However harmless this one
    // is, a probe that executes whatever it explains is a shape nobody should
    // build.
    for (const dialect of ['postgres', 'mysql'] as const) {
      expect(EXPLAIN_SCHEMA_QUERY[dialect].toUpperCase()).toContain('EXPLAIN');
      expect(EXPLAIN_SCHEMA_QUERY[dialect].toUpperCase()).not.toContain('EXPLAIN ANALYZE');
      expect(EXPLAIN_SCHEMA_QUERY[dialect].toUpperCase()).not.toContain('ANALYZE)');
    }
  });

  it('pings with something that touches no table', () => {
    for (const dialect of ['postgres', 'mysql'] as const) {
      expect(PING_QUERY[dialect]).toBe('SELECT 1');
    }
  });
});
