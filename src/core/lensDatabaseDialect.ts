/**
 * Every SQL statement AtlasMind can send, as constants, in one file.
 *
 * The live lenses previously reached a database only through a connected MCP
 * server, and `lensProbePolicy` refused a generic query tool with "AtlasMind
 * will not compose SQL". Most managed databases — Neon, RDS, Railway, Render,
 * self-hosted — have no MCP server, so that refusal amounted to telling the
 * majority of users to go and install one. This file is the honest version of
 * the rule that replaces it:
 *
 * **AtlasMind never *composes* SQL. It sends a *constant*.**
 *
 * That is the same guarantee `GRAPHQL_INTROSPECTION_QUERY` already carries, and
 * it is enforced the same way: every statement below is a module-level `const`
 * with no interpolation, no parameters, and no code path that accepts a
 * fragment from a caller, a setting, a webview, or a model. A test walks these
 * exports and fails on a write verb, a placeholder, or a template hole. The MCP
 * refusal still stands on its own reasoning — with somebody else's tool we
 * cannot guarantee what it does with the string we hand it, and guessing which
 * of its arguments means "the query" is guesswork.
 *
 * Four decisions about *what* the constants ask for:
 *
 * **Row counts come from the catalog, never from `COUNT(*)`.** `pg_class.reltuples`
 * and `information_schema.tables.TABLE_ROWS` are planner estimates the database
 * already maintains. Using them keeps "AtlasMind never reads a row" literally
 * true — a `COUNT(*)` scans the table, and while it returns only a number, it is
 * a read of every row to produce it. The estimate is cheaper, and the honesty is
 * free.
 *
 * **A never-analyzed table reports unknown, not zero.** Postgres uses
 * `reltuples = -1` for a relation that has never been analyzed, and MySQL leaves
 * `TABLE_ROWS` null for some engines. Reporting either as `0` would say "this
 * table is empty" about a table nobody has measured — the same mistake as
 * reporting an unprobed endpoint as reachable, and the reason
 * {@link LensTableMetrics.rowEstimate} is optional rather than defaulted.
 *
 * **`information_schema` is filtered to the user's own schemas.** Including
 * `pg_catalog` would drift every Postgres endpoint against every declared
 * contract by several hundred system tables — the same reason the GraphQL
 * derivation skips `__`-prefixed introspection meta-types.
 *
 * **Read-only is asserted at the session, not hoped for.** Each dialect carries
 * a preamble that puts the connection into a read-only transaction. It is not a
 * substitute for a read-only role — which AtlasMind cannot verify and therefore
 * recommends loudly — but it means a bug in this file cannot write, rather than
 * merely being unlikely to.
 *
 * Pure: nothing here connects to anything.
 */

import type { LensSqlDialect } from '../types.js';

/**
 * Statements that put the session into a read-only transaction.
 *
 * Sent before anything else on a connection. Postgres rejects any write inside
 * `READ ONLY` at the server; MySQL's `START TRANSACTION READ ONLY` does the
 * same. A server too old to support it fails here rather than silently running
 * the probe without the guard.
 */
export const READ_ONLY_PREAMBLE: Record<LensSqlDialect, readonly string[]> = {
  postgres: [
    'SET statement_timeout = 10000',
    'SET idle_in_transaction_session_timeout = 10000',
    'BEGIN READ ONLY',
  ],
  mysql: [
    'SET SESSION max_execution_time = 10000',
    'START TRANSACTION READ ONLY',
  ],
};

/** Statements that end the read-only transaction cleanly. */
export const READ_ONLY_EPILOGUE: Record<LensSqlDialect, readonly string[]> = {
  postgres: ['ROLLBACK'],
  mysql: ['ROLLBACK'],
};

/**
 * The columns of every user table, with type, nullability, and default presence.
 *
 * `column_default IS NOT NULL` rather than `column_default` itself: a default is
 * an expression that is sometimes a literal, and a literal default is a value.
 * Reading whether one exists answers the schema question without carrying the
 * value across the boundary.
 */
export const SCHEMA_QUERY: Record<LensSqlDialect, string> = {
  postgres: `
    SELECT c.table_name,
           c.column_name,
           c.data_type,
           c.is_nullable,
           (c.column_default IS NOT NULL) AS has_default,
           c.ordinal_position
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name = c.table_name
     WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
       AND t.table_type IN ('BASE TABLE', 'VIEW')
     ORDER BY c.table_name, c.ordinal_position
     LIMIT 20000
  `,
  mysql: `
    SELECT c.TABLE_NAME AS table_name,
           c.COLUMN_NAME AS column_name,
           c.DATA_TYPE AS data_type,
           c.IS_NULLABLE AS is_nullable,
           (c.COLUMN_DEFAULT IS NOT NULL) AS has_default,
           c.ORDINAL_POSITION AS ordinal_position
      FROM information_schema.COLUMNS c
     WHERE c.TABLE_SCHEMA = DATABASE()
     ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
     LIMIT 20000
  `,
};

/**
 * Declared constraints, so a drift report can say a key is gone rather than
 * only that a column is.
 *
 * A missing foreign key is a break the column list cannot show: the column is
 * still there, still the right type, and nothing is enforcing what it points at.
 */
export const CONSTRAINT_QUERY: Record<LensSqlDialect, string> = {
  postgres: `
    SELECT tc.table_name,
           tc.constraint_name,
           tc.constraint_type,
           kcu.column_name
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
     WHERE tc.table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY tc.table_name, tc.constraint_name
     LIMIT 5000
  `,
  mysql: `
    SELECT tc.TABLE_NAME AS table_name,
           tc.CONSTRAINT_NAME AS constraint_name,
           tc.CONSTRAINT_TYPE AS constraint_type,
           kcu.COLUMN_NAME AS column_name
      FROM information_schema.TABLE_CONSTRAINTS tc
      LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
        ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
       AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
       AND kcu.TABLE_NAME = tc.TABLE_NAME
     WHERE tc.TABLE_SCHEMA = DATABASE()
     ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME
     LIMIT 5000
  `,
};

/**
 * Per-table health, entirely from catalog statistics.
 *
 * Postgres `reltuples` is `-1` when the relation has never been analyzed, which
 * the reader turns into *unknown* rather than zero. `last_vacuum`/`last_analyze`
 * answer "are these numbers worth anything?", which matters more than the
 * numbers: a row estimate from a table last analyzed in March is a fact about
 * March.
 */
export const METRICS_QUERY: Record<LensSqlDialect, string> = {
  postgres: `
    SELECT c.relname AS table_name,
           c.reltuples AS row_estimate,
           pg_total_relation_size(c.oid) AS total_bytes,
           pg_indexes_size(c.oid) AS index_bytes,
           (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid) AS index_count,
           GREATEST(
             COALESCE(s.last_analyze, to_timestamp(0)),
             COALESCE(s.last_autoanalyze, to_timestamp(0))
           ) AS last_analyzed,
           GREATEST(
             COALESCE(s.last_vacuum, to_timestamp(0)),
             COALESCE(s.last_autovacuum, to_timestamp(0))
           ) AS last_vacuumed
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
     WHERE c.relkind = 'r'
       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
     ORDER BY c.relname
     LIMIT 5000
  `,
  mysql: `
    SELECT t.TABLE_NAME AS table_name,
           t.TABLE_ROWS AS row_estimate,
           (COALESCE(t.DATA_LENGTH, 0) + COALESCE(t.INDEX_LENGTH, 0)) AS total_bytes,
           COALESCE(t.INDEX_LENGTH, 0) AS index_bytes,
           (SELECT COUNT(DISTINCT s.INDEX_NAME)
              FROM information_schema.STATISTICS s
             WHERE s.TABLE_SCHEMA = t.TABLE_SCHEMA
               AND s.TABLE_NAME = t.TABLE_NAME) AS index_count,
           t.UPDATE_TIME AS last_analyzed,
           t.CHECK_TIME AS last_vacuumed
      FROM information_schema.TABLES t
     WHERE t.TABLE_SCHEMA = DATABASE()
       AND t.TABLE_TYPE = 'BASE TABLE'
     ORDER BY t.TABLE_NAME
     LIMIT 5000
  `,
};

/**
 * The cheapest statement that proves a round trip.
 *
 * Used for latency sampling. It touches no table, so repeating it costs the
 * server nothing measurable and cannot be mistaken for reading data.
 */
export const PING_QUERY: Record<LensSqlDialect, string> = {
  postgres: 'SELECT 1',
  mysql: 'SELECT 1',
};

/**
 * A plan for the schema query, so slowness can be attributed.
 *
 * `EXPLAIN` without `ANALYZE`: the plan is computed, the query is not run. That
 * distinction is the whole reason this is safe to send — `EXPLAIN ANALYZE`
 * would *execute* the statement, and while this particular statement only reads
 * the catalog, a probe that executes whatever it explains is a shape nobody
 * should build.
 *
 * MySQL has no `FORMAT=JSON` before 5.7 and the reader tolerates a failure here
 * rather than failing the probe: a plan is a nice-to-have, and a schema reading
 * that succeeded must not be discarded because the plan did not.
 */
export const EXPLAIN_SCHEMA_QUERY: Record<LensSqlDialect, string> = {
  postgres: `EXPLAIN (FORMAT JSON) ${SCHEMA_QUERY.postgres}`,
  mysql: `EXPLAIN FORMAT=JSON ${SCHEMA_QUERY.mysql}`,
};

/** Every statement this module can emit, for the test that walks them. */
export const ALL_STATEMENTS: readonly string[] = [
  ...Object.values(READ_ONLY_PREAMBLE).flat(),
  ...Object.values(READ_ONLY_EPILOGUE).flat(),
  ...Object.values(SCHEMA_QUERY),
  ...Object.values(CONSTRAINT_QUERY),
  ...Object.values(METRICS_QUERY),
  ...Object.values(PING_QUERY),
  ...Object.values(EXPLAIN_SCHEMA_QUERY),
];

/**
 * Verbs that would change data or structure.
 *
 * Matched on **word boundaries** by the test that walks {@link ALL_STATEMENTS} —
 * a bare substring match would flag `last_analyze` and `pg_indexes_size` and
 * teach whoever hit it to weaken the check. Checked in a test rather than at
 * runtime, because a runtime check on a constant is theatre; a test that fails
 * the moment somebody adds `DELETE` to this file is what actually holds the line.
 */
export const FORBIDDEN_SQL_VERBS: readonly string[] = [
  'insert', 'update', 'delete', 'drop', 'truncate', 'alter', 'create',
  'grant', 'revoke', 'merge', 'upsert', 'replace', 'call',
  'copy', 'vacuum', 'reindex', 'cluster', 'lock', 'commit',
];

/** How many latency samples a probe takes. Small: this is somebody's database. */
export const LATENCY_SAMPLE_COUNT = 5;

/** Reject a statement that is not a single one. Defence against a future edit. */
export function isSingleStatement(sql: string): boolean {
  // Strip string literals first, so a semicolon inside one is not miscounted.
  // None of the constants contain one today; this exists so that if one is ever
  // added, the check does not start failing for the wrong reason.
  const withoutLiterals = sql.replace(/'(?:[^']|'')*'/g, "''");
  const trimmed = withoutLiterals.trim().replace(/;\s*$/, '');
  return !trimmed.includes(';');
}
