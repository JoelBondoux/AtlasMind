import type {
  LensContract,
  LensContractField,
  LensContractLayer,
  LensContractSourceKind,
  LensFieldNullability,
  LensSourceRange,
  LensVisualTarget,
  LensWorkspaceIdentity,
} from '../types.js';
import { normalizeLensContract } from './lensContract.js';
import { createSourceLensTarget } from './lensTarget.js';

const MAX_SOURCE_BYTES = 2_000_000;
const MAX_CONTRACTS = 100;

export interface LensContractDocumentInput {
  workspace: LensWorkspaceIdentity;
  workspacePath: string;
  text: string;
}

export interface LensContractExtraction {
  contracts: LensContract[];
  notices: string[];
}

/** Extract OpenAPI 3 component schemas or ordinary JSON Schema object declarations. */
export function extractJsonContractSources(input: LensContractDocumentInput): LensContractExtraction {
  if (!isValidInput(input)) {
    return { contracts: [], notices: ['The JSON contract source was too large or had an invalid workspace location.'] };
  }
  let document: unknown;
  try {
    document = JSON.parse(input.text) as unknown;
  } catch {
    return { contracts: [], notices: ['The JSON contract source is malformed and was not inspected.'] };
  }
  if (!isRecord(document)) {
    return { contracts: [], notices: ['The JSON document does not declare an object contract.'] };
  }

  const lineMap = new LineMap(input.text);
  const candidates: Array<{
    name: string;
    schema: Record<string, unknown>;
    layer: LensContractLayer;
    sourceKind: LensContractSourceKind;
    evidenceSource: string;
  }> = [];
  const components = isRecord(document.components) ? document.components : undefined;
  const openApiSchemas = components && isRecord(components.schemas) ? components.schemas : undefined;
  if (typeof document.openapi === 'string' && openApiSchemas) {
    for (const [name, value] of Object.entries(openApiSchemas).slice(0, MAX_CONTRACTS)) {
      if (isRecord(value)) {
        candidates.push({
          name,
          schema: value,
          layer: 'api',
          sourceKind: 'openapi',
          evidenceSource: 'OpenAPI component schema',
        });
      }
    }
  } else {
    const definitions = isRecord(document.$defs)
      ? document.$defs
      : isRecord(document.definitions) ? document.definitions : undefined;
    if (definitions) {
      for (const [name, value] of Object.entries(definitions).slice(0, MAX_CONTRACTS)) {
        if (isRecord(value)) {
          candidates.push({
            name,
            schema: value,
            layer: 'external',
            sourceKind: 'json-schema',
            evidenceSource: 'JSON Schema definition',
          });
        }
      }
    }
    if (isRecord(document.properties)) {
      candidates.unshift({
        name: fileStem(input.workspacePath),
        schema: document,
        layer: 'external',
        sourceKind: 'json-schema',
        evidenceSource: 'JSON Schema root object',
      });
    }
  }

  const contracts = candidates
    .slice(0, MAX_CONTRACTS)
    .map(candidate => buildJsonContract(input, candidate, lineMap))
    .filter((contract): contract is LensContract => Boolean(contract));
  return contracts.length > 0
    ? { contracts, notices: [] }
    : { contracts: [], notices: ['No supported OpenAPI component or JSON Schema object declarations were found.'] };
}

/** Extract a conservative subset of CREATE TABLE declarations without executing SQL. */
export function extractSqlContractSources(input: LensContractDocumentInput): LensContractExtraction {
  if (!isValidInput(input)) {
    return { contracts: [], notices: ['The SQL contract source was too large or had an invalid workspace location.'] };
  }
  const lineMap = new LineMap(input.text);
  const contracts: LensContract[] = [];
  const declaration = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*))?)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(input.text)) && contracts.length < MAX_CONTRACTS) {
    const openOffset = declaration.lastIndex - 1;
    const closeOffset = findClosingParenthesis(input.text, openOffset);
    if (closeOffset === undefined) {
      continue;
    }
    const qualifiedName = match[1] ?? '';
    const tableName = unquoteSqlIdentifier(qualifiedName.split('.').at(-1)?.trim() ?? '');
    if (!tableName) {
      continue;
    }
    const fields = splitSqlColumns(input.text, openOffset + 1, closeOffset)
      .map(segment => buildSqlField(input, tableName, segment, lineMap))
      .filter((field): field is LensContractField => Boolean(field));
    const target = sourceTarget(
      input,
      tableName,
      lineMap.range(match.index, closeOffset + 1),
      'Table',
    );
    const contract = normalizeLensContract({
      version: 1,
      id: `lens-contract:sql:${stableHash(`${input.workspace.index}:${input.workspacePath}:${qualifiedName}`)}`,
      label: tableName,
      layer: 'database',
      sourceKind: 'sql',
      coverage: 'partial',
      ...(target ? { target } : {}),
      fields,
    });
    if (contract) {
      contracts.push(contract);
    }
    declaration.lastIndex = closeOffset + 1;
  }
  return contracts.length > 0
    ? {
      contracts,
      notices: ['SQL extraction is heuristic and intentionally reports partial coverage; review dialect-specific declarations.'],
    }
    : { contracts: [], notices: ['No supported CREATE TABLE declarations were found.'] };
}

function buildJsonContract(
  input: LensContractDocumentInput,
  candidate: {
    name: string;
    schema: Record<string, unknown>;
    layer: LensContractLayer;
    sourceKind: LensContractSourceKind;
    evidenceSource: string;
  },
  lineMap: LineMap,
): LensContract | undefined {
  const properties = isRecord(candidate.schema.properties) ? candidate.schema.properties : undefined;
  if (!properties) {
    return undefined;
  }
  const required = new Set(
    Array.isArray(candidate.schema.required)
      ? candidate.schema.required.filter((value): value is string => typeof value === 'string')
      : [],
  );
  const contractRange = findUniqueJsonKeyRange(input.text, candidate.name, lineMap);
  const target = sourceTarget(input, candidate.name, contractRange, 'Object');
  const fields = Object.entries(properties)
    .slice(0, 500)
    .map(([path, raw]): LensContractField | undefined => {
      const schema = isRecord(raw) ? raw : {};
      const dataType = jsonDataType(schema);
      const format = typeof schema.format === 'string' ? schema.format : undefined;
      const nullability = jsonNullability(schema, dataType);
      const fieldRange = findUniqueJsonKeyRange(input.text, path, lineMap);
      const fieldTarget = sourceTarget(input, path, fieldRange, 'Field');
      return {
        id: `lens-contract-field:${stableHash(`${input.workspace.index}:${input.workspacePath}:${candidate.name}:${path}`)}`,
        path,
        label: path,
        dataType,
        ...(format ? { format } : {}),
        presence: required.has(path) ? 'required' : 'optional',
        nullability,
        ...(fieldTarget ? { target: fieldTarget } : {}),
        evidence: { kind: 'declared', source: candidate.evidenceSource, confidence: 1 },
      };
    })
    .filter((field): field is LensContractField => Boolean(field));
  return normalizeLensContract({
    version: 1,
    id: `lens-contract:${candidate.sourceKind}:${stableHash(`${input.workspace.index}:${input.workspacePath}:${candidate.name}`)}`,
    label: candidate.name,
    layer: candidate.layer,
    sourceKind: candidate.sourceKind,
    coverage: 'complete',
    ...(target ? { target } : {}),
    fields,
  });
}

interface SqlColumnSegment {
  text: string;
  startOffset: number;
  endOffset: number;
}

function buildSqlField(
  input: LensContractDocumentInput,
  tableName: string,
  segment: SqlColumnSegment,
  lineMap: LineMap,
): LensContractField | undefined {
  const leading = segment.text.search(/\S/);
  if (leading < 0) {
    return undefined;
  }
  const text = segment.text.slice(leading).trim();
  if (/^(?:CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|KEY|INDEX|EXCLUDE)\b/i.test(text)) {
    return undefined;
  }
  const nameMatch = /^("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s+/.exec(text);
  if (!nameMatch) {
    return undefined;
  }
  const path = unquoteSqlIdentifier(nameMatch[1] ?? '');
  const rest = text.slice(nameMatch[0].length);
  const constraint = /\s+(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|REFERENCES|DEFAULT|UNIQUE|CHECK|CONSTRAINT|COLLATE|GENERATED)\b/i.exec(rest);
  const declaredType = (constraint ? rest.slice(0, constraint.index) : rest).trim();
  if (!path || !declaredType) {
    return undefined;
  }
  const required = /\bNOT\s+NULL\b/i.test(rest) || /\bPRIMARY\s+KEY\b/i.test(rest);
  const rangeStart = segment.startOffset + leading;
  const target = sourceTarget(input, path, lineMap.range(rangeStart, segment.endOffset), 'Field');
  return {
    id: `lens-contract-field:${stableHash(`${input.workspace.index}:${input.workspacePath}:${tableName}:${path}`)}`,
    path,
    label: path,
    dataType: canonicalSqlType(declaredType),
    presence: required ? 'required' : 'optional',
    nullability: required ? 'non-null' : 'nullable',
    ...(target ? { target } : {}),
    evidence: { kind: 'declared', source: 'SQL CREATE TABLE declaration', confidence: 1 },
  };
}

function splitSqlColumns(text: string, startOffset: number, endOffset: number): SqlColumnSegment[] {
  const segments: SqlColumnSegment[] = [];
  let start = startOffset;
  let depth = 0;
  let quote: string | undefined;
  for (let index = startOffset; index < endOffset; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== '\\') {
        quote = undefined;
      }
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
    } else if (character === ',' && depth === 0) {
      segments.push({ text: text.slice(start, index), startOffset: start, endOffset: index });
      start = index + 1;
    }
  }
  segments.push({ text: text.slice(start, endOffset), startOffset: start, endOffset });
  return segments;
}

function findClosingParenthesis(text: string, openOffset: number): number | undefined {
  let depth = 0;
  let quote: string | undefined;
  for (let index = openOffset; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== '\\') {
        quote = undefined;
      }
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function jsonDataType(schema: Record<string, unknown>): string {
  if (typeof schema.$ref === 'string') {
    return `ref:${decodeJsonPointerTail(schema.$ref)}`;
  }
  const rawTypes = typeof schema.type === 'string'
    ? [schema.type]
    : Array.isArray(schema.type)
      ? schema.type.filter((value): value is string => typeof value === 'string')
      : [];
  const types = rawTypes.filter(type => type !== 'null');
  if (types.length === 0) {
    return Array.isArray(schema.enum) ? 'enum' : 'unknown';
  }
  return types.join('|');
}

function jsonNullability(schema: Record<string, unknown>, dataType: string): LensFieldNullability {
  if (schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes('null'))) {
    return 'nullable';
  }
  return dataType === 'unknown' ? 'unknown' : 'non-null';
}

function canonicalSqlType(value: string): string {
  const type = value.toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (/^(?:varchar|character varying|char|character|text|nvarchar|nchar|clob)$/.test(type)) {
    return 'string';
  }
  if (/^(?:smallint|integer|int|bigint|serial|bigserial|tinyint)$/.test(type)) {
    return 'integer';
  }
  if (/^(?:numeric|decimal|real|float|double precision|money)$/.test(type)) {
    return 'number';
  }
  if (/^(?:bool|boolean)$/.test(type)) {
    return 'boolean';
  }
  if (/^(?:timestamp|timestamp with time zone|timestamp without time zone|datetime)$/.test(type)) {
    return 'timestamp';
  }
  return type || 'unknown';
}

function sourceTarget(
  input: LensContractDocumentInput,
  label: string,
  range: LensSourceRange | undefined,
  symbolKind: string,
): LensVisualTarget | undefined {
  try {
    return createSourceLensTarget({
      kind: range ? 'code-range' : 'file',
      label,
      workspace: input.workspace,
      workspacePath: input.workspacePath,
      ...(range ? { range } : {}),
      symbolKind,
    });
  } catch {
    return undefined;
  }
}

function findUniqueJsonKeyRange(text: string, key: string, lineMap: LineMap): LensSourceRange | undefined {
  const token = JSON.stringify(key);
  const first = text.indexOf(token);
  return first >= 0 && text.indexOf(token, first + token.length) < 0
    ? lineMap.range(first, first + token.length)
    : undefined;
}

function decodeJsonPointerTail(value: string): string {
  const tail = value.split('/').at(-1) ?? value;
  return tail.replace(/~1/g, '/').replace(/~0/g, '~').slice(0, 200) || 'unknown';
}

function fileStem(workspacePath: string): string {
  const fileName = workspacePath.split('/').at(-1) ?? workspacePath;
  return fileName.replace(/\.[^.]+$/, '') || fileName;
}

function unquoteSqlIdentifier(value: string): string {
  const text = value.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('`') && text.endsWith('`')) ||
    (text.startsWith('[') && text.endsWith(']'))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function isValidInput(input: LensContractDocumentInput): boolean {
  return typeof input.text === 'string' &&
    new TextEncoder().encode(input.text).length <= MAX_SOURCE_BYTES &&
    normalizeWorkspacePath(input.workspacePath) !== undefined &&
    typeof input.workspace.name === 'string' &&
    input.workspace.name.length > 0 &&
    input.workspace.name.length <= 160 &&
    !/[\u0000-\u001f\u007f]/.test(input.workspace.name) &&
    Number.isInteger(input.workspace.index) &&
    input.workspace.index >= 0 &&
    input.workspace.index <= 10_000;
}

function normalizeWorkspacePath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_000 || /[\u0000-\u001f\u007f]/.test(value)) {
    return undefined;
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    return undefined;
  }
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..')
    ? undefined
    : segments.join('/');
}

class LineMap {
  private readonly starts = [0];

  constructor(private readonly text: string) {
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '\n') {
        this.starts.push(index + 1);
      }
    }
  }

  public range(startOffset: number, endOffset: number): LensSourceRange {
    const start = this.position(startOffset);
    const end = this.position(Math.max(startOffset, endOffset));
    return {
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column,
    };
  }

  private position(offset: number): { line: number; column: number } {
    const bounded = Math.max(0, Math.min(this.text.length, offset));
    let low = 0;
    let high = this.starts.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if ((this.starts[middle] ?? 0) <= bounded) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const lineIndex = Math.max(0, high);
    return { line: lineIndex + 1, column: bounded - (this.starts[lineIndex] ?? 0) + 1 };
  }
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
