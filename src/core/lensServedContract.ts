/**
 * What a live service serves, read as a shape and nothing else.
 *
 * This is the untrusted boundary of the live-probe feature, and it is untrusted
 * twice over. The response is third-party text — from a server that may be
 * misconfigured, mid-deploy, or not the service anybody thought it was — so
 * nothing here throws, everything is bounded, and control characters are
 * stripped before a single character reaches a webview or a modal. And the
 * response comes from a system that holds real records, so the derivation is
 * written to make carrying a value *impossible* rather than merely unlikely: the
 * output is `LensContract`, whose fields are `path`, `dataType`, `presence` and
 * `nullability`, and which has nowhere to put a row.
 *
 * That is why OpenAPI `example`, `examples`, `default`, `enum` and `const` are
 * named and discarded rather than never looked at. They are the keys most likely
 * to hold a real customer record — teams paste one in while debugging — and a
 * derivation that merely ignored unknown keys would sweep them into a note the
 * first time somebody widened the type. Dropping them by name, with the reason
 * written down, is the version that survives editing.
 *
 * **One contract per served schema or table, with bare field paths.** This
 * mirrors `extractJsonContractSources` and `extractSqlContractSources` exactly,
 * and it is the decision the whole comparison rests on: the two sides of a drift
 * report have to be built the same way, or every field mismatches on its name
 * alone and a healthy service is reported as a total schema failure.
 *
 * Three further decisions:
 *
 * **Partial is stated, never rounded up.** A response that hits a budget yields
 * `coverage: 'partial'` and a notice carrying the remainder. A served contract
 * silently truncated at 500 fields would report everything past the cap as
 * `absent-remotely` — inventing schema failures out of a budget.
 *
 * **Unreadable is not empty.** A response that parses but declares nothing
 * usable returns `undefined`, never a contract with no fields. An empty contract
 * compared against a declared one produces "every field is missing", which is
 * the most alarming possible answer to "the server returned something we could
 * not read".
 *
 * **Evidence is `runtime`, always.** These contracts did not come from a file
 * and must never be mistakable for one — a `runtime` field in a drift report is
 * a statement about a moment, and the moment travels with it.
 *
 * Pure: nothing here fetches. It is handed an already-parsed payload.
 */

import type {
  LensContract,
  LensContractField,
  LensContractLayer,
  LensContractSourceKind,
  LensEvidence,
  LensFieldNullability,
  LensFieldPresence,
  LensServedContract,
} from '../types.js';

export const LENS_SERVED_MAX_FIELDS_PER_CONTRACT = 500;
export const LENS_SERVED_MAX_CONTRACTS = 100;
export const LENS_SERVED_MAX_DEPTH = 6;

const MAX_PATH = 400;
const MAX_DATA_TYPE = 240;
const MAX_LABEL = 200;

/**
 * Keys read and deliberately discarded because they may carry real data.
 *
 * Named rather than ignored — see the module note. `example` and `examples` are
 * the ones that bite; `default`, `enum` and `const` are included because a
 * default is sometimes a real identifier and an enum is sometimes a customer
 * list somebody generated once and forgot.
 */
export const DISCARDED_VALUE_KEYS = ['example', 'examples', 'default', 'enum', 'const'] as const;

interface ServedCandidate {
  label: string;
  fields: LensContractField[];
}

/** Derive served contracts from an OpenAPI document a service published. */
export function deriveServedContractFromOpenApi(
  endpointId: string,
  payload: unknown,
  observedAt: string,
): LensServedContract | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const components = isRecord(payload.components) ? payload.components : undefined;
  const schemas = components && isRecord(components.schemas) ? components.schemas : undefined;
  // Swagger 2 kept them at the root. Reading both costs nothing, and the
  // alternative is telling somebody with a working API that we found nothing.
  const definitions = isRecord(payload.definitions) ? payload.definitions : undefined;
  const source = schemas ?? definitions;
  if (!source) {
    return undefined;
  }

  const names = Object.keys(source);
  const candidates: ServedCandidate[] = [];
  for (const name of names.slice(0, LENS_SERVED_MAX_CONTRACTS)) {
    const schema = source[name];
    const label = safeText(name, MAX_LABEL);
    if (!isRecord(schema) || !label) {
      continue;
    }
    const fields = collectSchemaFields(schema, endpointId, label, '', 0);
    if (fields.length > 0) {
      candidates.push({ label, fields });
    }
  }

  return finish(
    endpointId,
    candidates,
    'openapi',
    'api',
    'Served OpenAPI document',
    observedAt,
    names.length > LENS_SERVED_MAX_CONTRACTS,
    [`Read from the document the service publishes. Value-bearing keys (${DISCARDED_VALUE_KEYS.join(', ')}) were discarded.`],
  );
}

/** Derive served contracts from a GraphQL introspection response. */
export function deriveServedContractFromGraphql(
  endpointId: string,
  payload: unknown,
  observedAt: string,
): LensServedContract | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const data = isRecord(payload.data) ? payload.data : undefined;
  const schema = data && isRecord(data.__schema) ? data.__schema : undefined;
  if (!schema || !Array.isArray(schema.types)) {
    return undefined;
  }

  const candidates: ServedCandidate[] = [];
  for (const candidate of schema.types.slice(0, LENS_SERVED_MAX_CONTRACTS)) {
    if (!isRecord(candidate) || !Array.isArray(candidate.fields)) {
      continue;
    }
    const typeName = safeText(candidate.name, MAX_LABEL);
    // Introspection meta-types are the server describing itself, not the
    // project's schema. Including them would drift every GraphQL endpoint
    // against every declared contract by about forty fields.
    if (!typeName || typeName.startsWith('__')) {
      continue;
    }
    const fields: LensContractField[] = [];
    for (const fieldCandidate of candidate.fields.slice(0, LENS_SERVED_MAX_FIELDS_PER_CONTRACT)) {
      if (!isRecord(fieldCandidate)) {
        continue;
      }
      const fieldName = safeText(fieldCandidate.name, MAX_PATH);
      if (!fieldName) {
        continue;
      }
      const resolved = resolveGraphqlType(fieldCandidate.type);
      fields.push(buildField(
        endpointId,
        typeName,
        fieldName,
        resolved.dataType,
        resolved.nullability === 'non-null' ? 'required' : 'optional',
        resolved.nullability,
        'GraphQL introspection',
      ));
    }
    if (fields.length > 0) {
      candidates.push({ label: typeName, fields });
    }
  }

  return finish(
    endpointId,
    candidates,
    'graphql',
    'api',
    'GraphQL introspection',
    observedAt,
    schema.types.length > LENS_SERVED_MAX_CONTRACTS,
    ['Read from the schema the endpoint introspects. No query returning data was sent.'],
  );
}

/**
 * Derive served contracts from an MCP schema tool's response.
 *
 * Tolerant by necessity: every MCP database server names its fields differently
 * and there is no spec to read. Rather than guessing at one server's shape, this
 * accepts the handful of spellings that actually occur (`name`/`table_name`,
 * `columns`/`fields`, `type`/`data_type`) and **counts what it could not read**,
 * so an unrecognised response reads as "40 entries could not be interpreted"
 * instead of as a schema with 40 missing tables.
 */
export function deriveServedContractFromMcpSchema(
  endpointId: string,
  payload: unknown,
  observedAt: string,
): LensServedContract | undefined {
  const tables = findTableArray(payload);
  if (!tables) {
    return undefined;
  }

  const candidates: ServedCandidate[] = [];
  let unreadable = 0;
  for (const candidate of tables.slice(0, LENS_SERVED_MAX_CONTRACTS)) {
    if (!isRecord(candidate)) {
      unreadable += 1;
      continue;
    }
    const tableName = safeText(candidate.name ?? candidate.table_name ?? candidate.table, MAX_LABEL);
    if (!tableName) {
      unreadable += 1;
      continue;
    }
    const columns = firstArray(candidate.columns, candidate.fields, candidate.schema);
    if (!columns) {
      // A table with no readable column list is still evidence the table
      // exists, which is exactly what a dead-end check needs. Recording it with
      // a single unknown-shape field keeps that fact without inventing columns.
      candidates.push({
        label: tableName,
        fields: [buildField(endpointId, tableName, '(shape unknown)', 'unknown', 'unknown', 'unknown', 'MCP schema tool')],
      });
      continue;
    }
    const fields: LensContractField[] = [];
    for (const column of columns.slice(0, LENS_SERVED_MAX_FIELDS_PER_CONTRACT)) {
      if (!isRecord(column)) {
        unreadable += 1;
        continue;
      }
      const columnName = safeText(column.name ?? column.column_name ?? column.column, MAX_PATH);
      if (!columnName) {
        unreadable += 1;
        continue;
      }
      const dataType = safeText(
        column.type ?? column.data_type ?? column.dataType ?? column.udt_name,
        MAX_DATA_TYPE,
      ) ?? 'unknown';
      const nullability = readNullability(column);
      fields.push(buildField(
        endpointId,
        tableName,
        columnName,
        dataType,
        nullability === 'non-null' ? 'required' : 'unknown',
        nullability,
        'MCP schema tool',
      ));
    }
    if (fields.length > 0) {
      candidates.push({ label: tableName, fields });
    }
  }

  return finish(
    endpointId,
    candidates,
    'sql',
    'database',
    'MCP schema tool',
    observedAt,
    tables.length > LENS_SERVED_MAX_CONTRACTS,
    [
      'Read through a connected MCP server\'s schema tool. AtlasMind composed no SQL and read no rows.',
      ...(unreadable > 0
        ? [`${unreadable} entr${unreadable === 1 ? 'y was' : 'ies were'} in a shape this reader does not recognise, `
          + 'and were counted rather than guessed at.']
        : []),
    ],
  );
}

/**
 * Walk an OpenAPI/JSON Schema object into field paths, values discarded.
 *
 * Nested objects become dotted paths *within* their contract (`address.city`),
 * which is what the repository extractor produces for the same document.
 */
function collectSchemaFields(
  schema: Record<string, unknown>,
  endpointId: string,
  contractLabel: string,
  prefix: string,
  depth: number,
): LensContractField[] {
  if (depth > LENS_SERVED_MAX_DEPTH) {
    return [];
  }
  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  if (!properties) {
    return [];
  }
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((name): name is string => typeof name === 'string')
      : [],
  );

  const fields: LensContractField[] = [];
  for (const [name, value] of Object.entries(properties)) {
    if (!isRecord(value)) {
      continue;
    }
    const safeName = safeText(name, MAX_PATH);
    if (!safeName) {
      continue;
    }
    const path = prefix ? `${prefix}.${safeName}` : safeName;
    fields.push(buildField(
      endpointId,
      contractLabel,
      path,
      readOpenApiType(value),
      required.has(name) ? 'required' : 'optional',
      readOpenApiNullability(value),
      'Served OpenAPI document',
    ));
    if (isRecord(value.properties)) {
      fields.push(...collectSchemaFields(value, endpointId, contractLabel, path, depth + 1));
    }
    if (fields.length > LENS_SERVED_MAX_FIELDS_PER_CONTRACT) {
      break;
    }
  }
  return fields;
}

function readOpenApiType(schema: Record<string, unknown>): string {
  const type = safeText(schema.type, MAX_DATA_TYPE);
  const format = safeText(schema.format, MAX_DATA_TYPE);
  if (type === 'array') {
    const items = isRecord(schema.items) ? readOpenApiType(schema.items) : 'unknown';
    return `array<${items}>`;
  }
  if (!type) {
    // `$ref` names a shape without describing it. Carrying the reference is
    // more useful than `unknown`, and it is a type name rather than a value.
    const ref = safeText(schema.$ref, MAX_DATA_TYPE);
    return ref ? `ref:${ref.split('/').pop() ?? ref}` : 'unknown';
  }
  return format ? `${type}/${format}` : type;
}

function readOpenApiNullability(schema: Record<string, unknown>): LensFieldNullability {
  if (schema.nullable === true) return 'nullable';
  if (schema.nullable === false) return 'non-null';
  // OpenAPI 3.1 moved to JSON Schema's union types.
  if (Array.isArray(schema.type) && schema.type.includes('null')) return 'nullable';
  return 'unknown';
}

/**
 * Read a column's nullability across the spellings that actually occur.
 *
 * `notnull` (SQLite's `PRAGMA table_info`) inverts the sense of every other
 * spelling, so it is read first and separately. Folding it in with the others
 * would report every non-null column as nullable — silently, and in the
 * direction that hides a constraint.
 */
function readNullability(column: Record<string, unknown>): LensFieldNullability {
  if (column.notnull !== undefined) {
    const notNull = column.notnull;
    if (notNull === 1 || notNull === true || notNull === '1') return 'non-null';
    if (notNull === 0 || notNull === false || notNull === '0') return 'nullable';
    return 'unknown';
  }
  const raw = column.nullable ?? column.is_nullable ?? column.isNullable;
  if (raw === true || raw === 'YES' || raw === 'yes' || raw === 1) return 'nullable';
  if (raw === false || raw === 'NO' || raw === 'no' || raw === 0) return 'non-null';
  return 'unknown';
}

function resolveGraphqlType(
  value: unknown,
  depth = 0,
): { dataType: string; nullability: LensFieldNullability } {
  if (!isRecord(value) || depth > LENS_SERVED_MAX_DEPTH) {
    return { dataType: 'unknown', nullability: 'unknown' };
  }
  const kind = safeText(value.kind, 40);
  if (kind === 'NON_NULL') {
    const inner = resolveGraphqlType(value.ofType, depth + 1);
    return { dataType: inner.dataType, nullability: 'non-null' };
  }
  if (kind === 'LIST') {
    const inner = resolveGraphqlType(value.ofType, depth + 1);
    return { dataType: `array<${inner.dataType}>`, nullability: 'nullable' };
  }
  const name = safeText(value.name, MAX_DATA_TYPE);
  return { dataType: name ?? 'unknown', nullability: 'nullable' };
}

/** Find the array of table-like records in whatever the MCP server returned. */
function findTableArray(payload: unknown, depth = 0): unknown[] | undefined {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload) || depth > LENS_SERVED_MAX_DEPTH) {
    return undefined;
  }
  for (const key of ['tables', 'result', 'results', 'rows', 'data', 'schema', 'collections']) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value;
    }
    if (isRecord(value)) {
      const nested = findTableArray(value, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function firstArray(...candidates: unknown[]): unknown[] | undefined {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function buildField(
  endpointId: string,
  contractLabel: string,
  path: string,
  dataType: string,
  presence: LensFieldPresence,
  nullability: LensFieldNullability,
  source: string,
): LensContractField {
  return {
    id: `lens-served-field:${stableHash(`${endpointId}:${contractLabel}:${path}`)}`,
    path,
    label: path,
    dataType: dataType.slice(0, MAX_DATA_TYPE),
    presence,
    nullability,
    // Always `runtime`. A served contract must never be mistakable for a file.
    evidence: { kind: 'runtime', source, confidence: 1 } satisfies LensEvidence,
  };
}

function finish(
  endpointId: string,
  candidates: ServedCandidate[],
  sourceKind: LensContractSourceKind,
  layer: LensContractLayer,
  sourceLabel: string,
  observedAt: string,
  contractsTruncated: boolean,
  notices: string[],
): LensServedContract | undefined {
  if (candidates.length === 0) {
    // Unreadable is not empty. Returning a contract with no fields here would
    // make the drift report say every declared field is missing.
    return undefined;
  }

  let fieldsTruncated = false;
  const contracts: LensContract[] = [];
  const usedLabels = new Set<string>();
  for (const candidate of candidates) {
    // De-duplicate by path: `normalizeLensContract` refuses a contract with two
    // fields sharing a path, and a served document repeating one is a server
    // quirk rather than a reason to discard the whole reading.
    const seen = new Set<string>();
    const unique: LensContractField[] = [];
    for (const field of candidate.fields) {
      if (seen.has(field.path)) {
        continue;
      }
      seen.add(field.path);
      unique.push(field);
    }
    if (unique.length > LENS_SERVED_MAX_FIELDS_PER_CONTRACT) {
      fieldsTruncated = true;
    }
    // Two served schemas with the same name would collide into one contract id.
    // Suffixing keeps both visible rather than silently dropping the second.
    let label = candidate.label;
    let suffix = 2;
    while (usedLabels.has(label)) {
      label = `${candidate.label} (${suffix})`;
      suffix += 1;
    }
    usedLabels.add(label);

    contracts.push({
      version: 1,
      id: `lens-served:${stableHash(`${endpointId}:${sourceKind}:${label}`)}`,
      label: `${label} (live)`,
      layer,
      sourceKind,
      // Partial whenever a budget was hit — never rounded up to `complete`, or
      // every field past the cap becomes an invented schema failure.
      coverage: unique.length > LENS_SERVED_MAX_FIELDS_PER_CONTRACT ? 'partial' : 'complete',
      fields: unique.slice(0, LENS_SERVED_MAX_FIELDS_PER_CONTRACT),
    });
  }

  const truncated = contractsTruncated || fieldsTruncated;
  return {
    version: 1,
    endpointId,
    contracts,
    observedAt,
    notices: [
      'This describes the shape the service served. No rows, records, or field values were read.',
      ...notices,
      ...(truncated
        ? ['The served schema reached a published budget; this is a bounded partial view, '
          + 'and fields beyond it are not reported as missing.']
        : []),
    ],
    truncated,
  };
}

/** Bounded, control-stripped text. Everything crossing this boundary goes through it. */
function safeText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  let stripped = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    stripped += code <= 0x1f || code === 0x7f ? ' ' : value[index];
  }
  const text = stripped.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximum) : undefined;
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
