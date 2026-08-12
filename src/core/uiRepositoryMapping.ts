/**
 * Explicit, read-only bridges between UI Studio graph facts and repository files.
 *
 * This module never executes or writes source. Verification stores fingerprints
 * only; bounded adapter inspection is evidence, never reconciliation.
 */

import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import * as path from 'node:path';
import type {
  UiDesignGraph,
  UiRepositoryAdapterId,
  UiRepositoryImportFindingCode,
  UiRepositoryImportReport,
  UiRepositoryMapping,
  UiRepositoryMappingCoverage,
  UiRepositoryMappingTarget,
} from '../types.js';
import { UI_DESIGN_GRAPH_MAX_REVISION } from './uiDesignGraph.js';
import {
  analyzeUiRepositoryImport,
  UI_REPOSITORY_IMPORT_MAX_FACTS,
  UI_REPOSITORY_IMPORT_MAX_FINDINGS,
} from './uiRepositoryImport.js';

export const UI_REPOSITORY_MAPPING_MAX_ITEMS = 200;
export const UI_REPOSITORY_MAPPING_MAX_RELATIONS = 50;
export const UI_REPOSITORY_MAPPING_MAX_REVISION = UI_DESIGN_GRAPH_MAX_REVISION;
export const UI_REPOSITORY_SOURCE_MAX_BYTES = 2 * 1024 * 1024;

export const UI_REPOSITORY_ADAPTERS: ReadonlyArray<{
  id: UiRepositoryAdapterId;
  label: string;
  targetKinds: readonly UiRepositoryMappingTarget['kind'][];
  note: string;
}> = [
  {
    id: 'react', label: 'React', targetKinds: ['component', 'token', 'node'],
    note: 'Recognizes exports and simple object-shaped props; imports, runtime behavior, composition, and complex types remain losses.',
  },
  {
    id: 'static-html-css', label: 'Static HTML/CSS', targetKinds: ['component', 'token', 'node'],
    note: 'Recognizes literal selectors and CSS custom properties; templates, scripts, cascade, and preprocessors remain losses.',
  },
  {
    id: 'vscode-webview', label: 'VS Code webview', targetKinds: ['component', 'token', 'node'],
    note: 'Recognizes host exports and literal web facts; messages, CSP, template construction, and runtime behavior remain losses.',
  },
  {
    id: 'custom', label: 'Custom / other', targetKinds: ['component', 'token', 'node'],
    note: 'Requires partial or unsupported coverage plus an explicit limitation.',
  },
];

export interface UiRepositoryMappingDraft {
  id: string;
  label: string;
  adapterId: UiRepositoryAdapterId;
  target: UiRepositoryMappingTarget;
  sourcePath: string;
  sourceSymbol: string;
  propertyMappings: Record<string, string>;
  slotMappings: Record<string, string>;
  coverage: UiRepositoryMappingCoverage;
  limitations: string[];
}

interface UiRepositoryMappingCommandBase {
  expectedRevision: number;
}

export type UiRepositoryMappingCommand =
  | (UiRepositoryMappingCommandBase & { type: 'add-mapping'; mapping: UiRepositoryMappingDraft })
  | (UiRepositoryMappingCommandBase & { type: 'set-mapping'; mappingId: string; mapping: UiRepositoryMappingDraft })
  | (UiRepositoryMappingCommandBase & { type: 'delete-mapping'; mappingId: string })
  | (UiRepositoryMappingCommandBase & { type: 'verify-mapping'; mappingId: string })
  | (UiRepositoryMappingCommandBase & { type: 'import-mapping-evidence'; mappingId: string });

export type UiRepositoryDivergenceStatus =
  | 'in-sync'
  | 'design-only'
  | 'code-only'
  | 'conflict'
  | 'unassessed'
  | 'unsupported';

export interface UiRepositoryMappingAssessment {
  mappingId: string;
  status: UiRepositoryDivergenceStatus;
  message: string;
  sourceStatus: 'ok' | 'missing' | 'unavailable' | 'refused';
  currentDesignFingerprint?: string;
  currentSourceFingerprint?: string;
}

export type UiRepositoryMappingRefusal =
  | 'stale-revision'
  | 'revision-exhausted'
  | 'mapping-exists'
  | 'mapping-not-found'
  | 'mapping-limit'
  | 'invalid-command'
  | 'design-target-not-found'
  | 'source-not-found'
  | 'source-unavailable'
  | 'unsupported-mapping'
  | 'no-change';

export type UiRepositoryMappingResult =
  | { ok: true; revision: number; mappings: UiRepositoryMapping[] }
  | { ok: false; reason: UiRepositoryMappingRefusal; revision: number; mappings: UiRepositoryMapping[] };

/** Persisted-input sanitizer. A malformed baseline is dropped, never partly trusted. */
export function sanitizeUiRepositoryMappings(input: unknown): UiRepositoryMapping[] {
  if (!Array.isArray(input)) { return []; }
  const mappings: UiRepositoryMapping[] = [];
  const ids = new Set<string>();
  for (const candidate of input.slice(0, UI_REPOSITORY_MAPPING_MAX_ITEMS)) {
    const source = asRecord(candidate);
    const draft = sanitizeDraft(source);
    if (!draft || ids.has(draft.id)) { continue; }
    mappings.push({
      ...draft,
      lastVerified: sanitizeBaseline(source['lastVerified']),
      lastImport: sanitizeImportReport(source['lastImport'], draft),
    });
    ids.add(draft.id);
  }
  return mappings;
}

/** Exact webview boundary. Verification carries no webview-supplied fingerprint. */
export function parseUiRepositoryMappingCommand(input: unknown): UiRepositoryMappingCommand | undefined {
  if (!isRecord(input) || !Number.isSafeInteger(input['expectedRevision'])
      || (input['expectedRevision'] as number) < 0) {
    return undefined;
  }
  const expectedRevision = input['expectedRevision'] as number;
  if (input['type'] === 'add-mapping') {
    const mapping = parseDraft(input['mapping']);
    return mapping && exactKeys(input, ['type', 'expectedRevision', 'mapping'])
      ? { type: 'add-mapping', expectedRevision, mapping }
      : undefined;
  }
  if (input['type'] === 'set-mapping') {
    const mapping = parseDraft(input['mapping']);
    return mapping && validIdentifier(input['mappingId']) && mapping.id === input['mappingId']
      && exactKeys(input, ['type', 'expectedRevision', 'mappingId', 'mapping'])
      ? { type: 'set-mapping', expectedRevision, mappingId: input['mappingId'], mapping }
      : undefined;
  }
  if (input['type'] === 'delete-mapping' || input['type'] === 'verify-mapping'
      || input['type'] === 'import-mapping-evidence') {
    return validIdentifier(input['mappingId'])
      && exactKeys(input, ['type', 'expectedRevision', 'mappingId'])
      ? { type: input['type'], expectedRevision, mappingId: input['mappingId'] }
      : undefined;
  }
  return undefined;
}

/** Apply one mapping edit. Definition edits deliberately clear verification. */
export function applyUiRepositoryMappingCommand(
  revision: number,
  mappings: readonly UiRepositoryMapping[],
  graph: UiDesignGraph,
  command: UiRepositoryMappingCommand,
  workspaceRoot?: string,
  now: () => string = () => new Date().toISOString(),
): UiRepositoryMappingResult {
  const current = structuredClone(mappings) as UiRepositoryMapping[];
  if (command.expectedRevision !== revision) { return refused('stale-revision', revision, current); }
  if (revision >= UI_DESIGN_GRAPH_MAX_REVISION) { return refused('revision-exhausted', revision, current); }
  const mappingId = command.type === 'add-mapping' ? command.mapping.id : command.mappingId;
  const index = current.findIndex(mapping => mapping.id === mappingId);
  if (command.type === 'add-mapping') {
    if (index >= 0) { return refused('mapping-exists', revision, current); }
    if (current.length >= UI_REPOSITORY_MAPPING_MAX_ITEMS) { return refused('mapping-limit', revision, current); }
    if (!fingerprintUiRepositoryDesignTarget(graph, command.mapping.target)) {
      return refused('design-target-not-found', revision, current);
    }
    if (mappingSupportIssue(graph, command.mapping)) {
      return refused('unsupported-mapping', revision, current);
    }
    return {
      ok: true,
      revision: revision + 1,
      mappings: [...current, { ...command.mapping, lastVerified: null, lastImport: null }],
    };
  }
  if (index < 0) { return refused('mapping-not-found', revision, current); }
  if (command.type === 'delete-mapping') {
    return { ok: true, revision: revision + 1, mappings: current.filter((_, candidate) => candidate !== index) };
  }
  if (command.type === 'set-mapping') {
    const replacement: UiRepositoryMapping = { ...command.mapping, lastVerified: null, lastImport: null };
    if (!fingerprintUiRepositoryDesignTarget(graph, replacement.target)) {
      return refused('design-target-not-found', revision, current);
    }
    if (mappingSupportIssue(graph, replacement)) {
      return refused('unsupported-mapping', revision, current);
    }
    if (canonicalJson(replacement) === canonicalJson(current[index])) {
      return refused('no-change', revision, current);
    }
    current[index] = replacement;
    return { ok: true, revision: revision + 1, mappings: current };
  }

  const mapping = current[index]!;
  const designFingerprint = fingerprintUiRepositoryDesignTarget(graph, mapping.target);
  if (!designFingerprint) { return refused('design-target-not-found', revision, current); }
  if (mappingSupportIssue(graph, mapping)) { return refused('unsupported-mapping', revision, current); }
  const source = readUiRepositorySourceSnapshot(workspaceRoot, mapping.sourcePath);
  if (source.status === 'missing') { return refused('source-not-found', revision, current); }
  if (source.status !== 'ok') { return refused('source-unavailable', revision, current); }
  if (command.type === 'verify-mapping') {
    mapping.lastVerified = {
      graphRevision: graph.revision,
      designFingerprint,
      sourceFingerprint: source.fingerprint,
      verifiedAt: now(),
    };
  } else {
    const importedAt = now();
    let sourceText: string | undefined;
    try {
      sourceText = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes);
    } catch {
      mapping.lastImport = {
        adapterId: mapping.adapterId,
        capability: 'unsupported',
        graphRevision: graph.revision,
        designFingerprint,
        sourceFingerprint: source.fingerprint,
        importedAt,
        facts: [],
        suggestedPropertyMappings: {},
        suggestedSlotMappings: {},
        findings: [{
          code: 'source-not-utf8', severity: 'unsupported',
          message: 'The bounded source snapshot is not valid UTF-8 and was not interpreted.',
        }],
      };
    }
    if (sourceText !== undefined) {
      mapping.lastImport = analyzeUiRepositoryImport({
        mapping, graph, sourceText, designFingerprint,
        sourceFingerprint: source.fingerprint, importedAt,
      });
    }
  }
  return { ok: true, revision: revision + 1, mappings: current };
}

export function assessUiRepositoryMappings(
  graph: UiDesignGraph,
  mappings: readonly UiRepositoryMapping[],
  workspaceRoot?: string,
): UiRepositoryMappingAssessment[] {
  return mappings.map(mapping => {
    const designFingerprint = fingerprintUiRepositoryDesignTarget(graph, mapping.target);
    const source = fingerprintUiRepositorySource(workspaceRoot, mapping.sourcePath);
    const supportIssue = mappingSupportIssue(graph, mapping);
    if (supportIssue || !designFingerprint) {
      return {
        mappingId: mapping.id, status: 'unsupported', sourceStatus: source.status,
        message: !designFingerprint
          ? 'The mapped design target no longer exists.'
          : supportIssue ?? 'The adapter or declared coverage cannot represent this mapping.',
        ...(designFingerprint ? { currentDesignFingerprint: designFingerprint } : {}),
        ...(source.status === 'ok' ? { currentSourceFingerprint: source.fingerprint } : {}),
      };
    }
    if (!mapping.lastVerified) {
      return {
        mappingId: mapping.id, status: 'unassessed', sourceStatus: source.status,
        message: source.status === 'missing'
          ? 'The source file is missing and this mapping has never been verified.'
          : source.status === 'ok'
            ? 'Verify this mapping to establish design and source fingerprints.'
            : 'The source cannot be read, so divergence is unassessed.',
        currentDesignFingerprint: designFingerprint,
        ...(source.status === 'ok' ? { currentSourceFingerprint: source.fingerprint } : {}),
      };
    }
    if (source.status === 'unavailable' || source.status === 'refused') {
      return {
        mappingId: mapping.id, status: 'unassessed', sourceStatus: source.status,
        message: 'The source cannot be read safely, so divergence is unassessed.',
        currentDesignFingerprint: designFingerprint,
      };
    }
    const designChanged = designFingerprint !== mapping.lastVerified.designFingerprint;
    const sourceChanged = source.status !== 'ok'
      || source.fingerprint !== mapping.lastVerified.sourceFingerprint;
    const status: UiRepositoryDivergenceStatus = designChanged && sourceChanged
      ? 'conflict' : designChanged ? 'design-only' : sourceChanged ? 'code-only' : 'in-sync';
    const message = status === 'conflict'
      ? 'Design and source both changed since verification; no side was chosen.'
      : status === 'design-only'
        ? 'Only the mapped design target changed since verification.'
        : status === 'code-only'
          ? source.status === 'missing'
            ? 'The verified source file is now missing.'
            : 'Only repository source changed since verification.'
          : 'Design and source match their last verified fingerprints.';
    return {
      mappingId: mapping.id, status, sourceStatus: source.status, message,
      currentDesignFingerprint: designFingerprint,
      ...(source.status === 'ok' ? { currentSourceFingerprint: source.fingerprint } : {}),
    };
  });
}

/** Hash only the mapped design target and its directly referenced graph facts. */
export function fingerprintUiRepositoryDesignTarget(
  graph: UiDesignGraph,
  target: UiRepositoryMappingTarget,
): string | undefined {
  if (target.kind === 'component') {
    const component = graph.components.find(candidate => candidate.id === target.id);
    return component ? fingerprintJson({ kind: target.kind, component }) : undefined;
  }
  if (target.kind === 'token') {
    const token = graph.tokens.find(candidate => candidate.id === target.id);
    return token ? fingerprintJson({ kind: target.kind, token }) : undefined;
  }
  const screen = graph.screens.find(candidate => candidate.id === target.screenId);
  const node = screen?.nodes.find(candidate => candidate.id === target.id);
  if (!screen || !node) { return undefined; }
  const component = node.componentInstance
    ? graph.components.find(candidate => candidate.id === node.componentInstance?.definitionId)
    : undefined;
  const asset = node.assetRef ? graph.assets.find(candidate => candidate.id === node.assetRef) : undefined;
  const collection = node.dataBinding
    ? graph.contentCollections.find(candidate => candidate.id === node.dataBinding?.collectionId)
    : undefined;
  return fingerprintJson({ kind: target.kind, screenId: screen.id, node, component, asset, collection });
}

export type UiRepositorySourceFingerprint =
  | { status: 'ok'; fingerprint: string }
  | { status: 'missing' | 'unavailable' | 'refused' };

type UiRepositorySourceSnapshot =
  | { status: 'ok'; fingerprint: string; bytes: Uint8Array }
  | { status: 'missing' | 'unavailable' | 'refused' };

/** Read a bounded file after real-path containment checks and return only its hash. */
export function fingerprintUiRepositorySource(
  workspaceRoot: string | undefined,
  sourcePath: string,
): UiRepositorySourceFingerprint {
  const snapshot = readUiRepositorySourceSnapshot(workspaceRoot, sourcePath);
  return snapshot.status === 'ok'
    ? { status: 'ok', fingerprint: snapshot.fingerprint }
    : snapshot;
}

function readUiRepositorySourceSnapshot(
  workspaceRoot: string | undefined,
  sourcePath: string,
): UiRepositorySourceSnapshot {
  const normalized = normalizeWorkspaceRelativePath(sourcePath);
  if (!workspaceRoot || !normalized) { return { status: normalized ? 'unavailable' : 'refused' }; }
  let realRoot: string;
  try {
    realRoot = realpathSync(workspaceRoot);
  } catch {
    return { status: 'unavailable' };
  }
  const candidate = path.resolve(realRoot, ...normalized.split('/'));
  if (!isWithin(realRoot, candidate)) { return { status: 'refused' }; }
  let realCandidate: string;
  try {
    realCandidate = realpathSync(candidate);
  } catch (error) {
    return isMissingError(error) ? { status: 'missing' } : { status: 'unavailable' };
  }
  if (!isWithin(realRoot, realCandidate)) { return { status: 'refused' }; }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(realCandidate, 'r');
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size > UI_REPOSITORY_SOURCE_MAX_BYTES) { return { status: 'refused' }; }
    const bytes = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (read === 0) { break; }
      offset += read;
    }
    const snapshot = bytes.subarray(0, offset);
    return { status: 'ok', fingerprint: fingerprintBytes(snapshot), bytes: snapshot };
  } catch (error) {
    return isMissingError(error) ? { status: 'missing' } : { status: 'unavailable' };
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* best-effort descriptor cleanup */ }
    }
  }
}

function mappingSupportIssue(graph: UiDesignGraph, mapping: UiRepositoryMappingDraft): string | undefined {
  const adapter = UI_REPOSITORY_ADAPTERS.find(candidate => candidate.id === mapping.adapterId);
  if (!adapter || !adapter.targetKinds.includes(mapping.target.kind) || mapping.coverage === 'unsupported') {
    return 'The adapter or declared coverage cannot represent this mapping.';
  }
  if (mapping.target.kind !== 'component') { return undefined; }
  const component = graph.components.find(candidate => candidate.id === mapping.target.id);
  if (!component) { return undefined; }
  const properties = new Set(component.properties.map(property => property.id));
  const slots = new Set(component.slots.map(slot => slot.id));
  const missingProperties = Object.keys(mapping.propertyMappings).filter(id => !properties.has(id));
  const missingSlots = Object.keys(mapping.slotMappings).filter(id => !slots.has(id));
  if (missingProperties.length === 0 && missingSlots.length === 0) { return undefined; }
  return `The mapping names undeclared component relations (${[
    ...missingProperties.map(id => `property:${id}`),
    ...missingSlots.map(id => `slot:${id}`),
  ].join(', ')}).`;
}

export function normalizeWorkspaceRelativePath(input: unknown): string | undefined {
  if (typeof input !== 'string') { return undefined; }
  const normalized = input.trim().replace(/\\/g, '/');
  if (normalized.length === 0 || normalized.length > 500 || normalized.startsWith('/')
      || normalized.startsWith('//') || /^[a-zA-Z]:/.test(normalized)
      || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return undefined;
  }
  const segments = normalized.split('/');
  return segments.some(segment => segment.length === 0 || segment === '.' || segment === '..' || segment.includes(':'))
    ? undefined : normalized;
}

function sanitizeDraft(input: unknown): UiRepositoryMappingDraft | undefined {
  const source = asRecord(input);
  const id = validIdentifier(source['id']) ? source['id'] : undefined;
  const label = cleanText(source['label'], 120);
  const adapterId = isAdapterId(source['adapterId']) ? source['adapterId'] : undefined;
  const target = sanitizeTarget(source['target']);
  const sourcePath = normalizeWorkspaceRelativePath(source['sourcePath']);
  const sourceSymbol = cleanText(source['sourceSymbol'], 160, true);
  const propertyMappings = sanitizeRelations(source['propertyMappings']);
  const slotMappings = sanitizeRelations(source['slotMappings']);
  const coverage = isCoverage(source['coverage']) ? source['coverage'] : undefined;
  const limitations = sanitizeLimitations(source['limitations']);
  if (!id || !label || !adapterId || !target || !sourcePath || sourceSymbol === undefined || !coverage
      || propertyMappings === undefined || slotMappings === undefined
      || (target.kind !== 'component'
        && (Object.keys(propertyMappings).length > 0 || Object.keys(slotMappings).length > 0))
      || ((coverage === 'partial' || coverage === 'unsupported' || adapterId === 'custom')
        && limitations.length === 0)
      || (adapterId === 'custom' && coverage === 'declared')) {
    return undefined;
  }
  return {
    id, label, adapterId, target, sourcePath, sourceSymbol,
    propertyMappings, slotMappings, coverage, limitations,
  };
}

function parseDraft(input: unknown): UiRepositoryMappingDraft | undefined {
  if (!isRecord(input)
      || !exactKeys(input, [
        'id', 'label', 'adapterId', 'target', 'sourcePath', 'sourceSymbol',
        'propertyMappings', 'slotMappings', 'coverage', 'limitations',
      ])) {
    return undefined;
  }
  const draft = sanitizeDraft(input);
  return draft && canonicalJson(draft) === canonicalJson(input) ? draft : undefined;
}

function sanitizeTarget(input: unknown): UiRepositoryMappingTarget | undefined {
  const source = asRecord(input);
  if ((source['kind'] === 'component' || source['kind'] === 'token')
      && validIdentifier(source['id']) && exactKeys(source, ['kind', 'id'])) {
    return { kind: source['kind'], id: source['id'] };
  }
  if (source['kind'] === 'node' && validIdentifier(source['id']) && validIdentifier(source['screenId'])
      && exactKeys(source, ['kind', 'id', 'screenId'])) {
    return { kind: 'node', id: source['id'], screenId: source['screenId'] };
  }
  return undefined;
}

function sanitizeRelations(input: unknown): Record<string, string> | undefined {
  if (!isRecord(input) || Object.keys(input).length > UI_REPOSITORY_MAPPING_MAX_RELATIONS) { return undefined; }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const target = cleanText(value, 160);
    if (!validIdentifier(key) || !target) { return undefined; }
    result[key] = target;
  }
  return result;
}

function sanitizeLimitations(input: unknown): string[] {
  if (!Array.isArray(input)) { return []; }
  const result: string[] = [];
  for (const candidate of input.slice(0, 40)) {
    const value = cleanText(candidate, 500);
    if (value && !result.includes(value)) { result.push(value); }
  }
  return result;
}

function sanitizeBaseline(input: unknown): UiRepositoryMapping['lastVerified'] {
  const source = asRecord(input);
  return Number.isSafeInteger(source['graphRevision']) && (source['graphRevision'] as number) >= 0
    && (source['graphRevision'] as number) <= UI_DESIGN_GRAPH_MAX_REVISION
    && isFingerprint(source['designFingerprint']) && isFingerprint(source['sourceFingerprint'])
    && typeof source['verifiedAt'] === 'string' && isIsoDate(source['verifiedAt'])
    && exactKeys(source, ['graphRevision', 'designFingerprint', 'sourceFingerprint', 'verifiedAt'])
    ? {
      graphRevision: source['graphRevision'] as number,
      designFingerprint: source['designFingerprint'],
      sourceFingerprint: source['sourceFingerprint'],
      verifiedAt: source['verifiedAt'],
    }
    : null;
}

const IMPORT_FINDING_CODES = new Set<UiRepositoryImportFindingCode>([
  'react-static-only',
  'react-source-extension-unsupported',
  'react-props-not-found',
  'html-css-static-only',
  'html-css-source-extension-unsupported',
  'vscode-static-only',
  'vscode-source-extension-unsupported',
  'custom-adapter-unsupported',
  'source-symbol-not-found',
  'source-not-utf8',
  'no-structural-facts',
  'exact-relations-suggested',
]);

function sanitizeImportReport(
  input: unknown,
  mapping: UiRepositoryMappingDraft,
): UiRepositoryImportReport | null {
  if (!isRecord(input)
      || input['adapterId'] !== mapping.adapterId
      || (input['capability'] !== 'partial' && input['capability'] !== 'unsupported')
      || !Number.isSafeInteger(input['graphRevision']) || (input['graphRevision'] as number) < 0
      || (input['graphRevision'] as number) > UI_DESIGN_GRAPH_MAX_REVISION
      || !isFingerprint(input['designFingerprint']) || !isFingerprint(input['sourceFingerprint'])
      || typeof input['importedAt'] !== 'string' || !isIsoDate(input['importedAt'])
      || !Array.isArray(input['facts']) || input['facts'].length > UI_REPOSITORY_IMPORT_MAX_FACTS
      || !Array.isArray(input['findings']) || input['findings'].length > UI_REPOSITORY_IMPORT_MAX_FINDINGS
      || !exactKeys(input, [
        'adapterId', 'capability', 'graphRevision', 'designFingerprint', 'sourceFingerprint',
        'importedAt', 'facts', 'suggestedPropertyMappings', 'suggestedSlotMappings', 'findings',
      ])) {
    return null;
  }
  const facts = input['facts'].map(candidate => {
    const fact = asRecord(candidate);
    const name = cleanText(fact['name'], 160);
    return (fact['kind'] === 'export' || fact['kind'] === 'property' || fact['kind'] === 'slot'
      || fact['kind'] === 'token' || fact['kind'] === 'selector')
      && name && exactKeys(fact, ['kind', 'name'])
      ? { kind: fact['kind'], name }
      : undefined;
  });
  const findings = input['findings'].map(candidate => {
    const item = asRecord(candidate);
    const message = cleanText(item['message'], 500);
    return typeof item['code'] === 'string' && IMPORT_FINDING_CODES.has(item['code'] as UiRepositoryImportFindingCode)
      && (item['severity'] === 'info' || item['severity'] === 'loss' || item['severity'] === 'unsupported')
      && message && exactKeys(item, ['code', 'severity', 'message'])
      ? { code: item['code'] as UiRepositoryImportFindingCode, severity: item['severity'], message }
      : undefined;
  });
  const suggestedPropertyMappings = sanitizeRelations(input['suggestedPropertyMappings']);
  const suggestedSlotMappings = sanitizeRelations(input['suggestedSlotMappings']);
  const propertyFacts = new Set(facts.filter(fact => fact?.kind === 'property').map(fact => fact!.name));
  const slotFacts = new Set(facts.filter(fact => fact?.kind === 'slot').map(fact => fact!.name));
  if (facts.some(fact => !fact) || findings.some(finding => !finding)
      || new Set(facts.map(fact => `${fact!.kind}:${fact!.name}`)).size !== facts.length
      || new Set(findings.map(finding => finding!.code)).size !== findings.length
      || suggestedPropertyMappings === undefined || suggestedSlotMappings === undefined
      || Object.values(suggestedPropertyMappings).some(sourceName => !propertyFacts.has(sourceName))
      || Object.values(suggestedSlotMappings).some(sourceName => !slotFacts.has(sourceName))
      || (mapping.target.kind !== 'component'
        && (Object.keys(suggestedPropertyMappings).length > 0 || Object.keys(suggestedSlotMappings).length > 0))
      || (input['capability'] === 'partial' && !findings.some(finding => finding?.severity === 'loss'))
      || (input['capability'] === 'unsupported' && !findings.some(finding => finding?.severity === 'unsupported'))) {
    return null;
  }
  const report: UiRepositoryImportReport = {
    adapterId: mapping.adapterId,
    capability: input['capability'],
    graphRevision: input['graphRevision'] as number,
    designFingerprint: input['designFingerprint'],
    sourceFingerprint: input['sourceFingerprint'],
    importedAt: input['importedAt'],
    facts: facts as UiRepositoryImportReport['facts'],
    suggestedPropertyMappings,
    suggestedSlotMappings,
    findings: findings as UiRepositoryImportReport['findings'],
  };
  return canonicalJson(report) === canonicalJson(input) ? report : null;
}

function fingerprintJson(value: unknown): string {
  return fingerprintBytes(Buffer.from(canonicalJson(value), 'utf8'));
}

function fingerprintBytes(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) { return `[${value.map(canonicalJson).join(',')}]`; }
  if (isRecord(value)) {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function cleanText(input: unknown, maximum: number, allowEmpty = false): string | undefined {
  if (typeof input !== 'string') { return undefined; }
  const value = input.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maximum);
  return value || (allowEmpty ? '' : undefined);
}

function validIdentifier(input: unknown): input is string {
  return typeof input === 'string' && /^[a-zA-Z0-9._-]{1,120}$/.test(input);
}

function isAdapterId(input: unknown): input is UiRepositoryAdapterId {
  return UI_REPOSITORY_ADAPTERS.some(adapter => adapter.id === input);
}

function isCoverage(input: unknown): input is UiRepositoryMappingCoverage {
  return input === 'declared' || input === 'partial' || input === 'unsupported';
}

function isFingerprint(input: unknown): input is string {
  return typeof input === 'string' && /^sha256:[0-9a-f]{64}$/.test(input);
}

function isIsoDate(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input)
    && !Number.isNaN(Date.parse(input));
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isMissingError(error: unknown): boolean {
  return isRecord(error) && (error['code'] === 'ENOENT' || error['code'] === 'ENOTDIR');
}

function refused(
  reason: UiRepositoryMappingRefusal,
  revision: number,
  mappings: UiRepositoryMapping[],
): UiRepositoryMappingResult {
  return { ok: false, reason, revision, mappings };
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.prototype.hasOwnProperty.call(record, key))
    && Object.keys(record).every(key => allowed.has(key));
}
