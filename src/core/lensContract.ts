import type {
  LensContract,
  LensContractCoverage,
  LensContractField,
  LensContractFieldRef,
  LensContractLayer,
  LensContractMappingFile,
  LensContractReview,
  LensContractSourceKind,
  LensEvidence,
  LensEvidenceKind,
  LensExplicitFieldMapping,
  LensFieldMappingKind,
  LensFieldNullability,
  LensFieldPresence,
  LensFieldSuppression,
  LensFieldWire,
  LensFieldWireStatus,
} from '../types.js';
import { normalizeLensTarget } from './lensTarget.js';

export const LENS_CONTRACT_MAPPING_FILE = '.atlasmind/lens-mappings.json';
export const LENS_CONTRACT_MAX_FIELDS = 500;
export const LENS_CONTRACT_MAX_MAPPINGS = 500;
export const LENS_CONTRACT_MAX_SUPPRESSIONS = 500;
export const LENS_CONTRACT_MAX_WIRES = 1_000;

const LAYERS = new Set<LensContractLayer>([
  'ui', 'api', 'validator', 'domain', 'persistence', 'database', 'external',
]);
const SOURCE_KINDS = new Set<LensContractSourceKind>([
  'typescript', 'openapi', 'json-schema', 'graphql', 'protobuf', 'validator', 'orm', 'sql', 'manual',
]);
const COVERAGE = new Set<LensContractCoverage>(['complete', 'partial', 'unknown']);
const PRESENCE = new Set<LensFieldPresence>(['required', 'optional', 'unknown']);
const NULLABILITY = new Set<LensFieldNullability>(['nullable', 'non-null', 'unknown']);
const MAPPING_KINDS = new Set<LensFieldMappingKind>([
  'equivalent', 'rename', 'transform', 'drop', 'introduce', 'inferred',
]);
const EVIDENCE_KINDS = new Set<LensEvidenceKind>(['source', 'runtime', 'framework', 'declared', 'inferred']);

const MAX_ID = 500;
const MAX_LABEL = 200;
const MAX_FIELD_PATH = 400;
const MAX_DATA_TYPE = 240;
const MAX_NOTE = 500;
const MAX_EVIDENCE_SOURCE = 160;
const UNMATCHED_NOTICE = 'Unmatched fields remain unverified; absence of a discovered wire is not proof of a drop or introduction.';

/** Normalize one adapter-produced contract before comparison or visualisation. */
export function normalizeLensContract(value: unknown): LensContract | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.fields) ||
    value.fields.length > LENS_CONTRACT_MAX_FIELDS
  ) {
    return undefined;
  }
  const id = boundedExactText(value.id, MAX_ID);
  const label = boundedText(value.label, MAX_LABEL);
  const layer = enumValue(value.layer, LAYERS);
  const sourceKind = enumValue(value.sourceKind, SOURCE_KINDS);
  const coverage = enumValue(value.coverage, COVERAGE);
  const target = value.target === undefined ? undefined : normalizeLensTarget(value.target);
  if (!id || !label || !layer || !sourceKind || !coverage || (value.target !== undefined && !target)) {
    return undefined;
  }

  const fields: LensContractField[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const candidate of value.fields) {
    const field = normalizeField(candidate);
    if (!field || ids.has(field.id) || paths.has(field.path)) {
      return undefined;
    }
    ids.add(field.id);
    paths.add(field.path);
    fields.push(field);
  }
  return {
    version: 1,
    id,
    label,
    layer,
    sourceKind,
    coverage,
    ...(target ? { target } : {}),
    fields,
  };
}

/** Normalize the optional, repository-authored mapping and suppression file. */
export function normalizeLensContractMappingFile(value: unknown): LensContractMappingFile | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.mappings) ||
    value.mappings.length > LENS_CONTRACT_MAX_MAPPINGS ||
    (value.suppressions !== undefined && !Array.isArray(value.suppressions))
  ) {
    return undefined;
  }
  const rawSuppressions = Array.isArray(value.suppressions) ? value.suppressions : [];
  if (rawSuppressions.length > LENS_CONTRACT_MAX_SUPPRESSIONS) {
    return undefined;
  }

  const mappings: LensExplicitFieldMapping[] = [];
  const mappingIds = new Set<string>();
  for (const candidate of value.mappings) {
    const mapping = normalizeMapping(candidate);
    if (!mapping || mappingIds.has(mapping.id)) {
      return undefined;
    }
    mappingIds.add(mapping.id);
    mappings.push(mapping);
  }

  const suppressions: LensFieldSuppression[] = [];
  const suppressionIds = new Set<string>();
  for (const candidate of rawSuppressions) {
    const suppression = normalizeSuppression(candidate);
    if (!suppression || suppressionIds.has(suppression.id)) {
      return undefined;
    }
    suppressionIds.add(suppression.id);
    suppressions.push(suppression);
  }
  return { version: 1, mappings, suppressions };
}

/** Deterministically compare two adjacent contract layers without inventing missing wires. */
export function reviewLensContractWiring(
  upstreamCandidate: unknown,
  downstreamCandidate: unknown,
  mappingCandidate: unknown = { version: 1, mappings: [], suppressions: [] },
): LensContractReview {
  const upstream = normalizeLensContract(upstreamCandidate);
  const downstream = normalizeLensContract(downstreamCandidate);
  const mappingFile = normalizeLensContractMappingFile(mappingCandidate);
  if (!upstream || !downstream || !mappingFile) {
    throw new Error('AtlasMind Lens refused an invalid contract-wiring review input.');
  }

  const upstreamByPath = new Map(upstream.fields.map(field => [field.path, field]));
  const downstreamByPath = new Map(downstream.fields.map(field => [field.path, field]));
  const usedUpstream = new Set<string>();
  const usedDownstream = new Set<string>();
  const wires: LensFieldWire[] = [];

  for (const mapping of mappingFile.mappings) {
    if (!mappingApplies(mapping, upstream.id, downstream.id)) {
      continue;
    }
    const fromField = mapping.from ? upstreamByPath.get(mapping.from.fieldPath) : undefined;
    const toField = mapping.to ? downstreamByPath.get(mapping.to.fieldPath) : undefined;
    if (fromField) {
      usedUpstream.add(fromField.id);
    }
    if (toField) {
      usedDownstream.add(toField.id);
    }
    wires.push(buildMappedWire(mapping, fromField, toField));
  }

  for (const fromField of upstream.fields) {
    if (usedUpstream.has(fromField.id)) {
      continue;
    }
    const toField = downstreamByPath.get(fromField.path);
    if (!toField || usedDownstream.has(toField.id)) {
      continue;
    }
    usedUpstream.add(fromField.id);
    usedDownstream.add(toField.id);
    const status = compareFieldShape(fromField, toField);
    wires.push(buildWire({
      status,
      from: fieldRef(upstream.id, fromField),
      to: fieldRef(downstream.id, toField),
      fromFieldId: fromField.id,
      toFieldId: toField.id,
      reason: status === 'exact'
        ? 'Field path, type, presence, and nullability match exactly.'
        : status === 'incompatible'
          ? describeIncompatibility(fromField, toField)
          : 'The field path matches, but one or more shape attributes lack enough evidence for compatibility.',
      evidence: { kind: 'declared', source: 'Normalized contract comparison', confidence: 1 },
      intentional: false,
    }));
  }

  for (const field of upstream.fields) {
    if (!usedUpstream.has(field.id)) {
      wires.push(buildWire({
        status: 'unverified',
        from: fieldRef(upstream.id, field),
        fromFieldId: field.id,
        reason: 'No verified downstream field or explicit mapping was found.',
        evidence: { kind: 'declared', source: 'AtlasMind contract review' },
        intentional: false,
      }));
    }
  }
  for (const field of downstream.fields) {
    if (!usedDownstream.has(field.id)) {
      wires.push(buildWire({
        status: 'unverified',
        to: fieldRef(downstream.id, field),
        toFieldId: field.id,
        reason: 'No verified upstream field or explicit mapping was found.',
        evidence: { kind: 'declared', source: 'AtlasMind contract review' },
        intentional: false,
      }));
    }
  }

  const reviewedWires = wires.map(wire => applySuppression(wire, mappingFile.suppressions));
  const truncated = reviewedWires.length > LENS_CONTRACT_MAX_WIRES;
  return {
    version: 1,
    id: `lens-contract-review:${stableHash(`${upstream.id}:${downstream.id}`)}`,
    upstreamContractId: upstream.id,
    downstreamContractId: downstream.id,
    wires: reviewedWires.slice(0, LENS_CONTRACT_MAX_WIRES),
    notices: [
      UNMATCHED_NOTICE,
      ...(truncated ? [`The review exceeded ${LENS_CONTRACT_MAX_WIRES} wires and was truncated.`] : []),
    ],
    truncated,
  };
}

function normalizeField(value: unknown): LensContractField | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = boundedExactText(value.id, MAX_ID);
  const path = boundedExactText(value.path, MAX_FIELD_PATH);
  const label = boundedText(value.label, MAX_LABEL);
  const dataType = boundedText(value.dataType, MAX_DATA_TYPE);
  const format = boundedText(value.format, MAX_DATA_TYPE);
  const presence = enumValue(value.presence, PRESENCE);
  const nullability = enumValue(value.nullability, NULLABILITY);
  const target = value.target === undefined ? undefined : normalizeLensTarget(value.target);
  const evidence = normalizeEvidence(value.evidence);
  if (
    !id || !path || !label || !dataType || !presence || !nullability || !evidence ||
    (value.target !== undefined && !target)
  ) {
    return undefined;
  }
  return {
    id,
    path,
    label,
    dataType,
    ...(format ? { format } : {}),
    presence,
    nullability,
    ...(target ? { target } : {}),
    evidence,
  };
}

function normalizeMapping(value: unknown): LensExplicitFieldMapping | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const kind = enumValue(value.kind, MAPPING_KINDS);
  const upstreamContractId = boundedExactText(value.upstreamContractId, MAX_ID);
  const downstreamContractId = boundedExactText(value.downstreamContractId, MAX_ID);
  const from = value.from === undefined ? undefined : normalizeFieldRef(value.from);
  const to = value.to === undefined ? undefined : normalizeFieldRef(value.to);
  if (
    !kind ||
    !upstreamContractId ||
    !downstreamContractId ||
    upstreamContractId === downstreamContractId ||
    (value.from !== undefined && !from) ||
    (value.to !== undefined && !to)
  ) {
    return undefined;
  }
  if ((kind === 'drop' && (!from || to)) || (kind === 'introduce' && (!to || from))) {
    return undefined;
  }
  if (kind !== 'drop' && kind !== 'introduce' && (!from || !to)) {
    return undefined;
  }
  if (from && from.contractId !== upstreamContractId) {
    return undefined;
  }
  if (to && to.contractId !== downstreamContractId) {
    return undefined;
  }
  const note = boundedText(value.note, MAX_NOTE);
  const generatedId = `lens-mapping:${stableHash(`${kind}:${upstreamContractId}:${downstreamContractId}:${refKey(from)}:${refKey(to)}`)}`;
  const id = value.id === undefined ? generatedId : boundedExactText(value.id, MAX_ID);
  return id
    ? {
      id,
      kind,
      upstreamContractId,
      downstreamContractId,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(note ? { note } : {}),
      intentional: value.intentional !== false,
    }
    : undefined;
}

function normalizeSuppression(value: unknown): LensFieldSuppression | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const field = normalizeFieldRef(value.field);
  const reason = boundedText(value.reason, MAX_NOTE);
  if (!field || !reason) {
    return undefined;
  }
  const generatedId = `lens-suppression:${stableHash(`${refKey(field)}:${reason}`)}`;
  const id = value.id === undefined ? generatedId : boundedExactText(value.id, MAX_ID);
  return id ? { id, field, reason } : undefined;
}

function normalizeFieldRef(value: unknown): LensContractFieldRef | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const contractId = boundedExactText(value.contractId, MAX_ID);
  const fieldPath = boundedExactText(value.fieldPath, MAX_FIELD_PATH);
  return contractId && fieldPath ? { contractId, fieldPath } : undefined;
}

function mappingApplies(mapping: LensExplicitFieldMapping, upstreamId: string, downstreamId: string): boolean {
  return mapping.upstreamContractId === upstreamId && mapping.downstreamContractId === downstreamId;
}

function buildMappedWire(
  mapping: LensExplicitFieldMapping,
  fromField: LensContractField | undefined,
  toField: LensContractField | undefined,
): LensFieldWire {
  const endpointMissing = (mapping.from && !fromField) || (mapping.to && !toField);
  let status: LensFieldWireStatus;
  if (endpointMissing) {
    status = 'unverified';
  } else if (mapping.kind === 'drop') {
    status = 'dropped';
  } else if (mapping.kind === 'introduce') {
    status = 'introduced';
  } else if (mapping.kind === 'inferred') {
    status = 'inferred';
  } else if (mapping.kind === 'transform') {
    status = 'transformed';
  } else {
    const shapeStatus = compareFieldShape(fromField!, toField!);
    status = shapeStatus === 'incompatible'
      ? 'incompatible'
      : shapeStatus === 'unverified'
        ? 'unverified'
        : mapping.kind === 'rename' ? 'transformed' : 'exact';
  }
  const defaultReason = endpointMissing
    ? `The explicit ${mapping.kind} mapping could not resolve every declared endpoint.`
    : mapping.kind === 'rename'
      ? 'Explicit field rename.'
      : mapping.kind === 'transform'
        ? 'Explicit field transformation.'
        : mapping.kind === 'drop'
          ? 'Explicit intentional drop.'
          : mapping.kind === 'introduce'
            ? 'Explicit intentional introduction.'
            : mapping.kind === 'inferred'
              ? 'Explicitly recorded inference.'
              : 'Explicit equivalent-field mapping.';
  return buildWire({
    status,
    ...(mapping.from ? { from: mapping.from } : {}),
    ...(mapping.to ? { to: mapping.to } : {}),
    ...(fromField ? { fromFieldId: fromField.id } : {}),
    ...(toField ? { toFieldId: toField.id } : {}),
    mappingKind: mapping.kind,
    reason: mapping.note ?? defaultReason,
    evidence: {
      kind: mapping.kind === 'inferred' ? 'inferred' : 'declared',
      source: LENS_CONTRACT_MAPPING_FILE,
      confidence: mapping.kind === 'inferred' ? undefined : 1,
    },
    intentional: mapping.intentional,
  });
}

function buildWire(input: Omit<LensFieldWire, 'id' | 'suppressed'>): LensFieldWire {
  const idSource = `${input.status}:${refKey(input.from)}:${refKey(input.to)}:${input.mappingKind ?? 'auto'}`;
  return {
    id: `lens-wire:${stableHash(idSource)}`,
    ...input,
    suppressed: false,
  };
}

function compareFieldShape(from: LensContractField, to: LensContractField): 'exact' | 'incompatible' | 'unverified' {
  if (
    from.dataType.toLowerCase() !== to.dataType.toLowerCase() ||
    (from.format && to.format && from.format.toLowerCase() !== to.format.toLowerCase()) ||
    (from.presence !== 'unknown' && to.presence !== 'unknown' && from.presence !== to.presence) ||
    (from.nullability !== 'unknown' && to.nullability !== 'unknown' && from.nullability !== to.nullability)
  ) {
    return 'incompatible';
  }
  if (
    from.presence === 'unknown' ||
    to.presence === 'unknown' ||
    from.nullability === 'unknown' ||
    to.nullability === 'unknown' ||
    Boolean(from.format) !== Boolean(to.format) ||
    from.dataType.toLowerCase() === 'unknown' ||
    to.dataType.toLowerCase() === 'unknown'
  ) {
    return 'unverified';
  }
  return 'exact';
}

function describeIncompatibility(from: LensContractField, to: LensContractField): string {
  const differences: string[] = [];
  if (from.dataType.toLowerCase() !== to.dataType.toLowerCase()) {
    differences.push(`type ${from.dataType} → ${to.dataType}`);
  }
  if (from.format && to.format && from.format.toLowerCase() !== to.format.toLowerCase()) {
    differences.push(`format ${from.format} → ${to.format}`);
  }
  if (from.presence !== 'unknown' && to.presence !== 'unknown' && from.presence !== to.presence) {
    differences.push(`presence ${from.presence} → ${to.presence}`);
  }
  if (from.nullability !== 'unknown' && to.nullability !== 'unknown' && from.nullability !== to.nullability) {
    differences.push(`nullability ${from.nullability} → ${to.nullability}`);
  }
  return `Matching field paths have incompatible declared shapes: ${differences.join(', ')}.`;
}

function applySuppression(wire: LensFieldWire, suppressions: LensFieldSuppression[]): LensFieldWire {
  const suppression = suppressions.find(candidate =>
    refsEqual(candidate.field, wire.from) || refsEqual(candidate.field, wire.to),
  );
  return suppression
    ? { ...wire, suppressed: true, suppressionReason: suppression.reason }
    : wire;
}

function fieldRef(contractId: string, field: LensContractField): LensContractFieldRef {
  return { contractId, fieldPath: field.path };
}

function refsEqual(left: LensContractFieldRef, right: LensContractFieldRef | undefined): boolean {
  return Boolean(right && left.contractId === right.contractId && left.fieldPath === right.fieldPath);
}

function refKey(ref: LensContractFieldRef | undefined): string {
  return ref ? `${ref.contractId}:${ref.fieldPath}` : '-';
}

function normalizeEvidence(value: unknown): LensEvidence | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const kind = enumValue(value.kind, EVIDENCE_KINDS);
  const source = boundedText(value.source, MAX_EVIDENCE_SOURCE);
  if (!kind || !source) {
    return undefined;
  }
  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
    ? Math.max(0, Math.min(1, value.confidence))
    : undefined;
  return { kind, source, ...(confidence !== undefined ? { confidence } : {}) };
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>): T | undefined {
  return typeof value === 'string' && values.has(value as T) ? value as T : undefined;
}

function boundedExactText(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : undefined;
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
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
