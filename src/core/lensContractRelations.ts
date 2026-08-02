import type {
  LensContract,
  LensContractRelation,
  LensContractRelationEndpoint,
  LensContractRelationKind,
  LensEvidence,
  LensEvidenceKind,
} from '../types.js';
import { normalizeLensTarget } from './lensTarget.js';

export const LENS_CONTRACT_MAX_RELATIONS = 500;

const RELATION_KINDS = new Set<LensContractRelationKind>([
  'foreign-key', 'reference', 'orm', 'resolver', 'loader', 'query',
]);
const EVIDENCE_KINDS = new Set<LensEvidenceKind>(['source', 'runtime', 'framework', 'declared', 'inferred']);

/** Normalize relation records before they enter a panel or chat target. */
export function normalizeLensContractRelations(value: unknown): LensContractRelation[] | undefined {
  if (!Array.isArray(value) || value.length > LENS_CONTRACT_MAX_RELATIONS) {
    return undefined;
  }
  const relations: LensContractRelation[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    const relation = normalizeRelation(candidate);
    if (!relation || ids.has(relation.id)) {
      return undefined;
    }
    ids.add(relation.id);
    relations.push(relation);
  }
  return relations;
}

/** Resolve uniquely named endpoints against the contracts discovered in the same workspace root. */
export function resolveLensContractRelations(
  relationCandidates: unknown,
  contractCandidates: LensContract[],
): LensContractRelation[] | undefined {
  const relations = normalizeLensContractRelations(relationCandidates);
  if (!relations) {
    return undefined;
  }
  return relations.map(relation => ({
    ...relation,
    from: resolveEndpoint(relation.from, relation, contractCandidates),
    to: resolveEndpoint(relation.to, relation, contractCandidates),
  }));
}

function normalizeRelation(value: unknown): LensContractRelation | undefined {
  if (!isRecord(value)) return undefined;
  const id = boundedExactText(value.id, 500);
  const kind = typeof value.kind === 'string' && RELATION_KINDS.has(value.kind as LensContractRelationKind)
    ? value.kind as LensContractRelationKind
    : undefined;
  const label = boundedText(value.label, 240);
  const from = normalizeEndpoint(value.from);
  const to = normalizeEndpoint(value.to);
  const target = value.target === undefined ? undefined : normalizeLensTarget(value.target);
  const evidence = normalizeEvidence(value.evidence);
  if (!id || !kind || !label || !from || !to || !evidence || (value.target !== undefined && !target)) {
    return undefined;
  }
  return { id, kind, label, from, to, ...(target ? { target } : {}), evidence };
}

function normalizeEndpoint(value: unknown): LensContractRelationEndpoint | undefined {
  if (!isRecord(value)) return undefined;
  const contractLabel = boundedText(value.contractLabel, 240);
  const fieldPath = boundedExactText(value.fieldPath, 400);
  const contractId = value.contractId === undefined ? undefined : boundedExactText(value.contractId, 500);
  const fieldId = value.fieldId === undefined ? undefined : boundedExactText(value.fieldId, 500);
  if (!contractLabel || !fieldPath || (value.contractId !== undefined && !contractId) || (value.fieldId !== undefined && !fieldId)) {
    return undefined;
  }
  return { contractLabel, fieldPath, ...(contractId ? { contractId } : {}), ...(fieldId ? { fieldId } : {}) };
}

function resolveEndpoint(
  endpoint: LensContractRelationEndpoint,
  relation: LensContractRelation,
  contracts: LensContract[],
): LensContractRelationEndpoint {
  if (endpoint.contractId && endpoint.fieldId) {
    return endpoint;
  }
  const candidates = contracts.filter(contract =>
    sameWorkspace(contract, relation) &&
    normalizeSqlName(contract.label) === normalizeSqlName(endpoint.contractLabel),
  );
  if (candidates.length !== 1) {
    return endpoint;
  }
  const contract = candidates[0]!;
  const fields = contract.fields.filter(field => normalizeSqlName(field.path) === normalizeSqlName(endpoint.fieldPath));
  return {
    ...endpoint,
    contractId: endpoint.contractId ?? contract.id,
    ...(endpoint.fieldId ? { fieldId: endpoint.fieldId } : fields.length === 1 ? { fieldId: fields[0]!.id } : {}),
  };
}

function sameWorkspace(contract: LensContract, relation: LensContractRelation): boolean {
  const left = contract.target?.workspace;
  const right = relation.target?.workspace;
  return Boolean(left && right && left.name === right.name && left.index === right.index);
}

function normalizeSqlName(value: string): string {
  return value.trim().replace(/^["`\[]|["`\]]$/g, '').split('.').at(-1)?.toLowerCase() ?? value.toLowerCase();
}

function normalizeEvidence(value: unknown): LensEvidence | undefined {
  if (!isRecord(value)) return undefined;
  const kind = typeof value.kind === 'string' && EVIDENCE_KINDS.has(value.kind as LensEvidenceKind)
    ? value.kind as LensEvidenceKind
    : undefined;
  const source = boundedText(value.source, 160);
  if (!kind || !source) return undefined;
  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
    ? Math.max(0, Math.min(1, value.confidence))
    : undefined;
  return { kind, source, ...(confidence !== undefined ? { confidence } : {}) };
}

function boundedExactText(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : undefined;
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximum) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
