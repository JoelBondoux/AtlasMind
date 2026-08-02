import type {
  LensContract,
  LensContractField,
  LensContractRelation,
  LensContractReview,
  LensEvidence,
  LensFieldWire,
  LensSchemaChangeImpact,
  LensSchemaChangeKind,
  LensSchemaImpactCategory,
  LensSchemaImpactItem,
  LensSchemaImpactSeverity,
  LensVisualTarget,
} from '../types.js';
import { normalizeLensContract } from './lensContract.js';
import { normalizeLensContractRelations } from './lensContractRelations.js';
import { normalizeLensTarget } from './lensTarget.js';

export const LENS_SCHEMA_IMPACT_MAX_ITEMS = 80;

export interface LensSchemaImpactInput {
  upstream: LensContract;
  downstream: LensContract;
  review: LensContractReview;
  relations?: LensContractRelation[];
  seedFieldId: string;
  changeKind: LensSchemaChangeKind;
}

/**
 * Preview evidence-backed implications of a proposed field change inside the
 * currently selected contract boundary. This does not claim workspace-wide
 * callers/tests: those remain named unknowns until their adapters contribute.
 */
export function analyzeLensSchemaChangeImpact(candidate: LensSchemaImpactInput): LensSchemaChangeImpact {
  const upstream = normalizeLensContract(candidate.upstream);
  const downstream = normalizeLensContract(candidate.downstream);
  if (
    !upstream ||
    !downstream ||
    candidate.review.upstreamContractId !== upstream.id ||
    candidate.review.downstreamContractId !== downstream.id ||
    !isChangeKind(candidate.changeKind)
  ) {
    throw new Error('AtlasMind Lens refused an invalid schema change-impact input.');
  }
  const seedLocation = findField(candidate.seedFieldId, upstream, downstream);
  if (!seedLocation) {
    throw new Error('AtlasMind Lens could not resolve the schema change-impact seed field.');
  }

  const items: LensSchemaImpactItem[] = [];
  const ids = new Set<string>();
  addItem(items, ids, buildFieldItem(
    seedLocation.contract,
    seedLocation.field,
    candidate.changeKind,
    0,
    'review',
    seedLocation.field.evidence,
    `Selected ${seedLocation.contract.layer} field; the proposed ${candidate.changeKind} is not applied by this preview.`,
  ));

  const connectedWires = candidate.review.wires.filter(wire =>
    wire.fromFieldId === candidate.seedFieldId || wire.toFieldId === candidate.seedFieldId,
  );
  const hasResolvedConnection = connectedWires.some(wire =>
    wire.fromFieldId === candidate.seedFieldId ? Boolean(wire.toFieldId) : Boolean(wire.fromFieldId),
  );
  for (const wire of connectedWires) {
    addConnectedField(items, ids, wire, seedLocation.field.id, upstream, downstream, candidate.changeKind);
    if (wire.mappingKind) {
      addItem(items, ids, buildItem({
        key: `${wire.id}:mapping`,
        label: `${wire.mappingKind} mapping`,
        detail: `${wire.reason} Review .atlasmind/lens-mappings.json if the proposed change alters an endpoint or intent.`,
        category: 'mapping',
        severity: wire.status === 'unverified' ? 'high' : 'medium',
        proximity: 1,
        evidence: wire.evidence,
      }));
    }
  }

  const relations = normalizeLensContractRelations(candidate.relations ?? []);
  if (!relations) {
    throw new Error('AtlasMind Lens refused invalid schema relationship evidence.');
  }
  for (const relation of relations.filter(item =>
    item.from.fieldId === candidate.seedFieldId || item.to.fieldId === candidate.seedFieldId,
  )) {
    addItem(items, ids, buildItem({
      key: `${relation.id}:${candidate.changeKind}`,
      label: relation.label,
      detail: `Declared ${relation.kind} may be affected by the proposed ${candidate.changeKind}; review referential integrity, traversal code, and change ordering.`,
      category: 'relationship',
      severity: candidate.changeKind === 'remove' || candidate.changeKind === 'rename' || candidate.changeKind === 'type'
        ? 'high'
        : 'medium',
      proximity: 1,
      target: relation.target,
      evidence: relation.evidence,
    }));
  }

  addBoundaryRisks(items, ids, upstream, downstream, seedLocation.contract, seedLocation.field, candidate.changeKind);

  const ranked = items.sort(compareItems);
  const truncated = candidate.review.truncated || ranked.length > LENS_SCHEMA_IMPACT_MAX_ITEMS;
  return {
    version: 1,
    id: `lens-schema-impact:${stableHash(`${candidate.review.id}:${candidate.seedFieldId}:${candidate.changeKind}`)}`,
    seedContractId: seedLocation.contract.id,
    seedFieldId: seedLocation.field.id,
    changeKind: candidate.changeKind,
    items: ranked.slice(0, LENS_SCHEMA_IMPACT_MAX_ITEMS),
    notices: [
      'This preview is limited to the two selected contract declarations and their explicit field mappings.',
      'Tests, callers, runtime traces, migration history, and deployment state remain unknown until their Lens adapters contribute evidence.',
      'AtlasMind Lens does not edit the field, mapping file, migration, tests, or deployment configuration.',
      ...(!hasResolvedConnection
        ? ['No normalized wire connects the selected field to another declaration; that is missing evidence, not proof that the change has no consumers.']
        : []),
      ...(truncated ? ['The impact preview inherited a truncated wiring review or exceeded its item budget.'] : []),
    ],
    truncated,
  };
}

function addConnectedField(
  items: LensSchemaImpactItem[],
  ids: Set<string>,
  wire: LensFieldWire,
  seedFieldId: string,
  upstream: LensContract,
  downstream: LensContract,
  changeKind: LensSchemaChangeKind,
): void {
  const connectedId = wire.fromFieldId === seedFieldId ? wire.toFieldId : wire.fromFieldId;
  const connected = connectedId ? findField(connectedId, upstream, downstream) : undefined;
  if (!connected) {
    addItem(items, ids, buildItem({
      key: `${wire.id}:unknown-endpoint`,
      label: 'Unresolved connected endpoint',
      detail: `${wire.reason} The preview cannot identify a source-backed consumer at this boundary.`,
      category: 'contract',
      severity: wire.status === 'dropped' || wire.status === 'introduced' ? 'medium' : 'review',
      proximity: 1,
      evidence: wire.evidence,
    }));
    return;
  }
  addItem(items, ids, buildFieldItem(
    connected.contract,
    connected.field,
    changeKind,
    1,
    connectedSeverity(wire, changeKind, connected.field),
    wire.evidence,
    `${wire.status} wire: ${wire.reason}`,
  ));
}

function addBoundaryRisks(
  items: LensSchemaImpactItem[],
  ids: Set<string>,
  upstream: LensContract,
  downstream: LensContract,
  seedContract: LensContract,
  seedField: LensContractField,
  changeKind: LensSchemaChangeKind,
): void {
  const contracts = [upstream, downstream];
  if (contracts.some(contract => contract.layer === 'api') && isCompatibilityChange(changeKind)) {
    const api = contracts.find(contract => contract.layer === 'api')!;
    addItem(items, ids, buildItem({
      key: `${api.id}:api-compatibility:${changeKind}`,
      label: 'API compatibility review',
      detail: `A ${changeKind} can affect request/response consumers. Versioning and rollout compatibility are not inferred from declarations alone.`,
      category: changeKind === 'type' || changeKind === 'format' ? 'serialization' : 'contract',
      severity: 'high',
      proximity: api.id === seedContract.id ? 1 : 2,
      target: api.target,
      evidence: { kind: 'declared', source: `${api.sourceKind} contract boundary`, confidence: 1 },
    }));
  }
  if (contracts.some(contract => contract.layer === 'validator') || changeKind === 'presence' || changeKind === 'nullability') {
    addItem(items, ids, buildItem({
      key: `${seedContract.id}:validation:${changeKind}`,
      label: 'Validation behaviour review',
      detail: `A ${changeKind} may alter acceptance, defaults, or error paths. Runtime validator coverage is not yet proven by this preview.`,
      category: 'validation',
      severity: changeKind === 'presence' || changeKind === 'nullability' ? 'high' : 'medium',
      proximity: 2,
      target: seedField.target ?? seedContract.target,
      evidence: { kind: 'inferred', source: 'Schema change-impact rule' },
    }));
  }
  const database = contracts.find(contract => contract.layer === 'database');
  if (database) {
    addItem(items, ids, buildItem({
      key: `${database.id}:migration:${changeKind}`,
      label: 'Database migration review',
      detail: migrationDetail(changeKind),
      category: 'migration',
      severity: databaseSeverity(changeKind),
      proximity: database.id === seedContract.id ? 1 : 2,
      target: database.target,
      evidence: { kind: 'inferred', source: 'Database boundary change-impact rule' },
    }));
    if (changeKind === 'remove' || changeKind === 'rename' || changeKind === 'type' || changeKind === 'nullability') {
      addItem(items, ids, buildItem({
        key: `${database.id}:deployment:${changeKind}`,
        label: 'Deployment ordering and rollback',
        detail: 'Review expand/contract ordering, backfill requirements, mixed-version compatibility, and rollback before deployment.',
        category: 'deployment',
        severity: 'high',
        proximity: 2,
        target: database.target,
        evidence: { kind: 'inferred', source: 'Database deployment risk rule' },
      }));
    }
  }
}

function buildFieldItem(
  contract: LensContract,
  field: LensContractField,
  changeKind: LensSchemaChangeKind,
  proximity: number,
  severity: LensSchemaImpactSeverity,
  evidence: LensEvidence,
  reason: string,
): LensSchemaImpactItem {
  return buildItem({
    key: `${contract.id}:${field.id}:${changeKind}:${proximity}`,
    label: `${contract.label}.${field.path}`,
    detail: `${reason} Declared shape: ${field.dataType}${field.format ? `:${field.format}` : ''}, ${field.presence}, ${field.nullability}.`,
    category: contract.layer === 'api' || contract.layer === 'external' ? 'contract' :
      changeKind === 'type' || changeKind === 'format' ? 'serialization' : 'contract',
    severity,
    proximity,
    target: field.target ?? contract.target,
    evidence,
  });
}

function buildItem(input: {
  key: string;
  label: string;
  detail: string;
  category: LensSchemaImpactCategory;
  severity: LensSchemaImpactSeverity;
  proximity: number;
  target?: LensVisualTarget;
  evidence: LensEvidence;
}): LensSchemaImpactItem {
  const id = `lens-schema-impact-item:${stableHash(input.key)}`;
  const target = input.target ? normalizeLensTarget({
    ...input.target,
    id: `lens:schema-impact:${stableHash(`${id}:${input.target.id}`)}`,
    kind: 'schema',
    label: input.label,
    detail: `${input.category} · ${input.severity}: ${input.detail}`,
    evidence: input.evidence,
  }) : undefined;
  return {
    id,
    label: input.label.slice(0, 240),
    detail: input.detail.slice(0, 500),
    category: input.category,
    severity: input.severity,
    proximity: Math.max(0, Math.min(10, Math.trunc(input.proximity))),
    ...(target ? { target } : {}),
    evidence: input.evidence,
  };
}

function addItem(items: LensSchemaImpactItem[], ids: Set<string>, item: LensSchemaImpactItem): void {
  if (!ids.has(item.id)) {
    ids.add(item.id);
    items.push(item);
  }
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

function connectedSeverity(
  wire: LensFieldWire,
  changeKind: LensSchemaChangeKind,
  connected: LensContractField,
): LensSchemaImpactSeverity {
  if (wire.status === 'unverified' || wire.status === 'inferred') return 'review';
  if (changeKind === 'remove' || changeKind === 'rename' || changeKind === 'type') return 'high';
  if ((changeKind === 'presence' || changeKind === 'nullability') && connected.presence === 'required') return 'high';
  return 'medium';
}

function compareItems(left: LensSchemaImpactItem, right: LensSchemaImpactItem): number {
  const weight: Record<LensSchemaImpactSeverity, number> = { high: 0, medium: 1, review: 2 };
  return weight[left.severity] - weight[right.severity] ||
    left.proximity - right.proximity ||
    left.category.localeCompare(right.category) ||
    left.id.localeCompare(right.id);
}

function databaseSeverity(changeKind: LensSchemaChangeKind): LensSchemaImpactSeverity {
  return changeKind === 'remove' || changeKind === 'rename' || changeKind === 'type' || changeKind === 'nullability'
    ? 'high'
    : 'medium';
}

function migrationDetail(changeKind: LensSchemaChangeKind): string {
  if (changeKind === 'remove') return 'Check dependent queries, staged removal, data retention, and rollback before dropping a column.';
  if (changeKind === 'rename') return 'Check whether a staged add/copy/read-switch/drop sequence is needed for mixed application versions.';
  if (changeKind === 'type' || changeKind === 'format') return 'Check cast safety, invalid historical values, index/constraint rebuilds, and rollback.';
  if (changeKind === 'nullability' || changeKind === 'presence') return 'Check existing null/missing rows, backfill/default strategy, and constraint timing.';
  return 'Review the declaration and migration plan.';
}

function isCompatibilityChange(changeKind: LensSchemaChangeKind): boolean {
  return changeKind === 'rename' || changeKind === 'remove' || changeKind === 'type' ||
    changeKind === 'format' || changeKind === 'presence' || changeKind === 'nullability';
}

function isChangeKind(value: unknown): value is LensSchemaChangeKind {
  return value === 'rename' || value === 'remove' || value === 'type' || value === 'format' ||
    value === 'presence' || value === 'nullability';
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
