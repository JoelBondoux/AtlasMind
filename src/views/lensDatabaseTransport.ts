/**
 * The direct database transports: Postgres, MySQL, and vendor SQL-over-HTTPS.
 *
 * `pg` and `mysql2` are ordinary dependencies — fixed at build time, covered by
 * the lockfile's integrity hash, auditable in the repo — but they are `import`ed
 * only the first time somebody actually probes a database, the same way
 * `buzzSigner` loads `@noble/secp256k1`. A user who never touches this pays
 * nothing at activation: no load time, no memory, no socket library resident in
 * every VS Code window.
 *
 * Everything sent from here is a constant from `lensDatabaseDialect`. This file
 * has no parameter to accept SQL and no code path that concatenates any, which
 * is what makes "AtlasMind never composes SQL, it sends a constant" a property
 * of the code rather than a claim about it.
 *
 * Five decisions:
 *
 * **The read-only transaction is opened before anything else and is not
 * optional.** If `BEGIN READ ONLY` fails, the probe fails. A server too old to
 * support it does not get a probe that runs without the guard — that is the
 * exact case where the guard would have mattered.
 *
 * **The connection is closed in a `finally`, always.** A probe that leaves a
 * connection open against somebody's production pooler is a worse bug than
 * anything it was looking for, and Neon in particular bills connection time.
 *
 * **Nothing here logs.** Not the connection string, not the host, not on error.
 * The driver's own error messages are stripped through {@link safeDriverMessage}
 * before they leave, because `pg` puts the connection target into several of
 * them and some poolers echo the user back.
 *
 * **The plan is best-effort and never fails the probe.** MySQL before 5.7 has no
 * `FORMAT=JSON`; a missing plan must not discard a schema reading that worked.
 *
 * **Latency samples come after the schema read.** The connection is warm by then,
 * so the samples measure the round trip rather than the handshake — except the
 * first, which is taken *before* anything else precisely so a cold start is
 * visible rather than averaged away.
 */

import {
  CONSTRAINT_QUERY,
  EXPLAIN_SCHEMA_QUERY,
  LATENCY_SAMPLE_COUNT,
  METRICS_QUERY,
  PING_QUERY,
  READ_ONLY_EPILOGUE,
  READ_ONLY_PREAMBLE,
  SCHEMA_QUERY,
} from '../core/lensDatabaseDialect.js';
import {
  buildDatabaseHealth,
  readConstraints,
  readQueryPlan,
  readServedContractsFromCatalog,
  readTableMetrics,
  summarizeLatency,
  type CatalogRow,
} from '../core/lensDatabaseReading.js';
import type { LensProbeRequest } from '../core/lensProbePolicy.js';
import type { LensProbeTransportResult } from '../core/lensProbeRunner.js';
import type { LensDatabaseHealth, LensServedContract, LensSqlDialect } from '../types.js';

/**
 * What a direct database probe produces.
 *
 * Richer than `LensProbeTransportResult` because a database probe reads several
 * things in one connection, and reconnecting per query would multiply the cost
 * on a pooled or serverless database by five.
 */
export interface LensDatabaseProbeResult extends LensProbeTransportResult {
  served?: LensServedContract;
  health?: LensDatabaseHealth;
}

/** Run the whole catalog reading over one connection. Never throws. */
export async function performDirectSqlProbe(
  request: LensProbeRequest,
  endpointId: string,
  observedAt: string,
): Promise<LensDatabaseProbeResult> {
  if (!request.connectionString || !request.dialect) {
    return { ok: false, error: 'The probe request carried no connection string.' };
  }
  return request.dialect === 'postgres'
    ? probePostgres(request, endpointId, observedAt)
    : probeMysql(request, endpointId, observedAt);
}

async function probePostgres(
  request: LensProbeRequest,
  endpointId: string,
  observedAt: string,
): Promise<LensDatabaseProbeResult> {
  let client: PgClientLike | undefined;
  try {
    const { Client } = await loadPg();
    client = new Client({
      connectionString: request.connectionString,
      connectionTimeoutMillis: request.timeoutMs,
      statement_timeout: request.timeoutMs,
      application_name: 'AtlasMind-Lens',
    }) as PgClientLike;

    // Taken around connect, so a serverless cold start is a visible number
    // rather than something folded into an average later.
    const connectStarted = Date.now();
    await client.connect();
    const firstMs = Date.now() - connectStarted;

    for (const statement of READ_ONLY_PREAMBLE.postgres) {
      await client.query(statement);
    }

    const schema = await client.query(SCHEMA_QUERY.postgres);
    const served = readServedContractsFromCatalog(endpointId, 'postgres', rowsOf(schema), observedAt);
    if (!served) {
      await rollbackQuietly(client, 'postgres');
      return {
        ok: false,
        error: 'The database answered, but its catalog returned no readable tables. Check that the '
          + 'connection string names the right database and that the role can read information_schema.',
      };
    }

    const metrics = await queryQuietly(client, METRICS_QUERY.postgres);
    const constraints = await queryQuietly(client, CONSTRAINT_QUERY.postgres);
    const plan = await queryQuietly(client, EXPLAIN_SCHEMA_QUERY.postgres);
    const latency = await sampleLatency(statement => client!.query(statement), 'postgres', firstMs);

    await rollbackQuietly(client, 'postgres');

    return {
      ok: true,
      served,
      health: buildDatabaseHealth({
        endpointId,
        dialect: 'postgres',
        tables: readTableMetrics(rowsOf(metrics)),
        constraints: readConstraints(rowsOf(constraints)),
        latency,
        plan: readQueryPlan('postgres', firstPlanValue(rowsOf(plan))),
        ...(typeof client.serverVersion === 'string' ? { serverVersion: client.serverVersion } : {}),
        truncated: served.truncated,
      }),
    };
  } catch (error) {
    return { ok: false, error: safeDriverMessage(error) };
  } finally {
    // Always. A probe that leaves a connection open against a production pooler
    // is a worse bug than anything it was looking for.
    await closeQuietly(client);
  }
}

async function probeMysql(
  request: LensProbeRequest,
  endpointId: string,
  observedAt: string,
): Promise<LensDatabaseProbeResult> {
  let connection: MysqlConnectionLike | undefined;
  try {
    const mysql = await loadMysql();
    const connectStarted = Date.now();
    connection = await mysql.createConnection({
      uri: request.connectionString,
      connectTimeout: request.timeoutMs,
      // Multi-statement execution is off by default in mysql2 and is left off
      // explicitly: every statement this file sends is a single constant, and a
      // connection that *could* run two is a capability with no use here.
      multipleStatements: false,
    }) as MysqlConnectionLike;
    const firstMs = Date.now() - connectStarted;

    for (const statement of READ_ONLY_PREAMBLE.mysql) {
      await connection.query(statement);
    }

    const schema = await connection.query(SCHEMA_QUERY.mysql);
    const served = readServedContractsFromCatalog(endpointId, 'mysql', mysqlRows(schema), observedAt);
    if (!served) {
      await rollbackQuietly(connection, 'mysql');
      return {
        ok: false,
        error: 'The database answered, but its catalog returned no readable tables. Check that the '
          + 'connection string names a database and that the user can read information_schema.',
      };
    }

    const metrics = await queryQuietly(connection, METRICS_QUERY.mysql);
    const constraints = await queryQuietly(connection, CONSTRAINT_QUERY.mysql);
    const plan = await queryQuietly(connection, EXPLAIN_SCHEMA_QUERY.mysql);
    const latency = await sampleLatency(statement => connection!.query(statement), 'mysql', firstMs);

    await rollbackQuietly(connection, 'mysql');

    return {
      ok: true,
      served,
      health: buildDatabaseHealth({
        endpointId,
        dialect: 'mysql',
        tables: readTableMetrics(mysqlRows(metrics)),
        constraints: readConstraints(mysqlRows(constraints)),
        latency,
        plan: readQueryPlan('mysql', firstPlanValue(mysqlRows(plan))),
        truncated: served.truncated,
      }),
    };
  } catch (error) {
    return { ok: false, error: safeDriverMessage(error) };
  } finally {
    await closeQuietly(connection);
  }
}

/**
 * Sample the round trip a few times.
 *
 * `firstMs` is the connect time, passed in rather than measured here — it is the
 * one sample that cannot be taken twice, and it is the one that shows a cold
 * start.
 */
async function sampleLatency(
  run: (statement: string) => Promise<unknown>,
  dialect: LensSqlDialect,
  firstMs: number,
): Promise<ReturnType<typeof summarizeLatency>> {
  const samples: number[] = [firstMs];
  for (let index = 1; index < LATENCY_SAMPLE_COUNT; index += 1) {
    const started = Date.now();
    try {
      await run(PING_QUERY[dialect]);
      samples.push(Date.now() - started);
    } catch {
      // A failed sample is dropped rather than recorded as a huge one, which
      // would make the percentile describe an error instead of a round trip.
      break;
    }
  }
  return summarizeLatency(samples);
}

/** Run a statement whose failure must not fail the probe. */
async function queryQuietly(
  client: { query: (sql: string) => Promise<unknown> },
  statement: string,
): Promise<unknown> {
  try {
    return await client.query(statement);
  } catch {
    // Metrics, constraints and plans are all best-effort: a role permitted to
    // read `information_schema.columns` is not always permitted to read
    // `pg_stat_user_tables`, and a partial answer beats no answer.
    return undefined;
  }
}

async function rollbackQuietly(
  client: { query: (sql: string) => Promise<unknown> },
  dialect: LensSqlDialect,
): Promise<void> {
  for (const statement of READ_ONLY_EPILOGUE[dialect]) {
    try {
      await client.query(statement);
    } catch {
      // The connection is about to be closed regardless.
    }
  }
}

async function closeQuietly(client: { end?: () => Promise<unknown> } | undefined): Promise<void> {
  try {
    await client?.end?.();
  } catch {
    // Closing a connection that already failed is not an error worth surfacing.
  }
}

/**
 * The vendor SQL-over-HTTPS transports.
 *
 * Neon, Cloudflare D1 and Turso each expose SQL over HTTP with a different
 * envelope, so the framing is chosen by the declared `vendor` rather than
 * guessed from the URL — a wrong guess would post a Neon-shaped body to a D1
 * endpoint and report the resulting error as "unreachable".
 */
export async function performSqlHttpProbe(
  request: LensProbeRequest,
  endpointId: string,
  observedAt: string,
): Promise<LensDatabaseProbeResult> {
  if (!request.url || !request.vendor || !request.connectionString) {
    return { ok: false, error: 'The probe request was missing its URL, vendor, or credential.' };
  }
  // Neon speaks Postgres; D1 and Turso are SQLite, whose catalog vocabulary
  // differs enough that they read through the SQLite path in a later slice.
  if (request.vendor !== 'neon') {
    return {
      ok: false,
      error: `AtlasMind can reach \`${request.vendor}\` but does not yet read its catalog format. `
        + 'Neon is supported today; D1 and Turso are SQLite and need their own catalog queries.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Neon's SQL-over-HTTP endpoint takes the connection string in a header.
        // It is the credential, and it appears here and nowhere else.
        'Neon-Connection-String': request.connectionString,
        'Neon-Raw-Text-Output': 'true',
        'Neon-Array-Mode': 'false',
      },
      body: JSON.stringify({ query: SCHEMA_QUERY.postgres, params: [] }),
      redirect: 'manual',
      signal: controller.signal,
    });
    const firstMs = Date.now() - started;

    if (!response.ok) {
      return { ok: false, status: response.status, error: `The service answered ${response.status}.` };
    }
    const payload = await response.json() as unknown;
    const rows = neonRows(payload);
    const served = readServedContractsFromCatalog(endpointId, 'postgres', rows, observedAt);
    if (!served) {
      return { ok: false, status: response.status, error: 'The endpoint answered with no readable catalog rows.' };
    }
    return {
      ok: true,
      status: response.status,
      served,
      health: buildDatabaseHealth({
        endpointId,
        dialect: 'postgres',
        tables: [],
        constraints: [],
        latency: summarizeLatency([firstMs]),
        plan: {
          available: false,
          unavailableReason: 'Query plans are not read over the HTTP SQL endpoint.',
        },
        truncated: served.truncated,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: controller.signal.aborted
        ? `The probe timed out after ${request.timeoutMs}ms.`
        : safeDriverMessage(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── driver loading ──────────────────────────────────────────────

interface PgClientLike {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
  serverVersion?: string;
}

interface MysqlConnectionLike {
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
}

/**
 * Load `pg` on first use.
 *
 * `import()` rather than `require`, so the desktop CJS build and any future ESM
 * build both work, and so nothing is resolved until a probe actually runs.
 */
async function loadPg(): Promise<{ Client: new (config: unknown) => unknown }> {
  const module = await import('pg');
  const resolved = (module as { default?: unknown }).default ?? module;
  return resolved as { Client: new (config: unknown) => unknown };
}

async function loadMysql(): Promise<{ createConnection: (config: unknown) => Promise<unknown> }> {
  const module = await import('mysql2/promise');
  const resolved = (module as { default?: unknown }).default ?? module;
  return resolved as { createConnection: (config: unknown) => Promise<unknown> };
}

// ── result shaping ──────────────────────────────────────────────

/** `pg` returns `{ rows }`. */
function rowsOf(result: unknown): CatalogRow[] {
  if (isRecord(result) && Array.isArray(result.rows)) {
    return result.rows.filter(isRecord);
  }
  return [];
}

/** `mysql2` returns `[rows, fields]`. */
function mysqlRows(result: unknown): CatalogRow[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0].filter(isRecord);
  }
  return Array.isArray(result) ? result.filter(isRecord) : [];
}

/** Neon returns `{ rows: [...] }` like `pg`, possibly wrapped in `results`. */
function neonRows(payload: unknown): CatalogRow[] {
  if (isRecord(payload)) {
    if (Array.isArray(payload.rows)) {
      return payload.rows.filter(isRecord);
    }
    if (Array.isArray(payload.results)) {
      const first = payload.results[0];
      if (isRecord(first) && Array.isArray(first.rows)) {
        return first.rows.filter(isRecord);
      }
    }
  }
  return [];
}

/** Pull the plan out of the single-column, single-row EXPLAIN result. */
function firstPlanValue(rows: readonly CatalogRow[]): unknown {
  const first = rows[0];
  if (!first) {
    return undefined;
  }
  const values = Object.values(first);
  return values.length > 0 ? values[0] : undefined;
}

/**
 * Strip a driver error down to something safe to display.
 *
 * `pg` interpolates the connection target into several messages and some
 * poolers echo the connecting user back, so the message is control-stripped,
 * clamped, and scrubbed of anything URL-shaped before it can reach a webview,
 * a modal, or an output channel.
 */
export function safeDriverMessage(error: unknown): string {
  const raw = error instanceof Error && error.message ? error.message : 'no detail was reported';
  let stripped = '';
  for (let index = 0; index < raw.length && stripped.length < 300; index += 1) {
    const code = raw.charCodeAt(index);
    stripped += code <= 0x1f || code === 0x7f ? ' ' : raw[index];
  }
  const scrubbed = stripped
    // Anything that looks like a DSN, with or without credentials.
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, '[connection details removed]')
    // `user:password@host` fragments that appear without a scheme.
    .replace(/\b\S+:\S+@\S+/g, '[connection details removed]');
  return scrubbed.replace(/\s+/g, ' ').trim() || 'no detail was reported';
}

function isRecord(value: unknown): value is CatalogRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
