import type {
  LensContract,
  LensContractField,
  LensContractReview,
  LensDataClassification,
  LensDataControlKind,
  LensDataTrustFieldRule,
  LensDataTrustItem,
  LensDataTrustMap,
  LensDataTrustPolicyFile,
} from '../types.js';
import { normalizeLensContract } from './lensContract.js';
import { normalizeLensTarget } from './lensTarget.js';

export const LENS_DATA_TRUST_FILE = '.atlasmind/lens-data-trust.json';
export const LENS_DATA_TRUST_MAX_RULES = 500;
export const LENS_DATA_TRUST_MAX_ITEMS = 80;

const CLASSIFICATIONS = new Set<LensDataClassification>(['public', 'internal', 'confidential', 'restricted']);
const CONTROLS = new Set<LensDataControlKind>([
  'consent', 'authorization', 'redaction', 'encryption', 'retention', 'residency',
]);

export interface LensDataTrustInput {
  upstream: LensContract;
  downstream: LensContract;
  review: LensContractReview;
  policy: LensDataTrustPolicyFile;
  seedFieldId: string;
}

/** Normalize repository-authored trust metadata without accepting data or secret values. */
export function normalizeLensDataTrustPolicyFile(value: unknown): LensDataTrustPolicyFile | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.fields) || value.fields.length > LENS_DATA_TRUST_MAX_RULES) {
    return undefined;
  }
  const fields: LensDataTrustFieldRule[] = [];
  const ids = new Set<string>();
  const endpoints = new Set<string>();
  for (const candidate of value.fields) {
    const field = normalizeRule(candidate);
    const endpoint = field ? `${field.contractId}:${field.fieldPath}` : '';
    if (!field || ids.has(field.id) || endpoints.has(endpoint)) {
      return undefined;
    }
    ids.add(field.id);
    endpoints.add(endpoint);
    fields.push(field);
  }
  return { version: 1, fields };
}

/** Build a declared-vs-unknown trust map for the seed and its normalized connected endpoint(s). */
export function analyzeLensDataTrust(candidate: LensDataTrustInput): LensDataTrustMap {
  const upstream = normalizeLensContract(candidate.upstream);
  const downstream = normalizeLensContract(candidate.downstream);
  const policy = normalizeLensDataTrustPolicyFile(candidate.policy);
  if (
    !upstream || !downstream || !policy ||
    candidate.review.upstreamContractId !== upstream.id ||
    candidate.review.downstreamContractId !== downstream.id
  ) {
    throw new Error('AtlasMind Lens refused an invalid data-trust input.');
  }
  const seed = findField(candidate.seedFieldId, upstream, downstream);
  if (!seed) {
    throw new Error('AtlasMind Lens could not resolve the data-trust seed field.');
  }
  const locations = [seed];
  const connectedIds = new Set<string>();
  for (const wire of candidate.review.wires) {
    const connectedId = wire.fromFieldId === seed.field.id
      ? wire.toFieldId
      : wire.toFieldId === seed.field.id ? wire.fromFieldId : undefined;
    if (!connectedId || connectedIds.has(connectedId)) {
      continue;
    }
    const connected = findField(connectedId, upstream, downstream);
    if (connected) {
      connectedIds.add(connectedId);
      locations.push(connected);
    }
  }
  const rules = new Map(policy.fields.map(rule => [`${rule.contractId}:${rule.fieldPath}`, rule]));
  const items = locations.map((location, index) => buildItem(location.contract, location.field, rules, index === 0 ? 0 : 1));
  const truncated = candidate.review.truncated || items.length > LENS_DATA_TRUST_MAX_ITEMS;
  return {
    version: 1,
    id: `lens-data-trust:${stableHash(`${candidate.review.id}:${seed.field.id}`)}`,
    seedContractId: seed.contract.id,
    seedFieldId: seed.field.id,
    items: items.slice(0, LENS_DATA_TRUST_MAX_ITEMS),
    notices: [
      `Trust metadata comes only from ${LENS_DATA_TRUST_FILE}; AtlasMind does not infer sensitivity from field names or sample values.`,
      'Classification and control declarations are policy evidence, not runtime verification that a control is correctly implemented.',
      'An unknown classification or absent control is missing declared evidence, not proof that data is public or unprotected.',
      'This map reads no data values, secret values, database contents, runtime traffic, or provider telemetry and makes no edits.',
      ...(truncated ? ['The wiring review or trust item set reached its published budget; this is a bounded partial view.'] : []),
    ],
    truncated,
  };
}

function normalizeRule(value: unknown): LensDataTrustFieldRule | undefined {
  if (!isRecord(value) || !Array.isArray(value.controls) || value.controls.length > CONTROLS.size) {
    return undefined;
  }
  const id = boundedExactText(value.id, 500);
  const contractId = boundedExactText(value.contractId, 500);
  const fieldPath = boundedExactText(value.fieldPath, 400);
  const classification = typeof value.classification === 'string' && CLASSIFICATIONS.has(value.classification as LensDataClassification)
    ? value.classification as LensDataClassification
    : undefined;
  const controls: LensDataControlKind[] = [];
  const controlSet = new Set<LensDataControlKind>();
  for (const candidate of value.controls) {
    if (typeof candidate !== 'string' || !CONTROLS.has(candidate as LensDataControlKind) || controlSet.has(candidate as LensDataControlKind)) {
      return undefined;
    }
    controlSet.add(candidate as LensDataControlKind);
    controls.push(candidate as LensDataControlKind);
  }
  const note = value.note === undefined ? undefined : boundedText(value.note, 500);
  if (!id || !contractId || !fieldPath || !classification || (value.note !== undefined && !note)) {
    return undefined;
  }
  return { id, contractId, fieldPath, classification, controls, ...(note ? { note } : {}) };
}

function buildItem(
  contract: LensContract,
  field: LensContractField,
  rules: Map<string, LensDataTrustFieldRule>,
  proximity: number,
): LensDataTrustItem {
  const rule = rules.get(`${contract.id}:${field.path}`);
  const status = rule ? 'declared' : 'unknown';
  const detail = rule
    ? `${rule.classification} · declared controls: ${rule.controls.length > 0 ? rule.controls.join(', ') : 'none declared'}`
    : `unknown classification · no matching declaration in ${LENS_DATA_TRUST_FILE}`;
  const id = `lens-data-trust-item:${stableHash(`${contract.id}:${field.id}`)}`;
  const sourceTarget = field.target ?? contract.target;
  const target = sourceTarget ? normalizeLensTarget({
    ...sourceTarget,
    id,
    kind: 'schema',
    label: `${contract.label}.${field.path}`,
    detail,
    evidence: rule
      ? { kind: 'declared', source: LENS_DATA_TRUST_FILE, confidence: 1 }
      : field.evidence,
  }) : undefined;
  return {
    id,
    contractId: contract.id,
    fieldId: field.id,
    label: `${contract.label}.${field.path}`,
    status,
    ...(rule ? { classification: rule.classification } : {}),
    controls: rule?.controls ?? [],
    ...(rule?.note ? { note: rule.note } : {}),
    proximity,
    ...(target ? { target } : {}),
    evidence: rule
      ? { kind: 'declared', source: LENS_DATA_TRUST_FILE, confidence: 1 }
      : field.evidence,
  };
}

function findField(
  fieldId: string,
  upstream: LensContract,
  downstream: LensContract,
): { contract: LensContract; field: LensContractField } | undefined {
  for (const contract of [upstream, downstream]) {
    const field = contract.fields.find(candidate => candidate.id === fieldId);
    if (field) return { contract, field };
  }
  return undefined;
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
