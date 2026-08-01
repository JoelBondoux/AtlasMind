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

/**
 * Extract a conservative subset of top-level TypeScript interface and object
 * type declarations. This is intentionally a syntax adapter rather than a type
 * checker: aliases and imported types remain references, and coverage is always
 * partial until a language-service adapter proves resolution.
 */
export function extractTypeScriptContractSources(input: LensContractDocumentInput): LensContractExtraction {
  if (!isValidInput(input)) {
    return { contracts: [], notices: ['The TypeScript contract source was too large or had an invalid workspace location.'] };
  }
  const lineMap = new LineMap(input.text);
  const masked = maskTypeScriptTrivia(input.text);
  const declarations = findTypeScriptObjectDeclarations(masked).slice(0, MAX_CONTRACTS);
  const contracts = declarations
    .map(declaration => buildTypeScriptContract(input, declaration, lineMap))
    .filter((contract): contract is LensContract => Boolean(contract));
  return contracts.length > 0
    ? {
      contracts,
      notices: [
        'TypeScript extraction is syntax-only and intentionally reports partial coverage; aliases, inheritance, mapped types, and runtime validators are not resolved.',
      ],
    }
    : { contracts: [], notices: ['No supported top-level TypeScript interface or object type declarations were found.'] };
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

interface TypeScriptObjectDeclaration {
  name: string;
  startOffset: number;
  openOffset: number;
  closeOffset: number;
}

function buildTypeScriptContract(
  input: LensContractDocumentInput,
  declaration: TypeScriptObjectDeclaration,
  lineMap: LineMap,
): LensContract | undefined {
  const fields = splitTypeScriptMembers(input.text, declaration.openOffset + 1, declaration.closeOffset)
    .slice(0, 500)
    .map(member => buildTypeScriptField(input, declaration.name, member, lineMap))
    .filter((field): field is LensContractField => Boolean(field));
  const target = sourceTarget(
    input,
    declaration.name,
    lineMap.range(declaration.startOffset, declaration.closeOffset + 1),
    'Interface',
  );
  return normalizeLensContract({
    version: 1,
    id: `lens-contract:typescript:${stableHash(`${input.workspace.index}:${input.workspacePath}:${declaration.name}`)}`,
    label: declaration.name,
    layer: inferTypeScriptLayer(input.workspacePath, declaration.name),
    sourceKind: 'typescript',
    coverage: 'partial',
    ...(target ? { target } : {}),
    fields,
  });
}

function buildTypeScriptField(
  input: LensContractDocumentInput,
  contractName: string,
  member: SqlColumnSegment,
  lineMap: LineMap,
): LensContractField | undefined {
  const content = stripLeadingTypeScriptTrivia(member.text);
  if (!content) {
    return undefined;
  }
  const text = content.text.replace(/[,;]$/, '').trimEnd();
  const match = /^(?:readonly\s+)?(?:([A-Za-z_$][\w$]*)|["']([^"']+)["'])(\?)?\s*:\s*([\s\S]+)$/.exec(text);
  const path = match?.[1] ?? match?.[2];
  const declaredType = match?.[4]?.trim();
  if (!path || !declaredType || path.length > 400 || /[\u0000-\u001f\u007f]/.test(path)) {
    return undefined;
  }
  const optional = match?.[3] === '?' || unionIncludesType(declaredType, 'undefined');
  const nullable = unionIncludesType(declaredType, 'null');
  const target = sourceTarget(
    input,
    path,
    lineMap.range(member.startOffset + content.offset, member.endOffset),
    'Field',
  );
  return {
    id: `lens-contract-field:${stableHash(`${input.workspace.index}:${input.workspacePath}:${contractName}:${path}`)}`,
    path,
    label: path,
    dataType: canonicalTypeScriptType(declaredType),
    presence: optional ? 'optional' : 'required',
    nullability: nullable ? 'nullable' : 'non-null',
    ...(target ? { target } : {}),
    evidence: { kind: 'declared', source: 'TypeScript object declaration', confidence: 0.8 },
  };
}

function stripLeadingTypeScriptTrivia(value: string): { text: string; offset: number } | undefined {
  let offset = 0;
  while (offset < value.length) {
    const whitespace = /^\s+/.exec(value.slice(offset));
    if (whitespace) {
      offset += whitespace[0].length;
      continue;
    }
    if (value.startsWith('//', offset)) {
      const newline = value.indexOf('\n', offset + 2);
      if (newline < 0) return undefined;
      offset = newline + 1;
      continue;
    }
    if (value.startsWith('/*', offset)) {
      const close = value.indexOf('*/', offset + 2);
      if (close < 0) return undefined;
      offset = close + 2;
      continue;
    }
    break;
  }
  const text = value.slice(offset).trimEnd();
  return text ? { text, offset } : undefined;
}

function findTypeScriptObjectDeclarations(masked: string): TypeScriptObjectDeclaration[] {
  const declarations: TypeScriptObjectDeclaration[] = [];
  const patterns = [
    /\b(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)(?:\s*<[^{};]*>)?(?:\s+extends\s+[^{};]+)?\s*\{/g,
    /\b(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)(?:\s*<[^{};=]*>)?\s*=\s*\{/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(masked)) && declarations.length < MAX_CONTRACTS * 2) {
      const openOffset = pattern.lastIndex - 1;
      const closeOffset = findClosingBrace(masked, openOffset);
      if (closeOffset !== undefined) {
        declarations.push({
          name: match[1] ?? '',
          startOffset: match.index,
          openOffset,
          closeOffset,
        });
        pattern.lastIndex = closeOffset + 1;
      }
    }
  }
  return declarations
    .filter(declaration => Boolean(declaration.name))
    .sort((left, right) => left.startOffset - right.startOffset);
}

function splitTypeScriptMembers(text: string, startOffset: number, endOffset: number): SqlColumnSegment[] {
  const segments: SqlColumnSegment[] = [];
  let start = startOffset;
  let roundDepth = 0;
  let squareDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let quote: string | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let index = startOffset; index < endOffset; index += 1) {
    const character = text[index] ?? '';
    const next = text[index + 1] ?? '';
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
      } else {
        continue;
      }
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === quote && text[index - 1] !== '\\') {
        quote = undefined;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') roundDepth += 1;
    else if (character === ')') roundDepth = Math.max(0, roundDepth - 1);
    else if (character === '[') squareDepth += 1;
    else if (character === ']') squareDepth = Math.max(0, squareDepth - 1);
    else if (character === '{') braceDepth += 1;
    else if (character === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (character === '<') angleDepth += 1;
    else if (character === '>') angleDepth = Math.max(0, angleDepth - 1);
    const atTopLevel = roundDepth === 0 && squareDepth === 0 && braceDepth === 0 && angleDepth === 0;
    if (atTopLevel && (character === ';' || character === ',' || character === '\n')) {
      if (text.slice(start, index).trim()) {
        segments.push({ text: text.slice(start, index), startOffset: start, endOffset: index });
      }
      start = index + 1;
    }
  }
  if (text.slice(start, endOffset).trim()) {
    segments.push({ text: text.slice(start, endOffset), startOffset: start, endOffset });
  }
  return segments;
}

function canonicalTypeScriptType(value: string): string {
  const members = splitTypeUnion(value)
    .map(member => stripOuterParentheses(member.trim()))
    .filter(member => member && member !== 'null' && member !== 'undefined');
  if (members.length > 1) {
    const literals = members.every(member => /^(?:["'][^"']*["']|-?\d+(?:\.\d+)?|true|false)$/.test(member));
    return literals ? 'enum' : members.map(canonicalTypeScriptType).join('|').slice(0, 240);
  }
  const type = members[0] ?? 'unknown';
  const array = /^(.*)\[\]$/.exec(type);
  const genericArray = /^(?:ReadonlyArray|Array)\s*<([\s\S]+)>$/.exec(type);
  if (array?.[1] || genericArray?.[1]) {
    return `array<${canonicalTypeScriptType((array?.[1] ?? genericArray?.[1]) as string)}>`;
  }
  if (/^(?:string|String)$/.test(type)) return 'string';
  if (/^(?:number|Number|bigint|BigInt)$/.test(type)) return 'number';
  if (/^(?:boolean|Boolean)$/.test(type)) return 'boolean';
  if (/^(?:Date)$/.test(type)) return 'timestamp';
  if (/^(?:unknown|any|never|void)$/.test(type)) return 'unknown';
  if (/^(?:Record\s*<|\{)/.test(type)) return 'object';
  if (/=>/.test(type)) return 'function';
  const reference = /^([A-Za-z_$][\w$]*)(?:\s*<.*>)?$/.exec(type)?.[1];
  return reference ? `ref:${reference}` : type.replace(/\s+/g, ' ').slice(0, 240) || 'unknown';
}

function splitTypeUnion(value: string): string[] {
  const members: string[] = [];
  let start = 0;
  let roundDepth = 0;
  let squareDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let quote: string | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') quote = character;
    else if (character === '(') roundDepth += 1;
    else if (character === ')') roundDepth = Math.max(0, roundDepth - 1);
    else if (character === '[') squareDepth += 1;
    else if (character === ']') squareDepth = Math.max(0, squareDepth - 1);
    else if (character === '{') braceDepth += 1;
    else if (character === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (character === '<') angleDepth += 1;
    else if (character === '>') angleDepth = Math.max(0, angleDepth - 1);
    else if (character === '|' && roundDepth === 0 && squareDepth === 0 && braceDepth === 0 && angleDepth === 0) {
      members.push(value.slice(start, index));
      start = index + 1;
    }
  }
  members.push(value.slice(start));
  return members;
}

function unionIncludesType(value: string, expected: string): boolean {
  return splitTypeUnion(value).some(member => stripOuterParentheses(member.trim()) === expected);
}

function stripOuterParentheses(value: string): string {
  let text = value;
  while (text.startsWith('(') && text.endsWith(')')) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function inferTypeScriptLayer(workspacePath: string, name: string): LensContractLayer {
  const signal = `${workspacePath} ${name}`.toLowerCase();
  if (/(?:^|[^a-z])(external|client|sdk)(?:[^a-z]|$)/.test(signal)) return 'external';
  if (/(?:^|[^a-z])(form|props|viewmodel|ui)(?:[^a-z]|$)/.test(signal)) return 'ui';
  if (/(?:^|[^a-z])(dto|request|response|api)(?:[^a-z]|$)/.test(signal)) return 'api';
  if (/(?:^|[^a-z])(entity|record|repository|persistence)(?:[^a-z]|$)/.test(signal)) return 'persistence';
  return 'domain';
}

function maskTypeScriptTrivia(text: string): string {
  // `split('')` preserves UTF-16 code-unit offsets used by VS Code ranges.
  const characters = text.split('');
  let quote: string | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index] ?? '';
    const next = characters[index + 1] ?? '';
    if (lineComment) {
      if (character === '\n') lineComment = false;
      else characters[index] = ' ';
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        characters[index] = ' ';
        characters[index + 1] = ' ';
        blockComment = false;
        index += 1;
      } else if (character !== '\n') {
        characters[index] = ' ';
      }
      continue;
    }
    if (quote) {
      if (character === quote && text[index - 1] !== '\\') quote = undefined;
      if (character !== '\n') characters[index] = ' ';
      continue;
    }
    if (character === '/' && next === '/') {
      characters[index] = ' ';
      characters[index + 1] = ' ';
      lineComment = true;
      index += 1;
    } else if (character === '/' && next === '*') {
      characters[index] = ' ';
      characters[index + 1] = ' ';
      blockComment = true;
      index += 1;
    } else if (character === '"' || character === "'" || character === '`') {
      characters[index] = ' ';
      quote = character;
    }
  }
  return characters.join('');
}

function findClosingBrace(text: string, openOffset: number): number | undefined {
  let depth = 0;
  for (let index = openOffset; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
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
