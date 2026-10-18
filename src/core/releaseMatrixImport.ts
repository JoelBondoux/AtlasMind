/**
 * Discover and interpret product-design documents for the Editions matrix.
 *
 * This module deliberately guesses only into a preview. Candidate ranking,
 * parsing and relationship matching are deterministic, and the caller must put
 * the result in front of a person before applying it to the tracked matrix.
 */

import {
  mergeReleaseMatrixFileLinks,
  setReleaseMatrixFeatureIssueLinks,
  setReleaseMatrixRoadmapLink,
  upsertReleaseMatrixCell,
  upsertReleaseMatrixFeature,
  upsertReleaseMatrixTier,
  type ReleaseMatrixCellStatus,
  type ReleaseMatrixDocument,
  type ReleaseMatrixStatus,
  type ReleaseMatrixTierKind,
} from './releaseMatrix.js';

const MAX_SOURCE_TEXT = 600_000;
const MAX_CANDIDATES = 40;
const MAX_IMPORT_FEATURES = 250;
const MAX_IMPORT_TIERS = 24;
const MAX_IMPORT_CELLS = 6_000;

export interface ReleaseDesignSourceFile {
  path: string;
  content: string;
}

export interface ReleaseDesignCandidate {
  path: string;
  title: string;
  score: number;
  reasons: string[];
}

export interface ReleaseDesignImportTier {
  importId: string;
  name: string;
  kind: ReleaseMatrixTierKind;
  status: ReleaseMatrixStatus;
  pricing?: string;
  releaseDate?: string;
  sourceLine: number;
}

export interface ReleaseDesignImportFeature {
  importId: string;
  name: string;
  group?: string;
  notes?: string;
  sourceLine: number;
}

export interface ReleaseDesignImportCell {
  featureImportId: string;
  tierImportId: string;
  status: ReleaseMatrixCellStatus;
  parameters?: string;
  sourceLine: number;
}

export interface ReleaseDesignImportPlan {
  sourcePath: string;
  format: 'markdown' | 'structured-json';
  tiers: ReleaseDesignImportTier[];
  features: ReleaseDesignImportFeature[];
  cells: ReleaseDesignImportCell[];
  notices: string[];
}

export interface ReleaseDesignRoadmapCandidate {
  id: string;
  text: string;
  completed: boolean;
}

export interface ReleaseDesignIssueCandidate {
  number: number;
  title: string;
  state: 'open' | 'closed';
}

export interface ReleaseDesignRelationshipMatch<T> {
  target: T;
  score: number;
  confidence: 'strong' | 'possible';
  selectedByDefault: boolean;
}

export interface ReleaseDesignFeatureMatches {
  featureImportId: string;
  roadmap?: ReleaseDesignRelationshipMatch<ReleaseDesignRoadmapCandidate>;
  issue?: ReleaseDesignRelationshipMatch<ReleaseDesignIssueCandidate>;
}

export interface ReleaseDesignImportSelection {
  featureImportId: string;
  include: boolean;
  linkRoadmap: boolean;
  linkIssue: boolean;
}

export interface ReleaseDesignImportResult {
  document: ReleaseMatrixDocument;
  addedTiers: number;
  reusedTiers: number;
  addedFeatures: number;
  reusedFeatures: number;
  addedCells: number;
  preservedCells: number;
  roadmapLinksAdded: number;
  issueLinksAdded: number;
  skipped: string[];
}

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Strip markup from text that is meant to be plain.
 *
 * One pass of tag stripping is not sanitization: `<<b>script>` leaves
 * `<script>` behind. Stripping repeats until nothing changes, and then no
 * angle bracket survives at all, since these names are plain text.
 */
function stripTags(text: string): string {
  let current = text;
  let previous: string;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, '');
  } while (current !== previous);
  return current.replace(/[<>]/g, '');
}

function markdownText(value: string, max: number): string {
  return clean(stripTags(value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')), max);
}

function normalizedName(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function slug(value: string): string {
  return normalizedName(value).replace(/\s+/g, '-').slice(0, 40) || 'item';
}

function uniqueId(name: string, used: ReadonlySet<string>): string {
  const base = slug(name);
  if (!used.has(base)) return base;
  for (let index = 2; index <= used.size + 2; index += 1) {
    const candidate = `${base.slice(0, Math.max(1, 47 - String(index).length))}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base.slice(0, 38)}-next`;
}

function titleFromContent(file: ReleaseDesignSourceFile): string {
  const heading = file.content.slice(0, 12_000).match(/^#{1,3}\s+(.+)$/m)?.[1];
  if (heading) return markdownText(heading, 120);
  const name = file.path.split('/').pop() ?? file.path;
  return name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
}

/** Rank likely design inputs. A high score is an invitation to inspect, never permission to import. */
function scoreReleaseDesignCandidate(file: ReleaseDesignSourceFile): ReleaseDesignCandidate {
  const relative = file.path.replace(/\\/g, '/').slice(0, 400);
  const lowerPath = relative.toLowerCase();
  const sample = file.content.slice(0, 120_000).toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  const pathSignals: Array<[RegExp, number, string]> = [
    [/\b(tier|tiers|edition|editions|pricing|plans?)\b/, 34, 'the filename names product offerings'],
    [/\b(product|release|feature|features|capabilities)\b/, 22, 'the filename names product capabilities'],
    [/\broadmap\b/, 22, 'the filename identifies a roadmap'],
    [/\b(design|requirements?|spec|proposal|scope)\b/, 18, 'the filename looks like a design document'],
  ];
  for (const [pattern, points, reason] of pathSignals) {
    if (pattern.test(lowerPath.replace(/[-_.\/]+/g, ' '))) {
      score += points;
      reasons.push(reason);
    }
  }
  if (/^\s*\|[^\n]*(feature|capability)[^\n]*\|/im.test(file.content)
      && /^\s*\|?\s*:?-{3,}/m.test(file.content)) {
    score += 38;
    reasons.push('it contains a feature comparison table');
  }
  if (/^\s*\|[^\n]*(target\s+)?(package|tier|plan|edition|offering)s?[^\n]*\|/im.test(file.content)
      && /^\s*\|?\s*:?-{3,}/m.test(file.content)) {
    score += 38;
    reasons.push('it contains a tier-gate table');
  }
  if (/\b(free|student|pro|professional|premium|enterprise|starter|team)\b/.test(sample)) {
    score += 18;
    reasons.push('it names likely tiers');
  }
  if (/\b(dlc|expansion|plugin|add[- ]?on|bonus)\b/.test(sample)) {
    score += 12;
    reasons.push('it names add-on content');
  }
  if (/\b(price|pricing|per month|release date|availability|entitlement)\b/.test(sample)) {
    score += 10;
    reasons.push('it contains commercial or availability details');
  }
  if (/(^|\/)(changelog|license|package-lock|roadmap-graph)\b/.test(lowerPath)) score -= 45;
  if (lowerPath.endsWith('/product/release-matrix.json')) score = -100;
  return {
    path: relative,
    title: titleFromContent(file),
    score: Math.max(0, score),
    reasons: reasons.slice(0, 4),
  };
}

export function discoverReleaseDesignCandidates(files: readonly ReleaseDesignSourceFile[]): ReleaseDesignCandidate[] {
  return files
    .map(file => scoreReleaseDesignCandidate({ ...file, content: file.content.slice(0, MAX_SOURCE_TEXT) }))
    .filter(candidate => candidate.score >= 18)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, MAX_CANDIDATES);
}

function markdownRow(line: string): string[] {
  const source = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(markdownText(current, 1_000));
      current = '';
    } else {
      current += character;
    }
  }
  cells.push(markdownText(current, 1_000));
  return cells;
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
}

function splitTierGateNames(value: string): { names: string[]; featureList: string } | undefined {
  const cleaned = markdownText(value, 1_000);
  if (!cleaned) return undefined;
  const colon = cleaned.indexOf(':');
  const tierText = (colon < 0 ? cleaned : cleaned.slice(0, colon)).trim();
  const names = tierText
    .split(/\s*(?:\/|\+|&|\band\b)\s*/i)
    .map(name => markdownText(name.replace(/\s+(tier|plan|edition|package)$/i, ''), 120))
    .filter(Boolean);
  if (names.length === 0 || names.length > 6 || names.some(name => name.length > 60 || /[.!?;,]/.test(name))) return undefined;
  return { names, featureList: colon < 0 ? '' : cleaned.slice(colon + 1).trim() };
}

function splitDeclaredFeatureList(value: string): string[] {
  return value.split(/\s*[,;]\s*/)
    .map(feature => markdownText(feature.replace(/[.!?]+$/, ''), 160))
    .filter(Boolean);
}

function parseTierGateTable(
  lines: readonly string[],
  index: number,
  headers: readonly string[],
  builder: ImportPlanBuilder,
): boolean {
  const packageIndex = headers.findIndex(header => /^(?:target\s+)?(?:package|tier|plan|edition|offering)s?$/i.test(header));
  if (packageIndex < 0) return false;
  const explicitFeatureIndex = headers.findIndex(header => /^(?:features?|capabilities?|functions?|items?|feature set|included features?)$/i.test(header));
  const notesIndexes = headers.map((header, column) => ({ header, column }))
    .filter(({ header, column }) => column !== packageIndex && column !== explicitFeatureIndex
      && /^(?:market observation|roadmap response|notes?|description|rationale)$/i.test(header))
    .map(({ column }) => column);
  const initialCellCount = builder.cells.length;
  for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
    if (!lines[rowIndex]!.includes('|') || lines[rowIndex]!.trim() === '') break;
    const row = markdownRow(lines[rowIndex]!);
    if (row.length < headers.length) continue;
    const gate = splitTierGateNames(row[packageIndex] ?? '');
    if (!gate) continue;
    const featureNames = splitDeclaredFeatureList(gate.featureList || (explicitFeatureIndex < 0 ? '' : row[explicitFeatureIndex] ?? ''));
    if (featureNames.length === 0) continue;
    const tiers = gate.names.map(name => builder.tier(name, rowIndex + 1)).filter((tier): tier is ReleaseDesignImportTier => tier !== undefined);
    const notes = notesIndexes.map(column => row[column]).filter(Boolean).join(' — ');
    for (const featureName of featureNames) {
      const feature = builder.feature(featureName, rowIndex + 1, notes ? { notes } : {});
      if (!feature) continue;
      for (const tier of tiers) builder.cell(feature, tier, 'planned', rowIndex + 1);
    }
  }
  return builder.cells.length > initialCellCount;
}

function cellDecision(value: string): { status: ReleaseMatrixCellStatus; parameters?: string } | undefined {
  const cleaned = markdownText(value, 1_000);
  if (cleaned === '') return undefined;
  const normalized = normalizedName(cleaned);
  if (/^(?:no|none|n a|not available|not included|not offered|excluded|x)$/.test(normalized)
      || /^(?:❌|✕|—|-)$/.test(cleaned)) return { status: 'not-offered' };
  if (/\b(blocked|on hold)\b/.test(normalized)) return { status: 'blocked', parameters: cleaned };
  if (/\b(in progress|building|development)\b/.test(normalized)) return { status: 'in-progress', parameters: cleaned };
  if (/\b(ready|complete|completed)\b/.test(normalized)) return { status: 'ready', parameters: cleaned };
  if (/\b(released|live|available now|shipped)\b/.test(normalized)
      || /^(?:yes|included|available|✓|✅)$/.test(cleaned.toLowerCase())) return { status: 'released' };
  if (normalized === 'planned') return { status: 'planned' };
  if (/\b(coming soon|roadmap|later|future)\b/.test(normalized)) return { status: 'planned', parameters: cleaned };
  return { status: 'planned', parameters: cleaned };
}

function tierKind(name: string): ReleaseMatrixTierKind {
  const normalized = normalizedName(name);
  if (/\bdlc\b/.test(normalized)) return 'dlc';
  if (/\bexpansion\b/.test(normalized)) return 'expansion';
  if (/\bplugin\b|\badd on\b/.test(normalized)) return 'plugin';
  if (/\bbonus\b|\bfreebie\b/.test(normalized)) return 'bonus';
  return 'tier';
}

class ImportPlanBuilder {
  readonly tiers: ReleaseDesignImportTier[] = [];
  readonly features: ReleaseDesignImportFeature[] = [];
  readonly cells: ReleaseDesignImportCell[] = [];
  readonly notices: string[] = [];
  private readonly tierByName = new Map<string, ReleaseDesignImportTier>();
  private readonly featureByName = new Map<string, ReleaseDesignImportFeature>();
  private readonly cellKeys = new Set<string>();

  tier(name: string, sourceLine: number, details: Partial<Omit<ReleaseDesignImportTier, 'importId' | 'name' | 'sourceLine'>> = {}): ReleaseDesignImportTier | undefined {
    const cleaned = markdownText(name, 120);
    const key = normalizedName(cleaned);
    if (!key) return undefined;
    const existing = this.tierByName.get(key);
    if (existing) return existing;
    if (this.tiers.length >= MAX_IMPORT_TIERS) return undefined;
    const tier: ReleaseDesignImportTier = {
      importId: uniqueId(cleaned, new Set(this.tiers.map(entry => entry.importId))),
      name: cleaned,
      kind: details.kind ?? tierKind(cleaned),
      status: details.status ?? 'planned',
      ...(details.pricing ? { pricing: clean(details.pricing, 240) } : {}),
      ...(details.releaseDate ? { releaseDate: details.releaseDate } : {}),
      sourceLine,
    };
    this.tiers.push(tier);
    this.tierByName.set(key, tier);
    return tier;
  }

  feature(name: string, sourceLine: number, details: { group?: string; notes?: string } = {}): ReleaseDesignImportFeature | undefined {
    const cleaned = markdownText(name, 160);
    const key = normalizedName(cleaned);
    if (!key) return undefined;
    const existing = this.featureByName.get(key);
    if (existing) return existing;
    if (this.features.length >= MAX_IMPORT_FEATURES) return undefined;
    const feature: ReleaseDesignImportFeature = {
      importId: uniqueId(cleaned, new Set(this.features.map(entry => entry.importId))),
      name: cleaned,
      ...(details.group ? { group: clean(details.group, 80) } : {}),
      ...(details.notes ? { notes: clean(details.notes, 1_500) } : {}),
      sourceLine,
    };
    this.features.push(feature);
    this.featureByName.set(key, feature);
    return feature;
  }

  cell(feature: ReleaseDesignImportFeature, tier: ReleaseDesignImportTier, value: string, sourceLine: number): void {
    if (this.cells.length >= MAX_IMPORT_CELLS) return;
    const decision = cellDecision(value);
    const key = `${feature.importId}:${tier.importId}`;
    if (!decision || this.cellKeys.has(key)) return;
    this.cellKeys.add(key);
    this.cells.push({ featureImportId: feature.importId, tierImportId: tier.importId, ...decision, sourceLine });
  }
}

function parseMarkdownTables(lines: readonly string[], builder: ImportPlanBuilder): boolean {
  let found = false;
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!lines[index]!.includes('|') || !lines[index + 1]!.includes('|')) continue;
    const headers = markdownRow(lines[index]!);
    const separator = markdownRow(lines[index + 1]!);
    if (headers.length !== separator.length || !isSeparatorRow(separator)) continue;
    if (parseTierGateTable(lines, index, headers, builder)) {
      found = true;
      continue;
    }
    const featureIndex = headers.findIndex(header => /^(feature|capability|function|item)$/i.test(header));
    if (featureIndex < 0) continue;
    const metadata = new Set(['group', 'category', 'notes', 'note', 'description', 'status']);
    const tierIndexes = headers.map((header, column) => ({ header, column }))
      .filter(entry => entry.column !== featureIndex && !metadata.has(entry.header.toLowerCase()));
    if (tierIndexes.length === 0) continue;
    const tiers = tierIndexes.map(entry => ({ ...entry, tier: builder.tier(entry.header, index + 1) }))
      .filter((entry): entry is typeof entry & { tier: ReleaseDesignImportTier } => entry.tier !== undefined);
    const groupIndex = headers.findIndex(header => /^(group|category)$/i.test(header));
    const notesIndex = headers.findIndex(header => /^(notes?|description)$/i.test(header));
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      if (!lines[rowIndex]!.includes('|') || lines[rowIndex]!.trim() === '') break;
      const row = markdownRow(lines[rowIndex]!);
      if (row.length < headers.length) continue;
      const feature = builder.feature(row[featureIndex] ?? '', rowIndex + 1, {
        ...(groupIndex < 0 ? {} : { group: row[groupIndex] }),
        ...(notesIndex < 0 ? {} : { notes: row[notesIndex] }),
      });
      if (!feature) continue;
      for (const entry of tiers) builder.cell(feature, entry.tier, row[entry.column] ?? '', rowIndex + 1);
    }
    found = true;
  }
  return found;
}

function tierHeadingName(title: string, parentLooksLikeGroup: boolean): string | undefined {
  const cleaned = markdownText(title, 120);
  if (parentLooksLikeGroup) return cleaned.replace(/\s+(tier|plan|edition|package)$/i, '') || cleaned;
  if (!/\b(free|student|starter|basic|standard|plus|pro|professional|premium|team|business|enterprise|dlc|expansion|plugin|add[- ]?on|bonus)\b/i.test(cleaned)) return undefined;
  return cleaned.replace(/\s+(tier|plan|edition|package)$/i, '') || cleaned;
}

function parseMarkdownLists(lines: readonly string[], builder: ImportPlanBuilder): boolean {
  const headings = lines.map((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return match ? { index, level: match[1]!.length, title: markdownText(match[2]!, 160) } : undefined;
  }).filter((entry): entry is { index: number; level: number; title: string } => entry !== undefined);
  let found = false;
  for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
    const heading = headings[headingIndex]!;
    const parent = [...headings.slice(0, headingIndex)].reverse().find(candidate => candidate.level < heading.level);
    const parentLooksLikeGroup = parent !== undefined && /\b(tiers?|editions?|plans?|packages?|offerings?)\b/i.test(parent.title);
    const tierName = tierHeadingName(heading.title, parentLooksLikeGroup);
    const isFeatureSection = /\b(features?|capabilities)\b/i.test(heading.title);
    if (!tierName && !isFeatureSection) continue;
    const end = headings.slice(headingIndex + 1).find(candidate => candidate.level <= heading.level)?.index ?? lines.length;
    const tier = tierName ? builder.tier(tierName, heading.index + 1) : undefined;
    for (let lineIndex = heading.index + 1; lineIndex < end; lineIndex += 1) {
      const match = /^\s*[-*+]\s+(?:\[([ xX])\]\s*)?(.+)$/.exec(lines[lineIndex]!);
      if (!match) continue;
      const raw = markdownText(match[2]!, 1_000);
      if (!raw || /^(price|pricing|release date|status)\s*:/i.test(raw)) continue;
      const parts = raw.split(/\s+(?:—|–)\s+|\s*:\s*/, 2);
      const feature = builder.feature(parts[0] ?? raw, lineIndex + 1, parts[1] ? { notes: parts[1] } : {});
      if (!feature) continue;
      if (tier) builder.cell(feature, tier, match[1]?.toLowerCase() === 'x' ? 'released' : (parts[1] ?? 'planned'), lineIndex + 1);
      found = true;
    }
  }
  return found;
}

function jsonArray(source: Record<string, unknown>, names: readonly string[]): unknown[] {
  for (const name of names) if (Array.isArray(source[name])) return source[name] as unknown[];
  return [];
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseStructuredJson(content: string, builder: ImportPlanBuilder): boolean {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return false; }
  const source = objectRecord(parsed);
  if (!source) return false;
  const tierBySource = new Map<string, ReleaseDesignImportTier>();
  for (const raw of jsonArray(source, ['tiers', 'editions', 'offerings', 'plans'])) {
    const record = objectRecord(raw);
    const name = typeof raw === 'string' ? raw : record?.['name'];
    const tier = builder.tier(clean(name, 120), 1, {
      kind: tierKind(clean(record?.['kind'] ?? name, 120)),
      status: cellDecision(clean(record?.['status'], 80))?.status === 'released' ? 'released' : 'planned',
      ...(clean(record?.['pricing'] ?? record?.['price'], 240) ? { pricing: clean(record?.['pricing'] ?? record?.['price'], 240) } : {}),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(clean(record?.['releaseDate'], 10)) ? { releaseDate: clean(record?.['releaseDate'], 10) } : {}),
    });
    if (tier) tierBySource.set(normalizedName(tier.name), tier);
  }
  const featureBySource = new Map<string, ReleaseDesignImportFeature>();
  for (const raw of jsonArray(source, ['features', 'capabilities'])) {
    const record = objectRecord(raw);
    const name = typeof raw === 'string' ? raw : record?.['name'];
    const feature = builder.feature(clean(name, 160), 1, {
      group: clean(record?.['group'] ?? record?.['category'], 80),
      notes: clean(record?.['notes'] ?? record?.['description'], 1_500),
    });
    if (!feature) continue;
    featureBySource.set(normalizedName(feature.name), feature);
    const availability = objectRecord(record?.['tiers'] ?? record?.['availability']);
    for (const [tierName, value] of Object.entries(availability ?? {})) {
      const tier = tierBySource.get(normalizedName(tierName)) ?? builder.tier(tierName, 1);
      if (tier) builder.cell(feature, tier, typeof value === 'boolean' ? (value ? 'released' : 'not offered') : clean(value, 1_000), 1);
    }
  }
  for (const raw of jsonArray(source, ['cells', 'entitlements', 'availability'])) {
    const record = objectRecord(raw);
    if (!record) continue;
    const featureName = clean(record['feature'] ?? record['featureName'], 160);
    const tierName = clean(record['tier'] ?? record['edition'] ?? record['offering'], 120);
    const feature = featureBySource.get(normalizedName(featureName)) ?? builder.feature(featureName, 1);
    const tier = tierBySource.get(normalizedName(tierName)) ?? builder.tier(tierName, 1);
    if (feature && tier) builder.cell(feature, tier, clean(record['parameters'] ?? record['status'] ?? record['value'], 1_000), 1);
  }
  return builder.features.length > 0 || builder.tiers.length > 0;
}

/** Parse only declared structures; prose that merely mentions a feature remains a notice. */
export function parseReleaseDesignDocument(path: string, content: string): ReleaseDesignImportPlan {
  const sourcePath = path.replace(/\\/g, '/').slice(0, 400);
  const bounded = content.slice(0, MAX_SOURCE_TEXT);
  const builder = new ImportPlanBuilder();
  const structured = sourcePath.toLowerCase().endsWith('.json') && parseStructuredJson(bounded, builder);
  if (!structured) {
    const lines = bounded.replace(/\r\n/g, '\n').split('\n');
    const table = parseMarkdownTables(lines, builder);
    const list = parseMarkdownLists(lines, builder);
    if (!table && !list) builder.notices.push('No feature table or explicit feature list was found. Nothing has been inferred from prose.');
  }
  if (content.length > MAX_SOURCE_TEXT) builder.notices.push(`Only the first ${MAX_SOURCE_TEXT.toLocaleString('en-US')} characters were inspected.`);
  if (builder.tiers.length === 0) builder.notices.push('No offering columns were found; imported features can still be matched to existing matrix tiers later.');
  return {
    sourcePath,
    format: structured ? 'structured-json' : 'markdown',
    tiers: builder.tiers,
    features: builder.features,
    cells: builder.cells,
    notices: builder.notices,
  };
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'build', 'create', 'feature', 'for', 'implement', 'in', 'of', 'on', 'support', 'the', 'to', 'with']);

function matchTokens(value: string): string[] {
  return normalizedName(value).split(' ').filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

/** A conservative lexical score: exact and contained names win; shared generic words do not. */
export function releaseDesignRelationshipScore(featureName: string, targetText: string): number {
  const feature = normalizedName(featureName);
  const target = normalizedName(targetText);
  if (!feature || !target) return 0;
  if (feature === target) return 1;
  const featureTokens = new Set(matchTokens(feature));
  const targetTokens = new Set(matchTokens(target));
  if (featureTokens.size === 0 || targetTokens.size === 0) return 0;
  const shared = [...featureTokens].filter(token => targetTokens.has(token)).length;
  const coverage = shared / featureTokens.size;
  const precision = shared / targetTokens.size;
  const containment = target.includes(feature) || feature.includes(target) ? 0.12 : 0;
  return Math.min(0.99, Number((coverage * 0.68 + precision * 0.2 + containment).toFixed(3)));
}

function bestMatch<T>(featureName: string, candidates: readonly T[], text: (candidate: T) => string): ReleaseDesignRelationshipMatch<T> | undefined {
  const ranked = candidates.map(target => ({ target, score: releaseDesignRelationshipScore(featureName, text(target)) }))
    .filter(entry => entry.score >= 0.5).sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best) return undefined;
  const margin = best.score - (ranked[1]?.score ?? 0);
  const strong = best.score >= 0.72 && (ranked.length === 1 || margin >= 0.1);
  return { ...best, confidence: strong ? 'strong' : 'possible', selectedByDefault: strong };
}

export function matchReleaseDesignFeatures(
  plan: ReleaseDesignImportPlan,
  roadmap: readonly ReleaseDesignRoadmapCandidate[],
  issues: readonly ReleaseDesignIssueCandidate[],
): ReleaseDesignFeatureMatches[] {
  return plan.features.map(feature => {
    const roadmapMatch = bestMatch(feature.name, roadmap, candidate => candidate.text);
    const issueMatch = bestMatch(feature.name, issues, candidate => candidate.title);
    return {
      featureImportId: feature.importId,
      ...(roadmapMatch ? { roadmap: roadmapMatch } : {}),
      ...(issueMatch ? { issue: issueMatch } : {}),
    };
  });
}

function sourceLink(plan: ReleaseDesignImportPlan, line: number): string[] {
  return [`${plan.sourcePath}${line > 1 ? `#L${line}` : ''}`];
}

/** Merge reviewed import data without replacing any hand-edited matrix decision. */
export function applyReleaseDesignImport(
  document: ReleaseMatrixDocument,
  plan: ReleaseDesignImportPlan,
  matches: readonly ReleaseDesignFeatureMatches[],
  selections: readonly ReleaseDesignImportSelection[],
  now = new Date(),
): ReleaseDesignImportResult {
  let next = document;
  let addedTiers = 0;
  let reusedTiers = 0;
  let addedFeatures = 0;
  let reusedFeatures = 0;
  let addedCells = 0;
  let preservedCells = 0;
  let roadmapLinksAdded = 0;
  let issueLinksAdded = 0;
  const skipped: string[] = [];
  const selectionById = new Map(selections.map(selection => [selection.featureImportId, selection]));
  const selected = plan.features.filter(feature => selectionById.get(feature.importId)?.include === true);
  const tierIds = new Map<string, string>();
  const featureIds = new Map<string, string>();

  if (selected.length > 0) {
    for (const tier of plan.tiers) {
      const existing = next.tiers.find(entry => normalizedName(entry.name) === normalizedName(tier.name));
      if (existing) {
        reusedTiers += 1;
        tierIds.set(tier.importId, existing.id);
        next = mergeReleaseMatrixFileLinks(next, { kind: 'tier', tierId: existing.id }, sourceLink(plan, tier.sourceLine), now) ?? next;
        continue;
      }
      const added = upsertReleaseMatrixTier(next, {
        name: tier.name, kind: tier.kind, status: tier.status,
        ...(tier.pricing ? { pricing: tier.pricing } : {}),
        ...(tier.releaseDate ? { releaseDate: tier.releaseDate } : {}),
        fileLinks: sourceLink(plan, tier.sourceLine),
      }, now);
      if (!added) {
        skipped.push(`Offering “${tier.name}” could not be added because the matrix limit was reached.`);
        continue;
      }
      next = added.document;
      tierIds.set(tier.importId, added.id);
      addedTiers += 1;
    }
  }

  for (const feature of selected) {
    const existing = next.features.find(entry => normalizedName(entry.name) === normalizedName(feature.name));
    if (existing) {
      reusedFeatures += 1;
      featureIds.set(feature.importId, existing.id);
      next = mergeReleaseMatrixFileLinks(next, { kind: 'feature', featureId: existing.id }, sourceLink(plan, feature.sourceLine), now) ?? next;
    } else {
      const added = upsertReleaseMatrixFeature(next, {
        name: feature.name, status: 'planned',
        ...(feature.group ? { group: feature.group } : {}),
        ...(feature.notes ? { notes: feature.notes } : {}),
        fileLinks: sourceLink(plan, feature.sourceLine),
      }, now);
      if (!added) {
        skipped.push(`Feature “${feature.name}” could not be added because the matrix limit was reached.`);
        continue;
      }
      next = added.document;
      featureIds.set(feature.importId, added.id);
      addedFeatures += 1;
    }
  }

  for (const cell of plan.cells) {
    if (!featureIds.has(cell.featureImportId)) continue;
    const featureId = featureIds.get(cell.featureImportId)!;
    const tierId = tierIds.get(cell.tierImportId);
    if (!tierId) continue;
    const existing = next.cells.find(entry => entry.featureId === featureId && entry.tierId === tierId);
    if (existing) {
      preservedCells += 1;
      next = mergeReleaseMatrixFileLinks(next, { kind: 'cell', featureId, tierId }, sourceLink(plan, cell.sourceLine), now) ?? next;
      continue;
    }
    const added = upsertReleaseMatrixCell(next, {
      featureId, tierId, status: cell.status,
      ...(cell.parameters ? { parameters: cell.parameters } : {}),
      fileLinks: sourceLink(plan, cell.sourceLine),
    }, now);
    if (added) {
      next = added;
      addedCells += 1;
    }
  }

  const matchById = new Map(matches.map(match => [match.featureImportId, match]));
  for (const feature of selected) {
    const featureId = featureIds.get(feature.importId);
    if (!featureId) continue;
    const selection = selectionById.get(feature.importId)!;
    const match = matchById.get(feature.importId);
    const current = () => next.features.find(entry => entry.id === featureId);
    if (selection.linkRoadmap && match?.roadmap && current()?.roadmapItemId === undefined) {
      const linked = setReleaseMatrixRoadmapLink(next, { kind: 'feature', featureId }, match.roadmap.target.id, now);
      if (linked) {
        next = linked;
        roadmapLinksAdded += 1;
      }
    }
    if (selection.linkIssue && match?.issue && !current()?.issueNumbers.includes(match.issue.target.number)) {
      const linked = setReleaseMatrixFeatureIssueLinks(
        next,
        featureId,
        [...(current()?.issueNumbers ?? []), match.issue.target.number],
        now,
      );
      if (linked) {
        next = linked;
        issueLinksAdded += 1;
      }
    }
  }

  return {
    document: next,
    addedTiers,
    reusedTiers,
    addedFeatures,
    reusedFeatures,
    addedCells,
    preservedCells,
    roadmapLinksAdded,
    issueLinksAdded,
    skipped,
  };
}
