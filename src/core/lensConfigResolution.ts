import type { LensSourceRange, LensVisualTarget, LensWorkspaceIdentity } from '../types.js';
import { createSourceLensTarget, normalizeLensTarget } from './lensTarget.js';

export const LENS_CONFIG_FILE = '.atlasmind/lens-config.json';
export const LENS_CONFIG_MAX_SETTINGS = 200;
export const LENS_CONFIG_MAX_SOURCES = 30;

export type LensConfigSourceKind =
  | 'default'
  | 'config-file'
  | 'environment'
  | 'workspace-setting'
  | 'user-setting'
  | 'feature-flag'
  | 'runtime-override';
export type LensConfigValuePolicy = 'display' | 'masked';
export type LensConfigScalar = string | number | boolean | null;
export type LensConfigResolutionStatus = 'winner' | 'shadowed' | 'inactive';

export interface LensConfigSourceAnchor {
  workspacePath: string;
  range?: LensSourceRange;
}

export interface LensConfigSourceDeclaration {
  id: string;
  label: string;
  kind: LensConfigSourceKind;
  precedence: number;
  applies: boolean;
  value?: LensConfigScalar;
  present?: boolean;
  source?: LensConfigSourceAnchor;
}

export interface LensConfigSettingDeclaration {
  id: string;
  key: string;
  label?: string;
  description?: string;
  valuePolicy: LensConfigValuePolicy;
  sources: LensConfigSourceDeclaration[];
}

export interface LensConfigFile {
  version: 1;
  settings: LensConfigSettingDeclaration[];
}

export interface LensConfigResolutionItem extends LensConfigSourceDeclaration {
  status: LensConfigResolutionStatus;
  displayValue: string;
  target?: LensVisualTarget;
}

export interface LensConfigResolutionMap {
  version: 1;
  id: string;
  settingId: string;
  key: string;
  label: string;
  description?: string;
  valuePolicy: LensConfigValuePolicy;
  winnerSourceId?: string;
  sources: LensConfigResolutionItem[];
  notices: string[];
}

/** Normalize an explicit, value-policy-aware configuration precedence declaration. */
export function normalizeLensConfigFile(value: unknown): LensConfigFile | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.settings) || value.settings.length > LENS_CONFIG_MAX_SETTINGS) {
    return undefined;
  }
  const settings: LensConfigSettingDeclaration[] = [];
  const settingIds = new Set<string>();
  const keys = new Set<string>();
  for (const candidate of value.settings) {
    const setting = normalizeSetting(candidate);
    if (!setting || settingIds.has(setting.id) || keys.has(setting.key)) return undefined;
    settingIds.add(setting.id);
    keys.add(setting.key);
    settings.push(setting);
  }
  return { version: 1, settings };
}

/** Resolve the declared winner and shadowed sources without reading a live value source. */
export function buildLensConfigResolutionMap(
  candidate: LensConfigSettingDeclaration,
  workspace: LensWorkspaceIdentity,
): LensConfigResolutionMap {
  const normalized = normalizeSetting(candidate);
  const normalizedWorkspace = normalizeWorkspace(workspace);
  if (!normalized || !normalizedWorkspace) {
    throw new Error('AtlasMind Lens refused an invalid configuration-resolution input.');
  }
  const ordered = [...normalized.sources].sort((left, right) => left.precedence - right.precedence);
  const winner = [...ordered].reverse().find(source => source.applies);
  const sources = ordered.map(source => {
    const status: LensConfigResolutionStatus = !source.applies
      ? 'inactive'
      : source.id === winner?.id ? 'winner' : 'shadowed';
    return {
      ...source,
      status,
      displayValue: normalized.valuePolicy === 'masked'
        ? source.present ? 'present — value hidden' : 'not present'
        : displayScalar(source.value),
      ...toTarget(source.source, normalizedWorkspace, normalized.key, source, status),
    };
  });
  return {
    version: 1,
    id: `lens-config:${stableHash(`${normalized.id}:${normalizedWorkspace.name}:${normalizedWorkspace.index}`)}`,
    settingId: normalized.id,
    key: normalized.key,
    label: normalized.label ?? normalized.key,
    ...(normalized.description ? { description: normalized.description } : {}),
    valuePolicy: normalized.valuePolicy,
    ...(winner ? { winnerSourceId: winner.id } : {}),
    sources,
    notices: [
      `Resolution comes only from ${LENS_CONFIG_FILE}; AtlasMind does not read environment variables, runtime memory, remote flag services, or secret stores for this view.`,
      'Precedence and applies flags are repository declarations, not verification of the current process or deployed environment.',
      normalized.valuePolicy === 'masked'
        ? 'This setting is masked: its declaration cannot contain a value, and no value is posted to the webview or attached to chat.'
        : 'Displayed scalar values are repository-authored configuration metadata; do not use display policy for credentials or sensitive data.',
      ...(winner ? [] : ['No source is declared as applying, so the effective value remains unknown.']),
    ],
  };
}

function normalizeSetting(value: unknown): LensConfigSettingDeclaration | undefined {
  if (!isRecord(value) || !Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > LENS_CONFIG_MAX_SOURCES) {
    return undefined;
  }
  const id = boundedExactText(value.id, 200);
  const key = boundedExactText(value.key, 300);
  const label = value.label === undefined ? undefined : boundedText(value.label, 200);
  const description = value.description === undefined ? undefined : boundedText(value.description, 500);
  const valuePolicy = value.valuePolicy === 'display' || value.valuePolicy === 'masked' ? value.valuePolicy : undefined;
  if (!id || !key || !valuePolicy || (value.label !== undefined && !label) || (value.description !== undefined && !description)) {
    return undefined;
  }
  const sources: LensConfigSourceDeclaration[] = [];
  const sourceIds = new Set<string>();
  const precedences = new Set<number>();
  for (const candidate of value.sources) {
    const source = normalizeSource(candidate, valuePolicy);
    if (!source || sourceIds.has(source.id) || precedences.has(source.precedence)) return undefined;
    sourceIds.add(source.id);
    precedences.add(source.precedence);
    sources.push(source);
  }
  return {
    id,
    key,
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
    valuePolicy,
    sources,
  };
}

function normalizeSource(value: unknown, policy: LensConfigValuePolicy): LensConfigSourceDeclaration | undefined {
  if (!isRecord(value) || typeof value.applies !== 'boolean') return undefined;
  const id = boundedExactText(value.id, 200);
  const label = boundedText(value.label, 200);
  const kind = normalizeKind(value.kind);
  const precedence = Number.isInteger(value.precedence) && Number(value.precedence) >= 0 && Number(value.precedence) <= 10_000
    ? Number(value.precedence)
    : undefined;
  const source = value.source === undefined ? undefined : normalizeAnchor(value.source);
  if (!id || !label || !kind || precedence === undefined || (value.source !== undefined && !source)) return undefined;
  if (policy === 'display') {
    const scalar = normalizeScalar(value.value);
    if (!Object.hasOwn(value, 'value') || !scalar.valid || Object.hasOwn(value, 'present')) return undefined;
    return { id, label, kind, precedence, applies: value.applies, value: scalar.value, ...(source ? { source } : {}) };
  }
  if (Object.hasOwn(value, 'value') || typeof value.present !== 'boolean' || (value.applies && !value.present)) return undefined;
  return { id, label, kind, precedence, applies: value.applies, present: value.present, ...(source ? { source } : {}) };
}

function normalizeKind(value: unknown): LensConfigSourceKind | undefined {
  return typeof value === 'string' && [
    'default', 'config-file', 'environment', 'workspace-setting', 'user-setting', 'feature-flag', 'runtime-override',
  ].includes(value)
    ? value as LensConfigSourceKind
    : undefined;
}

function normalizeAnchor(value: unknown): LensConfigSourceAnchor | undefined {
  if (!isRecord(value)) return undefined;
  const workspacePath = normalizeRelativePath(value.workspacePath);
  const range = value.range === undefined ? undefined : normalizeRange(value.range);
  return workspacePath && (value.range === undefined || range)
    ? { workspacePath, ...(range ? { range } : {}) }
    : undefined;
}

function normalizeRange(value: unknown): LensSourceRange | undefined {
  if (!isRecord(value)) return undefined;
  const values = [value.startLine, value.startColumn, value.endLine, value.endColumn];
  if (!values.every(entry => Number.isInteger(entry) && Number(entry) > 0)) return undefined;
  const range = {
    startLine: Number(value.startLine), startColumn: Number(value.startColumn),
    endLine: Number(value.endLine), endColumn: Number(value.endColumn),
  };
  return range.endLine > range.startLine || range.endLine === range.startLine && range.endColumn >= range.startColumn
    ? range
    : undefined;
}

function toTarget(
  anchor: LensConfigSourceAnchor | undefined,
  workspace: LensWorkspaceIdentity,
  key: string,
  source: LensConfigSourceDeclaration,
  status: LensConfigResolutionStatus,
): { target?: LensVisualTarget } {
  if (!anchor) return {};
  const base = createSourceLensTarget({
    kind: anchor.range ? 'code-range' : 'file',
    label: `${key} — ${source.label}`,
    detail: `${source.kind} · precedence ${source.precedence} · ${status}`,
    workspace,
    workspacePath: anchor.workspacePath,
    ...(anchor.range ? { range: anchor.range } : {}),
  });
  const target = normalizeLensTarget({
    ...base,
    kind: 'command',
    evidence: { kind: 'declared', source: LENS_CONFIG_FILE, confidence: 1 },
  });
  return target ? { target } : {};
}

function displayScalar(value: LensConfigScalar | undefined): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return 'unknown';
}

function normalizeScalar(value: unknown): { valid: true; value: LensConfigScalar } | { valid: false } {
  if (value === null || typeof value === 'boolean') return { valid: true, value };
  if (typeof value === 'number' && Number.isFinite(value)) return { valid: true, value };
  if (typeof value === 'string' && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value)) {
    return { valid: true, value };
  }
  return { valid: false };
}

function normalizeWorkspace(value: LensWorkspaceIdentity): LensWorkspaceIdentity | undefined {
  const name = boundedText(value?.name, 200);
  return name && Number.isInteger(value?.index) && value.index >= 0 ? { name, index: value.index } : undefined;
}

function normalizeRelativePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.length > 500 || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return undefined;
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..') ? undefined : segments.join('/');
}

function boundedExactText(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
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
