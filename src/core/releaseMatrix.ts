/**
 * The planned public shape of a product, independently of its shipped version history.
 *
 * A tier/edition/add-on is a column, a feature is a row, and a cell is an explicit
 * decision about that feature in that offering. Missing cells stay `unknown`: absence
 * is not the same claim as `not-offered`, and turning one into the other would make an
 * incomplete commercial plan look deliberately gated.
 *
 * This module is pure. The dashboard owns the tracked-file read/write boundary and
 * supplies the current roadmap nodes for relationship status.
 */

export const RELEASE_MATRIX_DOCUMENT_VERSION = 1;
export const RELEASE_MATRIX_RELATIVE_PATH = 'product/release-matrix.json';
export const MAX_RELEASE_MATRIX_TIERS = 24;
export const MAX_RELEASE_MATRIX_FEATURES = 250;
export const MAX_RELEASE_MATRIX_CELLS = 6_000;
export const MAX_RELEASE_MATRIX_FILE_LINKS = 12;

export const RELEASE_MATRIX_STATUSES = [
  'idea',
  'planned',
  'in-progress',
  'blocked',
  'ready',
  'released',
  'retired',
] as const;

export const RELEASE_MATRIX_CELL_STATUSES = [
  'not-offered',
  'planned',
  'in-progress',
  'blocked',
  'ready',
  'released',
] as const;

export const RELEASE_MATRIX_TIER_KINDS = [
  'tier',
  'expansion',
  'dlc',
  'plugin',
  'bonus',
  'custom',
] as const;

export type ReleaseMatrixStatus = typeof RELEASE_MATRIX_STATUSES[number];
export type ReleaseMatrixCellStatus = typeof RELEASE_MATRIX_CELL_STATUSES[number];
export type ReleaseMatrixTierKind = typeof RELEASE_MATRIX_TIER_KINDS[number];

interface ReleaseMatrixBaseRecord {
  id: string;
  name: string;
  status: ReleaseMatrixStatus;
  notes?: string;
  fileLinks: string[];
  /** Durable roadmap graph id. Absence means no roadmap relationship was declared. */
  roadmapItemId?: string;
}

export interface ReleaseMatrixTier extends ReleaseMatrixBaseRecord {
  kind: ReleaseMatrixTierKind;
  releaseDate?: string;
  /** Deliberately free-form: one-off, monthly, regional, free, and revenue-share all occur. */
  pricing?: string;
}

export interface ReleaseMatrixFeature extends ReleaseMatrixBaseRecord {
  group?: string;
  /** GitHub issues intentionally associated with this feature. */
  issueNumbers: number[];
}

export interface ReleaseMatrixCell {
  tierId: string;
  featureId: string;
  status: ReleaseMatrixCellStatus;
  /** Limits, quantities, entitlement rules, platform notes, or other tier-specific detail. */
  parameters?: string;
  fileLinks: string[];
  roadmapItemId?: string;
}

export interface ReleaseMatrixDocument {
  version: typeof RELEASE_MATRIX_DOCUMENT_VERSION;
  updatedAt: string;
  tiers: ReleaseMatrixTier[];
  features: ReleaseMatrixFeature[];
  cells: ReleaseMatrixCell[];
}

export interface ReleaseMatrixRoadmapNode {
  id: string;
  text: string;
  completed: boolean;
}

export type ReleaseMatrixEntityRef =
  | { kind: 'tier'; tierId: string }
  | { kind: 'feature'; featureId: string }
  | { kind: 'cell'; tierId: string; featureId: string };

export interface ReleaseMatrixRoadmapLinkView {
  state: 'not-linked' | 'linked-open' | 'linked-complete' | 'missing';
  itemId?: string;
  text?: string;
}

export interface ReleaseMatrixIssueRecord {
  number: number;
  title: string;
  state: 'open' | 'closed';
}

export interface ReleaseMatrixIssueLinkView {
  number: number;
  state: 'not-assessed' | 'linked-open' | 'linked-closed' | 'missing';
  title?: string;
}

export interface ReleaseMatrixTierMetric {
  tierId: string;
  decidedCount: number;
  offeredCount: number;
  readyCount: number;
  blockedCount: number;
  decisionCoveragePercent?: number;
  readinessPercent?: number;
}

export interface ReleaseMatrixSnapshot {
  document: ReleaseMatrixDocument;
  totalCellCount: number;
  decidedCellCount: number;
  unknownCellCount: number;
  offeredCellCount: number;
  readyCellCount: number;
  blockedCellCount: number;
  roadmappedCount: number;
  decisionCoveragePercent?: number;
  statusCounts: Record<ReleaseMatrixCellStatus | 'unknown', number>;
  tierMetrics: ReleaseMatrixTierMetric[];
  roadmapLinks: Record<string, ReleaseMatrixRoadmapLinkView>;
  issueLinks: Record<string, ReleaseMatrixIssueLinkView[]>;
  summary: string;
}

export type ReleaseMatrixDocumentReading =
  | { kind: 'ok'; document: ReleaseMatrixDocument }
  | { kind: 'invalid'; document: ReleaseMatrixDocument; notice: string }
  | { kind: 'refused'; notice: string };

export interface ReleaseMatrixTierDraft {
  id?: string;
  name: string;
  kind: ReleaseMatrixTierKind;
  status: ReleaseMatrixStatus;
  releaseDate?: string;
  pricing?: string;
  notes?: string;
  fileLinks?: readonly string[];
}

export interface ReleaseMatrixFeatureDraft {
  id?: string;
  name: string;
  group?: string;
  status: ReleaseMatrixStatus;
  notes?: string;
  fileLinks?: readonly string[];
}

export interface ReleaseMatrixCellDraft {
  tierId: string;
  featureId: string;
  status: ReleaseMatrixCellStatus;
  parameters?: string;
  fileLinks?: readonly string[];
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optionalText(value: unknown, max: number): string | undefined {
  const normalized = text(value, max);
  return normalized === '' ? undefined : normalized;
}

function id(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(normalized) ? normalized : undefined;
}

function roadmapId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(normalized) ? normalized : undefined;
}

function issueNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const result: number[] = [];
  for (const candidate of value) {
    const number = typeof candidate === 'number' && Number.isSafeInteger(candidate) ? candidate : 0;
    if (number > 0 && number <= 2_147_483_647 && !result.includes(number)) result.push(number);
    if (result.length >= 12) break;
  }
  return result;
}

function member<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? value : undefined;
}

/**
 * Keep file links workspace-relative before they ever reach the host opener.
 * A line anchor is retained, while absolute paths, URL schemes and traversal are refused.
 */
export function normalizeReleaseMatrixFileLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\\/g, '/').slice(0, 400);
  if (trimmed === '' || trimmed.includes('\0') || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return undefined;
  const match = /^(.*?)(#L\d+(?:-L?\d+)?)?$/i.exec(trimmed);
  const relative = (match?.[1] ?? '').replace(/^\.\//, '');
  const anchor = match?.[2] ?? '';
  if (relative === '' || relative.startsWith('/') || /^[a-z]:/i.test(relative)) return undefined;
  if (relative.split('/').some(segment => segment === '..' || segment === '')) return undefined;
  return `${relative}${anchor}`;
}

function fileLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of value) {
    const normalized = normalizeReleaseMatrixFileLink(candidate);
    if (normalized !== undefined && !seen.has(normalized)) {
      result.push(normalized);
      seen.add(normalized);
    }
    if (result.length >= MAX_RELEASE_MATRIX_FILE_LINKS) break;
  }
  return result;
}

function currentIso(value: unknown): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date(0).toISOString();
}

export function emptyReleaseMatrixDocument(now = new Date(0)): ReleaseMatrixDocument {
  return {
    version: RELEASE_MATRIX_DOCUMENT_VERSION,
    updatedAt: now.toISOString(),
    tiers: [],
    features: [],
    cells: [],
  };
}

/** Sanitize one supported document without inventing relationships or decisions. */
function sanitizeReleaseMatrixDocument(value: unknown): ReleaseMatrixDocument {
  const source = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const tierIds = new Set<string>();
  const tiers: ReleaseMatrixTier[] = [];
  for (const raw of Array.isArray(source['tiers']) ? source['tiers'].slice(0, MAX_RELEASE_MATRIX_TIERS) : []) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const recordId = id(record['id']);
    const name = text(record['name'], 120);
    if (recordId === undefined || name === '' || tierIds.has(recordId)) continue;
    tierIds.add(recordId);
    const releaseDate = isoDate(record['releaseDate']);
    const pricing = optionalText(record['pricing'], 240);
    const notes = optionalText(record['notes'], 1_500);
    const linked = roadmapId(record['roadmapItemId']);
    tiers.push({
      id: recordId,
      name,
      kind: member(record['kind'], RELEASE_MATRIX_TIER_KINDS, 'tier'),
      status: member(record['status'], RELEASE_MATRIX_STATUSES, 'planned'),
      ...(releaseDate === undefined ? {} : { releaseDate }),
      ...(pricing === undefined ? {} : { pricing }),
      ...(notes === undefined ? {} : { notes }),
      fileLinks: fileLinks(record['fileLinks']),
      ...(linked === undefined ? {} : { roadmapItemId: linked }),
    });
  }

  const featureIds = new Set<string>();
  const features: ReleaseMatrixFeature[] = [];
  for (const raw of Array.isArray(source['features']) ? source['features'].slice(0, MAX_RELEASE_MATRIX_FEATURES) : []) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const recordId = id(record['id']);
    const name = text(record['name'], 160);
    if (recordId === undefined || name === '' || featureIds.has(recordId)) continue;
    featureIds.add(recordId);
    const group = optionalText(record['group'], 80);
    const notes = optionalText(record['notes'], 1_500);
    const linked = roadmapId(record['roadmapItemId']);
    features.push({
      id: recordId,
      name,
      status: member(record['status'], RELEASE_MATRIX_STATUSES, 'planned'),
      ...(group === undefined ? {} : { group }),
      ...(notes === undefined ? {} : { notes }),
      fileLinks: fileLinks(record['fileLinks']),
      issueNumbers: issueNumbers(record['issueNumbers']),
      ...(linked === undefined ? {} : { roadmapItemId: linked }),
    });
  }

  const cellKeys = new Set<string>();
  const cells: ReleaseMatrixCell[] = [];
  for (const raw of Array.isArray(source['cells']) ? source['cells'].slice(0, MAX_RELEASE_MATRIX_CELLS) : []) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const tierId = id(record['tierId']);
    const featureId = id(record['featureId']);
    if (tierId === undefined || featureId === undefined || !tierIds.has(tierId) || !featureIds.has(featureId)) continue;
    const key = `${featureId}:${tierId}`;
    if (cellKeys.has(key)) continue;
    cellKeys.add(key);
    const parameters = optionalText(record['parameters'], 1_000);
    const linked = roadmapId(record['roadmapItemId']);
    cells.push({
      tierId,
      featureId,
      status: member(record['status'], RELEASE_MATRIX_CELL_STATUSES, 'planned'),
      ...(parameters === undefined ? {} : { parameters }),
      fileLinks: fileLinks(record['fileLinks']),
      ...(linked === undefined ? {} : { roadmapItemId: linked }),
    });
  }

  return {
    version: RELEASE_MATRIX_DOCUMENT_VERSION,
    updatedAt: currentIso(source['updatedAt']),
    tiers,
    features,
    cells,
  };
}

/** Refuse a future schema instead of sanitizing it into an older shape and overwriting it. */
export function interpretReleaseMatrixDocument(value: unknown): ReleaseMatrixDocumentReading {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      kind: 'invalid',
      document: emptyReleaseMatrixDocument(),
      notice: 'The editions file is not a JSON object. AtlasMind is showing an empty matrix and will not overwrite it until you save deliberately.',
    };
  }
  const version = (value as Record<string, unknown>)['version'];
  if (typeof version === 'number' && Number.isInteger(version) && version > RELEASE_MATRIX_DOCUMENT_VERSION) {
    return {
      kind: 'refused',
      notice: `The editions file uses schema v${version}; this AtlasMind understands v${RELEASE_MATRIX_DOCUMENT_VERSION}. It was left untouched.`,
    };
  }
  return { kind: 'ok', document: sanitizeReleaseMatrixDocument(value) };
}

function slug(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
}

function nextId(name: string, used: ReadonlySet<string>): string {
  const base = slug(name);
  if (!used.has(base)) return base;
  for (let index = 2; index <= used.size + 2; index += 1) {
    const candidate = `${base.slice(0, Math.max(1, 47 - String(index).length))}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  // Pigeonhole principle makes this unreachable: `used.size + 1` candidates
  // were checked against `used.size` distinct ids. Kept for totality.
  return `${base.slice(0, 38)}-next`;
}

function updated(document: ReleaseMatrixDocument, now: Date): ReleaseMatrixDocument {
  return sanitizeReleaseMatrixDocument({ ...document, updatedAt: now.toISOString() });
}

export function upsertReleaseMatrixTier(
  document: ReleaseMatrixDocument,
  draft: ReleaseMatrixTierDraft,
  now = new Date(),
): { document: ReleaseMatrixDocument; id: string } | undefined {
  const name = text(draft.name, 120);
  if (name === '') return undefined;
  const existingId = draft.id === undefined ? undefined : id(draft.id);
  const existing = existingId === undefined ? undefined : document.tiers.find(entry => entry.id === existingId);
  if (draft.id !== undefined && existing === undefined) return undefined;
  if (existing === undefined && document.tiers.length >= MAX_RELEASE_MATRIX_TIERS) return undefined;
  const recordId = existing?.id ?? nextId(name, new Set(document.tiers.map(entry => entry.id)));
  const releaseDate = isoDate(draft.releaseDate);
  const pricing = optionalText(draft.pricing, 240);
  const notes = optionalText(draft.notes, 1_500);
  const record: ReleaseMatrixTier = {
    id: recordId,
    name,
    kind: member(draft.kind, RELEASE_MATRIX_TIER_KINDS, 'tier'),
    status: member(draft.status, RELEASE_MATRIX_STATUSES, 'planned'),
    ...(releaseDate === undefined ? {} : { releaseDate }),
    ...(pricing === undefined ? {} : { pricing }),
    ...(notes === undefined ? {} : { notes }),
    fileLinks: fileLinks(draft.fileLinks ?? []),
    ...(existing?.roadmapItemId === undefined ? {} : { roadmapItemId: existing.roadmapItemId }),
  };
  const tiers = existing === undefined
    ? [...document.tiers, record]
    : document.tiers.map(entry => entry.id === recordId ? record : entry);
  return { document: updated({ ...document, tiers }, now), id: recordId };
}

export function removeReleaseMatrixTier(
  document: ReleaseMatrixDocument,
  tierId: string,
  now = new Date(),
): ReleaseMatrixDocument | undefined {
  const normalized = id(tierId);
  if (normalized === undefined || !document.tiers.some(entry => entry.id === normalized)) return undefined;
  return updated({
    ...document,
    tiers: document.tiers.filter(entry => entry.id !== normalized),
    cells: document.cells.filter(entry => entry.tierId !== normalized),
  }, now);
}

export function upsertReleaseMatrixFeature(
  document: ReleaseMatrixDocument,
  draft: ReleaseMatrixFeatureDraft,
  now = new Date(),
): { document: ReleaseMatrixDocument; id: string } | undefined {
  const name = text(draft.name, 160);
  if (name === '') return undefined;
  const existingId = draft.id === undefined ? undefined : id(draft.id);
  const existing = existingId === undefined ? undefined : document.features.find(entry => entry.id === existingId);
  if (draft.id !== undefined && existing === undefined) return undefined;
  if (existing === undefined && document.features.length >= MAX_RELEASE_MATRIX_FEATURES) return undefined;
  const recordId = existing?.id ?? nextId(name, new Set(document.features.map(entry => entry.id)));
  const group = optionalText(draft.group, 80);
  const notes = optionalText(draft.notes, 1_500);
  const record: ReleaseMatrixFeature = {
    id: recordId,
    name,
    status: member(draft.status, RELEASE_MATRIX_STATUSES, 'planned'),
    ...(group === undefined ? {} : { group }),
    ...(notes === undefined ? {} : { notes }),
    fileLinks: fileLinks(draft.fileLinks ?? []),
    issueNumbers: existing?.issueNumbers ?? [],
    ...(existing?.roadmapItemId === undefined ? {} : { roadmapItemId: existing.roadmapItemId }),
  };
  const features = existing === undefined
    ? [...document.features, record]
    : document.features.map(entry => entry.id === recordId ? record : entry);
  return { document: updated({ ...document, features }, now), id: recordId };
}

export function removeReleaseMatrixFeature(
  document: ReleaseMatrixDocument,
  featureId: string,
  now = new Date(),
): ReleaseMatrixDocument | undefined {
  const normalized = id(featureId);
  if (normalized === undefined || !document.features.some(entry => entry.id === normalized)) return undefined;
  return updated({
    ...document,
    features: document.features.filter(entry => entry.id !== normalized),
    cells: document.cells.filter(entry => entry.featureId !== normalized),
  }, now);
}

export function upsertReleaseMatrixCell(
  document: ReleaseMatrixDocument,
  draft: ReleaseMatrixCellDraft,
  now = new Date(),
): ReleaseMatrixDocument | undefined {
  const tierId = id(draft.tierId);
  const featureId = id(draft.featureId);
  if (tierId === undefined || featureId === undefined
    || !document.tiers.some(entry => entry.id === tierId)
    || !document.features.some(entry => entry.id === featureId)) return undefined;
  const existing = document.cells.find(entry => entry.tierId === tierId && entry.featureId === featureId);
  const parameters = optionalText(draft.parameters, 1_000);
  const record: ReleaseMatrixCell = {
    tierId,
    featureId,
    status: member(draft.status, RELEASE_MATRIX_CELL_STATUSES, 'planned'),
    ...(parameters === undefined ? {} : { parameters }),
    fileLinks: fileLinks(draft.fileLinks ?? []),
    ...(existing?.roadmapItemId === undefined ? {} : { roadmapItemId: existing.roadmapItemId }),
  };
  return updated({
    ...document,
    cells: existing === undefined
      ? [...document.cells, record]
      : document.cells.map(entry => entry.tierId === tierId && entry.featureId === featureId ? record : entry),
  }, now);
}

export function removeReleaseMatrixCell(
  document: ReleaseMatrixDocument,
  tierId: string,
  featureId: string,
  now = new Date(),
): ReleaseMatrixDocument | undefined {
  const normalizedTier = id(tierId);
  const normalizedFeature = id(featureId);
  if (normalizedTier === undefined || normalizedFeature === undefined) return undefined;
  if (!document.cells.some(entry => entry.tierId === normalizedTier && entry.featureId === normalizedFeature)) return undefined;
  return updated({
    ...document,
    cells: document.cells.filter(entry => entry.tierId !== normalizedTier || entry.featureId !== normalizedFeature),
  }, now);
}

function releaseMatrixEntityKey(ref: ReleaseMatrixEntityRef): string {
  if (ref.kind === 'tier') return `tier:${ref.tierId}`;
  if (ref.kind === 'feature') return `feature:${ref.featureId}`;
  return `cell:${ref.featureId}:${ref.tierId}`;
}

export function parseReleaseMatrixEntityKey(value: unknown): ReleaseMatrixEntityRef | undefined {
  if (typeof value !== 'string' || value.length > 170) return undefined;
  const parts = value.split(':');
  if (parts[0] === 'tier' && parts.length === 2 && id(parts[1]) !== undefined) {
    return { kind: 'tier', tierId: id(parts[1])! };
  }
  if (parts[0] === 'feature' && parts.length === 2 && id(parts[1]) !== undefined) {
    return { kind: 'feature', featureId: id(parts[1])! };
  }
  if (parts[0] === 'cell' && parts.length === 3 && id(parts[1]) !== undefined && id(parts[2]) !== undefined) {
    return { kind: 'cell', featureId: id(parts[1])!, tierId: id(parts[2])! };
  }
  return undefined;
}

export function resolveReleaseMatrixEntity(
  document: ReleaseMatrixDocument,
  ref: ReleaseMatrixEntityRef,
): { key: string; label: string; roadmapText: string; roadmapItemId?: string } | undefined {
  if (ref.kind === 'tier') {
    const tier = document.tiers.find(entry => entry.id === ref.tierId);
    return tier === undefined ? undefined : {
      key: releaseMatrixEntityKey(ref),
      label: tier.name,
      roadmapText: `Release offering: ${tier.name}`,
      ...(tier.roadmapItemId === undefined ? {} : { roadmapItemId: tier.roadmapItemId }),
    };
  }
  if (ref.kind === 'feature') {
    const feature = document.features.find(entry => entry.id === ref.featureId);
    return feature === undefined ? undefined : {
      key: releaseMatrixEntityKey(ref),
      label: feature.name,
      roadmapText: `Feature: ${feature.name}`,
      ...(feature.roadmapItemId === undefined ? {} : { roadmapItemId: feature.roadmapItemId }),
    };
  }
  const tier = document.tiers.find(entry => entry.id === ref.tierId);
  const feature = document.features.find(entry => entry.id === ref.featureId);
  const cell = document.cells.find(entry => entry.tierId === ref.tierId && entry.featureId === ref.featureId);
  if (tier === undefined || feature === undefined || cell === undefined) return undefined;
  return {
    key: releaseMatrixEntityKey(ref),
    label: `${feature.name} in ${tier.name}`,
    roadmapText: `${tier.name}: ${feature.name}${cell.parameters ? ` — ${cell.parameters}` : ''}`.slice(0, 300),
    ...(cell.roadmapItemId === undefined ? {} : { roadmapItemId: cell.roadmapItemId }),
  };
}

export function setReleaseMatrixRoadmapLink(
  document: ReleaseMatrixDocument,
  ref: ReleaseMatrixEntityRef,
  roadmapItemId: string | undefined,
  now = new Date(),
): ReleaseMatrixDocument | undefined {
  const normalized = roadmapItemId === undefined ? undefined : roadmapId(roadmapItemId);
  if (roadmapItemId !== undefined && normalized === undefined) return undefined;
  if (ref.kind === 'tier') {
    if (!document.tiers.some(entry => entry.id === ref.tierId)) return undefined;
    return updated({
      ...document,
      tiers: document.tiers.map(entry => entry.id === ref.tierId
        ? { ...entry, ...(normalized === undefined ? { roadmapItemId: undefined } : { roadmapItemId: normalized }) }
        : entry),
    }, now);
  }
  if (ref.kind === 'feature') {
    if (!document.features.some(entry => entry.id === ref.featureId)) return undefined;
    return updated({
      ...document,
      features: document.features.map(entry => entry.id === ref.featureId
        ? { ...entry, ...(normalized === undefined ? { roadmapItemId: undefined } : { roadmapItemId: normalized }) }
        : entry),
    }, now);
  }
  if (!document.cells.some(entry => entry.tierId === ref.tierId && entry.featureId === ref.featureId)) return undefined;
  return updated({
    ...document,
    cells: document.cells.map(entry => entry.tierId === ref.tierId && entry.featureId === ref.featureId
      ? { ...entry, ...(normalized === undefined ? { roadmapItemId: undefined } : { roadmapItemId: normalized }) }
      : entry),
  }, now);
}

/** Replace a feature's explicit issue relationships; callers own the user confirmation. */
export function setReleaseMatrixFeatureIssueLinks(
  document: ReleaseMatrixDocument,
  featureId: string,
  numbers: readonly number[],
  now = new Date(),
): ReleaseMatrixDocument | undefined {
  const normalized = id(featureId);
  if (normalized === undefined || !document.features.some(entry => entry.id === normalized)) return undefined;
  return updated({
    ...document,
    features: document.features.map(entry => entry.id === normalized
      ? { ...entry, issueNumbers: issueNumbers(numbers) }
      : entry),
  }, now);
}

/** Add source links during an import without replacing hand-edited fields. */
export function mergeReleaseMatrixFileLinks(
  document: ReleaseMatrixDocument,
  ref: ReleaseMatrixEntityRef,
  links: readonly string[],
  now = new Date(),
): ReleaseMatrixDocument | undefined {
  const merge = (current: readonly string[]): string[] => fileLinks([...current, ...links]);
  if (ref.kind === 'tier') {
    if (!document.tiers.some(entry => entry.id === ref.tierId)) return undefined;
    return updated({ ...document, tiers: document.tiers.map(entry => entry.id === ref.tierId
      ? { ...entry, fileLinks: merge(entry.fileLinks) } : entry) }, now);
  }
  if (ref.kind === 'feature') {
    if (!document.features.some(entry => entry.id === ref.featureId)) return undefined;
    return updated({ ...document, features: document.features.map(entry => entry.id === ref.featureId
      ? { ...entry, fileLinks: merge(entry.fileLinks) } : entry) }, now);
  }
  if (!document.cells.some(entry => entry.tierId === ref.tierId && entry.featureId === ref.featureId)) return undefined;
  return updated({ ...document, cells: document.cells.map(entry => entry.tierId === ref.tierId && entry.featureId === ref.featureId
    ? { ...entry, fileLinks: merge(entry.fileLinks) } : entry) }, now);
}

function roadmapLink(itemId: string | undefined, nodes: ReadonlyMap<string, ReleaseMatrixRoadmapNode>): ReleaseMatrixRoadmapLinkView {
  if (itemId === undefined) return { state: 'not-linked' };
  const node = nodes.get(itemId);
  if (node === undefined) return { state: 'missing', itemId };
  return {
    state: node.completed ? 'linked-complete' : 'linked-open',
    itemId,
    text: node.text,
  };
}

export function buildReleaseMatrixSnapshot(
  document: ReleaseMatrixDocument,
  roadmapNodes: readonly ReleaseMatrixRoadmapNode[] = [],
  issues?: readonly ReleaseMatrixIssueRecord[],
): ReleaseMatrixSnapshot {
  const normalized = sanitizeReleaseMatrixDocument(document);
  const byRoadmapId = new Map(roadmapNodes.map(node => [node.id, node]));
  const roadmapLinks: Record<string, ReleaseMatrixRoadmapLinkView> = {};
  const issueLinks: Record<string, ReleaseMatrixIssueLinkView[]> = {};
  const byIssueNumber = issues === undefined ? undefined : new Map(issues.map(issue => [issue.number, issue]));
  for (const tier of normalized.tiers) {
    roadmapLinks[releaseMatrixEntityKey({ kind: 'tier', tierId: tier.id })] = roadmapLink(tier.roadmapItemId, byRoadmapId);
  }
  for (const feature of normalized.features) {
    const key = releaseMatrixEntityKey({ kind: 'feature', featureId: feature.id });
    roadmapLinks[key] = roadmapLink(feature.roadmapItemId, byRoadmapId);
    issueLinks[key] = feature.issueNumbers.map(number => {
      if (byIssueNumber === undefined) return { number, state: 'not-assessed' };
      const issue = byIssueNumber.get(number);
      if (issue === undefined) return { number, state: 'missing' };
      return {
        number,
        state: issue.state === 'open' ? 'linked-open' : 'linked-closed',
        title: issue.title,
      };
    });
  }
  for (const cell of normalized.cells) {
    roadmapLinks[releaseMatrixEntityKey({ kind: 'cell', featureId: cell.featureId, tierId: cell.tierId })] = roadmapLink(cell.roadmapItemId, byRoadmapId);
  }

  const totalCellCount = normalized.tiers.length * normalized.features.length;
  const decidedCellCount = normalized.cells.length;
  const unknownCellCount = Math.max(0, totalCellCount - decidedCellCount);
  const offered = normalized.cells.filter(cell => cell.status !== 'not-offered');
  const readyCellCount = offered.filter(cell => cell.status === 'ready' || cell.status === 'released').length;
  const blockedCellCount = offered.filter(cell => cell.status === 'blocked').length;
  const statusCounts = Object.fromEntries(
    [...RELEASE_MATRIX_CELL_STATUSES, 'unknown'].map(status => [status, status === 'unknown'
      ? unknownCellCount
      : normalized.cells.filter(cell => cell.status === status).length]),
  ) as Record<ReleaseMatrixCellStatus | 'unknown', number>;
  const tierMetrics = normalized.tiers.map((tier): ReleaseMatrixTierMetric => {
    const cells = normalized.cells.filter(cell => cell.tierId === tier.id);
    const tierOffered = cells.filter(cell => cell.status !== 'not-offered');
    const readyCount = tierOffered.filter(cell => cell.status === 'ready' || cell.status === 'released').length;
    return {
      tierId: tier.id,
      decidedCount: cells.length,
      offeredCount: tierOffered.length,
      readyCount,
      blockedCount: tierOffered.filter(cell => cell.status === 'blocked').length,
      ...(normalized.features.length === 0 ? {} : {
        decisionCoveragePercent: Math.round((cells.length / normalized.features.length) * 100),
      }),
      ...(tierOffered.length === 0 ? {} : {
        readinessPercent: Math.round((readyCount / tierOffered.length) * 100),
      }),
    };
  });
  const roadmappedCount = Object.values(roadmapLinks).filter(link => link.state === 'linked-open' || link.state === 'linked-complete').length;

  return {
    document: normalized,
    totalCellCount,
    decidedCellCount,
    unknownCellCount,
    offeredCellCount: offered.length,
    readyCellCount,
    blockedCellCount,
    roadmappedCount,
    ...(totalCellCount === 0 ? {} : { decisionCoveragePercent: Math.round((decidedCellCount / totalCellCount) * 100) }),
    statusCounts,
    tierMetrics,
    roadmapLinks,
    issueLinks,
    summary: normalized.tiers.length === 0 && normalized.features.length === 0
      ? 'No editions or features are declared yet.'
      : `${normalized.tiers.length} offering${normalized.tiers.length === 1 ? '' : 's'} × ${normalized.features.length} feature${normalized.features.length === 1 ? '' : 's'} · ${decidedCellCount} explicit decision${decidedCellCount === 1 ? '' : 's'} · ${unknownCellCount} still unknown.`,
  };
}
