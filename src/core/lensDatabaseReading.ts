/**
 * Catalog rows in, contracts and health out.
 *
 * The direct-database counterpart to `lensServedContract`, and it keeps that
 * module's boundary exactly: the input is untrusted (it came off a wire from a
 * server that may not be what anybody thinks), nothing throws, everything is
 * bounded, control characters are stripped, and the output types have nowhere
 * to put a row.
 *
 * The rows this reads are catalog rows — table names, column names, type names,
 * planner estimates. That distinction is the whole reason a direct connection
 * is acceptable at all, and it is worth stating precisely, because "we query the
 * database but never read data" sounds like a contradiction until you see which
 * tables are being queried. `information_schema` and `pg_class` describe the
 * shape of the database; they contain no application data. A `SELECT` against
 * them is closer to reading a header file than to reading a record.
 *
 * Four decisions:
 *
 * **A never-analyzed table reports unknown, not zero.** Postgres uses
 * `reltuples = -1` and MySQL leaves `TABLE_ROWS` null. Both mean nobody has
 * measured this table. Reporting either as `0` would put "this table is empty"
 * in front of somebody deciding whether a migration ran — the single most
 * expensive wrong answer this module could give.
 *
 * **A stale estimate is reported with its age, not silently.** A row count from
 * a table last analyzed in March is a fact about March. `lastAnalyzedAt` travels
 * with the number so nothing downstream has to guess whether it is current.
 *
 * **Contract shape mirrors the SQL extractor exactly** — one contract per table,
 * bare column names as field paths — for the same reason `lensServedContract`
 * does: the two sides of a drift comparison must be built the same way or every
 * column mismatches on its name alone.
 *
 * **The cold-start sample is kept apart from the rest.** Folding a serverless
 * database's first-connection latency into an average describes neither the cold
 * path nor the warm one.
 *
 * Pure: nothing here connects to anything.
 */

import type {
  LensContract,
  LensContractField,
  LensDatabaseHealth,
  LensFieldNullability,
  LensLatencyProfile,
  LensQueryPlanProfile,
  LensServedContract,
  LensSqlDialect,
  LensTableConstraint,
  LensTableMetrics,
} from '../types.js';
import { LATENCY_SAMPLE_COUNT } from './lensDatabaseDialect.js';

export const LENS_DB_MAX_TABLES = 200;
export const LENS_DB_MAX_COLUMNS_PER_TABLE = 500;
export const LENS_DB_MAX_CONSTRAINTS = 2_000;

const MAX_NAME = 200;
const MAX_TYPE = 240;

/** A row as the drivers hand it back. Values are `unknown` until read. */
export type CatalogRow = Record<string, unknown>;

/**
 * Build served contracts from `information_schema.columns` rows.
 *
 * Returns `undefined` when nothing usable came back — never an empty contract
 * set, because empty compared against a declared schema reports every table as
 * missing, which is the most alarming possible answer to "the query returned
 * something we could not read".
 */
export function readServedContractsFromCatalog(
  endpointId: string,
  dialect: LensSqlDialect,
  rows: readonly CatalogRow[],
  observedAt: string,
): LensServedContract | undefined {
  const byTable = new Map<string, LensContractField[]>();
  let unreadable = 0;

  for (const row of rows) {
    const table = text(row.table_name, MAX_NAME);
    const column = text(row.column_name, MAX_NAME);
    if (!table || !column) {
      unreadable += 1;
      continue;
    }
    const existing = byTable.get(table);
    if (existing && existing.length >= LENS_DB_MAX_COLUMNS_PER_TABLE) {
      continue;
    }
    const nullability = readNullable(row.is_nullable);
    const field: LensContractField = {
      id: `lens-db-field:${stableHash(`${endpointId}:${table}:${column}`)}`,
      path: column,
      label: column,
      dataType: text(row.data_type, MAX_TYPE) ?? 'unknown',
      // A column with a default may be omitted by a writer even when NOT NULL,
      // so presence is about the declaration, not about the constraint.
      presence: nullability === 'non-null' && row.has_default !== true ? 'required' : 'optional',
      nullability,
      evidence: { kind: 'runtime', source: `${dialect} catalog`, confidence: 1 },
    };
    if (existing) {
      existing.push(field);
    } else {
      byTable.set(table, [field]);
    }
  }

  if (byTable.size === 0) {
    return undefined;
  }

  const tables = [...byTable.entries()].slice(0, LENS_DB_MAX_TABLES);
  const truncated = byTable.size > LENS_DB_MAX_TABLES
    || [...byTable.values()].some(fields => fields.length >= LENS_DB_MAX_COLUMNS_PER_TABLE);

  const contracts: LensContract[] = tables.map(([table, fields]) => ({
    version: 1,
    id: `lens-served:${stableHash(`${endpointId}:${dialect}:${table}`)}`,
    label: `${table} (live)`,
    layer: 'database',
    sourceKind: 'sql',
    coverage: fields.length >= LENS_DB_MAX_COLUMNS_PER_TABLE ? 'partial' : 'complete',
    fields: dedupeByPath(fields),
  }));

  return {
    version: 1,
    endpointId,
    contracts,
    observedAt,
    notices: [
      'Read from the database catalog (`information_schema`). No application table was queried and no '
      + 'row of your data was read.',
      'Every statement sent was a constant, inside a read-only transaction.',
      ...(unreadable > 0
        ? [`${unreadable} catalog row${unreadable === 1 ? ' was' : 's were'} missing a table or column name `
          + 'and were counted rather than guessed at.']
        : []),
      ...(truncated
        ? [`The catalog reading reached a published budget (${LENS_DB_MAX_TABLES} tables, `
          + `${LENS_DB_MAX_COLUMNS_PER_TABLE} columns each); this is a bounded partial view, and nothing `
          + 'beyond it is reported as missing.']
        : []),
    ],
    truncated,
  };
}

/** Read per-table metrics rows. Unknown stays unknown. */
export function readTableMetrics(rows: readonly CatalogRow[]): LensTableMetrics[] {
  const metrics: LensTableMetrics[] = [];
  for (const row of rows.slice(0, LENS_DB_MAX_TABLES)) {
    const table = text(row.table_name, MAX_NAME);
    if (!table) {
      continue;
    }
    metrics.push({
      table,
      ...optionalNumber('rowEstimate', readRowEstimate(row.row_estimate)),
      ...optionalNumber('totalBytes', finiteNumber(row.total_bytes)),
      ...optionalNumber('indexBytes', finiteNumber(row.index_bytes)),
      ...optionalNumber('indexCount', finiteNumber(row.index_count)),
      ...optionalText('lastAnalyzedAt', readTimestamp(row.last_analyzed)),
      ...optionalText('lastVacuumedAt', readTimestamp(row.last_vacuumed)),
    });
  }
  return metrics;
}

/**
 * Read a row estimate, keeping "never measured" distinct from "measured as zero".
 *
 * Postgres writes `-1` into `reltuples` for a relation that has never been
 * analyzed. MySQL leaves `TABLE_ROWS` null for MEMORY and several other engines.
 * Both become `undefined` — which the renderer shows as *unknown*, never as an
 * empty table.
 */
export function readRowEstimate(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  if (parsed === undefined || parsed < 0) {
    return undefined;
  }
  return Math.round(parsed);
}

/** Read constraint rows, so a drift report can say a key has gone. */
export function readConstraints(rows: readonly CatalogRow[]): LensTableConstraint[] {
  const constraints: LensTableConstraint[] = [];
  for (const row of rows.slice(0, LENS_DB_MAX_CONSTRAINTS)) {
    const table = text(row.table_name, MAX_NAME);
    const name = text(row.constraint_name, MAX_NAME);
    const constraintType = text(row.constraint_type, 60);
    if (!table || !name || !constraintType) {
      continue;
    }
    constraints.push({
      table,
      name,
      constraintType,
      ...optionalText('column', text(row.column_name, MAX_NAME)),
    });
  }
  return constraints;
}

/**
 * Summarize latency samples.
 *
 * The first sample is reported separately and never smoothed away. On a
 * serverless database it is a cold start measured in seconds, and an average
 * that includes it describes neither the cold path nor the warm one — which is
 * exactly the number somebody would act on.
 */
export function summarizeLatency(samplesMs: readonly number[]): LensLatencyProfile | undefined {
  const clean = samplesMs.filter(sample => Number.isFinite(sample) && sample >= 0);
  if (clean.length === 0) {
    return undefined;
  }
  const first = clean[0]!;
  const sorted = [...clean].sort((left, right) => left - right);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const rest = clean.slice(1);
  const restMedian = rest.length > 0 ? percentile([...rest].sort((l, r) => l - r), 50) : first;

  return {
    samples: clean.length,
    firstMs: Math.round(first),
    p50Ms: Math.round(p50),
    p95Ms: Math.round(p95),
    minMs: Math.round(sorted[0]!),
    maxMs: Math.round(sorted[sorted.length - 1]!),
    // A cold start, not slowness: the first call dominates and the rest are
    // quick. Stated as a suspicion rather than a verdict, because one sample
    // cannot distinguish a cold start from a transient stall.
    coldStartSuspected: rest.length >= 2 && first > Math.max(50, restMedian * 3),
  };
}

/**
 * Read a Postgres or MySQL `EXPLAIN` result.
 *
 * Total and forgiving: every field is optional, and an unreadable plan yields
 * `available: false` with a reason rather than failing the probe. A schema
 * reading that succeeded must never be discarded because the plan did not — MySQL
 * before 5.7 has no `FORMAT=JSON` at all.
 */
export function readQueryPlan(dialect: LensSqlDialect, payload: unknown): LensQueryPlanProfile {
  const parsed = parsePlanPayload(payload);
  if (!parsed) {
    return {
      available: false,
      unavailableReason: 'The server returned no readable plan. This does not affect the schema reading.',
    };
  }

  if (dialect === 'postgres') {
    const plan = isRecord(parsed.Plan) ? parsed.Plan : undefined;
    if (!plan) {
      return { available: false, unavailableReason: 'The plan had no root node.' };
    }
    return {
      available: true,
      ...optionalNumber('planningMs', finiteNumber(parsed['Planning Time'])),
      ...optionalNumber('estimatedCost', finiteNumber(plan['Total Cost'])),
      ...optionalNumber('estimatedRows', finiteNumber(plan['Plan Rows'])),
      ...optionalText('rootNode', text(plan['Node Type'], 120)),
    };
  }

  const queryBlock = isRecord(parsed.query_block) ? parsed.query_block : undefined;
  if (!queryBlock) {
    return { available: false, unavailableReason: 'The plan had no query block.' };
  }
  const costInfo = isRecord(queryBlock.cost_info) ? queryBlock.cost_info : undefined;
  return {
    available: true,
    ...optionalNumber('estimatedCost', finiteNumber(costInfo?.query_cost)),
    ...optionalText('rootNode', text(queryBlock.select_id !== undefined ? 'select' : undefined, 120)),
  };
}

/** Assemble the health record. Notices state every limit that applied. */
export function buildDatabaseHealth(input: {
  endpointId: string;
  dialect: LensSqlDialect;
  tables: LensTableMetrics[];
  constraints: LensTableConstraint[];
  latency?: LensLatencyProfile;
  plan?: LensQueryPlanProfile;
  serverVersion?: string;
  truncated: boolean;
}): LensDatabaseHealth {
  const neverAnalyzed = input.tables.filter(table => table.rowEstimate === undefined).length;
  return {
    version: 1,
    endpointId: input.endpointId,
    dialect: input.dialect,
    tables: input.tables,
    constraints: input.constraints,
    ...(input.latency ? { latency: input.latency } : {}),
    ...(input.plan ? { plan: input.plan } : {}),
    ...(input.serverVersion ? { serverVersion: input.serverVersion } : {}),
    notices: [
      'Row counts are planner estimates the database already maintains, not a `COUNT(*)`. Nothing here '
      + 'scanned a table, so no row of your data was read to produce these numbers.',
      'An estimate is only as current as the last ANALYZE. Each table carries when that was.',
      ...(neverAnalyzed > 0
        ? [`${neverAnalyzed} table${neverAnalyzed === 1 ? ' has' : 's have'} never been analyzed, so their `
          + 'row counts are unknown — which is not the same as empty.']
        : []),
      ...(input.plan && !input.plan.available && input.plan.unavailableReason
        ? [input.plan.unavailableReason]
        : []),
      ...(input.truncated
        ? ['The metrics reading reached a published budget; this is a bounded partial view.']
        : []),
    ],
    truncated: input.truncated,
  };
}

/** How many latency samples to take. Re-exported so callers share one number. */
export const LATENCY_SAMPLES = LATENCY_SAMPLE_COUNT;

function dedupeByPath(fields: LensContractField[]): LensContractField[] {
  const seen = new Set<string>();
  const unique: LensContractField[] = [];
  for (const field of fields) {
    if (seen.has(field.path)) {
      continue;
    }
    seen.add(field.path);
    unique.push(field);
  }
  return unique.slice(0, LENS_DB_MAX_COLUMNS_PER_TABLE);
}

function readNullable(value: unknown): LensFieldNullability {
  if (value === true) return 'nullable';
  if (value === false) return 'non-null';
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (normalized === 'YES') return 'nullable';
    if (normalized === 'NO') return 'non-null';
  }
  return 'unknown';
}

function readTimestamp(value: unknown): string | undefined {
  if (value instanceof Date) {
    // The epoch is the `COALESCE(..., to_timestamp(0))` sentinel in the metrics
    // query, meaning "never". Carrying it forward as a real date would report a
    // table analyzed in 1970.
    return value.getTime() <= 0 ? undefined : value.toISOString();
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) || parsed.getTime() <= 0 ? undefined : parsed.toISOString();
  }
  return undefined;
}

function parsePlanPayload(payload: unknown): Record<string, unknown> | undefined {
  // Postgres returns `[{ "Plan": ... }]`; MySQL returns a JSON string.
  const unwrapped = Array.isArray(payload) ? payload[0] : payload;
  if (isRecord(unwrapped)) {
    return unwrapped;
  }
  if (typeof unwrapped === 'string') {
    try {
      const parsed = JSON.parse(unwrapped) as unknown;
      const inner = Array.isArray(parsed) ? parsed[0] : parsed;
      return isRecord(inner) ? inner : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function percentile(sorted: readonly number[], rank: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1));
  return sorted[index]!;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  // Postgres returns bigint columns as strings to avoid precision loss.
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return undefined;
}

function optionalNumber<K extends string>(key: K, value: number | undefined): Record<K, number> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>);
}

function optionalText<K extends string>(key: K, value: string | undefined): Record<K, string> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

/** Bounded, control-stripped text. Everything crossing this boundary goes through it. */
function text(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  let stripped = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    stripped += code <= 0x1f || code === 0x7f ? ' ' : value[index];
  }
  const trimmed = stripped.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, maximum) : undefined;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
