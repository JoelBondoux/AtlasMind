/**
 * Bounded, explicit game-asset inventory.
 *
 * This is a filesystem reader, never a render-time collector. A caller must
 * present and record confirmation, resolve component roots through
 * `WorkspaceScope`, and pass those roots here. The reader never follows a
 * symbolic link, never executes an engine or VCS command, and never turns an
 * incomplete scan into a complete-looking zero.
 */

import {
  lstatSync as nodeLstatSync,
  readFileSync as nodeReadFileSync,
  readdirSync as nodeReaddirSync,
  type Dirent,
  type Stats,
} from 'node:fs';
import path from 'node:path';
import {
  PROJECT_COMPONENT_ROLES,
  PROJECT_COMPONENT_VCS,
  type ProjectComponent,
} from './projectComposition.js';

export const GAME_ASSET_TYPES = [
  'scene',
  'texture',
  'model',
  'audio',
  'video',
  'animation',
  'material',
  'shader',
  'font',
  'data',
  'package',
  'other',
] as const;

export type GameAssetType = typeof GAME_ASSET_TYPES[number];

export const GAME_ASSET_DEFAULT_LIMITS = Object.freeze({
  maxFiles: 10_000,
  maxTotalBytes: 20 * 1024 * 1024 * 1024,
  maxDurationMs: 3_000,
});

export const GAME_ASSET_HARD_LIMITS = Object.freeze({
  maxComponents: 32,
  maxRootsPerComponent: 32,
  maxFiles: 100_000,
  maxTotalBytes: 1024 * 1024 * 1024 * 1024,
  maxDurationMs: 10_000,
  maxPathChars: 1_024,
  maxAttributeBytes: 256 * 1024,
  maxMarkerFileBytes: 256 * 1024,
  maxMarkerReadBytes: 4 * 1024 * 1024,
  maxImportMarkers: 250,
  maxWithheldPaths: 250,
});

export const GAME_ASSET_EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git',
  '.godot',
  'node_modules',
]);

const GAME_ASSET_ROOT_CACHE_DIRECTORIES = new Set([
  'library',
  'temp',
  'obj',
  'logs',
  'binaries',
  'deriveddatacache',
  'intermediate',
  'saved',
]);

export interface GameAssetScanLimits {
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
  readonly maxDurationMs: number;
}

export interface GameAssetScanTarget {
  readonly component: Pick<ProjectComponent, 'id' | 'label' | 'role' | 'vcs'>;
  /** Absolute host-resolved component root. Never taken from a project file. */
  readonly componentRoot?: string;
  /** Declared paths relative to `componentRoot`; there is deliberately no guessed default. */
  readonly contentRoots: readonly string[];
}

export interface GameAssetInventoryInput {
  /** Must be true only after an explicit request and confirmation. */
  readonly confirmed: boolean;
  readonly targets: readonly GameAssetScanTarget[];
  readonly limits?: Partial<GameAssetScanLimits>;
}

export interface GameAssetFileSystem {
  readonly lstatSync: (path: string) => Stats;
  readonly readdirSync: (path: string) => Dirent[];
  readonly readFileSync: (path: string, encoding: 'utf8') => string;
}

export interface GameAssetInventoryDependencies {
  readonly fs?: GameAssetFileSystem;
  /** Monotonic clock in milliseconds. */
  readonly now?: () => number;
}

export interface GameAssetRecord {
  readonly path: string;
  readonly type: GameAssetType;
  readonly sizeBytes: number;
  readonly binary: boolean;
  /** Only validated in-root records receive an open affordance. */
  readonly openable: true;
}

export interface GameAssetTypeSummary {
  readonly type: GameAssetType;
  readonly count: number;
  readonly sizeBytes: number;
}

export interface GameAssetImportMarker {
  readonly path: string;
  readonly line: number;
  readonly kind: 'import-error' | 'missing-reference';
}

export interface GameAssetOrphanCandidate {
  readonly metadataPath: string;
  readonly missingAssetPath: string;
  readonly reason: 'metadata-without-asset';
}

export interface GameAssetWithheldPath {
  readonly path: string;
  readonly reason: 'symbolic-link' | 'unsafe-relative-path';
}

export interface GameAssetLfsCoverage {
  readonly status: 'assessed' | 'partial' | 'not-visible' | 'unreadable';
  readonly binaryAssetCount?: number;
  readonly coveredCount?: number;
  readonly uncoveredCount?: number;
  readonly uncoveredPaths?: readonly string[];
  readonly reason?: string;
}

export interface AvailableGameAssetInventory {
  readonly status: 'available';
  readonly componentId: string;
  readonly componentLabel: string;
  readonly contentRoots: readonly string[];
  readonly scannedFileCount: number;
  readonly assetCount: number;
  readonly totalBytes: number;
  readonly assets: readonly GameAssetRecord[];
  readonly byType: readonly GameAssetTypeSummary[];
  readonly importErrorMarkers: readonly GameAssetImportMarker[];
  readonly importMarkerAssessment: 'complete' | 'partial';
  readonly orphanCandidates: readonly GameAssetOrphanCandidate[];
  readonly orphanAssessment: 'complete' | 'withheld-incomplete';
  readonly lfs: GameAssetLfsCoverage;
  readonly truncated: boolean;
  readonly truncationReasons: readonly string[];
  readonly withheldPaths: readonly GameAssetWithheldPath[];
  readonly withheldPathCount: number;
  readonly excludedDirectoryCount: number;
}

export interface UnavailableGameAssetInventory {
  readonly status: 'confirmation-required' | 'not-visible' | 'invalid' | 'unreadable';
  readonly componentId: string;
  readonly componentLabel: string;
  readonly reason: string;
}

export type GameAssetComponentInventory =
  | AvailableGameAssetInventory
  | UnavailableGameAssetInventory;

export interface GameAssetInventoryReport {
  readonly confirmed: boolean;
  readonly complete: boolean;
  readonly limits: GameAssetScanLimits;
  readonly components: readonly GameAssetComponentInventory[];
}

export interface GitAttributeRule {
  readonly baseDirectory: string;
  readonly pattern: string;
  readonly filter: 'lfs' | 'not-lfs';
  readonly sourcePath: string;
  readonly line: number;
}

export interface GitAttributeParseResult {
  readonly rules: readonly GitAttributeRule[];
  readonly unsupportedLfsLines: readonly number[];
}

interface SharedBudget {
  readonly startedAt: number;
  readonly limits: GameAssetScanLimits;
  files: number;
  bytes: number;
}

interface MutableScan {
  /** Folded path to original path, so comparisons are portable but evidence preserves spelling. */
  readonly allFiles: Map<string, string>;
  readonly allDirectories: Set<string>;
  readonly assets: GameAssetRecord[];
  readonly attributeRules: GitAttributeRule[];
  readonly unsupportedAttributeSources: string[];
  readonly importErrorMarkers: GameAssetImportMarker[];
  readonly truncationReasons: string[];
  readonly withheldPaths: GameAssetWithheldPath[];
  withheldPathCount: number;
  excludedDirectoryCount: number;
  markerReadBytes: number;
  importMarkerAssessment: 'complete' | 'partial';
}

const DEFAULT_FILE_SYSTEM: GameAssetFileSystem = {
  lstatSync: nodeLstatSync,
  readdirSync: filePath => nodeReaddirSync(filePath, { withFileTypes: true, encoding: 'utf8' }),
  readFileSync: nodeReadFileSync,
};

const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
const IMPORT_ERROR_PATTERN = /\b(?:import(?:er)?\s+(?:error|failed)|failed\s+to\s+import)\b/i;
const MISSING_REFERENCE_PATTERN = /\b(?:missing|unresolved)\s+(?:asset|reference|resource)\b/i;
const MARKER_TEXT_EXTENSIONS = new Set([
  '.asset', '.import', '.json', '.meta', '.remap', '.tres', '.tscn', '.txt', '.unity', '.yaml', '.yml',
]);
const METADATA_EXTENSIONS = ['.meta', '.import', '.remap'] as const;

const TYPE_BY_EXTENSION: Readonly<Record<string, GameAssetType>> = Object.freeze({
  '.umap': 'scene', '.unity': 'scene', '.tscn': 'scene', '.scn': 'scene',
  '.png': 'texture', '.jpg': 'texture', '.jpeg': 'texture', '.tga': 'texture',
  '.bmp': 'texture', '.gif': 'texture', '.webp': 'texture', '.dds': 'texture',
  '.exr': 'texture', '.hdr': 'texture', '.psd': 'texture', '.kra': 'texture',
  '.fbx': 'model', '.obj': 'model', '.gltf': 'model', '.glb': 'model',
  '.blend': 'model', '.dae': 'model', '.3ds': 'model',
  '.wav': 'audio', '.ogg': 'audio', '.mp3': 'audio', '.flac': 'audio', '.aiff': 'audio',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.avi': 'video',
  '.anim': 'animation', '.controller': 'animation', '.overridecontroller': 'animation',
  '.mat': 'material', '.material': 'material', '.tres': 'material',
  '.shader': 'shader', '.shadergraph': 'shader', '.hlsl': 'shader', '.glsl': 'shader',
  '.gdshader': 'shader', '.compute': 'shader', '.ush': 'shader', '.usf': 'shader',
  '.ttf': 'font', '.otf': 'font', '.woff': 'font', '.woff2': 'font',
  '.json': 'data', '.csv': 'data', '.xml': 'data', '.yaml': 'data', '.yml': 'data',
  '.po': 'data', '.pot': 'data', '.translation': 'data', '.locres': 'data',
  '.pak': 'package', '.zip': 'package', '.7z': 'package',
  '.uasset': 'other', '.asset': 'other', '.res': 'other',
});

const BINARY_EXTENSIONS = new Set([
  '.uasset', '.umap', '.png', '.jpg', '.jpeg', '.tga', '.bmp', '.gif', '.webp', '.dds',
  '.exr', '.hdr', '.psd', '.kra', '.fbx', '.obj', '.glb', '.blend', '.dae', '.3ds',
  '.wav', '.ogg', '.mp3', '.flac', '.aiff', '.mp4', '.mov', '.webm', '.avi', '.ttf',
  '.otf', '.woff', '.woff2', '.pak', '.zip', '.7z', '.res', '.scn', '.locres',
]);

function boundedPositiveInteger(value: unknown, fallback: number, hardMax: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, hardMax)
    : fallback;
}

function normalizeLimits(value: Partial<GameAssetScanLimits> | undefined): GameAssetScanLimits {
  return {
    maxFiles: boundedPositiveInteger(
      value?.maxFiles,
      GAME_ASSET_DEFAULT_LIMITS.maxFiles,
      GAME_ASSET_HARD_LIMITS.maxFiles,
    ),
    maxTotalBytes: boundedPositiveInteger(
      value?.maxTotalBytes,
      GAME_ASSET_DEFAULT_LIMITS.maxTotalBytes,
      GAME_ASSET_HARD_LIMITS.maxTotalBytes,
    ),
    maxDurationMs: boundedPositiveInteger(
      value?.maxDurationMs,
      GAME_ASSET_DEFAULT_LIMITS.maxDurationMs,
      GAME_ASSET_HARD_LIMITS.maxDurationMs,
    ),
  };
}

function safeDisplay(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  return clean || fallback;
}

function componentIdentity(target: GameAssetScanTarget): { id: string; label: string } {
  const id = safeDisplay(target.component?.id, 'unknown-component');
  return { id, label: safeDisplay(target.component?.label, id) };
}

function isGameAssetScanTarget(value: unknown): value is GameAssetScanTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<GameAssetScanTarget>;
  const component = candidate.component as Partial<GameAssetScanTarget['component']> | undefined;
  return typeof component === 'object'
    && component !== null
    && typeof component.id === 'string'
    && typeof component.label === 'string'
    && (PROJECT_COMPONENT_ROLES as readonly unknown[]).includes(component.role)
    && (PROJECT_COMPONENT_VCS as readonly unknown[]).includes(component.vcs)
    && Array.isArray(candidate.contentRoots);
}

function invalidTarget(index: number): UnavailableGameAssetInventory {
  return {
    status: 'invalid',
    componentId: `invalid-target-${index + 1}`,
    componentLabel: `Invalid target ${index + 1}`,
    reason: 'The asset-scan target was malformed.',
  };
}

function unavailable(
  target: GameAssetScanTarget,
  status: UnavailableGameAssetInventory['status'],
  reason: string,
): UnavailableGameAssetInventory {
  const component = componentIdentity(target);
  return { status, componentId: component.id, componentLabel: component.label, reason };
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}

function normalizeContentRoot(value: unknown): string | undefined {
  if (typeof value !== 'string'
    || !value
    || value.length > GAME_ASSET_HARD_LIMITS.maxPathChars
    || CONTROL_CHAR_PATTERN.test(value)) {
    return undefined;
  }
  const normalized = value.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalized === '.') {
    return normalized;
  }
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    return undefined;
  }
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..')
    ? undefined
    : normalized;
}

function normalizeRoots(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)
    || value.length === 0
    || value.length > GAME_ASSET_HARD_LIMITS.maxRootsPerComponent) {
    return undefined;
  }
  const roots: string[] = [];
  for (const candidate of value) {
    const root = normalizeContentRoot(candidate);
    if (root === undefined) {
      return undefined;
    }
    const folded = root.toLowerCase();
    if (!roots.some(existing => existing.toLowerCase() === folded)) {
      roots.push(root);
    }
  }
  for (let index = 0; index < roots.length; index += 1) {
    for (let other = index + 1; other < roots.length; other += 1) {
      const left = roots[index].toLowerCase();
      const right = roots[other].toLowerCase();
      if (left === '.' || right === '.' || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)) {
        return undefined;
      }
    }
  }
  return roots;
}

function resolveWithin(componentRoot: string, relative: string): string | undefined {
  const resolvedRoot = path.resolve(componentRoot);
  const resolved = relative === '.'
    ? resolvedRoot
    : path.resolve(resolvedRoot, ...relative.split('/'));
  const fromRoot = path.relative(resolvedRoot, resolved);
  return fromRoot === '' || (!fromRoot.startsWith(`..${path.sep}`) && fromRoot !== '..' && !path.isAbsolute(fromRoot))
    ? resolved
    : undefined;
}

function toRelative(componentRoot: string, absolute: string): string | undefined {
  const relative = path.relative(path.resolve(componentRoot), absolute).split(path.sep).join('/');
  if (!relative || relative.length > GAME_ASSET_HARD_LIMITS.maxPathChars) {
    return undefined;
  }
  return normalizeContentRoot(relative);
}

function assetType(filePath: string): GameAssetType | undefined {
  return TYPE_BY_EXTENSION[path.extname(filePath).toLowerCase()];
}

function appendReason(scan: MutableScan, reason: string): void {
  if (!scan.truncationReasons.includes(reason)) {
    scan.truncationReasons.push(reason);
  }
}

function budgetReason(budget: SharedBudget, now: () => number): string | undefined {
  if (budget.files >= budget.limits.maxFiles) {
    return `The ${budget.limits.maxFiles}-file scan limit was reached.`;
  }
  if (budget.bytes >= budget.limits.maxTotalBytes) {
    return `The ${budget.limits.maxTotalBytes}-byte scan limit was reached.`;
  }
  if (now() - budget.startedAt >= budget.limits.maxDurationMs) {
    return `The ${budget.limits.maxDurationMs} ms scan limit was reached.`;
  }
  return undefined;
}

function readAttributeFile(
  absolutePath: string,
  sourcePath: string,
  baseDirectory: string,
  fs: GameAssetFileSystem,
  scan: MutableScan,
): void {
  try {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > GAME_ASSET_HARD_LIMITS.maxAttributeBytes) {
      scan.unsupportedAttributeSources.push(sourcePath);
      return;
    }
    const content = fs.readFileSync(absolutePath, 'utf8');
    if (content.length > GAME_ASSET_HARD_LIMITS.maxAttributeBytes) {
      scan.unsupportedAttributeSources.push(sourcePath);
      return;
    }
    const parsed = parseGitAttributes(content, baseDirectory, sourcePath);
    scan.attributeRules.push(...parsed.rules);
    if (parsed.unsupportedLfsLines.length > 0) {
      scan.unsupportedAttributeSources.push(sourcePath);
    }
  } catch {
    scan.unsupportedAttributeSources.push(sourcePath);
  }
}

function scanImportMarkers(
  absolutePath: string,
  relativePath: string,
  size: number,
  fs: GameAssetFileSystem,
  scan: MutableScan,
): void {
  if (!MARKER_TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
    return;
  }
  if (size > GAME_ASSET_HARD_LIMITS.maxMarkerFileBytes
    || scan.markerReadBytes + size > GAME_ASSET_HARD_LIMITS.maxMarkerReadBytes) {
    scan.importMarkerAssessment = 'partial';
    return;
  }
  try {
    const content = fs.readFileSync(absolutePath, 'utf8');
    if (content.length > GAME_ASSET_HARD_LIMITS.maxMarkerFileBytes) {
      scan.importMarkerAssessment = 'partial';
      return;
    }
    scan.markerReadBytes += size;
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (scan.importErrorMarkers.length >= GAME_ASSET_HARD_LIMITS.maxImportMarkers) {
        scan.importMarkerAssessment = 'partial';
        return;
      }
      const kind = IMPORT_ERROR_PATTERN.test(lines[index])
        ? 'import-error'
        : MISSING_REFERENCE_PATTERN.test(lines[index])
          ? 'missing-reference'
          : undefined;
      if (kind !== undefined) {
        // Raw lines are deliberately not retained: asset metadata can contain
        // machine paths and secrets, and the location is sufficient evidence.
        scan.importErrorMarkers.push({ path: relativePath, line: index + 1, kind });
      }
    }
  } catch {
    scan.importMarkerAssessment = 'partial';
  }
}

function recordWithheld(scan: MutableScan, entry: GameAssetWithheldPath): void {
  scan.withheldPathCount += 1;
  if (scan.withheldPaths.length < GAME_ASSET_HARD_LIMITS.maxWithheldPaths) {
    scan.withheldPaths.push(entry);
  }
}

function sortedEntries(fs: GameAssetFileSystem, directory: string): Dirent[] {
  return fs.readdirSync(directory).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

function isExcludedDirectory(relativePath: string, name: string): boolean {
  const foldedName = name.toLowerCase();
  return GAME_ASSET_EXCLUDED_DIRECTORIES.has(foldedName)
    || (!relativePath.includes('/') && GAME_ASSET_ROOT_CACHE_DIRECTORIES.has(foldedName));
}

function walkRoot(
  componentRoot: string,
  absoluteRoot: string,
  fs: GameAssetFileSystem,
  now: () => number,
  budget: SharedBudget,
  scan: MutableScan,
  collectGitAttributes: boolean,
): void {
  const queue = [absoluteRoot];
  while (queue.length > 0 && scan.truncationReasons.length === 0) {
    const beforeDirectory = budgetReason(budget, now);
    if (beforeDirectory !== undefined) {
      appendReason(scan, beforeDirectory);
      return;
    }
    const directory = queue.shift() as string;
    let entries: Dirent[];
    try {
      entries = sortedEntries(fs, directory);
    } catch {
      const relative = path.relative(componentRoot, directory).split(path.sep).join('/') || '.';
      appendReason(scan, `The directory \`${relative}\` was unreadable.`);
      return;
    }

    for (const entry of entries) {
      const beforeEntry = budgetReason(budget, now);
      if (beforeEntry !== undefined) {
        appendReason(scan, beforeEntry);
        return;
      }
      const absolute = path.join(directory, entry.name);
      const relative = toRelative(componentRoot, absolute);
      if (relative === undefined) {
        recordWithheld(scan, { path: entry.name.slice(0, 120), reason: 'unsafe-relative-path' });
        continue;
      }
      if (entry.isSymbolicLink()) {
        recordWithheld(scan, { path: relative, reason: 'symbolic-link' });
        continue;
      }
      if (entry.isDirectory()) {
        scan.allDirectories.add(relative.toLowerCase());
        if (isExcludedDirectory(relative, entry.name)) {
          scan.excludedDirectoryCount += 1;
        } else {
          queue.push(absolute);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      let stat: Stats;
      try {
        stat = fs.lstatSync(absolute);
      } catch {
        appendReason(scan, `The file \`${relative}\` could not be measured.`);
        return;
      }
      if (stat.isSymbolicLink()) {
        recordWithheld(scan, { path: relative, reason: 'symbolic-link' });
        continue;
      }
      if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0) {
        appendReason(scan, `The file \`${relative}\` had invalid size evidence.`);
        return;
      }
      if (budget.files + 1 > budget.limits.maxFiles) {
        appendReason(scan, `The ${budget.limits.maxFiles}-file scan limit was reached.`);
        return;
      }
      if (budget.bytes + stat.size > budget.limits.maxTotalBytes) {
        appendReason(scan, `The ${budget.limits.maxTotalBytes}-byte scan limit was reached.`);
        return;
      }
      budget.files += 1;
      budget.bytes += stat.size;
      scan.allFiles.set(relative.toLowerCase(), relative);

      if (collectGitAttributes && entry.name.toLowerCase() === '.gitattributes') {
        const baseDirectory = path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative);
        if (relative.toLowerCase() !== '.gitattributes') {
          readAttributeFile(absolute, relative, baseDirectory, fs, scan);
        }
        continue;
      }

      scanImportMarkers(absolute, relative, stat.size, fs, scan);
      const type = assetType(relative);
      if (type !== undefined) {
        const extension = path.extname(relative).toLowerCase();
        scan.assets.push({
          path: relative,
          type,
          sizeBytes: stat.size,
          binary: BINARY_EXTENSIONS.has(extension),
          openable: true,
        });
      }
    }
  }
}

function escapeRegexCharacter(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

function globRegexSource(pattern: string): string | undefined {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '[' || character === ']' || character === '\\') {
      return undefined;
    }
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        const followedBySlash = pattern[index + 2] === '/';
        source += followedBySlash ? '(?:.*/)?' : '.*';
        index += followedBySlash ? 2 : 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (character === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegexCharacter(character);
  }
  return source;
}

function matchesAttributePattern(
  targetPath: string,
  baseDirectory: string,
  pattern: string,
): boolean | undefined {
  const normalizedPattern = pattern.startsWith('/') ? pattern.slice(1) : pattern;
  if (!normalizedPattern || normalizedPattern.endsWith('/')) {
    return undefined;
  }
  const relative = baseDirectory === ''
    ? targetPath
    : targetPath.startsWith(`${baseDirectory}/`)
      ? targetPath.slice(baseDirectory.length + 1)
      : undefined;
  if (relative === undefined) {
    return false;
  }
  const source = globRegexSource(normalizedPattern);
  if (source === undefined) {
    return undefined;
  }
  const candidate = normalizedPattern.includes('/') ? relative : path.posix.basename(relative);
  return new RegExp(`^${source}$`).test(candidate);
}

/**
 * Parse only the `filter` attribute needed for LFS coverage.
 * Unsupported LFS-affecting syntax makes the verdict unreadable; it is never
 * silently treated as an uncovered asset.
 */
export function parseGitAttributes(
  content: string,
  baseDirectory = '',
  sourcePath = '.gitattributes',
): GitAttributeParseResult {
  const rules: GitAttributeRule[] = [];
  const unsupportedLfsLines: number[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith('#') || !/(?:^|\s)[!-]?filter(?:=|\s|$)/.test(line)) {
      continue;
    }
    const fields = line.split(/\s+/);
    const pattern = fields[0];
    if (fields.length < 2
      || pattern.startsWith('[attr]')
      || pattern.startsWith('!')
      || pattern.includes('"')
      || globRegexSource(pattern.startsWith('/') ? pattern.slice(1) : pattern) === undefined
      || pattern.endsWith('/')) {
      unsupportedLfsLines.push(index + 1);
      continue;
    }
    const filterTokens = fields.slice(1).filter(field =>
      field === 'filter' || field === '-filter' || field === '!filter' || field.startsWith('filter='));
    if (filterTokens.length !== 1) {
      unsupportedLfsLines.push(index + 1);
      continue;
    }
    rules.push({
      baseDirectory,
      pattern,
      filter: filterTokens[0] === 'filter=lfs' ? 'lfs' : 'not-lfs',
      sourcePath,
      line: index + 1,
    });
  }
  return { rules, unsupportedLfsLines };
}

/** Return whether the final applicable `filter` attribute selects Git LFS. */
export function isPathCoveredByLfs(
  targetPath: string,
  rules: readonly GitAttributeRule[],
): boolean | undefined {
  const normalizedTarget = normalizeContentRoot(targetPath);
  if (normalizedTarget === undefined || normalizedTarget === '.') {
    return undefined;
  }
  let filter: 'lfs' | 'not-lfs' | undefined;
  for (const rule of rules) {
    const matches = matchesAttributePattern(normalizedTarget, rule.baseDirectory, rule.pattern);
    if (matches === undefined) {
      return undefined;
    }
    if (matches) {
      filter = rule.filter;
    }
  }
  return filter === undefined ? false : filter === 'lfs';
}

function summarizeAssets(assets: readonly GameAssetRecord[]): GameAssetTypeSummary[] {
  return GAME_ASSET_TYPES.map(type => {
    const matching = assets.filter(asset => asset.type === type);
    return {
      type,
      count: matching.length,
      sizeBytes: matching.reduce((sum, asset) => sum + asset.sizeBytes, 0),
    };
  }).filter(summary => summary.count > 0);
}

function deriveOrphans(scan: MutableScan): GameAssetOrphanCandidate[] {
  const candidates: GameAssetOrphanCandidate[] = [];
  for (const [foldedMetadataPath, metadataPath] of scan.allFiles) {
    const extension = METADATA_EXTENSIONS.find(candidate => foldedMetadataPath.endsWith(candidate));
    if (extension === undefined) {
      continue;
    }
    const foldedAssetPath = foldedMetadataPath.slice(0, -extension.length);
    const assetPath = metadataPath.slice(0, -extension.length);
    if (assetPath
      && !scan.allFiles.has(foldedAssetPath)
      && !scan.allDirectories.has(foldedAssetPath)) {
      candidates.push({
        metadataPath,
        missingAssetPath: assetPath,
        reason: 'metadata-without-asset',
      });
    }
  }
  return candidates.sort((left, right) => left.metadataPath < right.metadataPath ? -1 : 1);
}

function lfsCoverage(
  target: GameAssetScanTarget,
  scan: MutableScan,
  truncated: boolean,
): GameAssetLfsCoverage {
  if (target.component.vcs !== 'git') {
    return {
      status: 'not-visible',
      reason: `LFS coverage is unavailable because this component declares VCS \`${target.component.vcs}\`, not Git.`,
    };
  }
  if (scan.unsupportedAttributeSources.length > 0) {
    return {
      status: 'unreadable',
      reason: `LFS rules were unreadable or unsupported in: ${[...new Set(scan.unsupportedAttributeSources)].join(', ')}.`,
    };
  }
  const binaryAssets = scan.assets.filter(asset => asset.binary);
  const uncovered: string[] = [];
  let covered = 0;
  for (const asset of binaryAssets) {
    const result = isPathCoveredByLfs(asset.path, scan.attributeRules);
    if (result === undefined) {
      return { status: 'unreadable', reason: 'An LFS pattern could not be evaluated safely.' };
    }
    if (result) {
      covered += 1;
    } else {
      uncovered.push(asset.path);
    }
  }
  return {
    status: truncated ? 'partial' : 'assessed',
    binaryAssetCount: binaryAssets.length,
    coveredCount: covered,
    uncoveredCount: uncovered.length,
    uncoveredPaths: uncovered,
    ...(truncated ? { reason: 'Coverage describes only the bounded files observed before truncation.' } : {}),
  };
}

function scanTarget(
  target: GameAssetScanTarget,
  fs: GameAssetFileSystem,
  now: () => number,
  budget: SharedBudget,
): GameAssetComponentInventory {
  const roots = normalizeRoots(target.contentRoots);
  if (roots === undefined) {
    return unavailable(target, 'invalid', 'Content roots were absent, unsafe, overlapping, or over-bound.');
  }
  if (target.component.vcs === 'perforce' || target.component.vcs === 'external' || target.component.vcs === 'unknown') {
    return unavailable(
      target,
      'not-visible',
      `Asset contents are not visible to this reader for VCS \`${target.component.vcs}\`; no zero count was inferred.`,
    );
  }
  if (typeof target.componentRoot !== 'string'
    || target.componentRoot.length > GAME_ASSET_HARD_LIMITS.maxPathChars
    || CONTROL_CHAR_PATTERN.test(target.componentRoot)
    || !path.isAbsolute(target.componentRoot)) {
    return unavailable(target, 'not-visible', 'The component root was not resolved to an opened absolute path.');
  }
  const beforeTarget = budgetReason(budget, now);
  if (beforeTarget !== undefined) {
    return unavailable(target, 'unreadable', `The shared scan budget expired before this component: ${beforeTarget}`);
  }

  const resolvedRoots: Array<{ relative: string; absolute: string }> = [];
  try {
    const componentStat = fs.lstatSync(path.resolve(target.componentRoot));
    if (componentStat.isSymbolicLink() || !componentStat.isDirectory()) {
      return unavailable(target, 'invalid', 'The component root is not a direct readable directory.');
    }
  } catch {
    return unavailable(target, 'unreadable', 'The component root could not be read.');
  }
  for (const root of roots) {
    const absolute = resolveWithin(target.componentRoot, root);
    if (absolute === undefined) {
      return unavailable(target, 'invalid', `Content root \`${root}\` escaped its component.`);
    }
    try {
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        return unavailable(target, 'invalid', `Content root \`${root}\` is a symbolic link and was not followed.`);
      }
      if (!stat.isDirectory()) {
        return unavailable(target, 'unreadable', `Content root \`${root}\` is not a directory.`);
      }
    } catch {
      return unavailable(target, 'unreadable', `Content root \`${root}\` could not be read.`);
    }
    resolvedRoots.push({ relative: root, absolute });
  }

  const scan: MutableScan = {
    allFiles: new Map(),
    allDirectories: new Set(),
    assets: [],
    attributeRules: [],
    unsupportedAttributeSources: [],
    importErrorMarkers: [],
    truncationReasons: [],
    withheldPaths: [],
    withheldPathCount: 0,
    excludedDirectoryCount: 0,
    markerReadBytes: 0,
    importMarkerAssessment: 'complete',
  };

  if (target.component.vcs === 'git') {
    const rootAttributes = path.join(path.resolve(target.componentRoot), '.gitattributes');
    try {
      const rootStat = fs.lstatSync(rootAttributes);
      if (rootStat.isSymbolicLink()) {
        scan.unsupportedAttributeSources.push('.gitattributes');
      } else if (rootStat.isFile()) {
        readAttributeFile(rootAttributes, '.gitattributes', '', fs, scan);
      }
    } catch (error) {
      // Missing root attributes means no root LFS rule. Other failures make the
      // LFS verdict unreadable, because "could not read" is not "no rules".
      if (!isFileNotFound(error)) {
        scan.unsupportedAttributeSources.push('.gitattributes');
      }
    }
  }

  for (const root of resolvedRoots) {
    if (scan.truncationReasons.length > 0) {
      break;
    }
    walkRoot(
      target.componentRoot,
      root.absolute,
      fs,
      now,
      budget,
      scan,
      target.component.vcs === 'git',
    );
  }

  const truncated = scan.truncationReasons.length > 0;
  const component = componentIdentity(target);
  const assets = [...scan.assets].sort((left, right) => left.path < right.path ? -1 : 1);
  return {
    status: 'available',
    componentId: component.id,
    componentLabel: component.label,
    contentRoots: roots,
    scannedFileCount: scan.allFiles.size,
    assetCount: assets.length,
    totalBytes: assets.reduce((sum, asset) => sum + asset.sizeBytes, 0),
    assets,
    byType: summarizeAssets(assets),
    importErrorMarkers: scan.importErrorMarkers,
    importMarkerAssessment: truncated ? 'partial' : scan.importMarkerAssessment,
    orphanCandidates: truncated ? [] : deriveOrphans(scan),
    orphanAssessment: truncated ? 'withheld-incomplete' : 'complete',
    lfs: lfsCoverage(target, scan, truncated),
    truncated,
    truncationReasons: scan.truncationReasons,
    withheldPaths: scan.withheldPaths,
    withheldPathCount: scan.withheldPathCount,
    excludedDirectoryCount: scan.excludedDirectoryCount,
  };
}

/**
 * Scan explicitly declared content roots after confirmation.
 *
 * The shared limits cap the whole request, not each component, so a composition
 * cannot multiply the budget merely by declaring more roots.
 */
export function scanGameAssetInventory(
  input: GameAssetInventoryInput,
  dependencies: GameAssetInventoryDependencies = {},
): GameAssetInventoryReport {
  const limits = normalizeLimits(input?.limits);
  if (!Array.isArray(input?.targets)
    || input.targets.length > GAME_ASSET_HARD_LIMITS.maxComponents) {
    return { confirmed: input?.confirmed === true, complete: false, limits, components: [] };
  }
  if (input.confirmed !== true) {
    return {
      confirmed: false,
      complete: false,
      limits,
      components: input.targets.map((target, index) => isGameAssetScanTarget(target)
        ? unavailable(
            target,
            'confirmation-required',
            'Asset inventory requires an explicit request and confirmation.',
          )
        : invalidTarget(index)),
    };
  }

  const fs = dependencies.fs ?? DEFAULT_FILE_SYSTEM;
  const now = dependencies.now ?? (() => performance.now());
  const budget: SharedBudget = { startedAt: now(), limits, files: 0, bytes: 0 };
  const components = input.targets.map((target, index) => isGameAssetScanTarget(target)
    ? scanTarget(target, fs, now, budget)
    : invalidTarget(index));
  return {
    confirmed: true,
    complete: components.length > 0
      && components.every(component => component.status === 'available' && !component.truncated),
    limits,
    components,
  };
}
